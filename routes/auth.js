const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const pool = require("../database");
const { requireAuth, cacheUser, invalidateUserCache, isStaff } = require("../middleware/auth");
const { imageUpload, fileToDataUrl } = require("../services/upload");
const { calculateAge, publicUser, rankBadges } = require("../services/userService");
const { broadcast } = require("../services/events");
const { clientIp, countryFromHeaders, refreshUserLocation } = require("../services/geoLocation");
const {
  normalizeUsername,
  normalizeEmail,
  isValidUsername,
  isValidEmail,
  isDuplicateKeyError,
  duplicateKeyMessage,
  findUserIdentityConflict,
} = require("../services/identity");

const router = express.Router();
const avatarUpload = imageUpload("avatars");
const bannerUpload = imageUpload("banners");
const exposedTools = ["postNews", "warn", "mute", "kick", "ban", "deleteAccount", "changeRank", "editProfile", "customTitle", "invisibleStatus", "intruderTool", "profileEditTool"];
const userDirectoryColumns = `id, username, display_name, age, gender, rank_name, avatar_url,
  profile_title, profile_status, show_online_status, mood, xp, gold, diamonds, country,
  frame, last_seen, created_at`;
const permissionCache = new Map();
const directoryCache = { rows: null, at: 0 };
const DIRECTORY_CACHE_MS = 5000;
const PERMISSION_CACHE_MS = 30000;

async function userDirectory() {
  if (directoryCache.rows && Date.now() - directoryCache.at < DIRECTORY_CACHE_MS) return directoryCache.rows;
  const [rows] = await pool.query(
    `SELECT ${userDirectoryColumns} FROM users
     WHERE rank_name <> 'bot' AND LOWER(username) NOT IN ('intruder', 'zombie')
     ORDER BY FIELD(rank_name,'developer','chief','manager','inspector','supervisor','super visor','superadmin','visor','admin','moderator','premium','queen','king','s-vip','vip','user'), username`
  );
  directoryCache.rows = rows;
  directoryCache.at = Date.now();
  return rows;
}

async function removeUploadedAsset(url, folder) {
  const value = String(url || "");
  const prefix = `/uploads/${folder}/`;
  if (!value.startsWith(prefix)) return;
  const filename = path.basename(decodeURIComponent(value));
  const target = path.join(__dirname, "..", "uploads", folder, filename);
  await fs.promises.unlink(target).catch(() => {});
}

function sign(user) {
  return jwt.sign({ id: user.id, v: Number(user.token_version || 0) }, process.env.JWT_SECRET, { expiresIn: "30d" });
}

async function hasProfileTool(user, tool) {
  if (user.rank_name === "developer") return true;
  const [[row]] = await pool.query("SELECT allowed FROM role_permissions WHERE rank_name = ? AND tool = ?", [user.rank_name, tool]);
  return Boolean(row?.allowed);
}

async function userPermissions(user) {
  if (user.rank_name === "developer") return Object.fromEntries(exposedTools.map((tool) => [tool, true]));
  const cached = permissionCache.get(user.rank_name);
  if (cached && Date.now() - cached.at < PERMISSION_CACHE_MS) return cached.value;
  const [rows] = await pool.query("SELECT tool, allowed FROM role_permissions WHERE rank_name = ? AND tool IN (?)", [user.rank_name, exposedTools]);
  const permissions = Object.fromEntries(exposedTools.map((tool) => [tool, false]));
  for (const row of rows) permissions[row.tool] = Boolean(row.allowed);
  permissionCache.set(user.rank_name, { value: permissions, at: Date.now() });
  return permissions;
}

