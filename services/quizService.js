const pool = require("../database");
const { emitSocketRoom, notifySocketUser } = require("./events");
const { generateQuestion, generateContestSet, publicQuestion, answerMatches } = require("./quizQuestionEngine");

const QUIZ_PREFIX = "[[QUIZ]]";
const ROOM_DURATION_MS = Math.max(5000, Math.min(30000, Number(process.env.QUIZ_ROOM_QUESTION_SECONDS || 15) * 1000));
const NEXT_DELAY_MS = Math.max(500, Math.min(10000, Number(process.env.QUIZ_NEXT_QUESTION_DELAY_MS || 2000)));
const CONTEST_DURATION_MS = Math.max(5000, Math.min(30000, Number(process.env.QUIZ_CONTEST_QUESTION_SECONDS || 10) * 1000));
const JOIN_GRACE_MS = Math.max(15000, Math.min(10 * 60 * 1000, Number(process.env.QUIZ_CONTEST_JOIN_GRACE_SECONDS || 60) * 1000));
const RECENT_QUESTION_WINDOW = Math.max(500, Math.min(10000, Number(process.env.QUIZ_RECENT_QUESTION_WINDOW || 6000)));

let quizRoomId = null;
let quizBot = null;
let roomTimer = null;
let roomNextTimer = null;
let roomQueue = Promise.resolve();
const matchTimers = new Map();
const answerWindows = new Map();
const recentQuestionKeyQueue = [];
const recentQuestionKeySet = new Set();
let recentQuestionCacheReady = false;
let initialized = false;

function fail(message, status = 400, code = "QUIZ_ERROR") {
  const error = new Error(message); error.status = status; error.code = code; return error;
}
function parseJson(value, fallback) { try { return JSON.parse(value || "") || fallback; } catch (_error) { return fallback; } }
function nowIso() { return new Date().toISOString(); }
function ms(value) { const result = new Date(value).getTime(); return Number.isFinite(result) ? result : 0; }
function roomPoints(elapsedMs) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  if (elapsed <= 3000) return 100;
  return Math.max(60, 90 - Math.floor((elapsed - 3000) / 2000) * 10);
}
function contestPoints(elapsedMs) { return Math.max(2, 20 - Math.floor(Math.max(0, elapsedMs) / 1000) * 2); }

function serialize(work) {
  const previous = roomQueue;
  let release;
  roomQueue = new Promise((resolve) => { release = resolve; });
  return previous.then(work).finally(release);
}

async function botMessage(payload) {
  if (!quizRoomId || !quizBot) return null;
  const body = `${QUIZ_PREFIX}${JSON.stringify(payload)}`;
  const [result] = await pool.query("INSERT INTO messages (room_id, user_id, body) VALUES (?, ?, ?)", [quizRoomId, quizBot.id, body]);
  const message = {
    id: result.insertId, room_id: Number(quizRoomId), user_id: Number(quizBot.id), body, created_at: new Date(),
    username: quizBot.username, rank_name: "bot", profile_title: "Live quiz host", avatar_url: quizBot.avatar_url,
    username_color: "#60a5fa", text_color: "#e0f2fe", bubble_style: "default", frame: "clean",
  };
  emitSocketRoom(`quiz:room:${quizRoomId}`, "message", message);
  return message;
}

async function activeRoomQuestion() {
  const [[row]] = await pool.query("SELECT * FROM quiz_room_sessions WHERE room_id = ? AND status IN ('active','paused') ORDER BY id DESC LIMIT 1", [quizRoomId]);
  return row || null;
}

function roomPublic(row) {
  if (!row) return { roomId: Number(quizRoomId), status: "between", serverNow: nowIso() };
  const question = parseJson(row.question_json, null);
  const elapsed = row.status === "paused" ? Math.max(0, ROOM_DURATION_MS - Number(row.pause_remaining_ms || 0)) : Math.max(0, Date.now() - ms(row.started_at));
  return {
    roomId: Number(row.room_id), sessionId: Number(row.id), status: row.status, questionNumber: Number(row.question_number),
    question: publicQuestion(question), startedAt: row.started_at, expiresAt: row.expires_at,
    maximumPoints: row.status === "active" ? roomPoints(elapsed) : 0, serverNow: nowIso(),
  };
}

async function roomState() { return roomPublic(await activeRoomQuestion()); }

function rememberQuestionKey(questionKey) {
  const key = String(questionKey || "");
  if (!key || recentQuestionKeySet.has(key)) return;
  recentQuestionKeyQueue.push(key);
  recentQuestionKeySet.add(key);
  while (recentQuestionKeyQueue.length > RECENT_QUESTION_WINDOW) {
    recentQuestionKeySet.delete(recentQuestionKeyQueue.shift());
  }
}

async function hydrateRecentQuestionKeys() {
  if (recentQuestionCacheReady) return;
  const [rows] = await pool.query("SELECT question_key FROM quiz_question_history ORDER BY used_at DESC LIMIT ?", [RECENT_QUESTION_WINDOW]);
  for (const row of rows.reverse()) rememberQuestionKey(row.question_key);
  recentQuestionCacheReady = true;
}

async function recentQuestionKeys(limit = RECENT_QUESTION_WINDOW) {
  await hydrateRecentQuestionKeys();
  return recentQuestionKeyQueue.slice(-Math.max(1, Number(limit) || RECENT_QUESTION_WINDOW));
}

function clearRoomTimers() { clearTimeout(roomTimer); clearTimeout(roomNextTimer); roomTimer = null; roomNextTimer = null; }

