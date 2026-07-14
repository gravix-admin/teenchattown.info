const express = require("express");
const fs = require("fs");
const path = require("path");
const pool = require("../database");
const { requireAuth, isStaff, invalidateUserCache } = require("../middleware/auth");
const { notifyUser, broadcast } = require("../services/events");
const { publicUser } = require("../services/userService");
const { audioUpload, imageUpload, fileToDataUrl } = require("../services/upload");
const { rankPower, normalizeRank } = require("../services/ranks");

const router = express.Router();
const galleryUpload = imageUpload("gallery");
const newsUpload = imageUpload("news");
const profileMusicUpload = audioUpload("profile-music");
const INTRUDER_PREFIX = "::intruder:";
const giftCatalog = {
  rose: { title: "Rose", costGold: 50 },
  star: { title: "Star", costGold: 100 },
  crown: { title: "Crown", costGold: 250 },
  diamond: { title: "Diamond", costGold: 500 },
};
const durationLabels = { "7d": "7 days", "1m": "1 month", "3m": "3 months", lifetime: "Lifetime" };
const durationDays = { "7d": 7, "1m": 30, "3m": 90, lifetime: null };
const durationPower = { "7d": 0, "1m": 1, "3m": 2, lifetime: 3 };
const muted = (user) => Boolean(user?.muted_until && new Date(user.muted_until) > new Date());
const rankPlans = {
  "s-vip": {
    "7d": { diamonds: 50, gold: 1000 },
    "1m": { diamonds: 100, gold: 5000 },
    "3m": { diamonds: 200, gold: 10000 },
    lifetime: { diamonds: 1000, gold: 25000 },
  },
  devil: {
    "7d": { diamonds: 150, gold: 2000 },
    "1m": { diamonds: 300, gold: 7000 },
    "3m": { diamonds: 700, gold: 15000 },
    lifetime: { diamonds: 1500, gold: 50000 },
  },
  angel: {
    "7d": { diamonds: 150, gold: 2000 },
    "1m": { diamonds: 300, gold: 7000 },
    "3m": { diamonds: 700, gold: 15000 },
    lifetime: { diamonds: 1500, gold: 50000 },
  },
  legend: {
    "7d": { diamonds: 500, gold: 5000 },
    "1m": { diamonds: 1200, gold: 18000 },
    "3m": { diamonds: 2500, gold: 45000 },
    lifetime: { diamonds: 7000, gold: 1000000 },
  },
};
const freeStoreRanks = new Set(["premium", "admin", "developer"]);
const storeItems = {
  "profile-music": { currency: "gold", cost: 2000 },
  "profile-frames": { currency: "diamonds", cost: 100 },
};
const storeFrames = new Set(["cosmic", "solar", "prism", "gothic", "angelic", "classic-gold", "royal-laurel", "sun-throne"]);
const responseCache = { news: null, newsAt: 0, leaderboards: new Map() };

function clearNewsCache() {
  responseCache.news = null;
  responseCache.newsAt = 0;
}

function canManageNews(user) {
  return ["chief", "developer"].includes(String(user?.rank_name || "").toLowerCase());
}

async function removeProfileMusicFile(url) {
  const value = String(url || "");
  if (!value.startsWith("/uploads/profile-music/")) return;
  const filename = path.basename(decodeURIComponent(value));
  const target = path.join(__dirname, "..", "uploads", "profile-music", filename);
  await fs.promises.unlink(target).catch(() => {});
}

async function hasStoreItem(user, itemCode) {
  if (freeStoreRanks.has(user.rank_name)) return true;
  const [[owned]] = await pool.query("SELECT id FROM user_store_items WHERE user_id = ? AND item_code = ? LIMIT 1", [user.id, itemCode]);
  return Boolean(owned);
}

async function requireProfileMusicAccess(req, res, next) {
  if (!(await hasStoreItem(req.user, "profile-music"))) return res.status(403).json({ error: "Unlock Profile Music from the Chat Store first." });
  next();
}

function receiveProfileMusic(req, res, next) {
  profileMusicUpload.single("music")(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "MP3 must be under 10 MB." });
    return res.status(400).json({ error: error.message || "Could not upload this MP3." });
  });
}

async function notification(userId, type, title, body = "") {
  const [result] = await pool.query(
    "INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)",
    [userId, type, title, body]
  );
  notifyUser(userId, "notification", { id: result.insertId, type, title, body });
}

async function permission(user, tool) {
  if (user.rank_name === "developer") return true;
  const [[row]] = await pool.query("SELECT allowed FROM role_permissions WHERE rank_name = ? AND tool = ?", [user.rank_name, tool]);
  return Boolean(row?.allowed);
}

function isSystemUser(row) {
  return row?.rank_name === "bot" || ["intruder", "zombie"].includes(String(row?.username || "").toLowerCase());
}

