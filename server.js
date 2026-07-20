require("dotenv").config({ quiet: true });

const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { initSchema } = require("./services/schema");
const database = require("./database");
const { attachUser } = require("./middleware/auth");
const { setSocketServer, broadcast } = require("./services/events");
const { startIntruderLoop } = require("./services/intruderService");
const { startDataRetention } = require("./services/dataRetention");

const authRoutes = require("./routes/auth");
const chatRoutes = require("./routes/chat");
const socialRoutes = require("./routes/social");
const adminRoutes = require("./routes/admin");
const gameRoutes = require("./routes/games");
const susGameRoutes = require("./routes/sus");
const susGameService = require("./services/susGameService");
const randomTalkRoutes = require("./routes/randomTalk");
const randomTalkService = require("./services/randomTalkService");
const { guestFromPayload } = require("./services/guestSessionService");
const storeRoutes = require("./routes/store");
const quizRoutes = require("./routes/quiz");
const quizService = require("./services/quizService");

const app = express();
const server = http.createServer(app);
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";
let SocketServer = null;
try {
  ({ Server: SocketServer } = require("socket.io"));
} catch (error) {
  console.warn("socket.io package is not installed; realtime will use the event-stream fallback.");
}

const configuredOrigins = new Set(
  [process.env.SITE_ORIGIN, process.env.PUBLIC_URL, "https://teenchattown.info", "https://www.teenchattown.info"]
    .filter(Boolean)
    .map((value) => String(value).replace(/\/$/, ""))
);
function socketOriginAllowed(origin) {
  if (!origin) return true;
  if (!isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
  return configuredOrigins.has(String(origin).replace(/\/$/, ""));
}

const io = SocketServer
  ? new SocketServer(server, {
      cors: { origin: (origin, callback) => callback(null, socketOriginAllowed(origin)), credentials: true },
      allowRequest: (req, callback) => callback(null, socketOriginAllowed(req.headers.origin)),
      transports: ["polling", "websocket"],
      allowUpgrades: true,
      pingInterval: 25000,
      pingTimeout: 20000,
      maxHttpBufferSize: 1e6,
      perMessageDeflate: { threshold: 1024 },
    })
  : null;

if (io) setSocketServer(io);

let compression = null;
try {
  compression = require("compression");
} catch (_error) {
  if (isProduction) console.warn("compression package is not installed; responses will not be gzip compressed.");
}

function staticOptions(maxAge) {
  return {
    etag: true,
    lastModified: true,
    maxAge,
    immutable: maxAge !== "0",
    setHeaders(res, filePath) {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-store");
      } else if (maxAge === "0") {
        res.setHeader("Cache-Control", "no-cache, must-revalidate");
      }
    },
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.use(cors());
if (compression) app.use(compression());
app.use(express.json({ limit: "6mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(attachUser);
app.get("/realtime-client.js", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=86400, immutable");
  res.sendFile(path.join(__dirname, "node_modules", "socket.io", "client-dist", "socket.io.min.js"));
});
app.use("/uploads", express.static(path.join(__dirname, "uploads"), staticOptions("30d")));
app.use("/assets", express.static(path.join(__dirname, "public", "assets"), staticOptions("30d")));
app.use(express.static(path.join(__dirname, "public"), staticOptions("1d")));

app.use("/api/auth", authRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/social", socialRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/random-talk", randomTalkRoutes);
app.use("/api/store", storeRoutes);
app.use("/api/quiz", quizRoutes);
app.use("/api/games/sus", susGameRoutes);
app.use("/api/games", gameRoutes);

if (!io) {
  app.get("/socket.io/socket.io.js", (_req, res) => {
    res.type("application/javascript").send("");
  });
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "Teens Town Chat" });
});

app.get(/.*/, (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((error, _req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  const dbError = database.isTransientDatabaseError?.(error);
  res.status(dbError ? 503 : 500).json({
    error: dbError ? "Database is reconnecting. Please try again in a moment." : "Server error.",
  });
});

async function keepSchemaReady() {
  for (;;) {
    try {
      await initSchema();
      console.log("Database schema ready.");
      startIntruderLoop();
      startDataRetention();
      await susGameService.initialize();
      await randomTalkService.initialize();
      await quizService.initialize();
      return;
    } catch (error) {
      console.error("Database schema check failed; retrying shortly.");
      console.error(error.message);
      if ((process.env.DB_PASSWORD || "").includes("YOUR_PASSWORD")) {
        console.error("Edit .env and replace DB_PASSWORD=YOUR_PASSWORD with your real MySQL password.");
      }
      await wait(5000);
    }
  }
}

process.on("unhandledRejection", (error) => {
  console.error("Unhandled async error:", error);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught error:", error);
});

if (io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error("Login required."));
      const payload = jwt.verify(String(token), process.env.JWT_SECRET);
      if (payload.kind === "guest") {
        const guest = await guestFromPayload(payload);
        if (!guest) return next(new Error("Guest session expired."));
        socket.user = guest;
        return next();
      }
      const [rows] = await database.query("SELECT * FROM users WHERE id = ?", [payload.id]);
      const user = rows[0];
      if (!user) return next(new Error("Login required."));
      if (Number(payload.v || 0) !== Number(user.token_version || 0)) return next(new Error("Login required."));
      if (user.banned_until && new Date(user.banned_until) > new Date()) return next(new Error("This account is banned."));
      if (user.kicked_until && new Date(user.kicked_until) > new Date()) return next(new Error("You were temporarily kicked. Please try again later."));
      socket.user = user;
      next();
    } catch (error) {
      console.error("Socket auth failed:", error.message);
      next(new Error(database.isTransientDatabaseError?.(error) ? "Database is reconnecting." : "Login required."));
    }
  });

  io.on("connection", async (socket) => {
    socket.join(`user:${socket.user.id}`);
    socket.emit("ready", true);
    if (!socket.user.isGuest) susGameService.reconnect(socket.user.id);
    randomTalkService.reconnect(socket.user.id);
    if (!socket.user.isGuest) {
      await database.query("UPDATE users SET last_seen = NOW(), is_online = 1 WHERE id = ?", [socket.user.id]).catch((error) => {
        console.error("Could not update last_seen for socket connect:", error.message);
      });
      broadcast("users-changed", { userId: socket.user.id, online: true });
    }
    socket.on("presence", () => {
      if (!socket.user.isGuest) database.query("UPDATE users SET last_seen = NOW(), is_online = 1 WHERE id = ?", [socket.user.id]).catch(() => {});
    });
    socket.on("random-talk-typing", (data = {}) => randomTalkService.typing(socket.user.id, data.typing));
    socket.on("random-talk-call-signal", (data = {}) => {
      try { randomTalkService.callSignal(socket.user.id, data); }
      catch (error) { socket.emit("random-talk-call-error", { code: error.code || "CALL_ERROR", message: error.message || "Call action failed." }); }
    });
    socket.on("quiz:subscribe", async (data = {}) => {
      if (socket.user.isGuest) return socket.emit("quiz:error", { code: "REGISTERED_ONLY", message: "Create an account to play Quiz Room." });
      const roomId = Number(data.roomId || 0);
      if (roomId === quizService.getQuizRoomId()) {
        socket.join(`quiz:room:${roomId}`);
        socket.emit("quiz:state", await quizService.roomState().catch(() => null));
      }
      if (data.contest === true) {
        socket.join("quiz:contest");
        socket.emit("contest:state", await quizService.contestState(socket.user).catch(() => null));
      }
    });
    socket.on("quiz:unsubscribe", (data = {}) => {
      const roomId = Number(data.roomId || 0);
      if (roomId === quizService.getQuizRoomId()) socket.leave(`quiz:room:${roomId}`);
      if (data.contest === true) socket.leave("quiz:contest");
    });
    socket.on("quiz:watch-match", async (data = {}) => {
      if (socket.user.isGuest) return;
      const matchId = Number(data.matchId || 0);
      if (!matchId) return;
      try {
        const state = await quizService.matchState(matchId, socket.user);
        socket.join(`quiz:match:${matchId}`);
        socket.emit("contest:match_state", state);
      } catch (error) {
        socket.emit("quiz:error", { code: error.code || "MATCH_NOT_FOUND", message: error.message || "Contest match not found." });
      }
    });
    socket.on("quiz:unwatch-match", (data = {}) => {
      const matchId = Number(data.matchId || 0);
      if (matchId) socket.leave(`quiz:match:${matchId}`);
    });
    socket.on("disconnect", async () => {
      if (io.sockets.adapter.rooms.get(`user:${socket.user.id}`)?.size) return;
      if (!socket.user.isGuest) susGameService.handleDisconnect(socket.user.id);
      randomTalkService.handleDisconnect(socket.user.id);
      if (!socket.user.isGuest) {
        await database.query("UPDATE users SET last_seen = NOW(), is_online = 0 WHERE id = ?", [socket.user.id]).catch((error) => {
          console.error("Could not update last_seen for socket disconnect:", error.message);
        });
        broadcast("users-changed", { userId: socket.user.id, online: false });
      }
    });
  });
}

server.listen(port, () => {
  console.log(`Teens Town Chat running on http://127.0.0.1:${port}`);
});

keepSchemaReady();
