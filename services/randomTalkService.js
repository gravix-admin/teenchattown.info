const crypto = require("crypto");
const pool = require("../database");
const { notifySocketUser, broadcast } = require("./events");
const { invalidateUserCache } = require("../middleware/auth");

const profiles = new Map();
const queue = new Map();
const sessions = new Map();
const userSessions = new Map();
const endedStates = new Map();
const recentSessions = new Map();
const recentPairs = new Map();
const disconnectTimers = new Map();
const skipTimes = new Map();
const messageWindows = new Map();
const typingTimes = new Map();
const blockCache = new Map();
const connectedUsers = new Set();
let matchLock = Promise.resolve();

const INTERESTS = new Set(["Chill", "Informative", "Flirt", "Games", "Fitness", "Music", "Movies", "Study", "Vent", "Random"]);
const REPORT_CATEGORIES = new Set(["Harassment", "Sexual or inappropriate behaviour", "Hate speech", "Threats", "Spam or scam", "Sharing personal information", "Underage safety concern", "Other"]);
const RESERVED_NAMES = ["admin", "moderator", "developer", "staff", "townbot", "teenchattown"];
const MAX_MESSAGE_LENGTH = Math.max(100, Math.min(600, Number(process.env.RANDOM_TALK_MESSAGE_MAX || 500)));
const INTEREST_FALLBACK_MS = Math.max(2000, Math.min(30000, Number(process.env.RANDOM_TALK_INTEREST_WAIT_MS || 7000)));
const RECONNECT_MS = Math.max(10000, Math.min(90000, Number(process.env.RANDOM_TALK_RECONNECT_MS || 30000)));
const QUEUE_TTL_MS = Math.max(60000, Math.min(10 * 60 * 1000, Number(process.env.RANDOM_TALK_QUEUE_TTL_MS || 180000)));
const SKIP_COOLDOWN_MS = Math.max(1500, Math.min(10000, Number(process.env.RANDOM_TALK_SKIP_COOLDOWN_MS || 2500)));
const RECENT_PAIR_MS = 2 * 60 * 1000;
const RECENT_SESSION_MS = 15 * 60 * 1000;

function fail(message, status = 400, code = "RANDOM_TALK_ERROR") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function nowIso() { return new Date().toISOString(); }
function ageBand(user) { return Number(user.age || 0) >= 18 ? "adult" : "minor"; }
function pairKey(a, b) { return [Number(a), Number(b)].sort((x, y) => x - y).join(":"); }
function activeSession(userId) {
  const id = userSessions.get(Number(userId));
  const session = id ? sessions.get(id) : null;
  return session?.status === "active" ? session : null;
}
function member(session, userId) { return session.users.find((item) => Number(item.userId) === Number(userId)); }
function partner(session, userId) { return session.users.find((item) => Number(item.userId) !== Number(userId)); }

