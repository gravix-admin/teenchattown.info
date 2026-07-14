const express = require("express");
const pool = require("../database");
const { requireAuth, isStaff, invalidateUserCache } = require("../middleware/auth");
const { broadcast } = require("../services/events");
const { ensureTownBot, roomMessage } = require("../services/betService");

const router = express.Router();
const XO_PREFIX = "::xo:";
const XO_STAKE = 500;
const XO_WAIT_MINUTES = 1;
const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function gameError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function sendGameMessage(roomId, payload) {
  const botUserId = await ensureTownBot();
  const [result] = await pool.query(
    "INSERT INTO messages (room_id, user_id, body) VALUES (?, ?, ?)",
    [roomId, botUserId, `${XO_PREFIX}${JSON.stringify(payload)}`]
  );
  const message = await roomMessage(result.insertId);
  broadcast("message", message);
  return message;
}

async function gameDetails(connection, gameId) {
  const [[game]] = await connection.query(
    `SELECT g.*, DATE_ADD(g.created_at, INTERVAL ${XO_WAIT_MINUTES} MINUTE) AS expires_at,
            h.username AS host_name, p.username AS guest_name, w.username AS winner_name
     FROM xo_games g
     JOIN users h ON h.id = g.host_id
     LEFT JOIN users p ON p.id = g.guest_id
     LEFT JOIN users w ON w.id = g.winner_id
     WHERE g.id = ?`,
    [gameId]
  );
  return game || null;
}

async function expireWaitingGames(connection = pool) {
  await connection.query(
    `UPDATE xo_games
     SET status = 'expired'
     WHERE status = 'waiting'
       AND created_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${XO_WAIT_MINUTES} MINUTE)`
  );
}

function winnerSymbol(board) {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] !== "-" && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return null;
}

router.use(requireAuth);

router.get("/xo", async (req, res) => {
  const roomId = Number(req.query.roomId || 0);
  await expireWaitingGames();
  const [games] = await pool.query(
    `SELECT g.*, DATE_ADD(g.created_at, INTERVAL ${XO_WAIT_MINUTES} MINUTE) AS expires_at,
            h.username AS host_name, p.username AS guest_name, w.username AS winner_name
     FROM xo_games g
     JOIN users h ON h.id = g.host_id
     LEFT JOIN users p ON p.id = g.guest_id
     LEFT JOIN users w ON w.id = g.winner_id
     WHERE (g.status = 'waiting' ${roomId ? "AND g.room_id = ?" : ""})
        OR (g.status = 'playing' AND (g.host_id = ? OR g.guest_id = ?))
     ORDER BY g.updated_at DESC LIMIT 20`,
    roomId ? [roomId, req.user.id, req.user.id] : [req.user.id, req.user.id]
  );
  res.json({ stake: XO_STAKE, games });
});

router.get("/xo/:id", async (req, res) => {
  await expireWaitingGames();
  const game = await gameDetails(pool, req.params.id);
  if (!game) return res.status(404).json({ error: "X-O match not found." });
  if (game.status === "playing" && ![game.host_id, game.guest_id].map(Number).includes(Number(req.user.id)) && !isStaff(req.user)) {
    return res.status(403).json({ error: "This X-O match is private to its players." });
  }
  res.json({ ...game, stake: XO_STAKE, waitMinutes: XO_WAIT_MINUTES });
});

router.post("/xo", async (req, res) => {
  const roomId = Number(req.body.roomId);
  const [[room]] = await pool.query("SELECT id, staff_only FROM rooms WHERE id = ?", [roomId]);
  if (!room || (Number(room.staff_only) === 1 && !isStaff(req.user))) return res.status(403).json({ error: "Choose a room you can enter." });
  const [[account]] = await pool.query("SELECT gold FROM users WHERE id = ?", [req.user.id]);
  if (Number(account?.gold || 0) < XO_STAKE) return res.status(400).json({ error: `You need ${XO_STAKE} gold to start an X-O match.` });
  await expireWaitingGames();
  const [[active]] = await pool.query("SELECT id FROM xo_games WHERE (host_id = ? OR guest_id = ?) AND status IN ('waiting','playing') LIMIT 1", [req.user.id, req.user.id]);
  if (active) return res.status(400).json({ error: "Finish your active X-O match first.", gameId: active.id });
  const [result] = await pool.query("INSERT INTO xo_games (room_id, host_id) VALUES (?, ?)", [roomId, req.user.id]);
  await sendGameMessage(roomId, { type: "invite", gameId: result.insertId, host: req.user.username, stake: XO_STAKE });
  broadcast("xo-game", { gameId: result.insertId, roomId, status: "waiting" });
  res.status(201).json({ ...(await gameDetails(pool, result.insertId)), stake: XO_STAKE, waitMinutes: XO_WAIT_MINUTES });
});

