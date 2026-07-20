function removeDuplicateDocumentShells() {
  const singletonIds = ["authScreen", "app", "drawer", "profileModal", "editProfileModal", "userActionModal", "welcomeChoiceModal", "imageLightbox"];
  singletonIds.forEach((id) => {
    document.querySelectorAll(`#${id}`).forEach((node, index) => {
      if (index > 0) node.remove();
    });
  });
  [
    'link[rel="stylesheet"][href*="/styles.css"]',
    'script[src*="/socket.io/socket.io.js"]',
    'script[src*="/script.js"]',
  ].forEach((selector) => {
    document.querySelectorAll(selector).forEach((node, index) => {
      if (index > 0) node.remove();
    });
  });
  document.querySelectorAll("body > meta, body > title, body > link[rel='stylesheet']").forEach((node) => node.remove());
  document.documentElement.dataset.documentCleaned = "true";
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", removeDuplicateDocumentShells, { once: true });
else removeDuplicateDocumentShells();

function readLocalCache(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (_error) { return null; }
}

function writeLocalCache(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_error) {}
}

const persistedNews = readLocalCache("tct_news_cache");
const persistedStore = readLocalCache("tct_store_cache");
const persistedLeaderboards = readLocalCache("tct_leaderboard_cache_v2");

const state = {
  token: localStorage.getItem("tct_token") || "",
  guestToken: localStorage.getItem("tct_guest_token") || "",
  isGuest: false,
  guest: null,
  me: null,
  rooms: [],
  users: [],
  messages: [],
  rankBadges: {},
  notifications: [],
  friendRequests: [],
  friends: [],
  blocks: [],
  currentRoomId: Number(localStorage.getItem("tct_current_room_id")) || null,
  replyToId: null,
  selectedUserId: null,
  activePmUserId: null,
  uploadFile: null,
  uploadPreviewUrl: "",
  editGalleryPreviewUrl: "",
  pmUploadFile: null,
  pmMessages: [],
  pmReplyToId: null,
  sendingMessage: false,
  sendingPm: false,
  lastSentKey: "",
  lastSentAt: 0,
  lastTapMessageId: null,
  lastTapAt: 0,
  userTab: "all",
  unreadPm: 0,
  unreadNews: localStorage.getItem("tct_news_unread") === "1",
  leaderboardTab: "xp",
  compactLayout: null,
  pmExpanded: false,
  permissions: {},
  developerProfilesVisible: false,
  usersRefreshTimer: null,
  messagesRefreshTimer: null,
  bootstrapPromise: null,
  welcomeSession: null,
  syncing: false,
  lastSyncAt: 0,
  hiddenAt: 0,
  lastAfkSyncAt: 0,
  newsCache: persistedNews?.data || null,
  newsCacheAt: Number(persistedNews?.at || 0),
  leaderboardCache: persistedLeaderboards || {},
  profileCache: new Map(),
  profileSocialCache: new Map(),
  activeProfileUserId: null,
  friendsWallCache: null,
  friendsWallCacheAt: 0,
  storeCache: persistedStore?.data || null,
  storeCacheAt: Number(persistedStore?.at || 0),
  framePickerOpen: false,
  usersCacheAt: 0,
  friendsCacheAt: 0,
  profileRequestId: 0,
  socket: null,
  eventSource: null,
  pmUnreadCacheAt: 0,
  inflightGets: new Map(),
  userActionsBound: false,
  selectedRank: "s-vip",
  activeXoGameId: null,
  xoExpiryTimer: null,
  quizRoomTicker: null,
  voiceRecorder: null,
  voiceStream: null,
  voiceChunks: [],
  voiceStopTimer: null,
  voiceTarget: null,
  preferEventSource: false,
  eventRetryMs: 1500,
  toolsCache: null,
  toolsCacheAt: 0,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const staffRanks = new Set(["moderator", "admin", "visor", "superadmin", "supervisor", "super visor", "inspector", "manager", "chief", "owner", "developer"]);
const rankOrder = ["bot", "user", "vip", "s-vip", "king", "queen", "devil", "angel", "legend", "premium", "moderator", "admin", "visor", "superadmin", "supervisor", "inspector", "manager", "chief", "owner", "developer"];
const assignableRanks = rankOrder.filter((rank) => rank !== "bot");
const systemUsernames = new Set(["intruder", "zombie"]);
const slashCommands = [
  ["/bet", "Bet gold: /bet 100 (3 minute cooldown)"],
  ["/confess", "Post anonymously: /confess your message"],
  ["/ship", "Check chemistry: /ship @user1 @user2"],
  ["/steal", "Risk gold: /steal @user (10 minute cooldown)"],
  ["/hunt", "Find 5-50 diamonds (10 minute cooldown)"],
  ["/roast", "TownBot roast: /roast \"username\""],
  ["/clear", "Staff: clear the current room"],
  ["@wb username", "Send a welcome back message"],
  ["/gif", "Search a GIF"],
  ["/sticker", "Send a sticker"],
  ["/poll Question | Yes | No", "Create a poll"],
  ["/me", "Roleplay action text"],
  ["/help", "Show command ideas"],
];
const giftCatalog = [
  ["rose", "Rose", 50],
  ["star", "Star", 100],
  ["crown", "Crown", 250],
  ["diamond", "Diamond", 500],
];
const emojiChoices = ["😀", "😂", "😊", "😍", "🥰", "😎", "😭", "😡", "👍", "👎", "👏", "🙏", "💀", "🔥", "✨", "❤️", "💙", "💎", "👑", "🎉", "🌙", "⭐", "😴", "🤝"];
const defaultRoomBackground = "arc-grid";
const roomBackgroundChoices = [
  ["arc-grid", "Arc Grid", "/assets/room-bg-arc-grid.svg"],
  ["moonlake", "Moon Lake", "/assets/room-bg-moonlake.webp"],
  ["autumn", "Autumn Trail", "/assets/room-bg-autumn.webp"],
  ["neon-city", "Neon Rain", "/assets/room-bg-neon-city.webp"],
  ["sunrise", "Sunrise Valley", "/assets/room-bg-sunrise.webp"],
];
const roomBackgroundUrls = Object.fromEntries(roomBackgroundChoices.map(([id, _label, url]) => [id, url]));
const intruderPrefix = "::intruder:";
const betPrefix = "::bet:";
const confessPrefix = "::confess:";
const shipPrefix = "::ship:";
const stealPrefix = "::steal:";
const huntPrefix = "::hunt:";
const roastPrefix = "::roast:";
const xoPrefix = "::xo:";
const quizPrefix = "[[QUIZ]]";
const funCommandPrefixes = [confessPrefix, shipPrefix, stealPrefix, huntPrefix, roastPrefix];
const profileFrameAssets = {
  cosmic: "/assets/frame-cosmic.png",
  solar: "/assets/frame-solar.png",
  prism: "/assets/frame-prism.png",
  gothic: "/assets/frame-gothic.png",
  angelic: "/assets/frame-angelic.png",
  "classic-gold": "/assets/frame-classic-gold.png",
  "royal-laurel": "/assets/frame-royal-laurel.png",
  "sun-throne": "/assets/frame-sun-throne.png",
};
const rankShopCatalog = {
  "s-vip": { name: "S-VIP", tagline: "Signature violet status", plans: {
    "7d": [50, 1000], "1m": [100, 5000], "3m": [200, 10000], lifetime: [1000, 25000],
  } },
  devil: { name: "Devil", tagline: "Crimson fire and fearless presence", plans: {
    "7d": [150, 2000], "1m": [300, 7000], "3m": [700, 15000], lifetime: [1500, 50000],
  } },
  angel: { name: "Angel", tagline: "Celestial light and serene prestige", plans: {
    "7d": [150, 2000], "1m": [300, 7000], "3m": [700, 15000], lifetime: [1500, 50000],
  } },
  legend: { name: "Legend", tagline: "The highest purchasable town status", plans: {
    "7d": [500, 5000], "1m": [1200, 18000], "3m": [2500, 45000], lifetime: [7000, 1000000],
  } },
};
const rankPlanLabels = { "7d": "7 Days", "1m": "1 Month", "3m": "3 Months", lifetime: "Lifetime" };
const rankPlanPower = { "7d": 0, "1m": 1, "3m": 2, lifetime: 3 };

function roomLocked(room) {
  return Boolean(room?.locked || room?.password_hash);
}

function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const method = String(options.method || "GET").toUpperCase();
  const getKey = `${path}|${options.cache || "default"}`;
  if (method === "GET" && state.inflightGets.has(getKey)) return state.inflightGets.get(getKey);
  const timeoutController = options.signal ? null : new AbortController();
  const timeout = timeoutController ? setTimeout(() => timeoutController.abort(), method === "GET" ? 25000 : 30000) : null;
  const request = fetch(path, { ...options, headers, signal: options.signal || timeoutController?.signal }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "Request failed");
      error.status = response.status;
      error.code = data.code;
      error.data = data;
      if (["KICKED", "BANNED"].includes(data.code)) showModerationGate(data);
      throw error;
    }
    return data;
  }).catch((error) => {
    if (error.name === "AbortError") throw new Error("Request timed out. Please try again.");
    throw error;
  }).finally(() => clearTimeout(timeout));
  if (method === "GET") {
    state.inflightGets.set(getKey, request);
    request.then(() => state.inflightGets.delete(getKey), () => state.inflightGets.delete(getKey));
  }
  return request;
}

function html(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function toast(message) {
  const text = String(message || "").replace(/\s+/g, " ").trim().slice(0, 180);
  if (!text) return;
  let area = $("#toastArea");
  if (!area) {
    area = document.createElement("div");
    area.id = "toastArea";
    area.className = "toast-area";
    document.body.append(area);
  }
  const now = Date.now();
  if (area.dataset.lastMessage === text && now - Number(area.dataset.lastAt || 0) < 2500) return;
  area.dataset.lastMessage = text;
  area.dataset.lastAt = String(now);
  while (area.children.length >= 2) area.firstElementChild.remove();
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = text;
  area.append(item);
  setTimeout(() => item.remove(), 3600);
}

function rankBadge(rank, labelOverride = "") {
  if (String(rank || "").toLowerCase() === "developer") return "";
  const badge = state.rankBadges[rank] || { label: rank, color: "#8b5cf6" };
  const image = badge.imageUrl ? `<img src="${html(badge.imageUrl)}" alt="" />` : "";
  const label = String(labelOverride || badge.label || rank || "user").slice(0, 18);
  return `<span class="rank-pill user-rank-pill rank-${html(String(rank || "user").replaceAll(" ", "-"))}" style="--rank-color:${html(badge.color)}">${image}${html(label)}</span>`;
}

function userRankBadge(user) {
  return rankBadge(user?.rank || user?.rank_name, user?.profileTitle || user?.profile_title || "");
}

function profileRankLine(user, level) {
  const badge = userRankBadge(user);
  return `${badge}${badge ? ' <span class="profile-title-dot">-</span> ' : ""}<span class="profile-level">Level ${level}</span>`;
}

function permissionLabel(tool) {
  return {
    sendPm: "Can send PMs",
    sendFiles: "Can send files",
    deleteMessage: "Delete messages",
    deleteAccount: "Delete accounts",
    changeRank: "Change ranks",
    editProfile: "Edit profiles",
    customTitle: "Custom titles",
    invisibleStatus: "Invisible status",
    createRoom: "Create rooms",
    editRoom: "Edit rooms",
    seeIp: "See IP",
    viewUserIntel: "View staff intelligence",
    postNews: "Post news",
    intruderTool: "Intruder tool",
    profileEditTool: "Profile edit tool",
  }[tool] || tool;
}

function displayName(user) {
  return user?.displayName || user?.display_name || user?.username || "User";
}

function avatar(user) {
  return user?.avatarUrl || user?.avatar_url || `/assets/avatar-${user?.gender || "other"}.svg`;
}

function profileFrame(user) {
  const frame = String(user?.frame || "");
  return profileFrameAssets[frame] ? frame : "";
}

function framedAvatar(user, imageClass = "avatar", extra = "") {
  const frame = profileFrame(user);
  const style = frame ? ` style="--avatar-frame:url('${profileFrameAssets[frame]}')"` : "";
  return `<span class="avatar-frame ${frame ? "has-frame" : ""}"${style}><img class="${html(imageClass)}" src="${html(avatar(user))}" alt="" loading="lazy" decoding="async" ${extra} /></span>`;
}

function usernameKey(user) {
  return String(user?.username || user?.displayName || user?.display_name || "").trim().toLowerCase();
}

function isSystemBot(user) {
  const rank = user?.rank || user?.rank_name;
  return rank === "bot" || systemUsernames.has(usernameKey(user));
}

function isIntruderUser(user) {
  return usernameKey(user) === "intruder";
}

function isIntruderMessage(message, user = {}) {
  return isIntruderUser(user) || String(message?.body || "").startsWith(intruderPrefix);
}

function isProtectedSystemMessage(message, user = {}) {
  const body = String(message?.body || "");
  return isSystemBot(user) || body.startsWith(intruderPrefix) || body.startsWith(betPrefix) || funCommandPrefixes.some((prefix) => body.startsWith(prefix));
}

function userById(id) {
  return state.users.find((user) => Number(user.id) === Number(id));
}

function rankAtLeast(rank, minimum) {
  const current = rankOrder.indexOf(rank === "super visor" ? "supervisor" : rank);
  const required = rankOrder.indexOf(minimum);
  return current >= required && required >= 0;
}

function canControlRank(targetRank) {
  const actorRank = state.me?.rank;
  if (!actorRank || targetRank === "bot") return false;
  if (actorRank === "developer") return targetRank !== "developer";
  return rankOrder.indexOf(targetRank === "super visor" ? "supervisor" : targetRank) >= 0
    && rankOrder.indexOf(targetRank === "super visor" ? "supervisor" : targetRank) < rankOrder.indexOf(actorRank === "super visor" ? "supervisor" : actorRank);
}

function canDeletePrivateChats() {
  return state.me?.rank === "developer" || rankAtLeast(state.me?.rank, "admin");
}

function setDrawerChrome({ title = "", account = false, user = false, pm = false } = {}) {
  const drawer = $("#drawer");
  if (!drawer) return;
  drawer.classList.toggle("account-drawer", account);
  drawer.classList.toggle("user-drawer", user);
  drawer.classList.toggle("pm-drawer", pm);
  drawer.classList.toggle("pm-expanded", pm && state.pmExpanded);
  $("#drawerTitle").textContent = title;
  const actions = $("#drawerActions");
  if (actions) actions.innerHTML = "";
}

function showDrawer() {
  const drawer = $("#drawer");
  drawer.classList.remove("hidden");
  if (state.compactLayout && drawer.classList.contains("user-drawer")) {
    $("#app")?.classList.add("right-closed");
  }
}

function formatTime(value) {
  return new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatDate(value) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat([], { year: "numeric", month: "short", day: "2-digit" }).format(new Date(value));
}

let moderationCountdownTimer = null;
function moderationClock(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  return `${hours}:${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function showModerationGate(data = {}) {
  clearInterval(moderationCountdownTimer);
  let gate = $("#moderationGate");
  if (!gate) {
    gate = document.createElement("section");
    gate.id = "moderationGate";
    gate.className = "moderation-gate";
    document.body.append(gate);
  }
  const kicked = data.code === "KICKED" || data.action === "kick";
  const until = data.until ? new Date(data.until).getTime() : 0;
  gate.innerHTML = `<div class="moderation-gate-card"><span class="moderation-gate-icon">!</span><span class="eyebrow">Staff action</span><h1>${kicked ? "Kicked" : "Account banned"}</h1><p>${html(data.reason || data.body || data.error || "Access has been restricted by staff.")}</p>${kicked ? '<strong id="moderationCountdown">--:--:--</strong><small>You can return automatically when this countdown reaches zero.</small>' : '<small>This restriction has no countdown.</small>'}<button type="button" id="moderationLogout">Sign out</button></div>`;
  gate.classList.add("active");
  $("#moderationLogout").addEventListener("click", () => { localStorage.removeItem("tct_token"); location.reload(); });
  if (kicked) {
    const tick = () => {
      const remaining = until - Date.now();
      if ($("#moderationCountdown")) $("#moderationCountdown").textContent = moderationClock(remaining);
      if (remaining <= 0) { clearInterval(moderationCountdownTimer); location.reload(); }
    };
    tick();
    moderationCountdownTimer = setInterval(tick, 1000);
  }
}

function showWarningNotice(data = {}) {
  let notice = $("#warningNotice");
  if (!notice) {
    notice = document.createElement("section");
    notice.id = "warningNotice";
    notice.className = "warning-notice";
    document.body.append(notice);
  }
  notice.innerHTML = `<div class="warning-notice-card"><span>!</span><h2>Staff warning</h2><p>${html(data.body || "A staff member sent you a warning.")}</p><button class="primary" type="button">I understand</button></div>`;
  notice.classList.add("active");
  $("button", notice).addEventListener("click", () => notice.classList.remove("active"));
}

function formatFullDateTime(value) {
  if (!value) return "Never";
  const date = new Date(value);
  const day = new Intl.DateTimeFormat([], { day: "2-digit", month: "long", year: "numeric" }).format(date);
  const time = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }).format(date);
  return `${day} | ${time}`;
}

function isOnline(user) {
  if (!user || user.bannedUntil || user.kickedUntil) return false;
  if (user.profileStatus === "Invisible") return false;
  if (state.me && Number(user.id) === Number(state.me.id)) return true;
  if (!user.lastSeen) return false;
  return Boolean(user.online && Date.now() - new Date(user.lastSeen).getTime() < 70 * 1000);
}

function visibleInUserList(user) {
  return user && !isSystemBot(user) && user.profileStatus !== "Invisible";
}

function presenceKey(status) {
  return String(status || "Online").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function levelInfo(xp = 0) {
  let level = 0;
  let needed = 10;
  let remaining = Number(xp || 0);
  while (remaining >= needed) {
    remaining -= needed;
    level += 1;
    needed += 10;
  }
  return { level, current: remaining, next: needed };
}

function setView(view) {
  if (view !== "games") {
    clearInterval(state.xoExpiryTimer);
    state.xoExpiryTimer = null;
    state.activeXoGameId = null;
    window.SusGame?.leaveView?.();
    window.QuizGame?.leaveView?.();
  }
  $$(".view").forEach((node) => node.classList.remove("active"));
  $(`#${view}View`)?.classList.add("active");
  $$(".side-nav button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  if (view === "rooms") renderRoomGrid();
  if (view === "wall") renderFriendsWall().catch((error) => toast(error.message));
  if (view === "news") {
    clearNewsUnread();
    renderNews().catch((error) => toast(error.message));
  }
  if (view === "leaderboard") renderLeaderboard().catch((error) => toast(error.message));
  if (view === "games" && !state.activeXoGameId && !window.SusGame?.isOpen?.() && !window.QuizGame?.isOpen?.()) renderGames().catch((error) => toast(error.message));
  if (view === "chatStore") renderChatStore().catch((error) => toast(error.message));
  if (view === "store") renderCreditStore().catch((error) => toast(error.message));
}

function productPrice(product) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: product.currency || "USD" }).format(Number(product.amountMinor || 0) / 100);
  } catch (_error) {
    return `${product.currency || "USD"} ${(Number(product.amountMinor || 0) / 100).toFixed(2)}`;
  }
}

async function renderCreditStore() {
  const root = $("#creditStore");
  if (!root) return;
  const data = await api("/api/store/products", { cache: "no-store" });
  const credits = data.products.filter((item) => item.type === "credits");
  const memberships = data.products.filter((item) => item.type !== "credits");
  const card = (product) => `<article class="credit-product-card" data-store-product="${html(product.code)}"><span class="credit-product-type">${html(product.type.replaceAll("_", " "))}</span><h3>${html(product.name)}</h3><p>${html(product.description)}</p><strong>${html(productPrice(product))}</strong>${product.credits ? `<small>${compactNumber(product.credits)} Random Talk credits</small>` : ""}<button class="primary" data-contact-product="${html(product.code)}" type="button">Buy · Contact Support</button></article>`;
  root.innerHTML = `<section class="credit-wallet-banner"><div><span>Random Talk balance</span><strong data-store-credit-balance>Loading…</strong></div><p>Matches cost 60 credits plus 20 credits for every started minute. A new match needs at least 80 credits.</p></section><div class="store-section-heading"><h3>Credits</h3><span>Account-bound · non-transferable</span></div><div class="credit-product-grid">${credits.map(card).join("")}</div><div class="store-section-heading"><h3>Membership and limited roles</h3><span>All ranks remain subject to moderation</span></div><div class="credit-product-grid">${memberships.map(card).join("")}</div><section class="store-contact-card"><span>Payment procedure</span><h3>Call or WhatsApp ${html(data.support.phoneDisplay)}</h3><p>Contact support to begin payment. Products are added only after payment is verified; clicking a contact button does not mark a payment as successful.</p><a href="${html(data.support.telephoneUrl)}">Call support</a></section><p class="store-terms-line">Virtual items have no cash-out value, are account-bound, and cannot be transferred. Purchases do not grant immunity from community rules or moderation.</p>`;
  api("/api/store/wallet", { cache: "no-store" }).then((wallet) => {
    const node = root.querySelector("[data-store-credit-balance]");
    if (node) node.textContent = `${compactNumber(wallet.creditBalance)} credits`;
  }).catch(() => {});
  root.querySelectorAll("[data-contact-product]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const contact = await api("/api/store/contact", { method: "POST", body: JSON.stringify({ productCode: button.dataset.contactProduct }) });
      const layer = document.createElement("div");
      layer.className = "store-contact-modal";
      layer.innerHTML = `<section><button data-close-contact type="button" aria-label="Close">×</button><span class="eyebrow">Contact support</span><h3>${html(contact.phoneDisplay)}</h3><p>${html(contact.notice)}</p><div><a href="${html(contact.whatsappUrl)}" target="_blank" rel="noopener">Open WhatsApp</a><a href="${html(contact.telephoneUrl)}">Call now</a></div></section>`;
      document.body.append(layer);
      layer.addEventListener("click", (event) => { if (event.target === layer || event.target.closest("[data-close-contact]")) layer.remove(); });
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  }));
}

function setBadges() {
  setBadge($("#friendBadge"), state.friendRequests.length);
  setBadge($("#notificationBadge"), state.notifications.filter((item) => !item.is_read).length);
  setBadge($("#pmBadge"), state.unreadPm || 0);
  setNewsDot(state.unreadNews);
}

function setBadge(node, count) {
  if (!node) return;
  node.textContent = count > 0 ? String(count) : "";
  node.classList.toggle("hidden", count <= 0);
}

function setNewsDot(active) {
  $("#newsBadge")?.classList.toggle("hidden", !active);
  $("#newsTitleDot")?.classList.toggle("hidden", !active);
}

function markNewsUnread() {
  state.unreadNews = true;
  localStorage.setItem("tct_news_unread", "1");
  setBadges();
}

function clearNewsUnread() {
  state.unreadNews = false;
  localStorage.removeItem("tct_news_unread");
  setBadges();
}

function applyTheme(theme = "dark") {
  document.body.dataset.theme = theme;
  localStorage.setItem("tct_theme", theme);
}

function cssUrl(value) {
  return `url(${JSON.stringify(value)})`;
}

function assetUrl(value) {
  if (!value || /^(data:|blob:|https?:\/\/|\/)/i.test(value)) return value;
  return `/${value.replace(/^\.?\//, "")}`;
}

function currentRoomImage() {
  const room = state.rooms.find((item) => Number(item.id) === Number(state.currentRoomId));
  return room?.image_url || room?.imageUrl || "/assets/room-main.svg";
}

function normalizeRoomBackground(value) {
  return roomBackgroundUrls[value] ? value : defaultRoomBackground;
}

function applyRoomBackground(value = state.me?.chatBackground) {
  const backgroundId = normalizeRoomBackground(value || localStorage.getItem("tct_chat_background"));
  const selected = assetUrl(roomBackgroundUrls[backgroundId] || roomBackgroundUrls[defaultRoomBackground] || currentRoomImage());
  const image = cssUrl(selected);
  const shade = backgroundId === "arc-grid"
    ? "linear-gradient(180deg, rgba(24, 26, 33, .03), rgba(24, 26, 33, .14))"
    : "linear-gradient(180deg, rgba(6, 10, 18, .38), rgba(6, 10, 18, .56))";
  localStorage.setItem("tct_chat_background", backgroundId);
  document.documentElement.style.setProperty("--room-image", image);
  document.body.style.setProperty("--room-image", image);
  const messages = $("#messages");
  if (messages) {
    messages.dataset.roomBackground = backgroundId;
    messages.style.setProperty("--room-image", image);
    messages.style.backgroundColor = "#181a21";
    messages.style.backgroundImage = `${shade}, ${image}`;
    messages.style.backgroundPosition = "center center, center center";
    messages.style.backgroundRepeat = "no-repeat, no-repeat";
    messages.style.backgroundSize = "cover, cover";
  }
}

function hasTool(tool) {
  return state.me?.rank === "developer" || Boolean(state.permissions?.[tool]);
}

function canUseIntruderTool() {
  return state.me?.rank === "developer" || (["chief", "owner"].includes(state.me?.rank) && hasTool("intruderTool"));
}

function canUseProfileEditTool() {
  return state.me?.rank === "developer" || (["chief", "owner"].includes(state.me?.rank) && hasTool("profileEditTool"));
}

function canPostNews() {
  return hasTool("postNews");
}

function canManageNews() {
  return ["chief", "owner", "developer"].includes(state.me?.rank);
}

function resetNewsCache() {
  state.newsCache = null;
  state.newsCacheAt = 0;
  localStorage.removeItem("tct_news_cache");
}

function syncNewsComposerAccess() {
  const allowed = canPostNews();
  $("#newsComposeButton")?.classList.toggle("hidden", !allowed);
  if (!allowed) {
    const composer = $("#newsComposerArea");
    if (composer) {
      composer.classList.add("hidden");
      composer.innerHTML = "";
    }
  }
}

function syncResponsiveLayout() {
  const app = $("#app");
  if (!app) return;
  const compact = window.matchMedia("(max-width: 1180px)").matches;
  if (state.compactLayout === compact) return;
  const firstSync = state.compactLayout === null;
  state.compactLayout = compact;
  if (compact || firstSync) {
    app.classList.add("right-closed");
    $("#rightToggleButton")?.setAttribute("aria-expanded", "false");
    app.classList.remove("nav-open");
    return;
  }
  app.classList.remove("nav-open");
}

async function refreshReportBadge() {
  if (!state.me || !staffRanks.has(state.me.rank)) return setBadge($("#reportBadge"), 0);
  const [regular, random] = await Promise.all([
    api("/api/admin/reports").catch(() => []),
    ["admin", "chief", "owner", "developer"].includes(state.me.rank) ? api("/api/random-talk/admin/report-count").catch(() => ({ count: 0 })) : Promise.resolve({ count: 0 }),
  ]);
  setBadge($("#reportBadge"), regular.filter((report) => report.status === "open").length + Number(random.count || 0));
}

function openEmojiPicker(inputSelector, anchor) {
  $(".emoji-picker")?.remove();
  const picker = document.createElement("div");
  picker.className = "emoji-picker";
  picker.innerHTML = emojiChoices.map((emoji) => `<button type="button" data-emoji="${emoji}">${emoji}</button>`).join("");
  document.body.append(picker);
  const rect = anchor.getBoundingClientRect();
  picker.style.left = `${Math.max(12, rect.left - 6)}px`;
  picker.style.top = `${Math.max(12, rect.top - 238)}px`;
  picker.addEventListener("click", (event) => {
    const button = event.target.closest("[data-emoji]");
    if (!button) return;
    const input = $(inputSelector);
    input.value += button.dataset.emoji;
    input.focus();
    picker.remove();
  });
}

function closeComposerTools() {
  const menu = $("#composerToolsMenu");
  const trigger = $("#composerToolsButton");
  menu?.classList.add("hidden");
  trigger?.setAttribute("aria-expanded", "false");
}

function toggleComposerTools() {
  const menu = $("#composerToolsMenu");
  const trigger = $("#composerToolsButton");
  if (!menu || !trigger) return;
  const opening = menu.classList.contains("hidden");
  menu.classList.toggle("hidden", !opening);
  trigger.setAttribute("aria-expanded", String(opening));
}

function clearMessageAttachment() {
  if (state.uploadPreviewUrl) URL.revokeObjectURL(state.uploadPreviewUrl);
  state.uploadPreviewUrl = "";
  state.uploadFile = null;
  const input = $("#messageAttachment");
  const preview = $("#uploadPreview");
  if (input) input.value = "";
  if (preview) {
    preview.classList.add("hidden");
    preview.innerHTML = "";
  }
}