function sanitizeTempName(value) {
  const name = String(value || "").replace(/\s+/g, " ").trim();
  if (name.length < 3 || name.length > 18) throw fail("Random Talk names must be 3–18 characters.", 422, "TEMP_NAME_INVALID");
  if (!/^[\p{L}\p{N} _-]+$/u.test(name)) throw fail("Use only letters, numbers, spaces, underscores or hyphens.", 422, "TEMP_NAME_INVALID");
  const lower = name.toLowerCase();
  if (RESERVED_NAMES.some((word) => lower.includes(word))) throw fail("Choose a name that does not imitate TeenChatTown staff.", 422, "TEMP_NAME_RESERVED");
  const blocked = String(process.env.RANDOM_TALK_BLOCKED_WORDS || process.env.CHAT_BLOCKED_WORDS || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (blocked.some((word) => lower.includes(word))) throw fail("That temporary name is not allowed.", 422, "TEMP_NAME_MODERATED");
  return name;
}

function normalizedInterest(value, user) {
  const interest = String(value || "").trim();
  if (!interest) return null;
  if (!INTERESTS.has(interest)) throw fail("Choose a valid Random Talk interest.", 422, "INTEREST_INVALID");
  if (interest === "Flirt" && ageBand(user) !== "adult") throw fail("Flirt is available only to adult accounts. Safety rules still apply.", 403, "INTEREST_RESTRICTED");
  return interest;
}

function assertAccess(user) {
  if (user.random_talk_restricted_until && new Date(user.random_talk_restricted_until).getTime() > Date.now()) {
    throw fail(user.random_talk_restriction_reason || "Random Talk access is temporarily restricted.", 403, "RANDOM_TALK_RESTRICTED");
  }
  if (user.muted_until && new Date(user.muted_until).getTime() > Date.now()) {
    throw fail("You are muted and cannot enter Random Talk right now.", 403, "MUTED");
  }
}

function publicMessage(message, viewerId) {
  return { id: message.id, mine: Number(message.senderId) === Number(viewerId), body: message.body, createdAt: message.createdAt };
}

function publicState(userId) {
  const id = Number(userId);
  const profile = profiles.get(id) || null;
  const session = activeSession(id);
  if (session) {
    const other = partner(session, id);
    return {
      status: "matched",
      temporaryUsername: member(session, id)?.tempUsername,
      selectedInterest: member(session, id)?.interest || null,
      partner: { temporaryUsername: other.tempUsername, interest: other.interest || null, connected: other.connected !== false },
      messages: session.messages.slice(-40).map((message) => publicMessage(message, id)),
      connectedAt: session.createdAt,
      socketOnly: true,
    };
  }
  const queued = queue.get(id);
  if (queued) return { status: "queued", temporaryUsername: queued.tempUsername, selectedInterest: queued.interest, joinedAt: queued.joinedAt };
  const ended = endedStates.get(id);
  if (ended) return { status: "ended", ...ended };
  if (profile) return { status: "idle", temporaryUsername: profile.tempUsername, selectedInterest: profile.interest, safetyConfirmed: true };
  return { status: "setup" };
}

function emitState(userId) {
  notifySocketUser(userId, "random-talk-state", publicState(userId));
}

function emitSessionState(session) {
  session.users.forEach((item) => emitState(item.userId));
}

async function withMatchLock(callback) {
  const previous = matchLock;
  let release;
  matchLock = new Promise((resolve) => { release = resolve; });
  await previous;
  try { return await callback(); }
  finally { release(); }
}

async function usersBlocked(a, b) {
  const key = pairKey(a, b);
  const cached = blockCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.blocked;
  const [[row]] = await pool.query(
    "SELECT COUNT(*) AS count FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)",
    [a, b, b, a]
  );
  const blocked = Number(row?.count || 0) > 0;
  blockCache.set(key, { blocked, expiresAt: Date.now() + 60000 });
  return blocked;
}

function interestScore(a, b, now) {
  const neutralA = !a.interest || a.interest === "Random";
  const neutralB = !b.interest || b.interest === "Random";
  if (a.interest && a.interest === b.interest) return 0;
  if (neutralA || neutralB) return 1;
  if (now - new Date(a.joinedAt).getTime() >= INTEREST_FALLBACK_MS || now - new Date(b.joinedAt).getTime() >= INTEREST_FALLBACK_MS) return 2;
  return Infinity;
}

async function findCandidate(entry) {
  const now = Date.now();
  const candidates = [];
  for (const other of queue.values()) {
    if (other.userId === entry.userId || other.ageBand !== entry.ageBand) continue;
    const score = interestScore(entry, other, now);
    if (!Number.isFinite(score) || await usersBlocked(entry.userId, other.userId)) continue;
    const recent = Number(recentPairs.get(pairKey(entry.userId, other.userId)) || 0) > now - RECENT_PAIR_MS;
    candidates.push({ other, score: score + (recent ? 10 : 0), recent });
  }
  candidates.sort((a, b) => a.score - b.score || new Date(a.other.joinedAt) - new Date(b.other.joinedAt));
  return candidates[0]?.other || null;
}

async function createMatch(a, b) {
  const session = {
    id: crypto.randomUUID(), status: "active", createdAt: nowIso(), lastActivityAt: nowIso(), lastPersistAt: Date.now(), messages: [],
    users: [
      { userId: a.userId, tempUsername: a.tempUsername, interest: a.interest, ageBand: a.ageBand, connected: true },
      { userId: b.userId, tempUsername: b.tempUsername, interest: b.interest, ageBand: b.ageBand, connected: true },
    ],
  };
  await pool.query(
    `INSERT INTO random_talk_sessions
      (id, user_a_id, user_b_id, temp_username_a, temp_username_b, interest_a, interest_b, status, last_activity_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', UTC_TIMESTAMP())`,
    [session.id, a.userId, b.userId, a.tempUsername, b.tempUsername, a.interest, b.interest]
  );
  queue.delete(a.userId); queue.delete(b.userId);
  endedStates.delete(a.userId); endedStates.delete(b.userId);
  sessions.set(session.id, session);
  userSessions.set(a.userId, session.id); userSessions.set(b.userId, session.id);
  notifySocketUser(a.userId, "random-talk-match-found", { temporaryUsername: b.tempUsername, interest: b.interest || null });
  notifySocketUser(b.userId, "random-talk-match-found", { temporaryUsername: a.tempUsername, interest: a.interest || null });
  emitSessionState(session);
}

async function drainQueue() {
  let paired = true;
  while (paired) {
    paired = false;
    const entries = [...queue.values()].sort((a, b) => new Date(a.joinedAt) - new Date(b.joinedAt));
    for (const entry of entries) {
      if (!queue.has(entry.userId)) continue;
      const candidate = await findCandidate(entry);
      if (!candidate || !queue.has(candidate.userId)) continue;
      await createMatch(entry, candidate);
      paired = true;
      break;
    }
  }
}

async function join(user, input = {}) {
  assertAccess(user);
  if (activeSession(user.id) || queue.has(Number(user.id))) return publicState(user.id);
  if (input.safetyConfirmed !== true) throw fail("Please acknowledge the Random Talk safety notice.", 422, "SAFETY_REQUIRED");
  const profile = {
    userId: Number(user.id), tempUsername: sanitizeTempName(input.temporaryUsername),
    interest: normalizedInterest(input.interest, user), ageBand: ageBand(user), configuredAt: nowIso(),
  };
  profiles.set(profile.userId, profile);
  endedStates.delete(profile.userId);
  emitState(profile.userId);
  return publicState(profile.userId);
}

async function search(user) {
  assertAccess(user);
  return withMatchLock(async () => {
    const id = Number(user.id);
    if (!connectedUsers.has(id)) throw fail("Random Talk needs a live Socket.IO connection. Reconnect and try again.", 409, "REALTIME_REQUIRED");
    if (activeSession(id)) return publicState(id);
    const profile = profiles.get(id);
    if (!profile) throw fail("Set up your temporary Random Talk name first.", 409, "SETUP_REQUIRED");
    if (!queue.has(id)) queue.set(id, { ...profile, joinedAt: nowIso() });
    endedStates.delete(id);
    emitState(id);
    await drainQueue();
    return publicState(id);
  });
}

async function cancelSearch(userId) {
  return withMatchLock(async () => {
    const id = Number(userId);
    queue.delete(id);
    emitState(id);
    return publicState(id);
  });
}

function endedCopy(reason, other, message) {
  return { reason, message, partner: other ? { temporaryUsername: other.tempUsername, interest: other.interest || null } : null, canReport: Boolean(other), endedAt: nowIso() };
}

async function endSession(session, actorUserId, reason, options = {}) {
  if (!session || session.status !== "active") return;
  session.status = "ended";
  session.endedAt = nowIso();
  const actorId = Number(actorUserId || 0);
  const actor = actorId ? member(session, actorId) : null;
  const other = actorId ? partner(session, actorId) : null;
  await pool.query(
    "UPDATE random_talk_sessions SET status = 'ended', ended_at = UTC_TIMESTAMP(), ended_by = ?, end_reason = ?, last_activity_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'active'",
    [actorId || null, reason, session.id]
  );
  session.users.forEach((item) => {
    userSessions.delete(item.userId);
    recentSessions.set(item.userId, { sessionId: session.id, expiresAt: Date.now() + RECENT_SESSION_MS });
  });
  if (actor && other) recentPairs.set(pairKey(actor.userId, other.userId), Date.now());
  if (actor && !options.requeueActor) endedStates.set(actor.userId, endedCopy(reason, other, options.actorMessage || "Conversation ended."));
  if (other) endedStates.set(other.userId, endedCopy(reason, actor, options.partnerMessage || "The stranger ended the conversation."));
  if (!actor) session.users.forEach((item) => endedStates.set(item.userId, endedCopy(reason, partner(session, item.userId), "The conversation ended.")));
  session.users.forEach((item) => notifySocketUser(item.userId, "random-talk-session-ended", { reason, message: endedStates.get(item.userId)?.message || "Conversation ended." }));
  if (options.requeueActor && actor) {
    const profile = profiles.get(actor.userId);
    endedStates.delete(actor.userId);
    if (profile) queue.set(actor.userId, { ...profile, joinedAt: nowIso() });
  }
  session.users.forEach((item) => emitState(item.userId));
  setTimeout(() => sessions.delete(session.id), RECENT_SESSION_MS).unref?.();
}

function cleanText(value) {
  return String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
}

function unsafeContent(text) {
  if (/https?:\/\/|www\.|\b[a-z0-9.-]+\.(com|net|org|gg|io|me)\b/i.test(text)) return "Links are blocked in Random Talk.";
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)) return "Email addresses are blocked in Random Talk.";
  if (/(?:\+?\d[\s().-]*){7,}/.test(text)) return "Phone numbers are blocked in Random Talk.";
  if (/(^|\s)@[a-z0-9_.]{3,}/i.test(text)) return "Social-media handles are blocked in Random Talk.";
  const blocked = String(process.env.RANDOM_TALK_BLOCKED_WORDS || process.env.CHAT_BLOCKED_WORDS || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (blocked.some((word) => text.toLowerCase().includes(word))) return "That message is not allowed in Random Talk.";
  return "";
}