router.post("/register", async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const email = normalizeEmail(req.body.email);
  const { password, dob, gender = "other" } = req.body;
  if (!isValidUsername(username)) return res.status(400).json({ error: "Username must be 3-18 letters, numbers, or underscores." });
  if (!isValidEmail(email)) return res.status(400).json({ error: "Enter a valid email." });
  if (!password || password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
  const age = calculateAge(dob);
  if (!dob || !Number.isFinite(age) || age < 13) return res.status(400).json({ error: "You must be at least 13 to register." });
  const conflict = await findUserIdentityConflict(pool, { username, email });
  if (conflict.username) return res.status(409).json({ error: "This username is already taken." });
  if (conflict.email) return res.status(409).json({ error: "This email is already taken." });
  const passwordHash = await bcrypt.hash(password, 10);
  const ip = clientIp(req);
  const country = countryFromHeaders(req);
  let result;
  try {
    [result] = await pool.query(
      `INSERT INTO users (username, email, password_hash, dob, age, gender, ip_address, country, avatar_url, banner_url, chat_background)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [username, email, passwordHash, dob, age, gender, ip, country, `/assets/avatar-${gender}.svg`, "/assets/profile-banner.svg", "moonlake"]
    );
  } catch (error) {
    if (isDuplicateKeyError(error)) return res.status(409).json({ error: duplicateKeyMessage(error) });
    throw error;
  }
  refreshUserLocation(result.insertId, req).catch((error) => console.warn("Country detection failed:", error.message));
  const [rows] = await pool.query("SELECT * FROM users WHERE id = ?", [result.insertId]);
  res.status(201).json({ token: sign(rows[0]) });
});

router.post("/login", async (req, res) => {
  const identity = String(req.body.identity || "").toLowerCase().trim();
  const [rows] = await pool.query("SELECT * FROM users WHERE username = ? OR email = ?", [identity, identity]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(String(req.body.password || ""), user.password_hash))) {
    return res.status(401).json({ error: "Invalid login details." });
  }
  if (user.banned_until && new Date(user.banned_until) > new Date()) return res.status(403).json({ error: "This account is banned." });
  if (user.kicked_until && new Date(user.kicked_until) > new Date()) return res.status(403).json({ error: "You were temporarily kicked. Please try again later." });
  await pool.query("UPDATE users SET last_seen = NOW() WHERE id = ?", [user.id]);
  refreshUserLocation(user.id, req).catch((error) => console.warn("Country detection failed:", error.message));
  res.json({ token: sign(user) });
});

router.post("/logout", requireAuth, async (req, res) => {
  await pool.query("UPDATE users SET last_seen = NOW() WHERE id = ?", [req.user.id]);
  res.json({ ok: true });
});

router.get("/me", requireAuth, async (req, res) => {
  if (req.user.rank_name === "s-vip" && req.user.svip_until && new Date(req.user.svip_until) < new Date()) {
    await pool.query("UPDATE users SET rank_name = 'user', svip_until = NULL WHERE id = ?", [req.user.id]);
    req.user.rank_name = "user";
    req.user.svip_until = null;
  }
  if (!req.user.last_online_reward_at || (Date.now() - new Date(req.user.last_online_reward_at).getTime()) >= 10 * 60 * 1000) {
    await pool.query("UPDATE users SET diamonds = diamonds + 3, last_online_reward_at = NOW(), last_seen = NOW() WHERE id = ?", [req.user.id]);
    req.user.diamonds = Number(req.user.diamonds || 0) + 3;
    req.user.last_online_reward_at = new Date();
  } else {
    pool.query("UPDATE users SET last_seen = NOW() WHERE id = ?", [req.user.id]).catch(() => {});
  }
  req.user.last_seen = new Date();
  cacheUser(req.user);
  const [roomsResult, users, notificationsResult, privateUnreadResult, friendRequestsResult, badges, permissions] = await Promise.all([
    pool.query("SELECT id, name, description, image_url, is_pinned, staff_only, created_by, created_at, IF(password_hash IS NULL OR password_hash = '', 0, 1) AS locked FROM rooms WHERE staff_only = 0 OR ? = 1 ORDER BY CASE WHEN name = 'Main Room' THEN 0 ELSE 1 END, is_pinned DESC, name", [isStaff(req.user) ? 1 : 0]),
    userDirectory(),
    pool.query("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 12", [req.user.id]),
    pool.query("SELECT COUNT(*) AS count FROM private_messages WHERE receiver_id = ? AND read_at IS NULL AND deleted_at IS NULL", [req.user.id]),
    pool.query(`SELECT fr.*, u.username, u.avatar_url, u.rank_name FROM friend_requests fr
      JOIN users u ON u.id = fr.from_user_id
      WHERE fr.to_user_id = ? AND fr.status = 'pending'
      ORDER BY fr.created_at DESC`, [req.user.id]),
    rankBadges(),
    userPermissions(req.user),
  ]);
  const rooms = roomsResult[0];
  const notifications = notificationsResult[0];
  const privateUnread = privateUnreadResult[0][0];
  const friendRequests = friendRequestsResult[0];
  res.set("Cache-Control", "private, no-store");
  res.json({
    me: publicUser(req.user, req.user),
    rooms,
    users: users.map((user) => publicUser(user, req.user)),
    notifications,
    friendRequests,
    unreadPm: Number(privateUnread.count || 0),
    rankBadges: badges,
    permissions,
  });
});

router.get("/users", requireAuth, async (req, res) => {
  const users = await userDirectory();
  res.set("Cache-Control", "private, max-age=8, stale-while-revalidate=20");
  res.json({
    me: publicUser(req.user, req.user),
    users: users.map((user) => publicUser(user, req.user)),
    permissions: await userPermissions(req.user),
  });
});

router.patch("/me", requireAuth, async (req, res) => {
  const allowed = ["displayName", "bio", "aboutMe", "mood", "theme", "chatBackground", "bubbleStyle", "usernameColor", "textColor", "animatedBannerUrl", "profileTitle", "profileStatus", "profileAccent", "showOnlineStatus"];
  const data = {};
  const limits = { displayName: 40, bio: 120, chatBackground: 40, profileTitle: 80, profileStatus: 40, profileAccent: 24, aboutMe: 1500 };
  const allowedChatBackgrounds = new Set(["moonlake", "autumn", "neon-city", "sunrise"]);
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      if (key === "chatBackground") {
        const chatBackground = String(req.body[key] || "moonlake");
        if (!allowedChatBackgrounds.has(chatBackground)) {
          return res.status(400).json({ error: "Choose a valid room background." });
        }
        data[key] = chatBackground;
        continue;
      }
      if (key === "profileTitle" && String(req.body[key] || "").trim() && !(await hasProfileTool(req.user, "customTitle"))) {
        return res.status(403).json({ error: "Your rank cannot set a custom title yet." });
      }
      if (key === "profileStatus") {
        const status = String(req.body[key]);
        const statusRanks = new Set(["premium", "chief", "developer"]);
        const allowedStatuses = new Set(["Online", "Away", "Busy", "Be right back", "Listening to music", "Watching video", "Gaming", "Friendly", "Sad", "Invisible"]);
        if (!statusRanks.has(req.user.rank_name)) return res.status(403).json({ error: "Custom status is available to Premium, Chief, and Developer." });
        if (!allowedStatuses.has(status)) return res.status(400).json({ error: "Choose a valid profile status." });
      }
      data[key] = key === "showOnlineStatus"
        ? (req.body[key] ? 1 : 0)
        : String(req.body[key]).slice(0, limits[key] || 255);
    }
  }
  const columns = {
    displayName: "display_name",
    aboutMe: "about_me",
    chatBackground: "chat_background",
    bubbleStyle: "bubble_style",
    usernameColor: "username_color",
    textColor: "text_color",
    animatedBannerUrl: "animated_banner_url",
    profileTitle: "profile_title",
    profileStatus: "profile_status",
    profileAccent: "profile_accent",
    showOnlineStatus: "show_online_status",
  };
  if (req.body.username !== undefined) {
    const username = normalizeUsername(req.body.username);
    if (!isValidUsername(username)) return res.status(400).json({ error: "Username must be 3-18 letters, numbers, or underscores." });
    if (username.toLowerCase() !== String(req.user.username || "").toLowerCase()) {
      if (!["vip", "s-vip", "king", "queen", "premium", "moderator", "admin", "visor", "superadmin", "supervisor", "super visor", "inspector", "manager", "chief", "developer"].includes(req.user.rank_name)) {
        return res.status(403).json({ error: "Username change requires VIP or higher." });
      }
      const conflict = await findUserIdentityConflict(pool, { username, excludeId: req.user.id });
      if (conflict.username) return res.status(409).json({ error: "This username is already taken." });
      data.username = username;
    }
  }
  const entries = Object.entries(data);
  if (entries.length) {
    try {
      await pool.query(
        `UPDATE users SET ${entries.map(([key]) => `${columns[key] || key} = ?`).join(", ")} WHERE id = ?`,
        [...entries.map(([, value]) => value), req.user.id]
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) return res.status(409).json({ error: duplicateKeyMessage(error) });
      throw error;
    }
    directoryCache.rows = null;
  }
  await pool.query("INSERT IGNORE INTO user_achievements (user_id, achievement_id) SELECT ?, id FROM achievements WHERE code = 'profile_ready'", [req.user.id]);
  const [rows] = await pool.query("SELECT * FROM users WHERE id = ?", [req.user.id]);
  cacheUser(rows[0]);
  broadcast("users", { changed: publicUser(rows[0], req.user) });
  res.json({ me: publicUser(rows[0], rows[0]) });
});

router.post("/me/password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!(await bcrypt.compare(String(currentPassword || ""), req.user.password_hash))) return res.status(401).json({ error: "Current password is wrong." });
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: "New password must be at least 6 characters." });
  await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [await bcrypt.hash(newPassword, 10), req.user.id]);
  invalidateUserCache(req.user.id);
  res.json({ ok: true });
});

router.post("/me/avatar", requireAuth, avatarUpload.single("avatar"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose an avatar image." });
  const url = fileToDataUrl(req.file);
  const [[current]] = await pool.query("SELECT avatar_url FROM users WHERE id = ?", [req.user.id]);
  await pool.query("UPDATE users SET avatar_url = ? WHERE id = ?", [url, req.user.id]);
  await removeUploadedAsset(current?.avatar_url, "avatars");
  invalidateUserCache(req.user.id);
  directoryCache.rows = null;
  broadcast("users-changed", { userId: req.user.id });
  res.json({ avatarUrl: url });
});

router.delete("/me/avatar", requireAuth, async (req, res) => {
  const [[current]] = await pool.query("SELECT avatar_url, gender FROM users WHERE id = ?", [req.user.id]);
  const avatarUrl = `/assets/avatar-${["male", "female", "other"].includes(current?.gender) ? current.gender : "other"}.svg`;
  await pool.query("UPDATE users SET avatar_url = ? WHERE id = ?", [avatarUrl, req.user.id]);
  await removeUploadedAsset(current?.avatar_url, "avatars");
  invalidateUserCache(req.user.id);
  directoryCache.rows = null;
  broadcast("users-changed", { userId: req.user.id });
  res.json({ ok: true, avatarUrl });
});

router.post("/me/banner", requireAuth, bannerUpload.single("banner"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a banner image." });
  const url = fileToDataUrl(req.file);
  const [[current]] = await pool.query("SELECT banner_url FROM users WHERE id = ?", [req.user.id]);
  await pool.query("UPDATE users SET banner_url = ? WHERE id = ?", [url, req.user.id]);
  await removeUploadedAsset(current?.banner_url, "banners");
  invalidateUserCache(req.user.id);
  broadcast("users-changed", { userId: req.user.id });
  res.json({ bannerUrl: url });
});

router.delete("/me/banner", requireAuth, async (req, res) => {
  const [[current]] = await pool.query("SELECT banner_url FROM users WHERE id = ?", [req.user.id]);
  const bannerUrl = "/assets/profile-banner.svg";
  await pool.query("UPDATE users SET banner_url = ? WHERE id = ?", [bannerUrl, req.user.id]);
  await removeUploadedAsset(current?.banner_url, "banners");
  invalidateUserCache(req.user.id);
  broadcast("users-changed", { userId: req.user.id });
  res.json({ ok: true, bannerUrl });
});

router.post("/me/delete-request", requireAuth, async (req, res) => {
  await pool.query("UPDATE users SET delete_requested_at = NOW() WHERE id = ?", [req.user.id]);
  res.json({ message: "Your account is scheduled for deletion in 7 days. You can cancel anytime before then." });
});

router.post("/me/cancel-delete", requireAuth, async (req, res) => {
  await pool.query("UPDATE users SET delete_requested_at = NULL WHERE id = ?", [req.user.id]);
  res.json({ message: "Account deletion cancelled." });
});

module.exports = router;
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const pool = require("../database");
const { requireAuth, cacheUser, invalidateUserCache, isStaff } = require("../middleware/auth");
const { imageUpload, fileToDataUrl } = require("../services/upload");
const { calculateAge, publicUser, rankBadges } = require("../services/userService");
const { broadcast } = require("../services/events");
const { clientIp, countryFromHeaders, refreshUserLocation } = require("../services/geoLocation");
const {
  normalizeUsername,
  normalizeEmail,
  isValidUsername,
  isValidEmail,
  isDuplicateKeyError,
  duplicateKeyMessage,
  findUserIdentityConflict,
} = require("../services/identity");

const router = express.Router();
const avatarUpload = imageUpload("avatars");
const bannerUpload = imageUpload("banners");
const exposedTools = ["postNews", "warn", "mute", "kick", "ban", "deleteAccount", "changeRank", "editProfile", "customTitle", "invisibleStatus", "intruderTool", "profileEditTool"];
const userDirectoryColumns = `id, username, display_name, age, gender, rank_name, avatar_url,
  profile_title, profile_status, show_online_status, mood, xp, gold, diamonds, country,
  frame, last_seen, created_at`;
const permissionCache = new Map();
const directoryCache = { rows: null, at: 0 };
const DIRECTORY_CACHE_MS = 5000;
const PERMISSION_CACHE_MS = 30000;

async function userDirectory() {
  if (directoryCache.rows && Date.now() - directoryCache.at < DIRECTORY_CACHE_MS) return directoryCache.rows;
  const [rows] = await pool.query(
    `SELECT ${userDirectoryColumns} FROM users
     WHERE rank_name <> 'bot' AND LOWER(username) NOT IN ('intruder', 'zombie')
     ORDER BY FIELD(rank_name,'developer','chief','manager','inspector','supervisor','super visor','superadmin','visor','admin','moderator','premium','queen','king','s-vip','vip','user'), username`
  );
  directoryCache.rows = rows;
  directoryCache.at = Date.now();
  return rows;
}

async function removeUploadedAsset(url, folder) {
  const value = String(url || "");
  const prefix = `/uploads/${folder}/`;
  if (!value.startsWith(prefix)) return;
  const filename = path.basename(decodeURIComponent(value));
  const target = path.join(__dirname, "..", "uploads", folder, filename);
  await fs.promises.unlink(target).catch(() => {});
}

function sign(user) {
  return jwt.sign({ id: user.id, v: Number(user.token_version || 0) }, process.env.JWT_SECRET, { expiresIn: "30d" });
}

async function hasProfileTool(user, tool) {
  if (user.rank_name === "developer") return true;
  const [[row]] = await pool.query("SELECT allowed FROM role_permissions WHERE rank_name = ? AND tool = ?", [user.rank_name, tool]);
  return Boolean(row?.allowed);
}

async function userPermissions(user) {
  if (user.rank_name === "developer") return Object.fromEntries(exposedTools.map((tool) => [tool, true]));
  const cached = permissionCache.get(user.rank_name);
  if (cached && Date.now() - cached.at < PERMISSION_CACHE_MS) return cached.value;
  const [rows] = await pool.query("SELECT tool, allowed FROM role_permissions WHERE rank_name = ? AND tool IN (?)", [user.rank_name, exposedTools]);
  const permissions = Object.fromEntries(exposedTools.map((tool) => [tool, false]));
  for (const row of rows) permissions[row.tool] = Boolean(row.allowed);
  permissionCache.set(user.rank_name, { value: permissions, at: Date.now() });
  return permissions;
}

router.post("/register", async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const email = normalizeEmail(req.body.email);
  const { password, dob, gender = "other" } = req.body;
  if (!isValidUsername(username)) return res.status(400).json({ error: "Username must be 3-18 letters, numbers, or underscores." });
  if (!isValidEmail(email)) return res.status(400).json({ error: "Enter a valid email." });
  if (!password || password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
  const age = calculateAge(dob);
  if (!dob || !Number.isFinite(age) || age < 13) return res.status(400).json({ error: "You must be at least 13 to register." });
  const conflict = await findUserIdentityConflict(pool, { username, email });
  if (conflict.username) return res.status(409).json({ error: "This username is already taken." });
  if (conflict.email) return res.status(409).json({ error: "This email is already taken." });
  const passwordHash = await bcrypt.hash(password, 10);
  const ip = clientIp(req);
  const country = countryFromHeaders(req);
  let result;
  try {
    [result] = await pool.query(
      `INSERT INTO users (username, email, password_hash, dob, age, gender, ip_address, country, avatar_url, banner_url, chat_background)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [username, email, passwordHash, dob, age, gender, ip, country, `/assets/avatar-${gender}.svg`, "/assets/profile-banner.svg", "moonlake"]
    );
  } catch (error) {
    if (isDuplicateKeyError(error)) return res.status(409).json({ error: duplicateKeyMessage(error) });
    throw error;
  }
  refreshUserLocation(result.insertId, req).catch((error) => console.warn("Country detection failed:", error.message));
  const [rows] = await pool.query("SELECT * FROM users WHERE id = ?", [result.insertId]);
  res.status(201).json({ token: sign(rows[0]) });
});