async function startRoomQuestion() {
  clearRoomTimers();
  const existing = await activeRoomQuestion();
  if (existing?.status === "paused") return existing;
  if (existing && ms(existing.expires_at) > Date.now()) return scheduleRoomExpiry(existing);
  if (existing) await pool.query("UPDATE quiz_room_sessions SET status = 'expired', resolved_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'active'", [existing.id]);
  const recentKeys = await recentQuestionKeys();
  const question = generateQuestion({ recentKeys });
  question.durationMs = ROOM_DURATION_MS;
  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + ROOM_DURATION_MS);
  const [[counter]] = await pool.query("SELECT COALESCE(MAX(question_number), 0) + 1 AS next_number FROM quiz_room_sessions WHERE room_id = ?", [quizRoomId]);
  const [result] = await pool.query(
    `INSERT INTO quiz_room_sessions (room_id, question_id, question_key, question_number, category, question_json, status, started_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    [quizRoomId, question.id, question.sourceKey, Number(counter.next_number), question.category, JSON.stringify(question), startedAt, expiresAt]
  );
  await pool.query("INSERT INTO quiz_question_history (question_id, question_key, category) VALUES (?, ?, ?)", [question.id, question.sourceKey, question.category]);
  rememberQuestionKey(question.sourceKey);
  const [[row]] = await pool.query("SELECT * FROM quiz_room_sessions WHERE id = ?", [result.insertId]);
  await botMessage({ type: "question", category: question.category, question: question.question, hint: question.hint, durationSeconds: ROOM_DURATION_MS / 1000, maximumPoints: 100, questionNumber: Number(row.question_number), sessionId: Number(row.id), expiresAt: row.expires_at });
  emitSocketRoom(`quiz:room:${quizRoomId}`, "quiz:question_started", roomPublic(row));
  scheduleRoomExpiry(row);
  return row;
}

function scheduleRoomExpiry(row) {
  clearTimeout(roomTimer);
  const delay = Math.max(10, ms(row.expires_at) - Date.now());
  roomTimer = setTimeout(() => expireRoomQuestion(row.id).catch((error) => console.error("[quiz room expiry]", error.message)), delay);
  roomTimer.unref?.();
  return row;
}

async function expireRoomQuestion(sessionId, reason = "expired") {
  return serialize(async () => {
    const connection = await pool.getConnection();
    let row;
    try {
      await connection.beginTransaction();
      [[row]] = await connection.query("SELECT * FROM quiz_room_sessions WHERE id = ? FOR UPDATE", [sessionId]);
      if (!row || !["active", "paused"].includes(row.status)) { await connection.rollback(); return false; }
      await connection.query("UPDATE quiz_room_sessions SET status = ?, resolved_at = UTC_TIMESTAMP() WHERE id = ?", [reason, row.id]);
      await connection.commit();
    } catch (error) { await connection.rollback().catch(() => {}); throw error; }
    finally { connection.release(); }
    const question = parseJson(row.question_json, {});
    await botMessage({ type: reason === "skipped" ? "skipped" : "expired", answer: question.answer, category: row.category, questionNumber: Number(row.question_number) });
    emitSocketRoom(`quiz:room:${quizRoomId}`, "quiz:expired", { sessionId: Number(row.id), answer: question.answer, reason, serverNow: nowIso() });
    roomNextTimer = setTimeout(() => startRoomQuestion().catch((error) => console.error("[quiz next question]", error.message)), NEXT_DELAY_MS);
    roomNextTimer.unref?.();
    return true;
  });
}

function allowAnswer(userId) {
  const id = Number(userId); const now = Date.now();
  const window = (answerWindows.get(id) || []).filter((time) => now - time < 5000);
  if (window.length >= 6) throw fail("Slow down before trying another quiz answer.", 429, "QUIZ_RATE_LIMIT");
  window.push(now); answerWindows.set(id, window);
}

async function handleRoomMessage(roomId, message, user, { receivedAtMs = Date.now() } = {}) {
  if (!initialized || Number(roomId) !== Number(quizRoomId) || user.rank_name === "bot") return null;
  allowAnswer(user.id);
  const answerText = String(message.body || "").trim();
  if (!answerText || answerText.startsWith("/")) return null;
  return serialize(async () => {
    const connection = await pool.getConnection();
    let session; let question; let responseMs; let points = 0; let correct = false;
    try {
      await connection.beginTransaction();
      [[session]] = await connection.query("SELECT * FROM quiz_room_sessions WHERE room_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1 FOR UPDATE", [quizRoomId]);
      if (!session || receivedAtMs > ms(session.expires_at)) { await connection.rollback(); return null; }
      const [[duplicate]] = await connection.query("SELECT id FROM quiz_room_answers WHERE message_id = ? LIMIT 1", [message.id]);
      if (duplicate) { await connection.rollback(); return null; }
      question = parseJson(session.question_json, {});
      responseMs = Math.max(0, receivedAtMs - ms(session.started_at));
      correct = answerMatches(question, answerText);
      if (correct) {
        points = roomPoints(responseMs);
        await connection.query("UPDATE quiz_room_sessions SET status = 'answered', winner_user_id = ?, winning_answer = ?, awarded_points = ?, response_ms = ?, resolved_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'active'", [user.id, answerText.slice(0, 100), points, responseMs, session.id]);
      }
      await connection.query("INSERT INTO quiz_room_answers (session_id, user_id, message_id, answer_text, correct, response_ms, awarded_points) VALUES (?, ?, ?, ?, ?, ?, ?)", [session.id, user.id, message.id, answerText.slice(0, 100), correct ? 1 : 0, responseMs, points]);
      await connection.query(
        `INSERT INTO quiz_user_stats (user_id, quiz_score, quiz_lifetime_score, quiz_correct_answers, quiz_wrong_attempts, quiz_questions_attempted, quiz_fastest_answer_ms, quiz_current_streak, quiz_best_streak)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           quiz_score = quiz_score + VALUES(quiz_score), quiz_lifetime_score = quiz_lifetime_score + VALUES(quiz_lifetime_score),
           quiz_correct_answers = quiz_correct_answers + VALUES(quiz_correct_answers), quiz_wrong_attempts = quiz_wrong_attempts + VALUES(quiz_wrong_attempts),
           quiz_questions_attempted = quiz_questions_attempted + 1,
           quiz_fastest_answer_ms = CASE WHEN VALUES(quiz_correct_answers) = 1 THEN LEAST(COALESCE(quiz_fastest_answer_ms, VALUES(quiz_fastest_answer_ms)), VALUES(quiz_fastest_answer_ms)) ELSE quiz_fastest_answer_ms END,
           quiz_current_streak = CASE WHEN VALUES(quiz_correct_answers) = 1 THEN quiz_current_streak + 1 ELSE 0 END,
           quiz_best_streak = GREATEST(quiz_best_streak, CASE WHEN VALUES(quiz_correct_answers) = 1 THEN quiz_current_streak + 1 ELSE quiz_best_streak END),
           quiz_updated_at = UTC_TIMESTAMP()`,
        [user.id, points, points, correct ? 1 : 0, correct ? 0 : 1, correct ? responseMs : null, correct ? 1 : 0, correct ? 1 : 0]
      );
      await connection.commit();
    } catch (error) { await connection.rollback().catch(() => {}); throw error; }
    finally { connection.release(); }
    if (!correct) return { correct: false };
    clearTimeout(roomTimer);
    await botMessage({ type: "winner", username: user.username, answer: question.answer, speedMs: responseMs, points, category: question.category, questionNumber: Number(session.question_number) });
    const result = { sessionId: Number(session.id), userId: Number(user.id), username: user.username, points, responseMs, answer: question.answer, category: question.category, serverNow: nowIso() };
    emitSocketRoom(`quiz:room:${quizRoomId}`, "quiz:answered", result);
    emitSocketRoom(`quiz:room:${quizRoomId}`, "quiz:leaderboard_updated", { userId: Number(user.id) });
    emitSocketRoom("quiz:contest", "quiz:leaderboard_updated", { userId: Number(user.id) });
    notifySocketUser(user.id, "quiz:score_updated", { points, responseMs });
    roomNextTimer = setTimeout(() => startRoomQuestion().catch((error) => console.error("[quiz next question]", error.message)), NEXT_DELAY_MS);
    roomNextTimer.unref?.();
    return { correct: true, points };
  });
}

async function submitRoomMessage(roomId, user, rawBody) {
  const receivedAtMs = Date.now();
  if (!initialized || Number(roomId) !== Number(quizRoomId)) throw fail("Quiz Room is unavailable.", 404, "QUIZ_ROOM_NOT_FOUND");
  if (!user || user.isGuest || user.rank_name === "bot") throw fail("Create an account to answer Quiz Room questions.", 403, "REGISTERED_ONLY");
  const body = String(rawBody || "").trim().slice(0, 1200);
  if (!body) throw fail("Type an answer first.", 400, "QUIZ_ANSWER_REQUIRED");
  if (body.startsWith("/")) throw fail("Commands use the regular message route.", 400, "QUIZ_COMMAND_UNSUPPORTED");
  const [result] = await pool.query(
    `INSERT INTO messages (room_id, user_id, body)
     SELECT ?, id, ? FROM users
     WHERE id = ?
       AND (muted_until IS NULL OR muted_until <= UTC_TIMESTAMP())
       AND (kicked_until IS NULL OR kicked_until <= UTC_TIMESTAMP())
       AND (banned_until IS NULL OR banned_until <= UTC_TIMESTAMP())`,
    [quizRoomId, body, user.id]
  );
  if (!result.affectedRows) throw fail("You cannot send messages right now.", 403, "CHAT_RESTRICTED");
  const message = {
    id: result.insertId, room_id: Number(quizRoomId), user_id: Number(user.id), body,
    attachment_url: null, attachment_type: null, reply_to_id: null, is_pinned: 0, created_at: new Date(),
    username: user.username, rank_name: user.rank_name, profile_title: user.profile_title,
    avatar_url: user.avatar_url, username_color: user.username_color, text_color: user.text_color,
    bubble_style: user.bubble_style, frame: user.frame,
  };
  emitSocketRoom(`quiz:room:${quizRoomId}`, "message", message);
  handleRoomMessage(quizRoomId, message, user, { receivedAtMs }).catch((error) => {
    if (error.code !== "QUIZ_RATE_LIMIT") console.error("[quiz socket answer] processing failed:", error.message);
  });
  (async () => {
    await pool.query("UPDATE users SET message_count = message_count + 1, xp = xp + IF((message_count + 1) % 2 = 0, 1, 0), gold = gold + IF((message_count + 1) % 10 = 0, 100, 0) WHERE id = ?", [user.id]);
    await Promise.all([
      pool.query("INSERT IGNORE INTO user_achievements (user_id, achievement_id) SELECT ?, id FROM achievements WHERE code = 'first_message'", [user.id]),
      pool.query("INSERT IGNORE INTO user_achievements (user_id, achievement_id) SELECT ?, id FROM achievements WHERE code = 'ten_messages' AND (SELECT message_count FROM users WHERE id = ?) >= 10", [user.id, user.id]),
    ]);
  })().catch((error) => console.error("[quiz socket rewards] update failed:", error.message));
  return message;
}

async function pauseRoomQuestion(actorUserId) {
  const [[row]] = await pool.query("SELECT * FROM quiz_room_sessions WHERE room_id=? AND status='active' ORDER BY id DESC LIMIT 1", [quizRoomId]);
  if (!row) throw fail("There is no active Quiz Room question.", 409, "QUIZ_NOT_ACTIVE");
  clearTimeout(roomTimer);
  const remaining = Math.max(0, ms(row.expires_at) - Date.now());
  await pool.query("UPDATE quiz_room_sessions SET status='paused', pause_remaining_ms=? WHERE id=? AND status='active'", [remaining, row.id]);
  await botMessage({ type: "paused", questionNumber: Number(row.question_number) });
  emitSocketRoom(`quiz:room:${quizRoomId}`, "quiz:paused", { sessionId: Number(row.id), remainingMs: remaining, actorUserId: Number(actorUserId), serverNow: nowIso() });
  return roomState();
}

async function resumeRoomQuestion(actorUserId) {
  const [[row]] = await pool.query("SELECT * FROM quiz_room_sessions WHERE room_id=? AND status='paused' ORDER BY id DESC LIMIT 1", [quizRoomId]);
  if (!row) throw fail("The Quiz Room is not paused.", 409, "QUIZ_NOT_PAUSED");
  const remaining = Math.max(1000, Number(row.pause_remaining_ms || ROOM_DURATION_MS));
  const elapsed = Math.max(0, ROOM_DURATION_MS - remaining);
  const started = new Date(Date.now() - elapsed); const expires = new Date(Date.now() + remaining);
  await pool.query("UPDATE quiz_room_sessions SET status='active', started_at=?, expires_at=?, pause_remaining_ms=NULL WHERE id=? AND status='paused'", [started, expires, row.id]);
  const [[fresh]] = await pool.query("SELECT * FROM quiz_room_sessions WHERE id=?", [row.id]);
  await botMessage({ type: "resumed", questionNumber: Number(row.question_number) });
  emitSocketRoom(`quiz:room:${quizRoomId}`, "quiz:resumed", roomPublic(fresh));
  scheduleRoomExpiry(fresh);
  void actorUserId;
  return roomPublic(fresh);
}

async function leaderboard(limit = 50) {
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, u.rank_name, u.profile_title,
            s.quiz_score, s.quiz_lifetime_score, s.quiz_correct_answers, s.quiz_wrong_attempts,
            s.quiz_questions_attempted, s.quiz_fastest_answer_ms, s.quiz_current_streak, s.quiz_best_streak,
            s.quiz_tournaments_won, s.quiz_matches_won
     FROM quiz_user_stats s JOIN users u ON u.id = s.user_id
     WHERE u.rank_name NOT IN ('bot','developer') AND (u.banned_until IS NULL OR u.banned_until < UTC_TIMESTAMP()) AND u.delete_requested_at IS NULL
     ORDER BY s.quiz_score DESC, s.quiz_correct_answers DESC, s.quiz_best_streak DESC, s.quiz_fastest_answer_ms ASC, u.username ASC
     LIMIT ?`, [Math.max(1, Math.min(50, Number(limit || 50)))]
  );
  return rows.map((row, index) => ({ ...row, leaderboardRank: index + 1, contestEligible: index < 8 }));
}

