const crypto = require("crypto");
const pool = require("../database");
const { notifySocketUser, broadcast } = require("./events");
const { invalidateUserCache } = require("../middleware/auth");

const matches = new Map();
const phaseTimers = new Map();
const persistTimers = new Map();
const reconnectTimers = new Map();
const joinAttempts = new Map();

const MIN_PLAYERS = 6;
const MAX_PLAYERS = 10;
const RECONNECT_MS = 75000;
const LOBBY_MAX_AGE_MS = 30 * 60 * 1000;
const ACTIVE_MAX_AGE_MS = 90 * 60 * 1000;
const PRESETS = new Set([
  "I was in Security.", "I completed a task.", "I saw someone nearby.", "I found the body.",
  "I suspect this player.", "I was with this player.", "Skip the vote.", "That statement is false.",
]);

const MAP = {
  id: "blackout-station",
  name: "Blackout Station",
  rooms: {
    "Central Hall": ["Security", "Medical Bay", "Cafeteria", "Storage"],
    Security: ["Central Hall", "Communications", "Observation Deck"],
    "Medical Bay": ["Central Hall", "Reactor", "Observation Deck"],
    Cafeteria: ["Central Hall", "Communications", "Storage"],
    Storage: ["Central Hall", "Cafeteria", "Power Room", "Maintenance"],
    Communications: ["Security", "Cafeteria", "Power Room"],
    Reactor: ["Medical Bay", "Power Room", "Maintenance"],
    "Power Room": ["Storage", "Communications", "Reactor"],
    "Observation Deck": ["Security", "Medical Bay", "Maintenance"],
    Maintenance: ["Storage", "Reactor", "Observation Deck"],
  },
};

const TASK_TEMPLATES = [
  { type: "frequency", title: "Frequency Alignment", room: "Communications" },
  { type: "power", title: "Power Routing", room: "Power Room" },
  { type: "memory", title: "Memory Terminal", room: "Security" },
  { type: "scan", title: "Identity Scan", room: "Medical Bay" },
  { type: "circuit", title: "Circuit Match", room: "Reactor" },
];

const ROLE_INFO = {
  Citizen: { faction: "Residents", objective: "Complete tasks, gather facts, and eliminate every Shadow.", ability: "No special power." },
  Investigator: { faction: "Residents", objective: "Inspect suspicious players and share careful clues.", ability: "Inspect one living player each round." },
  Medic: { faction: "Residents", objective: "Keep key Residents alive while completing tasks.", ability: "Protect one player for the action phase." },
  Infiltrator: { faction: "Shadows", objective: "Eliminate Residents or let a critical sabotage expire.", ability: "Eliminate, sabotage, and deceive." },
  Mimic: { faction: "Shadows", objective: "Confuse sightings and help the Shadows reach parity.", ability: "Temporarily copy a nearby player's appearance." },
};

function fail(message, status = 400, code = "SUS_ERROR") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function nowIso() { return new Date().toISOString(); }
function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
function shuffled(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = crypto.randomInt(index + 1);
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}
function lobbyCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 5 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
}
function playerIn(match, userId) { return match.players.find((player) => Number(player.userId) === Number(userId)); }
function living(match) { return match.players.filter((player) => player.alive); }
function activeMatchFor(userId) {
  return [...matches.values()].find((match) => !["ended", "abandoned"].includes(match.status) && playerIn(match, userId));
}

function settingsFrom(input = {}) {
  const maxPlayers = clamp(input.maxPlayers, MIN_PLAYERS, MAX_PLAYERS, 10);
  return {
    maxPlayers,
    numberOfShadows: clamp(input.numberOfShadows, 1, Math.max(1, Math.floor(maxPlayers / 3)), 2),
    discussionDuration: clamp(input.discussionDuration, 30, 120, 60),
    votingDuration: clamp(input.votingDuration, 20, 90, 45),
    taskCount: clamp(input.taskCount, 3, 5, 3),
    roleRevealOnElimination: Boolean(input.roleRevealOnElimination),
    anonymousVoting: input.anonymousVoting !== false,
    movementSpeed: clamp(input.movementSpeed, 2, 4, 3),
    emergencyMeetingLimit: clamp(input.emergencyMeetingLimit, 0, 2, 1),
  };
}

function makePlayer(user) {
  return {
    userId: Number(user.id), username: user.username, displayName: user.display_name || user.username,
    avatar: user.avatar_url || `/assets/avatar-${user.gender || "other"}.svg`, frame: user.frame || "clean",
    rank: user.rank_name || "user", profileTitle: user.profile_title || "", usernameColor: user.username_color || "",
    ready: false, connected: true, alive: true, role: null, faction: null, currentRoom: "Central Hall",
    previousRoom: null, movingTo: null, movingUntil: null, tasks: [], abilityCooldowns: {},
    emergencyMeetingsLeft: 1, protected: false, lastProtectedUserId: null, silencedUntil: null,
    disguisedAs: null, disguiseUntil: null, evidenceInventory: [], joinedAt: nowIso(), disconnectedAt: null,
    rewardEligible: true, meaningfulActions: 0, lastActionAt: nowIso(), afkWarned: false,
    lastChatAt: 0, investigatedRound: 0, voted: false,
  };
}

