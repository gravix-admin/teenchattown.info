const express = require("express");
const pool = require("../database");
const { requireAuth, requireRandomIdentity, canControl } = require("../middleware/auth");
const randomTalk = require("../services/randomTalkService");
const { banNetwork, networkHash } = require("../services/guestSessionService");

const router = express.Router();
router.use(requireRandomIdentity);

function action(handler) {
  return async (req, res) => {
    try { return await handler(req, res); }
    catch (error) { return res.status(error.status || 400).json({ error: error.message || "Random Talk action failed.", code: error.code || "RANDOM_TALK_ERROR" }); }
  };
}

function requirePanel(req, res, next) {
  if (!["admin", "chief", "owner", "developer"].includes(req.user.rank_name)) return res.status(403).json({ error: "Admin panel access required." });
  next();
}

router.get("/status", action(async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  return res.json(await randomTalk.stateFor(req.randomUser));
}));
router.post("/join", action(async (req, res) => res.json(await randomTalk.join(req.randomUser, req.body))));
router.post("/search", action(async (req, res) => res.json(await randomTalk.search(req.randomUser))));
router.post("/cancel-search", action(async (req, res) => res.json(await randomTalk.cancelSearch(req.randomUser.id))));
router.post("/message", action(async (req, res) => res.status(201).json(await randomTalk.message(req.randomUser, req.body))));
router.post("/skip", action(async (req, res) => res.json(await randomTalk.skip(req.randomUser.id))));
router.post("/leave", action(async (req, res) => res.json(await randomTalk.leave(req.randomUser.id))));
router.post("/report", action(async (req, res) => res.status(201).json(await randomTalk.report(req.randomUser, req.body))));
router.post("/block", action(async (req, res) => res.json(await randomTalk.block(req.randomUser.id))));

router.get("/call-config", action(async (_req, res) => {
  const urls = (value) => String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  const iceServers = [];
  const stunUrls = urls(process.env.WEBRTC_STUN_URLS);
  const turnUrls = urls(process.env.WEBRTC_TURN_URLS);
  if (stunUrls.length) iceServers.push({ urls: stunUrls });
  if (turnUrls.length && process.env.WEBRTC_TURN_USERNAME && process.env.WEBRTC_TURN_CREDENTIAL) {
    iceServers.push({ urls: turnUrls, username: process.env.WEBRTC_TURN_USERNAME, credential: process.env.WEBRTC_TURN_CREDENTIAL });
  }
  res.set("Cache-Control", "private, max-age=300");
  return res.json({
    enabled: turnUrls.length > 0 && Boolean(process.env.WEBRTC_TURN_USERNAME && process.env.WEBRTC_TURN_CREDENTIAL),
    iceServers,
    iceTransportPolicy: "relay",
  });
}));

router.get("/admin/report-count", requireAuth, requirePanel, action(async (_req, res) => {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS count FROM random_talk_reports r
     LEFT JOIN users reporter ON reporter.id = r.reporter_user_id
     LEFT JOIN users reported ON reported.id = r.reported_user_id
     WHERE r.status = 'open' AND COALESCE(reporter.rank_name, '') <> 'developer' AND COALESCE(reported.rank_name, '') <> 'developer'`
  );
  res.set("Cache-Control", "private, no-store");
  return res.json({ count: Number(row?.count || 0) });
}));

router.get("/admin/reports", requireAuth, requirePanel, action(async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT r.id, r.session_id, r.reporter_user_id, r.reported_user_id, r.category, r.details,
            r.status, r.internal_notes, r.created_at, r.reviewed_by, r.reviewed_at,
             COALESCE(reporter.username, CONCAT(reporter_guest.display_name, ' (Guest)')) AS reporter_name,
             COALESCE(reported.username, CONCAT(reported_guest.display_name, ' (Guest)')) AS reported_name,
             r.reported_guest_id,
             IF(active_ban.id IS NULL, 0, 1) AS network_banned,
            s.temp_username_a, s.temp_username_b, s.started_at, s.ended_at,
            (SELECT COUNT(*) FROM random_talk_reports prior
             WHERE prior.id <> r.id AND (
               (r.reported_user_id IS NOT NULL AND prior.reported_user_id = r.reported_user_id)
               OR (r.reported_guest_id IS NOT NULL AND prior.reported_guest_id = r.reported_guest_id)
             )) AS previous_offence_count
     FROM random_talk_reports r
     JOIN random_talk_sessions s ON s.id = r.session_id
     LEFT JOIN users reporter ON reporter.id = r.reporter_user_id
     LEFT JOIN users reported ON reported.id = r.reported_user_id
     LEFT JOIN guest_sessions reporter_guest ON reporter_guest.id = r.reporter_guest_id
     LEFT JOIN guest_sessions reported_guest ON reported_guest.id = r.reported_guest_id
     LEFT JOIN guest_network_bans active_ban ON active_ban.ip_hash = COALESCE(reported_guest.ip_hash, '') AND active_ban.revoked_at IS NULL AND (active_ban.expires_at IS NULL OR active_ban.expires_at > UTC_TIMESTAMP())
     WHERE COALESCE(reporter.rank_name, '') <> 'developer' AND COALESCE(reported.rank_name, '') <> 'developer'
     ORDER BY FIELD(r.status, 'open', 'reviewing', 'resolved', 'dismissed'), r.created_at DESC
     LIMIT 40`
  );
  res.set("Cache-Control", "private, no-store");
  return res.json(rows);
}));

