const express = require("express");
const { requireAuth } = require("../middleware/auth");
const quiz = require("../services/quizService");

const router = express.Router();
router.use(requireAuth);

function action(handler) {
  return async (req, res) => {
    try { return await handler(req, res); }
    catch (error) { return res.status(error.status || 400).json({ error: error.message || "Quiz action failed.", code: error.code || "QUIZ_ERROR" }); }
  };
}

function developerOnly(req, res, next) {
  if (req.user.rank_name !== "developer") return res.status(403).json({ error: "Only the Developer can control the Quiz Contest.", code: "DEVELOPER_ONLY" });
  next();
}

router.get("/state", action(async (_req, res) => {
  res.set("Cache-Control", "private, no-store");
  return res.json(await quiz.roomState());
}));
router.get("/leaderboard", action(async (_req, res) => {
  res.set("Cache-Control", "private, max-age=10");
  return res.json({ rows: await quiz.leaderboard(50) });
}));
router.get("/stats/:userId", action(async (req, res) => {
  res.set("Cache-Control", "private, max-age=10");
  return res.json(await quiz.stats(Number(req.params.userId)));
}));

router.get("/contest/state", action(async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  return res.json(await quiz.contestState(req.user));
}));
router.post("/contest/join", action(async (req, res) => res.json(await quiz.joinContest(req.user))));
router.get("/contest/matches/:matchId", action(async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  return res.json(await quiz.matchState(Number(req.params.matchId), req.user));
}));
router.post("/contest/matches/:matchId/answer", action(async (req, res) => res.json(await quiz.answerContestMatch(Number(req.params.matchId), req.user, req.body.optionIndex))));

router.post("/admin/room/skip", developerOnly, action(async (req, res) => {
  const state = await quiz.roomState();
  if (!state.sessionId) return res.status(409).json({ error: "No active question to skip." });
  await quiz.expireRoomQuestion(state.sessionId, "skipped");
  return res.json({ ok: true });
}));
router.post("/admin/room/pause", developerOnly, action(async (req, res) => res.json(await quiz.pauseRoomQuestion(req.user.id))));
router.post("/admin/room/resume", developerOnly, action(async (req, res) => res.json(await quiz.resumeRoomQuestion(req.user.id))));

router.post("/admin/contest/prepare", developerOnly, action(async (req, res) => res.json(await quiz.prepareContest(req.user.id))));
router.post("/admin/contest/:id/lock", developerOnly, action(async (req, res) => res.json(await quiz.lockContest(Number(req.params.id), req.user.id))));
router.post("/admin/contest/:id/start", developerOnly, action(async (req, res) => res.json(await quiz.startTournament(Number(req.params.id), req.user.id))));
router.post("/admin/contest/:id/next-round", developerOnly, action(async (req, res) => res.json(await quiz.startNextRound(Number(req.params.id), req.user.id))));
router.post("/admin/contest/:id/pause", developerOnly, action(async (req, res) => res.json(await quiz.pauseContest(Number(req.params.id), req.user.id))));
router.post("/admin/contest/:id/resume", developerOnly, action(async (req, res) => res.json(await quiz.resumeContest(Number(req.params.id), req.user.id))));
router.post("/admin/contest/:id/cancel", developerOnly, action(async (req, res) => res.json(await quiz.cancelContest(Number(req.params.id), req.user.id))));
router.post("/admin/contest/:id/reset", developerOnly, action(async (req, res) => res.json(await quiz.resetContest(Number(req.params.id), req.user.id))));
router.post("/admin/contest/:id/disqualify", developerOnly, action(async (req, res) => res.json(await quiz.disqualifyPlayer(Number(req.params.id), Number(req.body.userId), req.user.id))));
router.post("/admin/contest/:id/replace", developerOnly, action(async (req, res) => res.json(await quiz.replacePlayer(Number(req.params.id), Number(req.body.oldUserId), Number(req.body.newUserId), req.user.id))));
router.post("/admin/contest/matches/:matchId/skip", developerOnly, action(async (req, res) => res.json(await quiz.skipContestQuestion(Number(req.params.matchId), req.user.id))));
router.get("/admin/contest/:id/logs", developerOnly, action(async (req, res) => res.json({ logs: await quiz.contestLogs(Number(req.params.id)) })));

module.exports = router;