async function stats(userId) {
  const [[row]] = await pool.query("SELECT * FROM quiz_user_stats WHERE user_id = ?", [userId]);
  const value = row || { user_id: Number(userId), quiz_score: 0, quiz_lifetime_score: 0, quiz_correct_answers: 0, quiz_wrong_attempts: 0, quiz_questions_attempted: 0, quiz_fastest_answer_ms: null, quiz_current_streak: 0, quiz_best_streak: 0, quiz_tournaments_played: 0, quiz_tournaments_won: 0, quiz_matches_won: 0 };
  const attempts = Number(value.quiz_questions_attempted || 0);
  return { ...value, quiz_accuracy: attempts ? Math.round(Number(value.quiz_correct_answers || 0) / attempts * 1000) / 10 : 0 };
}

async function latestTournament() {
  const [[row]] = await pool.query("SELECT * FROM quiz_tournaments ORDER BY id DESC LIMIT 1"); return row || null;
}

async function tournamentRows(tournamentId) {
  const [players] = await pool.query(
    `SELECT p.*, u.username, u.display_name, u.avatar_url, u.rank_name, p.score_at_lock AS quiz_score
     FROM quiz_tournament_players p JOIN users u ON u.id = p.user_id
     WHERE p.tournament_id = ? ORDER BY p.seed_number`, [tournamentId]
  );
  const [matches] = await pool.query(
    `SELECT m.*, p1.username AS player_one_name, p1.avatar_url AS player_one_avatar,
            p2.username AS player_two_name, p2.avatar_url AS player_two_avatar, w.username AS winner_name
     FROM quiz_tournament_matches m
     LEFT JOIN users p1 ON p1.id = m.player_one_id LEFT JOIN users p2 ON p2.id = m.player_two_id LEFT JOIN users w ON w.id = m.winner_id
     WHERE m.tournament_id = ? ORDER BY m.round_number, m.match_number`, [tournamentId]
  );
  return { players, matches };
}