function baseMatch(user, input = {}) {
  const visibility = input.visibility === "private" ? "private" : "public";
  const match = {
    id: crypto.randomUUID(), lobbyCode: lobbyCode(), hostUserId: Number(user.id), visibility,
    status: "lobby", settings: settingsFrom(input.settings), mapId: MAP.id, createdAt: nowIso(),
    startedAt: null, endedAt: null, currentRound: 0, currentPhase: "lobby", phaseEndsAt: null,
    players: [makePlayer(user)], tasks: [], bodies: [], sabotages: [], evidence: [], votes: {},
    chatMessages: [], eventLog: [{ id: crypto.randomUUID(), type: "lobby", text: `${user.username} opened the lobby.`, at: nowIso() }],
    winner: null, voteResult: null, reportedBody: null, lastMeetingAt: null, lastActivityAt: nowIso(),
  };
  match.players[0].emergencyMeetingsLeft = match.settings.emergencyMeetingLimit;
  return match;
}

function taskChallenge(type) {
  if (type === "frequency") return { target: crypto.randomInt(2, 9) };
  if (type === "power") return { sequence: shuffled([1, 2, 3, 4]).slice(0, 3) };
  if (type === "memory") return { sequence: Array.from({ length: 4 }, () => crypto.randomInt(1, 5)) };
  if (type === "scan") return { holdMs: 1800 };
  return { pairs: shuffled(["A", "B", "C"]) };
}

function assignTasks(match, player) {
  player.tasks = shuffled(TASK_TEMPLATES).slice(0, match.settings.taskCount).map((template) => ({
    id: crypto.randomUUID(), ...template, complete: false, startedAt: null, challenge: taskChallenge(template.type),
    real: player.faction === "Residents",
  }));
}

function addEvent(match, type, text, extra = {}) {
  match.eventLog.push({ id: crypto.randomUUID(), type, text, at: nowIso(), ...extra });
  match.eventLog = match.eventLog.slice(-40);
}

function taskProgress(match) {
  const realTasks = match.players.flatMap((player) => player.tasks || []).filter((task) => task.real);
  return { completed: realTasks.filter((task) => task.complete).length, total: realTasks.length };
}

function visibleChat(match, viewer) {
  return match.chatMessages.filter((message) => {
    if (message.channel === "discussion") return viewer.alive;
    if (message.channel === "dead") return !viewer.alive;
    return message.channel === `room:${viewer.currentRoom}`;
  }).slice(-30);
}

function appearanceFor(match, player, viewer) {
  const disguiseActive = player.disguisedAs && player.disguiseUntil && new Date(player.disguiseUntil).getTime() > Date.now();
  if (!disguiseActive || viewer.faction === "Shadows" || match.currentPhase !== "action") return null;
  const copied = playerIn(match, player.disguisedAs);
  if (!copied) return null;
  return { username: copied.username, displayName: copied.displayName, avatar: copied.avatar, frame: copied.frame, usernameColor: copied.usernameColor };
}

function publicState(match, viewerId) {
  const viewer = playerIn(match, viewerId);
  if (!viewer) return null;
  const ended = match.status === "ended";
  const progress = taskProgress(match);
  return {
    id: match.id, lobbyCode: match.lobbyCode, hostUserId: match.hostUserId, visibility: match.visibility,
    status: match.status, settings: match.settings, map: MAP, currentRound: match.currentRound,
    currentPhase: match.currentPhase, phaseEndsAt: match.phaseEndsAt, startedAt: match.startedAt,
    winner: match.winner, voteResult: match.voteResult, taskProgress: progress,
    sabotage: match.sabotages.find((item) => item.active) || null,
    reportedBody: match.reportedBody, viewerUserId: Number(viewerId),
    players: match.players.map((player) => {
      const mayKnowRole = ended || Number(player.userId) === Number(viewerId)
        || (viewer.faction === "Shadows" && player.faction === "Shadows")
        || (!player.alive && match.settings.roleRevealOnElimination);
      const mayKnowLocation = ended || match.currentPhase === "lobby"
        || Number(player.userId) === Number(viewerId)
        || (match.currentPhase === "action" && player.currentRoom === viewer.currentRoom);
      return {
        userId: player.userId, username: player.username, displayName: player.displayName, avatar: player.avatar,
        frame: player.frame, rank: player.rank, profileTitle: player.profileTitle, usernameColor: player.usernameColor,
        ready: player.ready, connected: player.connected, alive: player.alive,
        currentRoom: mayKnowLocation ? player.currentRoom : null,
        movingTo: Number(player.userId) === Number(viewerId) ? player.movingTo : null,
        movingUntil: Number(player.userId) === Number(viewerId) ? player.movingUntil : null,
        emergencyMeetingsLeft: Number(player.userId) === Number(viewerId) ? player.emergencyMeetingsLeft : null,
        voted: Number(player.userId) === Number(viewerId) ? player.voted : Boolean(match.votes[player.userId] !== undefined),
        voteChoice: match.currentPhase === "voting" && !match.settings.anonymousVoting ? (match.votes[player.userId] ?? null) : null,
        role: mayKnowRole ? player.role : null, faction: mayKnowRole ? player.faction : null,
        appearance: appearanceFor(match, player, viewer),
      };
    }),
    me: {
      userId: viewer.userId, role: viewer.role, faction: viewer.faction, alive: viewer.alive,
      currentRoom: viewer.currentRoom, previousRoom: viewer.previousRoom, movingTo: viewer.movingTo,
      movingUntil: viewer.movingUntil, tasks: viewer.tasks, abilityCooldowns: viewer.abilityCooldowns,
      emergencyMeetingsLeft: viewer.emergencyMeetingsLeft, evidenceInventory: viewer.evidenceInventory,
      roleInfo: viewer.role ? ROLE_INFO[viewer.role] : null, silencedUntil: viewer.silencedUntil,
    },
    bodies: match.bodies.filter((body) => !body.reported && (body.room === viewer.currentRoom || ended)),
    evidence: match.evidence.filter((item) => item.presented || viewer.evidenceInventory.includes(item.id)).slice(-20),
    chatMessages: visibleChat(match, viewer),
    eventLog: match.eventLog.filter((event) => !event.privateTo || event.privateTo.includes(Number(viewerId))).slice(-14),
  };
}