function selectMessageAttachment(file) {
  if (!file) return clearMessageAttachment();
  if (!String(file.type || "").startsWith("image/")) {
    clearMessageAttachment();
    toast("Choose an image file.");
    return;
  }
  if (file.size > 4 * 1024 * 1024) {
    clearMessageAttachment();
    toast("Images must be 4 MB or smaller.");
    return;
  }
  if (state.uploadPreviewUrl) URL.revokeObjectURL(state.uploadPreviewUrl);
  state.uploadFile = file;
  state.uploadPreviewUrl = URL.createObjectURL(file);
  const preview = $("#uploadPreview");
  const size = file.size >= 1024 * 1024 ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`;
  preview.innerHTML = `<img src="${html(state.uploadPreviewUrl)}" alt="Selected image preview" /><span title="${html(file.name)}">${html(file.name)} · ${size}</span><button id="removeMessageAttachment" type="button" aria-label="Remove selected image">×</button>`;
  preview.classList.remove("hidden");
  closeComposerTools();
}

function voiceMimeType() {
  if (!window.MediaRecorder) return "";
  return ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"].find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
}

function setVoiceRecordingUi(active, target) {
  const pmButton = $("#pmVoiceButton");
  if (pmButton) {
    pmButton.classList.toggle("recording", active && target?.type === "pm");
    pmButton.title = active ? "Stop and send voice message" : "Voice message";
  }
  const preview = $("#uploadPreview");
  if (preview && target?.type === "room") {
    if (active) {
      preview.innerHTML = '<span class="voice-recording-dot"></span><strong>Recording voice message...</strong><button id="stopVoiceRecording" type="button">Stop & send</button>';
      preview.classList.remove("hidden");
    } else if (!state.uploadFile) {
      preview.innerHTML = "";
      preview.classList.add("hidden");
    }
  }
}

async function toggleVoiceRecording(target) {
  if (state.voiceRecorder?.state === "recording") {
    state.voiceRecorder.stop();
    return;
  }
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    toast("Voice messages need microphone access over HTTPS.");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const mimeType = voiceMimeType();
    const options = { audioBitsPerSecond: 24000 };
    if (mimeType) options.mimeType = mimeType;
    const recorder = new MediaRecorder(stream, options);
    state.voiceRecorder = recorder;
    state.voiceStream = stream;
    state.voiceTarget = target;
    state.voiceChunks = [];
    recorder.addEventListener("dataavailable", (event) => { if (event.data?.size) state.voiceChunks.push(event.data); });
    recorder.addEventListener("stop", async () => {
      clearTimeout(state.voiceStopTimer);
      const capturedTarget = state.voiceTarget;
      const chunks = state.voiceChunks.slice();
      const finalType = recorder.mimeType || mimeType || "audio/webm";
      state.voiceStream?.getTracks().forEach((track) => track.stop());
      state.voiceRecorder = null;
      state.voiceStream = null;
      state.voiceTarget = null;
      state.voiceChunks = [];
      setVoiceRecordingUi(false, capturedTarget);
      const blob = new Blob(chunks, { type: finalType });
      if (!blob.size) return toast("No voice audio was captured.");
      if (blob.size > 4 * 1024 * 1024) return toast("Voice message is too large. Keep it under 60 seconds.");
      const extension = finalType.includes("ogg") ? "ogg" : finalType.includes("mp4") ? "m4a" : "webm";
      const form = new FormData();
      form.append("body", "");
      form.append("attachment", new File([blob], "voice-" + Date.now() + "." + extension, { type: finalType }));
      try {
        if (capturedTarget?.type === "pm") {
          form.append("receiverId", capturedTarget.userId);
          if (state.pmReplyToId) form.append("replyToId", state.pmReplyToId);
          const sent = await api("/api/chat/private-messages", { method: "POST", body: form });
          appendPmMessage(sent);
          clearPmReply();
        } else {
          const roomId = capturedTarget?.roomId || state.currentRoomId;
          const sent = await api("/api/chat/rooms/" + roomId + "/messages", { method: "POST", body: form });
          if (Number(roomId) === Number(state.currentRoomId) && !state.messages.some((message) => Number(message.id) === Number(sent.id))) {
            state.messages.push(sent);
            renderMessages();
          }
        }
        toast("Voice message sent.");
      } catch (error) {
        toast(error.message);
      }
    }, { once: true });
    recorder.start(1000);
    state.voiceStopTimer = setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, 60000);
    setVoiceRecordingUi(true, target);
    toast("Recording... tap Stop & send when you are done.");
  } catch (error) {
    state.voiceStream?.getTracks().forEach((track) => track.stop());
    state.voiceStream = null;
    state.voiceRecorder = null;
    toast(error?.name === "NotAllowedError" ? "Microphone permission was not granted." : "Could not start voice recording.");
  }
}

function openImageZoom(src) {
  const lightbox = $("#imageLightbox");
  const image = $("#imageLightboxImage");
  if (!lightbox || !image || !src) return;
  image.src = src;
  if (!lightbox.open) lightbox.showModal();
}

function closeImageZoom() {
  const lightbox = $("#imageLightbox");
  const image = $("#imageLightboxImage");
  if (!lightbox || !image) return;
  if (lightbox.open) lightbox.close();
  image.removeAttribute("src");
}

function stopProfileMusic() {
  const audio = $("#activeProfileMusic");
  if (!audio) return;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

function setSessionView(mode) {
  const body = document.body;
  body.classList.toggle("session-authenticated", mode === "authenticated");
  body.classList.toggle("session-anonymous", mode === "anonymous");
  body.classList.toggle("session-pending", mode === "pending");
  $("#authScreen")?.classList.toggle("hidden", mode !== "anonymous");
  $("#app")?.classList.toggle("hidden", mode !== "authenticated");
}

async function bootstrap() {
  if (state.bootstrapPromise) return state.bootstrapPromise;
  state.bootstrapPromise = (async () => {
    const previousRoomId = Number(state.currentRoomId || localStorage.getItem("tct_current_room_id")) || null;
    const data = await api("/api/auth/me");
    state.me = data.me;
    state.welcomeSession = data.session || null;
    if (Number(persistedStore?.userId || 0) !== Number(state.me?.id || 0)) {
      state.storeCache = null;
      state.storeCacheAt = 0;
    }
    if (state.me) {
      state.me.chatBackground = normalizeRoomBackground(state.me.chatBackground || localStorage.getItem("tct_chat_background"));
      localStorage.setItem("tct_chat_background", state.me.chatBackground);
    }
    state.rooms = data.rooms || [];
    state.users = data.users || [];
    state.usersCacheAt = Date.now();
    state.notifications = data.notifications || [];
    state.friendRequests = data.friendRequests || [];
    state.rankBadges = data.rankBadges || {};
    state.permissions = data.permissions || {};
    state.developerProfilesVisible = Boolean(data.features?.developerProfilesVisible);
    state.unreadPm = Number(data.unreadPm || 0);
    state.pmUnreadCacheAt = Date.now();
    state.currentRoomId = state.rooms.some((room) => Number(room.id) === Number(previousRoomId))
      ? previousRoomId
      : state.rooms[0]?.id;
    if (state.currentRoomId) localStorage.setItem("tct_current_room_id", String(state.currentRoomId));
    document.documentElement.classList.remove("returning-user");
    setSessionView("authenticated");
    syncResponsiveLayout();
    $("#topName").textContent = displayName(state.me);
    $("#topAvatar").src = avatar(state.me);
    if ($("#wallComposerAvatar")) $("#wallComposerAvatar").src = avatar(state.me);
    $("#reportFlagIcon").classList.toggle("hidden", !staffRanks.has(state.me.rank));
    setBadges();
    syncNewsComposerAccess();
    refreshReportBadge().catch(() => {});
    renderRooms();
    renderUsers();
    if ($("#profilesView").classList.contains("active")) renderProfiles();
    renderVip();
    connectEvents();
    loadFriends().catch(() => {});
    loadMessages().catch((error) => toast(error.message));
    state.lastSyncAt = Date.now();
    queueMicrotask(() => maybeShowWelcomeChoice(state.welcomeSession));
  })();
  try {
    return await state.bootstrapPromise;
  } finally {
    state.bootstrapPromise = null;
  }
}

function warmFastViews() {
  if (!state.token || document.hidden) return;
  if (!state.storeCache || Date.now() - state.storeCacheAt > 30000) {
    api("/api/social/store").then((data) => {
      state.storeCache = data;
      state.storeCacheAt = Date.now();
      writeLocalCache("tct_store_cache", { data, at: state.storeCacheAt, userId: state.me?.id });
    }).catch(() => {});
  }
  if (!state.newsCache || Date.now() - state.newsCacheAt > 30000) {
    api("/api/social/news").then((posts) => {
      state.newsCache = posts;
      state.newsCacheAt = Date.now();
      writeLocalCache("tct_news_cache", { data: posts, at: state.newsCacheAt });
    }).catch(() => {});
  }
}

function renderRooms() {
  const room = state.rooms.find((item) => Number(item.id) === Number(state.currentRoomId));
  document.body.classList.toggle("quiz-room-active", String(room?.name || "").toLowerCase() === "quiz room");
  if (String(room?.name || "").toLowerCase() === "quiz room") loadQuizGame().catch(() => {});
  if (room) {
    if ($("#roomTitle")) $("#roomTitle").textContent = room.name;
    if ($("#roomDescription")) $("#roomDescription").textContent = "";
    applyRoomBackground();
  }
  renderRoomGrid();
}

function guestDeviceId() {
  let value = localStorage.getItem("tct_guest_device_id") || "";
  if (!/^[a-z0-9-]{16,80}$/i.test(value)) {
    value = crypto.randomUUID();
    localStorage.setItem("tct_guest_device_id", value);
  }
  return value;
}

function selectAuthTab(tab) {
  $$('[data-auth-tab]').forEach((node) => node.classList.toggle("active", node.dataset.authTab === tab));
  $$(".auth-form").forEach((form) => form.classList.remove("active"));
  $(`#${tab}Form`)?.classList.add("active");
  $("#authMessage").textContent = "";
}

async function startGuestAccess(payload) {
  const data = await api("/api/auth/guest", { method: "POST", body: JSON.stringify({ ...payload, deviceId: guestDeviceId() }) });
  state.guestToken = data.token;
  state.token = data.token;
  state.guest = data.guest;
  state.isGuest = true;
  localStorage.setItem("tct_guest_token", data.token);
  state.preferEventSource = false;
  connectEvents();
  const feature = await loadRandomTalk();
  await feature.open();
}

async function leaveGuestForAuth(tab = "register") {
  await window.RandomTalk?.close?.();
  await api("/api/auth/guest/logout", { method: "POST", body: "{}" }).catch(() => {});
  state.socket?.disconnect();
  state.socket = null;
  state.eventSource?.close();
  state.eventSource = null;
  state.token = "";
  state.guestToken = "";
  state.guest = null;
  state.isGuest = false;
  localStorage.removeItem("tct_guest_token");
  setSessionView("anonymous");
  selectAuthTab(tab);
  requestAnimationFrame(() => $(`#${tab}Form input`)?.focus());
}

async function resumeGuestAccess() {
  state.token = state.guestToken;
  state.isGuest = true;
  state.preferEventSource = false;
  try {
    await api("/api/random-talk/status", { cache: "no-store" });
    connectEvents();
    const feature = await loadRandomTalk();
    await feature.open();
  } catch (_error) {
    state.token = "";
    state.guestToken = "";
    state.isGuest = false;
    localStorage.removeItem("tct_guest_token");
    setSessionView("anonymous");
    selectAuthTab("guest");
    $("#authMessage").textContent = "Your previous guest session expired. Start a new guest session or create an account.";
  }
}

let randomTalkLoadPromise = null;
function loadRandomTalk() {
  if (window.RandomTalk) return Promise.resolve(window.RandomTalk);
  if (randomTalkLoadPromise) return randomTalkLoadPromise;
  const cssReady = new Promise((resolve) => {
    let link = document.querySelector('link[data-random-talk-style]');
    if (link) return resolve();
    link = document.createElement("link");
    link.rel = "stylesheet"; link.href = "/random-talk.css?v=20260719-random-v2"; link.dataset.randomTalkStyle = "1";
    link.addEventListener("load", resolve, { once: true }); link.addEventListener("error", resolve, { once: true });
    document.head.appendChild(link);
  });
  randomTalkLoadPromise = Promise.all([cssReady, import("/random-talk.js?v=20260719-random-v2")])
    .then(() => window.RandomTalk)
    .catch((error) => { randomTalkLoadPromise = null; throw error; });
  return randomTalkLoadPromise;
}

let quizGameLoadPromise = null;
function loadQuizGame() {
  if (window.QuizGame) return Promise.resolve(window.QuizGame);
  if (quizGameLoadPromise) return quizGameLoadPromise;
  const cssReady = new Promise((resolve) => {
    let link = document.querySelector('link[data-quiz-style]');
    if (link) return resolve();
    link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/quiz.css?v=20260720-quiz-v2";
    link.dataset.quizStyle = "1";
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener("error", resolve, { once: true });
    document.head.appendChild(link);
  });
  quizGameLoadPromise = Promise.all([cssReady, import("/quiz.js?v=20260720-quiz-v2")])
    .then(() => window.QuizGame)
    .catch((error) => { quizGameLoadPromise = null; throw error; });
  return quizGameLoadPromise;
}

let welcomeChannel = null;
let welcomeRestoreFocus = null;

function welcomeSeenKey(session = state.welcomeSession) {
  return session?.id && state.me?.id ? `tctWelcomeSeen:${state.me.id}:${session.id}` : "";
}

function markWelcomeLocally(session = state.welcomeSession) {
  const key = welcomeSeenKey(session);
  if (!key) return;
  try { sessionStorage.setItem(key, "1"); } catch (_error) {}
}

function welcomeWasSeenLocally(session = state.welcomeSession) {
  const key = welcomeSeenKey(session);
  if (!key) return false;
  try { return sessionStorage.getItem(key) === "1"; } catch (_error) { return false; }
}

function closeWelcomeChoice() {
  const dialog = $("#welcomeChoiceModal");
  if (dialog?.open) dialog.close();
  document.body.classList.remove("welcome-choice-open");
}

function announceWelcomeCompletion(session, action) {
  const detail = { type: "welcome-choice-completed", sessionId: session.id, action };
  welcomeChannel?.postMessage(detail);
  try { localStorage.setItem("tct_welcome_choice_event", JSON.stringify({ ...detail, at: Date.now() })); } catch (_error) {}
}

function finishWelcomeChoice(action, { announce = true } = {}) {
  const session = state.welcomeSession;
  if (!session?.id) return closeWelcomeChoice();
  session.shouldShowWelcomeChoice = false;
  markWelcomeLocally(session);
  if (announce) announceWelcomeCompletion(session, action);
  api("/api/auth/session/welcome-seen", { method: "POST", body: JSON.stringify({ action }) }).catch(() => {});
  closeWelcomeChoice();
}

function suppressWelcomeFromAnotherTab(detail) {
  if (detail?.type !== "welcome-choice-completed" || detail.sessionId !== state.welcomeSession?.id) return;
  state.welcomeSession.shouldShowWelcomeChoice = false;
  markWelcomeLocally();
  closeWelcomeChoice();
}

function setupWelcomeCrossTab() {
  if ("BroadcastChannel" in window) {
    welcomeChannel = new BroadcastChannel("teentown-session-events");
    welcomeChannel.addEventListener("message", (event) => suppressWelcomeFromAnotherTab(event.data));
  }
  window.addEventListener("storage", (event) => {
    if (event.key !== "tct_welcome_choice_event" || !event.newValue) return;
    try { suppressWelcomeFromAnotherTab(JSON.parse(event.newValue)); } catch (_error) {}
  });
}

async function openMainRoomFromWelcome() {
  const mainRoom = state.rooms.find((room) => String(room.name || "").trim().toLowerCase() === "main room");
  if (!mainRoom) throw new Error("Main Room is not available right now.");
  if (Number(state.currentRoomId) !== Number(mainRoom.id)) await switchRoom(mainRoom.id);
  else {
    setView("chat");
    renderRooms();
  }
  requestAnimationFrame(() => $("#messageInput")?.focus({ preventScroll: true }));
}

function maybeShowWelcomeChoice(session) {
  if (!session?.shouldShowWelcomeChoice || !session.id || !state.me) return;
  if (welcomeWasSeenLocally(session)) {
    session.shouldShowWelcomeChoice = false;
    return;
  }
  const dialog = $("#welcomeChoiceModal");
  if (!dialog || dialog.open) return;
  welcomeRestoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : $("#messageInput");
  $("#welcomeChoiceTitle").textContent = session.welcomeType === "new"
    ? `Hey, ${state.me.username} \u{1F44B} Welcome to TeenChatTown!`
    : `Hey, ${state.me.username} \u{1F44B} Welcome back!`;
  document.body.classList.add("welcome-choice-open");
  dialog.showModal();
  requestAnimationFrame(() => $("[data-welcome-choice='random-talk']")?.focus({ preventScroll: true }));
}

function renderRoomGrid() {
  const grid = $("#roomGrid");
  if (!grid) return;
  const canCreate = hasTool("createRoom");
  const canManage = ["chief", "owner", "developer"].includes(state.me?.rank);
  const toolbar = $(".room-gallery-toolbar");
  if (toolbar && !$("#roomCreateButton")) toolbar.insertAdjacentHTML("beforeend", '<button id="roomCreateButton" class="room-add-button" type="button">+ Add room</button>');
  $("#roomCreateButton")?.classList.toggle("hidden", !canCreate);
  if ($("#roomCreateButton") && !$("#roomCreateButton").dataset.bound) {
    $("#roomCreateButton").dataset.bound = "1";
    $("#roomCreateButton").addEventListener("click", openRoomCreator);
  }
  const query = String($("#roomSearch")?.value || "").trim().toLowerCase();
  const visibleRooms = state.rooms.filter((room) => !query || `${room.name || ""} ${room.description || ""}`.toLowerCase().includes(query));
  const randomTalkVisible = !query || "random talk stranger private anonymous".includes(query);
  const total = visibleRooms.length + (randomTalkVisible ? 1 : 0);
  $("#roomGalleryCount") && ($("#roomGalleryCount").textContent = `${total} ${total === 1 ? "room" : "rooms"}`);
  const randomTalkCard = randomTalkVisible ? `<article class="room-card random-talk-room-card"><div class="random-talk-room-art" aria-hidden="true"><i></i><i></i><b>?</b></div><span>Private matching</span><strong>Random Talk</strong><small>Meet one stranger at a time with a temporary name and safety controls.</small><div class="room-card-footer"><button data-random-talk type="button">Open Random Talk</button></div></article>` : "";
  grid.innerHTML = randomTalkCard + visibleRooms.map((room) => `
    <article class="room-card ${Number(room.id) === Number(state.currentRoomId) ? "active" : ""} ${Number(room.staff_only) === 1 ? "staff-room" : ""}">
      <img src="${html(room.image_url || room.imageUrl || "/assets/room-main.svg")}" alt="" loading="lazy" decoding="async" />
      <span>${Number(room.is_pinned) === 1 ? "Pinned" : Number(room.staff_only) === 1 ? "Staff only" : roomLocked(room) ? "Locked" : "Open now"}</span>
      <strong>${html(room.name)}</strong>
      <small>${html(room.description)}</small>
      <div class="room-card-footer"><button data-room-card="${room.id}" type="button">${Number(room.id) === Number(state.currentRoomId) ? "You are here" : "Enter room"}</button>${canManage ? `<button class="room-manage-button" data-room-menu="${room.id}" type="button" aria-label="Manage ${html(room.name)}">...</button>` : ""}</div>
    </article>
  `).join("") || '<div class="empty-state room-empty"><strong>No matching rooms</strong><p class="muted">Try a different search.</p></div>';
  $("[data-random-talk]", grid)?.addEventListener("click", async (event) => { event.currentTarget.disabled = true; try { const feature = await loadRandomTalk(); await feature.open(); } catch (error) { toast("Random Talk could not open. Your normal chat is still available."); event.currentTarget.disabled = false; } });
  $$("[data-room-card]").forEach((button) => button.addEventListener("click", async () => switchRoom(button.dataset.roomCard)));
  $$("[data-room-menu]").forEach((button) => button.addEventListener("click", () => openRoomManager(button.dataset.roomMenu)));
}

function openRoomCreator() {
  $("#userActionBody").innerHTML = `<form id="roomCreateForm" class="staff-card room-create-form"><div><span class="eyebrow">New community space</span><h2>Add room</h2><p class="muted">The room appears in the gallery as soon as it is created.</p></div><input name="name" maxlength="80" placeholder="Room name" required /><textarea name="description" maxlength="255" placeholder="What is this room for?" required></textarea><input name="password" type="password" placeholder="Optional password" /><label class="file-pill">Choose room image<input name="image" type="file" accept="image/*" /></label><label class="toggle-row">Staff-only room<input name="staffOnly" type="checkbox" value="true" /></label><div class="modal-action-row"><button data-room-create-cancel type="button">Cancel</button><button class="primary" type="submit">Create room</button></div></form>`;
  $("#roomCreateForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!event.currentTarget.staffOnly.checked) form.delete("staffOnly");
    await api("/api/chat/rooms", { method: "POST", body: form });
    $("#userActionModal").close();
    toast("Room created.");
  });
  $("[data-room-create-cancel]")?.addEventListener("click", () => $("#userActionModal").close());
  if (!$("#userActionModal").open) $("#userActionModal").showModal();
}

function openRoomManager(roomId) {
  const room = state.rooms.find((item) => Number(item.id) === Number(roomId));
  if (!room) return;
  const mainRoom = String(room.name).toLowerCase() === "main room";
  $("#userActionBody").innerHTML = `<div class="staff-card"><span class="eyebrow">Room controls</span><h2>${html(room.name)}</h2><p class="muted">Pin it near the top of the gallery or permanently remove it.</p><div class="modal-action-row"><button data-room-pin type="button">${Number(room.is_pinned) ? "Unpin room" : "Pin room"}</button>${mainRoom ? "" : '<button class="danger-action" data-room-delete type="button">Delete room</button>'}</div></div>`;
  $("[data-room-pin]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const nextPinned = !Number(room.is_pinned);
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = nextPinned ? "Pinning..." : "Unpinning...";
    try {
      const result = await api(`/api/chat/rooms/${room.id}/pin`, { method: "PATCH", body: JSON.stringify({ pinned: nextPinned }) });
      room.is_pinned = result.pinned ? 1 : 0;
      state.rooms.sort((a, b) => {
        const aMain = String(a.name).toLowerCase() === "main room" ? 1 : 0;
        const bMain = String(b.name).toLowerCase() === "main room" ? 1 : 0;
        return bMain - aMain || Number(b.is_pinned) - Number(a.is_pinned) || String(a.name).localeCompare(String(b.name));
      });
      renderRooms();
      $("#userActionModal").close();
      toast(result.pinned ? "Room pinned." : "Room unpinned.");
    } catch (error) {
      button.disabled = false;
      button.textContent = originalText;
      toast(error.message);
    }
  });
  $("[data-room-delete]")?.addEventListener("click", async (event) => {
    if (!confirm(`Delete ${room.name}? Its messages and X-O matches will be removed permanently.`)) return;
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Deleting...";
    try {
      await api(`/api/chat/rooms/${room.id}`, { method: "DELETE" });
      state.rooms = state.rooms.filter((item) => Number(item.id) !== Number(room.id));
      if (Number(state.currentRoomId) === Number(room.id)) {
        state.currentRoomId = state.rooms.find((item) => String(item.name).toLowerCase() === "main room")?.id || state.rooms[0]?.id || null;
        localStorage.setItem("tct_current_room_id", String(state.currentRoomId || ""));
        state.messages = [];
        if (state.currentRoomId) loadMessages().catch((error) => toast(error.message));
      }
      renderRooms();
      $("#userActionModal").close();
      toast("Room deleted.");
    } catch (error) {
      button.disabled = false;
      button.textContent = "Delete room";
      toast(error.message);
    }
  });
  if (!$("#userActionModal").open) $("#userActionModal").showModal();
}

function openRoomSwitcher() {
  setDrawerChrome({ title: "Change room" });
  $("#drawerBody").innerHTML = `
    <div class="room-switch-list">
      ${state.rooms.map((room) => `
        <button class="room-choice ${Number(room.id) === Number(state.currentRoomId) ? "active" : ""}" data-switch-room="${room.id}" type="button">
          <img src="${html(room.image_url || room.imageUrl || "/assets/room-main.svg")}" alt="" loading="lazy" decoding="async" />
          <span><strong>${html(room.name)}</strong><small>${html(room.description)}</small></span>
          <em>${Number(room.staff_only) === 1 ? "Staff" : roomLocked(room) ? "Locked" : "Open"}</em>
        </button>
      `).join("")}
    </div>
  `;
  showDrawer();
  $$("[data-switch-room]").forEach((button) => button.addEventListener("click", async () => {
    await switchRoom(button.dataset.switchRoom);
  }));
}

async function switchRoom(roomId) {
  const room = state.rooms.find((item) => Number(item.id) === Number(roomId));
  if (!room) return;
  if (roomLocked(room) && !staffRanks.has(state.me.rank) && Number(room.created_by) !== Number(state.me.id)) {
    return openRoomPasswordModal(room);
  }
  const previousRoom = state.rooms.find((item) => Number(item.id) === Number(state.currentRoomId));
  if (String(previousRoom?.name || "").toLowerCase() === "quiz room" && String(room.name || "").toLowerCase() !== "quiz room") {
    state.socket?.connected && state.socket.emit("quiz:unsubscribe", { roomId: previousRoom.id });
  }
  state.currentRoomId = roomId;
  localStorage.setItem("tct_current_room_id", String(roomId));
  if (String(room.name || "").toLowerCase() === "quiz room" && state.socket?.connected) {
    state.socket.emit("quiz:subscribe", { roomId: room.id });
  }
  $("#drawer").classList.add("hidden");
  setView("chat");
  renderRooms();
  await loadMessages();
}

function openRoomPasswordModal(room) {
  $("#userActionBody").innerHTML = `
    <form class="room-password-card" id="roomPasswordForm">
      <div class="menu-profile">
        <img class="avatar" src="${html(room.image_url || room.imageUrl || "/assets/room-main.svg")}" alt="" />
        <div><h2>${html(room.name)}</h2><p class="muted">This room is password protected.</p></div>
      </div>
      <input name="password" type="password" placeholder="Room password" required />
      <button class="primary" type="submit">Enter room</button>
    </form>
  `;
  $("#roomPasswordForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await api(`/api/chat/rooms/${room.id}/join`, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    $("#userActionModal").close();
    state.currentRoomId = room.id;
    localStorage.setItem("tct_current_room_id", String(room.id));
    if (String(room.name || "").toLowerCase() === "quiz room" && state.socket?.connected) {
      state.socket.emit("quiz:subscribe", { roomId: room.id });
    }
    $("#drawer").classList.add("hidden");
    setView("chat");
    renderRooms();
    await loadMessages();
  });
  if (!$("#userActionModal").open) $("#userActionModal").showModal();
}

async function loadMessages({ fresh = false } = {}) {
  if (!state.currentRoomId) return;
  try {
    state.messages = await api(`/api/chat/rooms/${state.currentRoomId}/messages?limit=30${fresh ? "&fresh=1" : ""}`);
    renderMessages();
  } catch (error) {
    const room = state.rooms.find((item) => Number(item.id) === Number(state.currentRoomId));
    if (error.message.includes("password") && room) return openRoomPasswordModal(room);
    toast(error.message);
  }
}

function scheduleMessagesRefresh() {
  clearTimeout(state.messagesRefreshTimer);
  state.messagesRefreshTimer = setTimeout(() => loadMessages().catch(() => {}), 250);
}

function parseReactions(raw) {
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (!raw) return [];
  try {
    return JSON.parse(raw).filter(Boolean);
  } catch (_error) {
    return [];
  }
}

function messageAttachmentHtml(row, imageClass = "attachment") {
  const url = row?.attachment_url || row?.attachmentUrl;
  if (!url) return "";
  const type = String(row?.attachment_type || row?.attachmentType || "");
  const voice = type.startsWith("audio/") || type === "video/webm" || /\.(webm|ogg|mp3|m4a)(?:\?|$)/i.test(url);
  if (voice) return '<audio class="voice-message" controls preload="none" src="' + html(url) + '"></audio>';
  return '<img class="' + html(imageClass) + ' zoomable-image" data-zoom-src="' + html(url) + '" src="' + html(url) + '" alt="attachment" loading="lazy" decoding="async" />';
}

function messageMarkup(message) {
    const user = {
      id: message.user_id,
      username: message.username,
      rank: message.rank_name,
      avatarUrl: message.avatar_url,
      usernameColor: message.username_color,
      textColor: message.text_color,
      bubbleStyle: message.bubble_style,
      profileTitle: message.profile_title,
      frame: message.frame,
    };
    const protectedSystemMessage = isProtectedSystemMessage(message, user);
    const reply = message.reply_to_id ? state.messages.find((item) => Number(item.id) === Number(message.reply_to_id)) : null;
    const isOwn = Number(message.user_id) === Number(state.me.id);
    const canModify = !protectedSystemMessage && (isOwn || staffRanks.has(state.me.rank));
    const reactions = parseReactions(message.reactions);
    const bubbleClass = ["vip", "premium"].includes(user.bubbleStyle) ? ` bubble-${user.bubbleStyle}` : "";
    const avatarMarkup = protectedSystemMessage
      ? `<span class="message-avatar-button system-avatar" title="System bot">${framedAvatar(user, "avatar", 'loading="lazy" decoding="async"')}</span>`
      : `<button class="message-avatar-button" data-message-profile="${message.user_id}" type="button" title="View profile">${framedAvatar(user, "avatar", 'loading="lazy" decoding="async"')}</button>`;
    const authorMarkup = protectedSystemMessage
      ? `<span class="message-author system-author" style="${user.usernameColor ? `color:${html(user.usernameColor)}` : ""}">${html(user.username)}</span>`
      : `<button class="message-author" data-tag-user="${html(user.username)}" type="button" style="${user.usernameColor ? `color:${html(user.usernameColor)}` : ""}">${html(user.username)}</button>`;
    const menuMarkup = protectedSystemMessage || message.pending ? "" : `
      <div class="message-menu-wrap">
        <button class="message-menu-button" data-message-menu="${message.id}" type="button" title="Message options"><svg viewBox="0 0 24 24"><path d="M6 12a2 2 0 1 0-4 0 2 2 0 0 0 4 0Zm8 0a2 2 0 1 0-4 0 2 2 0 0 0 4 0Zm8 0a2 2 0 1 0-4 0 2 2 0 0 0 4 0Z"/></svg></button>
        <div class="message-menu hidden" data-menu-for="${message.id}">
          <button data-reply="${message.id}" type="button">Reply</button>
          ${!isOwn ? `<button data-report-message="${message.id}" data-report-user="${message.user_id}" type="button">Report</button>` : ""}
          ${canModify ? `<button data-delete="${message.id}" type="button">Delete</button>` : ""}
        </div>
      </div>
    `;
  return `
      <article class="message ${isOwn ? "own" : ""}${protectedSystemMessage ? " message-system message-intruder" : ""}${message.pending ? " message-pending" : ""}${bubbleClass}" data-message-id="${message.id}">
        ${avatarMarkup}
        <div class="message-card" style="--message-color:${html(user.textColor || "#fbf7ff")}">
          <div class="message-topline">
            <div class="message-meta">${authorMarkup}${userRankBadge(user)}<time>${formatTime(message.created_at)}</time>${message.is_pinned ? '<span class="rank-pill">PIN</span>' : ""}</div>
            ${menuMarkup}
          </div>
          ${reply ? `<div class="reply-preview"><strong>@${html(reply.username)}</strong><span>${html(String(reply.body || "").slice(0, 90))}</span></div>` : ""}
          <div class="message-body">${renderMessageBody(message.body || "", user)}</div>
          ${messageAttachmentHtml(message, "attachment")}
          <div class="badge-grid">${reactions.map((reaction) => `<span class="rank-pill">${html(reaction.emoji)} ${reaction.count}</span>`).join("")}</div>
        </div>
      </article>
    `;
}

function renderMessages() {
  const container = $("#messages");
  if (!container) return;
  const currentIds = $$('[data-message-id]', container).map((node) => String(node.dataset.messageId));
  const nextIds = state.messages.map((message) => String(message.id));
  const canAppendOne = nextIds.length === currentIds.length + 1
    && currentIds.every((id, index) => id === nextIds[index]);
  if (canAppendOne) {
    container.insertAdjacentHTML("beforeend", messageMarkup(state.messages[state.messages.length - 1]));
    const article = container.lastElementChild;
    bindMessageActions(article);
  } else {
    container.innerHTML = state.messages.map(messageMarkup).join("");
    bindMessageActions(container);
  }
  container.scrollTop = container.scrollHeight;
  clearInterval(state.quizRoomTicker);
  state.quizRoomTicker = null;
  if (document.body.classList.contains("quiz-room-active")) {
    const paintQuizRoomTimers = () => {
      $$('[data-quiz-room-countdown]', container).forEach((node) => {
        const remainingMs = Math.max(0, new Date(node.dataset.quizRoomCountdown).getTime() - Date.now());
        const durationMs = Math.max(5000, Number(node.dataset.quizRoomDurationMs || 15000));
        const elapsedMs = Math.max(0, durationMs - remainingMs);
        const points = elapsedMs <= 3000 ? 100 : Math.max(60, 90 - Math.floor((elapsedMs - 3000) / 2000) * 10);
        const nextText = remainingMs > 0 ? `${Math.ceil(remainingMs / 1000)}s · ${points} pts` : "Round closed";
        if (node.textContent !== nextText) node.textContent = nextText;
      });
    };
    paintQuizRoomTimers();
    state.quizRoomTicker = setInterval(paintQuizRoomTimers, 500);
  }
}

function confirmOptimisticMessage(pendingId, message) {
  const pendingIndex = state.messages.findIndex((item) => String(item.id) === String(pendingId));
  if (pendingIndex < 0) return false;
  state.messages[pendingIndex] = message;
  const container = $("#messages");
  const pendingNode = container?.querySelector(`[data-message-id="${pendingId}"]`);
  if (!pendingNode) {
    renderMessages();
    return true;
  }
  pendingNode.insertAdjacentHTML("afterend", messageMarkup(message));
  const confirmedNode = pendingNode.nextElementSibling;
  pendingNode.remove();
  if (confirmedNode) bindMessageActions(confirmedNode);
  container.scrollTop = container.scrollHeight;
  return true;
}

function renderIntruderMessage(payload) {
  const type = String(payload?.type || "");
  if (type === "alert") {
    return `
      <div class="intruder-card intruder-alert">
        <strong>Intruder has arrived</strong>
        <span>Say <b>shoot</b> to murder him for ${compactNumber(Number(payload.points || 0))} points.</span>
      </div>
    `;
  }
  if (type === "shot") {
    return `
      <div class="intruder-card intruder-shot">
        <strong>Intruder has been shot</strong>
        <span>Taken down by <b>${html(payload.username || "someone")}</b>. Total points: ${compactNumber(Number(payload.total || 0))}.</span>
      </div>
    `;
  }
  if (type === "survived") {
    return `
      <div class="intruder-card intruder-survived">
        <strong>Intruder escaped</strong>
        <span>Nobody shot in time. Watch for the next arrival.</span>
      </div>
    `;
  }
  return "";
}

function renderBetMessage(payload) {
  const username = html(payload?.username || "A user");
  const amount = compactNumber(Number(payload?.amount || 0));
  const result = compactNumber(Number(payload?.resultAmount || 0));
  if (payload?.outcome === "lost") return `<div class="bet-card bet-lost"><strong>${username} bet ${amount} gold</strong><span>Lost — result: ${result} gold</span></div>`;
  if (payload?.outcome === "neutral") return `<div class="bet-card bet-neutral"><strong>${username} bet ${amount} gold</strong><span>Neither won nor lost — result: ${result} gold</span></div>`;
  return `<div class="bet-card bet-won"><strong>${username} bet ${amount} gold</strong><span>Won ${Number(payload?.multiplier || 1)}× — result: ${result} gold</span></div>`;
}