function checkMessageRate(userId, body) {
  const id = Number(userId);
  const now = Date.now();
  const window = (messageWindows.get(id) || []).filter((item) => now - item.at < 5000);
  if (window.length >= 6 || (window.length && now - window.at(-1).at < 350)) throw fail("Please slow down before sending another message.", 429, "MESSAGE_RATE_LIMIT");
  if (window.some((item) => item.body === body && now - item.at < 10000)) throw fail("That message was already sent.", 409, "DUPLICATE_MESSAGE");
  window.push({ at: now, body });
  messageWindows.set(id, window);
}

async function message(user, input = {}) {
  assertAccess(user);
  const session = activeSession(user.id);
  if (!session) throw fail("This Random Talk conversation has ended.", 409, "SESSION_ENDED");
  const body = cleanText(input.body);
  if (!body) throw fail("Write a message first.", 422, "MESSAGE_EMPTY");
  if (body.length > MAX_MESSAGE_LENGTH) throw fail(`Random Talk messages can be up to ${MAX_MESSAGE_LENGTH} characters.`, 422, "MESSAGE_TOO_LONG");
  const unsafe = unsafeContent(body);
  if (unsafe) throw fail(unsafe, 422, "PRIVATE_INFO_BLOCKED");
  checkMessageRate(user.id, body);
  const clientMessageId = /^[a-z0-9-]{8,64}$/i.test(String(input.clientMessageId || "")) ? String(input.clientMessageId) : crypto.randomUUID();
  const item = { id: crypto.randomUUID(), senderId: Number(user.id), body, createdAt: nowIso() };
  try {
    await pool.query(
      "INSERT INTO random_talk_messages (id, session_id, sender_id, message_text, client_message_id) VALUES (?, ?, ?, ?, ?)",
      [item.id, session.id, user.id, body, clientMessageId]
    );
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return { duplicate: true };
    throw error;
  }
  session.messages.push(item);
  session.messages = session.messages.slice(-40);
  session.lastActivityAt = item.createdAt;
  if (Date.now() - session.lastPersistAt > 30000) {
    session.lastPersistAt = Date.now();
    pool.query("UPDATE random_talk_sessions SET last_activity_at = UTC_TIMESTAMP() WHERE id = ?", [session.id]).catch(() => {});
  }
  session.users.forEach((recipient) => notifySocketUser(recipient.userId, "random-talk-message", publicMessage(item, recipient.userId)));
  return publicMessage(item, user.id);
}