router.get("/admin/reports/:id/context", requireAuth, requirePanel, action(async (req, res) => {
  const [[row]] = await pool.query(
    `SELECT r.context_json FROM random_talk_reports r
     LEFT JOIN users reporter ON reporter.id = r.reporter_user_id
     LEFT JOIN users reported ON reported.id = r.reported_user_id
     WHERE r.id = ? AND COALESCE(reporter.rank_name, '') <> 'developer' AND COALESCE(reported.rank_name, '') <> 'developer'`,
    [req.params.id]
  );
  if (!row) return res.status(404).json({ error: "Random Talk report not found." });
  let messages = [];
  try { messages = JSON.parse(row.context_json || "[]"); } catch (_error) {}
  res.set("Cache-Control", "private, no-store");
  return res.json({ messages: messages.slice(-20) });
}));

router.patch("/admin/reports/:id", requireAuth, requirePanel, action(async (req, res) => {
  const status = String(req.body.status || "reviewing");
  if (!["open", "reviewing", "resolved", "dismissed"].includes(status)) return res.status(422).json({ error: "Choose a valid report status." });
  const notes = String(req.body.internalNotes || "").trim().slice(0, 1000);
  const [result] = await pool.query(
    `UPDATE random_talk_reports r
     LEFT JOIN users reporter ON reporter.id = r.reporter_user_id
     LEFT JOIN users reported ON reported.id = r.reported_user_id
     SET r.status = ?, r.internal_notes = ?, r.reviewed_by = ?, r.reviewed_at = UTC_TIMESTAMP()
     WHERE r.id = ? AND COALESCE(reporter.rank_name, '') <> 'developer' AND COALESCE(reported.rank_name, '') <> 'developer'`,
    [status, notes, req.user.id, req.params.id]
  );
  if (!result.affectedRows) return res.status(404).json({ error: "Random Talk report not found." });
  await pool.query("INSERT INTO admin_logs (actor_id, action, target_type, target_id, details) VALUES (?, 'random_talk_report', 'random_talk_report', ?, ?)", [req.user.id, req.params.id, JSON.stringify({ status })]);
  return res.json({ ok: true });
}));

router.post("/admin/reports/:id/ban-network", requireAuth, requirePanel, action(async (req, res) => {
  const [[report]] = await pool.query(
    `SELECT r.id, r.reported_user_id, r.reported_guest_id, guest.ip_hash, registered.ip_address, registered.rank_name
     FROM random_talk_reports r
     LEFT JOIN guest_sessions guest ON guest.id = r.reported_guest_id
     LEFT JOIN users registered ON registered.id = r.reported_user_id
     WHERE r.id = ? LIMIT 1`,
    [req.params.id]
  );
  if (!report) return res.status(404).json({ error: "Random Talk report not found." });
  if (report.rank_name === "developer") return res.status(404).json({ error: "Random Talk report not found." });
  const ipHash = report.ip_hash || (report.ip_address ? networkHash(report.ip_address) : "");
  if (!ipHash) return res.status(422).json({ error: "No network safety signal is available for this participant." });
  const minutes = Number(req.body.minutes || 0);
  const result = await banNetwork({ ipHash, actorUserId: req.user.id, reportId: report.id, minutes, reason: req.body.reason });
  for (const guestId of result.guestIds) await randomTalk.leave(-guestId).catch(() => {});
  await pool.query(
    "INSERT INTO admin_logs (actor_id, action, target_type, target_id, details) VALUES (?, 'guest_network_ban', 'random_talk_report', ?, ?)",
    [req.user.id, report.id, JSON.stringify({ minutes: minutes > 0 ? minutes : null, reason: result.reason, affectedGuestSessions: result.guestIds.length })]
  );
  return res.json({ ok: true, affectedGuestSessions: result.guestIds.length });
}));

router.post("/admin/restrict/:userId", requireAuth, requirePanel, action(async (req, res) => {
  if (Number(req.params.userId) === Number(req.user.id)) return res.status(400).json({ error: "You cannot restrict yourself." });
  const [[target]] = await pool.query("SELECT id, rank_name FROM users WHERE id = ?", [req.params.userId]);
  if (!target || target.rank_name === "developer") return res.status(404).json({ error: "User not found." });
  if (!canControl(req.user.rank_name, target.rank_name)) return res.status(403).json({ error: "You cannot restrict this rank." });
  return res.json(await randomTalk.restrictUser(req.user.id, Number(target.id), req.body.minutes, req.body.reason));
}));

module.exports = router;