function renderFunCommandMessage(prefix, payload) {
  if (prefix === confessPrefix) {
    return `<div class="town-command-card confess-card"><small>Anonymous confession</small><strong>${html(payload?.message || "")}</strong><span>Identity protected by TownBot.</span></div>`;
  }
  if (prefix === shipPrefix) {
    return `<div class="town-command-card ship-card"><small>Compatibility scan</small><strong>${html(payload?.first || "User")} <b>×</b> ${html(payload?.second || "User")}: ${Number(payload?.percent || 0)}%</strong><span>${html(payload?.line || "The results are mysterious.")}</span></div>`;
  }
  if (prefix === stealPrefix) {
    const success = Boolean(payload?.success);
    return `<div class="town-command-card steal-card ${success ? "command-success" : "command-failed"}"><small>${success ? "Heist successful" : "Caught"}</small><strong>${html(payload?.actor || "Someone")} ${success ? `took ${compactNumber(Number(payload?.amount || 0))} gold from ${html(payload?.target || "a user")}` : "was caught and muted for 1 minute"}</strong><span>${html(payload?.line || "TownBot closed the case.")}</span></div>`;
  }
  if (prefix === huntPrefix) {
    return `<div class="town-command-card hunt-card"><small>Diamond hunt</small><strong>${html(payload?.username || "A hunter")} found ${compactNumber(Number(payload?.reward || 0))} diamonds</strong><span>${html(payload?.line || "The trail paid off.")}</span></div>`;
  }
  if (prefix === roastPrefix) {
    return `<div class="town-command-card roast-card"><small>TownBot roast</small><strong>${html(payload?.username || "Someone")} ${html(payload?.roast || "left TownBot speechless.")}</strong><span>Playful damage delivered at random.</span></div>`;
  }
  return "";
}

function renderXoMessage(payload) {
  const type = String(payload?.type || "invite");
  const gameId = Number(payload?.gameId || 0);
  if (type === "invite") return `<div class="xo-message-card"><img src="/assets/game-xo.svg" alt="" /><span><small>X-O challenge</small><strong>${html(payload?.host || "A player")} opened a match</strong><em>Waiting for one minute · 500 gold stake</em></span><button data-join-xo="${gameId}" type="button">Click here to join</button></div>`;
  if (type === "joined") return `<div class="xo-message-card"><img src="/assets/game-xo.svg" alt="" /><span><small>Match started</small><strong>${html(payload?.host || "Player X")} vs ${html(payload?.guest || "Player O")}</strong><em>X plays first</em></span><button data-open-xo="${gameId}" type="button">Open board</button></div>`;
  if (type === "cancelled") return `<div class="xo-message-card xo-result-card"><img src="/assets/game-xo.svg" alt="" /><span><small>X-O cancelled</small><strong>${html(payload?.host || "The host")} closed the waiting match</strong><em>No gold was charged</em></span></div>`;
  if (type === "won") return `<div class="xo-message-card xo-result-card"><img src="/assets/game-xo.svg" alt="" /><span><small>X-O result</small><strong>${html(payload?.host || "Player X")} vs ${html(payload?.guest || "Player O")} in X-O</strong><em>Winner - ${html(payload?.winner || "Unknown")}</em></span><button data-open-xo="${gameId}" type="button">View board</button></div>`;
  return `<div class="xo-message-card xo-result-card"><img src="/assets/game-xo.svg" alt="" /><span><small>X-O result</small><strong>${html(payload?.host || "Player X")} vs ${html(payload?.guest || "Player O")} in X-O</strong><em>Result - draw</em></span><button data-open-xo="${gameId}" type="button">View board</button></div>`;
}

function renderMessageBody(body, user = {}) {
  if (body.startsWith(quizPrefix)) {
    try {
      const payload = JSON.parse(body.slice(quizPrefix.length));
      const type = String(payload?.type || "question");
      if (type === "question") return `<div class="quiz-message-card"><small>${html(payload.category || "Quiz Room")} &middot; Question ${Number(payload.questionNumber || payload.number || 0)}</small><strong>${html(payload.question || "Get ready...")}</strong><span>${html(payload.hint || "Type your answer in chat")}</span><b data-quiz-room-countdown="${html(payload.expiresAt || "")}" data-quiz-room-duration-ms="${Math.max(5000, Number(payload.durationSeconds || 15) * 1000)}">${Number(payload.durationSeconds || 15)}s &middot; ${Number(payload.maximumPoints || 100)} pts</b></div>`;
      if (type === "winner") return `<div class="quiz-message-card quiz-result"><small>Correct answer</small><strong>${html(payload.username || "A player")} wins ${compactNumber(payload.points || 0)} points</strong><span>${html(payload.answer || "")} &middot; ${(Number(payload.speedMs || payload.responseMs || 0) / 1000).toFixed(1)}s response</span></div>`;
      if (type === "expired") return `<div class="quiz-message-card quiz-expired"><small>Time expired</small><strong>No correct answer this round</strong><span>Answer: ${html(payload.answer || "Not revealed")}</span></div>`;
      if (type === "paused") return '<div class="quiz-message-card quiz-expired"><strong>Quiz Room paused by the Developer</strong><span>The current score and question are safely frozen.</span></div>';
      if (type === "resumed") return '<div class="quiz-message-card"><strong>Quiz Room resumed</strong><span>The server timer is running again.</span></div>';
      if (type === "skipped") return `<div class="quiz-message-card quiz-expired"><strong>Question skipped</strong><span>Answer: ${html(payload.answer || "Not revealed")}</span></div>`;
      if (type === "contest") return `<div class="quiz-message-card quiz-result"><small>Official Quiz Contest</small><strong>${html(payload.headline || "Tournament update")}</strong><span>${html(payload.detail || "Open Games to view the live bracket.")}</span></div>`;
      return "";
    } catch (_error) {
      return "";
    }
  }
  if (body.startsWith(betPrefix)) {
    try {
      return renderBetMessage(JSON.parse(body.slice(betPrefix.length))) || "";
    } catch (_error) {
      return "";
    }
  }
  if (body.startsWith(xoPrefix)) {
    try {
      return renderXoMessage(JSON.parse(body.slice(xoPrefix.length))) || "";
    } catch (_error) {
      return "";
    }
  }
  const funPrefix = funCommandPrefixes.find((prefix) => body.startsWith(prefix));
  if (funPrefix) {
    try {
      return renderFunCommandMessage(funPrefix, JSON.parse(body.slice(funPrefix.length))) || "";
    } catch (_error) {
      return "";
    }
  }
  if (String(user.username || "").toLowerCase() === "intruder" && body.startsWith(intruderPrefix)) {
    try {
      return renderIntruderMessage(JSON.parse(body.slice(intruderPrefix.length))) || "";
    } catch (_error) {
      return "";
    }
  }
  if (/^@wb\s+/i.test(body)) {
    const username = body.replace(/^@wb\s+/i, "").trim();
    return `<div class="welcome-card"><span>Welcome back</span><strong>@${html(username)}</strong><small>The town saved your seat.</small></div>`;
  }
  if (body.startsWith("/poll ")) {
    const parts = body.slice(6).split("|").map((part) => part.trim()).filter(Boolean);
    const question = parts.shift() || "Poll";
    const options = parts.length ? parts : ["Yes", "No"];
    return `<div class="poll-card"><strong>${html(question)}</strong>${options.map((option) => `<button type="button">${html(option)}</button>`).join("")}</div>`;
  }
  return html(body)
    .replace(/@([a-zA-Z0-9_]+)/g, (_match, username) => {
      const taggedMe = state.me?.username && username.toLowerCase() === state.me.username.toLowerCase();
      return `<strong class="mention${taggedMe ? " mention-self" : ""}">@${html(username)}</strong>`;
    })
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

function closeMessageMenus() {
  $$(".message-menu").forEach((menu) => {
    menu.classList.add("hidden");
    menu.classList.remove("open-up");
  });
  $$(".message.menu-open").forEach((message) => message.classList.remove("menu-open"));
}

function renderSlashSuggestions() {
  const value = $("#messageInput").value.trimStart();
  const box = $("#slashSuggestions");
  if (!value.startsWith("/")) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  const matches = slashCommands.filter(([command]) => command.toLowerCase().startsWith(value.toLowerCase()) || value === "/").slice(0, 5);
  box.innerHTML = matches.map(([command, help]) => `<button data-command="${html(command)}" type="button"><strong>${html(command)}</strong><span>${html(help)}</span></button>`).join("");
  box.classList.toggle("hidden", !matches.length);
  $$("[data-command]", box).forEach((button) => button.addEventListener("click", () => {
    $("#messageInput").value = `${button.dataset.command} `;
    $("#messageInput").focus();
    box.classList.add("hidden");
  }));
}

function bindMessageActions(root = $("#messages")) {
  if (!root) return;
  $$("[data-message-menu]", root).forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    const menu = $(`[data-menu-for="${button.dataset.messageMenu}"]`);
    const wasHidden = menu.classList.contains("hidden");
    closeMessageMenus();
    menu.classList.toggle("hidden", !wasHidden);
    button.closest(".message")?.classList.toggle("menu-open", wasHidden);
    if (wasHidden) {
      const viewport = $("#messages")?.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      menu.classList.toggle("open-up", Boolean(viewport && menuRect.bottom > viewport.bottom - 8));
    }
  }));
  $$(".message-menu", root).forEach((menu) => menu.addEventListener("click", () => closeMessageMenus()));
  $$(".message-card", root).forEach((card) => {
    const article = card.closest("[data-message-id]");
    const messageId = article?.dataset.messageId;
    if (!messageId) return;
    card.addEventListener("dblclick", (event) => {
      if (event.target.closest("button, a, input, textarea, select")) return;
      quoteMessage(messageId);
    });
    card.addEventListener("touchend", (event) => {
      if (event.target.closest("button, a, input, textarea, select")) return;
      const now = Date.now();
      if (state.lastTapMessageId === messageId && now - state.lastTapAt < 360) {
        event.preventDefault();
        quoteMessage(messageId);
        state.lastTapMessageId = null;
        state.lastTapAt = 0;
        return;
      }
      state.lastTapMessageId = messageId;
      state.lastTapAt = now;
    }, { passive: false });
  });
  $$("[data-message-profile]", root).forEach((button) => button.addEventListener("click", () => {
    closeMessageMenus();
    openProfile(Number(button.dataset.messageProfile)).catch((error) => toast(error.message));
  }));
  $$("[data-tag-user]", root).forEach((button) => button.addEventListener("click", () => {
    const username = button.dataset.tagUser;
    if (!username || username === state.me?.username) return;
    const input = $("#messageInput");
    const tag = `@${username}`;
    const tokens = input.value.toLowerCase().split(/\s+/);
    if (tokens.includes(tag.toLowerCase())) return input.focus();
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const before = input.value.slice(0, start);
    const after = input.value.slice(end);
    const insertion = `${before && !/\s$/.test(before) ? " " : ""}${tag}${after && !/^\s/.test(after) ? " " : ""}`;
    input.value = before + insertion + after;
    input.focus();
    const cursor = before.length + insertion.length;
    input.setSelectionRange(cursor, cursor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }));
  $$("[data-reply]", root).forEach((button) => button.addEventListener("click", () => {
    closeMessageMenus();
    state.replyToId = button.dataset.reply;
    const message = state.messages.find((item) => Number(item.id) === Number(state.replyToId));
    const tag = message?.username ? `@${message.username}` : `#${state.replyToId}`;
    $("#replyBox span").textContent = `Replying to ${tag}: ${String(message?.body || "").slice(0, 80)}`;
    $("#replyBox").classList.remove("hidden");
    $("#messageInput").focus();
  }));
  $$("[data-quote]", root).forEach((button) => button.addEventListener("click", () => {
    closeMessageMenus();
    quoteMessage(button.dataset.quote);
  }));
  $$("[data-react]", root).forEach((button) => button.addEventListener("click", async () => {
    closeMessageMenus();
    await api(`/api/chat/messages/${button.dataset.react}/reactions`, { method: "POST", body: JSON.stringify({ emoji: button.dataset.emoji }) });
  }));
  $$("[data-edit]", root).forEach((button) => button.addEventListener("click", async () => {
    closeMessageMenus();
    const message = state.messages.find((item) => Number(item.id) === Number(button.dataset.edit));
    const body = prompt("Edit message", message?.body || "");
    if (body !== null) {
      await api(`/api/chat/messages/${button.dataset.edit}`, { method: "PATCH", body: JSON.stringify({ body }) });
    }
  }));
  $$("[data-delete]", root).forEach((button) => button.addEventListener("click", async () => {
    closeMessageMenus();
    if (confirm("Delete this message?")) {
      await api(`/api/chat/messages/${button.dataset.delete}`, { method: "DELETE" });
    }
  }));
  $$("[data-pin]", root).forEach((button) => button.addEventListener("click", async () => {
    closeMessageMenus();
    await api(`/api/chat/messages/${button.dataset.pin}/pin`, { method: "POST" });
  }));
  $$("[data-report-message]", root).forEach((button) => button.addEventListener("click", () => {
    closeMessageMenus();
    openReportModal({
    targetType: "message",
    messageId: button.dataset.reportMessage,
    targetUserId: button.dataset.reportUser,
    roomId: state.currentRoomId,
    label: `message #${button.dataset.reportMessage}`,
  });
  }));
  $$("[data-join-xo]", root).forEach((button) => button.addEventListener("click", async () => {
    try {
      await api("/api/games/xo/" + button.dataset.joinXo + "/join", { method: "POST" });
      await openXoGame(button.dataset.joinXo);
    } catch (error) {
      toast(error.message);
    }
  }));
  $$("[data-open-xo]", root).forEach((button) => button.addEventListener("click", () => {
    openXoGame(button.dataset.openXo).catch((error) => toast(error.message));
  }));
}

function quoteMessage(messageId) {
  closeMessageMenus();
  const message = state.messages.find((item) => Number(item.id) === Number(messageId));
  if (!message) return;
  if (isProtectedSystemMessage(message, { username: message.username, rank: message.rank_name })) return;
  const body = String(message.body || "").trim();
  const quote = body ? `> ${message.username || "User"}: ${body}\n` : `> ${message.username || "User"} shared an attachment\n`;
  const input = $("#messageInput");
  input.value = `${quote}${input.value}`.trimEnd();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function renderUsers() {
  const allVisibleUsers = state.users.filter(visibleInUserList);
  const onlineTotal = allVisibleUsers.filter((user) => isOnline(user)).length;
  const onlineBadge = $("#onlineCountBadge");
  if (onlineBadge) onlineBadge.textContent = onlineTotal > 99 ? "99+" : String(onlineTotal);
  if ($("#app")?.classList.contains("right-closed")) return;
  const searchShell = $("#userSearchShell");
  searchShell?.classList.toggle("hidden", state.userTab !== "search");
  if (state.userTab === "search") {
    const query = String($("#userListSearch")?.value || "").trim().toLowerCase();
    const matches = query
      ? state.users.filter((user) => visibleInUserList(user) && `${displayName(user)} ${user.username || ""}`.toLowerCase().includes(query)).slice(0, 60)
      : [];
    $("#userList").innerHTML = `
      <section class="right-user-section user-search-results">
        <h3>${query ? `${matches.length} result${matches.length === 1 ? "" : "s"}` : "Find a member"}</h3>
        ${query ? renderUserRows(matches, false) : '<p class="muted compact-empty">Type a username above to search the town.</p>'}
      </section>`;
    $$('[data-user-id]', $("#userList")).forEach((button) => button.addEventListener("click", () => openUserActions(Number(button.dataset.userId))));
    return;
  }
  const source = (state.userTab === "friends"
    ? state.friends.map((friend) => userById(friend.id) || {
      id: friend.id,
      username: friend.username,
      avatarUrl: friend.avatar_url,
      rank: friend.rank_name,
      mood: friend.mood,
      lastSeen: friend.last_seen,
    })
    : state.userTab === "staff"
      ? state.users.filter((user) => staffRanks.has(user.rank))
      : state.users).filter(visibleInUserList);
  const rankSort = (a, b) => rankOrder.indexOf(b.rank) - rankOrder.indexOf(a.rank) || displayName(a).localeCompare(displayName(b));
  const seenSort = (a, b) => new Date(b.lastSeen || 0) - new Date(a.lastSeen || 0) || displayName(a).localeCompare(displayName(b));
  const online = source.filter((user) => isOnline(user)).sort(rankSort);
  const offline = source.filter((user) => !isOnline(user)).sort(seenSort);
  $("#userList").innerHTML = `
    <section class="right-user-section">
      <h3>${state.userTab === "staff" ? "Staff online" : "Online"}</h3>
      ${renderUserRows(online, false)}
    </section>
    <section class="right-user-section">
      <h3>${state.userTab === "staff" ? "Staff offline" : "Offline"}</h3>
      ${renderUserRows(offline, true)}
    </section>
  `;
  $$("[data-user-id]").forEach((button) => button.addEventListener("click", () => openUserActions(Number(button.dataset.userId))));
}

function renderUserRows(list, offline = false) {
  return list.map((user) => `
    <button class="user-row" data-user-id="${user.id}" type="button">
      <span class="status status-${html(presenceKey(user.profileStatus))} ${offline || !isOnline(user) ? "offline" : ""}" title="${html(offline || !isOnline(user) ? "Offline" : (user.profileStatus || "Online"))}"></span>
      ${framedAvatar(user)}
      <span><strong>${html(user.username)}</strong><small>${userRankBadge(user)}${!offline && user.profileStatus && user.profileStatus !== "Online" ? `<em class="user-presence-label">${html(user.profileStatus)}</em>` : ""}</small></span>
    </button>
  `).join("") || '<p class="muted compact-empty">No users here.</p>';
}

function renderProfiles() {
  $("#profileGrid").innerHTML = state.users.filter(visibleInUserList).map((user) => `
    <article class="profile-card">
      ${framedAvatar(user, "profile-card-avatar")}
      <h3>${html(user.username)}</h3>
      ${userRankBadge(user)}
      <p class="muted">Level ${levelInfo(user.xp).level} | ${user.profileLikes || 0} likes</p>
      <button class="icon-action" data-view-profile="${user.id}" type="button">View profile</button>
    </article>
  `).join("");
  bindUserActionButtons();
}

function renderVip() {
  const ranks = Object.keys(rankShopCatalog);
  if (!rankShopCatalog[state.selectedRank]) state.selectedRank = "s-vip";
  const selected = rankShopCatalog[state.selectedRank];
  const currentRank = state.me?.rank || "user";
  const currentPower = rankOrder.indexOf(currentRank);
  const selectedPower = rankOrder.indexOf(state.selectedRank);
  const activePlan = state.me?.rankPlan;
  const activeUntil = state.me?.rankUntil && new Date(state.me.rankUntil) > new Date();
  const globallyBlocked = currentPower >= rankOrder.indexOf("premium") || currentPower > selectedPower;
  const wallet = $("#rankShopWallet");
  if (wallet) wallet.innerHTML = '<span><img src="/assets/currency-gold.png" alt="" /><strong>' + compactNumber(state.me?.gold || 0) + '</strong><small>Gold</small></span><span><img src="/assets/currency-diamond.png" alt="" /><strong>' + compactNumber(state.me?.diamonds || 0) + '</strong><small>Diamonds</small></span><em>Current: ' + userRankBadge(state.me) + '</em>';
  $("#rankSelector").innerHTML = ranks.map((rank) => {
    const item = rankShopCatalog[rank];
    return '<button class="rank-choice rank-choice-' + rank + (state.selectedRank === rank ? ' active' : '') + '" data-select-rank="' + rank + '" type="button"><img src="/assets/badge-' + rank + '.svg" alt="" /><span><strong>' + item.name + '</strong><small>' + item.tagline + '</small></span></button>';
  }).join("");
  $("#vipGrid").innerHTML = Object.entries(selected.plans).map(([code, price]) => {
    const sameActiveRank = currentRank === state.selectedRank && activeUntil;
    const samePermanentRank = currentRank === state.selectedRank && !activeUntil;
    const repeatedPlan = sameActiveRank && activePlan === code;
    const shorterPlan = sameActiveRank && rankPlanPower[code] <= rankPlanPower[activePlan];
    const disabled = globallyBlocked || samePermanentRank || repeatedPlan || shorterPlan;
    const reason = currentPower >= rankOrder.indexOf("premium")
      ? "Premium and staff ranks cannot buy ranks"
      : currentPower > selectedPower
        ? "This rank is below your current rank"
        : samePermanentRank
          ? "You already have this rank"
        : repeatedPlan
          ? "This plan is already active"
          : shorterPlan ? "Choose a longer period" : "";
    return '<article class="vip-card rank-plan-card"><span class="rank-plan-icon"><img src="/assets/badge-' + state.selectedRank + '.svg" alt="" /></span><small>' + selected.name + ' plan</small><h3>' + rankPlanLabels[code] + '</h3><div class="plan-price"><strong><img src="/assets/currency-diamond.png" alt="" />' + compactNumber(price[0]) + ' diamonds</strong><span><img src="/assets/currency-gold.png" alt="" />' + compactNumber(price[1]) + ' gold</span></div>' + (reason ? '<p class="rank-plan-reason">' + reason + '</p>' : '<p>Rank art, badge, profile tools, and upgraded presence.</p>') + '<button class="primary" data-buy-rank="' + state.selectedRank + '" data-rank-plan="' + code + '" type="button" ' + (disabled ? "disabled" : "") + '>' + (disabled ? "Unavailable" : "Buy " + rankPlanLabels[code]) + '</button></article>';
  }).join("");
  $$("[data-select-rank]").forEach((button) => button.addEventListener("click", () => {
    state.selectedRank = button.dataset.selectRank;
    renderVip();
  }));
  $$("[data-buy-rank]").forEach((button) => button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      const result = await api("/api/social/memberships/rank", { method: "POST", body: JSON.stringify({ rank: button.dataset.buyRank, plan: button.dataset.rankPlan }) });
      toast(result.rank.toUpperCase() + " activated for " + result.plan + ".");
      state.storeCache = null;
      await bootstrap();
      setView("vip");
    } catch (error) {
      toast(error.message);
      button.disabled = false;
    }
  }));
}

function xoSecondsLeft(game) {
  const expiry = game.expires_at || game.expiresAt;
  return expiry ? Math.max(0, Math.ceil((new Date(expiry).getTime() - Date.now()) / 1000)) : 60;
}

function xoStatusText(game) {
  if (game.status === "waiting") return `Waiting · ${xoSecondsLeft(game)}s left`;
  if (game.status === "expired") return "Invitation expired";
  if (game.status === "cancelled") return "Waiting match cancelled";
  if (game.status === "draw") return "Draw · no gold won or lost";
  if (game.status === "won") return (game.winner_name || "Winner") + " won 500 gold";
  return Number(game.turn_user_id) === Number(state.me?.id) ? "Your turn" : "Opponent\'s turn";
}

function xoFinishCard(game, isHost, isGuest) {
  if (game.status === "draw") {
    return '<section class="xo-finish-card draw"><small>Match complete</small><h2>Draw</h2><p>The match is closed. No gold was won or lost.</p><button class="primary" data-back-games type="button">Return to game list</button></section>';
  }
  if (game.status !== "won") return "";
  const participant = isHost || isGuest;
  const won = Number(game.winner_id) === Number(state.me?.id);
  const outcomeClass = !participant || won ? "won" : "lost";
  const title = participant ? (won ? "You won!" : "You lost") : `${html(game.winner_name || "The winner")} won`;
  const detail = participant
    ? (won ? "The match is closed. You gained 500 gold." : "The match is closed and your 500 gold stake was lost.")
    : "The match is closed and the result is final.";
  return `<section class="xo-finish-card ${outcomeClass}"><small>Match complete</small><h2>${title}</h2><p>${detail}</p><button class="primary" data-back-games type="button">Return to game list</button></section>`;
}

function paintXoGame(game) {
  const root = $("#gamesHub");
  if (!root || !game) return;
  clearInterval(state.xoExpiryTimer);
  state.activeXoGameId = Number(game.id);
  const board = String(game.board || "---------").padEnd(9, "-").slice(0, 9).split("");
  const isHost = Number(game.host_id) === Number(state.me?.id);
  const isGuest = Number(game.guest_id) === Number(state.me?.id);
  const myTurn = game.status === "playing" && Number(game.turn_user_id) === Number(state.me?.id);
  const waitingActions = game.status === "waiting" && isHost
    ? '<div class="xo-waiting-note"><strong>Invitation is live</strong><span>Another player has one minute to join. No gold is charged until they do.</span></div><button class="xo-cancel-button" data-cancel-waiting-xo type="button"><b>×</b><span>Cancel invitation permanently<small>Closes this match for everyone</small></span></button>'
    : "";
  root.innerHTML = `
    <section class="xo-arena ${["won", "draw"].includes(game.status) ? "match-finished" : ""}" data-xo-game="${game.id}" data-xo-game-status="${html(game.status)}">
      <div class="xo-arena-head">
        <button class="xo-back-button" data-back-games type="button" title="Leave this screen without cancelling the match"><b>‹</b><span>Game list<small>Match stays open</small></span></button>
        <span><small>500 gold match</small><h3>${html(game.host_name || "Player X")} <b>vs</b> ${html(game.guest_name || "Waiting...")}</h3></span>
        <img src="/assets/game-xo.svg" alt="" />
      </div>
      <div class="xo-score-strip"><span><b>X</b>${html(game.host_name || "Player X")}</span><strong data-xo-status>${html(xoStatusText(game))}</strong><span><b>O</b>${html(game.guest_name || "Open seat")}</span></div>
      <div class="xo-board">${board.map((cell, index) => `<button data-xo-cell="${index}" class="xo-cell ${cell !== "-" ? "played" : ""}" type="button" ${!myTurn || cell !== "-" ? "disabled" : ""}>${cell === "-" ? "" : cell}</button>`).join("")}</div>
      ${xoFinishCard(game, isHost, isGuest)}
      <div class="xo-arena-actions">
        ${game.status === "waiting" && !isHost ? '<button class="primary" data-join-current-xo type="button">Join for 500 gold</button>' : ""}
        ${waitingActions}
        ${["expired", "cancelled"].includes(game.status) ? '<div class="xo-closed-note"><strong>This invitation is closed</strong><span>Return to the game list to start another match.</span></div>' : ""}
        ${!isHost && !isGuest && game.status !== "waiting" && !["won", "draw"].includes(game.status) ? '<p>This match belongs to its two players.</p>' : ""}
      </div>
    </section>`;
  if (game.status === "playing" && (isHost || isGuest)) {
    $(".xo-arena-actions", root)?.insertAdjacentHTML("beforeend", '<button class="xo-forfeit-button" data-forfeit-xo type="button"><b>!</b><span>Forfeit match<small>This deliberately ends the game as your loss</small></span></button>');
  }
  if (game.status === "waiting") {
    let refreshingExpiredGame = false;
    const updateCountdown = () => {
      const seconds = xoSecondsLeft(game);
      const status = $("[data-xo-status]", root);
      if (status) status.textContent = seconds > 0 ? `Waiting · ${seconds}s left` : "Invitation expired";
      if (seconds > 0 || refreshingExpiredGame) return;
      refreshingExpiredGame = true;
      clearInterval(state.xoExpiryTimer);
      openXoGame(game.id).catch(() => renderGames().catch(() => {}));
    };
    updateCountdown();
    state.xoExpiryTimer = setInterval(updateCountdown, 1000);
  }
  $$("[data-back-games]", root).forEach((button) => button.addEventListener("click", () => renderGames().catch((error) => toast(error.message))));
  $("[data-join-current-xo]", root)?.addEventListener("click", async () => {
    try {
      const joined = await api("/api/games/xo/" + game.id + "/join", { method: "POST" });
      paintXoGame(joined);
    } catch (error) { toast(error.message); }
  });
  $("[data-cancel-waiting-xo]", root)?.addEventListener("click", async () => {
    if (!confirm("Permanently cancel this invitation? This is not just closing the screen. The match will be closed for everyone.")) return;
    try {
      const updated = await api("/api/games/xo/" + game.id + "/cancel", { method: "POST" });
      updateXoGameSmooth(updated);
    } catch (error) { toast(error.message); }
  });
  $("[data-forfeit-xo]", root)?.addEventListener("click", async () => {
    if (!confirm("Forfeit this match now? This deliberately ends the game as your loss. Your opponent will win and receive the gold.")) return;
    try {
      const updated = await api("/api/games/xo/" + game.id + "/forfeit", { method: "POST" });
      paintXoGame(updated);
      refreshUsersLight().catch(() => {});
    } catch (error) { toast(error.message); }
  });
  $$("[data-xo-cell]", root).forEach((button) => button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      const updated = await api("/api/games/xo/" + game.id + "/move", { method: "POST", body: JSON.stringify({ cell: Number(button.dataset.xoCell) }) });
      updateXoGameSmooth(updated);
      if (updated.status !== "playing") refreshUsersLight().catch(() => {});
    } catch (error) {
      toast(error.message);
      openXoGame(game.id).catch(() => {});
    }
  }));
}

async function openXoGame(gameId) {
  state.activeXoGameId = Number(gameId);
  setView("games");
  const root = $("#gamesHub");
  if (root) root.innerHTML = '<div class="view-loading"><span></span><strong>Opening X-O board...</strong></div>';
  const game = await api("/api/games/xo/" + Number(gameId));
  paintXoGame(game);
}

async function renderGames() {
  const root = $("#gamesHub");
  if (!root) return;
  try { await loadQuizGame(); } catch (_error) { /* Other games remain available. */ }
  clearInterval(state.xoExpiryTimer);
  state.activeXoGameId = null;
  root.innerHTML = `
    ${window.QuizGame?.cardHtml?.() || ""}
    ${window.SusGame?.cardHtml?.() || ""}
    <section class="game-feature-card"><div class="game-feature-art"><img src="/assets/game-xo.svg" alt="" /></div><div><span class="eyebrow">Quick match</span><h3>X-O</h3><p>Start a match and TownBot posts a join button in the room. The waiting invite expires after one minute. Each player stakes 500 gold only after both join.</p><button class="primary" id="startXoGame" type="button">Start X-O match</button></div></section>
    <section class="game-open-list" id="xoGameList"><div class="view-loading"><span></span><strong>Loading X-O matches...</strong></div></section>`;
  window.SusGame?.bindCard?.(root);
  window.QuizGame?.bindCard?.(root);
  $("#startXoGame")?.addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    try {
      const game = await api("/api/games/xo", { method: "POST", body: JSON.stringify({ roomId: state.currentRoomId }) });
      await openXoGame(game.id);
      toast("X-O join button sent to the room.");
    } catch (error) {
      toast(error.message);
      event.currentTarget.disabled = false;
    }
  });
  let games = [];
  try {
    const data = await api("/api/games/xo?roomId=" + Number(state.currentRoomId || 0));
    games = data.games || [];
  } catch (error) {
    const list = $("#xoGameList");
    if (list) list.innerHTML = `<div class="pm-empty"><strong>X-O is reconnecting</strong><span>${html(error.message)}</span></div>`;
    return;
  }
  const list = $("#xoGameList");
  if (!list || !root.isConnected || window.SusGame?.isOpen?.()) return;
  list.innerHTML = `<div class="pm-section-title"><span>Open & active X-O matches</span><small>${games.length || "none"}</small></div>
    ${games.map((game) => `<button class="game-match-row" data-game-id="${game.id}" type="button"><img src="/assets/game-xo.svg" alt="" /><span><strong>${html(game.host_name || "Player X")}${game.guest_name ? ` vs ${html(game.guest_name)}` : " is waiting"}</strong><small data-xo-list-status="${game.id}">${html(xoStatusText(game))}</small></span><em>${game.status === "waiting" ? (Number(game.host_id) === Number(state.me.id) ? "Waiting" : "Join") : "Open"}</em></button>`).join("")}
    ${games.length ? "" : '<div class="pm-empty"><strong>No X-O matches yet</strong><span>Start one and invite the room.</span></div>'}`;
  $$("[data-game-id]", root).forEach((button) => button.addEventListener("click", () => openXoGame(button.dataset.gameId).catch((error) => toast(error.message))));
  const waitingGames = games.filter((game) => game.status === "waiting");
  if (waitingGames.length) {
    let refreshingList = false;
    const updateListCountdowns = () => {
      waitingGames.forEach((game) => {
        const label = $(`[data-xo-list-status="${game.id}"]`, root);
        if (label) label.textContent = `Waiting · ${xoSecondsLeft(game)}s left`;
      });
      if (!refreshingList && waitingGames.some((game) => xoSecondsLeft(game) <= 0)) {
        refreshingList = true;
        clearInterval(state.xoExpiryTimer);
        renderGames().catch((error) => toast(error.message));
      }
    };
    updateListCountdowns();
    state.xoExpiryTimer = setInterval(updateListCountdowns, 1000);
  }
}

