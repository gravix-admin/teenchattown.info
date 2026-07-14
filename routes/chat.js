const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../database");
const { requireAuth, isStaff, rankPower, cacheUser } = require("../middleware/auth");
const { chatUpload, imageUpload, fileToDataUrl } = require("../services/upload");
const { addClient, removeClient, broadcast, notifyUser } = require("../services/events");
const { INTRUDER_PREFIX, handlePossibleShot } = require("../services/intruderService");
const { BET_PREFIX, handleBetCommand } = require("../services/betService");
const { FUN_PREFIXES, handleFunCommand } = require("../services/funCommandService");
const { publicUser } = require("../services/userService");

const router = express.Router();
const upload = chatUpload("chat");
const roomUpload = imageUpload("rooms");
const roomCache = new Map();
const roomMessageCache = new Map();
const ROOM_CACHE_TTL_MS = 60000;
const ROOM_MESSAGE_CACHE_TTL_MS = 15000;

function clearRoomMessageCache(roomId = null) {
  if (roomId === null) return roomMessageCache.clear();
  const prefix = `${Number(roomId)}:`;
  for (const key of roomMessageCache.keys()) {
    if (key.startsWith(prefix)) roomMessageCache.delete(key);
  }
}

function muted(user) {
  return user.muted_until && new Date(user.muted_until) > new Date();
}

async function roomById(roomId) {
  const cached = roomCache.get(Number(roomId));
  if (cached && cached.expiresAt > Date.now()) return cached.room;
  const [[room]] = await pool.query("SELECT * FROM rooms WHERE id = ?", [roomId]);
  if (room) roomCache.set(Number(roomId), { room, expiresAt: Date.now() + ROOM_CACHE_TTL_MS });
  return room || null;
}

async function canEnterRoom(user, room) {
  if (!room) return false;
  if (Number(room.staff_only) === 1 && !isStaff(user)) return false;
  if (!room.password_hash) return true;
  if (isStaff(user) || Number(room.created_by) === Number(user.id)) return true;
  const [[access]] = await pool.query("SELECT id FROM room_access WHERE room_id = ? AND user_id = ?", [room.id, user.id]);
  return Boolean(access);
}

async function requireRoomAccess(req, res, next) {
  const room = await roomById(req.params.roomId);
  if (!room) return res.status(404).json({ error: "Room not found." });
  if (Number(room.staff_only) === 1 && !isStaff(req.user)) return res.status(403).json({ error: "This room is for staff only.", code: "STAFF_ONLY" });
  if (!(await canEnterRoom(req.user, room))) return res.status(403).json({ error: "Room password required.", code: "ROOM_LOCKED" });
  req.room = room;
  next();
}

async function hasTool(user, tool) {
  if (user.rank_name === "developer") return true;
  const [[row]] = await pool.query("SELECT allowed FROM role_permissions WHERE rank_name = ? AND tool = ?", [user.rank_name, tool]);
  if (!row && tool === "sendPm") return true;
  if (!row && tool === "sendFiles") return user.rank_name !== "vip";
  return Boolean(row?.allowed);
}

async function canDeletePrivateChats(user) {
  return isStaff(user) && rankPower(user.rank_name) >= rankPower("admin") && (await hasTool(user, "deleteMessage"));
}

function isProtectedSystemBody(body) {
  const value = String(body || "");
  return value.startsWith(INTRUDER_PREFIX) || value.startsWith(BET_PREFIX) || FUN_PREFIXES.some((prefix) => value.startsWith(prefix));
}

async function isProtectedSystemMessage(message) {
  if (!message) return false;
  if (isProtectedSystemBody(message.body)) return true;
  const [[owner]] = await pool.query("SELECT username, rank_name FROM users WHERE id = ?", [message.user_id]);
  return owner?.rank_name === "bot" || String(owner?.username || "").toLowerCase() === "intruder";
}