router.get("/friends", requireAuth, async (req, res) => {
  const [friends] = await pool.query(
    `SELECT u.id, u.username, u.avatar_url, u.rank_name, u.mood
     FROM friends f JOIN users u ON u.id = f.friend_id
     WHERE f.user_id = ? ORDER BY u.username`,
    [req.user.id]
  );
  const [requests] = await pool.query(
    `SELECT fr.*, u.username, u.avatar_url, u.rank_name
     FROM friend_requests fr JOIN users u ON u.id = fr.from_user_id
     WHERE fr.to_user_id = ? AND fr.status = 'pending' ORDER BY fr.created_at DESC`,
    [req.user.id]
  );
  const [blocks] = await pool.query(
    `SELECT b.*, u.username, u.avatar_url FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ?`,
    [req.user.id]
  );
  res.json({ friends, requests, blocks });
});

router.get("/friends-wall", requireAuth, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 24, 8), 40);
  const [posts] = await pool.query(
    `SELECT wp.id, wp.profile_user_id, wp.author_id, wp.body, wp.created_at,
       author.username, author.display_name, author.avatar_url, author.rank_name,
       owner.username AS profile_username, owner.display_name AS profile_display_name
     FROM wall_posts wp
     JOIN users author ON author.id = wp.author_id
     JOIN users owner ON owner.id = wp.profile_user_id
     WHERE wp.profile_user_id = ?
        OR EXISTS (SELECT 1 FROM friends f WHERE f.user_id = ? AND f.friend_id = wp.profile_user_id)
     ORDER BY wp.created_at DESC
     LIMIT ?`,
    [req.user.id, req.user.id, limit]
  );
  res.set("Cache-Control", "private, max-age=12, stale-while-revalidate=30");
  res.json(posts);
});

router.post("/friend-requests", requireAuth, async (req, res) => {
  const toUserId = Number(req.body.toUserId);
  if (toUserId === req.user.id) return res.status(400).json({ error: "You cannot friend yourself." });
  const [[blocked]] = await pool.query("SELECT COUNT(*) AS count FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)", [toUserId, req.user.id, req.user.id, toUserId]);
  if (blocked.count) return res.status(403).json({ error: "Friend request blocked." });
  await pool.query(
    "INSERT INTO friend_requests (from_user_id, to_user_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE status = 'pending', updated_at = NOW()",
    [req.user.id, toUserId]
  );
  await notification(toUserId, "friend-request", "New friend request", `${req.user.username} sent you a friend request.`);
  notifyUser(toUserId, "friend-request-updated", { fromUserId: req.user.id });
  res.status(201).json({ ok: true });
});

router.post("/friend-requests/:id/accept", requireAuth, async (req, res) => {
  const [[request]] = await pool.query("SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ? AND status = 'pending'", [req.params.id, req.user.id]);
  if (!request) return res.status(404).json({ error: "Request not found." });
  await pool.query("UPDATE friend_requests SET status = 'accepted', updated_at = NOW() WHERE id = ?", [request.id]);
  await pool.query("INSERT IGNORE INTO friends (user_id, friend_id) VALUES (?, ?), (?, ?)", [request.from_user_id, request.to_user_id, request.to_user_id, request.from_user_id]);
  await notification(request.from_user_id, "friend-accepted", "Friend request accepted", `${req.user.username} accepted your friend request.`);
  notifyUser(request.from_user_id, "friend-request-updated", { userId: req.user.id });
  notifyUser(request.to_user_id, "friend-request-updated", { userId: request.from_user_id });
  res.json({ ok: true });
});

router.post("/friend-requests/:id/decline", requireAuth, async (req, res) => {
  const [[request]] = await pool.query("SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ?", [req.params.id, req.user.id]);
  await pool.query("UPDATE friend_requests SET status = 'declined', updated_at = NOW() WHERE id = ? AND to_user_id = ?", [req.params.id, req.user.id]);
  if (request) notifyUser(request.from_user_id, "friend-request-updated", { userId: req.user.id });
  res.json({ ok: true });
});

router.delete("/friends/:id", requireAuth, async (req, res) => {
  await pool.query("DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)", [req.user.id, req.params.id, req.params.id, req.user.id]);
  res.json({ ok: true });
});

router.post("/blocks", requireAuth, async (req, res) => {
  const blockedId = Number(req.body.userId);
  if (blockedId === req.user.id) return res.status(400).json({ error: "You cannot block yourself." });
  await pool.query("INSERT IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)", [req.user.id, blockedId]);
  await pool.query("DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)", [req.user.id, blockedId, blockedId, req.user.id]);
  res.status(201).json({ ok: true });
});

router.delete("/blocks/:id", requireAuth, async (req, res) => {
  await pool.query("DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?", [req.user.id, req.params.id]);
  res.json({ ok: true });
});

