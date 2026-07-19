const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../database");
const authRoutes = require("./auth");
const { requireAuth, canControl, isStaff, rankPower, invalidateUserCache } = require("../middleware/auth");
const { adminStats } = require("../services/userService");
const { ranks, staffTools } = require("../services/schema");
const { broadcast, notifyUser } = require("../services/events");
const { imageUpload, fileToDataUrl } = require("../services/upload");
const { getIntruderState, resetIntruderScores, updateIntruderSettings } = require("../services/intruderService");
const { developerProfilesVisible, setDeveloperProfilesVisible } = require("../services/developerVisibilityService");
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
const newsUpload = imageUpload("news");
const INTRUDER_PREFIX = "::intruder:";

function hasPanel(user) {
  return ["admin", "chief", "owner", "developer"].includes(user.rank_name);
}

function developerOnly(req, res, next) {
  if (req.user.rank_name !== "developer") return res.status(403).json({ error: "Restricted access required." });
  next();
}

async function permission(user, tool) {
  if (user.rank_name === "developer") return true;
  const ranksToCheck = user.rank_name === "owner" ? ["owner", "chief"] : [user.rank_name];
  const [[row]] = await pool.query("SELECT MAX(allowed) AS allowed FROM role_permissions WHERE rank_name IN (?) AND tool = ?", [ranksToCheck, tool]);
  return Boolean(Number(row?.allowed || 0));
}

async function specialToolAccess(user, tool) {
  return user.rank_name === "developer" || (["chief", "owner"].includes(user.rank_name) && await permission(user, tool));
}

async function requireIntruderTool(req, res, next) {
  if (!(await specialToolAccess(req.user, "intruderTool"))) return res.status(403).json({ error: "Intruder tool access required." });
  next();
}

async function requireProfileEditTool(req, res, next) {
  if (!(await specialToolAccess(req.user, "profileEditTool"))) return res.status(403).json({ error: "Edit tool access required." });
  next();
}

async function canDeletePrivateChats(user) {
  return isStaff(user) && rankPower(user.rank_name) >= rankPower("admin") && (await permission(user, "deleteMessage"));
}

async function log(actorId, action, targetType, targetId, details = "") {
  await pool.query("INSERT INTO admin_logs (actor_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)", [actorId, action, targetType, targetId, details]);
}

router.use(requireAuth);

router.get("/tools/summary", async (req, res) => {
  const canOpenTools = req.user.rank_name === "developer" || await permission(req.user, "postNews");
  if (!canOpenTools) return res.status(403).json({ error: "Higher staff access required." });
  const [staffAccess] = req.user.rank_name === "developer"
    ? await pool.query("SELECT tool, MIN(allowed) AS allowed FROM role_permissions WHERE rank_name IN ('chief', 'owner') AND tool IN ('intruderTool', 'profileEditTool') GROUP BY tool")
    : [[]];
  const intruderAccess = await specialToolAccess(req.user, "intruderTool");
  const toolState = intruderAccess ? await getIntruderState() : null;
  const intruder = toolState?.intruder;
  res.set("Cache-Control", "private, no-store");
  res.json({
    tools: intruder ? {
      intruder: {
        enabled: intruder.enabled,
        minIntervalMinutes: intruder.minIntervalMinutes,
        maxIntervalMinutes: intruder.maxIntervalMinutes,
        nextSpawnAt: intruder.nextSpawnAt,
        botName: intruder.botName,
        botAvatarUrl: intruder.botAvatarUrl,
        activeRound: intruder.activeRound,
      },
    } : null,
    toolAccess: {
      intruderTool: Boolean(Number(staffAccess.find((row) => row.tool === "intruderTool")?.allowed || 0)),
      profileEditTool: Boolean(Number(staffAccess.find((row) => row.tool === "profileEditTool")?.allowed || 0)),
      developerProfilesVisible: await developerProfilesVisible(),
    },
  });
});

