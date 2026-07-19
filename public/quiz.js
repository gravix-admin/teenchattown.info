(function () {
  "use strict";

  let root = null;
  let open = false;
  let contest = null;
  let activeMatch = null;
  let ticker = null;
  let refreshTimer = null;
  let contestSubscribed = false;

  function bridge() { return window.TCTQuizBridge; }
  function esc(value) { return bridge().html(value); }
  function api(path, options) { return bridge().api(`/api/quiz${path}`, options); }
  function post(path, body = {}) { return api(path, { method: "POST", body: JSON.stringify(body) }); }
  function toast(value) { bridge().toast(value); }
  function me() { return bridge().getState().me; }
  function secondsLeft(value) { return value ? Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 1000)) : 0; }
  function statusLabel(value) { return String(value || "No contest").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  function avatar(value) { return esc(value || "/assets/avatar-other.svg"); }

  function cardHtml() {
    const roomControls = me()?.rank === "developer" ? '<div class="quiz-room-controls"><button data-quiz-room-admin="pause" type="button">Pause</button><button data-quiz-room-admin="resume" type="button">Resume</button><button data-quiz-room-admin="skip" type="button">Skip question</button></div>' : "";
    return `
      <section class="quiz-game-grid">
        <article class="quiz-feature-card room-card-game">
          <div class="quiz-card-art"><img src="/assets/quiz-bot.svg" alt="" /></div>
          <div><span class="eyebrow">Always live</span><h3>Quiz Room</h3><p>Type answers in the room, race the ten-second clock, build streaks, and climb the live Quiz Leaderboard.</p><div class="quiz-feature-meta"><span>Up to 100 points</span><span>Server timed</span><span>Everyone plays</span></div><button class="primary" data-open-quiz-room type="button">Enter Quiz Room</button>${roomControls}</div>
        </article>
        <article class="quiz-feature-card contest-card-game">
          <div class="quiz-card-art bracket"><b>8</b><i></i><strong>1</strong></div>
          <div><span class="eyebrow">Top-eight knockout</span><h3>Quiz Contest</h3><p>Four quarterfinals, two semifinals, one final, and one TeenChatTown quiz champion.</p><div class="quiz-feature-meta"><span>20 questions</span><span>Live bracket</span><span>Spectator mode</span></div><button class="primary" data-open-quiz-contest type="button">View Quiz Contest</button></div>
        </article>
      </section>`;
  }

  function bindCard(container) {
    container.querySelector("[data-open-quiz-room]")?.addEventListener("click", () => bridge().openQuizRoom());
    container.querySelector("[data-open-quiz-contest]")?.addEventListener("click", () => openContest(container));
    container.querySelectorAll("[data-quiz-room-admin]").forEach((button) => button.addEventListener("click", () => act(button, async () => {
      await post(`/admin/room/${button.dataset.quizRoomAdmin}`);
      toast(`Quiz Room ${button.dataset.quizRoomAdmin} complete.`);
    })));
  }

  function shell(content) {
    return `<section class="quiz-shell"><header class="quiz-topbar"><button class="quiz-back" data-quiz-back type="button">‹</button><div><span class="eyebrow">TeenChatTown live games</span><h2>Quiz Contest</h2></div><span class="quiz-socket ${bridge().socketConnected() ? "" : "offline"}" data-quiz-socket>${bridge().socketConnected() ? "Socket.IO live" : "Reconnecting"}</span></header>${content}</section>`;
  }

  function matchCard(match) {
    const one = match.playerOne; const two = match.playerTwo;
    return `<button class="quiz-bracket-match status-${esc(match.status)}" data-quiz-match="${match.id}" type="button">
      <small>Match ${match.matchNumber}</small>
      <span class="${Number(match.winnerId) === Number(one?.id) ? "winner" : ""}"><img src="${avatar(one?.avatarUrl)}" alt="" /><b>${esc(one?.username || "TBD")}</b><strong>${Number(one?.score || 0)}</strong></span>
      <span class="${Number(match.winnerId) === Number(two?.id) ? "winner" : ""}"><img src="${avatar(two?.avatarUrl)}" alt="" /><b>${esc(two?.username || "TBD")}</b><strong>${Number(two?.score || 0)}</strong></span>
      <em>${esc(statusLabel(match.status))}</em>
    </button>`;
  }

  function bracketColumn(round, title) {
    const matches = contest?.matches?.filter((match) => Number(match.roundNumber) === round) || [];
    return `<section class="quiz-bracket-round round-${round}"><h3>${title}</h3><div>${matches.map(matchCard).join("") || '<article class="quiz-bracket-placeholder">Waiting for previous round</article>'}</div></section>`;
  }

  function participantCards() {
    return (contest?.players || []).map((player, index) => `<article class="quiz-seed-card ${index < 8 ? "eligible" : ""} ${player.joined ? "joined" : ""}"><span>#${player.seed}</span><img src="${avatar(player.avatarUrl)}" alt="" /><div><strong>${esc(player.displayName || player.username)}</strong><small>${Number(player.quizScore || 0).toLocaleString()} quiz points · ${player.joined ? "Joined" : "Invited"}</small></div>${player.disqualified ? "<em>DQ</em>" : ""}</article>`).join("");
  }

  function developerControls() {
    if (!contest?.canStart) return "";
    const tournament = contest.tournament;
    const id = Number(tournament?.id || 0);
    return `<section class="quiz-dev-controls"><div><span class="eyebrow">Developer control</span><h3>Quiz Contest operations</h3><p>The Start Tournament button is available only to the Developer account and every action is checked by the server.</p></div><div class="quiz-control-grid">
      ${!tournament || ["completed", "cancelled"].includes(tournament.status) ? '<button class="primary" data-quiz-admin="prepare" type="button">Prepare Top 8</button>' : ""}
      ${tournament?.status === "waiting_for_players" ? '<button data-quiz-admin="lock" type="button">Lock Participants</button>' : ""}
      ${tournament?.status === "locked" ? '<button class="primary quiz-start-button" data-quiz-admin="start" type="button">Start Tournament</button>' : ""}
      ${["quarterfinals_complete", "semifinals_complete"].includes(tournament?.status) ? '<button class="primary" data-quiz-admin="next-round" type="button">Start Next Round</button>' : ""}
      ${String(tournament?.status || "").endsWith("_active") ? '<button data-quiz-admin="pause" type="button">Pause Tournament</button>' : ""}
      ${tournament?.status === "paused" ? '<button data-quiz-admin="resume" type="button">Resume Tournament</button>' : ""}
      ${tournament && !["completed", "cancelled"].includes(tournament.status) ? '<button class="danger" data-quiz-admin="cancel" type="button">Cancel Tournament</button>' : ""}
      ${tournament ? `<button data-quiz-admin="logs" type="button">View Contest Logs</button><button data-quiz-admin="disqualify" type="button">Disqualify Player</button><button data-quiz-admin="replace" type="button">Replace Player</button><button data-quiz-admin="reset" type="button">Reset Tournament</button>` : ""}
    </div><input type="hidden" value="${id}" /></section>`;
  }

  function invitation() {
    const invite = contest?.invitation;
    if (!invite?.qualified) return "";
    return `<section class="quiz-invitation"><div><span>🏆</span><strong>You qualified for the Quiz Contest!</strong><p>Seed #${invite.seed}${invite.opponent ? ` · Opponent: @${esc(invite.opponent)}` : ""}</p></div><div>${!invite.joined ? '<button class="primary" data-quiz-join type="button">Join Contest</button>' : '<b class="quiz-joined-mark">Joined ✓</b>'}<button data-quiz-rules type="button">View Rules</button>${invite.matchId ? `<button data-quiz-match="${invite.matchId}" type="button">Open Match</button>` : ""}</div></section>`;
  }

  function renderContest() {
    if (!root) return;
    const tournament = contest?.tournament;
    root.innerHTML = shell(`<div class="quiz-contest-body">
      <section class="quiz-contest-hero"><div><span class="eyebrow">Automated seeded championship</span><h1>${tournament ? `Contest #${tournament.id}` : "The next Quiz Contest"}</h1><p>Top eight Quiz Room players enter a three-round live knockout. Every answer and timestamp is verified by the server.</p></div><div class="quiz-contest-status"><small>Status</small><strong>${esc(statusLabel(tournament?.status || "Not prepared"))}</strong><span data-contest-clock>${tournament?.status === "paused" ? "Paused" : "Socket.IO synchronized"}</span></div></section>
      ${invitation()}
      <div class="quiz-section-head"><div><span class="eyebrow">Locked leaderboard seeds</span><h2>Top Eight</h2></div><button data-quiz-rules type="button">Rules</button></div>
      <section class="quiz-seed-grid">${participantCards() || '<div class="quiz-empty"><strong>No roster is locked yet</strong><span>The Developer can prepare the current Quiz Leaderboard top eight.</span></div>'}</section>
      <section class="quiz-bracket"><div class="quiz-section-head"><div><span class="eyebrow">Live tournament tree</span><h2>Bracket</h2></div>${tournament?.championName ? `<strong class="quiz-champion-chip">Champion · ${esc(tournament.championName)}</strong>` : ""}</div><div class="quiz-bracket-scroll">${bracketColumn(1, "Quarterfinals")}${bracketColumn(2, "Semifinals")}${bracketColumn(3, "Final")}<section class="quiz-bracket-round champion-round"><h3>Champion</h3><article class="quiz-champion-card"><span>♛</span><strong>${esc(tournament?.championName || "Awaiting champion")}</strong></article></section></div></section>
      ${developerControls()}
    </div>`);
    bindCommon(); bindContestActions(); startTicker();
  }

  function bindCommon() {
    root?.querySelector("[data-quiz-back]")?.addEventListener("click", () => { leaveView(); bridge().renderGames(); });
    root?.querySelectorAll("[data-quiz-rules]").forEach((button) => button.addEventListener("click", showRules));
  }

  function bindContestActions() {
    root?.querySelector("[data-quiz-join]")?.addEventListener("click", async (event) => act(event.currentTarget, async () => { contest = await post("/contest/join"); renderContest(); }));
    root?.querySelectorAll("[data-quiz-match]").forEach((button) => button.addEventListener("click", () => openMatch(Number(button.dataset.quizMatch))));
    root?.querySelectorAll("[data-quiz-admin]").forEach((button) => button.addEventListener("click", () => developerAction(button)));
  }

  async function developerAction(button) {
    const action = button.dataset.quizAdmin;
    const id = Number(contest?.tournament?.id || 0);
    if (action === "logs") return showLogs(id);
    if (action === "cancel" && !confirm("Cancel this Quiz Contest for every participant?")) return;
    if (action === "reset" && !confirm("Reset this contest? The current bracket will be closed.")) return;
    let body = {};
    if (action === "disqualify") {
      const username = prompt("Username to disqualify"); if (!username) return;
      const player = contest.players.find((item) => item.username.toLowerCase() === username.trim().toLowerCase());
      if (!player) return toast("That username is not in this contest."); body = { userId: player.userId };
    }
    if (action === "replace") {
      const oldName = prompt("Contest username to replace"); if (!oldName) return;
      const newId = Number(prompt("Replacement user ID")); if (!newId) return;
      const player = contest.players.find((item) => item.username.toLowerCase() === oldName.trim().toLowerCase());
      if (!player) return toast("That username is not in this contest."); body = { oldUserId: player.userId, newUserId: newId };
    }
    const path = action === "prepare" ? "/admin/contest/prepare" : `/admin/contest/${id}/${action}`;
    await act(button, async () => { contest = await post(path, body); toast(`Quiz Contest: ${statusLabel(action)} complete.`); renderContest(); });
  }

  function startTicker() {
    clearInterval(ticker);
    const paint = () => {
      const socket = root?.querySelector("[data-quiz-socket]");
      if (socket) {
        const connected = bridge().socketConnected();
        const label = connected ? "Socket.IO live" : "Reconnecting";
        if (socket.textContent !== label) socket.textContent = label;
        socket.classList.toggle("offline", !connected);
      }
      if (activeMatch) {
        const seconds = secondsLeft(activeMatch.questionExpiresAt);
        root?.querySelectorAll("[data-quiz-countdown]").forEach((node) => {
          const label = `${seconds}s`;
          const progress = `${Math.max(0, Math.min(100, seconds * 10))}%`;
          if (node.textContent !== label) node.textContent = label;
          if (node.style.getPropertyValue("--quiz-progress") !== progress) node.style.setProperty("--quiz-progress", progress);
        });
      }
    };
    paint(); ticker = setInterval(paint, activeMatch ? 250 : 1000);
  }

  async function openContest(target = null) {
    root = target || root || document.querySelector("#gamesHub"); if (!root) return;
    open = true; activeMatch = null;
    if (!contestSubscribed) {
      contestSubscribed = true;
      bridge().emit("quiz:subscribe", { contest: true });
    }
    root.innerHTML = '<div class="view-loading"><span></span><strong>Loading Quiz Contest...</strong></div>';
    try { contest = await api("/contest/state"); renderContest(); }
    catch (error) { root.innerHTML = `<div class="quiz-empty"><strong>Quiz Contest is reconnecting</strong><span>${esc(error.message)}</span><button data-quiz-retry type="button">Try again</button></div>`; root.querySelector("[data-quiz-retry]")?.addEventListener("click", () => openContest(root)); }
  }

  async function openMatch(matchId) {
    root = root || document.querySelector("#gamesHub"); if (!root) return;
    root.innerHTML = '<div class="view-loading"><span></span><strong>Opening contest match...</strong></div>';
    bridge().emit("quiz:watch-match", { matchId });
    try { activeMatch = await api(`/contest/matches/${matchId}`); renderMatch(); }
    catch (error) { toast(error.message); await openContest(root); }
  }

  function playerScore(player, side) {
    return `<article class="quiz-match-player"><img src="${avatar(player?.avatarUrl)}" alt="" /><span><small>${side}</small><strong>${esc(player?.username || "TBD")}</strong></span><b>${Number(player?.score || 0)}</b></article>`;
  }

  function renderMatch() {
    if (!root || !activeMatch) return;
    const question = activeMatch.question;
    const mine = Number(activeMatch.viewerUserId);
    const participant = activeMatch.participant;
    const finished = activeMatch.status === "complete";
    root.innerHTML = shell(`<div class="quiz-match-shell">
      <section class="quiz-match-head"><div><span class="eyebrow">Round ${activeMatch.roundNumber} · Match ${activeMatch.matchNumber}</span><h2>${participant ? "Your contest match" : "Spectator mode"}</h2><p>${participant ? "Your selection is private until the question closes." : "Live read-only scores with protected answer state."}</p></div><button data-quiz-contest-home type="button">View Bracket</button></section>
      <div class="quiz-match-scoreboard">${playerScore(activeMatch.playerOne, "Player 1")}${playerScore(activeMatch.playerTwo, "Player 2")}</div>
      ${finished ? matchFinishedHtml() : question ? `<section class="quiz-question-stage"><div class="quiz-question-meta"><span>${esc(question.category)}</span><strong>Question ${question.number}/${question.total}${activeMatch.suddenDeathIndex ? ` · Sudden death ${activeMatch.suddenDeathIndex}` : ""}</strong><b data-quiz-countdown style="--quiz-progress:100%">${secondsLeft(activeMatch.questionExpiresAt)}s</b></div><div class="quiz-progress-track"><i style="width:${Math.min(100, Number(question.number) / Number(question.total || 20) * 100)}%"></i></div><h1>${esc(question.question)}</h1><div class="quiz-option-grid">${question.options.map((option, index) => `<button class="quiz-option ${activeMatch.myAnswer?.optionIndex === index ? "selected" : ""}" data-quiz-option="${index}" type="button" ${!participant || activeMatch.answerLocked || activeMatch.status !== "active" ? "disabled" : ""}><span>${String.fromCharCode(65 + index)}</span><strong>${esc(option)}</strong></button>`).join("")}</div><div class="quiz-answer-state">${activeMatch.answerLocked ? `<strong>Answer locked${activeMatch.myAnswer ? ` · ${activeMatch.myAnswer.points >= 0 ? "+" : ""}${activeMatch.myAnswer.points} points` : ""}</strong>` : participant ? "Choose one answer. You cannot change it." : `${activeMatch.lockedPlayers.length}/2 players have locked an answer.`}</div></section>` : `<section class="quiz-waiting-stage"><span></span><h2>${activeMatch.status === "paused" ? "Tournament paused" : "Waiting for both players"}</h2><p>${activeMatch.joinDeadlineAt ? `Join grace: ${secondsLeft(activeMatch.joinDeadlineAt)} seconds remaining.` : "The next question will begin shortly."}</p></section>`}
      ${contest?.canStart && activeMatch.status === "active" ? `<button class="quiz-skip-question" data-quiz-skip-match="${activeMatch.id}" type="button">Skip broken question</button>` : ""}
    </div>`);
    bindCommon(); startTicker();
    root.querySelector("[data-quiz-contest-home]")?.addEventListener("click", () => openContest(root));
    root.querySelectorAll("[data-quiz-option]").forEach((button) => button.addEventListener("click", () => answerMatch(button, mine)));
    root.querySelector("[data-quiz-skip-match]")?.addEventListener("click", async (event) => act(event.currentTarget, async () => { await post(`/admin/contest/matches/${activeMatch.id}/skip`); }));
    root.querySelector("[data-quiz-review]")?.addEventListener("click", () => root.querySelector("[data-quiz-review-panel]")?.classList.toggle("hidden"));
  }

  function matchFinishedHtml() {
    const won = Number(activeMatch.winnerId) === Number(activeMatch.viewerUserId);
    return `<section class="quiz-match-complete ${won ? "winner" : ""}"><span>🏆</span><small>Match complete</small><h2>${activeMatch.participant ? (won ? "You won!" : "Match finished") : `${esc(activeMatch.winnerName || "Winner")} advances`}</h2><p>${esc(activeMatch.playerOne?.username || "Player 1")}: ${Number(activeMatch.playerOne?.score || 0)} · ${esc(activeMatch.playerTwo?.username || "Player 2")}: ${Number(activeMatch.playerTwo?.score || 0)}</p><button class="primary" data-quiz-review type="button">Review Answers</button></section><section class="quiz-review hidden" data-quiz-review-panel>${(activeMatch.review || []).map((item) => `<article><small>Question ${item.number}</small><strong>${esc(item.question)}</strong><span>Correct answer: ${esc(item.correctAnswer)}</span></article>`).join("")}</section>`;
  }

  async function answerMatch(button) {
    if (button.disabled) return;
    root.querySelectorAll("[data-quiz-option]").forEach((item) => { item.disabled = true; });
    try {
      const result = await post(`/contest/matches/${activeMatch.id}/answer`, { optionIndex: Number(button.dataset.quizOption) });
      activeMatch.answerLocked = true; activeMatch.myAnswer = { optionIndex: Number(button.dataset.quizOption), points: result.points };
      renderMatch();
    } catch (error) { toast(error.message); await refreshMatch(); }
  }

  async function refreshMatch() {
    if (!activeMatch?.id || !open) return;
    const matchId = activeMatch.id;
    activeMatch = await api(`/contest/matches/${matchId}`);
    renderMatch();
  }

  function scheduleRefresh(kind, payload = {}) {
    if (!open) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (activeMatch && (!payload.matchId || Number(payload.matchId) === Number(activeMatch.id))) refreshMatch().catch(() => {});
      else openContest(root).catch(() => {});
    }, kind === "timer" ? 0 : 120);
  }

  function showRules() {
    document.querySelector("#quizRulesOverlay")?.remove();
    document.body.insertAdjacentHTML("beforeend", `<div class="quiz-modal-layer" id="quizRulesOverlay"><section class="quiz-modal"><button data-quiz-modal-close type="button">×</button><span class="eyebrow">Official format</span><h2>Quiz Contest Rules</h2><ol><li>The current Quiz Leaderboard top eight are seeded 1v8, 4v5, 2v7, and 3v6.</li><li>Each match has 20 shared multiple-choice questions with a server-timed ten-second clock.</li><li>Correct answers earn up to 20 points. Wrong answers lose 4 points.</li><li>One selection is allowed per player per question. Spectators cannot answer.</li><li>Tied matches continue through sudden-death questions until a winner emerges.</li></ol></section></div>`);
    const layer = document.querySelector("#quizRulesOverlay"); layer.addEventListener("click", (event) => { if (event.target === layer || event.target.closest("[data-quiz-modal-close]")) layer.remove(); });
  }

  async function showLogs(tournamentId) {
    const data = await api(`/admin/contest/${tournamentId}/logs`);
    document.querySelector("#quizRulesOverlay")?.remove();
    document.body.insertAdjacentHTML("beforeend", `<div class="quiz-modal-layer" id="quizRulesOverlay"><section class="quiz-modal log-modal"><button data-quiz-modal-close type="button">×</button><span class="eyebrow">Private Developer audit</span><h2>Contest Logs</h2><div>${data.logs.map((item) => `<article><strong>${esc(statusLabel(item.event_type))}</strong><span>${esc(item.actor_name || "System")} · ${new Date(item.created_at).toLocaleString()}</span></article>`).join("") || "No events yet."}</div></section></div>`);
    const layer = document.querySelector("#quizRulesOverlay"); layer.addEventListener("click", (event) => { if (event.target === layer || event.target.closest("[data-quiz-modal-close]")) layer.remove(); });
  }

  async function act(button, work) {
    if (button) button.disabled = true;
    try { await work(); } catch (error) { toast(error.message); }
    finally { if (button?.isConnected) button.disabled = false; }
  }

  function handleRealtime(type, payload = {}) {
    if (type === "timer") return;
    if (type === "state" && Object.hasOwn(payload, "tournament")) {
      contest = payload;
      if (open && !activeMatch) renderContest();
      return;
    }
    scheduleRefresh(type, payload);
  }

  function leaveView() {
    open = false; clearInterval(ticker); clearTimeout(refreshTimer);
    if (activeMatch?.id) bridge().emit("quiz:unwatch-match", { matchId: activeMatch.id });
    bridge().emit("quiz:unsubscribe", { contest: true });
    contestSubscribed = false;
    activeMatch = null;
  }

  window.QuizGame = { cardHtml, bindCard, openContest, handleRealtime, leaveView, isOpen: () => open };
})();