router.post("/login", async (req, res) => {
  const identity = String(req.body.identity || "").toLowerCase().trim();
  const [rows] = await pool.query("SELECT * FROM users WHERE username = ? OR email = ?", [identity, identity]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(String(req.body.password || ""), user.password_hash))) {
    return res.status(401).json({ error: "Invalid login details." });
  }
  if (user.banned_until && new Date(user.banned_until) > new Date()) return res.status(403).json({ error: "This account is banned." });
  if (user.kicked_until && new Date(user.kicked_until) > new Date()) return res.status(403).json({ error: "You were temporarily kicked. Please try again later." });
  await pool.query("UPDATE users SET last_seen = NOW() WHERE id = ?", [user.id]);
  refreshUserLocation(user.id, req).catch((error) => console.warn("Country detection failed:", error.message));
  res.json({ token: sign(user) });
});

router.post("/logout", requireAuth, async (req, res) => {
  await pool.query("UPDATE users SET last_seen = NOW() WHERE id = ?", [req.user.id]);
  res.json({ ok: true });
});

router.get("/me", requireAuth, async (req, res) => {
  if (req.user.rank_name === "s-vip" && req.user.svip_until && new Date(req.user.svip_until) < new Date()) {
    await pool.query("UPDATE users SET rank_name = 'user', svip_until = NULL WHERE id = ?", [req.user.id]);
    req.user.rank_name = "user";
    req.user.svip_until = null;
  }
  if (!req.user.last_online_reward_at || (Date.now() - new Date(req.user.last_online_reward_at).getTime()) >= 10 * 60 * 1000) {
    await pool.query("UPDATE users SET diamonds = diamonds + 3, last_online_reward_at = NOW(), last_seen = NOW() WHERE id = ?", [req.user.id]);
    req.user.diamonds = Number(req.user.diamonds || 0) + 3;
    req.user.last_online_reward_at = new Date();
  } else {
    pool.query("UPDATE users SET last_seen = NOW() WHERE id = ?", [req.user.id]).catch(() => {});
  }
  req.user.last_seen = new Date();
  cacheUser(req.user);
  const [roomsResult, users, notificationsResult, privateUnreadResult, friendRequestsResult, badges, permissions] = await Promise.all([
    pool.query("SELECT id, name, description, image_url, is_pinned, staff_only, created_by, created_at, IF(password_hash IS NULL OR password_hash = '', 0, 1) AS locked FROM rooms WHERE staff_only = 0 OR ? = 1 ORDER BY CASE WHEN name = 'Main Room' THEN 0 ELSE 1 END, is_pinned DESC, name", [isStaff(req.user) ? 1 : 0]),
    userDirectory(),
    pool.query("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 12", [req.user.id]),
    pool.query("SELECT COUNT(*) AS count FROM private_messages WHERE receiver_id = ? AND read_at IS NULL AND deleted_at IS NULL", [req.user.id]),
    pool.query(`SELECT fr.*, u.username, u.avatar_url, u.rank_name FROM friend_requests fr
      JOIN users u ON u.id = fr.from_user_id
      WHERE fr.to_user_id = ? AND fr.status = 'pending'
      ORDER BY fr.created_at DESC`, [req.user.id]),
    rankBadges(),
    userPermissions(req.user),
  ]);
  const rooms = roomsResult[0];
  const notifications = notificationsResult[0];
  const privateUnread = privateUnreadResult[0][0];
  const friendRequests = friendRequestsResult[0];
  res.set("Cache-Control", "private, no-store");
  res.json({
    me: publicUser(req.user, req.user),
    rooms,
    users: users.map((user) => publicUser(user, req.user)),
    notifications,
    friendRequests,
    unreadPm: Number(privateUnread.count || 0),
    rankBadges: badges,
    permissions,
  });
});