function safeMatchRow(row) {
  return {
    id: Number(row.id), roundNumber: Number(row.round_number), matchNumber: Number(row.match_number), status: row.status,
    playerOne: row.player_one_id ? { id: Number(row.player_one_id), username: row.player_one_name, avatarUrl: row.player_one_avatar, score: Number(row.player_one_score || 0) } : null,
    playerTwo: row.player_two_id ? { id: Number(row.player_two_id), username: row.player_two_name, avatarUrl: row.player_two_avatar, score: Number(row.player_two_score || 0) } : null,
    winnerId: row.winner_id ? Number(row.winner_id) : null, winnerName: row.winner_name || null,
    questionIndex: Number(row.question_index || 0), questionStartedAt: row.question_started_at, questionExpiresAt: row.question_expires_at,
    joinDeadlineAt: row.join_deadline_at, suddenDeathIndex: Number(row.sudden_death_index || 0),
  };
}

async function contestState(user = null) {
  const tournament = await latestTournament();
  if (!tournament) return { tournament: null, canStart: user?.rank_name === "developer", serverNow: nowIso() };
  const { players, matches } = await tournamentRows(tournament.id);
  const player = user ? players.find((item) => Number(item.user_id) === Number(user.id)) : null;
  const playerMatch = player ? matches.find((item) => ["waiting", "active", "between_questions", "paused"].includes(item.status) && (Number(item.player_one_id) === Number(user.id) || Number(item.player_two_id) === Number(user.id))) : null;
  return {
    tournament: { id: Number(tournament.id), status: tournament.status, currentRound: Number(tournament.current_round || 0), championId: tournament.champion_id ? Number(tournament.champion_id) : null, championName: players.find((item) => Number(item.user_id) === Number(tournament.champion_id))?.username || null, createdAt: tournament.created_at, startedAt: tournament.started_at, finishedAt: tournament.finished_at },
    players: players.map((item) => ({ userId: Number(item.user_id), seed: Number(item.seed_number), username: item.username, displayName: item.display_name, avatarUrl: item.avatar_url, quizScore: Number(item.quiz_score || 0), joined: Boolean(item.joined_at), disqualified: Boolean(item.disqualified), eliminatedRound: item.eliminated_round })),
    matches: matches.map(safeMatchRow),
    invitation: player ? { qualified: true, seed: Number(player.seed_number), joined: Boolean(player.joined_at), matchId: playerMatch ? Number(playerMatch.id) : null, opponent: playerMatch ? (Number(playerMatch.player_one_id) === Number(user.id) ? playerMatch.player_two_name : playerMatch.player_one_name) : null } : { qualified: false },
    canStart: user?.rank_name === "developer", serverNow: nowIso(),
  };
}

async function contestEvent(tournamentId, type, actorUserId = null, details = {}) {
  await pool.query("INSERT INTO quiz_tournament_events (tournament_id, event_type, actor_user_id, details_json) VALUES (?, ?, ?, ?)", [tournamentId, type, actorUserId, JSON.stringify(details)]);
}

async function notifyContest(event, payload = {}) {
  emitSocketRoom("quiz:contest", event, { ...payload, serverNow: nowIso() });
  emitSocketRoom("quiz:contest", "contest:state_changed", { event, ...payload, serverNow: nowIso() });
}

async function prepareContest(actorUserId) {
  const top = await leaderboard(8);
  if (top.length < 8) throw fail("At least 8 eligible quiz players are required.", 409, "QUIZ_TOP_EIGHT_REQUIRED");
  const connection = await pool.getConnection();
  let tournamentId;
  try {
    await connection.beginTransaction();
    const [[active]] = await connection.query("SELECT id FROM quiz_tournaments WHERE status NOT IN ('completed','cancelled') ORDER BY id DESC LIMIT 1 FOR UPDATE");
    if (active) throw fail("A Quiz Contest is already prepared or active.", 409, "CONTEST_EXISTS");
    const [result] = await connection.query("INSERT INTO quiz_tournaments (status, current_round, created_by) VALUES ('waiting_for_players', 0, ?)", [actorUserId]);
    tournamentId = result.insertId;
    for (let index = 0; index < top.length; index += 1) await connection.query("INSERT INTO quiz_tournament_players (tournament_id, user_id, seed_number, score_at_lock) VALUES (?, ?, ?, ?)", [tournamentId, top[index].id, index + 1, Number(top[index].quiz_score || 0)]);
    const ids = Object.fromEntries(top.map((item, index) => [index + 1, Number(item.id)]));
    for (const [matchNumber, [a, b]] of [[1, [1, 8]], [2, [4, 5]], [3, [2, 7]], [4, [3, 6]]]) {
      await connection.query("INSERT INTO quiz_tournament_matches (tournament_id, round_number, match_number, player_one_id, player_two_id, status) VALUES (?, 1, ?, ?, ?, 'pending')", [tournamentId, matchNumber, ids[a], ids[b]]);
    }
    await connection.commit();
  } catch (error) { await connection.rollback().catch(() => {}); throw error; }
  finally { connection.release(); }
  await contestEvent(tournamentId, "prepared", actorUserId, { seeds: top.map((item) => item.id) });
  for (const item of top) notifySocketUser(item.id, "contest:qualified", { tournamentId, seed: item.leaderboardRank });
  await notifyContest("contest:prepared", { tournamentId });
  return contestState({ id: actorUserId, rank_name: "developer" });
}

async function lockContest(tournamentId, actorUserId) {
  const [result] = await pool.query("UPDATE quiz_tournaments SET status = 'locked', roster_locked_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'waiting_for_players'", [tournamentId]);
  if (!result.affectedRows) throw fail("Contest cannot be locked in its current state.", 409, "CONTEST_STATE");
  await contestEvent(tournamentId, "participants_locked", actorUserId);
  await notifyContest("contest:participants_locked", { tournamentId: Number(tournamentId) });
  return contestState({ id: actorUserId, rank_name: "developer" });
}

async function joinContest(user) {
  const tournament = await latestTournament();
  if (!tournament || ["completed", "cancelled"].includes(tournament.status)) throw fail("There is no open Quiz Contest invitation.", 404, "CONTEST_NOT_OPEN");
  const [result] = await pool.query("UPDATE quiz_tournament_players SET joined_at = COALESCE(joined_at, UTC_TIMESTAMP()) WHERE tournament_id = ? AND user_id = ? AND disqualified = 0", [tournament.id, user.id]);
  if (!result.affectedRows) throw fail("You are not in this contest's locked top eight.", 403, "CONTEST_NOT_QUALIFIED");
  const [[match]] = await pool.query("SELECT * FROM quiz_tournament_matches WHERE tournament_id = ? AND (player_one_id = ? OR player_two_id = ?) AND status = 'waiting' LIMIT 1", [tournament.id, user.id, user.id]);
  if (match && await bothPlayersJoined(match)) await startMatch(match.id);
  await contestEvent(tournament.id, "player_joined", user.id);
  notifySocketUser(user.id, "contest:joined", { tournamentId: Number(tournament.id), matchId: match?.id || null });
  await notifyContest("contest:player_joined", { tournamentId: Number(tournament.id), userId: Number(user.id) });
  return contestState(user);
}

async function bothPlayersJoined(match) {
  const [[row]] = await pool.query("SELECT COUNT(*) AS count FROM quiz_tournament_players WHERE tournament_id = ? AND user_id IN (?, ?) AND joined_at IS NOT NULL AND disqualified = 0", [match.tournament_id, match.player_one_id, match.player_two_id]);
  return Number(row.count) === 2;
}

function clearMatchTimer(matchId) { clearTimeout(matchTimers.get(Number(matchId))); matchTimers.delete(Number(matchId)); }
function setMatchTimer(matchId, callback, delay) {
  clearMatchTimer(matchId); const timer = setTimeout(callback, Math.max(10, delay)); timer.unref?.(); matchTimers.set(Number(matchId), timer);
}