async function renderChatStore({ force = false } = {}) {
  const root = $("#chatStore");
  if (!root) return;
  const fallback = {
    gold: Number(state.me?.gold || 0),
    diamonds: Number(state.me?.diamonds || 0),
    free: ["premium", "admin", "developer"].includes(state.me?.rank),
    rank: state.me?.rank,
    selectedFrame: state.me?.frame || "clean",
    owned: {
      profileMusic: ["premium", "admin", "developer"].includes(state.me?.rank) || Boolean(state.me?.profileMusicUrl),
      profileFrames: ["premium", "admin", "developer"].includes(state.me?.rank) || Boolean(profileFrame(state.me)),
    },
  };
  paintChatStore(state.storeCache || fallback);
  if (!force && state.storeCache && Date.now() - state.storeCacheAt < 30000) return;
  try {
    const data = await api("/api/social/store", force ? { cache: "no-store" } : {});
    state.storeCache = data;
    state.storeCacheAt = Date.now();
    writeLocalCache("tct_store_cache", { data, at: state.storeCacheAt, userId: state.me?.id });
    if ($("#chatStoreView").classList.contains("active")) paintChatStore(data);
  } catch (error) {
    toast(`Store is syncing: ${error.message}`);
  }
}

function storePrice(data, currency, amount) {
  if (data.free) return '<span class="store-price free">Free</span>';
  const icon = currency === "gold" ? "/assets/currency-gold.png" : "/assets/currency-diamond.png";
  return `<span class="store-price"><img src="${icon}" alt="" />${compactNumber(amount)} ${currency}</span>`;
}

function persistStoreCache() {
  if (!state.storeCache) return;
  state.storeCacheAt = Date.now();
  writeLocalCache("tct_store_cache", { data: state.storeCache, at: state.storeCacheAt, userId: state.me?.id });
}

function paintChatStore(data) {
  const root = $("#chatStore");
  if (!root) return;
  const frames = [
    ["clean", "No Frame", "Use your profile photo without an overlay"],
    ["cosmic", "Cosmic Halo", "Violet starlight and cyan moon shards"],
    ["solar", "Solar Crown", "Antique gold with warm amber crystal"],
    ["prism", "Cyber Prism", "Gunmetal with cyan-magenta facets"],
    ["gothic", "Gothic Night", "Obsidian cathedral lines and crimson gems"],
    ["angelic", "Angelic Calm", "Pearl white feathers and pale blue light"],
    ["classic-gold", "Classic Gold", "Champagne gold, black enamel and diamonds"],
    ["royal-laurel", "Royal Laurel", "Golden wings, crown, and emerald details"],
    ["sun-throne", "Sun Throne", "Regal sun crest with polished gold leaves"],
  ];
  root.innerHTML = `
    <div class="store-wallet-row">
      <span><img src="/assets/currency-gold.png" alt="Gold" /><strong>${compactNumber(data.gold)}</strong><small>Gold</small></span>
      <span><img src="/assets/currency-diamond.png" alt="Diamonds" /><strong>${compactNumber(data.diamonds)}</strong><small>Diamonds</small></span>
    </div>
    <div class="store-grid">
      <article class="store-item-card music-store-card">
        <div class="store-item-art music-art"><span>♪</span></div>
        <div class="store-item-copy">
          <div><span class="eyebrow">Profile upgrade</span><h3>Profile Music</h3></div>
          <p>Upload one MP3 under 10 MB. It is fetched only when someone opens your profile.</p>
          ${storePrice(data, "gold", 2000)}
          <button class="primary" data-store-music type="button">${data.owned.profileMusic ? (state.me.profileMusicUrl ? "Change MP3" : "Upload MP3") : "Unlock Profile Music"}</button>
          <input class="hidden" id="storeProfileMusicUpload" type="file" accept=".mp3,audio/mpeg" />
        </div>
      </article>
      <article class="store-item-card frame-store-card">
        <div class="store-item-copy">
          <div><span class="eyebrow">Avatar upgrade</span><h3>Profile Frame Collection</h3></div>
          <p>Unlock all eight frames, switch anytime, or remove the frame completely.</p>
          ${storePrice(data, "diamonds", 100)}
        </div>
        ${data.owned.profileFrames && state.framePickerOpen ? `
          <div class="store-frame-grid">
            ${frames.map(([code, title, description]) => `
              <button class="store-frame-choice ${data.selectedFrame === code ? "active" : ""}" data-select-store-frame="${code}" type="button">
                <span class="store-frame-preview ${code === "clean" ? "clean" : ""}" style="--store-frame:url('${profileFrameAssets[code] || ""}')"><img src="${html(avatar(state.me))}" alt="" /></span>
                <strong>${title}</strong><small>${description}</small>
              </button>
            `).join("")}
          </div>
        ` : data.owned.profileFrames
          ? '<div class="store-frame-actions"><button class="primary store-unlock-button" data-proceed-frames type="button">Proceed</button><button data-select-store-frame="clean" type="button">Remove frame</button></div>'
          : '<button class="primary store-unlock-button" data-unlock-frames type="button">Unlock All Frames</button>'}
      </article>
    </div>
  `;
  $("[data-store-music]", root)?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      if (!state.storeCache.owned.profileMusic) {
        const purchase = await api("/api/social/store/purchase", { method: "POST", body: JSON.stringify({ itemCode: "profile-music" }) });
        state.storeCache.owned.profileMusic = true;
        if (!purchase.free) state.storeCache[purchase.currency] = Math.max(0, Number(state.storeCache[purchase.currency]) - Number(purchase.charged));
        persistStoreCache();
        paintChatStore(state.storeCache);
      }
      $("#storeProfileMusicUpload")?.click();
    } catch (error) {
      toast(error.message);
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });
  $("#storeProfileMusicUpload", root)?.addEventListener("change", async (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (!/\.mp3$/i.test(file.name) || !["audio/mpeg", "audio/mp3", ""].includes(file.type)) return toast("Choose an MP3 file.");
    if (file.size > 10 * 1024 * 1024) return toast("MP3 must be under 10 MB.");
    const form = new FormData();
    form.append("music", file);
    try {
      const result = await api("/api/social/store/profile-music", { method: "POST", body: form });
      state.me.profileMusicUrl = result.profileMusicUrl;
      state.profileCache.delete(Number(state.me.id));
      toast("Profile music uploaded.");
      paintChatStore(state.storeCache);
    } catch (error) {
      toast(error.message);
    }
  });
  $("[data-unlock-frames]", root)?.addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    try {
      const purchase = await api("/api/social/store/purchase", { method: "POST", body: JSON.stringify({ itemCode: "profile-frames" }) });
      state.storeCache.owned.profileFrames = true;
      state.framePickerOpen = false;
      if (!purchase.free) state.storeCache[purchase.currency] = Math.max(0, Number(state.storeCache[purchase.currency]) - Number(purchase.charged));
      persistStoreCache();
      paintChatStore(state.storeCache);
    } catch (error) {
      toast(error.message);
      event.currentTarget.disabled = false;
    }
  });
  $("[data-proceed-frames]", root)?.addEventListener("click", () => {
    state.framePickerOpen = true;
    paintChatStore(state.storeCache);
  });
  $$("[data-select-store-frame]", root).forEach((button) => button.addEventListener("click", async () => {
    const frame = button.dataset.selectStoreFrame;
    try {
      await api("/api/social/store/frame", { method: "POST", body: JSON.stringify({ frame }) });
      state.storeCache.selectedFrame = frame;
      state.framePickerOpen = false;
      state.me.frame = frame;
      const meInList = state.users.find((user) => Number(user.id) === Number(state.me.id));
      if (meInList) meInList.frame = frame;
      state.profileCache.delete(Number(state.me.id));
      persistStoreCache();
      renderUsers();
      renderProfiles();
      renderMessages();
      paintChatStore(state.storeCache);
      toast(frame === "clean" ? "Profile frame removed." : "Profile frame selected.");
    } catch (error) {
      toast(error.message);
    }
  }));
}

async function renderNews({ force = false } = {}) {
  if ($("#newsView").classList.contains("active")) clearNewsUnread();
  syncNewsComposerAccess();
  if (state.newsCache) paintNews(state.newsCache);
  else $("#newsList").innerHTML = '<div class="view-loading"><span></span><strong>Loading news...</strong></div>';
  if (!force && state.newsCache && Date.now() - state.newsCacheAt < 30000) return;
  const posts = await api("/api/social/news", force ? { cache: "no-store" } : {});
  state.newsCache = posts;
  state.newsCacheAt = Date.now();
  writeLocalCache("tct_news_cache", { data: posts, at: state.newsCacheAt });
  if ($("#newsView").classList.contains("active")) paintNews(posts);
}

function paintNews(posts) {
  $("#newsList").innerHTML = posts.map((post) => `
    <article class="news-card" data-news-card="${post.id}">
      ${post.image_url ? `<img class="zoomable-image" data-zoom-src="${html(assetUrl(post.image_url))}" src="${html(assetUrl(post.image_url))}" alt="" loading="lazy" decoding="async" />` : `<div class="news-art"><span>TCT</span></div>`}
      <div class="news-card-content">
        <div class="news-card-top">
          <span class="eyebrow">Town update</span>
          ${canManageNews() ? `<button class="news-delete-button" data-delete-news="${post.id}" title="Delete this news" aria-label="Delete ${html(post.title)}" type="button">&times;</button>` : ""}
        </div>
        <h3>${html(post.title)}</h3>
        <p>${html(post.body)}</p>
        <small>By ${html(post.username)} | ${formatDate(post.created_at)} ${formatTime(post.created_at)}</small>
        <section class="news-comments">
          <strong>Comments</strong>
          <div class="news-comment-list">
            ${(post.comments || []).map((comment) => `
              <div class="news-comment">
                <img class="avatar" src="${html(assetUrl(comment.avatar_url || "/assets/avatar-other.svg"))}" alt="" />
                <span><b>${html(comment.username)}</b><small>${formatTime(comment.created_at)}</small><p>${html(comment.body)}</p></span>
              </div>
            `).join("") || '<p class="muted">No comments yet.</p>'}
          </div>
          <form class="news-comment-form" data-news-comment="${post.id}">
            <input name="body" maxlength="500" placeholder="Write a comment..." />
            <button type="submit">Post</button>
          </form>
        </section>
      </div>
    </article>
  `).join("") || '<p class="muted">No news has been posted yet.</p>';
  $$("[data-news-comment]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = new FormData(event.currentTarget).get("body");
    if (!String(body || "").trim()) return;
    await api(`/api/social/news/${form.dataset.newsComment}/comments`, { method: "POST", body: JSON.stringify({ body }) });
    resetNewsCache();
    await renderNews({ force: true });
  }));
  $$('[data-delete-news]').forEach((button) => button.addEventListener("click", async () => {
    if (!confirm("Delete this news post and all of its comments?")) return;
    button.disabled = true;
    try {
      await api(`/api/social/news/${button.dataset.deleteNews}`, { method: "DELETE" });
      resetNewsCache();
      button.closest("[data-news-card]")?.remove();
      if (!$("[data-news-card]")) $("#newsList").innerHTML = '<p class="muted">No news has been posted yet.</p>';
      toast("News deleted.");
    } catch (error) {
      button.disabled = false;
      toast(error.message);
    }
  }));
}

async function submitNewsForm(form) {
  await api("/api/social/news", { method: "POST", body: new FormData(form) });
  resetNewsCache();
  toast("News posted.");
  form.reset();
  const composer = $("#newsComposerArea");
  if (composer) {
    composer.classList.add("hidden");
    composer.innerHTML = "";
  }
  if ($("#newsView").classList.contains("active")) await renderNews({ force: true });
}

function openNewsComposer() {
  if (!canPostNews()) {
    toast("Your rank cannot post news.");
    return;
  }
  const composer = $("#newsComposerArea");
  if (!composer) return;
  composer.innerHTML = `
    <form id="quickNewsForm" class="news-compose-card">
      <label>Topic<input name="title" maxlength="120" placeholder="Town update" required /></label>
      <label>Description<textarea name="body" maxlength="2000" placeholder="Write the news..." required></textarea></label>
      <label>Upload file<input name="image" type="file" accept="image/*" /></label>
      <article id="newsComposerPreview" class="news-card news-compose-preview hidden">
        <div class="news-art"><span>TCT</span></div>
        <div><span class="eyebrow">Preview</span><h3></h3><p></p></div>
      </article>
      <div class="news-compose-actions">
        <button class="primary" type="submit">Post news</button>
        <button data-news-compose-close type="button">Cancel</button>
      </div>
    </form>
  `;
  composer.classList.remove("hidden");
  composer.scrollIntoView({ block: "nearest", behavior: "smooth" });
  const form = $("#quickNewsForm");
  const preview = $("#newsComposerPreview");
  const titleInput = form.elements.title;
  const bodyInput = form.elements.body;
  const imageInput = form.elements.image;
  let previewUrl = "";
  const updatePreview = () => {
    const title = titleInput.value.trim();
    const body = bodyInput.value.trim();
    const file = imageInput.files?.[0];
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = file ? URL.createObjectURL(file) : "";
    preview.classList.toggle("hidden", !title && !body && !file);
    $("h3", preview).textContent = title || "Town update";
    $("p", preview).textContent = body || "Your announcement will appear here.";
    const media = previewUrl
      ? `<img src="${html(previewUrl)}" alt="" />`
      : `<div class="news-art"><span>TCT</span></div>`;
    preview.firstElementChild.outerHTML = media;
  };
  ["input", "change"].forEach((eventName) => form.addEventListener(eventName, updatePreview));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = form.querySelector("button[type='submit']");
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Posting...";
    }
    try {
      await submitNewsForm(event.currentTarget);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    } catch (error) {
      toast(error.message);
    } finally {
      if (submitButton?.isConnected) {
        submitButton.disabled = false;
        submitButton.textContent = "Post news";
      }
    }
  });
  $("[data-news-compose-close]", form).addEventListener("click", () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    composer.classList.add("hidden");
    composer.innerHTML = "";
  });
  titleInput.focus();
}

function localLeaderboardData(board) {
  const key = board === "diamonds" ? "diamonds" : board === "gold" ? "gold" : "xp";
  const rows = ["shooters", "quiz"].includes(board) ? [] : [...state.users]
    .filter(visibleInUserList)
    .sort((a, b) => Number(b[key] || 0) - Number(a[key] || 0) || String(a.username).localeCompare(String(b.username)))
    .slice(0, 20)
    .map((user) => ({
      id: user.id,
      username: user.username,
      display_name: user.displayName,
      avatar_url: user.avatarUrl,
      rank_name: user.rank,
      profile_title: user.profileTitle,
      xp: user.xp,
      gold: user.gold,
      diamonds: user.diamonds,
    }));
  return { board, rows };
}

function paintLeaderboard(data, tab = state.leaderboardTab) {
  const labels = { xp: "Top XP", gold: "Top Gold", diamonds: "Top Diamonds", shooters: "Top Shooters", quiz: "Quiz" };
  const rows = data.rows || data[tab] || [];
  $("#leaderboard").innerHTML = `
    <div class="leaderboard-tabs">
      ${Object.entries(labels).map(([key, label]) => `<button class="${tab === key ? "active" : ""}" data-board-tab="${key}" type="button">${label}</button>`).join("")}
    </div>
    <div class="leaderboard-list">
      ${rows.map((user, index) => {
        const value = tab === "gold"
          ? user.gold
          : tab === "diamonds"
            ? user.diamonds
            : tab === "shooters"
              ? user.intruder_points
              : tab === "quiz"
                ? user.quiz_score
                : user.xp;
        const meta = tab === "shooters"
          ? ` | ${compactNumber(user.intruder_shots || 0)} shots`
          : tab === "quiz"
            ? ` | ${index < 8 ? "Contest seed | " : ""}${compactNumber(user.quiz_correct_answers || 0)} correct | ${compactNumber(user.quiz_best_streak || 0)} best streak${Number(user.quiz_tournaments_won || 0) ? ` | ${Number(user.quiz_tournaments_won)} titles` : ""}`
            : "";
        const quizClasses = tab === "quiz" ? `${index < 8 ? " quiz-leader-top-eight" : ""}${index < 3 ? " quiz-leader-top-three" : ""}${Number(user.id) === Number(state.me?.id) ? " quiz-leader-self" : ""}` : "";
        return `
          <article class="leaderboard-row${quizClasses}">
            <span class="leaderboard-rank">#${index + 1}</span>
            <img class="avatar" src="${html(user.avatar_url || "/assets/avatar-other.svg")}" alt="" />
            <div><strong>${html(user.display_name || user.username)}</strong><small>${rankBadge(user.rank_name, user.profile_title)}${meta}</small></div>
            <b>${compactNumber(value)}</b>
          </article>
        `;
      }).join("") || '<p class="muted">No leaderboard data yet.</p>'}
    </div>
  `;
  $$("[data-board-tab]").forEach((button) => button.addEventListener("click", () => {
    state.leaderboardTab = button.dataset.boardTab;
    renderLeaderboard().catch((error) => toast(error.message));
  }));
}

async function renderLeaderboard({ force = false } = {}) {
  const tab = state.leaderboardTab;
  const cached = state.leaderboardCache[tab];
  paintLeaderboard(cached?.data || localLeaderboardData(tab), tab);
  if (!force && cached && Date.now() - cached.at < 30000) return;
  const data = await api(`/api/social/leaderboards?board=${encodeURIComponent(tab)}${force ? "&fresh=1" : ""}`, force ? { cache: "no-store" } : {});
  state.leaderboardCache[tab] = { data, at: Date.now() };
  writeLocalCache("tct_leaderboard_cache_v2", state.leaderboardCache);
  if ($("#leaderboardView").classList.contains("active") && state.leaderboardTab === tab) paintLeaderboard(data, tab);
}

async function loadFriends() {
  const data = await api("/api/social/friends");
  state.friends = data.friends || [];
  state.friendRequests = data.requests || state.friendRequests;
  state.blocks = data.blocks || [];
  state.friendsCacheAt = Date.now();
  renderFriends();
  setBadges();
}

async function refreshPmUnread() {
  const data = await api("/api/chat/private-unread-count");
  state.unreadPm = Number(data.count || 0);
  state.pmUnreadCacheAt = Date.now();
  setBadges();
  return state.unreadPm;
}

async function refreshUsersLight() {
  const data = await api("/api/auth/users");
  state.me = data.me || state.me;
  if (state.me) state.me.chatBackground = normalizeRoomBackground(state.me.chatBackground);
  state.users = data.users || state.users;
  state.permissions = data.permissions || state.permissions || {};
  state.usersCacheAt = Date.now();
  syncNewsComposerAccess();
  renderUsers();
  renderProfiles();
  applyRoomBackground();
}

function scheduleUsersRefresh() {
  clearTimeout(state.usersRefreshTimer);
  const waitFor = Math.max(1200, 10000 - (Date.now() - Number(state.usersCacheAt || 0)));
  state.usersRefreshTimer = setTimeout(() => {
    refreshUsersLight().catch(() => {});
  }, waitFor);
}

function renderFriends() {
  $("#friendRequests").innerHTML = state.friendRequests.map((request) => `
    <div class="request-row"><img class="avatar" src="${html(request.avatar_url || "/assets/avatar-other.svg")}" alt="" /><span><strong>${html(request.username)}</strong><small>${html(request.rank_name)}</small></span><span><button data-accept="${request.id}">Accept</button><button data-decline="${request.id}">Decline</button></span></div>
  `).join("") || '<p class="muted">No pending friend requests.</p>';
  $("#friendsList").innerHTML = state.friends.map((friend) => `<div class="request-row"><img class="avatar" src="${html(friend.avatar_url || "/assets/avatar-other.svg")}" alt="" /><span><strong>${html(friend.username)}</strong><small>${html(friend.rank_name)}</small></span><button data-remove-friend="${friend.id}">Remove</button></div>`).join("") || '<p class="muted">No friends yet.</p>';
  $("#blockList").innerHTML = state.blocks.map((block) => `<div class="request-row"><span>${html(block.username)}</span><button data-unblock="${block.blocked_id}">Unblock</button></div>`).join("") || '<p class="muted">Block list is empty.</p>';
  $$("[data-accept]").forEach((button) => button.addEventListener("click", async () => { await api(`/api/social/friend-requests/${button.dataset.accept}/accept`, { method: "POST" }); await loadFriends(); }));
  $$("[data-decline]").forEach((button) => button.addEventListener("click", async () => { await api(`/api/social/friend-requests/${button.dataset.decline}/decline`, { method: "POST" }); await loadFriends(); }));
  $$("[data-remove-friend]").forEach((button) => button.addEventListener("click", async () => { await api(`/api/social/friends/${button.dataset.removeFriend}`, { method: "DELETE" }); await loadFriends(); }));
  $$("[data-unblock]").forEach((button) => button.addEventListener("click", async () => { await api(`/api/social/blocks/${button.dataset.unblock}`, { method: "DELETE" }); await loadFriends(); }));
}