router.post("/follows", requireAuth, async (req, res) => {
  const followingId = Number(req.body.userId);
  await pool.query("INSERT IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)", [req.user.id, followingId]);
  await notification(followingId, "follow", "New follower", `${req.user.username} followed you.`);
  res.status(201).json({ ok: true });
});

router.delete("/follows/:id", requireAuth, async (req, res) => {
  await pool.query("DELETE FROM follows WHERE follower_id = ? AND following_id = ?", [req.user.id, req.params.id]);
  res.json({ ok: true });
});

router.post("/profiles/:id/like", requireAuth, async (req, res) => {
  const profileUserId = Number(req.params.id);
  if (!profileUserId) return res.status(400).json({ error: "Invalid profile." });
  if (profileUserId === Number(req.user.id)) return res.status(400).json({ error: "You cannot like your own profile." });
  const [[target]] = await pool.query("SELECT id, username, rank_name FROM users WHERE id = ?", [profileUserId]);
  if (!target || isSystemUser(target)) return res.status(404).json({ error: "Profile not found." });
  const [[existing]] = await pool.query("SELECT id FROM profile_likes WHERE profile_user_id = ? AND liker_id = ?", [profileUserId, req.user.id]);
  let liked = false;
  if (existing) {
    await pool.query("DELETE FROM profile_likes WHERE id = ?", [existing.id]);
  } else {
    await pool.query("INSERT INTO profile_likes (profile_user_id, liker_id) VALUES (?, ?)", [profileUserId, req.user.id]);
    liked = true;
    await notification(profileUserId, "profile-like", "Profile liked", `${req.user.username} liked your profile.`);
  }
  const [[count]] = await pool.query("SELECT COUNT(*) AS total FROM profile_likes WHERE profile_user_id = ?", [profileUserId]);
  await pool.query("UPDATE users SET profile_likes = ? WHERE id = ?", [count.total, profileUserId]);
  broadcast("users-changed", { userId: profileUserId });
  res.json({ ok: true, liked, count: count.total });
});

router.get("/profiles/:id", requireAuth, async (req, res) => {
  const [[user]] = await pool.query("SELECT * FROM users WHERE id = ?", [req.params.id]);
  if (!user || isSystemUser(user)) return res.status(404).json({ error: "Profile not found." });
  pool.query("UPDATE users SET visitor_count = visitor_count + 1 WHERE id = ?", [req.params.id]).catch(() => {});
  const [[badges], [gifts], [[likes]], [[liked]]] = await Promise.all([
    pool.query(
      `SELECT a.* FROM user_achievements ua JOIN achievements a ON a.id = ua.achievement_id WHERE ua.user_id = ? ORDER BY ua.created_at DESC LIMIT 12`,
      [req.params.id]
    ),
    pool.query(
      `SELECT g.id, g.title, g.gift_code, g.created_at, u.username AS from_username
       FROM gifts g JOIN users u ON u.id = g.from_user_id
       WHERE g.to_user_id = ? ORDER BY g.created_at DESC LIMIT 8`,
      [req.params.id]
    ),
    pool.query("SELECT profile_likes AS total FROM users WHERE id = ?", [req.params.id]),
    pool.query("SELECT id FROM profile_likes WHERE profile_user_id = ? AND liker_id = ? LIMIT 1", [req.params.id, req.user.id]),
  ]);
  user.profile_likes = likes.total;
  res.set("Cache-Control", "private, no-store");
  res.json({ user: publicUser(user, req.user), badges, gifts, likedByMe: Boolean(liked), likeCount: likes.total });
});

router.get("/profiles/:id/social", requireAuth, async (req, res) => {
  const profileUserId = Number(req.params.id);
  const section = String(req.query.section || "wall");
  const [[target]] = await pool.query("SELECT id, username, rank_name FROM users WHERE id = ?", [profileUserId]);
  if (!target || isSystemUser(target)) return res.status(404).json({ error: "Profile not found." });
  res.set("Cache-Control", "private, max-age=12, stale-while-revalidate=30");
  if (section === "gallery") {
    const [gallery] = await pool.query(
      "SELECT id, user_id, image_url, caption, created_at FROM profile_gallery WHERE user_id = ? ORDER BY created_at DESC LIMIT 24",
      [profileUserId]
    );
    return res.json({ gallery });
  }
  const [wall] = await pool.query(
    `SELECT wp.id, wp.profile_user_id, wp.author_id, wp.body, wp.created_at,
       u.username, u.display_name, u.avatar_url, u.rank_name
     FROM wall_posts wp
     JOIN users u ON u.id = wp.author_id
     WHERE wp.profile_user_id = ?
     ORDER BY wp.created_at DESC LIMIT 30`,
    [profileUserId]
  );
  res.json({ wall });
});

