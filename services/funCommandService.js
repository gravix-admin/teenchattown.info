const pool = require("../database");
const { broadcast } = require("./events");
const { invalidateUserCache } = require("../middleware/auth");
const { ensureTownBot, roomMessage } = require("./betService");

const CONFESS_PREFIX = "::confess:";
const SHIP_PREFIX = "::ship:";
const STEAL_PREFIX = "::steal:";
const HUNT_PREFIX = "::hunt:";
const FUN_PREFIXES = [CONFESS_PREFIX, SHIP_PREFIX, STEAL_PREFIX, HUNT_PREFIX];
const ECONOMY_COOLDOWN_SECONDS = 10 * 60;
const MAX_BALANCE = 2000000000;

function commandError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function encodedBody(prefix, payload) {
  return `${prefix}${JSON.stringify(payload)}`;
}

async function sendBotResult(roomId, prefix, payload, wallet = null) {
  const botUserId = await ensureTownBot();
  const [result] = await pool.query(
    "INSERT INTO messages (room_id, user_id, body) VALUES (?, ?, ?)",
    [roomId, botUserId, encodedBody(prefix, payload)]
  );
  const message = await roomMessage(result.insertId);
  broadcast("message", message);
  return wallet ? { ...message, wallet } : message;
}

function stripWrappingQuotes(value) {
  const text = String(value || "").trim();
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    return text.slice(1, -1).trim();
  }
  return text;
}

async function handleConfess(roomId, rawMessage) {
  const message = stripWrappingQuotes(rawMessage).slice(0, 700);
  if (!message) throw commandError('Use /confess "your message".');
  return sendBotResult(roomId, CONFESS_PREFIX, { message });
}

function stableShipPercent(first, second) {
  const pair = [first.toLowerCase(), second.toLowerCase()].sort().join("x");
  let hash = 2166136261;
  for (const character of pair) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % 101;
}

function shipLine(percent) {
  if (percent < 25) return "The vibe is currently on airplane mode.";
  if (percent < 50) return "A risky plot twist, but not impossible.";
  if (percent < 70) return "Suspiciously decent chemistry.";
  if (percent < 90) return "Chaotic chemistry. The moderators are concerned.";
  return "TownBot is already planning the wedding.";
}

async function handleShip(roomId, firstName, secondName) {
  const [users] = await pool.query(
    "SELECT id, username FROM users WHERE LOWER(username) IN (LOWER(?), LOWER(?)) AND rank_name <> 'bot' LIMIT 2",
    [firstName, secondName]
  );
  const first = users.find((user) => user.username.toLowerCase() === firstName.toLowerCase());
  const second = users.find((user) => user.username.toLowerCase() === secondName.toLowerCase());
  if (!first || !second) throw commandError("Both users must be valid TeenChatTown usernames.", 404);
  if (Number(first.id) === Number(second.id)) throw commandError("Ship two different users.");
  const percent = stableShipPercent(first.username, second.username);
  return sendBotResult(roomId, SHIP_PREFIX, {
    first: first.username,
    second: second.username,
    percent,
    line: shipLine(percent),
  });
}

