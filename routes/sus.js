const express = require("express");
const { requireAuth } = require("../middleware/auth");
const sus = require("../services/susGameService");

const router = express.Router();
router.use(requireAuth);

function sendError(res, error) {
  res.status(error.status || 400).json({ error: error.message || "SUS action failed.", code: error.code || "SUS_ERROR" });
}

function action(handler) {
  return async (req, res) => {
    try { return await handler(req, res); }
    catch (error) { return sendError(res, error); }
  };
}

router.get("/", action(async (req, res) => res.json(await sus.listLobbies(req.user.id))));
router.get("/state", action(async (req, res) => {
  const state = sus.socketState(req.user.id);
  if (!state) return res.status(404).json({ error: "No active SUS match found." });
  res.set("Cache-Control", "private, no-store");
  return res.json(state);
}));
router.post("/lobbies", action(async (req, res) => res.status(201).json(await sus.createLobby(req.user, req.body))));
router.post("/quick", action(async (req, res) => res.json(await sus.quickPlay(req.user))));
router.post("/lobbies/join", action(async (req, res) => res.json(await sus.joinLobby(req.user, req.body))));
router.post("/lobbies/leave", action(async (req, res) => res.json(await sus.leave(req.user.id, req.body.matchId))));
router.post("/lobbies/ready", action(async (req, res) => res.json(sus.setReady(req.user.id, req.body.ready, req.body.matchId))));
router.post("/lobbies/settings", action(async (req, res) => res.json(sus.updateSettings(req.user.id, req.body.settings || req.body, req.body.matchId))));
router.post("/lobbies/start", action(async (req, res) => res.json(await sus.startMatch(req.user.id, req.body.matchId))));
router.post("/move", action(async (req, res) => res.json(sus.move(req.user.id, req.body.destination, req.body.matchId))));
router.post("/task/start", action(async (req, res) => res.json(sus.startTask(req.user.id, req.body.taskId, req.body.matchId))));
router.post("/task/action", action(async (req, res) => res.json(await sus.taskAction(req.user.id, req.body.taskId, req.body, req.body.matchId))));
router.post("/task/complete", action(async (_req, res) => res.status(409).json({ error: "Tasks complete only after a validated task action." })));
router.post("/ability", action(async (req, res) => res.json(await sus.ability(req.user.id, req.body, req.body.matchId))));
router.post("/sabotage", action(async (req, res) => res.json(sus.sabotage(req.user.id, req.body, req.body.matchId))));
router.post("/report", action(async (req, res) => res.json(sus.report(req.user.id, req.body.bodyId, req.body.matchId))));
router.post("/emergency", action(async (req, res) => res.json(sus.emergency(req.user.id, req.body.matchId))));
router.post("/chat", action(async (req, res) => res.status(201).json(sus.sendChat(req.user, req.body, req.body.matchId))));
router.post("/evidence/present", action(async (req, res) => res.json(sus.presentEvidence(req.user.id, req.body.evidenceId, req.body.matchId))));
router.post("/vote", action(async (req, res) => res.json(await sus.vote(req.user.id, req.body.targetUserId, req.body.matchId))));
router.post("/reconnect", action(async (req, res) => {
  const state = sus.reconnect(req.user.id);
  if (!state) return res.status(404).json({ error: "Your SUS reconnect window has expired." });
  return res.json(state);
}));
router.post("/leave", action(async (req, res) => res.json(await sus.leave(req.user.id, req.body.matchId))));

module.exports = router;