router.post("/profiles/:id/wall", requireAuth, async (req, res) => {
  if (muted(req.user)) return res.status(403).json({ error: "You are muted and cannot post messages." });
  const profileUserId = Number(req.params.id);
  const body = String(req.body.body || "").trim().slice(0, 500);
  if (!body) return res.status(400).json({ error: "Wall post cannot be empty." });
  const [[target]] = await pool.query("SELECT id, username, rank_name FROM users WHERE id = ?", [profileUserId]);
  if (!target || isSystemUser(target)) return res.status(404).json({ error: "Profile not found." });
  const [[blocked]] = await pool.query(
    "SELECT COUNT(*) AS count FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)",
    [profileUserId, req.user.id, req.user.id, profileUserId]
  );
  if (blocked.count) return res.status(403).json({ error: "Wall posting is blocked." });
  const [result] = await pool.query(
    "INSERT INTO wall_posts (profile_user_id, author_id, body) VALUES (?, ?, ?)",
    [profileUserId, req.user.id, body]
  );
  if (profileUserId !== req.user.id) await notification(profileUserId, "wall-post", "New wall post", `${req.user.username} posted on your wall.`);
  const [[row]] = await pool.query(
    `SELECT wp.*, u.username, u.avatar_url
     FROM wall_posts wp JOIN users u ON u.id = wp.author_id WHERE wp.id = ?`,
    [result.insertId]
  );
  broadcast("profile-wall", { profileUserId, post: row });
  res.status(201).json(row);
});

router.delete("/wall-posts/:id", requireAuth, async (req, res) => {
  const [[post]] = await pool.query("SELECT * FROM wall_posts WHERE id = ?", [req.params.id]);
  if (!post) return res.status(404).json({ error: "Wall post not found." });
  if (post.author_id !== req.user.id && post.profile_user_id !== req.user.id && !isStaff(req.user)) return res.status(403).json({ error: "Cannot delete this wall post." });
  await pool.query("DELETE FROM wall_posts WHERE id = ?", [post.id]);
  res.json({ ok: true });
});

router.post("/profiles/me/gallery", requireAuth, galleryUpload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose an image." });
  const imageUrl = fileToDataUrl(req.file);
  const [result] = await pool.query(
    "INSERT INTO profile_gallery (user_id, image_url, caption) VALUES (?, ?, ?)",
    [req.user.id, imageUrl, String(req.body.caption || "").slice(0, 180)]
  );
  res.status(201).json({ id: result.insertId, imageUrl });
});

router.delete("/gallery/:id", requireAuth, async (req, res) => {
  await pool.query("DELETE FROM profile_gallery WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
  res.json({ ok: true });
});

router.post("/gifts", requireAuth, async (req, res) => {
  const toUserId = Number(req.body.toUserId);
  const giftCode = String(req.body.giftCode || "star");
  const gift = giftCatalog[giftCode];
  if (!gift) return res.status(400).json({ error: "Unknown gift." });
  if (!toUserId || toUserId === req.user.id) return res.status(400).json({ error: "Choose another user." });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[sender]] = await connection.query("SELECT gold FROM users WHERE id = ? FOR UPDATE", [req.user.id]);
    const [[target]] = await connection.query("SELECT id FROM users WHERE id = ?", [toUserId]);
    if (!target) throw new Error("User not found.");
    if (!sender || Number(sender.gold) < gift.costGold) throw new Error("Not enough gold for this gift.");
    await connection.query("UPDATE users SET gold = gold - ? WHERE id = ?", [gift.costGold, req.user.id]);
    const [result] = await connection.query(
      "INSERT INTO gifts (from_user_id, to_user_id, gift_code, title, cost_gold) VALUES (?, ?, ?, ?, ?)",
      [req.user.id, toUserId, giftCode, gift.title, gift.costGold]
    );
    await connection.query(
      "INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)",
      [toUserId, "gift", "Gift received", `${req.user.username} sent you ${gift.title}.`]
    );
    await connection.commit();
    notifyUser(toUserId, "notification", { type: "gift", title: "Gift received", body: `${req.user.username} sent you ${gift.title}.` });
    res.status(201).json({ id: result.insertId, gift, balanceChange: -gift.costGold });
  } catch (error) {
    await connection.rollback();
    res.status(400).json({ error: error.message || "Could not send gift." });
  } finally {
    connection.release();
  }
});

