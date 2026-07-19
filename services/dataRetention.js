const pool = require("../database");

const CHAT_RETENTION_MINUTES = 90;
const PRIVATE_MESSAGE_RETENTION_DAYS = 7;
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const RANDOM_TALK_MESSAGE_RETENTION_DAYS = Math.max(1, Math.min(30, Number(process.env.RANDOM_TALK_RETENTION_DAYS || 7)));
const RANDOM_TALK_SESSION_RETENTION_DAYS = Math.max(7, Math.min(90, Number(process.env.RANDOM_TALK_SESSION_RETENTION_DAYS || 30)));

let cleanupTimer = null;
let cleanupRunning = false;

async function cleanExpiredData() {
  if (cleanupRunning) return;
  cleanupRunning = true;
  try {
    await pool.query(
      `DELETE mr FROM message_reactions mr
       JOIN messages m ON m.id = mr.message_id
       WHERE m.created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE) AND m.is_pinned = 0`,
      [CHAT_RETENTION_MINUTES]
    );
    await pool.query(
      `UPDATE reports r JOIN messages m ON m.id = r.message_id
       SET r.message_id = NULL
       WHERE m.created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE) AND m.is_pinned = 0`,
      [CHAT_RETENTION_MINUTES]
    );
    await pool.query(
      `UPDATE intruder_rounds ir JOIN messages m ON m.id = ir.message_id
       SET ir.message_id = NULL
       WHERE m.created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE) AND m.is_pinned = 0`,
      [CHAT_RETENTION_MINUTES]
    );
    await pool.query(
      `DELETE FROM messages
       WHERE created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE) AND is_pinned = 0`,
      [CHAT_RETENTION_MINUTES]
    );
    await pool.query(
      `UPDATE reports r JOIN private_messages pm ON pm.id = r.private_message_id
       SET r.private_message_id = NULL
       WHERE pm.created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)`,
      [PRIVATE_MESSAGE_RETENTION_DAYS]
    );
    await pool.query(
      `DELETE FROM private_messages
       WHERE created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)`,
      [PRIVATE_MESSAGE_RETENTION_DAYS]
    );
    await pool.query("DELETE FROM notifications WHERE is_read = 1 AND created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 14 DAY)");
    await pool.query(
      "DELETE FROM random_talk_messages WHERE created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)",
      [RANDOM_TALK_MESSAGE_RETENTION_DAYS]
    );
    await pool.query(
      `DELETE s FROM random_talk_sessions s
       LEFT JOIN random_talk_reports r ON r.session_id = s.id
       WHERE r.id IS NULL AND s.ended_at IS NOT NULL
         AND s.ended_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)`,
      [RANDOM_TALK_SESSION_RETENTION_DAYS]
    );
    await pool.query("DELETE FROM welcome_sessions WHERE started_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 45 DAY)");
    await pool.query("UPDATE guest_sessions SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP()) WHERE expires_at < UTC_TIMESTAMP() AND revoked_at IS NULL");
    await pool.query("DELETE FROM random_talk_blocks WHERE expires_at IS NOT NULL AND expires_at < UTC_TIMESTAMP()");
  } catch (error) {
    console.error("[retention] cleanup failed:", error.message);
  } finally {
    cleanupRunning = false;
  }
}

function startDataRetention() {
  if (cleanupTimer) return;
  cleanExpiredData();
  cleanupTimer = setInterval(cleanExpiredData, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
}

module.exports = { cleanExpiredData, startDataRetention };
