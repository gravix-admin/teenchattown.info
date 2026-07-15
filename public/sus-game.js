(function () {
  "use strict";

  let root = null;
  let current = null;
  let open = false;
  let ticker = null;
  let lastReward = null;

  const presets = [
    "I was in Security.", "I completed a task.", "I saw someone nearby.", "I found the body.",
    "I suspect this player.", "I was with this player.", "Skip the vote.", "That statement is false.",
  ];
  const frameAssets = {
    cosmic: "/assets/frame-cosmic.png", solar: "/assets/frame-solar.png", prism: "/assets/frame-prism.png",
    gothic: "/assets/frame-gothic.png", angelic: "/assets/frame-angelic.png", "classic-gold": "/assets/frame-classic-gold.png",
    "royal-laurel": "/assets/frame-royal-laurel.png", "sun-throne": "/assets/frame-sun-throne.png",
  };

  function bridge() { return window.TCTGameBridge; }
  function esc(value) { return bridge().html(value); }
  function api(path, options) { return bridge().api(path, options); }
  function toast(message) { bridge().toast(message); }
  function post(path, body = {}) { return api(`/api/games/sus${path}`, { method: "POST", body: JSON.stringify(body) }); }
  function me() { return current?.players?.find((player) => Number(player.userId) === Number(current.viewerUserId)); }
  function secondsLeft(value) { return value ? Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 1000)) : 0; }
  function clock(seconds) { const value = Math.max(0, Number(seconds || 0)); return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`; }
  function phaseLabel(value) { return String(value || "Lobby").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  function avatarMarkup(player, className = "") {
    const appearance = player.appearance || player;
    const frame = frameAssets[appearance.frame] || "";
    return `<span class="sus-avatar ${esc(className)}"><img class="sus-avatar-image" src="${esc(appearance.avatar || "/assets/avatar-other.svg")}" alt="" loading="lazy" decoding="async" />${frame ? `<img class="sus-avatar-frame" src="${frame}" alt="" loading="lazy" decoding="async" />` : ""}</span>`;
  }

  function cardHtml() {
    return `
      <section class="sus-feature-card">
        <div class="sus-feature-art" aria-hidden="true"></div>
        <div class="sus-feature-copy">
          <span class="eyebrow">Blackout Station</span><h3>SUS</h3>
          <p>Trust no one. Complete tasks, uncover lies, and survive.</p>
          <div class="sus-meta-row"><span>Social deduction</span><span>6–10 players</span><span>8–12 minutes</span><span>Strategic</span></div>
          <div class="sus-actions"><button class="primary" data-sus-quick-card type="button">Quick Play</button><button data-open-sus type="button">Create or Join</button><button data-sus-guide-card type="button">How to Play</button></div>
        </div>
      </section>`;
  }

  function bindCard(container) {
    container.querySelector("[data-open-sus]")?.addEventListener("click", () => openHome());
    container.querySelector("[data-sus-quick-card]")?.addEventListener("click", async (event) => {
      event.currentTarget.disabled = true;
      try { current = await post("/quick"); open = true; root = container; renderCurrent(); }
      catch (error) { toast(error.message); event.currentTarget.disabled = false; }
    });
    container.querySelector("[data-sus-guide-card]")?.addEventListener("click", () => tutorial(container));
  }

  function shell(content, title = "SUS") {
    const living = current?.players?.filter((player) => player.alive).length;
    const taskLabel = current?.taskProgress?.total ? `${current.taskProgress.completed}/${current.taskProgress.total} tasks` : "";
    return `
      <section class="sus-shell" data-sus-shell>
        <header class="sus-topbar">
          <div class="sus-brand"><button class="sus-button" data-sus-back type="button">‹</button><b>S</b><span><strong>${esc(title)}</strong><small>Blackout Station</small></span></div>
          <div class="sus-phase-strip"><span>${esc(phaseLabel(current?.currentPhase || "home"))}</span><strong data-sus-countdown>${current?.phaseEndsAt ? clock(secondsLeft(current.phaseEndsAt)) : "LIVE"}</strong></div>
          <div class="sus-status-metrics">${current?.currentRound ? `<span>R${current.currentRound}</span>` : ""}${living !== undefined ? `<span>${living} alive</span>` : ""}${taskLabel ? `<span>${taskLabel}</span>` : ""}</div>
          <span class="sus-connection ${bridge().socketConnected() ? "" : "offline"}" data-sus-connection>${bridge().socketConnected() ? "Socket connected" : "Reconnecting"}</span>
        </header>
        ${content}
      </section>`;
  }

  function bindBack() {
    root?.querySelector("[data-sus-back]")?.addEventListener("click", () => {
      if (current && !["ended", "abandoned"].includes(current.status)) return openHome();
      leaveView();
      bridge().renderGames();
    });
  }

  function startTicker() {
    clearInterval(ticker);
    const paint = () => {
      const node = root?.querySelector("[data-sus-countdown]");
      if (node) node.textContent = current?.phaseEndsAt ? clock(secondsLeft(current.phaseEndsAt)) : "LIVE";
      root?.querySelectorAll("[data-sus-cooldown]").forEach((item) => {
        const left = secondsLeft(item.dataset.susCooldown);
        item.textContent = left ? `${left}s` : "Ready";
      });
      const connection = root?.querySelector("[data-sus-connection]");
      if (connection) {
        const connected = bridge().socketConnected();
        connection.textContent = connected ? "Socket connected" : "Reconnecting";
        connection.classList.toggle("offline", !connected);
      }
    };
    paint(); ticker = setInterval(paint, 1000);
  }

  async function openHome(target = null) {
    root = target || root || document.querySelector("#gamesHub");
    if (!root) return;
    open = true;
    root.innerHTML = '<div class="view-loading"><span></span><strong>Opening Blackout Station...</strong></div>';
    try {
      const data = await api("/api/games/sus/");
      current = data.current || null;
      if (current) return renderCurrent();
      renderHome(data);
    } catch (error) {
      root.innerHTML = `<div class="pm-empty"><strong>SUS is reconnecting</strong><span>${esc(error.message)}</span><button class="sus-button" data-sus-retry type="button">Try again</button></div>`;
      root.querySelector("[data-sus-retry]")?.addEventListener("click", () => openHome(root));
    }
  }

  function renderHome(data = { lobbies: [] }) {
    const lobbies = data.lobbies || [];
    root.innerHTML = shell(`
      <div class="sus-body">
        <section class="sus-home-hero"><span class="eyebrow">Teen Chat Town original</span><h2>SUS</h2><p>Complete real station tasks, watch the people around you, and decide who deserves your trust before Blackout Station falls.</p><div class="sus-actions"><button class="primary" data-sus-quick type="button">Quick Play</button><button data-sus-create type="button">Create Lobby</button><button data-sus-join-code type="button">Join by Code</button></div></section>
        <div class="sus-home-grid">
          <section class="sus-panel"><h3>Public lobbies</h3><div class="sus-lobby-list">${lobbies.map((lobby) => `<div class="sus-lobby-row"><span><strong>${esc(lobby.hostName)}'s station</strong><small>${lobby.players}/${lobby.maxPlayers} players · code ${esc(lobby.lobbyCode)}</small></span><button class="sus-button" data-sus-join="${esc(lobby.id)}" type="button">Join</button></div>`).join("") || '<div class="sus-empty">No public lobbies yet. Quick Play can open one.</div>'}</div></section>
          <aside class="sus-panel"><h3>Mission brief</h3><div class="sus-event-list"><div class="sus-event-row"><strong>Residents</strong><small>Finish tasks or identify every Shadow.</small></div><div class="sus-event-row"><strong>Shadows</strong><small>Sabotage the station and reach control parity.</small></div><div class="sus-event-row"><strong>Movement</strong><small>Tap connected rooms. No joystick or heavy 3D scene.</small></div></div><button class="sus-button" data-sus-guide type="button">Open visual guide</button></aside>
        </div>
      </div>`, "SUS");
    bindBack(); startTicker();
    root.querySelector("[data-sus-quick]")?.addEventListener("click", async (event) => act(event.currentTarget, async () => { current = await post("/quick"); renderCurrent(); }));
    root.querySelector("[data-sus-create]")?.addEventListener("click", createLobbyModal);
    root.querySelector("[data-sus-join-code]")?.addEventListener("click", joinCodeModal);
    root.querySelector("[data-sus-guide]")?.addEventListener("click", () => tutorial(root));
    root.querySelectorAll("[data-sus-join]").forEach((button) => button.addEventListener("click", async () => act(button, async () => { current = await post("/lobbies/join", { matchId: button.dataset.susJoin }); renderCurrent(); })));
    if (localStorage.getItem("tct_sus_tutorial_hidden") !== "1" && sessionStorage.getItem("tct_sus_tutorial_seen") !== "1") {
      sessionStorage.setItem("tct_sus_tutorial_seen", "1");
      setTimeout(() => open && !current && tutorial(root), 250);
    }
  }

  function overlay(content) {
    document.querySelector("#susOverlay")?.remove();
    document.body.insertAdjacentHTML("beforeend", `<div class="sus-overlay" id="susOverlay"><section class="sus-modal">${content}</section></div>`);
    const node = document.querySelector("#susOverlay");
    node.addEventListener("click", (event) => { if (event.target === node || event.target.closest("[data-sus-close]")) node.remove(); });
    return node;
  }

  function createLobbyModal() {
    const node = overlay(`<div class="sus-modal-head"><div><span class="eyebrow">New station</span><h3>Create SUS lobby</h3></div><button data-sus-close type="button">×</button></div><form id="susCreateForm" class="sus-settings"><label>Visibility<select name="visibility"><option value="public">Public</option><option value="private">Private</option></select></label><label>Maximum players<select name="maxPlayers"><option>6</option><option>8</option><option selected>10</option></select></label><label>Shadows<select name="numberOfShadows"><option>1</option><option selected>2</option><option>3</option></select></label><button class="sus-button primary" type="submit">Create lobby</button></form>`);
    node.querySelector("form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = Object.fromEntries(new FormData(event.currentTarget));
      current = await post("/lobbies", { visibility: form.visibility, settings: form });
      node.remove(); renderCurrent();
    });
  }

  function joinCodeModal() {
    const node = overlay(`<div class="sus-modal-head"><h3>Join private lobby</h3><button data-sus-close type="button">×</button></div><form id="susJoinForm" class="sus-task-control"><input name="lobbyCode" maxlength="8" placeholder="Lobby code" autocomplete="off" required /><button class="sus-button primary" type="submit">Join station</button></form>`);
    node.querySelector("form").addEventListener("submit", async (event) => {
      event.preventDefault();
      try { current = await post("/lobbies/join", Object.fromEntries(new FormData(event.currentTarget))); node.remove(); renderCurrent(); }
      catch (error) { toast(error.message); }
    });
  }

  function tutorial(target = root) {
    const node = overlay(`<div class="sus-modal-head"><div><span class="eyebrow">Visual guide</span><h3>How SUS works</h3></div><button data-sus-close type="button">×</button></div><div class="sus-tutorial-grid"><article><h4>Your faction</h4><p>Your private role card explains your goal. Shadows know their teammates; Residents do not.</p></article><article><h4>Move</h4><p>Tap a connected room and wait for the short station transition.</p></article><article><h4>Tasks</h4><p>Go to the listed room and finish the validated mini-game.</p></article><article><h4>Reports</h4><p>Report a broken signal in your room to stop movement and begin discussion.</p></article><article><h4>Discuss</h4><p>Use facts, local sightings, replies, and evidence. Dead chat remains separate.</p></article><article><h4>Vote</h4><p>Choose one living player or skip. Every vote is checked by the server.</p></article><article><h4>Sabotage</h4><p>Shadows can disrupt lights, communications, doors, or the reactor.</p></article><article><h4>Win</h4><p>Residents finish tasks or eliminate Shadows. Shadows reach parity or expire the reactor.</p></article></div><label class="tool-enable-row"><input id="susTutorialDismiss" type="checkbox" /> Do not show this automatically again</label>`);
    node.querySelector("#susTutorialDismiss")?.addEventListener("change", (event) => localStorage.setItem("tct_sus_tutorial_hidden", event.currentTarget.checked ? "1" : "0"));
    void target;
  }

  async function act(button, fn) {
    if (button) button.disabled = true;
    try { await fn(); }
    catch (error) { toast(error.message); }
    finally { if (button?.isConnected) button.disabled = false; }
  }

  function rankBadge(player) {
    const rank = /^[a-z0-9-]+$/i.test(String(player.rank || "")) ? String(player.rank).toLowerCase() : "user";
    return `<img class="sus-rank-badge" src="/assets/badge-${rank}.svg" alt="${esc(rank)}" loading="lazy" decoding="async" />`;
  }

  function playerCard(player) {
    const color = /^#[0-9a-f]{3,8}$/i.test(String(player.usernameColor || "")) ? player.usernameColor : "";
    return `<article class="sus-player-card ${player.ready ? "ready" : ""} ${player.connected ? "" : "signal-lost"}">${avatarMarkup(player)}<span><strong style="${color ? `color:${color}` : ""}">${esc(player.displayName || player.username)}</strong><small>${rankBadge(player)}${esc(player.profileTitle || player.rank)} · ${player.connected ? (player.ready ? "Ready" : "Waiting") : "Signal lost"}</small>${Number(player.userId) === Number(current.hostUserId) ? '<i class="sus-host-mark">HOST</i>' : ""}</span><i class="sus-ready-dot"></i></article>`;
  }

  function renderLobby() {
    const mine = me();
    const host = Number(current.hostUserId) === Number(current.viewerUserId);
    const settings = current.settings;
    root.innerHTML = shell(`
      <div class="sus-body">
        <div class="sus-lobby-head"><div><span class="eyebrow">${esc(current.visibility)} lobby</span><h2>Assemble the station crew</h2><span class="sus-code">${esc(current.lobbyCode)}</span></div><div class="sus-toolbar"><button class="sus-button" data-copy-code type="button">Copy code</button><button class="sus-button" data-sus-settings-toggle type="button">Settings</button></div></div>
        <section class="sus-panel"><div class="pm-section-title"><span>Players</span><small>${current.players.length}/${settings.maxPlayers}</small></div><div class="sus-player-grid">${current.players.map(playerCard).join("")}</div></section>
        <form class="sus-panel sus-settings hidden" id="susSettingsForm">
          <label>Visibility<select name="visibility"><option value="public" ${current.visibility === "public" ? "selected" : ""}>Public</option><option value="private" ${current.visibility === "private" ? "selected" : ""}>Private</option></select></label>
          <label>Players<input name="maxPlayers" type="number" min="6" max="10" value="${settings.maxPlayers}" /></label>
          <label>Shadows<input name="numberOfShadows" type="number" min="1" max="3" value="${settings.numberOfShadows}" /></label>
          <label>Tasks<input name="taskCount" type="number" min="3" max="5" value="${settings.taskCount}" /></label>
          <label>Discussion seconds<input name="discussionDuration" type="number" min="30" max="120" value="${settings.discussionDuration}" /></label>
          <label>Voting seconds<input name="votingDuration" type="number" min="20" max="90" value="${settings.votingDuration}" /></label>
          <label>Movement seconds<input name="movementSpeed" type="number" min="2" max="4" value="${settings.movementSpeed}" /></label>
          <label>Emergency meetings<input name="emergencyMeetingLimit" type="number" min="0" max="2" value="${settings.emergencyMeetingLimit}" /></label>
          <label class="sus-check"><input name="anonymousVoting" type="checkbox" ${settings.anonymousVoting ? "checked" : ""} /> Anonymous voting</label>
          <label class="sus-check"><input name="roleRevealOnElimination" type="checkbox" ${settings.roleRevealOnElimination ? "checked" : ""} /> Reveal eliminated roles</label>
          ${host ? '<button class="sus-button primary" type="submit">Save settings</button>' : '<small>Only the host can change settings.</small>'}
        </form>
        <div class="sus-actions"><button class="sus-button primary" data-sus-ready type="button">${mine?.ready ? "Not ready" : "Ready"}</button>${host ? '<button class="sus-button primary" data-sus-start type="button">Start Game</button>' : ""}<button class="sus-button" data-copy-code type="button">Invite</button><button class="sus-button danger" data-sus-leave type="button">Leave</button></div>
        <section class="sus-panel"><div class="sus-event-list">${current.eventLog.map((event) => `<div class="sus-event-row"><strong>${esc(event.text)}</strong><small>${new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></div>`).join("")}</div></section>
      </div>`, "SUS Lobby");
    bindBack(); bindCommonLobby(); startTicker();
  }

  function bindCommonLobby() {
    root.querySelectorAll("[data-copy-code]").forEach((button) => button.addEventListener("click", async () => { await navigator.clipboard.writeText(current.lobbyCode); toast("Lobby code copied."); }));
    root.querySelector("[data-sus-settings-toggle]")?.addEventListener("click", () => root.querySelector("#susSettingsForm")?.classList.toggle("hidden"));
    root.querySelector("[data-sus-ready]")?.addEventListener("click", async (event) => act(event.currentTarget, async () => { current = await post("/lobbies/ready", { matchId: current.id, ready: !me()?.ready }); renderLobby(); }));
    root.querySelector("[data-sus-start]")?.addEventListener("click", async (event) => act(event.currentTarget, async () => { current = await post("/lobbies/start", { matchId: current.id }); renderCurrent(); }));
    root.querySelector("[data-sus-leave]")?.addEventListener("click", async () => { if (!confirm("Leave this SUS lobby or match? Leaving an active match removes rewards.")) return; await post("/leave", { matchId: current.id }); current = null; openHome(root); });
    root.querySelector("#susSettingsForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const settings = Object.fromEntries(new FormData(event.currentTarget));
      settings.anonymousVoting = event.currentTarget.anonymousVoting.checked;
      settings.roleRevealOnElimination = event.currentTarget.roleRevealOnElimination.checked;
      current = await post("/lobbies/settings", { matchId: current.id, settings });
      renderLobby();
    });
  }

  function renderRoleReveal() {
    const info = current.me.roleInfo || {};
    root.innerHTML = shell(`<div class="sus-role-reveal"><article class="sus-role-card ${current.me.faction === "Shadows" ? "shadow" : ""}"><span class="eyebrow">You are the</span><div class="sus-role-sigil">${current.me.faction === "Shadows" ? "!" : "S"}</div><h2>${esc(current.me.role)}</h2><strong>${esc(current.me.faction)}</strong><p>${esc(info.objective || "Read the station and play your role.")}</p><div class="sus-panel"><strong>Ability</strong><p>${esc(info.ability || "Complete tasks and vote carefully.")}</p></div><small class="sus-muted">The station opens when the countdown ends.</small></article></div>`, "Role Reveal");
    bindBack(); startTicker();
  }

  function occupants() {
    return current.players.filter((player) => player.currentRoom === current.me.currentRoom && player.connected).map((player) => {
      const appearance = player.appearance || player;
      return `<span class="sus-occupant ${player.alive ? "" : "dead"}">${avatarMarkup(player)}<strong>${esc(appearance.displayName || appearance.username)}</strong></span>`;
    }).join("") || '<span class="sus-muted">No other signals in this room.</span>';
  }

  function taskRows() {
    return current.me.tasks.map((task) => `<button class="sus-task-row ${task.complete ? "complete" : ""}" data-sus-task="${task.id}" type="button" ${task.complete ? "disabled" : ""}><strong>${task.complete ? "✓ " : ""}${esc(task.title)}</strong><small>${esc(task.room)} · ${task.complete ? "complete" : task.room === current.me.currentRoom ? "available here" : "travel required"}</small></button>`).join("");
  }

  function eventRows() { return current.eventLog.map((event) => `<div class="sus-event-row"><strong>${esc(event.text)}</strong><small>${esc(event.room || phaseLabel(event.type))}</small></div>`).join(""); }

  function renderAction() {
    const moving = Boolean(current.me.movingTo);
    const sabotage = current.sabotage;
    const connected = current.map.rooms[current.me.currentRoom] || [];
    const progress = current.taskProgress.total ? Math.round(current.taskProgress.completed / current.taskProgress.total * 100) : 0;
    const sameRoomLiving = current.players.filter((player) => player.alive && player.currentRoom === current.me.currentRoom && Number(player.userId) !== Number(current.viewerUserId));
    const roleHasAbility = ["Investigator", "Medic", "Infiltrator", "Mimic"].includes(current.me.role) || sabotage;
    root.innerHTML = shell(`<div class="sus-body"><div class="sus-game-layout"><main class="sus-scene ${sabotage?.type === "lights" ? "sabotage-lights" : ""}"><div class="sus-scene-content"><div class="sus-room-head"><span class="eyebrow">Round ${current.currentRound}</span><h2>${esc(current.me.currentRoom)}</h2><div class="sus-occupants">${occupants()}</div></div><div><div class="sus-route-grid">${connected.map((room) => `<button data-sus-move="${esc(room)}" type="button" ${moving ? "disabled" : ""}>Go to ${esc(room)}</button>`).join("")}</div></div></div>${moving ? `<div class="sus-movement"><div><span></span><strong>Travelling to ${esc(current.me.movingTo)}</strong></div></div>` : ""}</main><aside class="sus-side"><section class="sus-panel"><div class="pm-section-title"><span>Station tasks</span><small>${current.taskProgress.completed}/${current.taskProgress.total}</small></div><div class="sus-progress"><i style="width:${progress}%"></i></div><div class="sus-task-list">${taskRows()}</div></section>${sabotage ? `<section class="sus-sabotage"><strong>${esc(phaseLabel(sabotage.type))} failure</strong><small>${sabotage.endsAt ? `${clock(secondsLeft(sabotage.endsAt))} remaining` : "Repair systems to clear the disruption."}</small></section>` : ""}<section class="sus-panel"><h3>Public events</h3><div class="sus-event-list">${eventRows()}</div></section></aside></div></div><nav class="sus-action-bar"><button data-sus-map type="button">Map</button><button data-sus-task-list type="button">Task</button>${roleHasAbility ? '<button data-sus-ability type="button">Ability</button>' : ""}${current.bodies.length ? '<button class="danger" data-sus-report-menu type="button">Report</button>' : ""}<button data-sus-emergency type="button" ${current.me.emergencyMeetingsLeft <= 0 ? "disabled" : ""}>Emergency</button><button data-sus-evidence type="button">Evidence</button><button data-sus-chat type="button">Local Chat</button></nav>`, "SUS");
    bindBack(); startTicker();
    root.querySelectorAll("[data-sus-move]").forEach((button) => button.addEventListener("click", async () => act(button, async () => { current = await post("/move", { matchId: current.id, destination: button.dataset.susMove }); renderAction(); })));
    root.querySelectorAll("[data-sus-task]").forEach((button) => button.addEventListener("click", () => openTask(button.dataset.susTask)));
    root.querySelector("[data-sus-task-list]")?.addEventListener("click", taskListModal);
    root.querySelector("[data-sus-map]")?.addEventListener("click", mapModal);
    root.querySelector("[data-sus-ability]")?.addEventListener("click", () => abilityModal(sameRoomLiving));
    root.querySelector("[data-sus-report-menu]")?.addEventListener("click", reportModal);
    root.querySelector("[data-sus-emergency]")?.addEventListener("click", async (event) => { if (!confirm("Call your limited emergency meeting now?")) return; await act(event.currentTarget, async () => { current = await post("/emergency", { matchId: current.id }); renderCurrent(); }); });
    root.querySelector("[data-sus-evidence]")?.addEventListener("click", evidenceModal);
    root.querySelector("[data-sus-chat]")?.addEventListener("click", chatModal);
  }

  function taskListModal() {
    const node = overlay(`<div class="sus-modal-head"><h3>Your tasks</h3><button data-sus-close type="button">×</button></div><div class="sus-task-list">${taskRows()}</div>`);
    node.querySelectorAll("[data-sus-task]").forEach((button) => button.addEventListener("click", () => { node.remove(); openTask(button.dataset.susTask); }));
  }

  async function openTask(taskId) {
    const task = current.me.tasks.find((item) => item.id === taskId);
    if (!task) return;
    if (task.room !== current.me.currentRoom) return toast(`Go to ${task.room} first.`);
    let started;
    try { started = await post("/task/start", { matchId: current.id, taskId }); }
    catch (error) { return toast(error.message); }
    const active = started.task;
    const controls = window.SusTaskUI.controls(active, esc);
    const node = overlay(`<div class="sus-modal-head"><div><span class="eyebrow">${esc(active.room)}</span><h3>${esc(active.title)}</h3></div><button data-sus-close type="button">×</button></div><div class="sus-task-control">${controls}</div>`);
    const finish = async (payload) => { try { current = await post("/task/action", { matchId: current.id, taskId, ...payload }); node.remove(); renderCurrent(); toast("Task complete."); } catch (error) { toast(error.message); } };
    window.SusTaskUI.bind(node, active, finish);
  }

  function mapModal() {
    const connected = current.map.rooms[current.me.currentRoom] || [];
    const node = overlay(`<div class="sus-modal-head"><div><span class="eyebrow">${esc(current.map.name)}</span><h3>Station map</h3></div><button data-sus-close type="button">×</button></div><div class="sus-vote-grid">${Object.keys(current.map.rooms).map((room) => `<button class="sus-vote-card" data-map-room="${esc(room)}" type="button" ${connected.includes(room) ? "" : "disabled"}><strong>${esc(room)}</strong><small>${room === current.me.currentRoom ? "You are here" : connected.includes(room) ? "Connected" : "Route unavailable"}</small></button>`).join("")}</div>`);
    node.querySelectorAll("[data-map-room]:not(:disabled)").forEach((button) => button.addEventListener("click", async () => { current = await post("/move", { matchId: current.id, destination: button.dataset.mapRoom }); node.remove(); renderAction(); }));
  }

  function abilityModal(targets) {
    const role = current.me.role;
    const sabotage = current.sabotage;
    let actions = "";
    const targetButtons = (type, label) => targets.map((player) => `<button class="sus-vote-card" data-ability="${type}" data-target="${player.userId}" type="button">${avatarMarkup(player)}<strong>${esc(label)} ${esc(player.displayName || player.username)}</strong></button>`).join("");
    if (["Infiltrator", "Mimic"].includes(role)) actions += targetButtons(role === "Mimic" ? "mimic" : "eliminate", role === "Mimic" ? "Copy" : "Eliminate");
    if (role === "Investigator") actions += targetButtons("inspect", "Inspect");
    if (role === "Medic") actions += targetButtons("protect", "Protect");
    if (current.me.faction === "Shadows") actions += `<div class="sus-panel"><h3>Sabotage</h3><div class="sus-actions">${["lights","communications","reactor","doors"].map((type) => `<button data-sabotage="${type}" type="button">${phaseLabel(type)}</button>`).join("")}</div></div>`;
    if (sabotage) actions += `<button class="sus-button primary" data-ability="repair" type="button">Repair ${esc(sabotage.type)}</button>`;
    const node = overlay(`<div class="sus-modal-head"><div><span class="eyebrow">${esc(role)}</span><h3>Available abilities</h3></div><button data-sus-close type="button">×</button></div><div class="sus-vote-grid">${actions || '<div class="sus-empty">No ability is available in this room.</div>'}</div>`);
    node.querySelectorAll("[data-ability]").forEach((button) => button.addEventListener("click", async () => { try { current = await post("/ability", { matchId: current.id, type: button.dataset.ability, targetUserId: button.dataset.target }); node.remove(); renderCurrent(); } catch (error) { toast(error.message); } }));
    node.querySelectorAll("[data-sabotage]").forEach((button) => button.addEventListener("click", async () => { try { current = await post("/sabotage", { matchId: current.id, type: button.dataset.sabotage }); node.remove(); renderCurrent(); } catch (error) { toast(error.message); } }));
  }

  function reportModal() {
    const node = overlay(`<div class="sus-modal-head"><h3>Report incident</h3><button data-sus-close type="button">×</button></div><div class="sus-vote-grid">${current.bodies.map((body) => `<button class="sus-vote-card" data-report-body="${body.id}" type="button"><strong>Broken signal</strong><small>${esc(body.username)} · ${esc(body.room)}</small></button>`).join("")}</div>`);
    node.querySelectorAll("[data-report-body]").forEach((button) => button.addEventListener("click", async () => { current = await post("/report", { matchId: current.id, bodyId: button.dataset.reportBody }); node.remove(); renderCurrent(); }));
  }

  function evidenceModal() {
    const evidence = current.evidence || [];
    const node = overlay(`<div class="sus-modal-head"><h3>Evidence inventory</h3><button data-sus-close type="button">×</button></div><div class="sus-event-list">${evidence.map((item) => `<article class="sus-evidence-row"><strong>${esc(item.title)}</strong><p>${esc(item.description)}</p><small>${esc(item.reliability)} · ${esc(item.location)}</small>${["discussion","voting"].includes(current.currentPhase) && !item.presented ? `<button class="sus-button" data-present-evidence="${item.id}" type="button">Present</button>` : ""}</article>`).join("") || '<div class="sus-empty">No evidence collected yet.</div>'}</div>`);
    node.querySelectorAll("[data-present-evidence]").forEach((button) => button.addEventListener("click", async () => { current = await post("/evidence/present", { matchId: current.id, evidenceId: button.dataset.presentEvidence }); node.remove(); renderCurrent(); }));
  }

  function chatHtml() {
    return (current.chatMessages || []).map((message) => `<div class="sus-chat-message" data-sus-chat-id="${esc(message.id)}"><img src="${esc(message.avatar || "/assets/avatar-other.svg")}" alt="" /><div><strong>${esc(message.username)}</strong><p>${esc(message.body)}</p><small>${new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></div></div>`).join("") || '<div class="sus-empty">No messages in this channel.</div>';
  }

  function chatModal() {
    const title = current.me.alive ? (["discussion","voting"].includes(current.currentPhase) ? "Discussion chat" : `${current.me.currentRoom} local chat`) : "Dead chat";
    const node = overlay(`<div class="sus-modal-head"><div><span class="eyebrow">Game chat</span><h3>${esc(title)}</h3></div><button data-sus-close type="button">×</button></div><div class="sus-chat-list" id="susChatList">${chatHtml()}</div><form class="sus-chat-form" id="susChatForm"><input name="body" maxlength="280" placeholder="Type a short message..." autocomplete="off" /><button class="sus-button primary" type="submit">Send</button></form><div class="sus-preset-row">${presets.map((text) => `<button data-sus-preset="${esc(text)}" type="button">${esc(text)}</button>`).join("")}</div>`);
    node.querySelector("#susChatForm").addEventListener("submit", async (event) => { event.preventDefault(); const input = event.currentTarget.body; if (!input.value.trim()) return; try { await post("/chat", { matchId: current.id, body: input.value }); input.value = ""; } catch (error) { toast(error.message); } });
    node.querySelectorAll("[data-sus-preset]").forEach((button) => button.addEventListener("click", async () => { try { await post("/chat", { matchId: current.id, body: button.dataset.susPreset, preset: true }); } catch (error) { toast(error.message); } }));
  }

  function voteStatus(player) {
    if (!player.voted) return player.connected ? "Waiting for vote" : "Disconnected";
    if (current.settings.anonymousVoting || player.voteChoice === null) return "Vote locked";
    if (player.voteChoice === "skip") return "Voted to skip";
    const target = current.players.find((item) => Number(item.userId) === Number(player.voteChoice));
    return `Voted for ${target?.displayName || target?.username || "a player"}`;
  }

  function renderMeeting() {
    const voting = current.currentPhase === "voting";
    const alive = current.players.filter((player) => player.alive);
    const canVote = Boolean(me()?.alive) && !me()?.voted;
    const meetingContent = voting && me()?.alive
      ? `<div class="sus-vote-grid">${alive.map((player) => `<button class="sus-vote-card" data-sus-vote="${player.userId}" type="button" ${canVote ? "" : "disabled"}>${avatarMarkup(player)}<strong>${esc(player.displayName || player.username)}</strong><small>${esc(voteStatus(player))}</small></button>`).join("")}<button class="sus-vote-card" data-sus-vote="skip" type="button" ${canVote ? "" : "disabled"}><strong>Skip vote</strong><small>Do not expel anyone</small></button></div>`
      : `<div class="sus-chat-list" id="susMeetingChat">${chatHtml()}</div><form class="sus-chat-form" id="susMeetingForm"><input name="body" maxlength="280" placeholder="${me()?.alive ? "Share what you know..." : "Message eliminated players..."}" /><button class="sus-button primary" type="submit">Send</button></form><div class="sus-preset-row">${presets.map((text) => `<button data-sus-preset="${esc(text)}" type="button">${esc(text)}</button>`).join("")}</div>`;
    root.innerHTML = shell(`<div class="sus-body"><div class="sus-game-layout"><main class="sus-panel"><span class="eyebrow">${current.reportedBody?.emergency ? "Emergency meeting" : `Report from ${esc(current.reportedBody?.room || "station")}`}</span><h2>${current.reportedBody?.username ? `${esc(current.reportedBody.username)} lost signal` : "Station discussion"}</h2><p class="sus-muted">${me()?.alive ? "Movement and abilities are locked. Compare local sightings and present reliable evidence." : "You are eliminated. This private dead chat is invisible to living players."}</p>${meetingContent}</main><aside class="sus-side"><section class="sus-panel"><h3>Presented evidence</h3><div class="sus-event-list">${(current.evidence || []).filter((item) => item.presented).map((item) => `<div class="sus-evidence-row"><strong>${esc(item.title)}</strong><p>${esc(item.description)}</p><small>${esc(item.reliability)}</small></div>`).join("") || '<div class="sus-empty">No evidence presented.</div>'}</div>${me()?.alive ? '<button class="sus-button" data-sus-evidence type="button">Open evidence</button>' : ""}</section><section class="sus-panel"><h3>Living players</h3><div class="sus-event-list">${alive.map((player) => `<div class="sus-event-row"><strong>${esc(player.displayName || player.username)}</strong><small>${player.connected ? "Connected" : "Signal lost"}</small></div>`).join("")}</div></section></aside></div></div><nav class="sus-action-bar">${me()?.alive ? '<button data-sus-evidence type="button">Evidence</button>' : ""}<button data-sus-chat type="button">${me()?.alive ? "Chat" : "Dead Chat"}</button><button class="sus-button danger" data-sus-leave type="button">Leave Match</button></nav>`, voting ? "Voting" : "Discussion");
    bindBack(); startTicker();
    root.querySelectorAll("[data-sus-vote]").forEach((button) => button.addEventListener("click", async () => { if (!confirm(`Lock vote: ${button.dataset.susVote === "skip" ? "skip" : button.querySelector("strong").textContent}?`)) return; current = await post("/vote", { matchId: current.id, targetUserId: button.dataset.susVote }); renderCurrent(); }));
    root.querySelector("#susMeetingForm")?.addEventListener("submit", async (event) => { event.preventDefault(); const input = event.currentTarget.body; if (!input.value.trim()) return; await post("/chat", { matchId: current.id, body: input.value }); input.value = ""; });
    root.querySelectorAll("[data-sus-preset]").forEach((button) => button.addEventListener("click", () => post("/chat", { matchId: current.id, body: button.dataset.susPreset, preset: true }).catch((error) => toast(error.message))));
    root.querySelectorAll("[data-sus-evidence]").forEach((button) => button.addEventListener("click", evidenceModal));
    root.querySelector("[data-sus-chat]")?.addEventListener("click", chatModal);
    root.querySelector("[data-sus-leave]")?.addEventListener("click", async () => { if (!confirm("Leave this active match and lose rewards?")) return; await post("/leave", { matchId: current.id }); current = null; openHome(root); });
  }

  function renderResult() {
    const result = current.voteResult;
    root.innerHTML = shell(`<div class="sus-result"><div><span class="eyebrow">Meeting result</span><h2>${result?.expelledName ? `${esc(result.expelledName)} expelled` : result?.tie ? "Vote tied" : "No expulsion"}</h2><p class="sus-muted">${result?.expelledRole ? `Role revealed: ${esc(result.expelledRole)}` : "Blackout Station is recalculating living signals."}</p><div class="sus-meta-row">${Object.entries(result?.counts || {}).map(([id, total]) => `<span>${id === "skip" ? "Skip" : `Player ${esc(id)}`}: ${total}</span>`).join("")}</div></div></div>`, "Vote Result");
    bindBack(); startTicker();
  }

  function renderEnd() {
    const winner = current.winner || { faction: "Station", reason: "Match ended." };
    const duration = current.startedAt ? Math.max(1, Math.round((Date.now() - new Date(current.startedAt).getTime()) / 60000)) : 0;
    root.innerHTML = shell(`<div class="sus-result"><div><span class="eyebrow">Match complete</span><h2 class="${winner.faction === "Residents" ? "sus-winner-residents" : "sus-winner-shadows"}">${esc(winner.faction)} win</h2><p>${esc(winner.reason)}</p><div class="sus-player-grid">${current.players.map((player) => `<article class="sus-player-card">${avatarMarkup(player)}<span><strong>${esc(player.displayName || player.username)}</strong><small>${esc(player.role || "Unknown")} · ${esc(player.faction || "Unknown")}</small></span></article>`).join("")}</div><div class="sus-actions"><button class="sus-button primary" data-sus-play-again type="button">Play Again</button><button class="sus-button" data-sus-summary type="button">View Match Summary</button><button class="sus-button danger" data-sus-end-leave type="button">Leave Game</button></div></div></div>`, "Match Complete");
    bindBack(); startTicker();
    const endActions = root.querySelector(".sus-result .sus-actions");
    endActions?.insertAdjacentHTML("beforebegin", `<div class="sus-meta-row"><span>${duration} min</span>${lastReward ? `<span>+${lastReward.gold} gold</span><span>+${lastReward.xp} XP</span>` : ""}</div>`);
    root.querySelector("[data-sus-summary]")?.insertAdjacentHTML("beforebegin", '<button class="sus-button" data-sus-return-lobby type="button">Return to Lobby</button>');
    root.querySelector("[data-sus-play-again]")?.addEventListener("click", async () => { await post("/leave", { matchId: current.id }); current = await post("/quick"); renderCurrent(); });
    root.querySelector("[data-sus-return-lobby]")?.addEventListener("click", async () => { await post("/leave", { matchId: current.id }).catch(() => {}); current = null; openHome(root); });
    root.querySelector("[data-sus-summary]")?.addEventListener("click", () => overlay(`<div class="sus-modal-head"><h3>Match summary</h3><button data-sus-close type="button">×</button></div><div class="sus-event-list">${eventRows()}</div>`));
    root.querySelector("[data-sus-end-leave]")?.addEventListener("click", async () => { await post("/leave", { matchId: current.id }).catch(() => {}); current = null; openHome(root); });
  }

  function renderCurrent() {
    if (!root || !current) return;
    if (current.currentPhase === "lobby") return renderLobby();
    if (current.currentPhase === "role_reveal") return renderRoleReveal();
    if (current.currentPhase === "action") return renderAction();
    if (["discussion", "voting"].includes(current.currentPhase)) return renderMeeting();
    if (current.currentPhase === "result") return renderResult();
    if (current.currentPhase === "end" || current.status === "ended") return renderEnd();
  }

  function handleRealtime(type, payload) {
    if (type === "state") {
      if (!current || current.id === payload.id) current = payload;
      if (open && root) renderCurrent();
      return;
    }
    if (type === "chat" && current && payload) {
      current.chatMessages = current.chatMessages || [];
      if (!current.chatMessages.some((message) => message.id === payload.id)) current.chatMessages.push(payload);
      const list = document.querySelector("#susChatList,#susMeetingChat");
      if (list) { list.innerHTML = chatHtml(); list.scrollTop = list.scrollHeight; }
      return;
    }
    if (type === "event") toast(payload.body || payload.title || "SUS update");
    if (type === "reward") {
      lastReward = payload;
      if (open && current?.status === "ended") renderEnd();
    }
    if (type === "reward") toast(`SUS reward: ${payload.gold} gold · ${payload.xp} XP`);
  }

  function leaveView() {
    open = false; clearInterval(ticker); ticker = null; document.querySelector("#susOverlay")?.remove();
  }

  window.SusGame = { cardHtml, bindCard, openHome, handleRealtime, leaveView, isOpen: () => open };
})();