router.post("/wallet-transfers", requireAuth, async (req, res) => {
  const toUserId = Number(req.body.toUserId);
  const currency = req.body.currency === "diamonds" ? "diamonds" : "gold";
  const amount = Math.floor(Number(req.body.amount || 0));
  const note = String(req.body.note || "").slice(0, 160);
  if (!toUserId || toUserId === req.user.id) return res.status(400).json({ error: "Choose another user." });
  if (!Number.isFinite(amount) || amount < 1 || amount > 100000) return res.status(400).json({ error: "Enter a valid amount." });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[sender]] = await connection.query(`SELECT ${currency} AS balance FROM users WHERE id = ? FOR UPDATE`, [req.user.id]);
    const [[target]] = await connection.query("SELECT id FROM users WHERE id = ?", [toUserId]);
    if (!target) throw new Error("User not found.");
    if (!sender || Number(sender.balance) < amount) throw new Error(`Not enough ${currency}.`);
    await connection.query(`UPDATE users SET ${currency} = ${currency} - ? WHERE id = ?`, [amount, req.user.id]);
    await connection.query(`UPDATE users SET ${currency} = ${currency} + ? WHERE id = ?`, [amount, toUserId]);
    const [result] = await connection.query(
      "INSERT INTO wallet_transfers (from_user_id, to_user_id, currency, amount, note) VALUES (?, ?, ?, ?, ?)",
      [req.user.id, toUserId, currency, amount, note]
    );
    await connection.query(
      "INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)",
      [toUserId, "wallet", "Wallet shared", `${req.user.username} sent you ${amount} ${currency}.${note ? ` ${note}` : ""}`]
    );
    await connection.commit();
    notifyUser(toUserId, "notification", { type: "wallet", title: "Wallet shared", body: `${req.user.username} sent you ${amount} ${currency}.` });
    res.status(201).json({ id: result.insertId, currency, amount });
  } catch (error) {
    await connection.rollback();
    res.status(400).json({ error: error.message || "Could not share wallet." });
  } finally {
    connection.release();
  }
});

router.get("/store", requireAuth, async (req, res) => {
  const [ownedRows] = await pool.query("SELECT item_code FROM user_store_items WHERE user_id = ?", [req.user.id]);
  const owned = new Set(ownedRows.map((row) => row.item_code));
  const free = freeStoreRanks.has(req.user.rank_name);
  res.set("Cache-Control", "private, no-store");
  res.json({
    gold: Number(req.user.gold || 0),
    diamonds: Number(req.user.diamonds || 0),
    free,
    rank: req.user.rank_name,
    selectedFrame: req.user.frame || "clean",
    owned: {
      profileMusic: free || owned.has("profile-music"),
      profileFrames: free || owned.has("profile-frames"),
    },
  });
});

router.post("/store/purchase", requireAuth, async (req, res) => {
  const itemCode = String(req.body.itemCode || "");
  const item = storeItems[itemCode];
  if (!item) return res.status(400).json({ error: "Unknown store item." });
  if (await hasStoreItem(req.user, itemCode)) return res.json({ ok: true, owned: true, free: freeStoreRanks.has(req.user.rank_name) });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[user]] = await connection.query("SELECT rank_name, gold, diamonds FROM users WHERE id = ? FOR UPDATE", [req.user.id]);
    const free = freeStoreRanks.has(user.rank_name);
    if (!free && Number(user[item.currency] || 0) < item.cost) {
      await connection.rollback();
      return res.status(400).json({ error: item.currency === "gold" ? "Insufficient gold." : "Insufficient diamonds." });
    }
    if (!free) await connection.query(`UPDATE users SET ${item.currency} = ${item.currency} - ? WHERE id = ?`, [item.cost, req.user.id]);
    await connection.query("INSERT IGNORE INTO user_store_items (user_id, item_code) VALUES (?, ?)", [req.user.id, itemCode]);
    await connection.commit();
    responseCache.leaderboards.clear();
    invalidateUserCache(req.user.id);
    broadcast("users-changed", { userId: req.user.id });
    res.json({ ok: true, owned: true, free, currency: item.currency, charged: free ? 0 : item.cost });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

router.post("/store/frame", requireAuth, async (req, res) => {
  const frame = String(req.body.frame || "");
  if (frame === "clean") {
    await pool.query("UPDATE users SET frame = 'clean' WHERE id = ?", [req.user.id]);
    invalidateUserCache(req.user.id);
    broadcast("users-changed", { userId: req.user.id });
    return res.json({ ok: true, frame: "clean" });
  }
  if (!storeFrames.has(frame)) return res.status(400).json({ error: "Choose a valid profile frame." });
  if (!(await hasStoreItem(req.user, "profile-frames"))) return res.status(403).json({ error: "Unlock Profile Frames from the Chat Store first." });
  await pool.query("UPDATE users SET frame = ? WHERE id = ?", [frame, req.user.id]);
  invalidateUserCache(req.user.id);
  broadcast("users-changed", { userId: req.user.id });
  res.json({ ok: true, frame });
});

router.post("/store/profile-music", requireAuth, requireProfileMusicAccess, receiveProfileMusic, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose an MP3 file." });
  const profileMusicUrl = fileToDataUrl(req.file);
  const [[current]] = await pool.query("SELECT profile_music_url FROM users WHERE id = ?", [req.user.id]);
  await pool.query("UPDATE users SET profile_music_url = ? WHERE id = ?", [profileMusicUrl, req.user.id]);
  invalidateUserCache(req.user.id);
  await removeProfileMusicFile(current?.profile_music_url);
  res.status(201).json({ ok: true, profileMusicUrl });
});