function paintFriendsWall(posts = []) {
  const feed = $("#friendsWallFeed");
  if (!feed) return;
  feed.innerHTML = posts.map((post) => {
    const authorName = post.display_name || post.username;
    const ownerName = post.profile_display_name || post.profile_username;
    const ownWall = Number(post.author_id) === Number(post.profile_user_id);
    const canDelete = Number(post.author_id) === Number(state.me.id) || Number(post.profile_user_id) === Number(state.me.id) || staffRanks.has(state.me.rank);
    return `
      <article class="friends-wall-card">
        <button class="wall-author-avatar" data-wall-profile="${post.author_id}" type="button"><img src="${html(post.avatar_url || "/assets/avatar-other.svg")}" alt="" loading="lazy" decoding="async" /></button>
        <div class="wall-card-content">
          <div class="wall-card-head">
            <div><button data-wall-profile="${post.author_id}" type="button"><strong>${html(authorName)}</strong></button>${rankBadge(post.rank_name)}<small>${ownWall ? "shared an update" : `wrote on ${html(ownerName)}'s wall`}</small></div>
            <time>${formatDate(post.created_at)} · ${formatTime(post.created_at)}</time>
          </div>
          <p>${html(post.body)}</p>
          <div class="wall-card-actions"><button data-wall-profile="${post.profile_user_id}" type="button">View wall</button>${canDelete ? `<button data-delete-global-wall="${post.id}" type="button">Remove</button>` : ""}</div>
        </div>
      </article>`;
  }).join("") || '<div class="empty-state wall-empty"><strong>Your wall is ready</strong><p class="muted">Add friends or post the first update.</p></div>';
  $$('[data-wall-profile]', feed).forEach((button) => button.addEventListener("click", () => openProfile(Number(button.dataset.wallProfile)).catch((error) => toast(error.message))));
  $$('[data-delete-global-wall]', feed).forEach((button) => button.addEventListener("click", async () => {
    if (!confirm("Remove this wall post?")) return;
    await api(`/api/social/wall-posts/${button.dataset.deleteGlobalWall}`, { method: "DELETE" });
    state.friendsWallCache = null;
    await renderFriendsWall({ force: true });
  }));
}

async function renderFriendsWall({ force = false } = {}) {
  const fresh = state.friendsWallCache && Date.now() - state.friendsWallCacheAt < 20000;
  if (state.friendsWallCache) paintFriendsWall(state.friendsWallCache);
  if (!force && fresh) return;
  const posts = await api("/api/social/friends-wall?limit=30", force ? { cache: "no-store" } : {});
  state.friendsWallCache = posts;
  state.friendsWallCacheAt = Date.now();
  if ($("#wallView")?.classList.contains("active")) paintFriendsWall(posts);
}

function openFriendRequestDrawer() {
  setDrawerChrome({ title: "Friend requests" });
  $("#drawerBody").innerHTML = state.friendRequests.map((request) => `
    <div class="friend-request-card">
      <img class="avatar" src="${html(request.avatar_url || "/assets/avatar-other.svg")}" alt="" />
      <span><strong>${html(request.username)}</strong><small>${rankBadge(request.rank_name)}</small></span>
      <div><button data-accept="${request.id}" type="button">Accept</button><button data-decline="${request.id}" type="button">Decline</button></div>
    </div>
  `).join("") || '<p class="muted">No friend requests.</p>';
  showDrawer();
  $$("[data-accept]", $("#drawer")).forEach((button) => button.addEventListener("click", async () => { await api(`/api/social/friend-requests/${button.dataset.accept}/accept`, { method: "POST" }); await loadFriends(); openFriendRequestDrawer(); }));
  $$("[data-decline]", $("#drawer")).forEach((button) => button.addEventListener("click", async () => { await api(`/api/social/friend-requests/${button.dataset.decline}/decline`, { method: "POST" }); await loadFriends(); openFriendRequestDrawer(); }));
}

async function openReportQueueDrawer() {
  setDrawerChrome({ title: "Reports" });
  $("#drawerBody").innerHTML = '<p class="muted">Loading reports...</p>';
  showDrawer();
  const reports = await api("/api/admin/reports");
  $("#drawerBody").innerHTML = reports.map((report) => `
    <article class="report-queue-card ${report.status !== "open" ? "handled" : ""}">
      <div>
        <strong>${html(report.target_type || "content")} report</strong>
        <small>By ${html(report.reporter_name || `#${report.reporter_id}`)}${report.target_name ? ` about ${html(report.target_name)}` : ""}</small>
      </div>
      <p>${html(report.reason)}</p>
      <small>${report.message_id ? `Chat message #${report.message_id}` : ""}${report.private_message_id ? `Private message #${report.private_message_id}` : ""}${report.wall_post_id ? `Wall post #${report.wall_post_id}` : ""}${!report.message_id && !report.private_message_id && !report.wall_post_id ? "User/profile report" : ""}</small>
      <div class="report-queue-actions">
        <span>${html(report.status)}</span>
        ${report.status === "open" ? `<button data-report-ignore="${report.id}" type="button">Ignore</button><button class="danger-action" data-report-delete="${report.id}" type="button">Delete content</button>` : ""}
      </div>
    </article>
  `).join("") || '<p class="muted">No reports yet.</p>';
  $$("[data-report-ignore]").forEach((button) => button.addEventListener("click", async () => {
    await api(`/api/admin/reports/${button.dataset.reportIgnore}/action`, { method: "POST", body: JSON.stringify({ action: "ignore" }) });
    toast("Report ignored.");
    await openReportQueueDrawer();
    refreshReportBadge().catch(() => {});
  }));
  $$("[data-report-delete]").forEach((button) => button.addEventListener("click", async () => {
    if (!confirm("Delete the reported content?")) return;
    await api(`/api/admin/reports/${button.dataset.reportDelete}/action`, { method: "POST", body: JSON.stringify({ action: "delete" }) });
    toast("Reported content deleted.");
    await openReportQueueDrawer();
    await loadMessages();
    refreshReportBadge().catch(() => {});
  }));
}

async function openProfile(userId) {
  stopProfileMusic();
  state.activeProfileUserId = Number(userId);
  $("#drawer")?.classList.add("hidden");
  if (state.compactLayout) {
    $("#app")?.classList.add("right-closed");
    $("#app")?.classList.remove("nav-open");
  }
  const previewUser = userById(userId) || (Number(userId) === Number(state.me?.id) ? state.me : null);
  if (isSystemBot(previewUser)) return;
  closeProfileActionsOverlay();
  const requestId = ++state.profileRequestId;
  if (previewUser) {
    const previewInfo = levelInfo(previewUser.xp);
    $("#profileName").textContent = displayName(previewUser);
    $("#profileHandle").textContent = `@${String(previewUser.username || "user").toLowerCase()}`;
    $("#profileAvatar").src = avatar(previewUser);
    $("#profileStatusDot").classList.toggle("offline", !previewUser.online);
    $("#profileRankLine").innerHTML = profileRankLine(previewUser, previewInfo.level);
    $("#profileQuote").textContent = previewUser.mood || "Loading the latest profile details...";
    $("#profileCover").style.setProperty("--profile-banner", `url('${previewUser.bannerUrl || "/assets/profile-banner.svg"}')`);
    $("#profileInfo").innerHTML = profileOverviewPanel(previewUser);
    $("#profileCounters").innerHTML = `<span class="profile-metric"><b>★</b><strong>Level ${previewInfo.level}</strong></span>`;
    $("#profileMainActions").innerHTML = Number(previewUser.id) === Number(state.me.id)
      ? '<button class="primary" data-own-action="edit" type="button">Edit Profile</button>'
      : `<button class="primary" data-pm-user="${previewUser.id}" type="button">Message</button>`;
    bindUserActionButtons(previewUser.id);
  } else {
    $("#profileInfo").innerHTML = '<div class="profile-loading-card"><span></span><strong>Loading profile...</strong></div>';
    $("#profileCounters").innerHTML = "";
    $("#profileMainActions").innerHTML = "";
  }
  const previewFrame = profileFrame(previewUser);
  $("#profileFrameOverlay").classList.toggle("active", Boolean(previewFrame));
  $("#profileFrameOverlay").style.backgroundImage = previewFrame ? `url('${profileFrameAssets[previewFrame]}')` : "";
  $("#profileAbout").innerHTML = previewUser ? `<div class="profile-overview-card"><h3>About ${html(displayName(previewUser))}</h3><p>${html(previewUser.aboutMe || previewUser.bio || "This profile is still being decorated.")}</p></div>` : "";
  $("#profileIntel").innerHTML = "";
  $("#profileIntelTabButton")?.classList.add("hidden");
  $("#profileWall").innerHTML = '<div class="profile-loading-card"><span></span><strong>Wall loads when opened</strong></div>';
  $("#profileCornerActions").innerHTML = '<button data-close-profile title="Close" type="button">x</button>';
  $("[data-close-profile]")?.addEventListener("click", () => $("#profileModal").close());
  if (!$("#profileModal").open) $("#profileModal").showModal();
  const cached = state.profileCache.get(Number(userId));
  let data;
  try {
    data = cached && Date.now() - cached.at < 20000 ? cached.data : await api(`/api/social/profiles/${userId}`);
  } catch (error) {
    if (error.code === "DEVELOPER_PROFILE_HIDDEN") $("#profileModal")?.close();
    else if (requestId === state.profileRequestId) $("#profileInfo").innerHTML = `<p class="muted">${html(error.message)}</p>`;
    toast(error.message);
    return false;
  }
  if (requestId !== state.profileRequestId) return;
  state.profileCache.set(Number(userId), { data, at: Date.now() });
  const user = data.user;
  if (isSystemBot(user)) return;
  const self = Number(user.id) === Number(state.me.id);
  const info = levelInfo(user.xp);
  const accent = user.profileAccent || "#ef4444";
  $("#profileModal").style.setProperty("--profile-accent", accent);
  $("#profileCover").style.setProperty("--profile-banner", `url('${user.bannerUrl || "/assets/profile-banner.svg"}')`);
  const profileAvatarSrc = user.avatarUrl || `/assets/avatar-${user.gender || "other"}.svg`;
  $("#profileAvatar").src = profileAvatarSrc;
  $("#profileAvatar").dataset.zoomSrc = profileAvatarSrc;
  $("#profileAvatar").classList.add("zoomable-image");
  const selectedFrame = profileFrame(user);
  $("#profileFrameOverlay").classList.toggle("active", Boolean(selectedFrame));
  $("#profileFrameOverlay").style.backgroundImage = selectedFrame ? `url('${profileFrameAssets[selectedFrame]}')` : "";
  $("#profileStatusDot").classList.toggle("offline", !user.online);
  $("#profileName").textContent = displayName(user);
  $("#profileHandle").textContent = `@${user.username.toLowerCase()}`;
  $("#profileRankLine").innerHTML = profileRankLine(user, info.level);
  $("#profileQuote").textContent = user.bio || "New to the town. Profile story coming soon.";
  $("#profileCounters").innerHTML = `
    <span class="profile-metric"><b>★</b><strong>Level ${info.level}</strong></span>
    ${self
      ? `<span class="profile-metric"><b>👍</b><strong>${compactNumber(data.likeCount || user.profileLikes || 0)} Likes</strong></span>`
      : `<button class="profile-metric like-toggle ${data.likedByMe ? "active" : ""}" data-toggle-profile-like="${user.id}" type="button"><b>👍</b><strong>${compactNumber(data.likeCount || user.profileLikes || 0)} ${data.likedByMe ? "Liked" : "Likes"}</strong></button>`}
  `;
  $("#profileCornerActions").innerHTML = self
    ? `<button data-own-action="edit" title="Edit profile" type="button"><svg viewBox="0 0 24 24"><path d="m4 16-.8 4 4-.8L18.7 7.7l-3.2-3.2L4 16Zm16-10.5a1.5 1.5 0 0 0 0-2.1l-.4-.4a1.5 1.5 0 0 0-2.1 0l-.8.8L19.2 6l.8-.5Z"/></svg></button><button data-close-profile title="Cancel" type="button"><svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2.4" d="m6 6 12 12M18 6 6 18"/></svg></button>`
    : `<button data-open-profile-actions="${user.id}" title="More" type="button"><svg viewBox="0 0 24 24"><path d="M6 12a2 2 0 1 0-4 0 2 2 0 0 0 4 0Zm8 0a2 2 0 1 0-4 0 2 2 0 0 0 4 0Zm8 0a2 2 0 1 0-4 0 2 2 0 0 0 4 0Z"/></svg></button><button data-close-profile title="Cancel" type="button"><svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2.4" d="m6 6 12 12M18 6 6 18"/></svg></button>`;
  $("#profileMainActions").innerHTML = self
    ? `<button class="primary" data-own-action="edit" type="button">Edit Profile</button>`
    : `<button class="primary" data-pm-user="${user.id}" type="button">Message</button>${state.friends.some((item) => Number(item.id || item.friend_id) === Number(user.id)) ? `<button data-remove-friend-action="${user.id}" type="button">Remove Friend</button>` : `<button data-add-friend="${user.id}" type="button">Add Friend</button>`}`;
  $("#profileInfo").innerHTML = profileOverviewPanel(user);
  const quizStats = data.quizStats || {};
  $("#profileAbout").innerHTML = `<div class="profile-overview-card profile-about-card"><span class="eyebrow">Profile story</span><h3>About ${html(displayName(user))}</h3><p>${html(user.aboutMe || user.bio || "This profile is still being decorated.")}</p><div class="profile-stat-grid"><article><span>Level</span><strong>${info.level}</strong></article><article><span>Likes</span><strong>${compactNumber(data.likeCount || user.profileLikes || 0)}</strong></article></div><section class="quiz-profile-stats"><article><span>Quiz score</span><strong>${compactNumber(quizStats.quiz_score || 0)}</strong></article><article><span>Correct</span><strong>${compactNumber(quizStats.quiz_correct_answers || 0)}</strong></article><article><span>Accuracy</span><strong>${Number(quizStats.quiz_accuracy || 0)}%</strong></article><article><span>Best streak</span><strong>${compactNumber(quizStats.quiz_best_streak || 0)}</strong></article><article><span>Fastest</span><strong>${quizStats.quiz_fastest_answer_ms ? `${(Number(quizStats.quiz_fastest_answer_ms) / 1000).toFixed(2)}s` : "--"}</strong></article><article><span>Matches won</span><strong>${compactNumber(quizStats.quiz_matches_won || 0)}</strong></article><article><span>Contests</span><strong>${compactNumber(quizStats.quiz_tournaments_played || 0)}</strong></article><article><span>Titles</span><strong>${compactNumber(quizStats.quiz_tournaments_won || 0)}</strong></article></section></div>`;
  const canViewIntel = Boolean(state.me?.rank === "developer" || state.permissions?.viewUserIntel) && !self;
  $("#profileIntelTabButton")?.classList.toggle("hidden", !canViewIntel);
  $("#profileIntel").innerHTML = canViewIntel ? '<div class="profile-loading-card"><span></span><strong>Open this tab to load staff intelligence</strong></div>' : "";
  $("#profileWall").innerHTML = '<div class="profile-loading-card"><span></span><strong>Open this tab to load the wall</strong></div>';
  $$(".profile-tabs button").forEach((button) => button.classList.toggle("active", button.dataset.profileTab === "info"));
  $$(".profile-tab").forEach((panel) => panel.classList.remove("active"));
  $("#profileInfo").classList.add("active");
  $$("[data-open-profile-actions]").forEach((button) => button.addEventListener("click", () => openProfileActionsDrawer(Number(button.dataset.openProfileActions), user)));
  $$("[data-close-profile]").forEach((button) => button.addEventListener("click", () => $("#profileModal").close()));
  $$("[data-toggle-profile-like]").forEach((button) => button.addEventListener("click", async () => {
    const result = await api(`/api/social/profiles/${button.dataset.toggleProfileLike}/like`, { method: "POST" });
    state.profileCache.delete(Number(user.id));
    toast(result.liked ? "Profile liked." : "Profile unliked.");
    await openProfile(user.id);
  }));
  bindProfileSocialActions(user.id);
  bindUserActionButtons(user.id);
  return true;
}

function updateXoGameSmooth(game) {
  const root = $("#gamesHub");
  const arena = $(".xo-arena", root);
  if (!arena || Number(arena.dataset.xoGame) !== Number(game.id) || arena.dataset.xoGameStatus !== "playing" || game.status !== "playing") {
    paintXoGame(game);
    return;
  }
  const board = String(game.board || "---------").padEnd(9, "-").slice(0, 9).split("");
  const myTurn = Number(game.turn_user_id) === Number(state.me?.id);
  $$("[data-xo-cell]", root).forEach((cell) => {
    const value = board[Number(cell.dataset.xoCell)];
    cell.textContent = value === "-" ? "" : value;
    cell.classList.toggle("played", value !== "-");
    cell.disabled = !myTurn || value !== "-";
  });
  const status = $("[data-xo-status]", root);
  if (status) status.textContent = xoStatusText(game);
}

async function loadProfileIntel(userId) {
  const panel = $("#profileIntel");
  if (!panel) return;
  panel.innerHTML = '<div class="profile-loading-card"><span></span><strong>Loading protected account intelligence...</strong></div>';
  const intel = await api(`/api/admin/users/${Number(userId)}/intel`, { cache: "no-store" });
  panel.innerHTML = `<section class="profile-intel-card"><div><span class="eyebrow">Staff-only evidence</span><h3>Account intelligence</h3><p>Use this information only for safety investigations and documented moderation.</p></div><div class="profile-detail-bubbles"><article><span>IP address</span><strong>${html(intel.ip)}</strong></article><article><span>City / State</span><strong>${html(`${intel.city} / ${intel.region}`)}</strong></article><article><span>Country</span><strong>${html(intel.country)}</strong></article><article><span>Network provider</span><strong>${html(intel.provider)}</strong></article><article><span>Last online</span><strong>${html(formatFullDateTime(intel.lastSeen))}</strong></article><article><span>Account created</span><strong>${html(formatFullDateTime(intel.createdAt))}</strong></article></div></section>`;
}

function compactNumber(value) {
  return new Intl.NumberFormat([], { notation: "compact", maximumFractionDigits: 1 }).format(Number(value || 0));
}

function profileOverviewPanel(user) {
  const details = [];
  if (user.showOnlineStatus !== false && user.profileStatus) details.push(["Status", user.profileStatus]);
  if (user.showGender !== false && user.gender) details.push(["Gender", user.gender]);
  if (user.showAge !== false && user.age) details.push(["Age", `${user.age} years`]);
  if (user.showCountry !== false && user.country) details.push(["Country", user.country]);
  if (user.showOnlineStatus !== false && user.lastSeen) details.push(["Last online", formatFullDateTime(user.lastSeen)]);
  details.push(["Member since", formatDate(user.createdAt)]);
  return `
    <div class="profile-detail-bubbles">
      ${details.map(([label, value]) => `<article><span>${html(label)}</span><strong>${html(value)}</strong></article>`).join("")}
    </div>
  `;
}

function profileBadgesPanel(data) {
  return `
    <section class="profile-section flush">
      <h3>Badges and gifts</h3>
      <div class="profile-badge-grid">
        ${data.badges.map((badge) => `<span style="--rank-color:${html(badge.badge_color)}">${html(badge.title)}</span>`).join("") || '<p class="muted">No badges yet.</p>'}
      </div>
      <div class="gift-strip">${(data.gifts || []).map((gift) => `<span class="gift-token" title="From ${html(gift.from_username)}">${html(gift.title)}</span>`).join("") || '<span class="muted">No gifts yet.</span>'}</div>
    </section>
  `;
}

function profileWallPanel(user, wall = []) {
  const self = Number(user.id) === Number(state.me.id);
  return `
    <section class="profile-section profile-social-section">
      <div class="profile-section-heading"><div><span class="eyebrow">Friends wall</span><h3>Leave a note for ${html(displayName(user))}</h3></div><span>${wall.length} posts</span></div>
      <form class="wall-form" data-wall-form="${user.id}">
        <input name="body" maxlength="500" placeholder="Write something kind..." />
        <button class="primary" type="submit">Post</button>
      </form>
      <div class="wall-list">
        ${wall.map((post) => `
          <article class="wall-post">
            <img class="avatar" src="${html(post.avatar_url || "/assets/avatar-other.svg")}" alt="" loading="lazy" decoding="async" />
            <div>
              <strong>${html(post.display_name || post.username)}</strong>
              <p>${html(post.body)}</p>
              <small>${formatDate(post.created_at)} ${formatTime(post.created_at)}</small>
              <div class="mini-actions">
                ${Number(post.author_id) !== Number(state.me.id) ? `<button data-report-wall="${post.id}" data-wall-user="${post.author_id}" type="button">Report</button>` : ""}
                ${(Number(post.author_id) === Number(state.me.id) || Number(user.id) === Number(state.me.id) || staffRanks.has(state.me.rank)) ? `<button data-delete-wall="${post.id}" type="button">Delete</button>` : ""}
              </div>
            </div>
          </article>
        `).join("") || '<p class="muted">No wall posts yet.</p>'}
      </div>
    </section>
  `;
}

function profileGalleryPanel(user, gallery = []) {
  const self = Number(user.id) === Number(state.me.id);
  return `
    <section class="profile-section profile-social-section">
      <div class="profile-section-heading"><div><span class="eyebrow">Gallery</span><h3>${html(displayName(user))}'s moments</h3></div><span>${gallery.length} photos</span></div>
      ${self ? `<form class="gallery-form" id="galleryForm"><label class="gallery-drop">Choose photo<input id="galleryUpload" type="file" accept="image/*" /></label><input name="caption" maxlength="180" placeholder="Add a caption" /><button class="primary" type="submit">Upload</button></form>` : ""}
      <div class="gallery-grid">
        ${gallery.map((item) => `<figure><img src="${html(item.image_url)}" data-zoom-src="${html(item.image_url)}" alt="${html(item.caption || "Gallery photo")}" loading="lazy" decoding="async" /><figcaption>${html(item.caption || "Untitled moment")}</figcaption>${self ? `<button data-delete-gallery="${item.id}" type="button">Remove</button>` : ""}</figure>`).join("") || '<div class="profile-empty-feature"><strong>No photos yet</strong><span>The first memory will appear here.</span></div>'}
      </div>
    </section>
  `;
}

async function loadProfileSection(userId, section, { force = false } = {}) {
  if (!["wall", "gallery"].includes(section)) return;
  const key = `${Number(userId)}:${section}`;
  const panel = $(`#profile${section[0].toUpperCase()}${section.slice(1)}`);
  const profileData = state.profileCache.get(Number(userId))?.data;
  const user = profileData?.user || userById(userId) || (Number(userId) === Number(state.me?.id) ? state.me : null);
  if (!panel || !user) return;
  const cached = state.profileSocialCache.get(key);
  if (!force && cached && Date.now() - cached.at < 20000) {
    panel.innerHTML = section === "wall" ? profileWallPanel(user, cached.data.wall || []) : profileGalleryPanel(user, cached.data.gallery || []);
    bindProfileSocialActions(userId);
    return;
  }
  panel.innerHTML = '<div class="profile-loading-card"><span></span><strong>Loading...</strong></div>';
  const data = await api(`/api/social/profiles/${userId}/social?section=${section}`, force ? { cache: "no-store" } : {});
  state.profileSocialCache.set(key, { data, at: Date.now() });
  panel.innerHTML = section === "wall" ? profileWallPanel(user, data.wall || []) : profileGalleryPanel(user, data.gallery || []);
  bindProfileSocialActions(userId);
}

function bindProfileSocialActions(userId) {
  $("[data-wall-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = new FormData(event.currentTarget).get("body");
    if (!String(body || "").trim()) return toast("Write something for the wall.");
    await api(`/api/social/profiles/${userId}/wall`, { method: "POST", body: JSON.stringify({ body }) });
    toast("Wall post saved.");
    state.profileSocialCache.delete(`${Number(userId)}:wall`);
    await loadProfileSection(userId, "wall", { force: true });
  });
  $("#galleryForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = $("#galleryUpload").files[0];
    if (!file) return toast("Choose a gallery image.");
    const form = new FormData(event.currentTarget);
    form.set("image", file);
    await api("/api/social/profiles/me/gallery", { method: "POST", body: form });
    toast("Gallery image uploaded.");
    state.profileSocialCache.delete(`${Number(userId)}:gallery`);
    await loadProfileSection(userId, "gallery", { force: true });
  });
  $$("[data-report-wall]").forEach((button) => button.addEventListener("click", () => openReportModal({
    targetType: "wall",
    targetUserId: button.dataset.wallUser,
    wallPostId: button.dataset.reportWall,
    label: `wall post #${button.dataset.reportWall}`,
  })));
  $$("[data-delete-wall]").forEach((button) => button.addEventListener("click", async () => {
    if (!confirm("Delete this wall post?")) return;
    await api(`/api/social/wall-posts/${button.dataset.deleteWall}`, { method: "DELETE" });
    state.profileSocialCache.delete(`${Number(userId)}:wall`);
    await loadProfileSection(userId, "wall", { force: true });
  }));
  $$("[data-delete-gallery]").forEach((button) => button.addEventListener("click", async () => {
    if (!confirm("Delete this gallery image?")) return;
    await api(`/api/social/gallery/${button.dataset.deleteGallery}`, { method: "DELETE" });
    state.profileSocialCache.delete(`${Number(userId)}:gallery`);
    await loadProfileSection(userId, "gallery", { force: true });
  }));
}

function updateStatusPreview(status = "Online") {
  const preview = $("#statusPreview");
  if (!preview) return;
  const label = String(status || "Online");
  preview.dataset.status = presenceKey(label);
  $("strong", preview).textContent = label;
  $("small", preview).textContent = label === "Invisible" ? "Hidden from the online list" : "Shown beside your name";
}

function clearEditGallerySelection() {
  if (state.editGalleryPreviewUrl) URL.revokeObjectURL(state.editGalleryPreviewUrl);
  state.editGalleryPreviewUrl = "";
  const input = $("#editGalleryUpload");
  const caption = $("#editGalleryCaption");
  const drop = $("#editGalleryDrop");
  if (input) input.value = "";
  if (caption) caption.value = "";
  drop?.classList.remove("has-preview");
  drop?.style.removeProperty("--edit-gallery-preview");
  const title = $("strong", drop);
  const help = $("small", drop);
  if (title) title.textContent = "Choose a photo";
  if (help) help.textContent = "JPG, PNG, GIF, or WebP up to 4 MB";
}

function paintEditProfileGallery(gallery = []) {
  const grid = $("#editGalleryGrid");
  if (!grid) return;
  grid.innerHTML = gallery.map((item) => `
    <figure>
      <img src="${html(item.image_url || item.imageUrl)}" data-zoom-src="${html(item.image_url || item.imageUrl)}" alt="${html(item.caption || "Gallery photo")}" loading="lazy" decoding="async" />
      <figcaption>${html(item.caption || "Untitled moment")}</figcaption>
      <button data-edit-gallery-delete="${item.id}" type="button">Remove</button>
    </figure>
  `).join("") || '<div class="edit-gallery-empty">Your gallery is ready for its first photo.</div>';
}

async function loadEditProfileGallery({ force = false } = {}) {
  const grid = $("#editGalleryGrid");
  if (!grid || !state.me?.id) return;
  const key = `${Number(state.me.id)}:gallery`;
  const cached = state.profileSocialCache.get(key);
  if (!force && cached && Date.now() - cached.at < 20000) {
    paintEditProfileGallery(cached.data.gallery || []);
    return;
  }
  grid.innerHTML = '<div class="edit-gallery-loading">Loading your gallery...</div>';
  const data = await api(`/api/social/profiles/${state.me.id}/social?section=gallery`, force ? { cache: "no-store" } : {});
  state.profileSocialCache.set(key, { data, at: Date.now() });
  paintEditProfileGallery(data.gallery || []);
}

function actionButtons(userId, rank) {
  const self = Number(userId) === Number(state.me.id);
  const friend = state.friends.some((item) => Number(item.id || item.friend_id) === Number(userId));
  const blocked = state.blocks.some((item) => Number(item.blocked_id) === Number(userId));
  if (self) {
    return `
      <div class="action-list profile-options">
        <button data-own-action="level">Level info</button>
        <button data-own-action="wallet">Wallet</button>
        <button data-own-action="edit">Edit profile</button>
        <button data-own-action="username">Edit username</button>
        <button data-own-action="about">Edit about me</button>
        <button data-own-action="mood">Edit mood</button>
        <button data-own-action="colors">Username and text color</button>
        <button data-own-action="theme">Theme settings</button>
        <button data-own-action="friends">Manage friends</button>
        <button data-own-action="privacy">Privacy and ignores</button>
        <button data-own-action="password">Change password</button>
        <button data-own-action="delete">Delete account</button>
        <button data-own-action="logout">Logout</button>
      </div>
    `;
  }
  return `
    <div class="action-list">
      <button data-view-profile="${userId}">View profile</button>
      <button data-pm-user="${userId}">Private</button>
      ${friend ? `<button data-remove-friend-action="${userId}">Remove friend</button>` : `<button data-add-friend="${userId}">Add friend</button>`}
      <button data-follow="${userId}">Follow</button>
      <button data-like-profile="${userId}">Like profile</button>
      <button data-gift="${userId}">Send gift</button>
      <button data-share-wallet="${userId}">Share wallet</button>
      ${blocked ? `<button data-unblock-action="${userId}">Unblock</button>` : `<button data-block="${userId}">Block</button>`}
      <button data-report-user="${userId}">Report</button>
      ${staffRanks.has(state.me.rank) ? `<button data-staff-action="${userId}" data-rank="${rank}">Staff action</button>` : ""}
    </div>
  `;
}

function closeProfileActionsOverlay() {
  const overlay = $("#profileActionOverlay");
  if (!overlay) return;
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = "";
  overlay.onclick = null;
}