router.get("/users", requireAuth, async (req, res) => {
  const users = await userDirectory();
  res.set("Cache-Control", "private, max-age=8, stale-while-revalidate=20");
  res.json({
    me: publicUser(req.user, req.user),
    users: users.map((user) => publicUser(user, req.user)),
    permissions: await userPermissions(req.user),
  });
});

router.patch("/me", requireAuth, async (req, res) => {
  const allowed = ["displayName", "bio", "aboutMe", "mood", "theme", "chatBackground", "bubbleStyle", "usernameColor", "textColor", "animatedBannerUrl", "profileTitle", "profileStatus", "profileAccent", "showOnlineStatus"];
  const data = {};
  const limits = { displayName: 40, bio: 120, chatBackground: 40, profileTitle: 80, profileStatus: 40, profileAccent: 24, aboutMe: 1500 };
  const allowedChatBackgrounds = new Set(["moonlake", "autumn", "neon-city", "sunrise"]);
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      if (key === "chatBackground") {
        const chatBackground = String(req.body[key] || "moonlake");
        if (!allowedChatBackgrounds.has(chatBackground)) {
          return res.status(400).json({ error: "Choose a valid room background." });
        }
        data[key] = chatBackground;
        continue;
      }
      if (key === "profileTitle" && String(req.body[key] || "").trim() && !(await hasProfileTool(req.user, "customTitle"))) {
        return res.status(403).json({ error: "Your rank cannot set a custom title yet." });
      }
      if (key === "profileStatus") {
        const status = String(req.body[key]);
        const statusRanks = new Set(["premium", "chief", "developer"]);
        const allowedStatuses = new Set(["Online", "Away", "Busy", "Be right back", "Listening to music", "Watching video", "Gaming", "Friendly", "Sad", "Invisible"]);
        if (!statusRanks.has(req.user.rank_name)) return res.status(403).json({ error: "Custom status is available to Premium, Chief, and Developer." });
        if (!allowedStatuses.has(status)) return res.status(400).json({ error: "Choose a valid profile status." });
      }
      data[key] = key === "showOnlineStatus"
        ? (req.body[key] ? 1 : 0)
        : String(req.body[key]).slice(0, limits[key] || 255);
    }
  }
  const columns = {
    displayName: "display_name",
    aboutMe: "about_me",
    chatBackground: "chat_background",
    bubbleStyle: "bubble_style",
    usernameColor: "username_color",
    textColor: "text_color",
    animatedBannerUrl: "animated_banner_url",
    profileTitle: "profile_title",
    profileStatus: "profile_status",
    profileAccent: "profile_accent",
    showOnlineStatus: "show_online_status",
  };
  if (req.body.username !== undefined) {
    const username = normalizeUsername(req.body.username);
    if (!isValidUsername(username)) return res.status(400).json({ error: "Username must be 3-18 letters, numbers, or underscores." });
    if (username.toLowerCase() !== String(req.user.username || "").toLowerCase()) {
      if (!["vip", "s-vip", "king", "queen", "premium", "moderator", "admin", "visor", "superadmin", "supervisor", "super visor", "inspector", "manager", "chief", "developer"].includes(req.user.rank_name)) {
        return res.status(403).json({ error: "Username change requires VIP or higher." });
      }
      const conflict = await findUserIdentityConflict(pool, { username, excludeId: req.user.id });
      if (conflict.username) return res.status(409).json({ error: "This username is already taken." });
      data.username = username;
    }
  }
  const entries = Object.entries(data);
  if (entries.length) {
    try {
      await pool.query(
        `UPDATE users SET ${entries.map(([key]) => `${columns[key] || key} = ?`).join(", ")} WHERE id = ?`,
        [...entries.map(([, value]) => value), req.user.id]
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) return res.status(409).json({ error: duplicateKeyMessage(error) });
      throw error;
    }
    directoryCache.rows = null;
  }
  await pool.query("INSERT IGNORE INTO user_achievements (user_id, achievement_id) SELECT ?, id FROM achievements WHERE code = 'profile_ready'", [req.user.id]);
  const [rows] = await pool.query("SELECT * FROM users WHERE id = ?", [req.user.id]);
  cacheUser(rows[0]);
  broadcast("users", { changed: publicUser(rows[0], req.user) });
  res.json({ me: publicUser(rows[0], rows[0]) });
});