router.delete("/store/profile-music", requireAuth, async (req, res) => {
  const [[current]] = await pool.query("SELECT profile_music_url FROM users WHERE id = ?", [req.user.id]);
  await pool.query("UPDATE users SET profile_music_url = NULL WHERE id = ?", [req.user.id]);
  await removeProfileMusicFile(current?.profile_music_url);
  invalidateUserCache(req.user.id);
  broadcast("users-changed", { userId: req.user.id });
  res.json({ ok: true });
});

router.post("/reports", requireAuth, async (req, res) => {
  let targetUserId = req.body.targetUserId ? Number(req.body.targetUserId) : null;
  if (targetUserId && targetUserId === Number(req.user.id)) return res.status(400).json({ error: "You cannot report yourself." });
  if (req.body.messageId) {
    const [[message]] = await pool.query(
      `SELECT m.user_id, m.body, u.username, u.rank_name
       FROM messages m
       JOIN users u ON u.id = m.user_id
       WHERE m.id = ?`,
      [req.body.messageId]
    );
    if (!message) return res.status(404).json({ error: "Message not found." });
    if (message.rank_name === "bot" || String(message.username || "").toLowerCase() === "intruder" || String(message.body || "").startsWith(INTRUDER_PREFIX)) {
      return res.status(403).json({ error: "System bot messages cannot be reported." });
    }
    if (Number(message.user_id) === Number(req.user.id)) return res.status(400).json({ error: "You cannot report your own message." });
    targetUserId = Number(message.user_id);
  }
  if (req.body.privateMessageId) {
    const [[message]] = await pool.query("SELECT sender_id, receiver_id FROM private_messages WHERE id = ?", [req.body.privateMessageId]);
    if (!message || (Number(message.sender_id) !== Number(req.user.id) && Number(message.receiver_id) !== Number(req.user.id))) return res.status(404).json({ error: "Private message not found." });
    if (Number(message.sender_id) === Number(req.user.id)) return res.status(400).json({ error: "You cannot report your own message." });
    targetUserId = Number(message.sender_id);
  }
  if (req.body.wallPostId) {
    const [[post]] = await pool.query("SELECT author_id FROM wall_posts WHERE id = ?", [req.body.wallPostId]);
    if (!post) return res.status(404).json({ error: "Wall post not found." });
    if (Number(post.author_id) === Number(req.user.id)) return res.status(400).json({ error: "You cannot report your own post." });
    targetUserId = Number(post.author_id);
  }
  await pool.query(
    "INSERT INTO reports (reporter_id, target_type, target_user_id, message_id, room_id, private_message_id, wall_post_id, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      req.user.id,
      String(req.body.targetType || "user").slice(0, 40),
      targetUserId || null,
      req.body.messageId || null,
      req.body.roomId || null,
      req.body.privateMessageId || null,
      req.body.wallPostId || null,
      String(req.body.reason || "Reported").slice(0, 255),
    ]
  );
  broadcast("report-created", { targetUserId });
  res.status(201).json({ ok: true });
});

router.get("/news", requireAuth, async (_req, res) => {
  if (responseCache.news && Date.now() - responseCache.newsAt < 20000) {
    res.set("Cache-Control", "private, max-age=15");
    return res.json(responseCache.news);
  }
  const [rows] = await pool.query(
    `SELECT np.*, u.username, u.avatar_url, u.rank_name
     FROM news_posts np
     JOIN users u ON u.id = np.author_id
     ORDER BY np.created_at DESC
     LIMIT 15`
  );
  const ids = rows.map((row) => row.id);
  let comments = [];
  if (ids.length) {
    const [commentRows] = await pool.query(
      `SELECT nc.*, u.username, u.avatar_url, u.rank_name, u.profile_title
       FROM news_comments nc
       JOIN users u ON u.id = nc.user_id
       WHERE nc.news_id IN (?)
       ORDER BY nc.created_at DESC
       LIMIT 150`,
      [ids]
    );
    comments = commentRows;
  }
  responseCache.news = rows.map((row) => ({ ...row, comments: comments.filter((comment) => Number(comment.news_id) === Number(row.id)).reverse() }));
  responseCache.newsAt = Date.now();
  res.set("Cache-Control", "private, max-age=15");
  res.json(responseCache.news);
});