async function startTournament(tournamentId, actorUserId) {
  const [result] = await pool.query("UPDATE quiz_tournaments SET status = 'quarterfinals_active', current_round = 1, started_at = COALESCE(started_at, UTC_TIMESTAMP()) WHERE id = ? AND status = 'locked'", [tournamentId]);
  if (!result.affectedRows) throw fail("Lock participants before starting the tournament.", 409, "CONTEST_NOT_LOCKED");
  await pool.query("UPDATE quiz_user_stats s JOIN quiz_tournament_players p ON p.user_id = s.user_id SET s.quiz_tournaments_played = s.quiz_tournaments_played + 1 WHERE p.tournament_id = ?", [tournamentId]);
  const [matches] = await pool.query("SELECT * FROM quiz_tournament_matches WHERE tournament_id = ? AND round_number = 1", [tournamentId]);
  for (const match of matches) await openMatch(match);
  await contestEvent(tournamentId, "round_started", actorUserId, { round: 1 });
  await botMessage({ type: "contest", headline: "Quiz Contest started", detail: "The top-eight quarterfinals are now live. Open Games to watch the bracket." });
  await notifyContest("contest:round_started", { tournamentId: Number(tournamentId), round: 1 });
  return contestState({ id: actorUserId, rank_name: "developer" });
}

async function openMatch(match) {
  const deadline = new Date(Date.now() + JOIN_GRACE_MS);
  await pool.query("UPDATE quiz_tournament_matches SET status = 'waiting', join_deadline_at = ? WHERE id = ? AND status = 'pending'", [deadline, match.id]);
  const [[fresh]] = await pool.query("SELECT * FROM quiz_tournament_matches WHERE id = ?", [match.id]);
  if (await bothPlayersJoined(fresh)) return startMatch(fresh.id);
  setMatchTimer(fresh.id, () => resolveWalkover(fresh.id).catch((error) => console.error("[quiz walkover]", error.message)), ms(fresh.join_deadline_at) - Date.now());
  [fresh.player_one_id, fresh.player_two_id].filter(Boolean).forEach((userId) => notifySocketUser(userId, "contest:match_waiting", { matchId: Number(fresh.id), joinDeadlineAt: fresh.join_deadline_at }));
  return fresh;
}

async function resolveWalkover(matchId) {
  const [[match]] = await pool.query("SELECT * FROM quiz_tournament_matches WHERE id = ?", [matchId]);
  if (!match || match.status !== "waiting") return;
  const [players] = await pool.query("SELECT user_id, seed_number, joined_at, disqualified FROM quiz_tournament_players WHERE tournament_id = ? AND user_id IN (?, ?) ORDER BY disqualified ASC, seed_number ASC", [match.tournament_id, match.player_one_id, match.player_two_id]);
  const eligible = players.filter((item) => !item.disqualified);
  const joined = eligible.filter((item) => item.joined_at);
  if (joined.length === 2) return startMatch(match.id);
  const winnerId = Number(joined[0]?.user_id || eligible[0]?.user_id || match.player_one_id);
  await finishMatch(match, winnerId, "walkover");
}

async function startMatch(matchId) {
  clearMatchTimer(matchId);
  const [[match]] = await pool.query("SELECT * FROM quiz_tournament_matches WHERE id = ?", [matchId]);
  if (!match || !["waiting", "pending"].includes(match.status)) return match;
  const questions = generateContestSet(20);
  const startAt = new Date(Date.now() + 800); const expiresAt = new Date(startAt.getTime() + CONTEST_DURATION_MS);
  await pool.query(
    `UPDATE quiz_tournament_matches SET status = 'active', question_set_json = ?, question_index = 0,
       question_started_at = ?, question_expires_at = ?, started_at = COALESCE(started_at, UTC_TIMESTAMP()) WHERE id = ?`,
    [JSON.stringify(questions), startAt, expiresAt, match.id]
  );
  await contestEvent(match.tournament_id, "match_started", null, { matchId: Number(match.id), round: Number(match.round_number) });
  const safe = await matchState(match.id, null);
  emitSocketRoom(`quiz:match:${match.id}`, "contest:match_started", safe);
  await notifyContest("contest:match_started", { tournamentId: Number(match.tournament_id), matchId: Number(match.id) });
  setMatchTimer(match.id, () => finishContestQuestion(match.id, 0).catch((error) => console.error("[quiz contest question]", error.message)), expiresAt.getTime() - Date.now());
  return safe;
}

async function matchState(matchId, viewer = null) {
  const [[row]] = await pool.query(
    `SELECT m.*, p1.username AS player_one_name, p1.avatar_url AS player_one_avatar,
            p2.username AS player_two_name, p2.avatar_url AS player_two_avatar, w.username AS winner_name
     FROM quiz_tournament_matches m LEFT JOIN users p1 ON p1.id=m.player_one_id LEFT JOIN users p2 ON p2.id=m.player_two_id LEFT JOIN users w ON w.id=m.winner_id WHERE m.id = ?`, [matchId]
  );
  if (!row) throw fail("Contest match not found.", 404, "MATCH_NOT_FOUND");
  const questions = parseJson(row.question_set_json, []);
  const question = questions[Number(row.question_index || 0)] || null;
  const participant = viewer && [Number(row.player_one_id), Number(row.player_two_id)].includes(Number(viewer.id));
  let submitted = false; let myAnswer = null;
  if (participant && question) {
    const [[answer]] = await pool.query("SELECT option_index, points_awarded FROM quiz_tournament_answers WHERE match_id = ? AND question_index = ? AND user_id = ? LIMIT 1", [row.id, row.question_index, viewer.id]);
    submitted = Boolean(answer); myAnswer = answer ? { optionIndex: Number(answer.option_index), points: Number(answer.points_awarded) } : null;
  }
  const [lockRows] = question ? await pool.query("SELECT user_id FROM quiz_tournament_answers WHERE match_id = ? AND question_index = ?", [row.id, row.question_index]) : [[]];
  const base = safeMatchRow(row);
  return {
    ...base, tournamentId: Number(row.tournament_id), participant, viewerUserId: viewer ? Number(viewer.id) : null,
    question: question && ["active", "paused"].includes(row.status) ? publicQuestion(question, { number: Number(row.question_index) + 1, total: Math.max(20, questions.length) }) : null,
    answerLocked: submitted, myAnswer,
    lockedPlayers: lockRows.map((item) => Number(item.user_id)), serverNow: nowIso(),
    review: row.status === "complete" ? await matchReview(row, questions) : null,
  };
}

async function matchReview(row, questions) {
  const [answers] = await pool.query("SELECT question_index, user_id, option_index, correct, points_awarded FROM quiz_tournament_answers WHERE match_id = ? ORDER BY question_index, user_id", [row.id]);
  return questions.map((question, index) => ({ number: index + 1, question: question.question, options: question.options, correctOption: Number(question.correctOption), correctAnswer: question.answer, answers: answers.filter((item) => Number(item.question_index) === index).map((item) => ({ userId: Number(item.user_id), optionIndex: Number(item.option_index), correct: Boolean(item.correct), points: Number(item.points_awarded) })) }));
}

