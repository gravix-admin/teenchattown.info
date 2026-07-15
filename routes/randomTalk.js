const express = require("express");
const pool = require("../database");
const { requireAuth, canControl } = require("../middleware/auth");
const randomTalk = require("../services/randomTalkService");

const router = express.Router();
router.use(requireAuth);

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
  return res.json(randomTalk.publicState(req.user.id));
}));
router.post("/join", action(async (req, res) => res.json(await randomTalk.join(req.user, req.body))));
router.post("/search", action(async (req, res) => res.json(await randomTalk.search(req.user))));
router.post("/cancel-search", action(async (req, res) => res.json(await randomTalk.cancelSearch(req.user.id))));
router.post("/message", action(async (req, res) => res.status(201).json(await randomTalk.message(req.user, req.body))));
router.post("/skip", action(async (req, res) => res.json(await randomTalk.skip(req.user.id))));
router.post("/leave", action(async (req, res) => res.json(await randomTalk.leave(req.user.id))));
router.post("/report", action(async (req, res) => res.status(201).json(await randomTalk.report(req.user, req.body))));
router.post("/block", action(async (req, res) => res.json(await randomTalk.block(req.user.id))));

router.get("/admin/report-count", requirePanel, action(async (_req, res) => {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS count FROM random_talk_reports r
     JOIN users reporter ON reporter.id = r.reporter_user_id
     JOIN users reported ON reported.id = r.reported_user_id
     WHERE r.status = 'open' AND reporter.rank_name <> 'developer' AND reported.rank_name <> 'developer'`
  );
  res.set("Cache-Control", "private, no-store");
  return res.json({ count: Number(row?.count || 0) });
}));

router.get("/admin/reports", requirePanel, action(async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT r.id, r.session_id, r.reporter_user_id, r.reported_user_id, r.category, r.details,
            r.status, r.internal_notes, r.created_at, r.reviewed_by, r.reviewed_at,
            reporter.username AS reporter_name, reported.username AS reported_name,
            s.temp_username_a, s.temp_username_b, s.started_at, s.ended_at,
            (SELECT COUNT(*) FROM random_talk_reports prior
             WHERE prior.reported_user_id = r.reported_user_id AND prior.id <> r.id) AS previous_offence_count
     FROM random_talk_reports r
     JOIN random_talk_sessions s ON s.id = r.session_id
     JOIN users reporter ON reporter.id = r.reporter_user_id
     JOIN users reported ON reported.id = r.reported_user_id
     WHERE reporter.rank_name <> 'developer' AND reported.rank_name <> 'developer'
     ORDER BY FIELD(r.status, 'open', 'reviewing', 'resolved', 'dismissed'), r.created_at DESC
     LIMIT 40`
  );
  res.set("Cache-Control", "private, no-store");
  return res.json(rows);
}));

router.get("/admin/reports/:id/context", requirePanel, action(async (req, res) => {
  const [[row]] = await pool.query(
    `SELECT r.context_json FROM random_talk_reports r
     JOIN users reporter ON reporter.id = r.reporter_user_id
     JOIN users reported ON reported.id = r.reported_user_id
     WHERE r.id = ? AND reporter.rank_name <> 'developer' AND reported.rank_name <> 'developer'`,
    [req.params.id]
  );
  if (!row) return res.status(404).json({ error: "Random Talk report not found." });
  let messages = [];
  try { messages = JSON.parse(row.context_json || "[]"); } catch (_error) {}
  res.set("Cache-Control", "private, no-store");
  return res.json({ messages: messages.slice(-20) });
}));

router.patch("/admin/reports/:id", requirePanel, action(async (req, res) => {
  const status = String(req.body.status || "reviewing");
  if (!["open", "reviewing", "resolved", "dismissed"].includes(status)) return res.status(422).json({ error: "Choose a valid report status." });
  const notes = String(req.body.internalNotes || "").trim().slice(0, 1000);
  const [result] = await pool.query(
    `UPDATE random_talk_reports r
     JOIN users reporter ON reporter.id = r.reporter_user_id
     JOIN users reported ON reported.id = r.reported_user_id
     SET r.status = ?, r.internal_notes = ?, r.reviewed_by = ?, r.reviewed_at = UTC_TIMESTAMP()
     WHERE r.id = ? AND reporter.rank_name <> 'developer' AND reported.rank_name <> 'developer'`,
    [status, notes, req.user.id, req.params.id]
  );
  if (!result.affectedRows) return res.status(404).json({ error: "Random Talk report not found." });
  await pool.query("INSERT INTO admin_logs (actor_id, action, target_type, target_id, details) VALUES (?, 'random_talk_report', 'random_talk_report', ?, ?)", [req.user.id, req.params.id, JSON.stringify({ status })]);
  return res.json({ ok: true });
}));

router.post("/admin/restrict/:userId", requirePanel, action(async (req, res) => {
  if (Number(req.params.userId) === Number(req.user.id)) return res.status(400).json({ error: "You cannot restrict yourself." });
  const [[target]] = await pool.query("SELECT id, rank_name FROM users WHERE id = ?", [req.params.userId]);
  if (!target || target.rank_name === "developer") return res.status(404).json({ error: "User not found." });
  if (!canControl(req.user.rank_name, target.rank_name)) return res.status(403).json({ error: "You cannot restrict this rank." });
  return res.json(await randomTalk.restrictUser(req.user.id, Number(target.id), req.body.minutes, req.body.reason));
}));

module.exports = router;