function typing(userId, value) {
  const session = activeSession(userId);
  if (!session) return false;
  const now = Date.now();
  if (now - Number(typingTimes.get(Number(userId)) || 0) < 800) return false;
  typingTimes.set(Number(userId), now);
  const other = partner(session, userId);
  if (other?.connected !== false) notifySocketUser(other.userId, "random-talk-typing", { typing: Boolean(value) });
  return true;
}

async function skip(userId) {
  return withMatchLock(async () => {
    const id = Number(userId);
    const last = Number(skipTimes.get(id) || 0);
    if (Date.now() - last < SKIP_COOLDOWN_MS) throw fail("Wait a moment before skipping again.", 429, "SKIP_COOLDOWN");
    const session = activeSession(id);
    if (!session) throw fail("There is no stranger to skip.", 409, "NO_ACTIVE_SESSION");
    skipTimes.set(id, Date.now());
    await endSession(session, id, "skipped", { requeueActor: true, partnerMessage: "The stranger ended the conversation." });
    await drainQueue();
    return publicState(id);
  });
}

function recentSessionFor(userId) {
  const recent = recentSessions.get(Number(userId));
  if (!recent || recent.expiresAt < Date.now()) return null;
  return sessions.get(recent.sessionId) || null;
}

async function report(user, input = {}) {
  const category = String(input.category || "");
  if (!REPORT_CATEGORIES.has(category)) throw fail("Choose a valid report category.", 422, "REPORT_CATEGORY_INVALID");
  const details = cleanText(input.details).slice(0, 500);
  const session = activeSession(user.id) || recentSessionFor(user.id);
  if (!session) throw fail("That conversation is no longer available to report.", 404, "REPORT_SESSION_EXPIRED");
  const reported = partner(session, user.id);
  if (!reported) throw fail("Reported stranger not found.", 404);
  const context = session.messages.slice(-20).map((item) => ({ sender: Number(item.senderId) === Number(user.id) ? "reporter" : "reported", body: item.body.slice(0, MAX_MESSAGE_LENGTH), createdAt: item.createdAt }));
  const [result] = await pool.query(
    `INSERT IGNORE INTO random_talk_reports
      (session_id, reporter_user_id, reported_user_id, category, details, context_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [session.id, user.id, reported.userId, category, details, JSON.stringify(context)]
  );
  if (!result.affectedRows) throw fail("You already reported this conversation.", 409, "REPORT_DUPLICATE");
  broadcast("report-created", { randomTalk: true });
  notifySocketUser(user.id, "random-talk-report-confirmed", { ok: true });
  if (session.status === "active" && input.skip !== false) {
    await withMatchLock(() => endSession(session, user.id, "reported", { actorMessage: "Report sent. The conversation has ended.", partnerMessage: "The conversation ended." }));
  }
  return { ok: true };
}

async function block(userId) {
  return withMatchLock(async () => {
    const id = Number(userId);
    const session = activeSession(id) || recentSessionFor(id);
    if (!session) throw fail("That stranger is no longer available to block.", 404, "BLOCK_SESSION_EXPIRED");
    const other = partner(session, id);
    if (!other) throw fail("Stranger not found.", 404);
    await pool.query("INSERT IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)", [id, other.userId]);
    await pool.query("DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)", [id, other.userId, other.userId, id]);
    blockCache.set(pairKey(id, other.userId), { blocked: true, expiresAt: Date.now() + 60000 });
    if (session.status === "active") await endSession(session, id, "blocked", { actorMessage: "Stranger blocked. You will not be matched again.", partnerMessage: "The conversation ended." });
    return { ok: true };
  });
}

async function leave(userId) {
  return withMatchLock(async () => {
    const id = Number(userId);
    queue.delete(id);
    const session = activeSession(id);
    if (session) await endSession(session, id, "left", { partnerMessage: "The stranger disconnected." });
    profiles.delete(id); endedStates.delete(id);
    clearTimeout(disconnectTimers.get(id)); disconnectTimers.delete(id);
    emitState(id);
    return { ok: true };
  });
}

function reconnect(userId) {
  const id = Number(userId);
  connectedUsers.add(id);
  clearTimeout(disconnectTimers.get(id)); disconnectTimers.delete(id);
  const session = activeSession(id);
  if (session) {
    const self = member(session, id);
    if (self) self.connected = true;
    const other = partner(session, id);
    if (other) notifySocketUser(other.userId, "random-talk-partner-reconnected", { connected: true });
    emitSessionState(session);
  } else if (profiles.has(id)) emitState(id);
  return publicState(id);
}

function handleDisconnect(userId) {
  const id = Number(userId);
  connectedUsers.delete(id);
  queue.delete(id);
  const session = activeSession(id);
  if (!session) return;
  const self = member(session, id);
  if (self) self.connected = false;
  const other = partner(session, id);
  if (other) {
    notifySocketUser(other.userId, "random-talk-partner-disconnected", { reconnecting: true });
    emitState(other.userId);
  }
  clearTimeout(disconnectTimers.get(id));
  const timer = setTimeout(() => {
    disconnectTimers.delete(id);
    if (member(session, id)?.connected !== false || session.status !== "active") return;
    withMatchLock(() => endSession(session, id, "disconnected", { partnerMessage: "The stranger disconnected." })).catch(() => {});
  }, RECONNECT_MS);
  timer.unref?.(); disconnectTimers.set(id, timer);
}

async function restrictUser(actorId, targetUserId, minutes, reason) {
  const duration = Math.max(1, Math.min(10080, Number(minutes || 60)));
  const cleanReason = cleanText(reason).slice(0, 255) || "Random Talk safety restriction.";
  await pool.query("UPDATE users SET random_talk_restricted_until = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE), random_talk_restriction_reason = ? WHERE id = ?", [duration, cleanReason, targetUserId]);
  await pool.query("INSERT INTO admin_logs (actor_id, action, target_type, target_id, details) VALUES (?, 'random_talk_restrict', 'user', ?, ?)", [actorId, targetUserId, JSON.stringify({ minutes: duration, reason: cleanReason })]);
  invalidateUserCache(targetUserId);
  await leave(targetUserId);
  notifySocketUser(targetUserId, "random-talk-error", { code: "RANDOM_TALK_RESTRICTED", message: cleanReason });
  return { ok: true, minutes: duration };
}

async function initialize() {
  await pool.query(
    `UPDATE random_talk_sessions SET status = 'ended', ended_at = UTC_TIMESTAMP(), end_reason = 'server_restart'
     WHERE status = 'active'`
  );
}

setInterval(() => {
  withMatchLock(async () => {
    const now = Date.now();
    for (const [userId, entry] of queue) {
      if (now - new Date(entry.joinedAt).getTime() > QUEUE_TTL_MS) {
        queue.delete(userId);
        endedStates.set(userId, endedCopy("queue_timeout", null, "No suitable stranger was available. You can keep searching."));
        emitState(userId);
      }
    }
    for (const [key, time] of recentPairs) if (now - time > RECENT_PAIR_MS) recentPairs.delete(key);
    for (const [userId, recent] of recentSessions) if (recent.expiresAt < now) recentSessions.delete(userId);
    await drainQueue();
  }).catch((error) => console.error("[random-talk queue]", error.message));
}, 2000).unref?.();

module.exports = {
  INTERESTS: [...INTERESTS], REPORT_CATEGORIES: [...REPORT_CATEGORIES], initialize, join, search, cancelSearch,
  publicState, message, typing, skip, report, block, leave, reconnect, handleDisconnect, restrictUser,
};
