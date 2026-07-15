(function () {
  "use strict";

  function controls(task, escapeHtml) {
    const challenge = task.challenge || {};
    if (task.type === "frequency") {
      return `<p>Tap the highlighted frequency channel.</p><div class="sus-frequency">${Array.from({ length: 9 }, (_, index) => `<button class="${index + 1 === Number(challenge.target) ? "target" : ""}" data-task-value="${index + 1}" type="button">${index + 1}</button>`).join("")}</div>`;
    }
    if (["power", "memory"].includes(task.type)) {
      return `<p>Repeat this sequence: <strong>${challenge.sequence.join(" · ")}</strong></p><div class="sus-sequence">${[1, 2, 3, 4].map((value) => `<button data-task-sequence="${value}" type="button">${value}</button>`).join("")}</div><small data-task-input>Sequence: —</small><button class="sus-button primary" data-task-submit type="button">Validate sequence</button>`;
    }
    if (task.type === "scan") {
      return '<p>Hold the scanner until identity verification completes. Releasing early cancels it.</p><button class="sus-button primary" data-task-hold type="button">Hold to scan</button>';
    }
    return `<p>Match the circuit symbols in the displayed order: <strong>${challenge.pairs.join(" · ")}</strong></p><div class="sus-sequence">${challenge.pairs.map((value) => `<button data-task-pair="${escapeHtml(value)}" type="button">${escapeHtml(value)}</button>`).join("")}</div><small data-task-input>Path: —</small><button class="sus-button primary" data-task-submit type="button">Connect circuit</button>`;
  }

  function bind(node, task, finish) {
    const input = [];
    node.querySelectorAll("[data-task-value]").forEach((button) => button.addEventListener("click", () => finish({ value: Number(button.dataset.taskValue) })));
    node.querySelectorAll("[data-task-sequence]").forEach((button) => button.addEventListener("click", () => {
      input.push(Number(button.dataset.taskSequence));
      node.querySelector("[data-task-input]").textContent = `Sequence: ${input.join(" · ")}`;
    }));
    node.querySelectorAll("[data-task-pair]").forEach((button) => button.addEventListener("click", () => {
      input.push(button.dataset.taskPair);
      node.querySelector("[data-task-input]").textContent = `Path: ${input.join(" · ")}`;
    }));
    node.querySelector("[data-task-submit]")?.addEventListener("click", () => finish(task.type === "circuit" ? { pairs: input } : { sequence: input }));
    const hold = node.querySelector("[data-task-hold]");
    let holdTimer = null;
    hold?.addEventListener("pointerdown", () => {
      hold.textContent = "Scanning...";
      holdTimer = setTimeout(() => finish({ held: true }), Number(task.challenge?.holdMs || 1800));
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((name) => hold?.addEventListener(name, () => {
      clearTimeout(holdTimer);
      hold.textContent = "Hold to scan";
    }));
  }

  window.SusTaskUI = { controls, bind };
})();
