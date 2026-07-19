const jwt = require("jsonwebtoken");
const pool = require("../database");
const { rankPower, isStaffRank } = require("../services/ranks");
const { sessionIdForToken } = require("../services/welcomeSessionService");
const { guestFromPayload } = require("../services/guestSessionService");

const USER_CACHE_TTL_MS = 15000;
const userCache = new Map();

function cachedUser(id, tokenVersion) {
  const cached = userCache.get(Number(id));
  if (!cached || cached.expiresAt <= Date.now() || Number(cached.user.token_version || 0) !== Number(tokenVersion || 0)) {
    if (cached) userCache.delete(Number(id));
    return null;
  }
  return cached.user;
}

function cacheUser(user) {
  if (user?.id) userCache.set(Number(user.id), { user, expiresAt: Date.now() + USER_CACHE_TTL_MS });
  return user;
}

function invalidateUserCache(userId) {
  userCache.delete(Number(userId));
}

function tokenFromRequest(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  if (req.query.token) return String(req.query.token);
  return "";
}

async function attachUser(req, _res, next) {
  const token = tokenFromRequest(req);
  req.user = null;
  req.guest = null;
  req.authToken = token;
  req.authSessionId = token ? sessionIdForToken(token) : null;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.kind === "guest") {
      req.guest = await guestFromPayload(payload);
      return next();
    }
    req.user = cachedUser(payload.id, payload.v);
    if (!req.user) {
      const [rows] = await pool.query("SELECT * FROM users WHERE id = ?", [payload.id]);
      req.user = cacheUser(rows[0] || null);
    }
    if (req.user && Number(payload.v || 0) !== Number(req.user.token_version || 0)) req.user = null;
  } catch (error) {
    if (pool.isTransientDatabaseError?.(error)) {
      req.authDatabaseError = error;
      console.error("Auth database lookup failed:", error.message);
      return next();
    }
    req.user = null;
  }
  next();
}

function requireRandomIdentity(req, res, next) {
  if (req.authDatabaseError) return res.status(503).json({ error: "Database is reconnecting. Please try again in a moment." });
  if (!req.user && !req.guest) return res.status(401).json({ error: "Login or guest access required.", code: "RANDOM_AUTH_REQUIRED" });
  req.randomUser = req.user || req.guest;
  if (req.user) return requireAuth(req, res, next);
  next();
}

function requireAuth(req, res, next) {
  if (req.authDatabaseError) return res.status(503).json({ error: "Database is reconnecting. Please try again in a moment." });
  if (!req.user) return res.status(401).json({ error: "Login required." });
  if (req.user.banned_until && new Date(req.user.banned_until) > new Date()) {
    return res.status(403).json({ error: "This account is banned.", code: "BANNED", reason: req.user.ban_reason || "This account has been banned." });
  }
  if (req.user.kicked_until && new Date(req.user.kicked_until) > new Date()) {
    return res.status(403).json({ error: "You were temporarily kicked.", code: "KICKED", reason: req.user.kick_reason || "You were temporarily removed by staff.", until: req.user.kicked_until });
  }
  next();
}

function canControl(actorRank, targetRank) {
  if (targetRank === "bot") return false;
  if (actorRank === "developer") return targetRank !== "developer";
  if (actorRank === "owner") return rankPower(targetRank) < rankPower("owner");
  if (actorRank === "chief") return rankPower(targetRank) < rankPower("chief");
  if (actorRank === "manager") return rankPower(targetRank) < rankPower("manager");
  if (actorRank === "inspector") return rankPower(targetRank) < rankPower("inspector");
  if (actorRank === "supervisor" || actorRank === "super visor") return rankPower(targetRank) < rankPower("supervisor");
  if (actorRank === "superadmin") return rankPower(targetRank) < rankPower("superadmin");
  if (actorRank === "visor") return rankPower(targetRank) < rankPower("visor");
  if (actorRank === "admin") return rankPower(targetRank) < rankPower("admin");
  if (actorRank === "moderator") return rankPower(targetRank) < rankPower("moderator");
  return false;
}

function isStaff(user) {
  return isStaffRank(user?.rank_name);
}

module.exports = { attachUser, requireAuth, requireRandomIdentity, canControl, isStaff, rankPower, invalidateUserCache, cacheUser };