router.get("/events", requireAuth, async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  await pool.query("UPDATE users SET last_seen = NOW(), is_online = 1 WHERE id = ?", [req.user.id]).catch((error) => {
    console.error("Could not update last_seen for SSE connect:", error.message);
  });
  addClient(req.user.id, res);
  broadcast("users-changed", { userId: req.user.id, online: true });
  const presenceTimer = setInterval(() => pool.query("UPDATE users SET last_seen = NOW(), is_online = 1 WHERE id = ?", [req.user.id]).catch(() => {}), 45000);
  presenceTimer.unref?.();
  req.on("close", async () => {
    clearInterval(presenceTimer);
    removeClient(res);
    await pool.query("UPDATE users SET last_seen = NOW(), is_online = 0 WHERE id = ?", [req.user.id]).catch(() => {});
    broadcast("users-changed", { userId: req.user.id, online: false });
  });
});

router.get("/rooms/:roomId/messages", requireAuth, requireRoomAccess, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 20), 80);
  const cacheKey = `${Number(req.params.roomId)}:${limit}`;
  const cached = roomMessageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.set("X-TCT-Message-Cache", "HIT");
    return res.json(cached.rows);
  }
  const [rows] = await pool.query(
    `SELECT recent.* FROM (
       SELECT m.*, u.username, u.rank_name, u.profile_title, u.avatar_url, u.username_color, u.text_color, u.bubble_style, u.frame
       FROM messages m
       JOIN users u ON u.id = m.user_id
       WHERE m.room_id = ? AND m.deleted_at IS NULL
       ORDER BY m.created_at DESC
       LIMIT ?
     ) recent
     ORDER BY recent.is_pinned DESC, recent.created_at ASC`,
    [req.params.roomId, limit]
  );
  const messageIds = rows.map((row) => Number(row.id)).filter(Boolean);
  if (messageIds.length) {
    const [reactionRows] = await pool.query(
      `SELECT message_id, emoji, COUNT(*) AS count
       FROM message_reactions
       WHERE message_id IN (?)
       GROUP BY message_id, emoji`,
      [messageIds]
    );
    const reactionsByMessage = new Map();
    for (const reaction of reactionRows) {
      const messageId = Number(reaction.message_id);
      if (!reactionsByMessage.has(messageId)) reactionsByMessage.set(messageId, []);
      reactionsByMessage.get(messageId).push({ emoji: reaction.emoji, count: Number(reaction.count) });
    }
    for (const row of rows) row.reactions = reactionsByMessage.get(Number(row.id)) || [];
  }
  if (roomMessageCache.size >= 100) roomMessageCache.delete(roomMessageCache.keys().next().value);
  roomMessageCache.set(cacheKey, { rows, expiresAt: Date.now() + ROOM_MESSAGE_CACHE_TTL_MS });
  res.set("X-TCT-Message-Cache", "MISS");
  res.json(rows);
});