async function answerContestMatch(matchId, user, optionIndex) {
  const connection = await pool.getConnection();
  let match; let question; let points; let correct;
  try {
    await connection.beginTransaction();
    [[match]] = await connection.query("SELECT * FROM quiz_tournament_matches WHERE id = ? FOR UPDATE", [matchId]);
    if (!match || match.status !== "active") throw fail("This contest question is not accepting answers.", 409, "QUESTION_CLOSED");
    if (![Number(match.player_one_id), Number(match.player_two_id)].includes(Number(user.id))) throw fail("Spectators cannot answer contest questions.", 403, "SPECTATOR_READ_ONLY");
    if (Date.now() > ms(match.question_expires_at)) throw fail("This question has expired.", 409, "QUESTION_EXPIRED");
    const questions = parseJson(match.question_set_json, []); question = questions[Number(match.question_index)];
    const selected = Number(optionIndex);
    if (!question || !Number.isInteger(selected) || selected < 0 || selected >= question.options.length) throw fail("Choose one valid answer option.", 422, "OPTION_INVALID");
    const [[existing]] = await connection.query("SELECT id FROM quiz_tournament_answers WHERE match_id = ? AND question_index = ? AND user_id = ?", [match.id, match.question_index, user.id]);
    if (existing) throw fail("Your answer is already locked for this question.", 409, "ANSWER_ALREADY_LOCKED");
    const responseMs = Math.max(0, Date.now() - ms(match.question_started_at));
    correct = selected === Number(question.correctOption); points = correct ? contestPoints(responseMs) : -4;
    await connection.query("INSERT INTO quiz_tournament_answers (match_id, question_index, user_id, option_index, correct, response_ms, points_awarded) VALUES (?, ?, ?, ?, ?, ?, ?)", [match.id, match.question_index, user.id, selected, correct ? 1 : 0, responseMs, points]);
    const scoreColumn = Number(match.player_one_id) === Number(user.id) ? "player_one_score" : "player_two_score";
    await connection.query(`UPDATE quiz_tournament_matches SET ${scoreColumn} = ${scoreColumn} + ? WHERE id = ?`, [points, match.id]);
    await connection.commit();
  } catch (error) { await connection.rollback().catch(() => {}); throw error; }
  finally { connection.release(); }
  const payload = { matchId: Number(match.id), questionIndex: Number(match.question_index), userId: Number(user.id), points, correct, serverNow: nowIso() };
  notifySocketUser(user.id, "contest:answer_locked", payload);
  emitSocketRoom(`quiz:match:${match.id}`, "contest:score_updated", { matchId: Number(match.id), userId: Number(user.id), scores: (await matchState(match.id, null)), locked: true });
  const [[count]] = await pool.query("SELECT COUNT(*) AS count FROM quiz_tournament_answers WHERE match_id = ? AND question_index = ?", [match.id, match.question_index]);
  if (Number(count.count) >= 2) setMatchTimer(match.id, () => finishContestQuestion(match.id, Number(match.question_index)).catch((error) => console.error("[quiz contest close]", error.message)), 150);
  return { ok: true, answerLocked: true, points, correct };
}

async function finishContestQuestion(matchId, expectedIndex, { skipped = false } = {}) {
  clearMatchTimer(matchId);
  const connection = await pool.getConnection();
  let match; let questions; let question; let nextIndex; let shouldFinish = false; let winnerId = null;
  try {
    await connection.beginTransaction();
    [[match]] = await connection.query("SELECT * FROM quiz_tournament_matches WHERE id = ? FOR UPDATE", [matchId]);
    if (!match || match.status !== "active" || Number(match.question_index) !== Number(expectedIndex)) { await connection.rollback(); return false; }
    questions = parseJson(match.question_set_json, []); question = questions[Number(match.question_index)];
    nextIndex = Number(match.question_index) + 1;
    const reachedMainEnd = nextIndex >= 20;
    if (reachedMainEnd && Number(match.player_one_score) !== Number(match.player_two_score)) {
      shouldFinish = true; winnerId = Number(match.player_one_score) > Number(match.player_two_score) ? Number(match.player_one_id) : Number(match.player_two_id);
      await connection.query("UPDATE quiz_tournament_matches SET status = 'finishing' WHERE id = ?", [match.id]);
    } else {
      if (nextIndex >= questions.length) questions.push(generateContestSet(1, questions.map((item) => item.sourceKey))[0]);
      await connection.query("UPDATE quiz_tournament_matches SET status = 'between_questions', question_set_json = ?, question_index = ?, sudden_death_index = ? WHERE id = ?", [JSON.stringify(questions), nextIndex, Math.max(0, nextIndex - 19), match.id]);
    }
    await connection.commit();
  } catch (error) { await connection.rollback().catch(() => {}); throw error; }
  finally { connection.release(); }
  const [answers] = await pool.query("SELECT user_id, option_index, correct, points_awarded FROM quiz_tournament_answers WHERE match_id = ? AND question_index = ?", [match.id, expectedIndex]);
  emitSocketRoom(`quiz:match:${match.id}`, "contest:question_finished", { matchId: Number(match.id), questionIndex: Number(expectedIndex), correctOption: Number(question.correctOption), correctAnswer: question.answer, answers: answers.map((item) => ({ userId: Number(item.user_id), optionIndex: Number(item.option_index), correct: Boolean(item.correct), points: Number(item.points_awarded) })), skipped, serverNow: nowIso() });
  if (shouldFinish) return finishMatch(match, winnerId, "score");
  setMatchTimer(match.id, () => startNextContestQuestion(match.id, nextIndex).catch((error) => console.error("[quiz contest next]", error.message)), NEXT_DELAY_MS);
  return true;
}

async function startNextContestQuestion(matchId, expectedIndex) {
  const startAt = new Date(); const expiresAt = new Date(startAt.getTime() + CONTEST_DURATION_MS);
  const [result] = await pool.query("UPDATE quiz_tournament_matches SET status = 'active', question_started_at = ?, question_expires_at = ? WHERE id = ? AND status = 'between_questions' AND question_index = ?", [startAt, expiresAt, matchId, expectedIndex]);
  if (!result.affectedRows) return false;
  const state = await matchState(matchId, null);
  emitSocketRoom(`quiz:match:${matchId}`, "contest:question_started", state);
  setMatchTimer(matchId, () => finishContestQuestion(matchId, expectedIndex).catch((error) => console.error("[quiz contest expiry]", error.message)), CONTEST_DURATION_MS);
  return true;
}

