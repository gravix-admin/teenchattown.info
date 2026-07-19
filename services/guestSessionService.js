const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const pool = require("../database");

const GUEST_CREDITS = 500;
const MAX_NEW_SESSIONS_PER_DAY = Math.max(1, Math.min(10, Number(process.env.GUEST_SESSIONS_PER_DAY || 3)));
const SESSION_MINUTES = Math.max(30, Math.min(24 * 60, Number(process.env.GUEST_SESSION_MINUTES || 180)));

function guestError(message, status = 400, code = "GUEST_ERROR") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function cleanDisplayName(value) {
  const name = String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (name.length < 3 || name.length > 18) throw guestError("Guest names must be 3–18 characters.", 422, "GUEST_NAME_INVALID");
  if (!/^[\p{L}\p{N} _-]+$/u.test(name)) throw guestError("Use only letters, numbers, spaces, underscores or hyphens.", 422, "GUEST_NAME_INVALID");
  if (/admin|moderator|developer|owner|chief|staff|townbot|teenchattown/i.test(name)) {
    throw guestError("Choose a name that does not imitate TeenChatTown staff.", 422, "GUEST_NAME_RESERVED");
  }
  return name;
}

function cleanAgeBand(value) {
  if (!new Set(["minor", "adult"]).has(String(value))) throw guestError("Choose your age group.", 422, "GUEST_AGE_REQUIRED");
  return String(value);
}

function hashSignal(value, purpose) {
  return crypto.createHmac("sha256", process.env.JWT_SECRET).update(`${purpose}:${String(value || "unknown")}`).digest("hex");
}

function networkHash(ipAddress) { return hashSignal(ipAddress, "guest-network"); }

function signGuest(row) {
  return jwt.sign(
    { kind: "guest", gid: Number(row.id), sk: row.session_key, v: Number(row.token_version || 0) },
    process.env.JWT_SECRET,
    { expiresIn: `${SESSION_MINUTES}m`, audience: "teenchattown-random-talk", issuer: "teenchattown" }
  );
}

function publicGuest(row) {
  if (!row) return null;
  return {
    id: -Number(row.id),
    guestSessionId: Number(row.id),
    identityType: "guest",
    identityKey: `guest:${Number(row.id)}`,
    isGuest: true,
    username: row.display_name,
    display_name: row.display_name,
    age: row.age_band === "adult" ? 18 : 13,
    ageBand: row.age_band,
    creditBalance: Number(row.credit_balance || 0),
    random_talk_restricted_until: row.restricted_until,
    random_talk_restriction_reason: row.restriction_reason || "",
    expiresAt: row.expires_at,
  };
}

async function createGuestSession({ displayName, ageBand, deviceId, ipAddress }) {
  const name = cleanDisplayName(displayName);
  const band = cleanAgeBand(ageBand);
  const device = String(deviceId || "").trim();
  if (!/^[a-z0-9-]{16,80}$/i.test(device)) throw guestError("Guest access needs this browser's temporary device key.", 422, "GUEST_DEVICE_REQUIRED");
  const deviceHash = hashSignal(device, "guest-device");
  const ipHash = networkHash(ipAddress);

  const [[networkBan]] = await pool.query(
    `SELECT id FROM guest_network_bans
     WHERE ip_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())
     LIMIT 1`,
    [ipHash]
  );
  if (networkBan) throw guestError("Guest access is blocked on this network. Log in to contact support.", 403, "GUEST_NETWORK_BANNED");

  const [[existing]] = await pool.query(
    `SELECT * FROM guest_sessions
     WHERE device_hash = ? AND ip_hash = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP()
     ORDER BY created_at DESC LIMIT 1`,
    [deviceHash, ipHash]
  );
  if (existing) {
    await pool.query(
      "UPDATE guest_sessions SET display_name = ?, age_band = ?, last_seen_at = UTC_TIMESTAMP(), expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE) WHERE id = ?",
      [name, band, SESSION_MINUTES, existing.id]
    );
    const [[fresh]] = await pool.query("SELECT * FROM guest_sessions WHERE id = ?", [existing.id]);
    return { token: signGuest(fresh), guest: publicGuest(fresh), reused: true };
  }

  const [[recent]] = await pool.query(
    `SELECT COUNT(*) AS count FROM guest_sessions
     WHERE device_hash = ? AND ip_hash = ? AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)`,
    [deviceHash, ipHash]
  );
  if (Number(recent?.count || 0) >= MAX_NEW_SESSIONS_PER_DAY) {
    throw guestError("Guest access limit reached for this browser today. Create an account to continue.", 429, "GUEST_LIMIT_REACHED");
  }

  const sessionKey = crypto.randomUUID();
  const [result] = await pool.query(
    `INSERT INTO guest_sessions
      (session_key, display_name, age_band, credit_balance, device_hash, ip_hash, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE))`,
    [sessionKey, name, band, GUEST_CREDITS, deviceHash, ipHash, SESSION_MINUTES]
  );
  await pool.query(
    `INSERT INTO credit_transactions
      (guest_session_id, transaction_type, amount, balance_before, balance_after, reference_type, reference_id, idempotency_key, metadata_json)
     VALUES (?, 'welcome_grant', ?, 0, ?, 'guest_session', ?, ?, ?)`,
    [result.insertId, GUEST_CREDITS, GUEST_CREDITS, sessionKey, `welcome:guest:${sessionKey}`, JSON.stringify({ temporary: true })]
  );
  const [[row]] = await pool.query("SELECT * FROM guest_sessions WHERE id = ?", [result.insertId]);
  return { token: signGuest(row), guest: publicGuest(row), reused: false };
}