router.post("/rooms/:roomId/messages", requireAuth, requireRoomAccess, upload.single("attachment"), async (req, res) => {
  if (muted(req.user)) return res.status(403).json({ error: "You are muted and cannot chat or send PMs." });
  if (req.file && !(await hasTool(req.user, "sendFiles"))) return res.status(403).json({ error: "Your rank cannot send files." });
  let body = String(req.body.body || "").trim().slice(0, 1200);
  if (!body && !req.file) return res.status(400).json({ error: "Message or attachment required." });
  if (/^\/bet(?:\s|$)/i.test(body)) {
    if (req.file) return res.status(400).json({ error: "The /bet command cannot include an attachment." });
    const match = body.match(/^\/bet\s+["']?(\d+)["']?\s*$/i);
    if (!match) return res.status(400).json({ error: 'Use /bet "gold amount".' });
    try {
      const result = await handleBetCommand(req.params.roomId, req.user, match[1]);
      clearRoomMessageCache(req.params.roomId);
      return res.status(result.private ? 200 : 201).json(result);
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message || "Bet could not be placed." });
    }
  }
  if (/^\/(?:confess|ship|steal|hunt|roast)(?:\s|$)/i.test(body)) {
    if (req.file) return res.status(400).json({ error: "Commands cannot include an attachment." });
    if (req.body.replyToId) return res.status(400).json({ error: "Clear the reply before using a command." });
    try {
      const result = await handleFunCommand(req.params.roomId, req.user, body);
      clearRoomMessageCache(req.params.roomId);
      return res.status(201).json(result);
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message || "Command could not be completed." });
    }
  }
  if (req.body.replyToId) {
    const [[replyTarget]] = await pool.query("SELECT id, user_id, body FROM messages WHERE id = ?", [req.body.replyToId]);
    if (await isProtectedSystemMessage(replyTarget)) return res.status(403).json({ error: "System bot messages cannot be replied to." });
  }
  const welcomeMatch = body.match(/^@wb\s+(.+)$/i);
  if (welcomeMatch) {
    const requestedName = welcomeMatch[1].trim().replace(/^@/, "").slice(0, 32);
    const [[target]] = await pool.query("SELECT username FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1", [requestedName]);
    if (!target) return res.status(404).json({ error: "No user found." });
    body = `@wb ${target.username}`;
  }
  const attachmentUrl = req.file ? fileToDataUrl(req.file) : null;
  const [result] = await pool.query(
    "INSERT INTO messages (room_id, user_id, body, attachment_url, attachment_type, reply_to_id) VALUES (?, ?, ?, ?, ?, ?)",
    [req.params.roomId, req.user.id, body, attachmentUrl, req.file?.mimetype || null, req.body.replyToId || null]
  );
  const message = {
    id: result.insertId,
    room_id: Number(req.params.roomId),
    user_id: req.user.id,
    body,
    attachment_url: attachmentUrl,
    attachment_type: req.file?.mimetype || null,
    reply_to_id: req.body.replyToId || null,
    is_pinned: 0,
    created_at: new Date(),
    username: req.user.username,
    rank_name: req.user.rank_name,
    profile_title: req.user.profile_title,
    avatar_url: req.user.avatar_url,
    username_color: req.user.username_color,
    text_color: req.user.text_color,
    bubble_style: req.user.bubble_style,
    frame: req.user.frame,
  };
  clearRoomMessageCache(req.params.roomId);
  broadcast("message", message);
  res.status(201).json(message);
  (async () => {
    await pool.query("UPDATE users SET message_count = message_count + 1, xp = xp + IF((message_count + 1) % 2 = 0, 1, 0), gold = gold + IF((message_count + 1) % 10 = 0, 100, 0) WHERE id = ?", [req.user.id]);
    req.user.message_count = Number(req.user.message_count || 0) + 1;
    if (req.user.message_count % 2 === 0) req.user.xp = Number(req.user.xp || 0) + 1;
    if (req.user.message_count % 10 === 0) req.user.gold = Number(req.user.gold || 0) + 100;
    cacheUser(req.user);
    await Promise.all([
      pool.query("INSERT IGNORE INTO user_achievements (user_id, achievement_id) SELECT ?, id FROM achievements WHERE code = 'first_message'", [req.user.id]),
      pool.query("INSERT IGNORE INTO user_achievements (user_id, achievement_id) SELECT ?, id FROM achievements WHERE code = 'ten_messages' AND (SELECT message_count FROM users WHERE id = ?) >= 10", [req.user.id, req.user.id]),
    ]);
  })().catch((error) => console.error("[message rewards] update failed:", error.message));
  handlePossibleShot(message, req.user).catch((error) => {
    console.error("[intruder] shot handling failed:", error.message);
  });
});