function lobbySummary(match) {
  return {
    id: match.id, lobbyCode: match.visibility === "public" ? match.lobbyCode : null,
    visibility: match.visibility, players: match.players.length, maxPlayers: match.settings.maxPlayers,
    hostName: playerIn(match, match.hostUserId)?.username || "Host", status: match.status, createdAt: match.createdAt,
  };
}

function emitState(match) {
  for (const player of match.players) notifySocketUser(player.userId, "sus-state", publicState(match, player.userId));
}

function emitEvent(match, event, payload, userIds = null) {
  const recipients = userIds || match.players.map((player) => player.userId);
  for (const userId of recipients) notifySocketUser(userId, event, payload);
}

function safeMatchState(match) {
  return JSON.stringify(match);
}

async function persistNow(match) {
  await pool.query(
    `UPDATE sus_matches SET host_user_id = ?, visibility = ?, status = ?, winner_faction = ?, settings_json = ?, state_json = ?,
      started_at = ?, ended_at = ? WHERE id = ?`,
    [match.hostUserId, match.visibility, match.status, match.winner?.faction || null, JSON.stringify(match.settings), safeMatchState(match), match.startedAt, match.endedAt, match.id]
  );
}

function persistSoon(match) {
  clearTimeout(persistTimers.get(match.id));
  const timer = setTimeout(() => {
    persistTimers.delete(match.id);
    persistNow(match).catch((error) => console.error("[SUS persist]", error.message));
  }, 400);
  timer.unref?.();
  persistTimers.set(match.id, timer);
}

function touch(match) {
  match.lastActivityAt = nowIso();
  persistSoon(match);
}

function requireMatch(userId, matchId = null) {
  const match = matchId ? matches.get(String(matchId)) : activeMatchFor(userId);
  if (!match) throw fail("No active SUS lobby or match found.", 404, "SUS_NOT_FOUND");
  const player = playerIn(match, userId);
  if (!player) throw fail("You are not part of this SUS match.", 403);
  return { match, player };
}

function requirePhase(match, phase) {
  if (match.currentPhase !== phase) throw fail(`This action is available during ${phase.replaceAll("_", " ")}.`, 409);
}

function requireAlive(player) {
  if (!player.alive) throw fail("Eliminated players cannot perform this action.", 403);
  if (!player.connected) throw fail("Reconnect before acting.", 409);
}

function markAction(match, player) {
  player.meaningfulActions = Number(player.meaningfulActions || 0) + 1;
  player.lastActionAt = nowIso();
  player.afkWarned = false;
  touch(match);
}

function clearPhaseTimer(matchId) {
  clearTimeout(phaseTimers.get(matchId));
  phaseTimers.delete(matchId);
}

function schedulePhase(match) {
  clearPhaseTimer(match.id);
  if (!match.phaseEndsAt || ["ended", "lobby"].includes(match.currentPhase)) return;
  const delay = Math.max(100, new Date(match.phaseEndsAt).getTime() - Date.now());
  const timer = setTimeout(() => advancePhase(match.id).catch((error) => console.error("[SUS phase]", error.message)), delay);
  timer.unref?.();
  phaseTimers.set(match.id, timer);
}

function setPhase(match, phase, durationSeconds = 0) {
  match.currentPhase = phase;
  match.phaseEndsAt = durationSeconds ? new Date(Date.now() + durationSeconds * 1000).toISOString() : null;
  match.players.forEach((player) => { player.voted = false; });
  addEvent(match, "phase", `${phase.replaceAll("_", " ")} phase started.`);
  touch(match);
  emitState(match);
  schedulePhase(match);
}

async function advancePhase(matchId) {
  const match = matches.get(String(matchId));
  if (!match || match.status === "ended") return;
  if (match.currentPhase === "role_reveal") return setPhase(match, "action", 0);
  if (match.currentPhase === "discussion") return setPhase(match, "voting", match.settings.votingDuration);
  if (match.currentPhase === "voting") return resolveVote(match);
  if (match.currentPhase === "result") {
    match.currentRound += 1;
    match.voteResult = null;
    match.reportedBody = null;
    match.players.forEach((player) => { player.protected = false; player.investigatedRound = 0; });
    return setPhase(match, "action", 0);
  }
}

function createEvidence(match, player, title, description, reliability = "medium", location = null) {
  const evidence = { id: crypto.randomUUID(), title, description, reliability, location: location || player.currentRoom, foundAt: nowIso(), presented: false, ownerUserId: player.userId };
  match.evidence.push(evidence);
  player.evidenceInventory.push(evidence.id);
  match.evidence = match.evidence.slice(-60);
  return evidence;
}

async function checkWin(match) {
  if (match.status !== "active") return false;
  const alive = living(match);
  const residents = alive.filter((player) => player.faction === "Residents").length;
  const shadows = alive.filter((player) => player.faction === "Shadows").length;
  const progress = taskProgress(match);
  if (shadows === 0) return endMatch(match, "Residents", "All Shadows were eliminated.");
  if (progress.total > 0 && progress.completed >= progress.total) return endMatch(match, "Residents", "Station tasks reached 100%.");
  if (shadows >= residents) return endMatch(match, "Shadows", "The Shadows reached control parity.");
  return false;
}