function openProfileActionsDrawer(userId, fallbackUser = null) {
  const user = fallbackUser || userById(userId);
  if (!user) return toast("Profile actions are still loading. Try again.");
  if (isSystemBot(user)) return;
  const overlay = $("#profileActionOverlay");
  if (!overlay) return toast("Profile actions could not open.");
  const friend = state.friends.some((item) => Number(item.id || item.friend_id) === Number(userId));
  const blocked = state.blocks.some((item) => Number(item.blocked_id) === Number(userId));
  const canActOnUser = canControlRank(user.rank);
  const staffToolsForUser = ["warn", "mute", "kick", "ban", "deleteAccount"].filter((tool) => hasTool(tool));
  const canStaff = staffRanks.has(state.me.rank) && canActOnUser && staffToolsForUser.length > 0;
  const canEdit = canUseProfileEditTool() && canActOnUser;
  const canChangeRank = staffRanks.has(state.me.rank)
    && hasTool("changeRank")
    && canActOnUser
    && (state.me.rank === "developer" || user.rank !== "premium");
  const rankChoices = assignableRanks.filter((rank) => canControlRank(rank) && (state.me.rank === "developer" || rank !== "premium"));
  const tabs = [
    ["global", "Global"],
    ...(canStaff ? [["staff", "Staff"]] : []),
    ...(canChangeRank ? [["rank", "Rank"]] : []),
    ...(canEdit ? [["edit", "Edit"]] : []),
  ];
  overlay.innerHTML = `
    <div class="profile-action-menu-card" role="dialog" aria-label="Profile actions">
      <div class="profile-action-head">
        <img class="avatar" src="${html(avatar(user))}" alt="" />
        <strong>${html(displayName(user))}</strong>
        <button class="profile-action-close" data-close-profile-actions title="Close" type="button">x</button>
      </div>
      <div class="action-tabs">
        ${tabs.map(([key, label], index) => `<button class="${index === 0 ? "active" : ""}" data-profile-action-tab="${key}" type="button">${label}</button>`).join("")}
      </div>
      <div class="profile-action-panel active" data-profile-action-panel="global">
        <div class="profile-action-list">
          <button data-pm-user="${user.id}" type="button"><span class="action-icon">P</span><span>Private</span></button>
          ${friend ? `<button data-remove-friend-action="${user.id}" type="button"><span class="action-icon">F</span><span>Remove friend</span></button>` : `<button data-add-friend="${user.id}" type="button"><span class="action-icon">F</span><span>Add friend</span></button>`}
          <button data-gift="${user.id}" type="button"><span class="action-icon">G</span><span>Send gift</span></button>
          <button data-share-wallet="${user.id}" type="button"><span class="action-icon">W</span><span>Share wallet</span></button>
          ${blocked ? `<button data-unblock-action="${user.id}" type="button"><span class="action-icon danger">I</span><span>Unignore</span></button>` : `<button data-block="${user.id}" type="button"><span class="action-icon danger">I</span><span>Ignore</span></button>`}
        </div>
      </div>
      ${canStaff ? `
        <div class="profile-action-panel" data-profile-action-panel="staff">
          <div class="staff-quick-tools">
            <h3>Staff</h3>
            <p class="muted">Choose an action. You will confirm its message, reason, and duration next.</p>
            <div class="moderation-action-grid">
              ${hasTool("warn") ? '<button data-profile-moderation="warn" type="button"><b>!</b><span>Warn<small>Written warning</small></span></button>' : ""}
              ${hasTool("mute") ? '<button data-profile-moderation="mute" type="button"><b>M</b><span>Mute<small>Disable messaging</small></span></button>' : ""}
              ${hasTool("kick") ? '<button data-profile-moderation="kick" type="button"><b>K</b><span>Kick<small>Timed removal</small></span></button>' : ""}
              ${hasTool("ban") ? '<button class="danger-action" data-profile-moderation="ban" type="button"><b>B</b><span>Ban<small>Permanent block</small></span></button>' : ""}
            </div>
            <div class="modal-action-row moderation-reversal-row">
              ${user.mutedUntil && new Date(user.mutedUntil) > new Date() ? '<button data-profile-reverse="unmute" type="button">Unmute</button>' : ""}
              ${user.kickedUntil && new Date(user.kickedUntil) > new Date() ? '<button data-profile-reverse="unkick" type="button">Unkick</button>' : ""}
              ${user.bannedUntil && new Date(user.bannedUntil) > new Date() ? '<button data-profile-reverse="unban" type="button">Unban</button>' : ""}
            </div>
          </div>
        </div>
      ` : ""}
      ${canChangeRank ? `
        <div class="profile-action-panel" data-profile-action-panel="rank">
          <form class="profile-rank-tool-card" data-change-user-rank="${user.id}">
            <h3>Rank</h3>
            <p class="muted">Assign an allowed rank to ${html(displayName(user))}.</p>
            <label>Rank<select name="rank">${rankChoices.map((rank) => `<option value="${rank}" ${rank === user.rank ? "selected" : ""}>${rank}</option>`).join("")}</select></label>
            <button class="primary" type="submit">Save rank</button>
          </form>
        </div>
      ` : ""}
      ${canEdit ? `
        <div class="profile-action-panel" data-profile-action-panel="edit">
          <form class="profile-edit-tool-card" data-edit-username="${user.id}">
            <label>Edit username<input name="username" value="${html(user.username)}" maxlength="18" required /></label>
            <button type="submit">Save username</button>
          </form>
          <div class="profile-edit-tool-card">
            <button data-profile-edit="deleteAvatar" data-profile-edit-user="${user.id}" type="button">Delete pfp</button>
            <button data-profile-edit="password" data-profile-edit-user="${user.id}" type="button">Change password</button>
            <button data-profile-edit="deleteAccount" data-profile-edit-user="${user.id}" class="danger-action" type="button">Delete account</button>
          </div>
        </div>
      ` : ""}
    </div>
  `;
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  overlay.onclick = (event) => {
    if (event.target === overlay) closeProfileActionsOverlay();
  };
  $("[data-close-profile-actions]", overlay)?.addEventListener("click", closeProfileActionsOverlay);
  bindUserActionButtons(user.id);
  $$("[data-profile-action-tab]", overlay).forEach((button) => button.addEventListener("click", () => {
    $$("[data-profile-action-tab]", overlay).forEach((tab) => tab.classList.toggle("active", tab === button));
    $$("[data-profile-action-panel]", overlay).forEach((panel) => panel.classList.toggle("active", panel.dataset.profileActionPanel === button.dataset.profileActionTab));
  }));
  $$("[data-profile-moderation]", overlay).forEach((button) => button.addEventListener("click", () => {
    closeProfileActionsOverlay();
    if ($("#profileModal").open) $("#profileModal").close();
    openModerationComposer(user, button.dataset.profileModeration);
    if (!$("#userActionModal").open) $("#userActionModal").showModal();
  }));
  $$("[data-profile-reverse]", overlay).forEach((button) => button.addEventListener("click", () => moderate(user.id, button.dataset.profileReverse)));
  $("[data-edit-username]", overlay)?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = new FormData(event.currentTarget).get("username");
    await profileEditAction(user.id, "username", { username });
  });
  $$("[data-profile-edit]", overlay).forEach((button) => button.addEventListener("click", async () => {
    const action = button.dataset.profileEdit;
    if (action === "password") {
      const password = prompt(`New password for ${displayName(user)}`);
      if (!password) return;
      await profileEditAction(user.id, "password", { password });
      return;
    }
    if (action === "deleteAvatar" && !confirm(`Delete ${displayName(user)}'s profile picture?`)) return;
    if (action === "deleteAccount" && !confirm(`Delete ${displayName(user)}'s account permanently?`)) return;
    await profileEditAction(user.id, action);
  }));
  $("[data-change-user-rank]", overlay)?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const rank = String(new FormData(event.currentTarget).get("rank") || "");
    await api(`/api/admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ rank }) });
    closeProfileActionsOverlay();
    toast(`${displayName(user)} is now ${rank}.`);
    await bootstrap();
  });
}

function openUserActions(userId) {
  const user = userById(userId);
  if (!user) return;
  if (isSystemBot(user)) return;
  const self = Number(user.id) === Number(state.me.id);
  setDrawerChrome({ title: "Profile", user: true });
  $("#drawerBody").innerHTML = `
    <div class="user-slide-card">
      <div class="user-slide-cover" style="background-image:linear-gradient(180deg,rgba(12,5,36,.08),rgba(43,16,99,.92)),url('${html(user.bannerUrl || "/assets/profile-banner.svg")}')">
        <span class="user-slide-score">${compactNumber(user.gold || 0)}</span>
        <img src="${html(avatar(user))}" alt="" />
        <h2>${html(displayName(user))}</h2>
        <p>${user.age ? `${user.age} years` : "Town member"} ${user.gender ? `- ${html(user.gender)}` : ""}</p>
      </div>
      <div class="user-slide-actions">
        <button data-view-profile="${user.id}" type="button"><span>View profile</span></button>
        ${self
          ? `<button data-own-action="edit" type="button"><span>Edit profile</span></button>`
          : `<button data-pm-user="${user.id}" type="button"><span>Private</span></button>
             <button data-like-profile="${user.id}" type="button"><span>Like</span></button>`}
      </div>
    </div>
  `;
  bindUserActionButtons(user.id);
  showDrawer();
}

function openUserActionPanel(userId) {
  const user = userById(userId);
  if (!user) return;
  if (isSystemBot(user)) return;
  const friend = state.friends.some((item) => Number(item.id || item.friend_id) === Number(userId));
  const blocked = state.blocks.some((item) => Number(item.blocked_id) === Number(userId));
  setDrawerChrome({ title: "Action", user: true });
  $("#drawerBody").innerHTML = `
    <div class="action-panel-card">
      <div class="action-panel-head">
        <img class="avatar" src="${html(avatar(user))}" alt="" />
        <div><h2>${html(displayName(user))}</h2>${userRankBadge(user)}</div>
      </div>
      <section class="action-panel-section">
        <h3>Social</h3>
        ${friend ? `<button data-remove-friend-action="${user.id}" type="button">Remove friend</button>` : `<button data-add-friend="${user.id}" type="button">Add friend</button>`}
        ${blocked ? `<button data-unblock-action="${user.id}" type="button">Unblock</button>` : `<button data-block="${user.id}" type="button">Block</button>`}
        <button data-report-user="${user.id}" type="button">Report</button>
      </section>
      ${staffRanks.has(state.me.rank) && canControlRank(user.rank) ? `
        <section class="action-panel-section">
          <h3>Moderation tools</h3>
          <textarea id="staffReason" placeholder="Reason or note"></textarea>
          <button data-mod="warn" type="button">Warn</button>
          <div class="compact-row"><button data-mod="mute" data-minutes="2" type="button">Mute 2m</button><button data-mod="mute" data-minutes="10" type="button">Mute 10m</button><button data-mod="mute" data-minutes="60" type="button">Mute 1h</button></div>
          <div class="compact-row"><button data-mod="kick" data-minutes="2" type="button">Kick 2m</button><button data-mod="kick" data-minutes="10" type="button">Kick 10m</button><button data-mod="kick" data-minutes="2880" type="button">Kick 2d</button></div>
          <button data-mod="ban" class="danger-action" type="button">Ban</button>
        </section>
        <section class="action-panel-section">
          <h3>Edit user</h3>
          <input id="staffEditName" value="${html(user.username)}" placeholder="Username" />
          <input id="staffEditMood" value="${html(user.mood || "")}" placeholder="Mood" />
          <input id="staffEditAvatar" value="${html(user.avatarUrl || "")}" placeholder="Avatar URL" />
          <input id="staffEditBanner" value="${html(user.bannerUrl || "")}" placeholder="Banner URL" />
          <select id="staffEditRank">${assignableRanks.map((rank) => `<option value="${rank}" ${rank === user.rank ? "selected" : ""}>${rank}</option>`).join("")}</select>
          <button id="staffSaveUser" type="button">Save user edits</button>
          <button data-mod="delete" class="danger-action" type="button">Delete account</button>
        </section>
      ` : ""}
    </div>
  `;
  bindUserActionButtons(user.id);
  $$("[data-mod]").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.mod;
    if (action === "delete" && !confirm("Delete this account permanently?")) return;
    if (action === "ban" && !confirm("Permanently ban this account?")) return;
    moderate(user.id, action, { minutes: Number(button.dataset.minutes || 0), reason: $("#staffReason")?.value.trim() || "" });
  }));
  $("#staffSaveUser")?.addEventListener("click", async () => {
    await api(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        username: $("#staffEditName").value.trim(),
        mood: $("#staffEditMood").value.trim(),
        avatarUrl: $("#staffEditAvatar").value.trim(),
        bannerUrl: $("#staffEditBanner").value.trim(),
        rank: $("#staffEditRank").value,
      }),
    });
    toast("User updated.");
    $("#drawer").classList.add("hidden");
    await bootstrap();
  });
  showDrawer();
}

async function openDeveloperToolsPanel({ force = false } = {}) {
  if (!canManageNews()) return toast("Higher staff access required.");
  setDrawerChrome({ title: "Staff tools" });
  $("#drawerBody").innerHTML = '<p class="muted">Loading tools...</p>';
  showDrawer();
  let data;
  try {
    const cached = !force && state.toolsCache && Date.now() - state.toolsCacheAt < 30000;
    data = cached ? state.toolsCache : await api("/api/admin/tools/summary", force ? { cache: `tools-${Date.now()}` } : {});
    state.toolsCache = data;
    state.toolsCacheAt = Date.now();
  } catch (error) {
    $("#drawerBody").innerHTML = `<p class="muted">${html(error.message || "Tools could not be loaded.")}</p>`;
    toast(error.message || "Tools could not be loaded.");
    return;
  }
  const intruder = data.tools?.intruder;
  const intruderNext = intruder?.nextSpawnAt ? `${formatDate(intruder.nextSpawnAt)} ${formatTime(intruder.nextSpawnAt)}` : "Stopped";
  const intruderActive = intruder?.activeRound ? `Active now | ${compactNumber(intruder.activeRound.points)} pts` : "No active round";
  const toolUsers = [state.me, ...state.users.filter((user) => Number(user.id) !== Number(state.me.id))];
  $("#drawerBody").innerHTML = `
    <div class="developer-tools-drawer">
      <article class="tool-card news-maintenance-card">
        <div class="tool-card-head">
          <span class="tool-avatar">N</span>
          <span><strong>News maintenance</strong><small>Remove all Town News posts and their comments.</small></span>
        </div>
        <div class="tool-actions">
          <button id="drawerClearNewsButton" class="danger-action" type="button">Clear news section</button>
        </div>
      </article>
      <article class="tool-card intruder-tool-card ${intruder ? "" : "hidden"}">
        <div class="tool-card-head">
          <img class="avatar avatar-lg" src="${html(intruder?.botAvatarUrl || "/assets/intruder-bot.png")}" alt="" />
          <span><strong>${html(intruder?.botName || "Intruder")}</strong><small>${intruder?.enabled ? "Running" : "Stopped"} | ${html(intruderActive)}</small></span>
        </div>
        <form id="drawerIntruderToolsForm" class="tool-form">
          <div class="tool-range-grid">
            <label>Bot name<input id="drawerIntruderName" maxlength="40" value="${html(intruder?.botName || "Intruder")}" /></label>
            <label>Avatar URL<input id="drawerIntruderAvatar" maxlength="500" value="${html(intruder?.botAvatarUrl || "/assets/intruder-bot.png")}" /></label>
          </div>
          <div class="tool-range-grid">
            <label>Minimum minutes<input id="drawerIntruderMin" type="number" min="2" max="1440" step="1" value="${html(intruder?.minIntervalMinutes || 2)}" /></label>
            <label>Maximum minutes<input id="drawerIntruderMax" type="number" min="2" max="1440" step="1" value="${html(intruder?.maxIntervalMinutes || 6)}" /></label>
          </div>
          <small>Each next arrival is picked randomly inside this range.</small>
          <small>Next arrival: ${html(intruderNext)}</small>
          ${state.me.rank === "developer" ? `<label class="tool-enable-row"><input data-chief-tool="intruderTool" type="checkbox" ${data.toolAccess?.intruderTool ? "checked" : ""} /> Allow for Chief and Owner</label>` : ""}
          <div class="tool-actions">
            <button class="primary" type="submit">${intruder?.enabled ? "Save" : "Start"}</button>
            <button id="drawerIntruderStopButton" type="button" ${intruder?.enabled ? "" : "disabled"}>Stop</button>
            <button id="drawerIntruderResetButton" class="danger-action" type="button">Reset Top Shooters</button>
          </div>
        </form>
      </article>
      <article class="tool-card ${state.me.rank === "developer" ? "" : "hidden"}">
        <div class="tool-card-head">
          <span class="tool-avatar">E</span>
          <span><strong>Edit profile</strong><small>Allows Chief and Owner to use the Edit tab on lower ranks.</small></span>
        </div>
        <label class="tool-enable-row"><input data-chief-tool="profileEditTool" type="checkbox" ${data.toolAccess?.profileEditTool ? "checked" : ""} /> Allow for Chief and Owner</label>
      </article>
      <article class="tool-card ${state.me.rank === "developer" ? "" : "hidden"}">
        <div class="tool-card-head">
          <span class="tool-avatar">P</span>
          <span><strong>View developer profiles</strong><small>When off, other users cannot open profiles belonging to the hidden internal rank.</small></span>
        </div>
        <label class="tool-enable-row"><input id="developerProfileAccessToggle" type="checkbox" ${data.toolAccess?.developerProfilesVisible ? "checked" : ""} /> Allow profile viewing</label>
      </article>
      <article class="tool-card value-change-card ${state.me.rank === "developer" ? "" : "hidden"}">
        <div class="tool-card-head">
          <span class="tool-avatar">C</span>
          <span><strong>Change user value</strong><small>Private balance, XP, and shooter-score control.</small></span>
        </div>
        <form id="developerValueChangeForm" class="tool-form">
          <label>User<select name="userId" required>${toolUsers.map((user) => `<option value="${user.id}" ${Number(user.id) === Number(state.me.id) ? "selected" : ""}>${html(user.username)}${Number(user.id) === Number(state.me.id) ? " (you)" : ""}</option>`).join("")}</select></label>
          <div class="tool-range-grid">
            <label>Change<select name="field"><option value="gold">Gold</option><option value="diamonds">Diamonds</option><option value="xp">XP</option><option value="shoot">Shoot score</option></select></label>
            <label>Set value<input name="value" type="number" min="0" step="1" value="0" required /></label>
          </div>
          <button class="primary" type="submit">Change</button>
        </form>
      </article>
    </div>
  `;
  $("#drawerClearNewsButton")?.addEventListener("click", async () => {
    if (!confirm("Clear the entire news section? This deletes every news post and comment.")) return;
    const button = $("#drawerClearNewsButton");
    button.disabled = true;
    try {
      const result = await api("/api/social/news", { method: "DELETE" });
      resetNewsCache();
      if ($("#newsView").classList.contains("active")) paintNews([]);
      toast(`${result.deleted || 0} news post${Number(result.deleted) === 1 ? "" : "s"} deleted.`);
    } catch (error) {
      button.disabled = false;
      toast(error.message);
    }
  });
  $$("[data-chief-tool]").forEach((input) => input.addEventListener("change", async () => {
    const enabled = input.checked;
    input.disabled = true;
    try {
      const result = await api("/api/admin/tools/access", { method: "POST", body: JSON.stringify({ tool: input.dataset.chiefTool, enabled }) });
      input.checked = Boolean(result.enabled);
      state.toolsCache = null;
      state.toolsCacheAt = 0;
      toast("Chief and Owner access updated.");
    } catch (error) {
      input.checked = !enabled;
      toast(error.message);
    } finally {
      input.disabled = false;
    }
  }));
  $("#developerProfileAccessToggle")?.addEventListener("change", async (event) => {
    const input = event.currentTarget;
    const enabled = input.checked;
    input.disabled = true;
    try {
      const result = await api("/api/admin/tools/developer-profile-access", { method: "POST", body: JSON.stringify({ enabled }) });
      input.checked = Boolean(result.enabled);
      state.developerProfilesVisible = Boolean(result.enabled);
      state.toolsCache = null;
      state.toolsCacheAt = 0;
      toast(result.enabled ? "Developer profile viewing enabled." : "Developer profiles are private.");
    } catch (error) {
      input.checked = !enabled;
      toast(error.message);
    } finally {
      input.disabled = false;
    }
  });
  $("#drawerIntruderToolsForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const minIntervalMinutes = Number($("#drawerIntruderMin")?.value || 2);
    const maxIntervalMinutes = Number($("#drawerIntruderMax")?.value || 6);
    const botName = $("#drawerIntruderName")?.value.trim();
    const botAvatarUrl = $("#drawerIntruderAvatar")?.value.trim();
    await api("/api/admin/tools/intruder", { method: "POST", body: JSON.stringify({ enabled: true, minIntervalMinutes, maxIntervalMinutes, botName, botAvatarUrl }) });
    toast("Intruder saved.");
    await openDeveloperToolsPanel({ force: true });
  });
  $("#drawerIntruderStopButton")?.addEventListener("click", async () => {
    const minIntervalMinutes = Number($("#drawerIntruderMin")?.value || 2);
    const maxIntervalMinutes = Number($("#drawerIntruderMax")?.value || 6);
    const botName = $("#drawerIntruderName")?.value.trim();
    const botAvatarUrl = $("#drawerIntruderAvatar")?.value.trim();
    await api("/api/admin/tools/intruder", { method: "POST", body: JSON.stringify({ enabled: false, minIntervalMinutes, maxIntervalMinutes, botName, botAvatarUrl }) });
    toast("Intruder stopped.");
    await openDeveloperToolsPanel({ force: true });
  });
  $("#drawerIntruderResetButton")?.addEventListener("click", async () => {
    if (!confirm("Reset Top Shooters to 0?")) return;
    await api("/api/admin/tools/intruder/reset", { method: "POST" });
    toast("Top Shooters reset.");
    await openDeveloperToolsPanel({ force: true });
  });
  $("#developerValueChangeForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    await api("/api/admin/tools/user-values", { method: "POST", body: JSON.stringify(form) });
    toast("User value changed.");
    await bootstrap();
    await openDeveloperToolsPanel({ force: true });
  });
}

function openOwnMenu() {
  const info = levelInfo(state.me.xp);
  const room = state.rooms.find((item) => Number(item.id) === Number(state.currentRoomId));
  setDrawerChrome({ account: true });
  $("#drawerBody").innerHTML = `
    <div class="account-menu-card">
      <div class="account-menu-head">
        <img class="avatar avatar-lg ${html(state.me.frame || "clean")}" src="${html(avatar(state.me))}" alt="" />
        <div>
          ${userRankBadge(state.me)}
          <h2>${html(displayName(state.me))}</h2>
          <button data-own-action="edit" type="button">Edit profile</button>
        </div>
        <span class="account-check">OK</span>
      </div>
      <div class="account-menu-list">
        <button data-own-action="chat-options" type="button"><span class="menu-icon">C</span><strong>Chat options</strong><em>&gt;</em></button>
        <button data-own-action="level" type="button"><span class="menu-icon">L</span><strong>Level info</strong></button>
        <button data-own-action="wallet" type="button"><span class="menu-icon">W</span><strong>Wallet</strong></button>
        <hr />
        <button data-own-action="room-options" type="button"><span class="menu-icon">R</span><strong>Room options</strong><small>${html(room?.name || "Current room")}</small><em>&gt;</em></button>
        ${["admin", "chief", "owner", "developer"].includes(state.me.rank) ? `<button data-open-admin-panel type="button"><span class="menu-icon">A</span><strong>Admin panel</strong></button>` : ""}
        ${canManageNews() ? `<button data-open-tools-panel type="button"><span class="menu-icon">T</span><strong>Tools</strong></button>` : ""}
        <button data-own-action="logout" type="button"><span class="menu-icon">O</span><strong>Logout</strong></button>
      </div>
    </div>
  `;
  showDrawer();
  bindUserActionButtons(state.me.id);
  $("[data-open-admin-panel]")?.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    $("#drawer").classList.add("hidden");
    setView("admin");
    await renderAdmin();
  });
  $("[data-open-tools-panel]")?.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await openDeveloperToolsPanel();
  });
}

function openRoomOptionsPanel() {
  const room = state.rooms.find((item) => Number(item.id) === Number(state.currentRoomId)) || {};
  setDrawerChrome({ title: "Room options" });
  $("#drawerBody").innerHTML = `
    <div class="room-options-card">
      <img src="${html(room.image_url || room.imageUrl || "/assets/room-main.svg")}" alt="" />
      <label>Room name<input value="${html(room.name || "")}" readonly /></label>
      <label>Description<textarea readonly>${html(room.description || "")}</textarea></label>
      <button class="primary" type="button">Room editing UI ready</button>
      <p class="muted">Name, description, and image editing can be connected to staff permissions next.</p>
    </div>
  `;
  showDrawer();
}

function openWalletPanel() {
  setDrawerChrome({ title: "Wallet" });
  $("#drawerBody").innerHTML = `
    <div class="wallet-grid">
      <article class="wallet-card gold"><span>Gold</span><strong>${state.me.gold || 0}</strong><small>Earn 100 gold every 10 texts.</small></article>
      <article class="wallet-card diamond"><span>Diamonds</span><strong>${state.me.diamonds || 0}</strong><small>Earn 3 diamonds every 10 minutes online.</small></article>
      <article class="wallet-card xp"><span>XP</span><strong>${state.me.xp || 0}</strong><small>Every 2 texts gives 1 XP.</small></article>
    </div>
  `;
  showDrawer();
}

function openLevelPanel() {
  const info = levelInfo(state.me.xp);
  const percent = Math.round((info.current / info.next) * 100);
  setDrawerChrome({ title: "Level info" });
  $("#drawerBody").innerHTML = `
    <div class="level-card">
      <div><strong>Level ${info.level}</strong><span>${info.current} / ${info.next} XP</span></div>
      <div class="level-bar"><span style="width:${percent}%"></span></div>
      <div class="request-row"><span>Next level needs</span><strong>${info.next - info.current} XP</strong></div>
      <div class="request-row"><span>Total XP</span><strong>${state.me.xp || 0}</strong></div>
      <div class="request-row"><span>Texts sent</span><strong>${state.me.messageCount || 0}</strong></div>
    </div>
  `;
  showDrawer();
}

function openChatOptionsPanel() {
  const currentBackground = normalizeRoomBackground(state.me?.chatBackground);
  setDrawerChrome({ title: "Chat options" });
  $("#drawerBody").innerHTML = `
    <div class="theme-panel">
      <h3>Room background</h3>
      <p class="muted">Choose the room image shown behind chat.</p>
      <div class="background-choice-grid">
        ${roomBackgroundChoices.map(([id, label, url]) => {
          return `
            <button class="${id === currentBackground ? "active" : ""}" data-room-background="${html(id)}" type="button">
              <span style="background-image:url('${html(url)}')"></span>
              <strong>${html(label)}</strong>
            </button>
          `;
        }).join("")}
      </div>
    </div>
  `;
  showDrawer();
  $$("[data-room-background]").forEach((button) => button.addEventListener("click", async () => {
    const chatBackground = normalizeRoomBackground(button.dataset.roomBackground);
    button.disabled = true;
    try {
      const data = await api("/api/auth/me", { method: "PATCH", body: JSON.stringify({ chatBackground }) });
      state.me = { ...state.me, ...(data.me || {}), chatBackground };
      state.me.chatBackground = normalizeRoomBackground(state.me.chatBackground);
      applyRoomBackground(chatBackground);
      $$("[data-room-background]").forEach((node) => node.classList.toggle("active", node === button));
      toast(`${button.textContent.trim()} background applied.`);
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  }));
}

function openProfileEditor(section = "edit") {
  stopProfileMusic();
  const form = $("#editProfileForm");
  if (form && state.me) {
    const canSetTitle = Boolean(state.permissions?.customTitle || state.me.rank === "developer");
    const canSetStatus = ["premium", "chief", "owner", "developer"].includes(state.me.rank);
    $("[data-title-field]")?.classList.toggle("hidden", !canSetTitle);
    $("[data-status-field]")?.classList.toggle("hidden", !canSetStatus);
    form.profileTitle.disabled = !canSetTitle;
    form.profileStatus.disabled = !canSetStatus;
    form.displayName.value = state.me.displayName || state.me.username || "";
    form.username.value = state.me.username || "";
    form.bio.value = state.me.bio || "";
    form.aboutMe.value = state.me.aboutMe || "";
    form.mood.value = state.me.mood || "";
    form.profileTitle.value = state.me.profileTitle || "";
    form.level.value = levelInfo(state.me.xp).level;
    form.profileStatus.value = state.me.profileStatus || "Online";
    updateStatusPreview(form.profileStatus.value);
    form.profileAccent.value = state.me.profileAccent || "#ef4444";
    form.showOnlineStatus.checked = state.me.showOnlineStatus !== false;
    form.showCountry.checked = state.me.showCountry !== false;
    form.showAge.checked = state.me.showAge !== false;
    form.showGender.checked = state.me.showGender !== false;
    form.usernameColor.value = state.me.usernameColor || "";
    form.textColor.value = state.me.textColor || "";
    form.theme.value = state.me.theme || "dark";
    form.bubbleStyle.value = state.me.bubbleStyle || "default";
    $("#editBannerPreview").style.setProperty("--edit-banner", `url('${state.me.bannerUrl || "/assets/profile-banner.svg"}')`);
    $("#editAvatarPreview").src = avatar(state.me);
    $("#bioCount").textContent = `${form.bio.value.length}/120`;
    $$("[data-accent]").forEach((button) => button.classList.toggle("active", button.dataset.accent === form.profileAccent.value));
  }
  if (!$("#editProfileModal").open) $("#editProfileModal").showModal();
  if (form) form.scrollTop = 0;
  const field = {
    username: "input[name='username']",
    about: "textarea[name='aboutMe']",
    mood: "input[name='mood']",
    colors: "input[name='usernameColor']",
    theme: "select[name='theme']",
  }[section];
  if (field) setTimeout(() => $(field)?.focus(), 80);
}

function openReportModal({ targetType = "user", targetUserId = null, messageId = null, roomId = null, privateMessageId = null, wallPostId = null, label = "user" }) {
  if (targetUserId && Number(targetUserId) === Number(state.me.id)) {
    toast("You cannot report yourself.");
    return;
  }
  $("#userActionBody").innerHTML = `
    <div class="report-card">
      <h2>Report ${html(label)}</h2>
      <p class="muted">Send this to staff with a clear reason. False reports can be ignored by staff.</p>
      <textarea id="reportReason" placeholder="What happened?"></textarea>
      <div class="modal-actions">
        <button class="primary" id="sendReportButton" type="button">Send report</button>
        <button data-close-modal type="button">Cancel</button>
      </div>
    </div>
  `;
  $("#sendReportButton").onclick = async () => {
    const reason = $("#reportReason").value.trim();
    if (!reason) return toast("Please add a report reason.");
    await api("/api/social/reports", {
      method: "POST",
      body: JSON.stringify({ targetType, targetUserId, messageId, roomId, privateMessageId, wallPostId, reason }),
    });
    $("#userActionModal").close();
    toast("Report sent to staff.");
  };
  $$("[data-close-modal]", $("#userActionModal")).forEach((button) => button.addEventListener("click", () => $("#userActionModal").close()));
  if (!$("#userActionModal").open) $("#userActionModal").showModal();
}

function openGiftModal(userId) {
  const user = userById(userId) || { id: userId, username: `User #${userId}` };
  $("#userActionBody").innerHTML = `
    <div class="gift-card">
      <div class="menu-profile">
        <img class="avatar" src="${html(avatar(user))}" alt="" />
        <div><h2>Send gift</h2><p class="muted">To ${html(user.username)} | You have ${state.me.gold || 0} gold</p></div>
      </div>
      <div class="gift-grid">
        ${giftCatalog.map(([code, title, cost]) => `
          <button data-send-gift="${code}" type="button">
            <span class="gift-icon">${code === "rose" ? "R" : code === "crown" ? "C" : code === "diamond" ? "D" : "S"}</span>
            <strong>${title}</strong>
            <small>${cost} gold</small>
          </button>
        `).join("")}
      </div>
    </div>
  `;
  $$("[data-send-gift]").forEach((button) => button.addEventListener("click", async () => {
    await api("/api/social/gifts", { method: "POST", body: JSON.stringify({ toUserId: userId, giftCode: button.dataset.sendGift }) });
    toast("Gift sent.");
    $("#userActionModal").close();
    await bootstrap();
  }));
  if (!$("#userActionModal").open) $("#userActionModal").showModal();
}

function openShareWalletModal(userId) {
  const user = userById(userId) || { id: userId, username: `User #${userId}` };
  $("#userActionBody").innerHTML = `
    <form class="transfer-card" id="walletTransferForm">
      <div class="menu-profile">
        <img class="avatar" src="${html(avatar(user))}" alt="" />
        <div><h2>Share wallet</h2><p class="muted">Send gold or diamonds to ${html(user.username)}</p></div>
      </div>
      <div class="wallet-mini">
        <span>${state.me.gold || 0} gold</span>
        <span>${state.me.diamonds || 0} diamonds</span>
      </div>
      <select name="currency"><option value="gold">Gold</option><option value="diamonds">Diamonds</option></select>
      <input name="amount" type="number" min="1" max="100000" placeholder="Amount" required />
      <input name="note" maxlength="160" placeholder="Optional note" />
      <button class="primary" type="submit">Send wallet</button>
    </form>
  `;
  $("#walletTransferForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/social/wallet-transfers", {
      method: "POST",
      body: JSON.stringify({ toUserId: userId, ...Object.fromEntries(new FormData(event.currentTarget)) }),
    });
    toast("Wallet shared.");
    $("#userActionModal").close();
    await bootstrap();
  });
  if (!$("#userActionModal").open) $("#userActionModal").showModal();
}

async function handleOwnAction(action) {
  if ($("#userActionModal").open) $("#userActionModal").close();
  if (action === "chat-options") return openChatOptionsPanel();
  if (action === "room-options") return openRoomOptionsPanel();
  if (action === "level") return openLevelPanel();
  if (action === "wallet") return openWalletPanel();
  if (["edit", "username", "about", "mood", "colors", "theme"].includes(action)) {
    if ($("#profileModal").open) $("#profileModal").close();
    return openProfileEditor(action);
  }
  if (action === "friends" || action === "privacy") {
    state.userTab = "friends";
    $$("[data-user-tab]").forEach((button) => button.classList.toggle("active", button.dataset.userTab === "friends"));
    renderUsers();
    return;
  }
  if (action === "password") return $("#changePasswordButton").click();
  if (action === "delete") return toast((await api("/api/auth/me/delete-request", { method: "POST" })).message);
  if (action === "logout") return logout();
}

function bindUserActionButtons(userId) {
  const unbound = (selector) => $$(selector).filter((button) => {
    if (button.dataset.userActionBound) return false;
    button.dataset.userActionBound = "1";
    return true;
  });
  unbound("[data-own-action]").forEach((button) => button.addEventListener("click", () => handleOwnAction(button.dataset.ownAction)));
  unbound("[data-view-profile]").forEach((button) => button.addEventListener("click", () => {
    if ($("#userActionModal").open) $("#userActionModal").close();
    $("#drawer").classList.add("hidden");
    openProfile(Number(button.dataset.viewProfile));
  }));
  unbound("[data-pm-user]").forEach((button) => button.addEventListener("click", () => {
    closeProfileActionsOverlay();
    if ($("#profileModal").open) $("#profileModal").close();
    openPm(button.dataset.pmUser);
  }));
  unbound("[data-add-friend]").forEach((button) => button.addEventListener("click", async () => { await api("/api/social/friend-requests", { method: "POST", body: JSON.stringify({ toUserId: button.dataset.addFriend }) }); closeProfileActionsOverlay(); toast("Friend request sent."); }));
  unbound("[data-remove-friend-action]").forEach((button) => button.addEventListener("click", async () => { await api(`/api/social/friends/${button.dataset.removeFriendAction}`, { method: "DELETE" }); await loadFriends(); closeProfileActionsOverlay(); toast("Friend removed."); if ($("#userActionModal").open) $("#userActionModal").close(); }));
  unbound("[data-follow]").forEach((button) => button.addEventListener("click", async () => { await api("/api/social/follows", { method: "POST", body: JSON.stringify({ userId: button.dataset.follow }) }); closeProfileActionsOverlay(); toast("Followed."); }));
  unbound("[data-like-profile]").forEach((button) => button.addEventListener("click", async () => {
    const result = await api(`/api/social/profiles/${button.dataset.likeProfile}/like`, { method: "POST" });
    closeProfileActionsOverlay();
    toast(result.liked ? "Profile liked." : "Profile unliked.");
  }));
  unbound("[data-gift]").forEach((button) => button.addEventListener("click", () => { closeProfileActionsOverlay(); openGiftModal(button.dataset.gift); }));
  unbound("[data-share-wallet]").forEach((button) => button.addEventListener("click", () => { closeProfileActionsOverlay(); openShareWalletModal(button.dataset.shareWallet); }));
  unbound("[data-block]").forEach((button) => button.addEventListener("click", async () => { await api("/api/social/blocks", { method: "POST", body: JSON.stringify({ userId: button.dataset.block }) }); await loadFriends(); closeProfileActionsOverlay(); toast("User blocked."); }));
  unbound("[data-unblock-action]").forEach((button) => button.addEventListener("click", async () => { await api(`/api/social/blocks/${button.dataset.unblockAction}`, { method: "DELETE" }); await loadFriends(); closeProfileActionsOverlay(); toast("User unblocked."); if ($("#userActionModal").open) $("#userActionModal").close(); }));
  unbound("[data-report-user]:not([data-report-message])").forEach((button) => button.addEventListener("click", () => {
    if (Number(button.dataset.reportUser) === Number(state.me.id)) return toast("You cannot report yourself.");
    closeProfileActionsOverlay();
    openReportModal({ targetType: "user", targetUserId: button.dataset.reportUser, label: `user #${button.dataset.reportUser}` });
  }));
  unbound("[data-staff-action]").forEach((button) => button.addEventListener("click", () => openStaffActions(button.dataset.staffAction)));
}

function openStaffActions(userId) {
  const user = userById(userId) || { id: userId, username: `User #${userId}`, rank: "user", avatarUrl: "/assets/avatar-other.svg" };
  if ($("#profileModal").open) $("#profileModal").close();
  $("#userActionBody").innerHTML = `
    <div class="staff-card">
      <div class="menu-profile">
        <img class="avatar" src="${html(avatar(user))}" alt="" />
        <div><h2>${html(user.username)}</h2>${userRankBadge(user)}<p class="muted">Choose a moderation action</p></div>
      </div>
      <div class="moderation-action-grid">
        ${hasTool("warn") ? '<button data-moderation-open="warn" type="button"><b>!</b><span>Warn<small>Send a written warning</small></span></button>' : ""}
        ${hasTool("mute") ? '<button data-moderation-open="mute" type="button"><b>M</b><span>Mute<small>Stop messaging everywhere</small></span></button>' : ""}
        ${hasTool("kick") ? '<button data-moderation-open="kick" type="button"><b>K</b><span>Kick<small>Remove with a countdown</small></span></button>' : ""}
        ${hasTool("ban") ? '<button class="danger-action" data-moderation-open="ban" type="button"><b>B</b><span>Ban<small>Block the account</small></span></button>' : ""}
      </div>
      <div class="modal-action-row moderation-reversal-row">
        ${user.mutedUntil && new Date(user.mutedUntil) > new Date() ? '<button data-mod="unmute" type="button">Unmute</button>' : ""}
        ${user.kickedUntil && new Date(user.kickedUntil) > new Date() ? '<button data-mod="unkick" type="button">Unkick</button>' : ""}
        ${user.bannedUntil && new Date(user.bannedUntil) > new Date() ? '<button data-mod="unban" type="button">Unban</button>' : ""}
      </div>
    </div>
  `;
  $$("[data-moderation-open]").forEach((button) => button.addEventListener("click", () => openModerationComposer(user, button.dataset.moderationOpen)));
  $$("[data-mod]").forEach((button) => button.addEventListener("click", () => moderate(userId, button.dataset.mod)));
  if (!$("#userActionModal").open) $("#userActionModal").showModal();
}

function openModerationComposer(user, action) {
  const durationOptions = [[1,"1 min"],[2,"2 min"],[3,"3 min"],[5,"5 min"],[10,"10 min"],[15,"15 min"],[20,"20 min"],[60,"1 hr"],[120,"2 hr"],[1440,"1 day"],[2880,"2 days"],[144000,"100 days"]];
  const timed = ["mute", "kick"].includes(action);
  const title = action[0].toUpperCase() + action.slice(1);
  $("#userActionBody").innerHTML = `<form id="moderationComposer" class="staff-card moderation-composer"><div class="warning-box"><strong>!</strong><span><b>${title} ${html(user.username)}</b>${action === "warn" ? "The user will see this message in a warning window." : action === "mute" ? "Messaging will be disabled in rooms, PMs and social posts." : action === "kick" ? "The user will see your reason and a live countdown." : "The user will see your reason without a countdown."}</span></div>${timed ? `<label>Duration<select name="minutes">${durationOptions.map(([value,label]) => `<option value="${value}">${label}</option>`).join("")}</select></label>` : ""}<label>${action === "warn" ? "Warning message" : "Reason"}<textarea name="reason" maxlength="500" required placeholder="Write a clear ${action === "warn" ? "warning" : "reason"}..."></textarea></label><div class="modal-action-row"><button data-moderation-cancel type="button">Cancel</button><button class="${action === "ban" ? "danger-action" : "primary"}" type="submit">${action === "warn" ? "Send warning" : `Apply ${title.toLowerCase()}`}</button></div></form>`;
  $("[data-moderation-cancel]").addEventListener("click", () => openStaffActions(user.id));
  $("#moderationComposer").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await moderate(user.id, action, { minutes: Number(values.minutes || 0), reason: String(values.reason || "").trim() });
  });
}

async function moderate(userId, action, extra = {}) {
  await api(`/api/admin/users/${userId}/moderate`, { method: "POST", body: JSON.stringify({ action, ...extra }) });
  toast("Staff action applied.");
  closeProfileActionsOverlay();
  if ($("#userActionModal").open) $("#userActionModal").close();
  $("#drawer").classList.add("hidden");
  await bootstrap();
}

async function profileEditAction(userId, action, extra = {}) {
  await api(`/api/admin/users/${userId}/profile-edit`, { method: "POST", body: JSON.stringify({ action, ...extra }) });
  toast(action === "password" ? "Password changed. That user must log in again." : "Edit applied.");
  closeProfileActionsOverlay();
  $("#drawer").classList.add("hidden");
  await bootstrap();
}

function renderPmDrawerActions(user) {
  const actions = $("#drawerActions");
  if (!actions) return;
  actions.innerHTML = `
    <button class="drawer-icon-button" id="pmExpandButton" type="button" title="${state.pmExpanded ? "Make private message smaller" : "Make private message bigger"}">
      ${state.pmExpanded
        ? '<svg viewBox="0 0 24 24"><path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>'}
    </button>
    <div class="pm-settings-wrap">
      <button class="drawer-icon-button" id="pmSettingsButton" type="button" title="Private message settings">
        <svg viewBox="0 0 24 24"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.6 2.2-1.7-.9a7 7 0 0 0-.7-1.7l.6-1.8-1.1-1.1-1.8.6a7 7 0 0 0-1.7-.7L13.3 3h-2.6l-.9 2.1a7 7 0 0 0-1.7.7l-1.8-.6-1.1 1.1.6 1.8a7 7 0 0 0-.7 1.7l-1.7.9v2.6l1.7.9c.2.6.4 1.2.7 1.7l-.6 1.8 1.1 1.1 1.8-.6c.5.3 1.1.6 1.7.7l.9 2.1h2.6l.9-2.1c.6-.2 1.2-.4 1.7-.7l1.8.6 1.1-1.1-.6-1.8c.3-.5.6-1.1.7-1.7l1.7-.9v-2.6Z"/></svg>
      </button>
      <div class="pm-settings-menu hidden" id="pmSettingsMenu">
        <button data-report-chat="${user.id}" type="button"><svg viewBox="0 0 24 24"><path d="M5 21V4h10l1 2h4v10h-8l-1-2H7v7z"/></svg><span>Report chat</span></button>
        ${canDeletePrivateChats() ? `<button data-delete-pm-chat="${user.id}" class="danger-menu-action" type="button"><svg viewBox="0 0 24 24"><path d="M8 9h2v9H8V9Zm6 0h2v9h-2V9ZM4 6h16v2H4V6Zm3 2h10l-1 13H8L7 8Zm3-5h4l1 2H9l1-2Z"/></svg><span>Delete chat</span></button>` : ""}
      </div>
    </div>
  `;
  $("#pmExpandButton")?.addEventListener("click", () => {
    state.pmExpanded = !state.pmExpanded;
    $("#drawer").classList.toggle("pm-expanded", state.pmExpanded);
    renderPmDrawerActions(user);
    const thread = $("#pmThread");
    if (thread) thread.scrollTop = thread.scrollHeight;
  });
  $("#pmSettingsButton")?.addEventListener("click", (event) => {
    event.stopPropagation();
    $("#pmSettingsMenu")?.classList.toggle("hidden");
  });
  $("[data-report-chat]", actions)?.addEventListener("click", () => {
    $("#pmSettingsMenu")?.classList.add("hidden");
    openReportModal({ targetType: "private_chat", targetUserId: user.id, label: `private chat with ${displayName(user)}` });
  });
  $("[data-delete-pm-chat]", actions)?.addEventListener("click", async () => {
    $("#pmSettingsMenu")?.classList.add("hidden");
    if (!confirm(`Delete the private chat with ${displayName(user)}? This removes the conversation for both users.`)) return;
    await api(`/api/chat/private-messages/${user.id}`, { method: "DELETE" });
    toast("Private chat deleted.");
    await loadPm(user.id);
    openPmConversations().catch((error) => toast(error.message));
  });
}