router.delete("/rooms/:roomId/messages", requireAuth, requireRoomAccess, async (req, res) => {
  if (!isStaff(req.user) || !(await hasTool(req.user, "deleteMessage"))) return res.status(403).json({ error: "Staff only." });
  await pool.query(
    `UPDATE messages
     SET deleted_at = NOW()
     WHERE room_id = ? AND deleted_at IS NULL
       AND body NOT LIKE ?
       AND user_id NOT IN (SELECT id FROM users WHERE rank_name = 'bot' OR LOWER(username) = 'intruder')`,
    [req.params.roomId, `${INTRUDER_PREFIX}%`]
  );
  clearRoomMessageCache(req.params.roomId);
  broadcast("room-cleared", { roomId: Number(req.params.roomId), by: req.user.username });
  res.json({ ok: true });
});

router.patch("/messages/:messageId", requireAuth, async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM messages WHERE id = ?", [req.params.messageId]);
  const message = rows[0];
  if (!message) return res.status(404).json({ error: "Message not found." });
  if (await isProtectedSystemMessage(message)) return res.status(403).json({ error: "System bot messages cannot be edited." });
  if (message.user_id !== req.user.id && !isStaff(req.user)) return res.status(403).json({ error: "Cannot edit this message." });
  await pool.query("UPDATE messages SET body = ?, edited_at = NOW() WHERE id = ?", [String(req.body.body || "").slice(0, 1200), message.id]);
  clearRoomMessageCache(message.room_id);
  broadcast("message-updated", { id: message.id, body: req.body.body });
  res.json({ ok: true });
});

router.delete("/messages/:messageId", requireAuth, async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM messages WHERE id = ?", [req.params.messageId]);
  const message = rows[0];
  if (!message) return res.status(404).json({ error: "Message not found." });
  if (await isProtectedSystemMessage(message)) return res.status(403).json({ error: "System bot messages cannot be deleted." });
  if (message.user_id !== req.user.id && !(isStaff(req.user) && await hasTool(req.user, "deleteMessage"))) return res.status(403).json({ error: "Cannot delete this message." });
  await pool.query("UPDATE messages SET deleted_at = NOW() WHERE id = ?", [message.id]);
  clearRoomMessageCache(message.room_id);
  broadcast("message-deleted", { id: message.id });
  res.json({ ok: true });
});

router.post("/messages/:messageId/reactions", requireAuth, async (req, res) => {
  const [[message]] = await pool.query("SELECT id, room_id, user_id, body FROM messages WHERE id = ?", [req.params.messageId]);
  if (await isProtectedSystemMessage(message)) return res.status(403).json({ error: "System bot messages cannot be reacted to." });
  const emoji = String(req.body.emoji || "like").slice(0, 20);
  await pool.query("INSERT IGNORE INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)", [req.params.messageId, req.user.id, emoji]);
  clearRoomMessageCache(message.room_id);
  broadcast("reaction", { messageId: Number(req.params.messageId), emoji });
  res.json({ ok: true });
});

router.post("/messages/:messageId/pin", requireAuth, async (req, res) => {
  if (!isStaff(req.user)) return res.status(403).json({ error: "Staff only." });
  const [[message]] = await pool.query("SELECT id, room_id, user_id, body FROM messages WHERE id = ?", [req.params.messageId]);
  if (await isProtectedSystemMessage(message)) return res.status(403).json({ error: "System bot messages cannot be pinned." });
  await pool.query("UPDATE messages SET is_pinned = 1 - is_pinned WHERE id = ?", [req.params.messageId]);
  clearRoomMessageCache(message.room_id);
  broadcast("message-pinned", { id: Number(req.params.messageId) });
  res.json({ ok: true });
});

router.get("/rooms", requireAuth, async (req, res) => {
  const [rooms] = await pool.query("SELECT id, name, description, image_url, is_pinned, staff_only, created_by, created_at, IF(password_hash IS NULL OR password_hash = '', 0, 1) AS locked FROM rooms WHERE staff_only = 0 OR ? = 1 ORDER BY CASE WHEN name = 'Main Room' THEN 0 ELSE 1 END, is_pinned DESC, name", [isStaff(req.user) ? 1 : 0]);
  res.set("Cache-Control", "private, no-store");
  res.json(rooms);
});