async function guestFromPayload(payload, { touch = true } = {}) {
  if (payload?.kind !== "guest" || !Number.isInteger(Number(payload.gid)) || !payload.sk) return null;
  const [[row]] = await pool.query(
    `SELECT gs.* FROM guest_sessions gs
     LEFT JOIN guest_network_bans b ON b.ip_hash = gs.ip_hash AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > UTC_TIMESTAMP())
     WHERE gs.id = ? AND gs.session_key = ? AND gs.token_version = ? AND gs.revoked_at IS NULL AND gs.expires_at > UTC_TIMESTAMP()
       AND b.id IS NULL
     LIMIT 1`,
    [Number(payload.gid), String(payload.sk), Number(payload.v || 0)]
  );
  if (!row) return null;
  if (touch && (!row.last_seen_at || Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60 * 1000)) {
    pool.query("UPDATE guest_sessions SET last_seen_at = UTC_TIMESTAMP(), expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE) WHERE id = ?", [SESSION_MINUTES, row.id]).catch(() => {});
  }
  return publicGuest(row);
}

async function revokeGuest(guestSessionId) {
  await pool.query("UPDATE guest_sessions SET revoked_at = UTC_TIMESTAMP(), token_version = token_version + 1 WHERE id = ?", [guestSessionId]);
}

async function banNetwork({ ipHash, actorUserId, reportId, minutes, reason }) {
  const duration = Number(minutes || 0);
  const cleanReason = String(reason || "Random Talk safety ban.").replace(/\s+/g, " ").trim().slice(0, 255);
  const [result] = await pool.query(
    `INSERT INTO guest_network_bans (ip_hash, reason, actor_user_id, source_report_id, expires_at)
     VALUES (?, ?, ?, ?, ${duration > 0 ? "DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE)" : "NULL"})`,
    duration > 0 ? [ipHash, cleanReason, actorUserId, reportId || null, Math.min(525600, Math.max(1, duration))] : [ipHash, cleanReason, actorUserId, reportId || null]
  );
  const [rows] = await pool.query("SELECT id FROM guest_sessions WHERE ip_hash = ? AND revoked_at IS NULL", [ipHash]);
  await pool.query("UPDATE guest_sessions SET revoked_at = UTC_TIMESTAMP(), token_version = token_version + 1 WHERE ip_hash = ? AND revoked_at IS NULL", [ipHash]);
  return { id: result.insertId, guestIds: rows.map((row) => Number(row.id)), reason: cleanReason };
}

module.exports = {
  GUEST_CREDITS,
  SESSION_MINUTES,
  cleanDisplayName,
  networkHash,
  banNetwork,
  createGuestSession,
  guestFromPayload,
  publicGuest,
  revokeGuest,
};
