const crypto = require("crypto");
const pool = require("../database");

const configuredThreshold = Number(process.env.WELCOME_RETURN_THRESHOLD_MINUTES || 120);
const RETURN_THRESHOLD_MINUTES = Number.isFinite(configuredThreshold)
  ? Math.max(5, Math.min(10080, Math.round(configuredThreshold)))
  : 120;
const RETURN_THRESHOLD_MS = RETURN_THRESHOLD_MINUTES * 60 * 1000;

function sessionIdForToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function returnType(user, isNewRegistration) {
  if (isNewRegistration) return "new";
  const previousActivity = user.last_seen ? new Date(user.last_seen).getTime() : new Date(user.created_at || 0).getTime();
  if (!Number.isFinite(previousActivity) || Date.now() - previousActivity < RETURN_THRESHOLD_MS) return null;
  return "returning";
}

async function createAuthSession(token, user, { isNewRegistration = false } = {}) {
  const id = sessionIdForToken(token);
  const welcomeType = returnType(user, isNewRegistration);
  await pool.query(
    `INSERT IGNORE INTO welcome_sessions
      (id, user_id, previous_last_seen, welcome_type)
     VALUES (?, ?, ?, ?)`,
    [id, user.id, user.last_seen || null, welcomeType]
  );
  return id;
}

async function claimWelcomeChoice(token, user) {
  const id = sessionIdForToken(token);
  const claim = async () => (await pool.query(
    `UPDATE welcome_sessions
     SET presented_at = UTC_TIMESTAMP()
     WHERE id = ? AND user_id = ? AND welcome_type IS NOT NULL
       AND presented_at IS NULL AND completed_at IS NULL`,
    [id, user.id]
  ))[0];
  const read = async () => (await pool.query(
    "SELECT started_at, welcome_type FROM welcome_sessions WHERE id = ? AND user_id = ? LIMIT 1",
    [id, user.id]
  ))[0][0];
  let claimResult = await claim();
  let session = await read();
  if (!session) {
    await createAuthSession(token, user);
    claimResult = await claim();
    session = await read();
  }
  return {
    id: id.slice(0, 20),
    startedAt: session?.started_at || null,
    shouldShowWelcomeChoice: Boolean(claimResult.affectedRows && session?.welcome_type),
    welcomeType: session?.welcome_type || null,
  };
}

async function completeWelcomeChoice(sessionId, userId, action) {
  const allowed = new Set(["random-talk", "main-room", "dismissed"]);
  const selectedAction = allowed.has(action) ? action : "dismissed";
  await pool.query(
    `UPDATE welcome_sessions
     SET completed_at = COALESCE(completed_at, UTC_TIMESTAMP()), action = COALESCE(action, ?)
     WHERE id = ? AND user_id = ?`,
    [selectedAction, sessionId, userId]
  );
  return { ok: true };
}

module.exports = {
  RETURN_THRESHOLD_MINUTES,
  sessionIdForToken,
  createAuthSession,
  claimWelcomeChoice,
  completeWelcomeChoice,
};