router.post("/rooms", requireAuth, roomUpload.single("image"), async (req, res) => {
  const [[permission]] = await pool.query("SELECT allowed FROM role_permissions WHERE rank_name = ? AND tool = 'createRoom'", [req.user.rank_name]);
  if (req.user.rank_name !== "developer" && !permission?.allowed) return res.status(403).json({ error: "Your rank cannot create rooms." });
  const name = String(req.body.name || "").trim().slice(0, 80);
  if (name.length < 2) return res.status(400).json({ error: "Room name must be at least 2 characters." });
  const passwordHash = req.body.password ? await bcrypt.hash(String(req.body.password), 10) : null;
  const staffOnly = req.body.staffOnly === "true" || req.body.staffOnly === true ? 1 : 0;
  const imageUrl = req.file ? fileToDataUrl(req.file) : String(req.body.imageUrl || "").trim() || "/assets/room-main.svg";
  const [result] = await pool.query(
    "INSERT INTO rooms (name, description, image_url, password_hash, staff_only, created_by) VALUES (?, ?, ?, ?, ?, ?)",
    [name, String(req.body.description || "").slice(0, 255), imageUrl, passwordHash, staffOnly, req.user.id]
  );
  await pool.query("INSERT IGNORE INTO room_access (room_id, user_id) VALUES (?, ?)", [result.insertId, req.user.id]);
  roomCache.clear();
  broadcast("rooms-changed", { id: result.insertId });
  res.status(201).json({ id: result.insertId });
});

router.patch("/rooms/:roomId/pin", requireAuth, async (req, res) => {
  if (!["chief", "developer"].includes(req.user.rank_name)) return res.status(403).json({ error: "Only Chief and Developer can pin rooms." });
  const room = await roomById(req.params.roomId);
  if (!room) return res.status(404).json({ error: "Room not found." });
  const pinned = req.body.pinned === undefined ? !Number(room.is_pinned) : Boolean(req.body.pinned);
  await pool.query("UPDATE rooms SET is_pinned = ? WHERE id = ?", [pinned ? 1 : 0, room.id]);
  roomCache.clear();
  broadcast("rooms-changed", { id: room.id, pinned });
  res.json({ ok: true, pinned });
});