router.post("/xo/:id/join", async (req, res) => {
  const connection = await pool.getConnection();
  let game;
  try {
    await connection.beginTransaction();
    await connection.query(
      `UPDATE xo_games SET status = 'expired'
       WHERE id = ? AND status = 'waiting'
         AND created_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${XO_WAIT_MINUTES} MINUTE)`,
      [req.params.id]
    );
    [[game]] = await connection.query("SELECT * FROM xo_games WHERE id = ? FOR UPDATE", [req.params.id]);
    if (!game || game.status !== "waiting") throw gameError("This X-O invitation is no longer open.", 409);
    if (Number(game.host_id) === Number(req.user.id)) throw gameError("You cannot join your own X-O invitation.");
    const [[otherActive]] = await connection.query("SELECT id FROM xo_games WHERE id <> ? AND (host_id = ? OR guest_id = ?) AND status IN ('waiting','playing') LIMIT 1 FOR UPDATE", [game.id, req.user.id, req.user.id]);
    if (otherActive) throw gameError("Finish your active X-O match first.", 409);
    const [players] = await connection.query("SELECT id, username, gold FROM users WHERE id IN (?, ?) ORDER BY id FOR UPDATE", [game.host_id, req.user.id]);
    if (players.length !== 2 || players.some((player) => Number(player.gold || 0) < XO_STAKE)) throw gameError(`Both players need ${XO_STAKE} gold for the match.`);
    await connection.query("UPDATE users SET gold = gold - ? WHERE id IN (?, ?)", [XO_STAKE, game.host_id, req.user.id]);
    await connection.query("UPDATE xo_games SET guest_id = ?, turn_user_id = host_id, status = 'playing', stakes_locked = 1 WHERE id = ?", [req.user.id, game.id]);
    await connection.commit();
    game = await gameDetails(pool, game.id);
  } catch (error) {
    await connection.rollback().catch(() => {});
    return res.status(error.status || 400).json({ error: error.message || "Could not join this X-O match." });
  } finally {
    connection.release();
  }
  invalidateUserCache(game.host_id);
  invalidateUserCache(game.guest_id);
  await sendGameMessage(game.room_id, { type: "joined", gameId: game.id, host: game.host_name, guest: game.guest_name, stake: XO_STAKE });
  broadcast("users-changed", { userId: game.host_id });
  broadcast("users-changed", { userId: game.guest_id });
  broadcast("xo-game", { gameId: game.id, roomId: game.room_id, status: "playing" });
  res.json(game);
});

router.post("/xo/:id/cancel", async (req, res) => {
  const connection = await pool.getConnection();
  let game;
  try {
    await connection.beginTransaction();
    [[game]] = await connection.query("SELECT * FROM xo_games WHERE id = ? FOR UPDATE", [req.params.id]);
    if (!game || game.status !== "waiting") throw gameError("Only an unstarted X-O match can be cancelled.", 409);
    if (Number(game.host_id) !== Number(req.user.id)) throw gameError("Only the player who opened this match can cancel it.", 403);
    await connection.query("UPDATE xo_games SET status = 'cancelled' WHERE id = ?", [game.id]);
    await connection.commit();
    game = await gameDetails(pool, game.id);
  } catch (error) {
    await connection.rollback().catch(() => {});
    return res.status(error.status || 400).json({ error: error.message || "Could not cancel this X-O match." });
  } finally {
    connection.release();
  }
  await sendGameMessage(game.room_id, { type: "cancelled", gameId: game.id, host: game.host_name });
  broadcast("xo-game", { gameId: game.id, roomId: game.room_id, status: game.status });
  res.json(game);
});