function openPm(userId, fallbackUser = null) {
  const numericUserId = Number(userId);
  if (!numericUserId || numericUserId === Number(state.me.id)) return toast("Choose another user to message.");
  const user = userById(numericUserId) || fallbackUser;
  if (!user) return toast("User not found.");
  if ($("#profileModal").open) $("#profileModal").close();
  state.activePmUserId = numericUserId;
  state.pmUploadFile = null;
  state.pmMessages = [];
  state.pmReplyToId = null;
  setDrawerChrome({ title: "Private message", pm: true });
  renderPmDrawerActions(user);
  $("#drawerBody").innerHTML = `
    <div class="pm-card">
      <div class="pm-head">
        <img class="avatar" src="${html(avatar(user))}" alt="" />
        <span><strong>${html(displayName(user))}</strong><small>${userRankBadge(user)}</small></span>
        <span class="pm-head-actions">
          <button class="pm-head-action" data-view-profile="${user.id}" type="button" title="View profile">View</button>
        </span>
      </div>
      <div id="pmThread" class="pm-thread"></div>
      <div class="pm-composer-shell">
        <input id="pmAttachment" class="hidden" type="file" accept="image/*" />
        <div id="pmUploadPreview" class="upload-preview hidden"></div>
        <div id="pmReplyBox" class="pm-reply-composer hidden">
          <i class="pm-reply-symbol" aria-hidden="true">↩</i>
          <span><small>Replying to <strong id="pmReplyName"></strong></small><em id="pmReplyText"></em></span>
          <button id="pmClearReply" type="button" title="Cancel reply" aria-label="Cancel reply">×</button>
        </div>
        <form id="pmForm" class="composer-input pm-composer">
          <button class="composer-icon" id="pmEmojiButton" type="button" title="Emoji"><svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM8 9.5a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8Zm8 0a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8Zm-4 7.2c-2.2 0-4-1.2-5-3h10c-1 1.8-2.8 3-5 3Z"/></svg></button>
          <input id="pmInput" placeholder="Type here.." autocomplete="off" autocorrect="off" spellcheck="false" />
          <button class="composer-icon" id="pmUploadButton" type="button" title="Send image"><svg viewBox="0 0 24 24"><path d="M5 5h3l1.5-2h5L16 5h3a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Zm7 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-2.2a2.8 2.8 0 1 1 0-5.6 2.8 2.8 0 0 1 0 5.6Z"/></svg></button>
          <button class="composer-icon" id="pmVoiceButton" type="button" title="Voice message"><svg viewBox="0 0 24 24"><path d="M12 15a4 4 0 0 0 4-4V6a4 4 0 0 0-8 0v5a4 4 0 0 0 4 4Zm7-4a7 7 0 0 1-6 6.9V21h3v2H8v-2h3v-3.1A7 7 0 0 1 5 11h2a5 5 0 0 0 10 0h2Z"/></svg></button>
          <button class="send icon-send" type="submit" title="Send"><svg viewBox="0 0 24 24"><path d="M2 21 23 12 2 3v7l13 2-13 2z"/></svg></button>
        </form>
      </div>
    </div>
  `;
  showDrawer();
  loadPm(numericUserId).catch((error) => {
    $("#pmThread").innerHTML = `<p class="muted">${html(error.message)}</p>`;
  });
  $("#pmEmojiButton").addEventListener("click", (event) => openEmojiPicker("#pmInput", event.currentTarget));
  $("#pmUploadButton").addEventListener("click", () => $("#pmAttachment").click());
  $("#pmVoiceButton").addEventListener("click", () => toggleVoiceRecording({ type: "pm", userId: numericUserId }));
  $("#pmAttachment").addEventListener("change", () => {
    state.pmUploadFile = $("#pmAttachment").files[0];
    if (!state.pmUploadFile) return;
    $("#pmUploadPreview").innerHTML = `<span>${html(state.pmUploadFile.name)}</span>`;
    $("#pmUploadPreview").classList.remove("hidden");
  });
  $("#pmClearReply").addEventListener("click", clearPmReply);
  bindUserActionButtons(numericUserId);
  $("#pmForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.sendingPm) return;
    const body = $("#pmInput").value.trim();
    if (!body && !state.pmUploadFile) return;
    const form = new FormData();
    form.append("receiverId", numericUserId);
    form.append("body", body);
    if (state.pmReplyToId) form.append("replyToId", state.pmReplyToId);
    if (state.pmUploadFile) form.append("attachment", state.pmUploadFile);
    const submitButton = $("#pmForm button[type='submit']");
    state.sendingPm = true;
    submitButton.disabled = true;
    try {
      $("#pmInput").value = "";
      const sent = await api("/api/chat/private-messages", { method: "POST", body: form });
      state.pmUploadFile = null;
      $("#pmAttachment").value = "";
      $("#pmUploadPreview").classList.add("hidden");
      clearPmReply();
      appendPmMessage({
        ...sent,
        sender_id: sent.sender_id || sent.senderId || state.me.id,
        sender_username: sent.sender_username || sent.senderUsername || state.me.username,
        created_at: sent.created_at || sent.createdAt || new Date().toISOString(),
      });
    } catch (error) {
      toast(error.message);
    } finally {
      state.sendingPm = false;
      submitButton.disabled = false;
    }
  });
}

function clearPmReply() {
  state.pmReplyToId = null;
  $("#pmReplyBox")?.classList.add("hidden");
  if ($("#pmReplyName")) $("#pmReplyName").textContent = "";
  if ($("#pmReplyText")) $("#pmReplyText").textContent = "";
}

function setPmReply(messageId) {
  const row = state.pmMessages.find((message) => Number(message.id) === Number(messageId));
  if (!row) return toast("That message is no longer available.");
  const own = Number(row.sender_id || row.senderId) === Number(state.me.id);
  const sender = row.sender_username || row.senderUsername || (own ? state.me.username : "User");
  const preview = String(row.body || "").trim() || (row.attachment_url || row.attachmentUrl ? "Attachment" : "Message");
  state.pmReplyToId = Number(row.id);
  $("#pmReplyName").textContent = sender;
  $("#pmReplyText").textContent = preview.slice(0, 120);
  $("#pmReplyBox").classList.remove("hidden");
  $("#pmInput")?.focus();
}

function bindPmMessageActions() {
  const thread = $("#pmThread");
  if (!thread) return;
  $$('[data-pm-reply]:not([data-pm-bound])', thread).forEach((button) => {
    button.dataset.pmBound = "true";
    button.addEventListener("click", () => setPmReply(button.dataset.pmReply));
  });
  $$('[data-pm-jump]:not([data-pm-bound])', thread).forEach((button) => {
    button.dataset.pmBound = "true";
    button.addEventListener("click", () => {
    const target = $(`[data-pm-message-id="${Number(button.dataset.pmJump)}"]`, thread);
    if (!target) return toast("The quoted message is outside this view.");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("pm-message-highlight");
    setTimeout(() => target.classList.remove("pm-message-highlight"), 1200);
    });
  });
}

function pmMessageHtml(row) {
  const own = Number(row.sender_id || row.senderId) === Number(state.me.id);
  const createdAt = row.created_at || row.createdAt;
  const sender = row.sender_username || row.senderUsername || (own ? state.me.username : "User");
  const replyToId = row.reply_to_id || row.replyToId;
  const replySender = row.reply_sender_username || row.replySenderUsername || "User";
  const replyText = String(row.reply_body || row.replyBody || "").trim()
    || (row.reply_attachment_url || row.replyAttachmentUrl ? "Attachment" : "Message unavailable");
  return `
    <div class="pm-message ${own ? "own" : ""}" data-pm-message-id="${html(row.id || "")}">
      <span><strong>${html(sender)}</strong><small>${formatTime(createdAt)}${row.read_at ? " | seen" : ""}</small></span>
      ${replyToId ? `<button class="pm-quoted-message" data-pm-jump="${Number(replyToId)}" type="button"><i aria-hidden="true">↩</i><span><small>${html(replySender)}</small><b>${html(replyText.slice(0, 140))}</b></span></button>` : ""}
      ${row.body ? `<p>${renderMessageBody(String(row.body), {})}</p>` : ""}
      ${messageAttachmentHtml(row, "pm-attachment")}
      <button class="pm-reply-button" data-pm-reply="${html(row.id || "")}" type="button">↩ Reply</button>
    </div>
  `;
}

function appendPmMessage(row) {
  const thread = $("#pmThread");
  if (!thread) return;
  if (row.id && $$(".pm-message", thread).some((node) => node.dataset.pmMessageId === String(row.id))) return;
  if (row.id && !state.pmMessages.some((message) => Number(message.id) === Number(row.id))) state.pmMessages.push(row);
  if (thread.querySelector(".muted")) thread.innerHTML = "";
  thread.insertAdjacentHTML("beforeend", pmMessageHtml(row));
  bindPmMessageActions();
  while (thread.querySelectorAll(".pm-message").length > 60) thread.querySelector(".pm-message")?.remove();
  thread.scrollTop = thread.scrollHeight;
}

async function loadPm(userId) {
  const rows = await api(`/api/chat/private-messages/${userId}?limit=50`);
  state.pmMessages = rows;
  if (state.pmReplyToId && !rows.some((row) => Number(row.id) === Number(state.pmReplyToId))) clearPmReply();
  refreshPmUnread().catch(() => {});
  $("#pmThread").innerHTML = rows.map(pmMessageHtml).join("") || '<p class="muted">No private messages yet.</p>';
  bindPmMessageActions();
  $("#pmThread").scrollTop = $("#pmThread").scrollHeight;
}

async function markPmRead(userId) {
  await api(`/api/chat/private-messages/${Number(userId)}/read`, { method: "POST" });
  return refreshPmUnread();
}

async function openPmConversations() {
  state.activePmUserId = null;
  setDrawerChrome({ title: "Private messages" });
  showDrawer();
  const startUsers = state.users
    .filter((user) => Number(user.id) !== Number(state.me.id) && visibleInUserList(user))
    .sort((a, b) => Number(isOnline(b)) - Number(isOnline(a)) || displayName(a).localeCompare(displayName(b)));
  const userFallbacks = new Map(startUsers.map((user) => [Number(user.id), user]));

  const renderPmDirectory = (rows = [], recentUnavailable = false) => {
    const conversationIds = new Set(rows.map((item) => Number(item.id)));
    $("#drawerBody").innerHTML = `
      <div class="pm-inbox">
        <div class="pm-section-title"><span>Ongoing texts</span><small>${rows.length || "none"}</small></div>
        ${rows.map((item) => {
          const user = {
            id: item.id,
            username: item.username,
            display_name: item.display_name,
            rank_name: item.rank_name,
            profile_title: item.profile_title,
            avatar_url: item.avatar_url,
            gender: item.gender,
          };
          const unreadCount = Number(item.unread_count || 0);
          return `
            <button class="pm-conversation ${unreadCount > 0 ? "unread" : ""}" data-pm-open="${item.id}" type="button">
              <span class="status ${isOnline(userById(item.id)) ? "" : "offline"}"></span>
              <img class="avatar" src="${html(avatar(user))}" alt="" />
              <span><strong>${html(displayName(user))}</strong><small>${html(item.last_body || "Image")}</small></span>
              ${unreadCount > 0 ? `<em><i></i>${unreadCount}</em>` : ""}
            </button>
          `;
        }).join("") || `<div class="pm-empty"><strong>${recentUnavailable ? "Recent chats unavailable" : "No private chats yet"}</strong><span>Use Search users to start a private chat.</span></div>`}
        <section class="pm-start-panel">
          <div class="pm-section-title"><span>Start a text</span><small>${startUsers.length || "none"}</small></div>
          <input id="pmUserSearch" class="pm-user-search" placeholder="Search people..." autocomplete="off" />
          <div class="pm-start-list" id="pmStartList"></div>
        </section>
      </div>`;
    const renderStartUsers = () => {
      const query = ($("#pmUserSearch")?.value || "").trim().toLowerCase();
      const filtered = startUsers
        .filter((user) => {
          const label = `${displayName(user)} ${user.username || ""}`.toLowerCase();
          return !query || label.includes(query);
        })
        .slice(0, 80);
      $("#pmStartList").innerHTML = filtered.map((user) => `
        <button class="pm-conversation pm-start-user ${conversationIds.has(Number(user.id)) ? "existing" : ""}" data-pm-start="${user.id}" type="button">
          <span class="status ${isOnline(user) ? "" : "offline"}"></span>
          <img class="avatar" src="${html(avatar(user))}" alt="" />
          <span><strong>${html(displayName(user))}</strong><small>${userRankBadge(user)}</small></span>
        </button>
      `).join("") || '<p class="muted">No users available to message.</p>';
      $$("[data-pm-start]", $("#drawerBody")).forEach((button) => button.addEventListener("click", () => {
        openPm(button.dataset.pmStart, userFallbacks.get(Number(button.dataset.pmStart)));
      }));
    };
    $$("[data-pm-open]", $("#drawerBody")).forEach((button) => {
      const item = rows.find((row) => Number(row.id) === Number(button.dataset.pmOpen));
      const fallback = item ? {
        id: item.id,
        username: item.username,
        display_name: item.display_name,
        rank_name: item.rank_name,
        profile_title: item.profile_title,
        avatar_url: item.avatar_url,
        gender: item.gender,
      } : null;
      button.addEventListener("click", () => openPm(button.dataset.pmOpen, fallback));
    });
    $("#pmUserSearch")?.addEventListener("input", renderStartUsers);
    renderStartUsers();
    $("#pmUserSearch")?.focus();
  };

  renderPmDirectory();
  try {
    const rows = await api("/api/chat/private-conversations");
    if (state.activePmUserId) return;
    state.unreadPm = rows.reduce((total, item) => total + Number(item.unread_count || 0), 0);
    setBadges();
    renderPmDirectory(rows);
  } catch (error) {
    if (state.activePmUserId) return;
    refreshPmUnread().catch(() => {});
    renderPmDirectory([], true);
  }
}

async function renderAdmin() {
  const data = await api("/api/admin/dashboard");
  const intruder = data.tools?.intruder;
  const intruderNext = intruder?.nextSpawnAt ? `${formatDate(intruder.nextSpawnAt)} ${formatTime(intruder.nextSpawnAt)}` : "Stopped";
  const intruderActive = intruder?.activeRound ? `Active now | ${compactNumber(intruder.activeRound.points)} pts` : "No active round";
  const toolsSection = intruder ? `
    <section class="panel admin-panel developer-tools-panel">
      <div class="section-title-row"><h2>Tools</h2></div>
      <article class="tool-card intruder-tool-card">
        <div class="tool-card-head">
          <img class="avatar avatar-lg" src="${html(intruder.botAvatarUrl || "/assets/intruder-bot.png")}" alt="" />
          <span><strong>${html(intruder.botName || "Intruder")}</strong><small>${intruder.enabled ? "Running" : "Stopped"} | ${html(intruderActive)}</small></span>
        </div>
        <form id="intruderToolsForm" class="tool-form">
          <div class="tool-range-grid">
            <label>Bot name<input id="intruderName" maxlength="40" value="${html(intruder.botName || "Intruder")}" /></label>
            <label>Avatar URL<input id="intruderAvatar" maxlength="500" value="${html(intruder.botAvatarUrl || "/assets/intruder-bot.png")}" /></label>
          </div>
          <div class="tool-range-grid">
            <label>Minimum minutes<input id="intruderMin" type="number" min="2" max="1440" step="1" value="${html(intruder.minIntervalMinutes || 2)}" /></label>
            <label>Maximum minutes<input id="intruderMax" type="number" min="2" max="1440" step="1" value="${html(intruder.maxIntervalMinutes || 6)}" /></label>
          </div>
          <small>Every arrival is randomized inside the range. Next arrival: ${html(intruderNext)}</small>
          <div class="tool-actions">
            <button class="primary" type="submit">${intruder.enabled ? "Save" : "Start"}</button>
            <button id="intruderStopButton" type="button" ${intruder.enabled ? "" : "disabled"}>Stop</button>
          </div>
        </form>
      </article>
    </section>
  ` : "";
  $("#adminDashboard").innerHTML = `
    <section class="admin-hero">
      <div>
        <span class="eyebrow">Staff console</span>
        <h2>Admin panel</h2>
        <p>Moderate users, review reports, tune rank permissions, and keep Teen Chat Town clean.</p>
      </div>
      <div class="admin-hero-actions"><button class="primary" id="adminRefresh" type="button">Refresh panel</button><button id="adminClose" class="admin-close-button" title="Close admin panel" aria-label="Close admin panel" type="button">x</button></div>
    </section>
    <div class="admin-stats">
      <article class="stat-card"><strong>${data.stats.totalUsers}</strong><span>Total users</span></article>
      <article class="stat-card"><strong>${data.stats.staffCount}</strong><span>Staff</span></article>
      <article class="stat-card"><strong>${data.stats.rooms}</strong><span>Rooms</span></article>
      <article class="stat-card"><strong>${data.stats.openReports}</strong><span>Open reports</span></article>
    </div>
    ${toolsSection}
    <section class="panel admin-panel"><h2>Reports</h2><div class="admin-table">${data.reports.map((report) => `
      <div class="report-row">
        <span><strong>${html(report.target_type || "user")} report</strong><small>By ${html(report.reporter_name || `#${report.reporter_id}`)} ${report.target_name ? `about ${html(report.target_name)}` : ""} ${report.message_id ? `| chat #${report.message_id}` : ""} ${report.private_message_id ? `| PM #${report.private_message_id}` : ""} ${report.wall_post_id ? `| wall #${report.wall_post_id}` : ""}</small></span>
        <p>${html(report.reason)}</p>
        <select data-report-status="${report.id}">
          ${["open", "reviewing", "resolved", "dismissed"].map((status) => `<option value="${status}" ${status === report.status ? "selected" : ""}>${status}</option>`).join("")}
        </select>
      </div>`).join("") || '<p class="muted">No reports yet.</p>'}</div></section>
    <section class="panel admin-panel"><div class="section-title-row"><h2>Random Talk safety</h2><small>Private 30-day aggregates; context loads only when opened</small></div>
      <div class="admin-stats compact-stats">
        <article class="stat-card"><strong>${Number(data.randomTalkMetrics?.sessions || 0)}</strong><span>Matches</span></article>
        <article class="stat-card"><strong>${Math.round(Number(data.randomTalkMetrics?.average_session_seconds || 0) / 60)}m</strong><span>Avg session</span></article>
        <article class="stat-card"><strong>${Number(data.randomTalkMetrics?.skip_rate || 0)}%</strong><span>Skip rate</span></article>
        <article class="stat-card"><strong>${Number(data.randomTalkMetrics?.reports_per_100_sessions || 0)}</strong><span>Reports / 100</span></article>
      </div><div class="admin-table">${(data.randomTalkReports || []).map((report) => `
      <div class="report-row random-talk-report-row">
        <span><strong>${html(report.category)}</strong><small>By ${html(report.reporter_name)} about ${html(report.reported_name)} · ${Number(report.previous_offence_count || 0)} previous reports</small></span>
        <p>${html(report.details || "No additional details")}</p>
        <input data-random-report-notes="${report.id}" maxlength="1000" value="${html(report.internal_notes || "")}" placeholder="Internal staff note" />
        <div class="report-queue-actions"><select data-random-report-status="${report.id}">${["open", "reviewing", "resolved", "dismissed"].map((status) => `<option value="${status}" ${status === report.status ? "selected" : ""}>${status}</option>`).join("")}</select><button data-random-report-context="${report.id}" type="button">View context</button>${report.reported_user_id ? `<button class="danger-action" data-random-restrict="${report.reported_user_id}" type="button">Restrict access</button>` : ""}<button class="danger-action" data-random-network-ban="${report.id}" type="button" ${Number(report.network_banned) ? "disabled" : ""}>${Number(report.network_banned) ? "Network banned" : "Ban guest network"}</button></div>
      </div>`).join("") || '<p class="muted">No Random Talk reports yet.</p>'}</div></section>
    <section class="panel admin-panel"><h2>Private chats</h2><div class="admin-table">${(data.privateConversations || []).map((chat) => `
      <div class="admin-private-row">
        <span class="private-chat-pair">
          <img class="avatar" src="${html(chat.user_one_avatar || "/assets/avatar-other.svg")}" alt="" />
          <img class="avatar" src="${html(chat.user_two_avatar || "/assets/avatar-other.svg")}" alt="" />
        </span>
        <span><strong>${html(chat.user_one_name)} and ${html(chat.user_two_name)}</strong><small>${Number(chat.message_count || 0)} messages | ${html(chat.last_body || "Image")} | ${formatDate(chat.last_message_at)} ${formatTime(chat.last_message_at)}</small></span>
        <button data-admin-delete-chat="${chat.user_one_id}:${chat.user_two_id}" type="button">Delete chat</button>
      </div>`).join("") || '<p class="muted">No private chats yet.</p>'}</div></section>
    <section class="panel admin-panel"><h2>Rank permissions</h2><div class="permission-grid">${data.ranks.filter((rank) => rank !== "developer" && rank !== "bot").map((rank) => `<article class="permission-card"><strong>${html(rank)}</strong>${data.staffTools.filter((tool) => !["intruderTool", "profileEditTool"].includes(tool)).map((tool) => `<label><input type="checkbox" data-permission-rank="${html(rank)}" data-permission-tool="${html(tool)}" ${data.permissions.find((p) => p.rank_name === rank && p.tool === tool && p.allowed) ? "checked" : ""}/> ${html(permissionLabel(tool))}</label>`).join("")}</article>`).join("")}</div></section>
    <section class="panel admin-panel"><h2>Rank badges</h2><div class="badge-editor">${data.ranks.filter((rank) => rank !== "developer" && rank !== "bot").map((rank) => {
      const badge = state.rankBadges[rank] || {};
      return `<article class="badge-edit-row">
        <strong>${rankBadge(rank)} ${html(rank)}</strong>
        <input data-badge-label="${html(rank)}" value="${html(badge.label || rank)}" maxlength="16" />
        <input data-badge-color="${html(rank)}" value="${html(badge.color || "#8b5cf6")}" />
        <input data-badge-image="${html(rank)}" value="${html(badge.imageUrl || "")}" placeholder="/assets/badge-${html(rank.replaceAll(" ", "-"))}.svg" />
        <button data-badge-save="${html(rank)}" type="button">Save badge</button>
      </article>`;
    }).join("")}</div></section>
    <section class="panel admin-panel"><h2>Console log</h2><div class="console-list">${data.logs.map((log) => `<p><span>${formatDate(log.created_at)} ${formatTime(log.created_at)}</span><strong>${html(log.actor_name)}</strong> ${html(log.action)} ${log.details ? `<small>${html(log.details)}</small>` : ""}</p>`).join("")}</div></section>
  `;
  $("#adminRefresh").addEventListener("click", renderAdmin);
  $("#adminClose").addEventListener("click", () => setView("chat"));
  $("#intruderToolsForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const minIntervalMinutes = Number($("#intruderMin")?.value || 2);
    const maxIntervalMinutes = Number($("#intruderMax")?.value || 6);
    const botName = $("#intruderName")?.value.trim();
    const botAvatarUrl = $("#intruderAvatar")?.value.trim();
    await api("/api/admin/tools/intruder", { method: "POST", body: JSON.stringify({ enabled: true, minIntervalMinutes, maxIntervalMinutes, botName, botAvatarUrl }) });
    toast("Intruder started.");
    await renderAdmin();
  });
  $("#intruderStopButton")?.addEventListener("click", async () => {
    const minIntervalMinutes = Number($("#intruderMin")?.value || 2);
    const maxIntervalMinutes = Number($("#intruderMax")?.value || 6);
    const botName = $("#intruderName")?.value.trim();
    const botAvatarUrl = $("#intruderAvatar")?.value.trim();
    await api("/api/admin/tools/intruder", { method: "POST", body: JSON.stringify({ enabled: false, minIntervalMinutes, maxIntervalMinutes, botName, botAvatarUrl }) });
    toast("Intruder stopped.");
    await renderAdmin();
  });
  $("#intruderResetButton")?.addEventListener("click", async () => {
    if (!confirm("Reset Top Shooters to 0?")) return;
    await api("/api/admin/tools/intruder/reset", { method: "POST" });
    toast("Top Shooters reset.");
    await renderAdmin();
  });
  $$("[data-report-status]").forEach((select) => select.addEventListener("change", async () => {
    await api(`/api/admin/reports/${select.dataset.reportStatus}`, { method: "PATCH", body: JSON.stringify({ status: select.value }) });
    toast("Report updated.");
  }));
  $$("[data-random-report-status]").forEach((select) => select.addEventListener("change", async () => {
    const notes = $$("[data-random-report-notes]").find((input) => input.dataset.randomReportNotes === select.dataset.randomReportStatus)?.value || "";
    await api(`/api/random-talk/admin/reports/${select.dataset.randomReportStatus}`, { method: "PATCH", body: JSON.stringify({ status: select.value, internalNotes: notes }) });
    toast("Random Talk report updated.");
    refreshReportBadge().catch(() => {});
  }));
  $$("[data-random-report-context]").forEach((button) => button.addEventListener("click", async () => {
    const context = await api(`/api/random-talk/admin/reports/${button.dataset.randomReportContext}/context`);
    $("#userActionBody").innerHTML = `<div class="staff-card"><span class="eyebrow">Safety context</span><h2>Recent Random Talk messages</h2><div class="admin-table">${(context.messages || []).map((message) => `<p><strong>${html(message.sender)}</strong> ${html(message.body)}<small>${formatDate(message.createdAt)} ${formatTime(message.createdAt)}</small></p>`).join("") || '<p class="muted">No retained messages.</p>'}</div></div>`;
    $("#userActionModal").showModal();
  }));
  $$("[data-random-restrict]").forEach((button) => button.addEventListener("click", async () => {
    const minutes = Number(prompt("Restrict Random Talk for how many minutes?", "60"));
    if (!minutes) return;
    const reason = prompt("Reason shown to the user", "Random Talk safety restriction.");
    if (reason === null) return;
    await api(`/api/random-talk/admin/restrict/${button.dataset.randomRestrict}`, { method: "POST", body: JSON.stringify({ minutes, reason }) });
    toast("Random Talk access restricted.");
  }));
  $$("[data-random-network-ban]").forEach((button) => button.addEventListener("click", async () => {
    const duration = prompt("Network ban duration in minutes. Enter 0 for permanent.", "10080");
    if (duration === null || !/^\d+$/.test(duration.trim())) return;
    const reason = prompt("Private audit reason", "Random Talk safety violation.");
    if (reason === null || !reason.trim()) return;
    await api(`/api/random-talk/admin/reports/${button.dataset.randomNetworkBan}/ban-network`, { method: "POST", body: JSON.stringify({ minutes: Number(duration), reason }) });
    toast("Guest network access blocked.");
    await renderAdmin();
  }));
  $$("[data-admin-delete-chat]").forEach((button) => button.addEventListener("click", async () => {
    const [userOneId, userTwoId] = button.dataset.adminDeleteChat.split(":");
    if (!confirm("Delete this private chat for both users?")) return;
    await api(`/api/admin/private-conversations/${userOneId}/${userTwoId}`, { method: "DELETE" });
    toast("Private chat deleted.");
    await renderAdmin();
  }));
  $$("[data-permission-rank]").forEach((input) => input.addEventListener("change", async () => {
    await api("/api/admin/permissions", { method: "POST", body: JSON.stringify({ rank: input.dataset.permissionRank, tool: input.dataset.permissionTool, allowed: input.checked }) });
  }));
  $$("[data-badge-save]").forEach((button) => button.addEventListener("click", async () => {
    const rank = button.dataset.badgeSave;
    await api("/api/admin/rank-badges", {
      method: "POST",
      body: JSON.stringify({
        rank,
        label: $$("[data-badge-label]").find((input) => input.dataset.badgeLabel === rank).value,
        color: $$("[data-badge-color]").find((input) => input.dataset.badgeColor === rank).value,
        imageUrl: $$("[data-badge-image]").find((input) => input.dataset.badgeImage === rank).value,
      }),
    });
    toast("Rank badge saved.");
    await bootstrap();
    await renderAdmin();
  }));
}

const realtimeHandlers = {
  message(message) {
    if (Number(message.room_id) !== Number(state.currentRoomId)) return;
    if (state.messages.some((item) => Number(item.id) === Number(message.id))) return;
    if (Number(message.user_id) === Number(state.me.id)) {
      const pending = state.messages.find((item) => item.pending && item.body === message.body);
      if (pending && confirmOptimisticMessage(pending.id, message)) return;
    }
    state.messages.push(message);
    if (state.messages.length > 60) state.messages = state.messages.slice(-60);
    renderMessages();
  },
  notification(data = {}) {
    state.notifications.unshift({ ...data, is_read: 0, created_at: new Date().toISOString() });
    state.notifications = state.notifications.slice(0, 12);
    if (["friend-request", "friend-accepted"].includes(data.type)) loadFriends().catch(() => {});
    setBadges();
    refreshReportBadge().catch(() => {});
  },
  "friend-request-updated"() {
    loadFriends().catch(() => {});
  },
  "private-message"(data = {}) {
    if (state.activePmUserId && Number(data.senderId) === Number(state.activePmUserId) && !$("#drawer").classList.contains("hidden")) {
      appendPmMessage({
        ...data,
        sender_id: data.sender_id || data.senderId,
        sender_username: data.sender_username || data.senderUsername,
        created_at: data.created_at || data.createdAt || new Date().toISOString(),
      });
      markPmRead(state.activePmUserId).catch(() => refreshPmUnread().catch(() => {}));
      return;
    }
    refreshPmUnread().catch(() => {
      state.unreadPm += 1;
      setBadges();
    });
    if (!state.activePmUserId && !$("#drawer").classList.contains("hidden") && $("#drawerTitle").textContent === "Private messages") {
      openPmConversations().catch(() => {});
    }
  },
  "private-chat-deleted"(data = {}) {
    const affectedIds = [data.otherUserId, data.userOneId, data.userTwoId].map(Number).filter(Boolean);
    if (state.activePmUserId && affectedIds.includes(Number(state.activePmUserId)) && !$("#drawer").classList.contains("hidden")) {
      loadPm(state.activePmUserId).catch(() => {});
      toast("This private chat was deleted by staff.");
      return;
    }
    if (!state.activePmUserId && !$("#drawer").classList.contains("hidden") && $("#drawerTitle").textContent === "Private messages") {
      openPmConversations().catch(() => {});
    }
    refreshPmUnread().catch(() => {});
  },
  moderation(data = {}) {
    if (data.action === "warn") return showWarningNotice(data);
    toast(data.body || data.title || "Staff action applied.");
    if (["kick", "ban"].includes(data.action)) {
      showModerationGate(data);
    } else if (["password", "delete"].includes(data.action)) {
      localStorage.removeItem("tct_token");
      setTimeout(() => location.reload(), 900);
    }
  },
  "users-changed"(data = {}) {
    if (data.userId) state.profileCache.delete(Number(data.userId));
    if (data.userId && typeof data.online === "boolean") {
      const user = userById(data.userId);
      if (user) { user.online = data.online; user.lastSeen = new Date().toISOString(); }
      renderUsers();
    }
    scheduleUsersRefresh();
    setBadges();
  },
  "profile-wall"(data = {}) {
    state.friendsWallCache = null;
    state.profileSocialCache.delete(`${Number(data.profileUserId)}:wall`);
    if ($("#wallView")?.classList.contains("active")) renderFriendsWall({ force: true }).catch(() => {});
    if ($("#profileModal")?.open && Number(state.activeProfileUserId) === Number(data.profileUserId) && $("#profileWall")?.classList.contains("active")) {
      loadProfileSection(data.profileUserId, "wall", { force: true }).catch(() => {});
    }
  },
  "intruder-score-updated"() {
    state.leaderboardCache.shooters = null;
    if ($("#leaderboardView").classList.contains("active")) renderLeaderboard({ force: true }).catch((error) => toast(error.message));
    if ($("#adminView").classList.contains("active")) renderAdmin().catch((error) => toast(error.message));
  },
  "intruder-settings-updated"() {
    if ($("#adminView").classList.contains("active")) renderAdmin().catch((error) => toast(error.message));
  },
  "xo-game"(data = {}) {
    if (!$("#gamesView").classList.contains("active")) return;
    if (window.SusGame?.isOpen?.()) return;
    if (state.activeXoGameId && Number(state.activeXoGameId) === Number(data.gameId)) {
      if (data.game) updateXoGameSmooth(data.game);
      else openXoGame(data.gameId).catch(() => {});
    } else {
      renderGames().catch(() => {});
    }
  },
  "sus-state"(data = {}) {
    window.SusGame?.handleRealtime?.("state", data);
  },
  "sus-chat"(data = {}) {
    window.SusGame?.handleRealtime?.("chat", data);
  },
  "sus-event"(data = {}) {
    window.SusGame?.handleRealtime?.("event", data);
  },
  "sus-reward"(data = {}) {
    window.SusGame?.handleRealtime?.("reward", data);
    refreshUsersLight().catch(() => {});
  },
  "quiz:leaderboard_updated"() {
    state.leaderboardCache.quiz = null;
    if ($("#leaderboardView")?.classList.contains("active") && state.leaderboardTab === "quiz") renderLeaderboard({ force: true }).catch(() => {});
  },
  "quiz:error"(data = {}) {
    toast(data.message || "Quiz live connection error.");
  },
  "contest:state"(data = {}) {
    window.QuizGame?.handleRealtime?.("state", data);
  },
  "contest:state_changed"(data = {}) {
    window.QuizGame?.handleRealtime?.("state", data);
  },
  "contest:match_state"(data = {}) {
    window.QuizGame?.handleRealtime?.("match", data);
  },
  "contest:match_started"(data = {}) {
    window.QuizGame?.handleRealtime?.("match", data);
  },
  "contest:question_started"(data = {}) {
    window.QuizGame?.handleRealtime?.("question", data);
  },
  "contest:answer_locked"(data = {}) {
    window.QuizGame?.handleRealtime?.("answer", data);
  },
  "contest:question_finished"(data = {}) {
    window.QuizGame?.handleRealtime?.("question", data);
  },
  "contest:score_updated"(data = {}) {
    window.QuizGame?.handleRealtime?.("score", data);
  },
  "contest:match_finished"(data = {}) {
    window.QuizGame?.handleRealtime?.("finished", data);
  },
  "contest:round_started"(data = {}) {
    window.QuizGame?.handleRealtime?.("state", data);
  },
  "contest:round_finished"(data = {}) {
    window.QuizGame?.handleRealtime?.("state", data);
  },
  "contest:tournament_finished"(data = {}) {
    window.QuizGame?.handleRealtime?.("state", data);
  },
  "contest:timer_sync"(data = {}) {
    window.QuizGame?.handleRealtime?.("timer", data);
  },
  "random-talk-state"(data = {}) {
    window.RandomTalk?.handleRealtime?.("state", data);
  },
  "random-talk-match-found"(data = {}) {
    window.RandomTalk?.handleRealtime?.("match", data);
  },
  "random-talk-message"(data = {}) {
    window.RandomTalk?.handleRealtime?.("message", data);
  },
  "random-talk-typing"(data = {}) {
    window.RandomTalk?.handleRealtime?.("typing", data);
  },
  "random-talk-partner-disconnected"(data = {}) {
    window.RandomTalk?.handleRealtime?.("partner-disconnected", data);
  },
  "random-talk-partner-reconnected"(data = {}) {
    window.RandomTalk?.handleRealtime?.("partner-reconnected", data);
  },
  "random-talk-session-ended"(data = {}) {
    window.RandomTalk?.handleRealtime?.("ended", data);
  },
  "random-talk-report-confirmed"(data = {}) {
    window.RandomTalk?.handleRealtime?.("report", data);
  },
  "random-talk-error"(data = {}) {
    window.RandomTalk?.handleRealtime?.("error", data);
  },
  "random-talk-call-signal"(data = {}) {
    window.RandomTalk?.handleRealtime?.("call-signal", data);
  },
  "random-talk-call-error"(data = {}) {
    window.RandomTalk?.handleRealtime?.("call-error", data);
  },
  "message-updated"(data = {}) {
    const message = state.messages.find((item) => Number(item.id) === Number(data.id));
    if (message) message.body = data.body;
    renderMessages();
  },
  "message-deleted"(data = {}) {
    state.messages = state.messages.filter((item) => Number(item.id) !== Number(data.id));
    renderMessages();
  },
  "room-cleared"(data = {}) {
    if (Number(data.roomId) === Number(state.currentRoomId)) {
      state.messages = [];
      renderMessages();
      toast(`${data.by || "Staff"} cleared this room.`);
    }
  },
  reaction() {
    scheduleMessagesRefresh();
  },
  "message-pinned"() {
    scheduleMessagesRefresh();
  },
  "rooms-changed"() {
    api("/api/chat/rooms", { cache: `rooms-${Date.now()}` }).then((rooms) => {
      state.rooms = rooms;
      let movedFromDeletedRoom = false;
      if (!state.rooms.some((room) => Number(room.id) === Number(state.currentRoomId))) {
        state.currentRoomId = state.rooms.find((room) => String(room.name).toLowerCase() === "main room")?.id || state.rooms[0]?.id;
        localStorage.setItem("tct_current_room_id", String(state.currentRoomId || ""));
        movedFromDeletedRoom = true;
      }
      renderRooms();
      if (movedFromDeletedRoom) loadMessages().catch(() => {});
      if ($("#roomsView")?.classList.contains("active")) renderRoomGrid();
    }).catch((error) => toast(error.message));
  },
  "news-posted"(data = {}) {
    const newsIsOpen = $("#newsView").classList.contains("active");
    if (!data.comment && !newsIsOpen) markNewsUnread();
    resetNewsCache();
    if (newsIsOpen) {
      clearNewsUnread();
      renderNews({ force: true }).catch((error) => toast(error.message));
    }
  },
  "news-deleted"(data = {}) {
    resetNewsCache();
    if (data.all) {
      if ($("#newsView").classList.contains("active")) paintNews([]);
      return;
    }
    $(`[data-news-card="${Number(data.id)}"]`)?.remove();
    if ($("#newsView").classList.contains("active") && !$("[data-news-card]")) paintNews([]);
  },
  "report-created"() {
    refreshReportBadge().catch(() => {});
  },
};

