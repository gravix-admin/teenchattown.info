(function () {
  "use strict";

  const interests = ["Chill", "Informative", "Flirt", "Games", "Fitness", "Music", "Movies", "Study", "Vent", "Random"];
  const reportCategories = ["Sexual content", "Harassment", "Hate or threats", "Underage safety concern", "Nudity", "Spam or scam", "Impersonation", "Sharing personal information", "Other"];
  let root = null;
  let current = { status: "setup" };
  let setupStep = 1;
  let temporaryUsername = `Stranger${Math.floor(1000 + Math.random() * 9000)}`;
  let selectedInterest = null;
  let openState = false;
  let searchingTicker = null;
  let typingOffTimer = null;
  let durationTicker = null;
  let peer = null;
  let localStream = null;
  let remoteStream = null;
  let pendingIce = [];
  let callConfig = null;
  let callState = { status: "idle", mode: null, incoming: false, microphone: false, camera: false, facingMode: "user" };
  let disconnectCallTimer = null;

  function bridge() { return window.TCTRandomTalkBridge; }
  function esc(value) { return bridge().html(value); }
  function api(path, options) { return bridge().api(`/api/random-talk${path}`, options); }
  function post(path, body = {}) { return api(path, { method: "POST", body: JSON.stringify(body) }); }
  function formatTime(value) { return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  function setError(message) {
    const area = root?.querySelector("[data-rt-error]");
    if (area) { area.textContent = message || ""; area.classList.toggle("hidden", !message); }
    else if (message) bridge().toast(message);
  }

  function shell(content, subtitle = "Meet one stranger at a time.") {
    const canModerate = current.status === "matched" || (current.status === "ended" && current.canReport);
    const balance = Number(current.creditBalance || 0);
    return `<section class="rt-shell" role="dialog" aria-modal="true" aria-label="Random Talk"><header class="rt-header"><div class="rt-brand"><b class="rt-brand-mark">RT</b><span><strong>Random Talk</strong><small>${esc(subtitle)}</small></span></div><div class="rt-header-actions"><span class="rt-credit-chip" title="Random Talk credits">${balance.toLocaleString()} credits</span><button class="rt-button" data-rt-buy type="button">Buy</button><button class="rt-button" data-rt-safety type="button">Safety</button><button class="rt-button danger" data-rt-close type="button">Leave</button></div></header><div class="rt-body">${content}</div>${bridge().isGuest?.() ? '<aside class="rt-guest-cta"><span><b>Guest</b> Create an account to unlock the full community and buy more credits.</span><div><button data-rt-auth="register" type="button">Register</button><button data-rt-auth="login" type="button">Log In</button></div></aside>' : ""}<div class="rt-safety-menu hidden" data-rt-safety-menu><strong>Stay anonymous</strong><small class="rt-muted">Never share passwords, private addresses, financial details, school information or contact details. Calls are live and are not recorded.</small>${canModerate ? '<button class="rt-button" data-rt-report type="button">Report stranger</button><button class="rt-button" data-rt-block type="button">Block stranger</button>' : ""}</div><div class="rt-modal-layer hidden" data-rt-modal></div></section>`;
  }

  function bindShell() {
    root.querySelectorAll("[data-rt-close]").forEach((button) => button.addEventListener("click", close));
    root.querySelector("[data-rt-safety]")?.addEventListener("click", () => root.querySelector("[data-rt-safety-menu]")?.classList.toggle("hidden"));
    root.querySelector("[data-rt-report]")?.addEventListener("click", openReport);
    root.querySelector("[data-rt-block]")?.addEventListener("click", openBlockConfirm);
    root.querySelector("[data-rt-buy]")?.addEventListener("click", () => bridge().isGuest?.() ? openGuestCreditNotice() : bridge().openStore?.());
    root.querySelectorAll("[data-rt-auth]").forEach((button) => button.addEventListener("click", () => bridge().openAuth?.(button.dataset.rtAuth)));
  }

  function stepper(step) { return `<div class="rt-stepper" aria-label="Setup step ${step} of 3">${[1,2,3].map((number) => `<i class="${number <= step ? "active" : ""}"></i>`).join("")}</div>`; }

  function renderSetup() {
    clearInterval(searchingTicker);
    let main;
    if (setupStep === 1) main = `${stepper(1)}<span class="rt-eyebrow">Step 1 · Temporary identity</span><h2>Choose your Random Talk name</h2><p class="rt-muted">This name is temporary and only visible to the stranger you are matched with.</p><form data-rt-name-form><label class="rt-field">Temporary username<input name="temporaryUsername" minlength="3" maxlength="18" value="${esc(temporaryUsername)}" autocomplete="off" required /><small>3–18 letters, numbers, spaces, underscores or hyphens.</small></label><div class="rt-error hidden" data-rt-error></div><div class="rt-actions"><button class="rt-button primary" type="submit">Choose an interest</button><button class="rt-button" data-rt-cancel type="button">Cancel</button></div></form>`;
    else if (setupStep === 2) main = `${stepper(2)}<span class="rt-eyebrow">Step 2 · Conversation style</span><h2>What do you feel like talking about?</h2><p class="rt-muted">We prefer the same interest, then widen the search automatically if nobody suitable is waiting.</p><div class="rt-interest-grid">${interests.map((interest) => `<button class="rt-interest-chip ${selectedInterest === interest ? "active" : ""}" data-rt-interest="${interest}" type="button">${interest}</button>`).join("")}</div>${selectedInterest === "Flirt" ? '<p class="rt-flirt-note">Flirt means light conversation only. Sexual content, coercion, explicit requests and sharing private information are not allowed.</p>' : ""}<div class="rt-actions"><button class="rt-button primary" data-rt-interest-next type="button">Continue</button><button class="rt-button" data-rt-no-interest type="button">Continue without interests</button><button class="rt-button" data-rt-back type="button">Back</button></div>`;
    else main = `${stepper(3)}<span class="rt-eyebrow">Step 3 · Safety</span><h2>One quick reminder</h2><div class="rt-notice"><b>!</b><p>You are about to chat with a random stranger. Do not share your password, precise address, phone number, school, financial details or other private information. You can skip, report, block or leave at any time.</p></div><label class="rt-confirm"><input data-rt-confirm type="checkbox" /> I understand and want to find a stranger.</label><div class="rt-error hidden" data-rt-error></div><div class="rt-actions"><button class="rt-button primary" data-rt-find type="button" disabled>I understand — Find a Stranger</button><button class="rt-button" data-rt-back type="button">Back</button></div>`;
    root.innerHTML = shell(`<div class="rt-setup"><main class="rt-setup-main">${main}</main><aside class="rt-info-card"><span class="rt-eyebrow">Private by design</span><h3>Your account stays hidden</h3><div class="rt-info-list"><div><strong>Temporary identity</strong><small>Your permanent username, rank and profile are never sent to the stranger.</small></div><div><strong>One person at a time</strong><small>Every pair receives an isolated temporary conversation.</small></div><div><strong>Safety controls</strong><small>Skip, report, block or leave from every conversation.</small></div><div><strong>Brief retention</strong><small>Messages are retained briefly only for safety review, then automatically removed.</small></div></div></aside></div>`, "Meet one stranger at a time.");
    bindShell(); bindSetup();
  }

  function bindSetup() {
    root.querySelector("[data-rt-name-form]")?.addEventListener("submit", (event) => {
      event.preventDefault(); temporaryUsername = event.currentTarget.temporaryUsername.value.trim();
      if (temporaryUsername.length < 3) return setError("Choose a temporary name with at least 3 characters.");
      setupStep = 2; renderSetup();
    });
    root.querySelectorAll("[data-rt-interest]").forEach((button) => button.addEventListener("click", () => { selectedInterest = button.dataset.rtInterest; renderSetup(); }));
    root.querySelector("[data-rt-interest-next]")?.addEventListener("click", () => { setupStep = 3; renderSetup(); });
    root.querySelector("[data-rt-no-interest]")?.addEventListener("click", () => { selectedInterest = null; setupStep = 3; renderSetup(); });
    root.querySelector("[data-rt-back]")?.addEventListener("click", () => { setupStep = Math.max(1, setupStep - 1); renderSetup(); });
    root.querySelector("[data-rt-cancel]")?.addEventListener("click", close);
    root.querySelector("[data-rt-confirm]")?.addEventListener("change", (event) => { root.querySelector("[data-rt-find]").disabled = !event.currentTarget.checked; });
    root.querySelector("[data-rt-find]")?.addEventListener("click", async (event) => {
      event.currentTarget.disabled = true; setError("");
      try {
        if (!bridge().socketConnected()) throw new Error("Random Talk is reconnecting. Wait for the live connection and try again.");
        await post("/join", { temporaryUsername, interest: selectedInterest, safetyConfirmed: true });
        current = await post("/search"); renderCurrent();
      } catch (error) { setError(error.message); event.currentTarget.disabled = false; }
    });
  }

  function renderIdle() {
    temporaryUsername = current.temporaryUsername || temporaryUsername; selectedInterest = current.selectedInterest || null;
    root.innerHTML = shell(`<div class="rt-ended-wrap"><article class="rt-ended-card"><span class="rt-eyebrow">Ready when you are</span><h2>${esc(temporaryUsername)}</h2><p class="rt-muted">${selectedInterest ? `Interest: ${esc(selectedInterest)}` : "No interest selected — match with anyone."}</p><div class="rt-error hidden" data-rt-error></div><div class="rt-actions"><button class="rt-button primary" data-rt-search type="button">Find a Stranger</button><button class="rt-button" data-rt-edit type="button">Edit setup</button><button class="rt-button danger" data-rt-close type="button">Leave Random Talk</button></div></article></div>`);
    bindShell(); root.querySelector("[data-rt-search]")?.addEventListener("click", startSearch); root.querySelector("[data-rt-edit]")?.addEventListener("click", () => { setupStep = 1; renderSetup(); });
  }

  async function startSearch() {
    try { current = await post("/search"); renderCurrent(); }
    catch (error) { setError(error.message); }
  }

  function renderQueued() {
    const lines = ["Looking for someone online…", "Finding a compatible stranger…", "Matching by interest where possible…"];
    let index = 0;
    root.innerHTML = shell(`<div class="rt-search-wrap"><article class="rt-search-card"><div class="rt-radar"><span></span></div><span class="rt-eyebrow">Searching securely</span><h2>Finding someone for you…</h2><p class="rt-search-lines" data-rt-search-line>${lines[0]}</p>${current.selectedInterest ? `<span class="rt-interest-badge">${esc(current.selectedInterest)}</span>` : '<span class="rt-interest-badge">Any interest</span>'}<div class="rt-error hidden" data-rt-error></div><div class="rt-actions"><button class="rt-button" data-rt-cancel-search type="button">Cancel Search</button><button class="rt-button danger" data-rt-close type="button">Leave Random Talk</button></div></article></div>`);
    bindShell(); clearInterval(searchingTicker); searchingTicker = setInterval(() => { const line = root?.querySelector("[data-rt-search-line]"); if (line) line.textContent = lines[++index % lines.length]; }, 2200);
    root.querySelector("[data-rt-cancel-search]")?.addEventListener("click", async () => { current = await post("/cancel-search"); renderCurrent(); });
  }

  function messageHtml(message) { return `<div class="rt-message ${message.mine ? "mine" : ""}" data-rt-message="${esc(message.id)}"><div class="rt-bubble"><p>${esc(message.body)}</p><time>${formatTime(message.createdAt)}</time></div></div>`; }
  function paintMessages() {
    const area = root?.querySelector("[data-rt-messages]"); if (!area) return;
    const rows = current.messages || [];
    area.innerHTML = rows.length ? rows.map(messageHtml).join("") : '<div class="rt-empty"><div><strong>Say hello</strong><p>Keep personal information private.</p></div></div>';
    area.scrollTop = area.scrollHeight;
  }

  async function ensureCallConfig() {
    if (!callConfig) callConfig = await api("/call-config", { cache: "no-store" });
    if (!callConfig.enabled) throw new Error("Voice and video are waiting for the site's private TURN relay configuration.");
    return callConfig;
  }

  function mediaErrorMessage(error, mode) {
    if (!window.isSecureContext) return "Calls require the secure HTTPS site.";
    if (!navigator.mediaDevices?.getUserMedia) return "This browser does not support live calls.";
    if (error?.name === "NotAllowedError") return `${mode === "video" ? "Camera or microphone" : "Microphone"} permission was denied. You can keep chatting by text.`;
    if (error?.name === "NotFoundError") return `No available ${mode === "video" ? "camera or microphone" : "microphone"} was found.`;
    if (error?.name === "NotReadableError") return "Your camera or microphone is busy in another app.";
    return error?.message || "The call device could not start.";
  }

  function mediaConstraints(mode, facingMode = callState.facingMode) {
    const dataSaver = localStorage.getItem("tct_rt_data_saver") !== "0";
    return {
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: mode === "video" ? {
        facingMode: { ideal: facingMode },
        width: { ideal: dataSaver ? 480 : 640, max: dataSaver ? 640 : 1280 },
        height: { ideal: dataSaver ? 360 : 480, max: dataSaver ? 480 : 720 },
        frameRate: { ideal: dataSaver ? 15 : 24, max: dataSaver ? 18 : 30 },
      } : false,
    };
  }

  async function acquireMedia(mode, facingMode = callState.facingMode) {
    await ensureCallConfig();
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia(mediaConstraints(mode, facingMode)); }
    catch (error) { throw new Error(mediaErrorMessage(error, mode)); }
    stopLocalMedia();
    localStream = stream;
    callState.mode = mode;
    callState.microphone = stream.getAudioTracks().some((track) => track.readyState === "live");
    callState.camera = stream.getVideoTracks().some((track) => track.readyState === "live");
    callState.facingMode = facingMode;
    syncCallUi();
    return stream;
  }

  function stopLocalMedia() {
    localStream?.getTracks().forEach((track) => track.stop());
    localStream = null;
    callState.microphone = false;
    callState.camera = false;
  }

  function destroyPeer() {
    clearTimeout(disconnectCallTimer);
    pendingIce = [];
    if (peer) {
      peer.ontrack = null;
      peer.onicecandidate = null;
      peer.onconnectionstatechange = null;
      peer.close();
    }
    peer = null;
    remoteStream = null;
  }

  function endCall({ notify = true, reason = "ended" } = {}) {
    if (notify && callState.status !== "idle") bridge().emit("random-talk-call-signal", { kind: "hangup", reason });
    destroyPeer();
    stopLocalMedia();
    callState = { status: "idle", mode: null, incoming: false, microphone: false, camera: false, facingMode: "user" };
    syncCallUi();
  }

  async function createPeer() {
    if (peer) return peer;
    const config = await ensureCallConfig();
    peer = new RTCPeerConnection({ iceServers: config.iceServers, iceTransportPolicy: "relay", bundlePolicy: "max-bundle", rtcpMuxPolicy: "require" });
    localStream?.getTracks().forEach((track) => peer.addTrack(track, localStream));
    peer.onicecandidate = (event) => bridge().emit("random-talk-call-signal", { kind: "ice", candidate: event.candidate?.toJSON?.() || event.candidate || null });
    peer.ontrack = (event) => {
      remoteStream = event.streams[0] || remoteStream || new MediaStream();
      if (!event.streams[0]) remoteStream.addTrack(event.track);
      syncCallUi();
    };
    peer.onconnectionstatechange = () => {
      if (["connected", "completed"].includes(peer?.connectionState)) {
        callState.status = "active";
        clearTimeout(disconnectCallTimer);
        syncCallUi();
      } else if (["failed", "closed"].includes(peer?.connectionState)) {
        endCall({ notify: peer?.connectionState === "failed", reason: "connection-failed" });
        setError("The call ended because the connection failed. Text chat is still available.");
      } else if (peer?.connectionState === "disconnected") {
        clearTimeout(disconnectCallTimer);
        disconnectCallTimer = setTimeout(() => {
          if (peer?.connectionState === "disconnected") endCall({ notify: true, reason: "weak-connection" });
        }, 8000);
        syncCallUi();
      }
    };
    return peer;
  }

  async function flushIce() {
    if (!peer?.remoteDescription) return;
    const queued = pendingIce.splice(0);
    for (const candidate of queued) await peer.addIceCandidate(candidate).catch(() => {});
  }

  function syncCallUi() {
    if (!root) return;
    const stage = root.querySelector("[data-rt-call-stage]");
    if (stage) stage.classList.toggle("active", callState.status !== "idle");
    const remoteVideo = root.querySelector("[data-rt-remote-video]");
    const localVideo = root.querySelector("[data-rt-local-video]");
    if (remoteVideo && remoteVideo.srcObject !== remoteStream) remoteVideo.srcObject = remoteStream;
    if (localVideo && localVideo.srcObject !== localStream) localVideo.srcObject = localStream;
    root.querySelectorAll("[data-rt-call-status]").forEach((node) => {
      node.textContent = callState.status === "outgoing" ? "Calling…" : callState.status === "ringing" ? "Incoming call" : callState.status === "active" ? "Live call" : "Text only";
    });
    const mic = root.querySelector("[data-rt-mic]");
    const camera = root.querySelector("[data-rt-camera]");
    if (mic) { mic.textContent = callState.microphone ? "Mute" : "Turn mic on"; mic.classList.toggle("off", !callState.microphone); }
    if (camera) { camera.textContent = callState.camera ? "Camera off" : "Camera on"; camera.classList.toggle("off", !callState.camera); }
    root.querySelector("[data-rt-audio-only]")?.classList.toggle("hidden", Boolean(remoteStream?.getVideoTracks().length));
  }

  function openGuestCreditNotice() {
    modal(`<span class="rt-eyebrow">Guest credits are temporary</span><h3>Create an account to buy credits</h3><p class="rt-muted">Purchases need a registered account so credits and payment history can be recovered safely. Your current guest match will end only if you choose to continue.</p><div class="rt-actions"><button class="rt-button primary" data-rt-auth="register" type="button">Register</button><button class="rt-button" data-rt-auth="login" type="button">Log In</button><button class="rt-button" data-rt-modal-close type="button">Keep chatting</button></div>`).querySelectorAll("[data-rt-auth]").forEach((button) => button.addEventListener("click", () => bridge().openAuth?.(button.dataset.rtAuth)));
  }

  function openCallConsent(mode) {
    const label = mode === "video" ? "video" : "voice";
    const layer = modal(`<span class="rt-eyebrow">Optional ${label} call</span><h3>Start a ${label} call?</h3><p class="rt-muted">The stranger must accept. ${mode === "video" ? "You will see your own preview before the request is sent. " : ""}Nothing is recorded. You can turn devices off or hang up at any time.</p><label class="rt-confirm"><input data-rt-data-saver type="checkbox" ${localStorage.getItem("tct_rt_data_saver") !== "0" ? "checked" : ""} /> Data Saver (lower-resolution video)</label><div class="rt-error hidden" data-rt-error></div><div class="rt-actions"><button class="rt-button primary" data-rt-call-confirm type="button">Enable ${mode === "video" ? "camera and microphone" : "microphone"}</button><button class="rt-button" data-rt-modal-close type="button">Cancel</button></div>`);
    layer.querySelector("[data-rt-data-saver]")?.addEventListener("change", (event) => localStorage.setItem("tct_rt_data_saver", event.currentTarget.checked ? "1" : "0"));
    layer.querySelector("[data-rt-call-confirm]")?.addEventListener("click", async (event) => {
      event.currentTarget.disabled = true;
      try {
        await acquireMedia(mode);
        callState.status = "outgoing";
        callState.incoming = false;
        bridge().emit("random-talk-call-signal", { kind: "request", mode });
        layer.classList.add("hidden");
        syncCallUi();
      } catch (error) {
        const area = layer.querySelector("[data-rt-error]"); area.textContent = error.message; area.classList.remove("hidden"); event.currentTarget.disabled = false;
      }
    });
  }

  function openIncomingCall(mode) {
    const layer = modal(`<span class="rt-eyebrow">Incoming ${esc(mode)} call</span><h3>The stranger wants to call</h3><p class="rt-muted">Nothing turns on until you accept. Calls are live and not recorded.</p><div class="rt-error hidden" data-rt-error></div><div class="rt-actions"><button class="rt-button primary" data-rt-accept-call type="button">Accept ${esc(mode)} call</button><button class="rt-button danger" data-rt-decline-call type="button">Decline</button></div>`);
    layer.querySelector("[data-rt-decline-call]").addEventListener("click", () => { bridge().emit("random-talk-call-signal", { kind: "decline", reason: "declined" }); callState = { ...callState, status: "idle", incoming: false }; layer.classList.add("hidden"); syncCallUi(); });
    layer.querySelector("[data-rt-accept-call]").addEventListener("click", async (event) => {
      event.currentTarget.disabled = true;
      try {
        await acquireMedia(mode);
        callState.status = "active";
        callState.incoming = true;
        await createPeer();
        bridge().emit("random-talk-call-signal", { kind: "accept", mode });
        layer.classList.add("hidden");
        syncCallUi();
      } catch (error) {
        const area = layer.querySelector("[data-rt-error]"); area.textContent = error.message; area.classList.remove("hidden"); event.currentTarget.disabled = false;
      }
    });
  }

  async function toggleMicrophone() {
    const existing = localStream?.getAudioTracks()[0];
    if (existing) {
      existing.stop();
      localStream.removeTrack(existing);
      const sender = peer?.getSenders().find((item) => item.track?.kind === "audio");
      await sender?.replaceTrack(null);
      callState.microphone = false;
    } else {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: mediaConstraints("voice").audio, video: false });
      const track = stream.getAudioTracks()[0];
      if (!localStream) localStream = new MediaStream();
      localStream.addTrack(track);
      const sender = peer?.getSenders().find((item) => item.track?.kind === "audio" || !item.track);
      if (sender) await sender.replaceTrack(track); else peer?.addTrack(track, localStream);
      callState.microphone = true;
    }
    bridge().emit("random-talk-call-signal", { kind: "media-state", microphone: callState.microphone, camera: callState.camera });
    syncCallUi();
  }

  async function toggleCamera() {
    const existing = localStream?.getVideoTracks()[0];
    if (existing) {
      existing.stop(); localStream.removeTrack(existing);
      const sender = peer?.getSenders().find((item) => item.track?.kind === "video");
      await sender?.replaceTrack(null); callState.camera = false;
    } else {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: mediaConstraints("video").video });
      const track = stream.getVideoTracks()[0];
      if (!localStream) localStream = new MediaStream();
      localStream.addTrack(track);
      const sender = peer?.getSenders().find((item) => item.track?.kind === "video");
      if (sender) await sender.replaceTrack(track); else peer?.addTrack(track, localStream);
      callState.camera = true; callState.mode = "video";
    }
    bridge().emit("random-talk-call-signal", { kind: "media-state", microphone: callState.microphone, camera: callState.camera });
    syncCallUi();
  }

  async function switchCamera() {
    if (!callState.camera) return;
    const nextFacing = callState.facingMode === "user" ? "environment" : "user";
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: mediaConstraints("video", nextFacing).video });
    const next = stream.getVideoTracks()[0];
    const old = localStream.getVideoTracks()[0];
    const sender = peer?.getSenders().find((item) => item.track?.kind === "video");
    await sender?.replaceTrack(next);
    old?.stop(); if (old) localStream.removeTrack(old); localStream.addTrack(next);
    callState.facingMode = nextFacing; syncCallUi();
  }

  function renderMatched() {
    clearInterval(searchingTicker);
    const partner = current.partner || {};
    root.innerHTML = shell(`<div class="rt-chat"><div class="rt-chat-head"><div class="rt-stranger"><b class="rt-anon-avatar">?</b><span><strong>${esc(partner.temporaryUsername || "Stranger")}</strong><small><i class="rt-guest-badge">${partner.guest ? "Guest" : "Anonymous"}</i> <span data-rt-duration>00:00</span> · <span data-rt-call-status>Text only</span></small></span></div><div class="rt-actions"><span class="rt-status-badge ${partner.connected === false ? "offline" : ""}">${partner.connected === false ? "Reconnecting" : "Online"}</span>${partner.interest ? `<span class="rt-interest-badge">${esc(partner.interest)}</span>` : ""}<button class="rt-button" data-rt-call="voice" type="button">Voice</button><button class="rt-button" data-rt-call="video" type="button">Video</button></div></div><div class="rt-conversation-grid"><section class="rt-call-stage ${callState.status !== "idle" ? "active" : ""}" data-rt-call-stage><video data-rt-remote-video autoplay playsinline></video><div class="rt-audio-only" data-rt-audio-only><b>?</b><span>Voice call with ${esc(partner.temporaryUsername || "Stranger")}</span></div><video class="rt-local-video" data-rt-local-video autoplay playsinline muted></video><div class="rt-call-quality"><i></i><span data-rt-call-status>Live call</span></div><div class="rt-call-controls"><button data-rt-mic type="button">Mute</button><button data-rt-camera type="button">Camera off</button><button data-rt-switch-camera type="button">Switch camera</button><button class="danger" data-rt-hangup type="button">Hang up</button></div></section><section class="rt-text-panel"><div class="rt-message-area" data-rt-messages></div><div><div class="rt-typing" data-rt-typing></div><form class="rt-composer" data-rt-composer><button class="rt-button danger" data-rt-skip type="button">Skip</button><input name="body" maxlength="500" placeholder="Message your stranger…" autocomplete="off" /><button class="rt-button primary" type="submit">Send</button></form></div></section></div></div>`, partner.temporaryUsername ? `Connected with ${partner.temporaryUsername}` : "Connected with a stranger");
    bindShell(); paintMessages(); bindChat(); syncCallUi(); startDurationTicker();
  }

  function startDurationTicker() {
    clearInterval(durationTicker);
    const paint = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - new Date(current.connectedAt || Date.now()).getTime()) / 1000));
      const value = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
      root?.querySelectorAll("[data-rt-duration]").forEach((node) => { node.textContent = value; });
    };
    paint(); durationTicker = setInterval(paint, 1000);
  }

  function bindChat() {
    root.querySelector("[data-rt-skip]")?.addEventListener("click", async (event) => { event.currentTarget.disabled = true; endCall({ notify: true, reason: "skipped" }); try { current = await post("/skip"); renderCurrent(); } catch (error) { setError(error.message); event.currentTarget.disabled = false; } });
    root.querySelectorAll("[data-rt-call]").forEach((button) => button.addEventListener("click", () => {
      if (callState.status !== "idle") return setError("End the current call before starting another one.");
      openCallConsent(button.dataset.rtCall);
    }));
    root.querySelector("[data-rt-mic]")?.addEventListener("click", () => toggleMicrophone().catch((error) => setError(mediaErrorMessage(error, "voice"))));
    root.querySelector("[data-rt-camera]")?.addEventListener("click", () => toggleCamera().catch((error) => setError(mediaErrorMessage(error, "video"))));
    root.querySelector("[data-rt-switch-camera]")?.addEventListener("click", () => switchCamera().catch((error) => setError(mediaErrorMessage(error, "video"))));
    root.querySelector("[data-rt-hangup]")?.addEventListener("click", () => endCall({ notify: true, reason: "hangup" }));
    const form = root.querySelector("[data-rt-composer]");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault(); const input = event.currentTarget.body; const body = input.value.trim(); if (!body) return;
      const button = event.currentTarget.querySelector("button[type='submit']"); button.disabled = true;
      try { await post("/message", { body, clientMessageId: crypto.randomUUID() }); input.value = ""; bridge().emit("random-talk-typing", { typing: false }); }
      catch (error) { setError(error.message); }
      finally { button.disabled = false; input.focus(); }
    });
    const messageInput = form?.querySelector('input[name="body"]');
    messageInput?.addEventListener("input", () => { bridge().emit("random-talk-typing", { typing: true }); clearTimeout(typingOffTimer); typingOffTimer = setTimeout(() => bridge().emit("random-talk-typing", { typing: false }), 1400); });
  }

  function renderEnded() {
    clearInterval(searchingTicker);
    const message = current.message || (current.reason === "queue_timeout" ? "No one suitable is available right now." : "The stranger disconnected.");
    root.innerHTML = shell(`<div class="rt-ended-wrap"><article class="rt-ended-card"><span class="rt-eyebrow">Conversation ended</span><h2>${esc(message)}</h2><p class="rt-muted">Your previous messages will never appear in the next conversation.</p><div class="rt-error hidden" data-rt-error></div><div class="rt-actions"><button class="rt-button primary" data-rt-search type="button">Find Someone Else</button>${current.canReport ? '<button class="rt-button" data-rt-report type="button">Report</button><button class="rt-button" data-rt-block type="button">Block</button>' : ""}<button class="rt-button danger" data-rt-close type="button">Leave Random Talk</button></div></article></div>`);
    bindShell(); root.querySelector("[data-rt-search]")?.addEventListener("click", startSearch); root.querySelectorAll("[data-rt-report]").forEach((button) => button.addEventListener("click", openReport)); root.querySelectorAll("[data-rt-block]").forEach((button) => button.addEventListener("click", openBlockConfirm));
  }

  function modal(content) { const layer = root.querySelector("[data-rt-modal]"); layer.innerHTML = `<section class="rt-modal-card">${content}</section>`; layer.classList.remove("hidden"); layer.querySelector("[data-rt-modal-close]")?.addEventListener("click", () => layer.classList.add("hidden")); return layer; }
  function openReport() {
    const layer = modal(`<h3>Report this stranger</h3><p class="rt-muted">A short recent message excerpt is saved for authorised staff review. The stranger is not told who reported them.</p><form data-rt-report-form><label class="rt-field">Category<select name="category">${reportCategories.map((category) => `<option>${esc(category)}</option>`).join("")}</select></label><label class="rt-field">Details<textarea name="details" maxlength="500" placeholder="Briefly explain what happened"></textarea></label><div class="rt-error hidden" data-rt-error></div><div class="rt-actions"><button class="rt-button primary" type="submit">Report and Skip</button><button class="rt-button" data-rt-modal-close type="button">Cancel</button></div></form>`);
    layer.querySelector("form").addEventListener("submit", async (event) => { event.preventDefault(); const submit = event.currentTarget.querySelector("button[type='submit']"); submit.disabled = true; try { endCall({ notify: true, reason: "reported" }); await post("/report", { ...Object.fromEntries(new FormData(event.currentTarget)), skip: true }); layer.classList.add("hidden"); } catch (error) { const area = layer.querySelector("[data-rt-error]"); area.textContent = error.message; area.classList.remove("hidden"); submit.disabled = false; } });
  }
  function openBlockConfirm() {
    const layer = modal(`<h3>Block this stranger?</h3><p class="rt-muted">The conversation will end and your accounts will not be matched again. They will not be told who blocked them.</p><div class="rt-error hidden" data-rt-error></div><div class="rt-actions"><button class="rt-button danger" data-rt-confirm-block type="button">Block stranger</button><button class="rt-button" data-rt-modal-close type="button">Cancel</button></div>`);
    layer.querySelector("[data-rt-confirm-block]").addEventListener("click", async (event) => { event.currentTarget.disabled = true; try { endCall({ notify: true, reason: "blocked" }); await post("/block"); current = await api("/status"); renderCurrent(); } catch (error) { const area = layer.querySelector("[data-rt-error]"); area.textContent = error.message; area.classList.remove("hidden"); event.currentTarget.disabled = false; } });
  }

  function renderCurrent() {
    if (!openState || !root) return;
    if (current.status !== "matched" && callState.status !== "idle") endCall({ notify: false });
    if (current.status === "setup") return renderSetup();
    if (current.status === "idle") return renderIdle();
    if (current.status === "queued") return renderQueued();
    if (current.status === "matched") return renderMatched();
    return renderEnded();
  }

  async function open() {
    if (openState) return;
    openState = true; document.body.classList.add("random-talk-open");
    document.body.insertAdjacentHTML("beforeend", '<div class="rt-overlay" id="randomTalkOverlay"><section class="rt-shell"><div class="view-loading"><span></span><strong>Opening Random Talk…</strong></div></section></div>');
    root = document.querySelector("#randomTalkOverlay");
    try { current = await api("/status"); if (current.temporaryUsername) temporaryUsername = current.temporaryUsername; if (current.selectedInterest) selectedInterest = current.selectedInterest; renderCurrent(); }
    catch (error) { current = { status: "ended", message: "We couldn’t connect you right now. Your normal chat is still available." }; renderCurrent(); setError(error.message); }
  }

  async function close() {
    if (!openState) return;
    openState = false; clearInterval(searchingTicker); clearInterval(durationTicker); clearTimeout(typingOffTimer);
    endCall({ notify: true, reason: "left" });
    await post("/leave").catch(() => {});
    root?.remove(); root = null; document.body.classList.remove("random-talk-open");
  }

  async function handleCallSignal(payload = {}) {
    const kind = payload.kind;
    if (kind === "request") {
      if (callState.status !== "idle") return bridge().emit("random-talk-call-signal", { kind: "decline", reason: "busy" });
      callState = { ...callState, status: "ringing", incoming: true, mode: payload.mode || "voice" };
      openIncomingCall(callState.mode);
      syncCallUi();
      return;
    }
    if (kind === "decline") {
      endCall({ notify: false });
      setError(payload.reason === "busy" ? "The stranger is already handling another call." : "The stranger declined the call. Text chat is still available.");
      return;
    }
    if (kind === "accept") {
      if (callState.status !== "outgoing") return;
      callState.status = "active";
      const connection = await createPeer();
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      bridge().emit("random-talk-call-signal", { kind: "offer", description: connection.localDescription.toJSON?.() || connection.localDescription });
      syncCallUi();
      return;
    }
    if (kind === "offer") {
      if (callState.status !== "active") return;
      const connection = await createPeer();
      await connection.setRemoteDescription(payload.description);
      await flushIce();
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      bridge().emit("random-talk-call-signal", { kind: "answer", description: connection.localDescription.toJSON?.() || connection.localDescription });
      return;
    }
    if (kind === "answer") {
      if (!peer || callState.status !== "active") return;
      await peer.setRemoteDescription(payload.description);
      await flushIce();
      return;
    }
    if (kind === "ice") {
      if (!peer?.remoteDescription) pendingIce.push(payload.candidate);
      else await peer.addIceCandidate(payload.candidate).catch(() => {});
      return;
    }
    if (kind === "hangup") {
      endCall({ notify: false });
      if (openState) setError(payload.reason === "peer-disconnected" ? "The call ended because the stranger disconnected. Text will resume if they reconnect." : "The call ended. Text chat is still available.");
      return;
    }
    if (kind === "media-state" && openState) {
      const quality = root?.querySelector(".rt-call-quality span");
      if (quality) quality.textContent = `${payload.microphone ? "Mic on" : "Mic off"} · ${payload.camera ? "Camera on" : "Camera off"}`;
    }
  }

  function handleRealtime(type, payload) {
    if (type === "state") { current = payload; if (openState) renderCurrent(); return; }
    if (type === "message" && current.status === "matched") {
      current.messages = current.messages || [];
      if (current.messages.some((item) => item.id === payload.id)) return;
      current.messages.push(payload); current.messages = current.messages.slice(-40);
      if (openState) {
        const area = root?.querySelector("[data-rt-messages]");
        if (area) { if (area.querySelector(".rt-empty")) area.innerHTML = ""; area.insertAdjacentHTML("beforeend", messageHtml(payload)); area.scrollTop = area.scrollHeight; }
      }
      return;
    }
    if (type === "typing" && openState) { const line = root?.querySelector("[data-rt-typing]"); if (line) line.textContent = payload.typing ? "Stranger is typing…" : ""; return; }
    if (type === "call-signal") { handleCallSignal(payload).catch((error) => { endCall({ notify: false }); setError(error.message); }); return; }
    if (type === "call-error") { if (openState) setError(payload.message); return; }
    if (type === "error") { if (openState) setError(payload.message); }
  }

  window.addEventListener("beforeunload", () => {
    if (!openState || !bridge().getState().token) return;
    destroyPeer(); stopLocalMedia();
    fetch("/api/random-talk/leave", { method: "POST", headers: { Authorization: `Bearer ${bridge().getState().token}`, "Content-Type": "application/json" }, body: "{}", keepalive: true }).catch(() => {});
  });

  window.RandomTalk = { open, close, handleRealtime, isOpen: () => openState };
})();