router.get("/dashboard", async (req, res) => {
  if (!hasPanel(req.user)) return res.status(403).json({ error: "Admin panel access required." });
  const [permissions] = await pool.query("SELECT * FROM role_permissions");
  const [logs] = await pool.query(
    `SELECT al.*, u.username AS actor_name FROM admin_logs al JOIN users u ON u.id = al.actor_id WHERE u.rank_name <> 'developer' ORDER BY al.created_at DESC LIMIT 25`
  );
  const [reports] = await pool.query(
    `SELECT r.*, reporter.username AS reporter_name, target.username AS target_name
     FROM reports r
     LEFT JOIN users reporter ON reporter.id = r.reporter_id
     LEFT JOIN users target ON target.id = r.target_user_id
     WHERE COALESCE(reporter.rank_name, '') <> 'developer' AND COALESCE(target.rank_name, '') <> 'developer'
     ORDER BY r.created_at DESC LIMIT 30`
  );
  const [randomTalkReports] = await pool.query(
    `SELECT r.id, r.reporter_user_id, r.reported_user_id, r.reported_guest_id, r.category, r.details, r.status,
            r.internal_notes, r.created_at,
            COALESCE(reporter.username, CONCAT(reporter_guest.display_name, ' (Guest)')) AS reporter_name,
            COALESCE(reported.username, CONCAT(reported_guest.display_name, ' (Guest)')) AS reported_name,
            IF(active_ban.id IS NULL, 0, 1) AS network_banned,
            (SELECT COUNT(*) FROM random_talk_reports prior
             WHERE ((r.reported_user_id IS NOT NULL AND prior.reported_user_id = r.reported_user_id)
                OR (r.reported_guest_id IS NOT NULL AND prior.reported_guest_id = r.reported_guest_id))
               AND prior.id <> r.id) AS previous_offence_count
     FROM random_talk_reports r
     LEFT JOIN users reporter ON reporter.id = r.reporter_user_id
     LEFT JOIN users reported ON reported.id = r.reported_user_id
     LEFT JOIN guest_sessions reporter_guest ON reporter_guest.id = r.reporter_guest_id
     LEFT JOIN guest_sessions reported_guest ON reported_guest.id = r.reported_guest_id
     LEFT JOIN guest_network_bans active_ban ON active_ban.ip_hash = COALESCE(reported_guest.ip_hash, '') AND active_ban.revoked_at IS NULL AND (active_ban.expires_at IS NULL OR active_ban.expires_at > UTC_TIMESTAMP())
     WHERE COALESCE(reporter.rank_name, '') <> 'developer' AND COALESCE(reported.rank_name, '') <> 'developer'
     ORDER BY FIELD(r.status, 'open', 'reviewing', 'resolved', 'dismissed'), r.created_at DESC
     LIMIT 30`
  );
  const [[randomTalkMetrics]] = await pool.query(
    `SELECT COUNT(*) AS sessions,
            COALESCE(ROUND(AVG(CASE WHEN ended_at IS NOT NULL THEN TIMESTAMPDIFF(SECOND, started_at, ended_at) END)), 0) AS average_session_seconds,
            COALESCE(ROUND(100 * SUM(end_reason = 'skipped') / NULLIF(COUNT(*), 0), 1), 0) AS skip_rate,
            COALESCE(ROUND(100 * (SELECT COUNT(*) FROM random_talk_reports r WHERE r.created_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY) / NULLIF(COUNT(*), 0), 1), 0) AS reports_per_100_sessions
     FROM random_talk_sessions
     WHERE started_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY`
  );
  const [privateConversations] = await pool.query(
    `SELECT c.user_one_id, u1.username AS user_one_name, u1.avatar_url AS user_one_avatar,
            c.user_two_id, u2.username AS user_two_name, u2.avatar_url AS user_two_avatar,
            c.message_count, latest.created_at AS last_message_at,
            COALESCE(NULLIF(latest.body, ''), 'Image') AS last_body
     FROM (
       SELECT LEAST(sender_id, receiver_id) AS user_one_id,
              GREATEST(sender_id, receiver_id) AS user_two_id,
              MAX(id) AS last_message_id,
              COUNT(*) AS message_count
       FROM private_messages
       WHERE deleted_at IS NULL
       GROUP BY user_one_id, user_two_id
     ) c
     JOIN private_messages latest ON latest.id = c.last_message_id
     JOIN users u1 ON u1.id = c.user_one_id
     JOIN users u2 ON u2.id = c.user_two_id
     WHERE u1.rank_name <> 'developer' AND u2.rank_name <> 'developer'
     ORDER BY latest.created_at DESC
     LIMIT 20`
  );
  res.json({
    stats: await adminStats(),
    permissions,
    logs,
    reports,
    randomTalkReports,
    randomTalkMetrics,
    privateConversations,
    ranks,
    staffTools,
    tools: await specialToolAccess(req.user, "intruderTool") ? await getIntruderState() : null,
    toolAccess: {
      intruderTool: ["chief", "owner"].every((rank) => Boolean(Number(permissions.find((p) => p.rank_name === rank && p.tool === "intruderTool")?.allowed || 0))),
      profileEditTool: ["chief", "owner"].every((rank) => Boolean(Number(permissions.find((p) => p.rank_name === rank && p.tool === "profileEditTool")?.allowed || 0))),
      developerProfilesVisible: await developerProfilesVisible(),
    },
  });
});