router.post("/me/password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!(await bcrypt.compare(String(currentPassword || ""), req.user.password_hash))) return res.status(401).json({ error: "Current password is wrong." });
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: "New password must be at least 6 characters." });
  await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [await bcrypt.hash(newPassword, 10), req.user.id]);
  invalidateUserCache(req.user.id);
  res.json({ ok: true });
});

router.post("/me/avatar", requireAuth, avatarUpload.single("avatar"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose an avatar image." });
  const url = fileToDataUrl(req.file);
  const [[current]] = await pool.query("SELECT avatar_url FROM users WHERE id = ?", [req.user.id]);
  await pool.query("UPDATE users SET avatar_url = ? WHERE id = ?", [url, req.user.id]);
  await removeUploadedAsset(current?.avatar_url, "avatars");
  invalidateUserCache(req.user.id);
  directoryCache.rows = null;
  broadcast("users-changed", { userId: req.user.id });
  res.json({ avatarUrl: url });
});

router.delete("/me/avatar", requireAuth, async (req, res) => {
  const [[current]] = await pool.query("SELECT avatar_url, gender FROM users WHERE id = ?", [req.user.id]);
  const avatarUrl = `/assets/avatar-${["male", "female", "other"].includes(current?.gender) ? current.gender : "other"}.svg`;
  await pool.query("UPDATE users SET avatar_url = ? WHERE id = ?", [avatarUrl, req.user.id]);
  await removeUploadedAsset(current?.avatar_url, "avatars");
  invalidateUserCache(req.user.id);
  directoryCache.rows = null;
  broadcast("users-changed", { userId: req.user.id });
  res.json({ ok: true, avatarUrl });
});

