const pool = require("../database");

const START_COST = 80;
const CONNECTION_COST = 60;
const MINUTE_COST = 20;

function totalCost(activeSeconds) {
  const startedMinutes = Math.max(1, Math.ceil(Math.max(0, Number(activeSeconds || 0)) / 60));
  return CONNECTION_COST + startedMinutes * MINUTE_COST;
}

function walletError(message, code = "INSUFFICIENT_CREDITS") {
  const error = new Error(message);
  error.status = 402;
  error.code = code;
  return error;
}

function identity(user) {
  return user?.isGuest
    ? { type: "guest", id: Number(user.guestSessionId), key: `guest:${Number(user.guestSessionId)}` }
    : { type: "user", id: Number(user?.id), key: `user:${Number(user?.id)}` };
}

async function ensureWallet(user) {
  const owner = identity(user);
  if (owner.type === "guest") {
    const [[row]] = await pool.query("SELECT credit_balance FROM guest_sessions WHERE id = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP()", [owner.id]);
    if (!row) throw walletError("Your guest session expired. Start a new guest session or create an account.", "GUEST_SESSION_EXPIRED");
    return Number(row.credit_balance || 0);
  }
  await pool.query("INSERT IGNORE INTO user_wallets (user_id, credit_balance) VALUES (?, 500)", [owner.id]);
  const [[row]] = await pool.query("SELECT credit_balance FROM user_wallets WHERE user_id = ?", [owner.id]);
  return Number(row?.credit_balance || 0);
}

async function lockBalance(connection, owner) {
  const table = owner.type === "guest" ? "guest_sessions" : "user_wallets";
  const column = owner.type === "guest" ? "id" : "user_id";
  const [[row]] = await connection.query(`SELECT credit_balance FROM ${table} WHERE ${column} = ? FOR UPDATE`, [owner.id]);
  if (!row) throw walletError(owner.type === "guest" ? "Your guest session expired." : "Wallet unavailable.", "WALLET_UNAVAILABLE");
  return Number(row.credit_balance || 0);
}

async function updateBalance(connection, owner, value) {
  const table = owner.type === "guest" ? "guest_sessions" : "user_wallets";
  const column = owner.type === "guest" ? "id" : "user_id";
  await connection.query(`UPDATE ${table} SET credit_balance = ? WHERE ${column} = ?`, [value, owner.id]);
}

async function ledger(connection, owner, { amount, before, after, type, referenceId, idempotencyKey, metadata }) {
  await connection.query(
    `INSERT INTO credit_transactions
      (user_id, guest_session_id, transaction_type, amount, balance_before, balance_after, reference_type, reference_id, idempotency_key, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, 'random_match', ?, ?, ?)`,
    [owner.type === "user" ? owner.id : null, owner.type === "guest" ? owner.id : null, type, amount, before, after, referenceId, idempotencyKey, JSON.stringify(metadata || {})]
  );
}

async function chargePair(users, { amount, type, referenceId, keySuffix, metadata = {} }) {
  const owners = users.map(identity).sort((a, b) => a.key.localeCompare(b.key));
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const balances = new Map();
    for (const owner of owners) balances.set(owner.key, await lockBalance(connection, owner));
    const lacking = owners.find((owner) => Number(balances.get(owner.key)) < amount);
    if (lacking) throw walletError("Not enough credits to continue this conversation.");
    const result = {};
    for (const owner of owners) {
      const before = Number(balances.get(owner.key));
      const after = before - amount;
      await updateBalance(connection, owner, after);
      await ledger(connection, owner, {
        amount: -amount,
        before,
        after,
        type,
        referenceId,
        idempotencyKey: `${referenceId}:${owner.key}:${keySuffix}`,
        metadata,
      });
      result[owner.key] = after;
    }
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error.code === "ER_DUP_ENTRY") {
      const result = {};
      for (const user of users) result[identity(user).key] = await ensureWallet(user);
      return result;
    }
    throw error;
  } finally {
    connection.release();
  }
}

function chargeMatchStart(users, matchId) {
  return chargePair(users, {
    amount: START_COST,
    type: "random_match_start",
    referenceId: matchId,
    keySuffix: "start",
    metadata: { connectionFee: CONNECTION_COST, firstStartedMinute: MINUTE_COST },
  });
}

function chargeStartedMinute(users, matchId, minute) {
  return chargePair(users, {
    amount: MINUTE_COST,
    type: "random_match_minute",
    referenceId: matchId,
    keySuffix: `minute:${minute}`,
    metadata: { startedMinute: minute },
  });
}

module.exports = { START_COST, CONNECTION_COST, MINUTE_COST, totalCost, identity, ensureWallet, chargeMatchStart, chargeStartedMinute };