async function finishMatch(matchInput, winnerId, reason) {
  clearMatchTimer(matchInput.id);
  const connection = await pool.getConnection();
  let match; let loserId;
  try {
    await connection.beginTransaction();
    [[match]] = await connection.query("SELECT * FROM quiz_tournament_matches WHERE id = ? FOR UPDATE", [matchInput.id]);
    if (!match || match.status === "complete" || match.status === "cancelled") {
      await connection.rollback();
      return false;
    }
    await connection.query("UPDATE quiz_tournament_matches SET status = 'complete', winner_id = ?, finished_at = UTC_TIMESTAMP() WHERE id = ?", [winnerId, match.id]);
    await connection.query("INSERT INTO quiz_user_stats (user_id, quiz_matches_won) VALUES (?, 1) ON DUPLICATE KEY UPDATE quiz_matches_won = quiz_matches_won + 1, quiz_updated_at = UTC_TIMESTAMP()", [winnerId]);
    loserId = Number(match.player_one_id) === Number(winnerId) ? Number(match.player_two_id) : Number(match.player_one_id);
    await connection.query("UPDATE quiz_tournament_players SET eliminated_round = ? WHERE tournament_id = ? AND user_id = ?", [match.round_number, match.tournament_id, loserId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
  await contestEvent(match.tournament_id, "match_finished", null, { matchId: Number(match.id), winnerId, reason });
  const completedState = await matchState(match.id, null);
  emitSocketRoom(`quiz:match:${match.id}`, "contest:match_finished", completedState);
  await botMessage({ type: "contest", headline: `${completedState.winnerName || "A player"} advances`, detail: `Round ${Number(match.round_number)}, Match ${Number(match.match_number)} finished ${Number(match.player_one_score || 0)} - ${Number(match.player_two_score || 0)}${reason === "walkover" ? " by walkover" : ""}.` });
  await notifyContest("contest:match_finished", { tournamentId: Number(match.tournament_id), matchId: Number(match.id), winnerId });
  const [[remaining]] = await pool.query("SELECT COUNT(*) AS count FROM quiz_tournament_matches WHERE tournament_id = ? AND round_number = ? AND status <> 'complete'", [match.tournament_id, match.round_number]);
  if (Number(remaining.count) > 0) return true;
  if (Number(match.round_number) === 3) {
    await pool.query("UPDATE quiz_tournaments SET status = 'completed', champion_id = ?, finished_at = UTC_TIMESTAMP() WHERE id = ?", [winnerId, match.tournament_id]);
    await pool.query("INSERT INTO quiz_user_stats (user_id, quiz_tournaments_won) VALUES (?, 1) ON DUPLICATE KEY UPDATE quiz_tournaments_won = quiz_tournaments_won + 1, quiz_updated_at = UTC_TIMESTAMP()", [winnerId]);
    await botMessage({ type: "contest", headline: `${completedState.winnerName || "The winner"} is Quiz Champion`, detail: "The official Quiz Contest is complete. Final results are available in Games." });
    await contestEvent(match.tournament_id, "tournament_finished", null, { championId: winnerId });
    await notifyContest("contest:tournament_finished", { tournamentId: Number(match.tournament_id), championId: winnerId });
    return true;
  }
  const completeStatus = Number(match.round_number) === 1 ? "quarterfinals_complete" : "semifinals_complete";
  await pool.query("UPDATE quiz_tournaments SET status = ? WHERE id = ?", [completeStatus, match.tournament_id]);
  await notifyContest("contest:round_finished", { tournamentId: Number(match.tournament_id), round: Number(match.round_number) });
  return true;
}

async function startNextRound(tournamentId, actorUserId) {
  const [[tournament]] = await pool.query("SELECT * FROM quiz_tournaments WHERE id = ?", [tournamentId]);
  if (!tournament || !["quarterfinals_complete", "semifinals_complete"].includes(tournament.status)) throw fail("The current round is not complete.", 409, "ROUND_NOT_COMPLETE");
  const fromRound = Number(tournament.current_round); const nextRound = fromRound + 1;
  const [winners] = await pool.query("SELECT winner_id FROM quiz_tournament_matches WHERE tournament_id = ? AND round_number = ? ORDER BY match_number", [tournamentId, fromRound]);
  if (winners.some((item) => !item.winner_id) || (nextRound === 2 && winners.length !== 4) || (nextRound === 3 && winners.length !== 2)) throw fail("Winners are not ready for the next round.", 409, "WINNERS_NOT_READY");
  const pairs = nextRound === 2 ? [[winners[0].winner_id, winners[1].winner_id], [winners[2].winner_id, winners[3].winner_id]] : [[winners[0].winner_id, winners[1].winner_id]];
  const status = nextRound === 2 ? "semifinals_active" : "final_active";
  await pool.query("UPDATE quiz_tournaments SET status = ?, current_round = ? WHERE id = ?", [status, nextRound, tournamentId]);
  const ids = [];
  for (let index = 0; index < pairs.length; index += 1) {
    const [result] = await pool.query("INSERT INTO quiz_tournament_matches (tournament_id, round_number, match_number, player_one_id, player_two_id, status) VALUES (?, ?, ?, ?, ?, 'pending')", [tournamentId, nextRound, index + 1, pairs[index][0], pairs[index][1]]); ids.push(result.insertId);
  }
  for (const id of ids) { const [[match]] = await pool.query("SELECT * FROM quiz_tournament_matches WHERE id = ?", [id]); await openMatch(match); }
  await contestEvent(tournamentId, "round_started", actorUserId, { round: nextRound });
  await notifyContest("contest:round_started", { tournamentId: Number(tournamentId), round: nextRound });
  return contestState({ id: actorUserId, rank_name: "developer" });
}

async function pauseContest(tournamentId, actorUserId) {
  const [[tournament]] = await pool.query("SELECT * FROM quiz_tournaments WHERE id = ?", [tournamentId]);
  if (!tournament || !String(tournament.status).endsWith("_active")) throw fail("Only an active contest can be paused.", 409, "CONTEST_NOT_ACTIVE");
  const [matches] = await pool.query("SELECT * FROM quiz_tournament_matches WHERE tournament_id = ? AND status = 'active'", [tournamentId]);
  for (const match of matches) {
    clearMatchTimer(match.id);
    await pool.query("UPDATE quiz_tournament_matches SET status = 'paused', pause_remaining_ms = GREATEST(0, TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(), question_expires_at) DIV 1000) WHERE id = ?", [match.id]);
  }
  await pool.query("UPDATE quiz_tournaments SET previous_status = status, status = 'paused', paused_at = UTC_TIMESTAMP() WHERE id = ?", [tournamentId]);
  await contestEvent(tournamentId, "paused", actorUserId);
  await notifyContest("contest:paused", { tournamentId: Number(tournamentId) });
  return contestState({ id: actorUserId, rank_name: "developer" });
}

async function resumeContest(tournamentId, actorUserId) {
  const [[tournament]] = await pool.query("SELECT * FROM quiz_tournaments WHERE id = ? AND status = 'paused'", [tournamentId]);
  if (!tournament) throw fail("This contest is not paused.", 409, "CONTEST_NOT_PAUSED");
  await pool.query("UPDATE quiz_tournaments SET status = previous_status, previous_status = NULL, paused_at = NULL WHERE id = ?", [tournamentId]);
  const [matches] = await pool.query("SELECT * FROM quiz_tournament_matches WHERE tournament_id = ? AND status = 'paused'", [tournamentId]);
  for (const match of matches) {
    const remaining = Math.max(1000, Number(match.pause_remaining_ms || CONTEST_DURATION_MS));
    const expires = new Date(Date.now() + remaining);
    const started = new Date(Date.now() - Math.max(0, CONTEST_DURATION_MS - remaining));
    await pool.query("UPDATE quiz_tournament_matches SET status = 'active', question_started_at = ?, question_expires_at = ?, pause_remaining_ms = NULL WHERE id = ?", [started, expires, match.id]);
    setMatchTimer(match.id, () => finishContestQuestion(match.id, Number(match.question_index)).catch((error) => console.error("[quiz resume expiry]", error.message)), remaining);
  }
  await contestEvent(tournamentId, "resumed", actorUserId);
  await notifyContest("contest:resumed", { tournamentId: Number(tournamentId) });
  return contestState({ id: actorUserId, rank_name: "developer" });
}

async function cancelContest(tournamentId, actorUserId) {
  const [matches] = await pool.query("SELECT id FROM quiz_tournament_matches WHERE tournament_id = ? AND status NOT IN ('complete','cancelled')", [tournamentId]);
  matches.forEach((item) => clearMatchTimer(item.id));
  await pool.query("UPDATE quiz_tournaments SET status = 'cancelled', finished_at = UTC_TIMESTAMP() WHERE id = ? AND status NOT IN ('completed','cancelled')", [tournamentId]);
  await pool.query("UPDATE quiz_tournament_matches SET status = 'cancelled', finished_at = UTC_TIMESTAMP() WHERE tournament_id = ? AND status <> 'complete'", [tournamentId]);
  await contestEvent(tournamentId, "cancelled", actorUserId);
  await notifyContest("contest:cancelled", { tournamentId: Number(tournamentId) });
  return contestState({ id: actorUserId, rank_name: "developer" });
}

async function resetContest(tournamentId, actorUserId) {
  await cancelContest(tournamentId, actorUserId).catch(() => {});
  await contestEvent(tournamentId, "reset", actorUserId);
  return { ok: true };
}

async function disqualifyPlayer(tournamentId, userId, actorUserId) {
  const [result] = await pool.query("UPDATE quiz_tournament_players SET disqualified = 1 WHERE tournament_id = ? AND user_id = ?", [tournamentId, userId]);
  if (!result.affectedRows) throw fail("Contest player not found.", 404, "PLAYER_NOT_FOUND");
  const [[match]] = await pool.query("SELECT * FROM quiz_tournament_matches WHERE tournament_id = ? AND (player_one_id = ? OR player_two_id = ?) AND status IN ('waiting','active','between_questions','paused') ORDER BY id DESC LIMIT 1", [tournamentId, userId, userId]);
  if (match) {
    const winnerId = Number(match.player_one_id) === Number(userId) ? Number(match.player_two_id) : Number(match.player_one_id);
    await finishMatch(match, winnerId, "disqualification");
  }
  await contestEvent(tournamentId, "player_disqualified", actorUserId, { userId: Number(userId) });
  await notifyContest("contest:player_disqualified", { tournamentId: Number(tournamentId), userId: Number(userId) });
  return contestState({ id: actorUserId, rank_name: "developer" });
}

async function replacePlayer(tournamentId, oldUserId, newUserId, actorUserId) {
  const [[tournament]] = await pool.query("SELECT status FROM quiz_tournaments WHERE id = ?", [tournamentId]);
  if (!tournament || !["waiting_for_players", "locked"].includes(tournament.status)) throw fail("Players can only be replaced before the tournament starts.", 409, "ROSTER_LOCKED");
  const [[replacement]] = await pool.query("SELECT u.id FROM users u JOIN quiz_user_stats s ON s.user_id=u.id WHERE u.id=? AND u.rank_name NOT IN ('bot','developer') AND (u.banned_until IS NULL OR u.banned_until < UTC_TIMESTAMP())", [newUserId]);
  if (!replacement) throw fail("Replacement must be an eligible quiz player.", 422, "REPLACEMENT_INELIGIBLE");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[player]] = await connection.query("SELECT * FROM quiz_tournament_players WHERE tournament_id=? AND user_id=? FOR UPDATE", [tournamentId, oldUserId]);
    if (!player) throw fail("Original contest player not found.", 404, "PLAYER_NOT_FOUND");
    await connection.query("UPDATE quiz_tournament_players SET user_id=?, joined_at=NULL, disqualified=0 WHERE id=?", [newUserId, player.id]);
    await connection.query("UPDATE quiz_tournament_matches SET player_one_id = IF(player_one_id=?, ?, player_one_id), player_two_id = IF(player_two_id=?, ?, player_two_id) WHERE tournament_id=?", [oldUserId, newUserId, oldUserId, newUserId, tournamentId]);
    await connection.commit();
  } catch (error) { await connection.rollback().catch(() => {}); throw error; }
  finally { connection.release(); }
  await contestEvent(tournamentId, "player_replaced", actorUserId, { oldUserId: Number(oldUserId), newUserId: Number(newUserId) });
  await notifyContest("contest:player_replaced", { tournamentId: Number(tournamentId) });
  return contestState({ id: actorUserId, rank_name: "developer" });
}

async function skipContestQuestion(matchId, actorUserId) {
  const [[match]] = await pool.query("SELECT * FROM quiz_tournament_matches WHERE id = ?", [matchId]);
  if (!match || match.status !== "active") throw fail("No active contest question to skip.", 409, "QUESTION_NOT_ACTIVE");
  await contestEvent(match.tournament_id, "question_skipped", actorUserId, { matchId: Number(matchId), questionIndex: Number(match.question_index) });
  await finishContestQuestion(match.id, Number(match.question_index), { skipped: true });
  return { ok: true };
}

async function contestLogs(tournamentId) {
  const [rows] = await pool.query("SELECT e.*, u.username AS actor_name FROM quiz_tournament_events e LEFT JOIN users u ON u.id=e.actor_user_id WHERE e.tournament_id=? ORDER BY e.id DESC LIMIT 100", [tournamentId]);
  return rows;
}

async function initialize() {
  const [[room]] = await pool.query("SELECT id FROM rooms WHERE LOWER(name)='quiz room' LIMIT 1");
  const [[bot]] = await pool.query("SELECT id, username, avatar_url FROM users WHERE LOWER(username)='quiz bot' LIMIT 1");
  quizRoomId = Number(room?.id || 0); quizBot = bot || null; initialized = Boolean(quizRoomId && quizBot);
  if (!initialized) throw new Error("Quiz Room or Quiz Bot seed is missing.");
  const active = await activeRoomQuestion();
  if (active?.status === "paused") {
    clearRoomTimers();
  } else if (active && ms(active.expires_at) > Date.now()) scheduleRoomExpiry(active);
  else {
    if (active) await expireRoomQuestion(active.id);
    else await startRoomQuestion();
  }
  const [matches] = await pool.query("SELECT * FROM quiz_tournament_matches WHERE status IN ('waiting','active','between_questions','paused')");
  for (const match of matches) {
    if (match.status === "waiting") setMatchTimer(match.id, () => resolveWalkover(match.id).catch(() => {}), Math.max(10, ms(match.join_deadline_at) - Date.now()));
    if (match.status === "active") setMatchTimer(match.id, () => finishContestQuestion(match.id, Number(match.question_index)).catch(() => {}), Math.max(10, ms(match.question_expires_at) - Date.now()));
    if (match.status === "between_questions") setMatchTimer(match.id, () => startNextContestQuestion(match.id, Number(match.question_index)).catch(() => {}), 1000);
  }
  const syncTimer = setInterval(async () => {
    if (!initialized) return;
    const state = await roomState().catch(() => null);
    if (state) emitSocketRoom(`quiz:room:${quizRoomId}`, "quiz:timer_sync", { serverNow: nowIso(), expiresAt: state.expiresAt, maximumPoints: state.maximumPoints, sessionId: state.sessionId });
    for (const matchId of matchTimers.keys()) emitSocketRoom(`quiz:match:${matchId}`, "contest:timer_sync", { matchId: Number(matchId), serverNow: nowIso() });
  }, 5000);
  syncTimer.unref?.();
}

function getQuizRoomId() { return Number(quizRoomId || 0); }

module.exports = {
  QUIZ_PREFIX, ROOM_DURATION_MS, NEXT_DELAY_MS, roomPoints, contestPoints, getQuizRoomId,
  initialize, roomState, handleRoomMessage, submitRoomMessage, leaderboard, stats, contestState, matchState,
  prepareContest, lockContest, joinContest, startTournament, startNextRound, answerContestMatch,
  pauseContest, resumeContest, cancelContest, resetContest, disqualifyPlayer, replacePlayer,
  expireRoomQuestion, pauseRoomQuestion, resumeRoomQuestion, skipContestQuestion, contestLogs,
};