router.delete("/rooms/:roomId", requireAuth, async (req, res) => {
  if (!["chief", "developer"].includes(req.user.rank_name)) return res.status(403).json({ error: "Only Chief and Developer can delete rooms." });
  const room = await roomById(req.params.roomId);
  if (!room) return res.status(404).json({ error: "Room not found." });
  if (String(room.name).toLowerCase() === "main room") return res.status(400).json({ error: "Main Room cannot be deleted." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query("DELETE mr FROM message_reactions mr JOIN messages m ON m.id = mr.message_id WHERE m.room_id = ?", [room.id]);
    await connection.query("DELETE FROM messages WHERE room_id = ?", [room.id]);
    await connection.query("DELETE FROM room_access WHERE room_id = ?", [room.id]);
    await connection.query("DELETE FROM xo_games WHERE room_id = ?", [room.id]);
    await connection.query("UPDATE reports SET room_id = NULL WHERE room_id = ?", [room.id]).catch(() => {});
    await connection.query("DELETE FROM rooms WHERE id = ?", [room.id]);
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
  roomCache.clear();
  clearRoomMessageCache(room.id);
  broadcast("rooms-changed", { id: room.id, deleted: true });
  res.json({ ok: true });
});

router.post("/rooms/:roomId/join", requireAuth, async (req, res) => {
  const room = await roomById(req.params.roomId);
  if (!room) return res.status(404).json({ error: "Room not found." });
  if (Number(room.staff_only) === 1 && !isStaff(req.user)) return res.status(403).json({ error: "This room is for staff only.", code: "STAFF_ONLY" });
  if (!room.password_hash || isStaff(req.user) || Number(room.created_by) === Number(req.user.id)) {
    await pool.query("INSERT IGNORE INTO room_access (room_id, user_id) VALUES (?, ?)", [room.id, req.user.id]);
    return res.json({ ok: true });
  }
  if (!(await bcrypt.compare(String(req.body.password || ""), room.password_hash))) {
    return res.status(403).json({ error: "Wrong room password." });
  }
  await pool.query("INSERT IGNORE INTO room_access (room_id, user_id) VALUES (?, ?)", [room.id, req.user.id]);
  res.json({ ok: true });
});

router.get("/private-conversations", requireAuth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT other_user.id, other_user.username, other_user.display_name, other_user.rank_name, other_user.profile_title,
      other_user.avatar_url, other_user.gender,
      latest_message.created_at AS last_message_at,
      COALESCE(NULLIF(latest_message.body, ''), 'Image') AS last_body,
      COALESCE(unread.unread_count, 0) AS unread_count
     FROM (
       SELECT CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END AS other_user_id, MAX(id) AS last_message_id
       FROM private_messages
       WHERE (sender_id = ? OR receiver_id = ?) AND deleted_at IS NULL
       GROUP BY CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END
     ) conversations
     JOIN private_messages latest_message ON latest_message.id = conversations.last_message_id
     JOIN users other_user ON other_user.id = conversations.other_user_id
     LEFT JOIN (
       SELECT sender_id AS other_user_id, COUNT(*) AS unread_count
       FROM private_messages
       WHERE receiver_id = ? AND read_at IS NULL AND deleted_at IS NULL
       GROUP BY sender_id
     ) unread ON unread.other_user_id = conversations.other_user_id
     ORDER BY latest_message.created_at DESC
     LIMIT 50`,
    [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id]
  );
  res.json(rows);
});

router.get("/private-unread-count", requireAuth, async (req, res) => {
  const [[row]] = await pool.query(
    "SELECT COUNT(*) AS count FROM private_messages WHERE receiver_id = ? AND read_at IS NULL AND deleted_at IS NULL",
    [req.user.id]
  );
  res.json({ count: Number(row.count || 0) });
});

router.post("/private-messages", requireAuth, upload.single("attachment"), async (req, res) => {
  if (muted(req.user)) return res.status(403).json({ error: "You are muted and cannot chat or send PMs." });
  if (!(await hasTool(req.user, "sendPm"))) return res.status(403).json({ error: "Your rank cannot send private messages." });
  if (req.file && !(await hasTool(req.user, "sendFiles"))) return res.status(403).json({ error: "Your rank cannot send files." });
  const form = req.body || {};
  const receiverId = Number(form.receiverId);
  if (!receiverId || receiverId === Number(req.user.id)) return res.status(400).json({ error: "Choose another user to message." });
  const [[blocked]] = await pool.query("SELECT COUNT(*) AS count FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)", [receiverId, req.user.id, req.user.id, receiverId]);
  if (blocked.count) return res.status(403).json({ error: "Private message blocked." });
  const body = String(form.body || "").trim().slice(0, 1200);
  const attachmentUrl = req.file ? fileToDataUrl(req.file) : null;
  if (!body && !attachmentUrl) return res.status(400).json({ error: "Message or image required." });
  const replyToId = Number(form.replyToId) || null;
  let replyTarget = null;
  if (replyToId) {
    [[replyTarget]] = await pool.query(
      `SELECT pm.id, pm.sender_id, pm.body, pm.attachment_url, u.username AS sender_username
       FROM private_messages pm
       JOIN users u ON u.id = pm.sender_id
       WHERE pm.id = ? AND pm.deleted_at IS NULL
         AND ((pm.sender_id = ? AND pm.receiver_id = ?) OR (pm.sender_id = ? AND pm.receiver_id = ?))`,
      [replyToId, req.user.id, receiverId, receiverId, req.user.id]
    );
    if (!replyTarget) return res.status(400).json({ error: "That private message is no longer available to reply to." });
  }
  const [result] = await pool.query(
    "INSERT INTO private_messages (sender_id, receiver_id, body, attachment_url, attachment_type, reply_to_id) VALUES (?, ?, ?, ?, ?, ?)",
    [req.user.id, receiverId, body, attachmentUrl, req.file?.mimetype || null, replyToId]
  );
  const payload = {
    id: result.insertId,
    sender_id: req.user.id,
    senderId: req.user.id,
    sender_username: req.user.username,
    senderUsername: req.user.username,
    receiver_id: receiverId,
    receiverId,
    body,
    attachment_url: attachmentUrl,
    attachmentUrl,
    attachment_type: req.file?.mimetype || null,
    attachmentType: req.file?.mimetype || null,
    reply_to_id: replyToId,
    replyToId,
    reply_body: replyTarget?.body || null,
    replyBody: replyTarget?.body || null,
    reply_attachment_url: replyTarget?.attachment_url || null,
    replyAttachmentUrl: replyTarget?.attachment_url || null,
    reply_sender_username: replyTarget?.sender_username || null,
    replySenderUsername: replyTarget?.sender_username || null,
    created_at: new Date(),
    createdAt: new Date()
  };
  notifyUser(receiverId, "private-message", payload);
  res.status(201).json(payload);
});

router.get("/private-messages/:userId", requireAuth, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 20), 80);
  const [rows] = await pool.query(
    `SELECT recent.* FROM (
       SELECT pm.*, su.username AS sender_username, ru.username AS receiver_username,
              reply.body AS reply_body, reply.attachment_url AS reply_attachment_url,
              reply_sender.username AS reply_sender_username
       FROM private_messages pm
       JOIN users su ON su.id = pm.sender_id
       JOIN users ru ON ru.id = pm.receiver_id
       LEFT JOIN private_messages reply ON reply.id = pm.reply_to_id AND reply.deleted_at IS NULL
       LEFT JOIN users reply_sender ON reply_sender.id = reply.sender_id
       WHERE ((pm.sender_id = ? AND pm.receiver_id = ?) OR (pm.sender_id = ? AND pm.receiver_id = ?))
         AND pm.deleted_at IS NULL
       ORDER BY pm.created_at DESC
       LIMIT ?
     ) recent
     ORDER BY recent.created_at ASC`,
    [req.user.id, req.params.userId, req.params.userId, req.user.id, limit]
  );
  await pool.query("UPDATE private_messages SET read_at = NOW() WHERE receiver_id = ? AND sender_id = ? AND read_at IS NULL", [req.user.id, req.params.userId]);
  res.json(rows);
});

router.post("/private-messages/:userId/read", requireAuth, async (req, res) => {
  const otherUserId = Number(req.params.userId);
  if (!otherUserId || otherUserId === Number(req.user.id)) return res.status(400).json({ error: "Choose another private chat." });
  const [result] = await pool.query(
    "UPDATE private_messages SET read_at = NOW() WHERE receiver_id = ? AND sender_id = ? AND read_at IS NULL AND deleted_at IS NULL",
    [req.user.id, otherUserId]
  );
  res.json({ ok: true, read: Number(result.affectedRows || 0) });
});

router.delete("/private-messages/:userId", requireAuth, async (req, res) => {
  if (!(await canDeletePrivateChats(req.user))) return res.status(403).json({ error: "Only higher staff can delete private chats." });
  const otherUserId = Number(req.params.userId);
  if (!otherUserId || otherUserId === Number(req.user.id)) return res.status(400).json({ error: "Choose another user chat to delete." });
  const [result] = await pool.query(
    `UPDATE private_messages
     SET deleted_at = NOW()
     WHERE deleted_at IS NULL
       AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))`,
    [req.user.id, otherUserId, otherUserId, req.user.id]
  );
  notifyUser(otherUserId, "private-chat-deleted", { otherUserId: req.user.id, by: req.user.id });
  res.json({ ok: true, deleted: result.affectedRows || 0 });
});

module.exports = router;