router.post("/news", requireAuth, newsUpload.single("image"), async (req, res) => {
  if (!(await permission(req.user, "postNews"))) return res.status(403).json({ error: "Your rank cannot post news." });
  const title = String(req.body.title || "").trim().slice(0, 120);
  const body = String(req.body.body || "").trim().slice(0, 2000);
  const imageUrl = req.file ? fileToDataUrl(req.file) : null;
  if (!title || !body) return res.status(400).json({ error: "News title and body are required." });
  const [result] = await pool.query(
    "INSERT INTO news_posts (author_id, title, body, image_url) VALUES (?, ?, ?, ?)",
    [req.user.id, title, body, imageUrl]
  );
  clearNewsCache();
  broadcast("news-posted", { id: result.insertId, title });
  res.status(201).json({ id: result.insertId });
});

router.post("/news/:id/comments", requireAuth, async (req, res) => {
  if (muted(req.user)) return res.status(403).json({ error: "You are muted and cannot post messages." });
  const body = String(req.body.body || "").trim().slice(0, 500);
  if (!body) return res.status(400).json({ error: "Comment cannot be empty." });
  const [[post]] = await pool.query("SELECT id FROM news_posts WHERE id = ?", [req.params.id]);
  if (!post) return res.status(404).json({ error: "News post not found." });
  const [result] = await pool.query("INSERT INTO news_comments (news_id, user_id, body) VALUES (?, ?, ?)", [post.id, req.user.id, body]);
  const [[comment]] = await pool.query(
    `SELECT nc.*, u.username, u.avatar_url, u.rank_name, u.profile_title
     FROM news_comments nc
     JOIN users u ON u.id = nc.user_id
     WHERE nc.id = ?`,
    [result.insertId]
  );
  clearNewsCache();
  broadcast("news-posted", { id: post.id, comment: true });
  res.status(201).json(comment);
});