async function grantRewards(match) {
  const duration = match.startedAt ? Date.now() - new Date(match.startedAt).getTime() : 0;
  for (const player of match.players) {
    if (!player.rewardEligible || player.meaningfulActions < 3 || duration < 120000) continue;
    const won = player.faction === match.winner?.faction;
    const finishedTasks = player.tasks.length && player.tasks.every((task) => task.complete || !task.real);
    let gold = 15 + (won ? 20 : 0) + (finishedTasks ? 5 : 0);
    const xp = 10 + (won ? 10 : 0);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[daily]] = await connection.query("SELECT COALESCE(SUM(gold), 0) AS total FROM sus_rewards WHERE user_id = ? AND DATE(created_at) = UTC_DATE() FOR UPDATE", [player.userId]);
      gold = Math.max(0, Math.min(gold, 100 - Number(daily.total || 0)));
      const [insert] = await connection.query("INSERT IGNORE INTO sus_rewards (match_id, user_id, gold, xp, reason) VALUES (?, ?, ?, ?, ?)", [match.id, player.userId, gold, xp, `${player.faction} ${won ? "victory" : "match"}`]);
      if (insert.affectedRows) await connection.query("UPDATE users SET gold = gold + ?, xp = xp + ? WHERE id = ?", [gold, xp, player.userId]);
      await connection.commit();
      if (insert.affectedRows) {
        invalidateUserCache(player.userId);
        broadcast("users-changed", { userId: player.userId });
        notifySocketUser(player.userId, "sus-reward", { matchId: match.id, gold, xp });
      }
    } catch (error) {
      await connection.rollback().catch(() => {});
      console.error("[SUS reward]", error.message);
    } finally { connection.release(); }
  }
}

async function endMatch(match, faction, reason) {
  if (match.status === "ended") return true;
  clearPhaseTimer(match.id);
  match.status = "ended";
  match.currentPhase = "end";
  match.phaseEndsAt = null;
  match.endedAt = nowIso();
  match.winner = { faction, reason };
  addEvent(match, "end", `${faction} win. ${reason}`);
  await persistNow(match);
  emitState(match);
  grantRewards(match).catch((error) => console.error("[SUS rewards]", error.message));
  return true;
}