router.patch("/users/:id", async (req, res) => {
  const [[target]] = await pool.query("SELECT * FROM users WHERE id = ?", [req.params.id]);
  if (!target) return res.status(404).json({ error: "User not found." });
  if (!canControl(req.user.rank_name, target.rank_name)) return res.status(403).json({ error: "You cannot control that user." });
  const updates = {};
  if (req.body.rank && ranks.includes(req.body.rank)) {
    if (req.body.rank === "bot") return res.status(403).json({ error: "Bot rank is reserved for system accounts." });
    if (!(await permission(req.user, "changeRank"))) return res.status(403).json({ error: "Your rank cannot change user ranks." });
    if (req.user.rank_name !== "developer" && (target.rank_name === "premium" || req.body.rank === "premium")) {
      return res.status(403).json({ error: "Premium rank is protected from this action." });
    }
    if (!canControl(req.user.rank_name, req.body.rank)) return res.status(403).json({ error: "You cannot assign that rank." });
    updates.rank_name = req.body.rank;
    updates.rank_until = null;
    updates.rank_plan = null;
    updates.rank_base = null;
    updates.svip_until = null;
  }
  if (req.body.username && await permission(req.user, "changeRank")) {
    const username = normalizeUsername(req.body.username);
    if (!isValidUsername(username)) return res.status(400).json({ error: "Username must be 3-18 letters, numbers, or underscores." });
    const conflict = await findUserIdentityConflict(pool, { username, excludeId: target.id });
    if (conflict.username) return res.status(409).json({ error: "This username is already taken." });
    updates.username = username;
  }
  if (req.body.email && await permission(req.user, "changeRank")) {
    const email = normalizeEmail(req.body.email);
    if (!isValidEmail(email)) return res.status(400).json({ error: "Enter a valid email." });
    const conflict = await findUserIdentityConflict(pool, { email, excludeId: target.id });
    if (conflict.email) return res.status(409).json({ error: "This email is already taken." });
    updates.email = email;
  }
  if (await permission(req.user, "editProfile")) {
    if (req.body.displayName !== undefined) updates.display_name = String(req.body.displayName).slice(0, 40);
    if (req.body.mood !== undefined) updates.mood = String(req.body.mood).slice(0, 80);
    if (req.body.avatarUrl !== undefined) updates.avatar_url = String(req.body.avatarUrl).slice(0, 500);
    if (req.body.bannerUrl !== undefined) updates.banner_url = String(req.body.bannerUrl).slice(0, 500);
  }
  if (req.user.rank_name === "developer") {
    if (req.body.gold !== undefined) updates.gold = Number(req.body.gold);
    if (req.body.diamonds !== undefined) updates.diamonds = Number(req.body.diamonds);
    if (req.body.xp !== undefined) updates.xp = Number(req.body.xp);
  }
  const entries = Object.entries(updates);
  if (entries.length) {
    try {
      await pool.query(`UPDATE users SET ${entries.map(([key]) => `${key} = ?`).join(", ")} WHERE id = ?`, [...entries.map(([, value]) => value), target.id]);
    } catch (error) {
      if (isDuplicateKeyError(error)) return res.status(409).json({ error: duplicateKeyMessage(error) });
      throw error;
    }
  }
  invalidateUserCache(target.id);
  await log(req.user.id, "update_user", "user", target.id, JSON.stringify(updates));
  broadcast("users-changed", { userId: target.id });
  res.json({ ok: true });
});

