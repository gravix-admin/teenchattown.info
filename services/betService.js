const bcrypt = require("bcrypt");
const pool = require("../database");
const { broadcast, notifyUser } = require("./events");
const { invalidateUserCache } = require("../middleware/auth");

const BET_PREFIX = "::bet:";
const BOT_USERNAME = "TownBot";
const BOT_NAME = "Town Bot";
const COOLDOWN_SECONDS = 180;

function betBody(payload) {
  return `${BET_PREFIX}${JSON.stringify(payload)}`;
}

async function ensureBetBot() {
  const [[existing]] = await pool.query("SELECT id FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1", [BOT_USERNAME]);
  if (existing) {
    await pool.query("UPDATE users SET rank_name = 'bot', display_name = ?, profile_status = 'Invisible', show_online_status = 0 WHERE id = ?", [BOT_NAME, existing.id]);
    return existing.id;
  }
  const passwordHash = await bcrypt.hash(`town-bot-${Date.now()}`, 10);
  const [result] = await pool.query(
    `INSERT INTO users
     (username, email, password_hash, dob, age, gender, rank_name, display_name, avatar_url, bio, about_me, gold, diamonds, ip_address, country, frame, theme, profile_status, show_online_status)
     VALUES (?, ?, ?, '2000-01-01', 18, 'other', 'bot', ?, '/assets/avatar-other.svg', 'TeenChatTown system bot.', 'Runs community games and private system notices.', 0, 0, 'system', 'TeenChatTown', 'clean', 'dark', 'Invisible', 0)`,
    [BOT_USERNAME, `town-bot-${Date.now()}@teens-town.local`, passwordHash, BOT_NAME]
  );
  return result.insertId;
}

async function roomMessage(messageId) {
  const [[message]] = await pool.query(
    `SELECT m.*, COALESCE(NULLIF(u.display_name, ''), u.username) AS username, u.rank_name, u.profile_title, u.avatar_url, u.username_color, u.text_color, u.bubble_style, u.frame
     FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?`,
    [messageId]
  );
  return message;
}

async function sendBetResult(roomId, payload) {
  const botUserId = await ensureBetBot();
  const [result] = await pool.query("INSERT INTO messages (room_id, user_id, body) VALUES (?, ?, ?)", [roomId, botUserId, betBody(payload)]);
  const message = await roomMessage(result.insertId);
  broadcast("message", message);
  return message;
}

async function sendCooldownNotice(user, secondsRemaining) {
  const botUserId = await ensureBetBot();
  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;
  const body = `Please wait ${minutes ? `${minutes}m ` : ""}${seconds}s before using /bet again.`;
  const [result] = await pool.query("INSERT INTO private_messages (sender_id, receiver_id, body) VALUES (?, ?, ?)", [botUserId, user.id, body]);
  const payload = {
    id: result.insertId,
    sender_id: botUserId,
    senderId: botUserId,
    sender_username: BOT_NAME,
    senderUsername: BOT_NAME,
    receiver_id: user.id,
    receiverId: user.id,
    body,
    created_at: new Date(),
    createdAt: new Date(),
  };
  notifyUser(user.id, "private-message", payload);
  return { private: true, cooldown: true, cooldownSeconds: secondsRemaining, message: `${BOT_NAME}: ${body}` };
}

function chooseOutcome() {
  const roll = Math.random();
  if (roll < 0.25) return { outcome: "lost", multiplier: 0 };
  if (roll < 0.55) return { outcome: "neutral", multiplier: 1 };
  if (roll < 0.80) return { outcome: "won", multiplier: 2 };
  return { outcome: "won", multiplier: 5 };
}

async function handleBetCommand(roomId, user, amount) {
  const wager = Math.floor(Number(amount));
  if (!Number.isFinite(wager) || wager < 1 || wager > 100000000) {
    const error = new Error('Use /bet "gold amount" with an amount between 1 and 100,000,000.');
    error.status = 400;
    throw error;
  }
  const connection = await pool.getConnection();
  let resultPayload;
  try {
    await connection.beginTransaction();
    const [[account]] = await connection.query(
      `SELECT gold, GREATEST(0, ? - COALESCE(TIMESTAMPDIFF(SECOND, last_bet_at, UTC_TIMESTAMP()), ?)) AS cooldown_remaining
       FROM users WHERE id = ? FOR UPDATE`,
      [COOLDOWN_SECONDS, COOLDOWN_SECONDS, user.id]
    );
    const remaining = Number(account?.cooldown_remaining || 0);
    if (remaining > 0) {
      await connection.rollback();
      return sendCooldownNotice(user, remaining);
    }
    if (!account || Number(account.gold) < wager) {
      await connection.rollback();
      const error = new Error("Insufficient gold.");
      error.status = 400;
      throw error;
    }
    const selected = chooseOutcome();
    const resultAmount = wager * selected.multiplier;
    const nextGold = Math.min(2000000000, Number(account.gold) - wager + resultAmount);
    await connection.query("UPDATE users SET gold = ?, last_bet_at = UTC_TIMESTAMP() WHERE id = ?", [nextGold, user.id]);
    await connection.commit();
    invalidateUserCache(user.id);
    resultPayload = {
      username: user.username,
      amount: wager,
      outcome: selected.outcome,
      multiplier: selected.multiplier,
      resultAmount,
      balance: nextGold,
    };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
  return sendBetResult(roomId, resultPayload);
}

module.exports = {
  BET_PREFIX,
  handleBetCommand,
  ensureTownBot: ensureBetBot,
  roomMessage,
};
