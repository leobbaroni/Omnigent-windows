// [win] Windows bootstrap panel for the setup page.
//
// Runs inside the bundled setup page (file://, no Node). It asks the shell for
// the Windows bootstrap status through the `omnigentSetup` preload bridge and,
// when the CLI is missing, replaces the POSIX install link with a guided,
// step-by-step panel: what was detected, the exact commands, Copy buttons, and
// "Run in PowerShell…" buttons. Running always goes through a native confirm
// dialog in the main process and opens a visible console; nothing is installed
// silently. Off Windows (or on an older shell) the status call resolves null
// and this script does nothing.

(() => {
  "use strict";
  const setup = window.omnigentSetup;
  if (!setup || typeof setup.winBootstrapStatus !== "function") return;
  const host = document.getElementById("cli-install");
  const modal = document.getElementById("cli-modal");
  if (!host) return;

  const style = document.createElement("style");
  style.textContent = `
    #cli-modal .modal { max-width: 560px; width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow: auto; }
    .winb { text-align: left; margin: 4px 0 12px; }
    .winb h3 { font-size: 15px; margin: 0 0 4px; }
    .winb p { margin: 4px 0 10px; color: #555; font-size: 13px; line-height: 1.45; }
    .winb-step { border: 1px solid #e3e3e3; border-radius: 8px; padding: 10px 12px; margin: 8px 0; }
    .winb-step.done { border-color: #cfe8d3; background: #f5fbf6; }
    .winb-step.optional { border-style: dashed; }
    .winb-head { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; }
    .winb-glyph { width: 18px; height: 18px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; color: #fff; background: #9a9a9a; flex: none; }
    .done .winb-glyph { background: #2e9e4f; }
    .winb-note { margin: 4px 0 6px 26px; }
    .winb-cmd { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-left: 26px; }
    .winb-cmd code { flex: 1 1 100%; min-width: 0; display: block; font-family: ui-monospace, Consolas, monospace; font-size: 12px; background: #f3f3f3; border: 1px solid #e3e3e3; border-radius: 6px; padding: 6px 8px; white-space: pre-wrap; word-break: break-all; }
    #cli-modal .winb-cmd button { display: inline-block; width: auto; flex: 0 0 auto; margin: 0; font-size: 12px; line-height: 1.2; height: auto; padding: 6px 12px; border-radius: 6px; border: 1px solid #cfcfcf; background: #fff; color: #222; cursor: pointer; white-space: nowrap; }
    #cli-modal .winb-cmd button.primary { background: #16181d; color: #fff; border-color: #16181d; }
    #cli-modal .winb-cmd button:disabled { opacity: .5; cursor: default; }
    .winb-links { margin: 6px 0 0 26px; font-size: 12px; }
    .winb-links a { color: #2b5bd7; cursor: pointer; text-decoration: underline; }
    .winb-msg { margin: 6px 0 0 26px; font-size: 12px; color: #2e7d32; }
    .winb-msg.bad { color: #b3261e; }
    .winb details { margin: 8px 0 0; font-size: 12px; color: #555; }
    .winb details summary { cursor: pointer; font-weight: 600; color: #333; }
    .winb details ul { margin: 6px 0 0 18px; padding: 0; }
    .winb details li { margin: 3px 0; }
    @media (prefers-color-scheme: dark) {
      .winb p, .winb details { color: #b5b5b5; }
      .winb details summary { color: #ddd; }
      .winb-step { border-color: #3a3a3a; }
      .winb-step.done { border-color: #2f5b39; background: #172319; }
      .winb-cmd code { background: #1e1e1e; border-color: #3a3a3a; color: #eee; }
      #cli-modal .winb-cmd button { background: #2a2a2a; border-color: #444; color: #eee; }
      #cli-modal .winb-cmd button.primary { background: #eee; color: #111; border-color: #eee; }
    }
  `;
  document.head.appendChild(style);

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) node.setAttribute(k, v);
    }
    for (const c of children) {
      if (c === null || c === undefined) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }

  async function copy(text, msgEl) {
    try {
      if (typeof setup.copyText === "function") await setup.copyText(text);
      else await navigator.clipboard.writeText(text);
      msgEl.className = "winb-msg";
      msgEl.textContent = "Copied.";
    } catch {
      msgEl.className = "winb-msg bad";
      msgEl.textContent = "Could not copy. Select the command and copy it manually.";
    }
  }

  function docsLink(label, url) {
    return el("a", {
      text: `${label} ↗`,
      onclick: (e) => {
        e.preventDefault();
        setup.winOpenDocs(url);
      },
    });
  }

  function stepCard(step) {
    const msg = el("div", { class: "winb-msg" });
    const runBtn = el("button", {
      class: "primary",
      type: "button",
      text: step.done ? "Installed" : "Run in PowerShell…",
      onclick: async () => {
        runBtn.disabled = true;
        msg.className = "winb-msg";
        msg.textContent = "Waiting for your confirmation…";
        try {
          const r = await setup.winBootstrapRun(step.id);
          if (r && r.ok) {
            msg.textContent =
              "A PowerShell window opened with the command. When it finishes, click Re-detect below.";
          } else if (r && r.cancelled) {
            msg.textContent = "";
          } else {
            msg.className = "winb-msg bad";
            msg.textContent = (r && r.error) || "Could not start the command.";
          }
        } catch (e) {
          msg.className = "winb-msg bad";
          msg.textContent = String(e && e.message ? e.message : e);
        }
        runBtn.disabled = step.done;
      },
    });
    runBtn.disabled = step.done || Boolean(step.blockedBy);
    if (step.blockedBy) runBtn.title = `Install ${step.blockedBy} first`;
    const classes = ["winb-step", step.done ? "done" : "", step.required ? "" : "optional"]
      .filter(Boolean)
      .join(" ");
    return el(
      "div",
      { class: classes },
      el(
        "div",
        { class: "winb-head" },
        el("span", { class: "winb-glyph", text: step.done ? "✓" : step.required ? "!" : "·" }),
        el("span", { text: step.title }),
      ),
      el("p", { class: "winb-note", text: step.note }),
      el(
        "div",
        { class: "winb-cmd" },
        el("code", { text: step.command }),
        el("button", { type: "button", text: "Copy", onclick: () => copy(step.command, msg) }),
        runBtn,
      ),
      step.alternative
        ? el("p", { class: "winb-note", text: `Alternative: ${step.alternative}` })
        : null,
      el("div", { class: "winb-links" }, docsLink("Docs", step.docs)),
      msg,
    );
  }

  function build(status) {
    const p = status.prereqs;
    const installed = Boolean(status.cli && status.cli.installed);
    const detected = [
      `uv: ${p.uv.found ? p.uv.version : "not found"}`,
      `Python: ${p.python.found ? p.python.version : "not found"}${p.python.found && !p.python.ok ? " (3.12+ needed; uv will fetch it)" : ""}`,
      `Node.js: ${p.node.found ? p.node.version : "not found"}`,
      `WSL: ${p.wsl.available ? (p.wsl.distros.length ? p.wsl.distros.join(", ") : "installed, no distro") : "not available"}`,
    ].join(" · ");
    return el(
      "div",
      { class: "winb" },
      el("h3", { text: "Set up Omnigent on Windows" }),
      el("p", {
        text: (installed
          ? `Omnigent ${status.cli && status.cli.wsl ? `is running inside WSL (${status.cli.distro})` : "is installed natively on this PC"}. `
          : "Omnigent is not installed on this PC. ") +
          "Each step below shows the exact command. “Run in PowerShell…” first asks you to confirm, then opens a PowerShell window you can watch. Nothing is installed without your confirmation.",
      }),
      el("p", { text: `Detected: ${detected}` }),
      ...(status.wslRecommendation && !(status.cli && status.cli.wsl)
        ? [
            el("h3", { text: "Recommended: run Omnigent in WSL" }),
            el("p", { text: status.wslRecommendation }),
            ...(status.wslSteps || []).map(stepCard),
            el("h3", { text: installed ? "Native Windows install (custom SDK agents only)" : "Alternative: native Windows (custom SDK agents only)" }),
          ]
        : []),
      ...(installed ? status.steps.filter((s) => s.id === "setup") : status.steps).map(stepCard),
      el("p", { text: status.wslHint }),
      el(
        "div",
        { class: "winb-links" },
        docsLink("Omnigent install guide", status.docs.install),
        " · ",
        docsLink("Desktop app docs", status.docs.desktop),
        " · ",
        docsLink("Install WSL", status.docs.wsl),
      ),
      el(
        "details",
        {},
        el("summary", { text: "What a native Windows Omnigent cannot do yet" }),
        el("ul", {}, ...status.limitations.map((t) => el("li", { text: t }))),
      ),
    );
  }

  let panel = null;
  async function render() {
    let status;
    try {
      status = await setup.winBootstrapStatus();
    } catch {
      return;
    }
    if (!status) return;
    // Hide the POSIX one-liner link; keep upstream's "Re-detect" controls.
    const posixLink = host.querySelector('a[href*="quickstart/install"]');
    if (posixLink && posixLink.closest("p")) posixLink.closest("p").hidden = true;
    const next = build(status);
    if (panel && panel.parentNode) panel.replaceWith(next);
    else {
      // Outside #cli-install (upstream hides that block once a CLI is found)
      // so the WSL recommendation stays visible for native installs too.
      const anchor = document.getElementById("cli-path-label");
      if (anchor) anchor.insertAdjacentElement("beforebegin", next);
      else host.prepend(next);
    }
    panel = next;
  }

  render();
  document.getElementById("cli-redetect")?.addEventListener("click", () => {
    setTimeout(render, 250);
  });
  document.getElementById("cli-gear")?.addEventListener("click", () => {
    render();
  });
  if (modal) {
    // Re-render when the modal opens through Start locally (no gear click).
    new MutationObserver(() => {
      if (!modal.hidden) render();
    }).observe(modal, { attributes: true, attributeFilter: ["hidden"] });
  }
})();