router.delete("/news/:id", requireAuth, async (req, res) => {
  if (!canManageNews(req.user)) return res.status(403).json({ error: "Chief or developer access required." });
  const newsId = Number(req.params.id);
  if (!Number.isInteger(newsId) || newsId < 1) return res.status(400).json({ error: "Invalid news post." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[post]] = await connection.query("SELECT id, title FROM news_posts WHERE id = ? FOR UPDATE", [newsId]);
    if (!post) {
      await connection.rollback();
      return res.status(404).json({ error: "News post not found." });
    }
    await connection.query("DELETE FROM news_comments WHERE news_id = ?", [newsId]);
    await connection.query("DELETE FROM news_posts WHERE id = ?", [newsId]);
    await connection.query(
      "INSERT INTO admin_logs (actor_id, action, target_type, target_id, details) VALUES (?, 'delete_news', 'news', ?, ?)",
      [req.user.id, newsId, String(post.title || "").slice(0, 120)]
    );
    await connection.commit();
    clearNewsCache();
    broadcast("news-deleted", { id: newsId, by: req.user.username });
    res.json({ ok: true, id: newsId });
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
});

router.delete("/news", requireAuth, async (req, res) => {
  if (!canManageNews(req.user)) return res.status(403).json({ error: "Chief or developer access required." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[countRow]] = await connection.query("SELECT COUNT(*) AS total FROM news_posts");
    await connection.query("DELETE FROM news_comments");
    await connection.query("DELETE FROM news_posts");
    const deleted = Number(countRow?.total || 0);
    await connection.query(
      "INSERT INTO admin_logs (actor_id, action, target_type, target_id, details) VALUES (?, 'clear_news', 'news', NULL, ?)",
      [req.user.id, `deleted:${deleted}`]
    );
    await connection.commit();
    clearNewsCache();
    broadcast("news-deleted", { all: true, deleted, by: req.user.username });
    res.json({ ok: true, deleted });
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
});

router.get("/leaderboards", requireAuth, async (req, res) => {
  const project = "id, username, display_name, avatar_url, rank_name, profile_title, xp, gold, diamonds, message_count";
  const publicUsers = "rank_name <> 'bot' AND LOWER(username) NOT IN ('intruder', 'zombie')";
  const board = String(req.query.board || "").toLowerCase();
  const cached = responseCache.leaderboards.get(board);
  if (cached && Date.now() - cached.at < 15000) {
    res.set("Cache-Control", "private, max-age=10");
    return res.json(cached.data);
  }
  const queries = {
    xp: () => pool.query(`SELECT ${project} FROM users WHERE ${publicUsers} ORDER BY xp DESC, username ASC LIMIT 20`),
    gold: () => pool.query(`SELECT ${project} FROM users WHERE ${publicUsers} ORDER BY gold DESC, username ASC LIMIT 20`),
    diamonds: () => pool.query(`SELECT ${project} FROM users WHERE ${publicUsers} ORDER BY diamonds DESC, username ASC LIMIT 20`),
    shooters: () => pool.query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.rank_name, u.profile_title,
              u.xp, u.gold, u.diamonds, u.message_count,
              s.points AS intruder_points, s.shots AS intruder_shots
       FROM intruder_scores s
       JOIN users u ON u.id = s.user_id
       WHERE ${publicUsers}
       ORDER BY s.points DESC, s.shots DESC, u.username ASC
       LIMIT 20`
    ),
  };
  if (queries[board]) {
    const [rows] = await queries[board]();
    const data = { board, rows };
    responseCache.leaderboards.set(board, { data, at: Date.now() });
    res.set("Cache-Control", "private, max-age=10");
    return res.json(data);
  }
  const [xp] = await queries.xp();
  const [gold] = await queries.gold();
  const [diamonds] = await queries.diamonds();
  const [shooters] = await queries.shooters();
  res.json({ xp, gold, diamonds, shooters });
});

router.post("/memberships/rank", requireAuth, async (req, res) => {
  const targetRank = normalizeRank(req.body.rank);
  const planCode = String(req.body.plan || "");
  const price = rankPlans[targetRank]?.[planCode];
  if (!price || !durationLabels[planCode]) return res.status(400).json({ error: "Choose a valid rank and time period." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[user]] = await connection.query("SELECT id, rank_name, gold, diamonds, svip_until, rank_until, rank_plan, rank_base FROM users WHERE id = ? FOR UPDATE", [req.user.id]);
    if (!user) throw new Error("User not found.");
    const currentRank = normalizeRank(user.rank_name);
    const currentPower = rankPower(currentRank);
    const targetPower = rankPower(targetRank);
    if (currentPower >= rankPower("premium")) throw new Error("Premium and staff ranks cannot buy ranks.");
    if (currentPower > targetPower) throw new Error("You cannot buy a rank below your current rank.");
    const activeUntil = user.rank_until && new Date(user.rank_until) > new Date();
    if (currentRank === targetRank && !activeUntil) throw new Error("You already have " + targetRank.toUpperCase() + " rank.");
    if (currentRank === targetRank && activeUntil) {
      if (user.rank_plan === planCode) throw new Error(`Your ${durationLabels[planCode]} ${targetRank.toUpperCase()} plan is already active.`);
      if (durationPower[planCode] <= durationPower[user.rank_plan]) throw new Error("Choose a longer active period than your current plan.");
    }
    if (Number(user.gold) < price.gold || Number(user.diamonds) < price.diamonds) throw new Error("Not enough gold or diamonds for this rank plan.");
    const baseRank = activeUntil && user.rank_base ? user.rank_base : currentRank;
    const rankUntil = planCode === "lifetime" ? "9999-12-31 23:59:59" : null;
    await connection.query(
      `UPDATE users
       SET gold = gold - ?, diamonds = diamonds - ?, rank_name = ?, rank_plan = ?, rank_base = ?,
           rank_until = ${rankUntil ? "?" : "DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY)"},
           svip_until = ${targetRank === "s-vip" ? (rankUntil ? "?" : "DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY)") : "NULL"}
       WHERE id = ?`,
      rankUntil
        ? [price.gold, price.diamonds, targetRank, planCode, baseRank, rankUntil, ...(targetRank === "s-vip" ? [rankUntil] : []), user.id]
        : [price.gold, price.diamonds, targetRank, planCode, baseRank, durationDays[planCode], ...(targetRank === "s-vip" ? [durationDays[planCode]] : []), user.id]
    );
    await connection.query(
      "INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)",
      [user.id, "membership", `${targetRank.toUpperCase()} activated`, `Your ${durationLabels[planCode]} ${targetRank.toUpperCase()} package is active.`]
    );
    await connection.commit();
    invalidateUserCache(user.id);
    notifyUser(user.id, "notification", { type: "membership", title: `${targetRank.toUpperCase()} activated`, body: `Your ${durationLabels[planCode]} package is active.` });
    broadcast("users-changed", { userId: user.id });
    const [[fresh]] = await pool.query("SELECT gold, diamonds, rank_name, svip_until, rank_until, rank_plan FROM users WHERE id = ?", [user.id]);
    res.json({ ok: true, rank: targetRank, plan: durationLabels[planCode], user: fresh });
  } catch (error) {
    await connection.rollback();
    res.status(400).json({ error: error.message || "Could not buy this rank." });
  } finally {
    connection.release();
  }
});

router.get("/notifications", requireAuth, async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 12", [req.user.id]);
  res.json(rows);
});

router.post("/notifications/read", requireAuth, async (req, res) => {
  await pool.query("UPDATE notifications SET is_read = 1 WHERE user_id = ?", [req.user.id]);
  res.json({ ok: true });
});

module.exports = router;