async function handleHunt(roomId, user) {
  const connection = await pool.getConnection();
  let reward;
  let balance;
  try {
    await connection.beginTransaction();
    const [[account]] = await connection.query(
      `SELECT diamonds,
        GREATEST(0, ? - COALESCE(TIMESTAMPDIFF(SECOND, last_hunt_at, UTC_TIMESTAMP()), ?)) AS cooldown_remaining
       FROM users WHERE id = ? FOR UPDATE`,
      [ECONOMY_COOLDOWN_SECONDS, ECONOMY_COOLDOWN_SECONDS, user.id]
    );
    if (!account) throw commandError("Account not found.", 404);
    const remaining = Number(account.cooldown_remaining || 0);
    if (remaining > 0) throw commandError(`Your next hunt opens in ${Math.ceil(remaining / 60)} minute${Math.ceil(remaining / 60) === 1 ? "" : "s"}.`, 429);
    reward = randomInt(5, 50);
    balance = Math.min(MAX_BALANCE, Number(account.diamonds || 0) + reward);
    await connection.query("UPDATE users SET diamonds = ?, last_hunt_at = UTC_TIMESTAMP() WHERE id = ?", [balance, user.id]);
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
  invalidateUserCache(user.id);
  return sendBotResult(roomId, HUNT_PREFIX, {
    username: user.username,
    reward,
    line: reward >= 40 ? "Jackpot trail. The caves were generous." : reward >= 20 ? "Solid haul. Worth the muddy boots." : "Small trail, clean profit.",
  }, { diamonds: balance });
}

async function handleSteal(roomId, user, targetName) {
  const [[targetLookup]] = await pool.query(
    "SELECT id, username, rank_name FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1",
    [targetName]
  );
  if (!targetLookup || targetLookup.rank_name === "bot") throw commandError("Choose a valid user to steal from.", 404);
  if (Number(targetLookup.id) === Number(user.id)) throw commandError("You cannot steal from yourself.");

  const connection = await pool.getConnection();
  let payload;
  let actorGold;
  try {
    await connection.beginTransaction();
    const [accounts] = await connection.query(
      `SELECT id, username, gold,
        CASE WHEN id = ? THEN GREATEST(0, ? - COALESCE(TIMESTAMPDIFF(SECOND, last_steal_at, UTC_TIMESTAMP()), ?)) ELSE 0 END AS cooldown_remaining
       FROM users WHERE id IN (?, ?) ORDER BY id FOR UPDATE`,
      [user.id, ECONOMY_COOLDOWN_SECONDS, ECONOMY_COOLDOWN_SECONDS, user.id, targetLookup.id]
    );
    const actor = accounts.find((account) => Number(account.id) === Number(user.id));
    const target = accounts.find((account) => Number(account.id) === Number(targetLookup.id));
    if (!actor || !target) throw commandError("User account could not be loaded.", 404);
    const remaining = Number(actor.cooldown_remaining || 0);
    if (remaining > 0) throw commandError(`Your next steal attempt opens in ${Math.ceil(remaining / 60)} minute${Math.ceil(remaining / 60) === 1 ? "" : "s"}.`, 429);
    if (Number(actor.gold || 0) < 1) throw commandError("You need at least 1 gold to risk a steal.");
    if (Number(target.gold || 0) < 1) throw commandError(`${target.username} has no carried gold to steal.`);

    const success = Math.random() < 0.55;
    const percent = success ? randomInt(5, 20) : randomInt(5, 15);
    if (success) {
      const amount = Math.min(Number(target.gold), Math.max(1, Math.floor(Number(target.gold) * percent / 100)));
      actorGold = Math.min(MAX_BALANCE, Number(actor.gold) + amount);
      const targetGold = Number(target.gold) - amount;
      await connection.query("UPDATE users SET gold = ?, last_steal_at = UTC_TIMESTAMP() WHERE id = ?", [actorGold, actor.id]);
      await connection.query("UPDATE users SET gold = ? WHERE id = ?", [targetGold, target.id]);
      payload = { success: true, actor: actor.username, target: target.username, amount, percent, line: "Clean getaway. Nobody saw a thing." };
    } else {
      const amount = Math.min(Number(actor.gold), Math.max(1, Math.floor(Number(actor.gold) * percent / 100)));
      actorGold = Number(actor.gold) - amount;
      const targetGold = Math.min(MAX_BALANCE, Number(target.gold) + amount);
      await connection.query("UPDATE users SET gold = ?, last_steal_at = UTC_TIMESTAMP() WHERE id = ?", [actorGold, actor.id]);
      await connection.query("UPDATE users SET gold = ? WHERE id = ?", [targetGold, target.id]);
      payload = { success: false, actor: actor.username, target: target.username, amount, percent, line: "Caught red-handed. Compensation delivered." };
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
  invalidateUserCache(user.id);
  invalidateUserCache(targetLookup.id);
  return sendBotResult(roomId, STEAL_PREFIX, payload, { gold: actorGold });
}

async function handleFunCommand(roomId, user, body) {
  const confess = body.match(/^\/confess(?:\s+([\s\S]+))?$/i);
  if (confess) return handleConfess(roomId, confess[1]);

  const ship = body.match(/^\/ship\s+@?([a-zA-Z0-9_]{3,18})\s+@?([a-zA-Z0-9_]{3,18})\s*$/i);
  if (/^\/ship(?:\s|$)/i.test(body)) {
    if (!ship) throw commandError("Use /ship @user1 @user2.");
    return handleShip(roomId, ship[1], ship[2]);
  }

  const steal = body.match(/^\/steal\s+@?([a-zA-Z0-9_]{3,18})\s*$/i);
  if (/^\/steal(?:\s|$)/i.test(body)) {
    if (!steal) throw commandError("Use /steal @user.");
    return handleSteal(roomId, user, steal[1]);
  }

  if (/^\/hunt\s*$/i.test(body)) return handleHunt(roomId, user);
  if (/^\/hunt(?:\s|$)/i.test(body)) throw commandError("Use /hunt with no extra text.");
  return null;
}

module.exports = {
  CONFESS_PREFIX,
  SHIP_PREFIX,
  STEAL_PREFIX,
  HUNT_PREFIX,
  FUN_PREFIXES,
  handleFunCommand,
};