router.post("/users/:id/moderate", async (req, res) => {
  const [[target]] = await pool.query("SELECT * FROM users WHERE id = ?", [req.params.id]);
  if (!target) return res.status(404).json({ error: "User not found." });
  if (!isStaff(req.user) || !canControl(req.user.rank_name, target.rank_name)) return res.status(403).json({ error: "You cannot moderate that user." });
  const action = String(req.body.action || "");
  const tool = action === "delete" ? "deleteAccount" : action.replace(/^un/, "");
  if (!(await permission(req.user, tool))) return res.status(403).json({ error: "Your rank does not have this tool." });
  const reason = String(req.body.reason || "").trim().slice(0, 500);
  const notify = async (title, body, extra = {}) => {
    const [result] = await pool.query(
      "INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)",
      [target.id, "moderation", title, body]
    );
    notifyUser(target.id, "notification", { id: result.insertId, type: "moderation", title, body });
    notifyUser(target.id, "moderation", { action, title, body, ...extra });
  };
  if (action === "warn") {
    if (!reason) return res.status(400).json({ error: "Write a warning message first." });
    await notify("Staff warning", reason || "A staff member sent you a warning.");
  } else if (action === "mute") {
    const minutes = [1, 2, 3, 5, 10, 15, 20, 60, 120, 1440, 2880, 144000].includes(Number(req.body.minutes)) ? Number(req.body.minutes) : 10;
    await pool.query("UPDATE users SET muted_until = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?", [minutes, target.id]);
    await notify("You are muted", `You cannot chat or send PMs for ${minutes} minutes.${reason ? ` Reason: ${reason}` : ""}`);
  } else if (action === "unmute") {
    await pool.query("UPDATE users SET muted_until = NULL WHERE id = ?", [target.id]);
    await notify("Mute removed", "Your messaging access has been restored.");
  } else if (action === "kick") {
    if (!reason) return res.status(400).json({ error: "Add a reason for the kick." });
    const minutes = [1, 2, 3, 5, 10, 15, 20, 60, 120, 1440, 2880, 144000].includes(Number(req.body.minutes)) ? Number(req.body.minutes) : 10;
    await pool.query("UPDATE users SET kicked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE), kick_reason = ? WHERE id = ?", [minutes, reason, target.id]);
    await notify("You were kicked", `You cannot use the site for ${minutes === 2880 ? "2 days" : `${minutes} minutes`}. Reason: ${reason}`, { code: "KICKED", reason, until: new Date(Date.now() + minutes * 60000).toISOString() });
  } else if (action === "unkick") {
    await pool.query("UPDATE users SET kicked_until = NULL, kick_reason = '' WHERE id = ?", [target.id]);
    await notify("Kick removed", "You can enter TeenChatTown again.");
  } else if (action === "ban") {
    if (!reason) return res.status(400).json({ error: "Add a reason for the ban." });
    await pool.query("UPDATE users SET banned_until = '9999-12-31 23:59:59', ban_reason = ? WHERE id = ?", [reason, target.id]);
    await notify("Account banned", reason, { code: "BANNED", reason });
  } else if (action === "unban") {
    await pool.query("UPDATE users SET banned_until = NULL, ban_reason = '' WHERE id = ?", [target.id]);
    await notify("Ban removed", "Your TeenChatTown account has been restored.");
  } else if (action === "delete") {
    await pool.query("DELETE FROM users WHERE id = ?", [target.id]);
  } else {
    return res.status(400).json({ error: "Unknown action." });
  }
  invalidateUserCache(target.id);
  await log(req.user.id, action, "user", target.id, reason);
  broadcast("users-changed", { userId: target.id });
  res.json({ ok: true });
});

router.get("/users/:id/intel", async (req, res) => {
  if (!isStaff(req.user) || !(await permission(req.user, "viewUserIntel"))) return res.status(403).json({ error: "Staff intelligence permission required." });
  const [[target]] = await pool.query("SELECT id, username, rank_name, ip_address, ip_city, ip_region, ip_isp, country, last_seen, created_at FROM users WHERE id = ?", [req.params.id]);
  if (!target) return res.status(404).json({ error: "User not found." });
  if (Number(target.id) !== Number(req.user.id) && !canControl(req.user.rank_name, target.rank_name)) return res.status(403).json({ error: "You cannot view intelligence for that rank." });
  res.json({
    ip: target.ip_address || "Not captured",
    city: target.ip_city || "Not detected",
    region: target.ip_region || "Not detected",
    country: target.country || "Not detected",
    provider: target.ip_isp || "Not supplied by network",
    lastSeen: target.last_seen,
    createdAt: target.created_at,
  });
});