function connectEventSourceFallback() {
  if (state.isGuest) return;
  if (state.eventSource) return;
  state.eventSource = new EventSource(`/api/chat/events?token=${encodeURIComponent(state.token)}`);
  state.eventSource.onopen = () => { state.eventRetryMs = 1500; };
  Object.entries(realtimeHandlers).forEach(([eventName, handler]) => {
    state.eventSource.addEventListener(eventName, (event) => {
      const data = event.data ? JSON.parse(event.data) : {};
      handler(data);
    });
  });
  state.eventSource.onerror = () => {
    state.eventSource?.close();
    state.eventSource = null;
    const retryAfter = state.eventRetryMs;
    state.eventRetryMs = Math.min(15000, Math.round(state.eventRetryMs * 1.8));
    setTimeout(() => {
      if (state.token && !state.socket && !state.eventSource) connectEvents();
    }, retryAfter);
    if (!document.hidden && Date.now() - state.lastSyncAt > 20000) refreshVisibleData().catch(() => {});
  };
}

function connectEvents() {
  if (state.socket || state.eventSource) return;
  if (state.preferEventSource) {
    connectEventSourceFallback();
    return;
  }
  if (window.io) {
    state.socket = window.io({
      auth: { token: state.token },
      transports: ["polling", "websocket"],
      upgrade: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 700,
      reconnectionDelayMax: 5000,
    });
    Object.entries(realtimeHandlers).forEach(([eventName, handler]) => {
      state.socket.on(eventName, handler);
    });
    state.socket.on("connect", () => {
      const needsCatchUp = Boolean(state.me && Date.now() - state.lastSyncAt > 20000);
      state.socket.emit("presence");
      const quizRoom = state.rooms.find((room) => String(room.name).toLowerCase() === "quiz room");
      if (!state.isGuest && Number(state.currentRoomId) === Number(quizRoom?.id)) state.socket.emit("quiz:subscribe", { roomId: quizRoom.id });
      if (!state.isGuest && window.QuizGame?.isOpen?.()) state.socket.emit("quiz:subscribe", { contest: true });
      clearInterval(state.presenceTimer);
      state.presenceTimer = setInterval(() => state.socket?.connected && state.socket.emit("presence"), 45000);
      if (needsCatchUp) refreshVisibleData({ force: true }).catch(() => {});
    });
    state.socket.on("connect_error", (error) => {
      if (state.isGuest) {
        console.warn("Guest Random Talk connection failed:", error.message);
        return;
      }
      console.warn("Live connection interrupted; Socket.IO is reconnecting.", error.message);
    });
    return;
  }
  connectEventSourceFallback();
}

async function refreshVisibleData({ force = false } = {}) {
  if (!state.token) return;
  if (state.isGuest) return;
  if (!state.me) {
    await bootstrap();
    return;
  }
  if (state.syncing) return;
  if (!force && Date.now() - state.lastSyncAt < 10000) return;
  state.syncing = true;
  state.lastSyncAt = Date.now();
  try {
    const results = await Promise.allSettled([
      force || Date.now() - Number(state.usersCacheAt || 0) > 45000 ? refreshUsersLight() : Promise.resolve(),
      $("#chatView").classList.contains("active") && (force || !state.messages.length || (!state.socket?.connected && !state.eventSource))
        ? loadMessages({ fresh: force })
        : Promise.resolve(),
      force || Date.now() - Number(state.pmUnreadCacheAt || 0) > 30000 ? refreshPmUnread() : Promise.resolve(),
      force || Date.now() - Number(state.friendsCacheAt || 0) > 60000 ? loadFriends() : Promise.resolve(),
      $("#newsView").classList.contains("active") ? renderNews({ force }) : Promise.resolve(),
      $("#leaderboardView").classList.contains("active") ? renderLeaderboard({ force }) : Promise.resolve(),
      $("#adminView").classList.contains("active") ? renderAdmin() : Promise.resolve(),
    ]);
    const authFailure = results.find((result) =>
      result.status === "rejected" &&
      (result.reason?.status === 401 || (result.reason?.status === 403 && /banned|kicked|login/i.test(result.reason?.message || "")))
    );
    if (authFailure) throw authFailure.reason;
  } finally {
    state.syncing = false;
  }
}

function handleReturnToPage() {
  if (document.hidden) {
    state.hiddenAt = Date.now();
    return;
  }
  const now = Date.now();
  const awayMs = state.hiddenAt ? now - state.hiddenAt : 0;
  state.hiddenAt = 0;
  if (awayMs >= 10000 && now - state.lastAfkSyncAt >= 5000) {
    state.lastAfkSyncAt = now;
    state.socket?.connected && state.socket.emit("presence");
    const quizRoom = state.rooms.find((room) => String(room.name || "").toLowerCase() === "quiz room");
    if (state.socket?.connected && Number(state.currentRoomId) === Number(quizRoom?.id)) {
      state.socket.emit("quiz:unsubscribe", { roomId: quizRoom.id });
      state.socket.emit("quiz:subscribe", { roomId: quizRoom.id });
    }
    refreshVisibleData({ force: true }).catch(() => {});
    return;
  }
  refreshVisibleData().catch(() => {});
}

function handleAuthFailure(_error) {
  localStorage.removeItem("tct_token");
  state.token = "";
  document.documentElement.classList.remove("returning-user");
  setSessionView("anonymous");
}

async function logout() {
  await window.RandomTalk?.close?.();
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  localStorage.removeItem("tct_token");
  location.reload();
}

function fillSelect(select, placeholder, items) {
  if (!select) return;
  select.innerHTML = `<option value="">${placeholder}</option>${items.map(([value, label]) => `<option value="${html(value)}">${html(label)}</option>`).join("")}`;
}

function setupDobSelects() {
  const day = $("#dobDay");
  const month = $("#dobMonth");
  const year = $("#dobYear");
  const input = $("#dobInput");
  if (!day || !month || !year || !input) return;

  const months = [
    ["01", "Jan"],
    ["02", "Feb"],
    ["03", "Mar"],
    ["04", "Apr"],
    ["05", "May"],
    ["06", "Jun"],
    ["07", "Jul"],
    ["08", "Aug"],
    ["09", "Sep"],
    ["10", "Oct"],
    ["11", "Nov"],
    ["12", "Dec"],
  ];
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 100 }, (_item, index) => {
    const value = String(currentYear - 13 - index);
    return [value, value];
  });

  fillSelect(month, "Month", months);
  fillSelect(year, "Year", years);

  const updateDays = () => {
    const selected = day.value;
    const total = month.value && year.value ? new Date(Number(year.value), Number(month.value), 0).getDate() : 31;
    fillSelect(day, "Day", Array.from({ length: total }, (_item, index) => {
      const value = String(index + 1).padStart(2, "0");
      return [value, value];
    }));
    if (selected && Number(selected) <= total) day.value = selected;
  };

  const updateValue = () => {
    updateDays();
    input.value = day.value && month.value && year.value ? `${year.value}-${month.value}-${day.value}` : "";
  };

  updateDays();
  [day, month, year].forEach((select) => select.addEventListener("change", updateValue));
}

function bindEvents() {
  setupWelcomeCrossTab();
  const welcomeDialog = $("#welcomeChoiceModal");
  $("#welcomeChoiceClose")?.addEventListener("click", () => finishWelcomeChoice("dismissed"));
  welcomeDialog?.addEventListener("cancel", (event) => {
    event.preventDefault();
    finishWelcomeChoice("dismissed");
  });
  welcomeDialog?.addEventListener("click", (event) => {
    if (event.target === welcomeDialog) finishWelcomeChoice("dismissed");
  });
  welcomeDialog?.addEventListener("close", () => {
    document.body.classList.remove("welcome-choice-open");
    welcomeRestoreFocus?.focus?.({ preventScroll: true });
    welcomeRestoreFocus = null;
  });
  $$('[data-welcome-choice]').forEach((button) => button.addEventListener("click", async () => {
    const choice = button.dataset.welcomeChoice;
    finishWelcomeChoice(choice);
    if (choice === "random-talk") {
      try {
        const feature = await loadRandomTalk();
        await feature.open();
      } catch (_error) {
        toast("Random Talk could not open right now. Open Rooms to retry; you can still join the Main Room.");
      }
      return;
    }
    try {
      await openMainRoomFromWelcome();
    } catch (_error) {
      toast("We couldn't open the Main Room right now. Please try again.");
    }
  }));

  $$("[data-auth-tab]").forEach((button) => button.addEventListener("click", () => selectAuthTab(button.dataset.authTab)));

  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
      state.token = data.token;
      state.isGuest = false;
      localStorage.removeItem("tct_guest_token");
      localStorage.setItem("tct_token", state.token);
      setSessionView("pending");
      await bootstrap();
    } catch (error) {
      $("#authMessage").textContent = error.message;
    }
  });

  $("#registerForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const payload = Object.fromEntries(new FormData(event.currentTarget));
      if (!payload.dob) {
        $("#authMessage").textContent = "Choose your day, month, and year of birth.";
        return;
      }
      delete payload.dobDay;
      delete payload.dobMonth;
      delete payload.dobYear;
      const data = await api("/api/auth/register", { method: "POST", body: JSON.stringify(payload) });
      state.token = data.token;
      state.isGuest = false;
      localStorage.removeItem("tct_guest_token");
      localStorage.setItem("tct_token", state.token);
      setSessionView("pending");
      await bootstrap();
    } catch (error) {
      $("#authMessage").textContent = error.message;
    }
  });

  $("#guestForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector("button[type='submit']");
    submit.disabled = true;
    try {
      const payload = Object.fromEntries(new FormData(event.currentTarget));
      if (!payload.terms) throw new Error("Please accept the safety notice to continue.");
      delete payload.terms;
      await startGuestAccess(payload);
    } catch (error) {
      $("#authMessage").textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });

  $$(".side-nav [data-view]").forEach((button) => button.addEventListener("click", async () => {
    setView(button.dataset.view);
    if (state.compactLayout) $("#app").classList.remove("nav-open");
    if (button.dataset.view === "admin") await renderAdmin();
  }));
  $$("[data-close-view]").forEach((button) => button.addEventListener("click", () => setView("chat")));
  $("#roomSearch")?.addEventListener("input", renderRoomGrid);
  $("#wallRefresh")?.addEventListener("click", () => renderFriendsWall({ force: true }).catch((error) => toast(error.message)));
  $("#friendsWallForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = String(new FormData(event.currentTarget).get("body") || "").trim();
    if (!body) return toast("Write something before posting.");
    const button = event.currentTarget.querySelector("button[type='submit']");
    button.disabled = true;
    try {
      await api(`/api/social/profiles/${state.me.id}/wall`, { method: "POST", body: JSON.stringify({ body }) });
      event.currentTarget.reset();
      state.friendsWallCache = null;
      state.profileSocialCache.delete(`${Number(state.me.id)}:wall`);
      await renderFriendsWall({ force: true });
      toast("Posted to your friends wall.");
    } finally {
      button.disabled = false;
    }
  });
  $("#reportFlagIcon").addEventListener("click", (event) => {
    event.stopPropagation();
    openReportQueueDrawer().catch((error) => toast(error.message));
  });
  $("#newsComposeButton")?.addEventListener("click", openNewsComposer);
  $("#menuButton").addEventListener("click", () => $("#app").classList.toggle("nav-open"));
  $("#roomSwitchButton")?.addEventListener("click", openRoomSwitcher);
  $("#rightToggleButton").addEventListener("click", () => {
    const app = $("#app");
    const opening = app.classList.contains("right-closed");
    app.classList.toggle("right-closed", !opening);
    $("#rightToggleButton").setAttribute("aria-expanded", String(opening));
    if (opening) {
      $("#drawer")?.classList.add("hidden");
      renderUsers();
    }
  });
  $("#closeRightPanel").addEventListener("click", () => {
    $("#app").classList.add("right-closed");
    $("#rightToggleButton").setAttribute("aria-expanded", "false");
  });
  $("#profileButton").addEventListener("click", () => {
    $("#app").classList.add("right-closed");
    $("#rightToggleButton").setAttribute("aria-expanded", "false");
    openOwnMenu();
  });
  $("#pmIcon").addEventListener("click", () => openPmConversations());
  $("#friendIcon").addEventListener("click", () => openFriendRequestDrawer());
  $("#notificationIcon").addEventListener("click", async () => {
    setDrawerChrome({ title: "Notifications" });
    const rows = await api("/api/social/notifications");
    $("#drawerBody").innerHTML = `
      <div class="notification-list">
        ${rows.map((n) => `
          <div class="request-row notification-row">
            <span><strong>${html(String(n.title || "Notification").slice(0, 80))}</strong><small>${html(String(n.body || "").slice(0, 140))}</small></span>
          </div>
        `).join("") || '<p class="muted">No notifications.</p>'}
      </div>
    `;
    showDrawer();
    await api("/api/social/notifications/read", { method: "POST" });
    state.notifications = rows.map((row) => ({ ...row, is_read: 1 }));
    setBadges();
  });
  $("#closeDrawer").addEventListener("click", () => {
    $("#drawer").classList.add("hidden");
    state.activePmUserId = null;
  });
  document.addEventListener("click", (event) => {
    const zoomTarget = event.target.closest("[data-zoom-src]");
    if (zoomTarget) {
      event.preventDefault();
      openImageZoom(zoomTarget.dataset.zoomSrc || zoomTarget.src);
      return;
    }
    if (!event.target.closest(".message-menu-wrap")) closeMessageMenus();
    if (!event.target.closest(".emoji-picker") && !event.target.closest("#composerEmojiAction") && !event.target.closest("#pmEmojiButton")) $(".emoji-picker")?.remove();
    if (!event.target.closest("#composerToolsMenu") && !event.target.closest("#composerToolsButton")) closeComposerTools();
    if (!$("#app")?.classList.contains("right-closed") && !event.target.closest(".right") && !event.target.closest("#rightToggleButton")) {
      $("#app").classList.add("right-closed");
      $("#rightToggleButton")?.setAttribute("aria-expanded", "false");
    }
    const drawer = $("#drawer");
    const drawerTrigger = event.target.closest("#profileButton, #pmIcon, #friendIcon, #notificationIcon, #reportFlagIcon, #roomSwitchButton, #pmSettingsButton, #pmExpandButton, [data-user-id], [data-open-user-menu], [data-open-profile-actions], [data-user-action-panel], [data-pm-user], [data-pm-open], [data-pm-start], [data-own-action], [data-view-profile], [data-report-chat], [data-delete-pm-chat]");
    if (drawer && !drawer.classList.contains("hidden") && !event.target.closest("#drawer") && !drawerTrigger) {
      drawer.classList.add("hidden");
      state.activePmUserId = null;
    }
  });
  $$("[data-user-tab]").forEach((button) => button.addEventListener("click", () => {
    state.userTab = button.dataset.userTab;
    $$("[data-user-tab]").forEach((b) => b.classList.remove("active"));
    button.classList.add("active");
    renderUsers();
    if (state.userTab === "search") $("#userListSearch")?.focus();
  }));
  $("#userListSearch")?.addEventListener("input", renderUsers);

  $("#messageForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.sendingMessage) return;
    const body = $("#messageInput").value.trim();
    if (!body && !state.uploadFile) return;
    const sendKey = `${state.currentRoomId}|${state.replyToId || ""}|${body}|${state.uploadFile?.name || ""}|${state.uploadFile?.size || 0}`;
    if (sendKey === state.lastSentKey && Date.now() - state.lastSentAt < 2000) return;
    const submitButton = $("#messageForm button[type='submit']");
    const roomId = state.currentRoomId;
    const replyToId = state.replyToId;
    const isBotCommand = /^\/(?:bet|confess|ship|steal|hunt|roast)(?:\s|$)/i.test(body);
    const optimistic = Boolean(body && !state.uploadFile && body.toLowerCase() !== "/clear" && !isBotCommand);
    const pendingId = `pending-${Date.now()}`;
    state.sendingMessage = true;
    submitButton.disabled = true;
    try {
      if (body.toLowerCase() === "/clear") {
        await api(`/api/chat/rooms/${state.currentRoomId}/messages`, { method: "DELETE" });
        $("#messageInput").value = "";
        $("#charCount").textContent = "0/1200";
        clearMessageAttachment();
        toast("Room cleared.");
        return;
      }
      let requestBody;
      if (state.uploadFile) {
        requestBody = new FormData();
        requestBody.append("body", body);
        if (replyToId) requestBody.append("replyToId", replyToId);
        requestBody.append("attachment", state.uploadFile);
      } else {
        requestBody = JSON.stringify({ body, replyToId: replyToId || null });
      }
      if (optimistic) {
        state.messages.push({
          id: pendingId,
          room_id: roomId,
          user_id: state.me.id,
          username: state.me.username,
          rank_name: state.me.rank,
          profile_title: state.me.profileTitle,
          avatar_url: avatar(state.me),
          username_color: state.me.usernameColor,
          text_color: state.me.textColor,
          bubble_style: state.me.bubbleStyle,
          frame: state.me.frame,
          body,
          reply_to_id: replyToId,
          created_at: new Date().toISOString(),
          pending: true,
        });
        $("#messageInput").value = "";
        $("#charCount").textContent = "0/1200";
        renderMessages();
      }
      const sent = await api(`/api/chat/rooms/${roomId}/messages`, { method: "POST", body: requestBody });
      if (Number(state.currentRoomId) === Number(roomId)) {
        const alreadyConfirmed = sent.id && state.messages.some((message) => Number(message.id) === Number(sent.id));
        if (!sent.private && !alreadyConfirmed && !confirmOptimisticMessage(pendingId, sent)) {
          state.messages.push(sent);
          renderMessages();
        }
      }
      if (!sent.private && String(sent.body || "").startsWith(betPrefix)) {
        try {
          const bet = JSON.parse(sent.body.slice(betPrefix.length));
          if (Number.isFinite(Number(bet.balance))) {
            state.me.gold = Number(bet.balance);
            if (state.storeCache) state.storeCache.gold = Number(bet.balance);
          }
        } catch (_error) {}
      }
      if (sent.wallet) {
        if (Number.isFinite(Number(sent.wallet.gold))) {
          state.me.gold = Number(sent.wallet.gold);
          if (state.storeCache) state.storeCache.gold = Number(sent.wallet.gold);
        }
        if (Number.isFinite(Number(sent.wallet.diamonds))) {
          state.me.diamonds = Number(sent.wallet.diamonds);
          if (state.storeCache) state.storeCache.diamonds = Number(sent.wallet.diamonds);
        }
      }
      if (sent.private && sent.message) toast(sent.message);
      if (!optimistic) {
        $("#messageInput").value = "";
        $("#charCount").textContent = "0/1200";
      }
      state.replyToId = null;
      $("#replyBox").classList.add("hidden");
      $("#slashSuggestions").classList.add("hidden");
      clearMessageAttachment();
      state.lastSentKey = sendKey;
      state.lastSentAt = Date.now();
    } catch (error) {
      if (optimistic) {
        state.messages = state.messages.filter((message) => message.id !== pendingId);
        if (!$("#messageInput").value) $("#messageInput").value = body;
        $("#charCount").textContent = `${$("#messageInput").value.length}/1200`;
        renderMessages();
      }
      toast(error.message);
    } finally {
      state.sendingMessage = false;
      submitButton.disabled = false;
    }
  });
  $("#messageInput").addEventListener("input", () => {
    $("#charCount").textContent = `${$("#messageInput").value.length}/1200`;
    renderSlashSuggestions();
  });
  $("#clearReply").addEventListener("click", () => { state.replyToId = null; $("#replyBox").classList.add("hidden"); });
  $("#composerToolsButton").addEventListener("click", (event) => {
    event.stopPropagation();
    toggleComposerTools();
  });
  $("#composerImageAction").addEventListener("click", () => {
    closeComposerTools();
    $("#messageAttachment").click();
  });
  $("#composerEmojiAction").addEventListener("click", () => {
    closeComposerTools();
    openEmojiPicker("#messageInput", $("#composerToolsButton"));
  });
  $("#composerVoiceAction").addEventListener("click", () => {
    closeComposerTools();
    toggleVoiceRecording({ type: "room", roomId: state.currentRoomId });
  });
  $("#messageAttachment").addEventListener("change", () => {
    selectMessageAttachment($("#messageAttachment").files[0]);
  });
  $("#uploadPreview").addEventListener("click", (event) => {
    if (event.target.closest("#removeMessageAttachment")) clearMessageAttachment();
    if (event.target.closest("#stopVoiceRecording")) toggleVoiceRecording(state.voiceTarget);
  });
  window.addEventListener("resize", syncResponsiveLayout);
  $("#avatarUpload").addEventListener("change", () => {
    const file = $("#avatarUpload").files[0];
    if (file) $("#editAvatarPreview").src = URL.createObjectURL(file);
  });
  $("#bannerUpload").addEventListener("change", () => {
    const file = $("#bannerUpload").files[0];
    if (file) $("#editBannerPreview").style.setProperty("--edit-banner", `url('${URL.createObjectURL(file)}')`);
  });
  $("#profileMusicUpload")?.addEventListener("change", () => {
    const file = $("#profileMusicUpload").files[0];
    if (!file) return;
    $("#profileSoundPreview").innerHTML = `<audio controls preload="metadata" src="${URL.createObjectURL(file)}"></audio><span>${html(file.name)}</span>`;
  });
  $("#removeAvatarButton")?.addEventListener("click", async () => {
    const result = await api("/api/auth/me/avatar", { method: "DELETE" });
    state.me.avatarUrl = result.avatarUrl;
    $("#editAvatarPreview").src = result.avatarUrl;
    $("#topAvatar").src = result.avatarUrl;
    toast("Profile photo removed.");
  });
  $("#removeBannerButton")?.addEventListener("click", async () => {
    const result = await api("/api/auth/me/banner", { method: "DELETE" });
    state.me.bannerUrl = result.bannerUrl;
    $("#editBannerPreview").style.setProperty("--edit-banner", `url('${result.bannerUrl}')`);
    toast("Profile cover removed.");
  });
  $("#removeProfileMusicButton")?.addEventListener("click", async () => {
    await api("/api/social/store/profile-music", { method: "DELETE" });
    state.me.profileMusicUrl = null;
    $("#profileMusicUpload").value = "";
    $("#profileSoundPreview").innerHTML = "<span>No track added</span>";
    toast("Profile soundtrack removed.");
  });
  $$("[data-edit-jump]").forEach((button) => button.addEventListener("click", () => {
    $(`#${button.dataset.editJump}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  $("#editProfileForm").profileStatus.addEventListener("change", (event) => updateStatusPreview(event.currentTarget.value));
  $("#editProfileForm").bio.addEventListener("input", () => {
    $("#bioCount").textContent = `${$("#editProfileForm").bio.value.length}/120`;
  });
  $$("[data-accent]").forEach((button) => button.addEventListener("click", () => {
    $("#editProfileForm").profileAccent.value = button.dataset.accent;
    $$("[data-accent]").forEach((node) => node.classList.toggle("active", node === button));
  }));

  $$("[data-close-modal]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  $("#profileModal").addEventListener("cancel", (event) => {
    if (!$("#profileActionOverlay")?.classList.contains("hidden")) {
      event.preventDefault();
      closeProfileActionsOverlay();
    }
  });
  $("#profileModal").addEventListener("close", () => {
    stopProfileMusic();
    closeProfileActionsOverlay();
    state.activeProfileUserId = null;
  });
  $("#editProfileModal").addEventListener("close", () => {});
  $$(".profile-tabs [data-profile-tab]").forEach((button) => button.addEventListener("click", () => {
    $$(".profile-tabs button").forEach((b) => b.classList.remove("active"));
    $$(".profile-tab").forEach((panel) => panel.classList.remove("active"));
    button.classList.add("active");
    $(`#profile${button.dataset.profileTab[0].toUpperCase()}${button.dataset.profileTab.slice(1)}`).classList.add("active");
    if (button.dataset.profileTab === "wall" && state.activeProfileUserId) {
      loadProfileSection(state.activeProfileUserId, button.dataset.profileTab).catch((error) => toast(error.message));
    }
    if (button.dataset.profileTab === "intel" && state.activeProfileUserId) loadProfileIntel(state.activeProfileUserId).catch((error) => toast(error.message));
  }));

  $("#editProfileForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = $(".edit-profile-head button[type='submit']");
    submitButton.disabled = true;
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    payload.showOnlineStatus = event.currentTarget.showOnlineStatus.checked;
    payload.showCountry = event.currentTarget.showCountry.checked;
    payload.showAge = event.currentTarget.showAge.checked;
    payload.showGender = event.currentTarget.showGender.checked;
    if (event.currentTarget.profileTitle.disabled) delete payload.profileTitle;
    if (event.currentTarget.profileStatus.disabled) delete payload.profileStatus;
    delete payload.level;
    try {
      const result = await api("/api/auth/me", { method: "PATCH", body: JSON.stringify(payload) });
      state.me = { ...state.me, ...(result.me || {}) };
      if ($("#avatarUpload").files[0]) {
        const form = new FormData();
        form.append("avatar", $("#avatarUpload").files[0]);
        const avatarResult = await api("/api/auth/me/avatar", { method: "POST", body: form });
        state.me.avatarUrl = avatarResult.avatarUrl;
      }
      if ($("#bannerUpload").files[0]) {
        const form = new FormData();
        form.append("banner", $("#bannerUpload").files[0]);
        const bannerResult = await api("/api/auth/me/banner", { method: "POST", body: form });
        state.me.bannerUrl = bannerResult.bannerUrl;
      }
      if ($("#profileMusicUpload")?.files[0]) {
        const form = new FormData();
        form.append("music", $("#profileMusicUpload").files[0]);
        const musicResult = await api("/api/social/store/profile-music", { method: "POST", body: form });
        state.me.profileMusicUrl = musicResult.profileMusicUrl;
      }
      state.users = state.users.map((user) => Number(user.id) === Number(state.me.id) ? { ...user, ...state.me } : user);
      state.profileCache.delete(Number(state.me.id));
      state.profileSocialCache.delete(`${Number(state.me.id)}:wall`);
      $("#topName").textContent = displayName(state.me);
      $("#topAvatar").src = avatar(state.me);
      if ($("#wallComposerAvatar")) $("#wallComposerAvatar").src = avatar(state.me);
      applyTheme(state.me.theme || "dark");
      renderUsers();
      if ($("#profilesView").classList.contains("active")) renderProfiles();
      $("#editProfileModal").close();
      toast("Profile updated.");
    } catch (error) {
      toast(error.message);
    } finally {
      submitButton.disabled = false;
    }
  });
  $("#changePasswordButton").addEventListener("click", async () => {
    const currentPassword = prompt("Current password");
    const newPassword = prompt("New password");
    if (currentPassword && newPassword) await api("/api/auth/me/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
  });
  $("#deleteRequestButton").addEventListener("click", async () => alert((await api("/api/auth/me/delete-request", { method: "POST" })).message));
  $("#cancelDeleteButton").addEventListener("click", async () => alert((await api("/api/auth/me/cancel-delete", { method: "POST" })).message));
  document.addEventListener("visibilitychange", handleReturnToPage);
  window.addEventListener("focus", handleReturnToPage);
  window.addEventListener("pageshow", handleReturnToPage);
  window.addEventListener("online", handleReturnToPage);
  $("#imageLightbox")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-lightbox]") || event.target.id === "imageLightbox") closeImageZoom();
  });
}

window.TCTGameBridge = {
  api,
  html,
  toast,
  renderGames,
  getState: () => state,
  socketConnected: () => Boolean(state.socket?.connected),
};
window.TCTQuizBridge = {
  api,
  html,
  toast,
  renderGames,
  getState: () => state,
  socketConnected: () => Boolean(state.socket?.connected),
  emit: (event, payload) => state.socket?.connected && state.socket.emit(event, payload),
  openQuizRoom: async () => {
    const room = state.rooms.find((item) => String(item.name || "").toLowerCase() === "quiz room");
    if (!room) return toast("Quiz Room is still being prepared. Try again shortly.");
    await switchRoom(room.id);
    state.socket?.connected && state.socket.emit("quiz:subscribe", { roomId: room.id });
  },
};
window.TCTRandomTalkBridge = {
  api,
  html,
  toast,
  getState: () => state,
  socketConnected: () => Boolean(state.socket?.connected),
  emit: (event, payload) => state.socket?.connected && state.socket.emit(event, payload),
  isGuest: () => state.isGuest,
  openAuth: (tab) => leaveGuestForAuth(tab),
  openStore: async () => { await window.RandomTalk?.close?.(); setView("store"); },
};

applyTheme(localStorage.getItem("tct_theme") || "dark");
setupDobSelects();
bindEvents();
if (state.token) {
  setSessionView("pending");
  bootstrap().catch((error) => {
    if (error.status === 401 || error.status === 403) handleAuthFailure(error);
    else {
      toast("Connection is waking up. Tap refresh if the room stays empty.");
    }
  });
} else if (state.guestToken) {
  setSessionView("anonymous");
  resumeGuestAccess();
} else {
  setSessionView("anonymous");
}