router.post("/me/banner", requireAuth, bannerUpload.single("banner"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a banner image." });
  const url = fileToDataUrl(req.file);
  const [[current]] = await pool.query("SELECT banner_url FROM users WHERE id = ?", [req.user.id]);
  await pool.query("UPDATE users SET banner_url = ? WHERE id = ?", [url, req.user.id]);
  await removeUploadedAsset(current?.banner_url, "banners");
  invalidateUserCache(req.user.id);
  broadcast("users-changed", { userId: req.user.id });
  res.json({ bannerUrl: url });
});

router.delete("/me/banner", requireAuth, async (req, res) => {
  const [[current]] = await pool.query("SELECT banner_url FROM users WHERE id = ?", [req.user.id]);
  const bannerUrl = "/assets/profile-banner.svg";
  await pool.query("UPDATE users SET banner_url = ? WHERE id = ?", [bannerUrl, req.user.id]);
  await removeUploadedAsset(current?.banner_url, "banners");
  invalidateUserCache(req.user.id);
  broadcast("users-changed", { userId: req.user.id });
  res.json({ ok: true, bannerUrl });
});

router.post("/me/delete-request", requireAuth, async (req, res) => {
  await pool.query("UPDATE users SET delete_requested_at = NOW() WHERE id = ?", [req.user.id]);
  res.json({ message: "Your account is scheduled for deletion in 7 days. You can cancel anytime before then." });
});

router.post("/me/cancel-delete", requireAuth, async (req, res) => {
  await pool.query("UPDATE users SET delete_requested_at = NULL WHERE id = ?", [req.user.id]);
  res.json({ message: "Account deletion cancelled." });
});

module.exports = router;