router.post("/xo/:id/move", async (req, res) => {
  const cell = Number(req.body.cell);
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) return res.status(400).json({ error: "Choose an empty square." });
  const connection = await pool.getConnection();
  let game;
  let resultType = "move";
  try {
    await connection.beginTransaction();
    [[game]] = await connection.query("SELECT * FROM xo_games WHERE id = ? FOR UPDATE", [req.params.id]);
    if (!game || game.status !== "playing") throw gameError("This X-O match is not active.", 409);
    if (Number(game.turn_user_id) !== Number(req.user.id)) throw gameError("Wait for your turn.", 409);
    const isHost = Number(game.host_id) === Number(req.user.id);
    if (!isHost && Number(game.guest_id) !== Number(req.user.id)) throw gameError("You are not playing this match.", 403);
    const board = String(game.board || "---------").padEnd(9, "-").slice(0, 9).split("");
    if (board[cell] !== "-") throw gameError("That square is already taken.", 409);
    board[cell] = isHost ? "X" : "O";
    const symbol = winnerSymbol(board);
    const draw = !symbol && board.every((value) => value !== "-");
    if (symbol) {
      const winnerId = symbol === "X" ? game.host_id : game.guest_id;
      await connection.query("UPDATE users SET gold = gold + ? WHERE id = ?", [XO_STAKE * 2, winnerId]);
      await connection.query("UPDATE xo_games SET board = ?, status = 'won', winner_id = ?, turn_user_id = NULL, stakes_locked = 0 WHERE id = ?", [board.join(""), winnerId, game.id]);
      resultType = "won";
    } else if (draw) {
      await connection.query("UPDATE users SET gold = gold + ? WHERE id IN (?, ?)", [XO_STAKE, game.host_id, game.guest_id]);
      await connection.query("UPDATE xo_games SET board = ?, status = 'draw', turn_user_id = NULL, stakes_locked = 0 WHERE id = ?", [board.join(""), game.id]);
      resultType = "draw";
    } else {
      const nextUserId = isHost ? game.guest_id : game.host_id;
      await connection.query("UPDATE xo_games SET board = ?, turn_user_id = ? WHERE id = ?", [board.join(""), nextUserId, game.id]);
    }
    await connection.commit();
    game = await gameDetails(pool, game.id);
  } catch (error) {
    await connection.rollback().catch(() => {});
    return res.status(error.status || 400).json({ error: error.message || "Could not play this move." });
  } finally {
    connection.release();
  }
  if (resultType !== "move") {
    invalidateUserCache(game.host_id);
    invalidateUserCache(game.guest_id);
    await sendGameMessage(game.room_id, {
      type: resultType,
      gameId: game.id,
      winner: game.winner_name,
      host: game.host_name,
      guest: game.guest_name,
      stake: XO_STAKE,
    });
    broadcast("users-changed", { userId: game.host_id });
    broadcast("users-changed", { userId: game.guest_id });
  }
  broadcast("xo-game", { gameId: game.id, roomId: game.room_id, status: game.status });
  res.json(game);
});

router.post("/xo/:id/forfeit", async (req, res) => {
  const connection = await pool.getConnection();
  let game;
  try {
    await connection.beginTransaction();
    [[game]] = await connection.query("SELECT * FROM xo_games WHERE id = ? FOR UPDATE", [req.params.id]);
    if (!game || game.status !== "playing" || !game.stakes_locked) throw gameError("This X-O match cannot be forfeited.", 409);
    const playerIds = [Number(game.host_id), Number(game.guest_id)];
    if (!playerIds.includes(Number(req.user.id))) throw gameError("You are not playing this match.", 403);
    const winnerId = Number(req.user.id) === Number(game.host_id) ? game.guest_id : game.host_id;
    await connection.query("UPDATE users SET gold = gold + ? WHERE id = ?", [XO_STAKE * 2, winnerId]);
    await connection.query("UPDATE xo_games SET status = 'won', winner_id = ?, turn_user_id = NULL, stakes_locked = 0 WHERE id = ?", [winnerId, game.id]);
    await connection.commit();
    game = await gameDetails(pool, game.id);
  } catch (error) {
    await connection.rollback().catch(() => {});
    return res.status(error.status || 400).json({ error: error.message || "Could not forfeit this match." });
  } finally {
    connection.release();
  }
  invalidateUserCache(game.host_id);
  invalidateUserCache(game.guest_id);
  await sendGameMessage(game.room_id, {
    type: "won",
    gameId: game.id,
    winner: game.winner_name,
    host: game.host_name,
    guest: game.guest_name,
    stake: XO_STAKE,
    forfeit: true,
  });
  broadcast("users-changed", { userId: game.host_id });
  broadcast("users-changed", { userId: game.guest_id });
  broadcast("xo-game", { gameId: game.id, roomId: game.room_id, status: game.status });
  res.json(game);
});

module.exports = router;
module.exports.XO_PREFIX = XO_PREFIX;