router.post("/users/:id/profile-edit", requireProfileEditTool, async (req, res) => {
  const [[target]] = await pool.query("SELECT * FROM users WHERE id = ?", [req.params.id]);
  if (!target) return res.status(404).json({ error: "User not found." });
  if (!canControl(req.user.rank_name, target.rank_name)) return res.status(403).json({ error: "You cannot edit that user." });

  const action = String(req.body.action || "");
  if (action === "username") {
    const username = normalizeUsername(req.body.username);
    if (!isValidUsername(username)) return res.status(400).json({ error: "Username must be 3-18 letters, numbers, or underscores." });
    const conflict = await findUserIdentityConflict(pool, { username, excludeId: target.id });
    if (conflict.username) return res.status(409).json({ error: "This username is already taken." });
    await pool.query("UPDATE users SET username = ? WHERE id = ?", [username, target.id]);
    await log(req.user.id, "profile_edit_username", "user", target.id, username);
  } else if (action === "deleteAvatar") {
    const avatarUrl = `/assets/avatar-${["male", "female", "other"].includes(target.gender) ? target.gender : "other"}.svg`;
    await pool.query("UPDATE users SET avatar_url = ? WHERE id = ?", [avatarUrl, target.id]);
    await log(req.user.id, "profile_edit_avatar_delete", "user", target.id, avatarUrl);
  } else if (action === "password") {
    const newPassword = String(req.body.password || "");
    if (newPassword.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
    await pool.query(
      "UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?",
      [await bcrypt.hash(newPassword, 10), target.id]
    );
    notifyUser(target.id, "moderation", { action: "password", title: "Password changed", body: "An authorised account changed your password. Please log in again." });
    await log(req.user.id, "profile_edit_password", "user", target.id, "password changed");
  } else if (action === "deleteAccount") {
    await pool.query("DELETE FROM users WHERE id = ?", [target.id]);
    notifyUser(target.id, "moderation", { action: "delete", title: "Account deleted", body: "Your account was deleted by staff." });
    await log(req.user.id, "profile_edit_delete_account", "user", target.id, "deleted");
  } else {
    return res.status(400).json({ error: "Unknown edit action." });
  }

  invalidateUserCache(target.id);
  broadcast("users-changed", { userId: target.id });
  res.json({ ok: true });
});

router.patch("/reports/:id", async (req, res) => {
  if (!hasPanel(req.user)) return res.status(403).json({ error: "Admin panel access required." });
  const status = String(req.body.status || "open");
  if (!["open", "reviewing", "resolved", "dismissed"].includes(status)) return res.status(400).json({ error: "Invalid report status." });
  await pool.query("UPDATE reports SET status = ? WHERE id = ?", [status, req.params.id]);
  await log(req.user.id, "report_status", "report", req.params.id, status);
  res.json({ ok: true });
});

router.get("/reports", async (req, res) => {
  if (!isStaff(req.user)) return res.status(403).json({ error: "Staff access required." });
  const [reports] = await pool.query(
    `SELECT r.*, reporter.username AS reporter_name, target.username AS target_name
     FROM reports r
     LEFT JOIN users reporter ON reporter.id = r.reporter_id
     LEFT JOIN users target ON target.id = r.target_user_id
     ORDER BY FIELD(r.status, 'open', 'reviewing', 'resolved', 'dismissed'), r.created_at DESC
     LIMIT 80`
  );
  res.json(reports);
});

router.post("/reports/:id/action", async (req, res) => {
  if (!isStaff(req.user)) return res.status(403).json({ error: "Staff access required." });
  const action = String(req.body.action || "ignore");
  const [[report]] = await pool.query("SELECT * FROM reports WHERE id = ?", [req.params.id]);
  if (!report) return res.status(404).json({ error: "Report not found." });
  if (action === "ignore") {
    await pool.query("UPDATE reports SET status = 'dismissed' WHERE id = ?", [report.id]);
    await log(req.user.id, "report_ignore", "report", report.id, report.reason);
    return res.json({ ok: true });
  }
  if (action !== "delete") return res.status(400).json({ error: "Unknown report action." });
  if (!(await permission(req.user, "deleteMessage"))) return res.status(403).json({ error: "Your rank cannot delete reported content." });

  let deleted = false;
  if (report.message_id) {
    const [[message]] = await pool.query(
      `SELECT m.body, u.username, u.rank_name
       FROM messages m
       JOIN users u ON u.id = m.user_id
       WHERE m.id = ?`,
      [report.message_id]
    );
    if (message && (message.rank_name === "bot" || String(message.username || "").toLowerCase() === "intruder" || String(message.body || "").startsWith(INTRUDER_PREFIX))) {
      return res.status(403).json({ error: "System bot messages cannot be deleted." });
    }
    await pool.query("UPDATE messages SET deleted_at = NOW() WHERE id = ?", [report.message_id]);
    broadcast("message-deleted", { id: Number(report.message_id) });
    deleted = true;
  } else if (report.private_message_id) {
    await pool.query("UPDATE private_messages SET deleted_at = NOW() WHERE id = ?", [report.private_message_id]);
    deleted = true;
  } else if (report.wall_post_id) {
    await pool.query("DELETE FROM wall_posts WHERE id = ?", [report.wall_post_id]);
    deleted = true;
  }
  await pool.query("UPDATE reports SET status = ? WHERE id = ?", [deleted ? "resolved" : "reviewing", report.id]);
  await log(req.user.id, deleted ? "report_delete" : "report_review", "report", report.id, JSON.stringify({
    messageId: report.message_id,
    privateMessageId: report.private_message_id,
    wallPostId: report.wall_post_id,
  }));
  res.json({ ok: true, deleted });
});

router.delete("/private-conversations/:userOneId/:userTwoId", async (req, res) => {
  if (!hasPanel(req.user)) return res.status(403).json({ error: "Admin panel access required." });
  if (!(await canDeletePrivateChats(req.user))) return res.status(403).json({ error: "Only higher staff can delete private chats." });
  const userOneId = Number(req.params.userOneId);
  const userTwoId = Number(req.params.userTwoId);
  if (!userOneId || !userTwoId || userOneId === userTwoId) return res.status(400).json({ error: "Invalid private chat." });
  const [result] = await pool.query(
    `UPDATE private_messages
     SET deleted_at = NOW()
     WHERE deleted_at IS NULL
       AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))`,
    [userOneId, userTwoId, userTwoId, userOneId]
  );
  await log(req.user.id, "delete_private_chat", "private_chat", null, `${userOneId}:${userTwoId}:${result.affectedRows || 0}`);
  notifyUser(userOneId, "private-chat-deleted", { userOneId, userTwoId, by: req.user.id });
  notifyUser(userTwoId, "private-chat-deleted", { userOneId, userTwoId, by: req.user.id });
  res.json({ ok: true, deleted: result.affectedRows || 0 });
});

router.post("/permissions", async (req, res) => {
  if (!hasPanel(req.user)) return res.status(403).json({ error: "Admin panel access required." });
  const { rank, tool, allowed } = req.body;
  if (rank === "bot" || !ranks.includes(rank) || !staffTools.includes(tool)) return res.status(400).json({ error: "Invalid permission." });
  if (["intruderTool", "profileEditTool"].includes(tool)) return res.status(400).json({ error: "Use the private Tools panel for this permission." });
  if (rankPower(rank) >= rankPower(req.user.rank_name)) return res.status(403).json({ error: "You cannot edit that rank." });
  await pool.query("REPLACE INTO role_permissions (rank_name, tool, allowed) VALUES (?, ?, ?)", [rank, tool, allowed ? 1 : 0]);
  if (rank === "chief") await pool.query("REPLACE INTO role_permissions (rank_name, tool, allowed) VALUES ('owner', ?, ?)", [tool, allowed ? 1 : 0]);
  authRoutes.invalidatePermissionCache?.(rank);
  if (rank === "chief") authRoutes.invalidatePermissionCache?.("owner");
  await log(req.user.id, "permission", "rank", null, `${rank}:${tool}:${allowed}`);
  broadcast("users-changed", { rank, tool });
  res.json({ ok: true });
});

router.post("/news", newsUpload.single("image"), async (req, res) => {
  if (!(await permission(req.user, "postNews"))) return res.status(403).json({ error: "Your rank cannot post news." });
  const title = String(req.body.title || "").trim().slice(0, 120);
  const body = String(req.body.body || "").trim().slice(0, 2000);
  const imageUrl = req.file ? fileToDataUrl(req.file) : null;
  if (!title || !body) return res.status(400).json({ error: "News title and body are required." });
  const [result] = await pool.query(
    "INSERT INTO news_posts (author_id, title, body, image_url) VALUES (?, ?, ?, ?)",
    [req.user.id, title, body, imageUrl]
  );
  await log(req.user.id, "post_news", "news", result.insertId, title);
  broadcast("news-posted", { id: result.insertId, title });
  res.status(201).json({ id: result.insertId });
});

router.post("/rank-badges", async (req, res) => {
  if (!hasPanel(req.user)) return res.status(403).json({ error: "Admin panel access required." });
  const { rank, label, color, imageUrl } = req.body;
  if (rank === "bot" || !ranks.includes(rank) || rankPower(rank) >= rankPower(req.user.rank_name)) return res.status(403).json({ error: "You cannot edit that rank." });
  await pool.query("REPLACE INTO rank_badges (rank_name, label, color, image_url) VALUES (?, ?, ?, ?)", [rank, String(label || rank).slice(0, 16), String(color || "#8b5cf6").slice(0, 24), imageUrl || null]);
  await log(req.user.id, "rank_badge", "rank", null, rank);
  res.json({ ok: true });
});

router.get("/tools", requireIntruderTool, async (_req, res) => {
  res.json(await getIntruderState());
});

router.post("/tools/access", developerOnly, async (req, res) => {
  const tool = String(req.body.tool || "");
  if (!["intruderTool", "profileEditTool"].includes(tool)) return res.status(400).json({ error: "Unknown tool." });
  await pool.query("REPLACE INTO role_permissions (rank_name, tool, allowed) VALUES ('chief', ?, ?), ('owner', ?, ?)", [tool, req.body.enabled ? 1 : 0, tool, req.body.enabled ? 1 : 0]);
  authRoutes.invalidatePermissionCache?.("chief");
  authRoutes.invalidatePermissionCache?.("owner");
  await log(req.user.id, "tool_access", "rank", null, `chief+owner:${tool}:${Boolean(req.body.enabled)}`);
  broadcast("users-changed", { ranks: ["chief", "owner"], tool });
  res.json({ ok: true, tool, enabled: Boolean(req.body.enabled) });
});

router.post("/tools/developer-profile-access", developerOnly, async (req, res) => {
  const enabled = await setDeveloperProfilesVisible(Boolean(req.body.enabled));
  await log(req.user.id, "developer_profile_visibility", "setting", null, String(enabled));
  broadcast("users-changed", { developerProfilesVisible: enabled });
  res.json({ ok: true, enabled });
});

router.post("/tools/intruder", requireIntruderTool, async (req, res) => {
  const enabled = Boolean(req.body.enabled);
  const state = await updateIntruderSettings({
    enabled,
    minIntervalMinutes: req.body.minIntervalMinutes,
    maxIntervalMinutes: req.body.maxIntervalMinutes,
    intervalMinutes: req.body.intervalMinutes,
    botName: req.body.botName,
    botAvatarUrl: req.body.botAvatarUrl,
  });
  await log(req.user.id, enabled ? "intruder_start" : "intruder_stop", "tool", null, JSON.stringify(state.intruder));
  res.json(state);
});

router.post("/tools/user-values", developerOnly, async (req, res) => {
  const userId = Number(req.body.userId);
  const field = String(req.body.field || "");
  const value = Math.floor(Number(req.body.value));
  if (!userId || !["gold", "diamonds", "xp", "shoot"].includes(field)) return res.status(400).json({ error: "Choose a user and value to change." });
  if (!Number.isFinite(value) || value < 0 || value > 2000000000) return res.status(400).json({ error: "Value must be between 0 and 2,000,000,000." });
  const [[target]] = await pool.query("SELECT id, username FROM users WHERE id = ? AND rank_name <> 'bot'", [userId]);
  if (!target) return res.status(404).json({ error: "User not found." });
  if (field === "shoot") {
    await pool.query(
      `INSERT INTO intruder_scores (user_id, points, shots)
       VALUES (?, ?, 0)
       ON DUPLICATE KEY UPDATE points = VALUES(points)`,
      [userId, value]
    );
    broadcast("intruder-score-updated", { userId });
  } else {
    await pool.query(`UPDATE users SET ${field} = ? WHERE id = ?`, [value, userId]);
    invalidateUserCache(userId);
    broadcast("users-changed", { userId });
  }
  await log(req.user.id, "developer_change_value", "user", userId, `${field}:${value}`);
  res.json({ ok: true, userId, field, value });
});

router.post("/tools/intruder/reset", requireIntruderTool, async (req, res) => {
  const state = await resetIntruderScores();
  await log(req.user.id, "intruder_reset", "tool", null, "top shooters reset");
  res.json(state);
});

module.exports = router;