async function resolveVote(match) {
  if (match.currentPhase !== "voting") return;
  const counts = new Map();
  for (const vote of Object.values(match.votes || {})) counts.set(vote, (counts.get(vote) || 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted[0];
  const tie = top && sorted[1] && top[1] === sorted[1][1];
  let expelled = null;
  if (top && top[0] !== "skip" && !tie) {
    expelled = playerIn(match, Number(top[0]));
    if (expelled) expelled.alive = false;
  }
  match.voteResult = {
    counts: Object.fromEntries(sorted), tie: Boolean(tie), expelledUserId: expelled?.userId || null,
    expelledName: expelled?.username || null,
    expelledRole: expelled && match.settings.roleRevealOnElimination ? expelled.role : null,
  };
  match.votes = {};
  addEvent(match, "vote", expelled ? `${expelled.username} was expelled.` : "The vote ended without an expulsion.");
  if (await checkWin(match)) return;
  setPhase(match, "result", 7);
}

async function initialize() {
  const [rows] = await pool.query("SELECT state_json FROM sus_matches WHERE status IN ('lobby','active') AND updated_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 HOUR)");
  for (const row of rows) {
    try {
      const match = JSON.parse(row.state_json || "null");
      if (!match?.id || !Array.isArray(match.players)) continue;
      matches.set(match.id, match);
      const age = Date.now() - new Date(match.lastActivityAt || match.createdAt).getTime();
      if ((match.status === "lobby" && age > LOBBY_MAX_AGE_MS) || (match.status === "active" && age > ACTIVE_MAX_AGE_MS)) {
        match.status = "abandoned";
        match.currentPhase = "end";
        persistSoon(match);
        continue;
      }
      for (const player of match.players) {
        if (player.movingTo && player.movingUntil) {
          const delay = new Date(player.movingUntil).getTime() - Date.now();
          if (delay <= 0) { player.currentRoom = player.movingTo; player.movingTo = null; player.movingUntil = null; }
          else scheduleArrival(match, player, delay);
        }
      }
      schedulePhase(match);
      scheduleSabotage(match);
    } catch (error) { console.error("[SUS recovery]", error.message); }
  }
}

async function createLobby(user, input = {}) {
  if (activeMatchFor(user.id)) throw fail("Leave your current SUS lobby first.", 409);
  const match = baseMatch(user, input);
  while ([...matches.values()].some((item) => item.lobbyCode === match.lobbyCode)) match.lobbyCode = lobbyCode();
  matches.set(match.id, match);
  await pool.query(
    "INSERT INTO sus_matches (id, lobby_code, host_user_id, visibility, status, settings_json, state_json) VALUES (?, ?, ?, ?, 'lobby', ?, ?)",
    [match.id, match.lobbyCode, match.hostUserId, match.visibility, JSON.stringify(match.settings), safeMatchState(match)]
  );
  await pool.query("INSERT INTO sus_match_players (match_id, user_id) VALUES (?, ?)", [match.id, user.id]);
  emitState(match);
  return publicState(match, user.id);
}

async function listLobbies(userId) {
  const current = activeMatchFor(userId);
  return {
    lobbies: [...matches.values()].filter((match) => match.status === "lobby" && match.visibility === "public" && match.players.length < match.settings.maxPlayers).map(lobbySummary),
    current: current ? publicState(current, userId) : null,
    minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS,
  };
}

async function joinLobby(user, input = {}) {
  const existing = activeMatchFor(user.id);
  if (existing) return publicState(existing, user.id);
  const code = String(input.lobbyCode || input.code || "").trim().toUpperCase();
  if (!input.matchId) {
    const now = Date.now();
    const recent = (joinAttempts.get(Number(user.id)) || []).filter((time) => now - time < 60000);
    if (recent.length >= 8) throw fail("Too many lobby code attempts. Wait one minute.", 429);
    recent.push(now);
    joinAttempts.set(Number(user.id), recent);
  }
  const match = input.matchId ? matches.get(String(input.matchId)) : [...matches.values()].find((item) => item.lobbyCode === code);
  if (!match || match.status !== "lobby") throw fail("That SUS lobby is no longer available.", 404);
  if (match.players.length >= match.settings.maxPlayers) throw fail("That SUS lobby is full.", 409);
  const player = makePlayer(user);
  player.emergencyMeetingsLeft = match.settings.emergencyMeetingLimit;
  match.players.push(player);
  addEvent(match, "lobby", `${user.username} joined the lobby.`);
  touch(match);
  await pool.query(
    "INSERT INTO sus_match_players (match_id, user_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE left_at = NULL, joined_at = UTC_TIMESTAMP(), reward_eligible = 1",
    [match.id, user.id]
  );
  emitState(match);
  return publicState(match, user.id);
}

async function quickPlay(user) {
  const open = [...matches.values()].filter((match) => match.status === "lobby" && match.visibility === "public" && match.players.length < match.settings.maxPlayers).sort((a, b) => b.players.length - a.players.length)[0];
  return open ? joinLobby(user, { matchId: open.id }) : createLobby(user, { visibility: "public" });
}

async function leave(userId, matchId = null) {
  const { match, player } = requireMatch(userId, matchId);
  if (match.status === "lobby") {
    match.players = match.players.filter((item) => Number(item.userId) !== Number(userId));
    await pool.query("UPDATE sus_match_players SET left_at = UTC_TIMESTAMP(), reward_eligible = 0 WHERE match_id = ? AND user_id = ?", [match.id, userId]);
    if (!match.players.length) {
      match.status = "abandoned";
      match.currentPhase = "end";
    } else if (Number(match.hostUserId) === Number(userId)) {
      match.hostUserId = match.players[0].userId;
      addEvent(match, "host", `${match.players[0].username} is the new host.`);
    }
  } else {
    player.connected = false; player.alive = false; player.rewardEligible = false; player.disconnectedAt = nowIso();
    await pool.query("UPDATE sus_match_players SET left_at = UTC_TIMESTAMP(), reward_eligible = 0 WHERE match_id = ? AND user_id = ?", [match.id, userId]);
    await checkWin(match);
  }
  touch(match); emitState(match);
  return { ok: true };
}

function setReady(userId, value, matchId = null) {
  const { match, player } = requireMatch(userId, matchId);
  requirePhase(match, "lobby");
  player.ready = value === undefined ? !player.ready : Boolean(value);
  touch(match); emitState(match);
  return publicState(match, userId);
}

function updateSettings(userId, input = {}, matchId = null) {
  const { match } = requireMatch(userId, matchId);
  if (Number(match.hostUserId) !== Number(userId)) throw fail("Only the host can change lobby settings.", 403);
  requirePhase(match, "lobby");
  if (input.visibility !== undefined) match.visibility = input.visibility === "private" ? "private" : "public";
  match.settings = settingsFrom({ ...match.settings, ...input });
  match.players.forEach((player) => { player.emergencyMeetingsLeft = match.settings.emergencyMeetingLimit; });
  addEvent(match, "settings", "Lobby settings updated."); touch(match); emitState(match);
  return publicState(match, userId);
}

async function startMatch(userId, matchId = null) {
  const { match } = requireMatch(userId, matchId);
  if (Number(match.hostUserId) !== Number(userId)) throw fail("Only the host can start SUS.", 403);
  requirePhase(match, "lobby");
  if (match.players.length < MIN_PLAYERS) throw fail(`SUS needs at least ${MIN_PLAYERS} players.`, 409);
  if (match.players.some((player) => !player.ready)) throw fail("Every player must be ready before the match starts.", 409);
  const shuffledPlayers = shuffled(match.players);
  const shadowCount = Math.min(match.settings.numberOfShadows, Math.max(1, Math.floor((match.players.length - 1) / 3)));
  shuffledPlayers.forEach((player, index) => {
    if (index < shadowCount) {
      player.faction = "Shadows";
      player.role = index === 1 ? "Mimic" : "Infiltrator";
    } else {
      player.faction = "Residents";
      const residentIndex = index - shadowCount;
      player.role = residentIndex === 0 ? "Investigator" : residentIndex === 1 ? "Medic" : "Citizen";
    }
    player.alive = true; player.currentRoom = "Central Hall"; player.ready = false;
    assignTasks(match, player);
  });
  match.status = "active"; match.startedAt = nowIso(); match.currentRound = 1; match.votes = {};
  await pool.query("UPDATE sus_matches SET status = 'active', started_at = UTC_TIMESTAMP() WHERE id = ?", [match.id]);
  for (const player of match.players) await pool.query("UPDATE sus_match_players SET faction = ?, role_name = ? WHERE match_id = ? AND user_id = ?", [player.faction, player.role, match.id, player.userId]);
  addEvent(match, "start", "Blackout Station sealed. Roles assigned.");
  setPhase(match, "role_reveal", 8);
  return publicState(match, userId);
}

function scheduleArrival(match, player, delay) {
  const timer = setTimeout(() => {
    if (match.status !== "active" || !player.movingTo) return;
    player.previousRoom = player.currentRoom;
    player.currentRoom = player.movingTo;
    player.movingTo = null; player.movingUntil = null;
    const nearby = match.players.filter((item) => item.alive && item.currentRoom === player.currentRoom).map((item) => Number(item.userId));
    addEvent(match, "movement", `${player.username} arrived in ${player.currentRoom}.`, { room: player.currentRoom, privateTo: nearby });
    markAction(match, player); emitState(match);
  }, Math.max(100, delay));
  timer.unref?.();
}

function move(userId, destination, matchId = null) {
  const { match, player } = requireMatch(userId, matchId);
  requirePhase(match, "action"); requireAlive(player);
  if (player.movingTo) throw fail("You are already moving.", 409);
  const target = String(destination || "");
  const activeDoors = match.sabotages.find((item) => item.active && item.type === "doors");
  if (activeDoors?.blockedRoom === target) throw fail("That connection is temporarily locked.", 409);
  if (!(MAP.rooms[player.currentRoom] || []).includes(target)) throw fail("That room is not connected to your current location.", 409);
  const duration = Math.round(match.settings.movementSpeed * 1000);
  player.movingTo = target; player.movingUntil = new Date(Date.now() + duration).toISOString();
  const nearby = match.players.filter((item) => item.alive && item.currentRoom === player.currentRoom).map((item) => Number(item.userId));
  addEvent(match, "movement", `${player.username} left ${player.currentRoom}.`, { room: player.currentRoom, privateTo: nearby });
  touch(match); emitState(match); scheduleArrival(match, player, duration);
  return publicState(match, userId);
}

function startTask(userId, taskId, matchId = null) {
  const { match, player } = requireMatch(userId, matchId);
  requirePhase(match, "action"); requireAlive(player);
  if (player.movingTo) throw fail("Finish moving before starting a task.", 409);
  const task = player.tasks.find((item) => item.id === taskId);
  if (!task || task.complete) throw fail("That task is not available.", 404);
  if (task.room !== player.currentRoom) throw fail(`Go to ${task.room} to start this task.`, 409);
  task.startedAt = nowIso(); touch(match);
  return { task };
}

async function taskAction(userId, taskId, input = {}, matchId = null) {
  const { match, player } = requireMatch(userId, matchId);
  requirePhase(match, "action"); requireAlive(player);
  const task = player.tasks.find((item) => item.id === taskId);
  if (!task || task.complete || !task.startedAt) throw fail("Start this task first.", 409);
  if (task.room !== player.currentRoom || player.movingTo) throw fail("Movement cancelled this task.", 409);
  let valid = false;
  if (task.type === "frequency") valid = Number(input.value) === Number(task.challenge.target);
  else if (["power", "memory"].includes(task.type)) valid = JSON.stringify((input.sequence || []).map(Number)) === JSON.stringify(task.challenge.sequence);
  else if (task.type === "scan") valid = Date.now() - new Date(task.startedAt).getTime() >= Number(task.challenge.holdMs || 1800);
  else if (task.type === "circuit") valid = JSON.stringify(input.pairs || []) === JSON.stringify(task.challenge.pairs);
  if (!valid) throw fail("Task validation failed. Try the sequence again.", 409);
  task.complete = true; task.completedAt = nowIso();
  if (task.real) {
    createEvidence(match, player, "Verified task record", `A genuine task completed in ${task.room}.`, "confirmed", task.room);
    addEvent(match, "task", `A station task was completed in ${task.room}.`, { room: task.room });
  }
  markAction(match, player); emitState(match);
  await checkWin(match);
  return publicState(match, userId);
}

function cooldownReady(player, key) {
  const until = new Date(player.abilityCooldowns[key] || 0).getTime();
  if (until > Date.now()) throw fail(`Ability cooling down for ${Math.ceil((until - Date.now()) / 1000)} seconds.`, 409);
}

async function ability(userId, input = {}, matchId = null) {
  const { match, player } = requireMatch(userId, matchId);
  requirePhase(match, "action"); requireAlive(player);
  if (player.movingTo) throw fail("Abilities are unavailable while moving.", 409);
  const type = String(input.type || "");
  const target = playerIn(match, Number(input.targetUserId));
  if (type === "eliminate") {
    if (player.faction !== "Shadows") throw fail("Your role cannot eliminate players.", 403);
    cooldownReady(player, "eliminate");
    if (!target || !target.alive || target.faction === "Shadows" || target.currentRoom !== player.currentRoom) throw fail("Choose a living nearby Resident.", 409);
    if (target.protected) {
      target.protected = false;
      addEvent(match, "incident", "An attack was blocked by an unknown protection.", { room: player.currentRoom });
      player.abilityCooldowns.eliminate = new Date(Date.now() + 20000).toISOString();
    } else {
      target.alive = false;
      match.bodies.push({ id: crypto.randomUUID(), userId: target.userId, username: target.username, room: target.currentRoom, createdAt: nowIso(), reported: false });
      addEvent(match, "incident", "A signal disappeared from the station.", { room: player.currentRoom });
      player.abilityCooldowns.eliminate = new Date(Date.now() + 30000).toISOString();
    }
  } else if (type === "inspect") {
    if (player.role !== "Investigator") throw fail("Only the Investigator can inspect.", 403);
    if (player.investigatedRound === match.currentRound) throw fail("You already inspected this round.", 409);
    if (!target || !target.alive || target.userId === player.userId || target.currentRoom !== player.currentRoom) throw fail("Choose a living player in this room.", 409);
    const roll = crypto.randomInt(100);
    const result = roll < 18 ? "Result inconclusive." : target.faction === "Shadows" ? "Suspicious traces detected." : "No suspicious activity detected.";
    createEvidence(match, player, "Investigation result", result, roll < 18 ? "uncertain" : "high", player.currentRoom);
    player.investigatedRound = match.currentRound;
    emitEvent(match, "sus-event", { type: "private", title: "Investigation complete", body: result }, [player.userId]);
  } else if (type === "protect") {
    if (player.role !== "Medic") throw fail("Only the Medic can protect.", 403);
    cooldownReady(player, "protect");
    if (!target || !target.alive || target.currentRoom !== player.currentRoom) throw fail("Choose a living player in this room.", 409);
    if (Number(player.lastProtectedUserId) === Number(target.userId)) throw fail("Choose someone different from your last protection.", 409);
    target.protected = true; player.lastProtectedUserId = target.userId;
    player.abilityCooldowns.protect = new Date(Date.now() + 35000).toISOString();
  } else if (type === "mimic") {
    if (player.role !== "Mimic") throw fail("Only the Mimic can copy an appearance.", 403);
    cooldownReady(player, "mimic");
    if (!target || !target.alive || target.userId === player.userId || target.currentRoom !== player.currentRoom) throw fail("Choose a living nearby player.", 409);
    player.disguisedAs = target.userId; player.disguiseUntil = new Date(Date.now() + 30000).toISOString();
    player.abilityCooldowns.mimic = new Date(Date.now() + 60000).toISOString();
  } else if (type === "repair") {
    const sabotage = match.sabotages.find((item) => item.active);
    if (!sabotage) throw fail("There is no active sabotage.", 409);
    const repairRooms = { lights: "Power Room", communications: "Communications", reactor: "Reactor", doors: "Maintenance" };
    if (player.currentRoom !== repairRooms[sabotage.type]) throw fail(`Repair this sabotage from ${repairRooms[sabotage.type]}.`, 409);
    sabotage.active = false; sabotage.repairedAt = nowIso(); sabotage.repairedBy = player.userId;
    addEvent(match, "sabotage", `${sabotage.type} sabotage repaired.`, { room: player.currentRoom });
  } else throw fail("Unknown ability.", 400);
  markAction(match, player); emitState(match);
  await checkWin(match);
  return publicState(match, userId);
}

function scheduleSabotage(match) {
  const sabotage = match.sabotages.find((item) => item.active && item.type === "reactor" && item.endsAt);
  if (!sabotage) return;
  const timer = setTimeout(() => {
    if (sabotage.active && match.status === "active") endMatch(match, "Shadows", "The reactor failure reached zero.").catch(() => {});
  }, Math.max(100, new Date(sabotage.endsAt).getTime() - Date.now()));
  timer.unref?.();
}

function sabotage(userId, input = {}, matchId = null) {
  const { match, player } = requireMatch(userId, matchId);
  requirePhase(match, "action"); requireAlive(player);
  if (player.faction !== "Shadows") throw fail("Only Shadows can sabotage the station.", 403);
  cooldownReady(player, "sabotage");
  if (match.sabotages.some((item) => item.active)) throw fail("A sabotage is already active.", 409);
  const type = ["lights", "communications", "reactor", "doors"].includes(input.type) ? input.type : "lights";
  const item = { id: crypto.randomUUID(), type, active: true, originRoom: player.currentRoom, startedAt: nowIso(), endsAt: type === "reactor" ? new Date(Date.now() + 45000).toISOString() : null };
  if (type === "doors") item.blockedRoom = String(input.blockedRoom || "Security");
  match.sabotages.push(item); player.abilityCooldowns.sabotage = new Date(Date.now() + 45000).toISOString();
  addEvent(match, "sabotage", `${type} sabotage detected.`);
  createEvidence(match, player, "Sabotage origin trace", "A distorted signal points toward the sabotage origin.", "uncertain", player.currentRoom);
  markAction(match, player); emitState(match); scheduleSabotage(match);
  return publicState(match, userId);
}

function beginMeeting(match, reporter, body = null, emergency = false) {
  match.players.forEach((player) => { player.movingTo = null; player.movingUntil = null; player.protected = false; });
  match.reportedBody = body ? { ...body } : { emergency: true, username: null, room: reporter.currentRoom };
  if (body) body.reported = true;
  match.lastMeetingAt = nowIso(); match.votes = {};
  addEvent(match, "meeting", emergency ? `${reporter.username} called an emergency meeting.` : `${reporter.username} reported an incident in ${body.room}.`);
  setPhase(match, "discussion", match.settings.discussionDuration);
}

function report(userId, bodyId, matchId = null) {
  const { match, player } = requireMatch(userId, matchId);
  requirePhase(match, "action"); requireAlive(player);
  const body = match.bodies.find((item) => item.id === bodyId && !item.reported);
  if (!body || body.room !== player.currentRoom) throw fail("No reportable incident is in this room.", 409);
  markAction(match, player); beginMeeting(match, player, body, false);
  return publicState(match, userId);
}

function emergency(userId, matchId = null) {
  const { match, player } = requireMatch(userId, matchId);
  requirePhase(match, "action"); requireAlive(player);
  if (player.emergencyMeetingsLeft <= 0) throw fail("You have no emergency meetings left.", 409);
  if (match.sabotages.some((item) => item.active && item.type === "reactor")) throw fail("Emergency meetings are blocked during reactor failure.", 409);
  if (match.startedAt && Date.now() - new Date(match.startedAt).getTime() < 30000) throw fail("The initial emergency cooldown is still active.", 409);
  if (match.lastMeetingAt && Date.now() - new Date(match.lastMeetingAt).getTime() < 30000) throw fail("Wait before calling another meeting.", 409);
  player.emergencyMeetingsLeft -= 1; markAction(match, player); beginMeeting(match, player, null, true);
  return publicState(match, userId);
}

function sendChat(user, input = {}, matchId = null) {
  const { match, player } = requireMatch(user.id, matchId);
  if (Date.now() - Number(player.lastChatAt || 0) < 1200) throw fail("Slow down before sending another message.", 429);
  const preset = Boolean(input.preset) && PRESETS.has(String(input.body || ""));
  if (user.muted_until && new Date(user.muted_until).getTime() > Date.now() && !preset) throw fail("You are muted. Approved preset statements are still available.", 403);
  if (match.currentPhase === "discussion" || match.currentPhase === "voting") {
    if (player.alive && player.silencedUntil && new Date(player.silencedUntil).getTime() > Date.now() && !preset) throw fail("Use a preset statement while silenced.", 403);
  } else if (match.currentPhase !== "action") throw fail("Chat is unavailable during this transition.", 409);
  const body = String(input.body || "").trim().slice(0, 280);
  if (!body) throw fail("Write a message first.");
  const channel = !player.alive ? "dead" : match.currentPhase === "action" ? `room:${player.currentRoom}` : "discussion";
  const message = { id: crypto.randomUUID(), userId: player.userId, username: player.username, avatar: player.avatar, frame: player.frame, body, channel, room: player.currentRoom, preset, createdAt: nowIso() };
  match.chatMessages.push(message); match.chatMessages = match.chatMessages.slice(-100); player.lastChatAt = Date.now();
  let recipients;
  if (channel === "dead") recipients = match.players.filter((item) => !item.alive).map((item) => item.userId);
  else if (channel === "discussion") recipients = match.players.filter((item) => item.alive).map((item) => item.userId);
  else recipients = match.players.filter((item) => item.alive && item.currentRoom === player.currentRoom).map((item) => item.userId);
  emitEvent(match, "sus-chat", message, recipients); touch(match);
  return message;
}

async function vote(userId, targetUserId, matchId = null) {
  const { match, player } = requireMatch(userId, matchId);
  requirePhase(match, "voting"); requireAlive(player);
  if (match.votes[player.userId] !== undefined) throw fail("Your vote is already locked.", 409);
  const target = String(targetUserId) === "skip" ? "skip" : Number(targetUserId);
  if (target !== "skip" && !living(match).some((item) => Number(item.userId) === Number(target))) throw fail("Choose a living player or skip.", 409);
  match.votes[player.userId] = target; player.voted = true; markAction(match, player); emitState(match);
  if (living(match).every((item) => match.votes[item.userId] !== undefined)) await resolveVote(match);
  return publicState(match, userId);
}

function presentEvidence(userId, evidenceId, matchId = null) {
  const { match, player } = requireMatch(userId, matchId);
  if (!["discussion", "voting"].includes(match.currentPhase) || !player.alive) throw fail("Evidence can be presented during a meeting.", 409);
  const evidence = match.evidence.find((item) => item.id === evidenceId && player.evidenceInventory.includes(item.id));
  if (!evidence) throw fail("That evidence is not in your inventory.", 404);
  evidence.presented = true; evidence.presentedBy = player.userId;
  addEvent(match, "evidence", `${player.username} presented ${evidence.title}.`); markAction(match, player); emitState(match);
  return publicState(match, userId);
}

function reconnect(userId) {
  const match = activeMatchFor(userId);
  if (!match) return null;
  const player = playerIn(match, userId);
  clearTimeout(reconnectTimers.get(`${match.id}:${userId}`));
  reconnectTimers.delete(`${match.id}:${userId}`);
  player.connected = true; player.disconnectedAt = null;
  touch(match); emitState(match);
  return publicState(match, userId);
}

function handleDisconnect(userId) {
  const match = activeMatchFor(userId);
  if (!match || match.status === "ended") return;
  const player = playerIn(match, userId);
  player.connected = false; player.disconnectedAt = nowIso(); player.movingTo = null; player.movingUntil = null;
  emitState(match); touch(match);
  const key = `${match.id}:${userId}`;
  clearTimeout(reconnectTimers.get(key));
  const timer = setTimeout(() => {
    if (player.connected) return;
    player.rewardEligible = false;
    if (match.status === "lobby") {
      match.players = match.players.filter((item) => item.userId !== player.userId);
      if (Number(match.hostUserId) === Number(player.userId) && match.players.length) match.hostUserId = match.players[0].userId;
    } else player.alive = false;
    touch(match); emitState(match); checkWin(match).catch(() => {});
  }, RECONNECT_MS);
  timer.unref?.(); reconnectTimers.set(key, timer);
}

function socketState(userId) {
  const match = activeMatchFor(userId);
  return match ? publicState(match, userId) : null;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, match] of matches) {
    const age = now - new Date(match.lastActivityAt || match.createdAt).getTime();
    if (match.status === "lobby" && age > LOBBY_MAX_AGE_MS) {
      match.status = "abandoned"; match.currentPhase = "end"; persistSoon(match); emitState(match);
    }
    if (["ended", "abandoned"].includes(match.status) && age > 10 * 60 * 1000) matches.delete(id);
    if (match.status === "active") {
      for (const player of match.players.filter((item) => item.alive && item.connected)) {
        const idleFor = now - new Date(player.lastActionAt || match.startedAt || match.createdAt).getTime();
        if (idleFor > 3 * 60 * 1000 && !player.afkWarned) {
          player.afkWarned = true;
          notifySocketUser(player.userId, "sus-event", { type: "afk", title: "Activity check", body: "Move, complete a task, use evidence, or vote to remain reward eligible." });
        }
        if (idleFor > 5 * 60 * 1000) player.rewardEligible = false;
      }
    }
  }
}, 60000).unref?.();

module.exports = {
  initialize, listLobbies, createLobby, quickPlay, joinLobby, leave, setReady, updateSettings, startMatch,
  socketState, reconnect, handleDisconnect, move, startTask, taskAction, ability, sabotage, report, emergency,
  sendChat, vote, presentEvidence, publicState, MIN_PLAYERS, MAX_PLAYERS,
};
