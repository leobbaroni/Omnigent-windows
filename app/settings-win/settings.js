// [win] Renderer script for the Windows settings page (no Node access; talks
// to the shell only through window.omnigentWinSettings).
(() => {
  "use strict";
  const api = window.omnigentWinSettings;
  const $ = (id) => document.getElementById(id);
  const status = $("status");
  let snap = null;

  function say(text, cls = "") {
    status.className = `status ${cls}`;
    status.textContent = text;
  }

  function render(s) {
    snap = s;
    $("server-url").textContent = s.settings.server_url || "No default server saved (the setup page opens at launch).";
    $("local-mode").value = s.settings.win_local_mode;
    const distro = $("wsl-distro");
    distro.replaceChildren();
    const names = [...new Set([...(s.wsl.distros || []), ...(s.settings.win_wsl_distro ? [s.settings.win_wsl_distro] : [])])];
    if (names.length === 0) {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = "No WSL distro found";
      distro.appendChild(o);
    }
    for (const n of names) {
      const o = document.createElement("option");
      o.value = n;
      o.textContent = n;
      distro.appendChild(o);
    }
    distro.value = s.settings.win_wsl_distro || (names[0] ?? "");
    $("distro-row").hidden = s.settings.win_local_mode !== "wsl";
    $("auto-start").checked = s.settings.win_auto_start_local;
    const srv = s.server;
    $("server-status").textContent =
      srv.state === "running"
        ? `Running at ${srv.url}${srv.owned ? " (started by this app)" : " (not started by this app)"}`
        : srv.state === "unhealthy"
          ? `Not responding (${srv.url})`
          : srv.state === "stopped"
            ? "Stopped"
            : "Unknown";
    $("close-to-tray").checked = s.settings.win_close_to_tray;
    $("start-with-windows").checked = s.settings.win_start_with_windows;
    $("start-with-windows").disabled = !s.versions.packaged;
    $("start-note").textContent = s.versions.packaged
      ? `Launches hidden in the tray at sign-in. Currently ${s.startWithWindowsEffective ? "registered" : "not registered"} with Windows.`
      : "Launches hidden in the tray at sign-in. Available in the installed app only (not in development runs).";
    $("notifications").checked = s.settings.win_notifications_enabled;
    $("update-mode").value = s.update.mode;
    $("update-auto-install").checked = s.update.autoInstall;

    const c = s.cli;
    const compatCls = s.compat.status === "tested" ? "ok" : s.compat.status === "unsupported" ? "warn" : "";
    const rows = [
      ["App version", `${s.versions.app}${s.versions.packaged ? "" : " (development)"}`],
      ["Runtime", `Electron ${s.versions.electron} · Chromium ${s.versions.chrome} · Node ${s.versions.node} · ${s.versions.os} ${s.versions.arch}`],
      ["Omnigent CLI", c.installed ? `${c.version}` : "Not found — open Omnigent and follow the setup steps"],
      ["CLI path", c.installed ? c.path : "—"],
      [
        "Compatibility",
        !c.installed
          ? "—"
          : { text: s.compat.status === "tested" ? `Tested with ${s.compat.version}` : s.compat.message || s.compat.status, cls: compatCls },
      ],
      ["Tested versions", `${s.support.tested.join(", ")} (minimum ${s.support.minimum}; upstream shell ${s.support.upstreamPin})`],
      ["App update status", s.update.status && s.update.status.state ? s.update.status.state : "idle"],
      ["Settings file", s.paths.settings],
      ["Log folder", s.paths.logs],
      ["Omnigent data", s.paths.dataDir],
    ];
    const kv = $("kv");
    kv.replaceChildren();
    for (const [k, v] of rows) {
      const dk = document.createElement("div");
      dk.textContent = k;
      const dv = document.createElement("div");
      if (typeof v === "object") {
        dv.textContent = v.text;
        dv.className = v.cls;
      } else {
        dv.textContent = v;
      }
      kv.append(dk, dv);
    }
  }

  async function refresh() {
    try {
      render(await api.get());
    } catch (e) {
      say(String(e && e.message ? e.message : e), "warn");
    }
  }

  async function set(patch) {
    try {
      render(await api.set(patch));
      say("Saved.", "ok");
    } catch (e) {
      say(String(e && e.message ? e.message : e), "warn");
    }
  }

  $("local-mode").addEventListener("change", (e) => set({ win_local_mode: e.target.value, win_wsl_distro: $("wsl-distro").value }));
  $("wsl-distro").addEventListener("change", (e) => set({ win_wsl_distro: e.target.value }));
  $("auto-start").addEventListener("change", (e) => set({ win_auto_start_local: e.target.checked }));
  $("close-to-tray").addEventListener("change", (e) => set({ win_close_to_tray: e.target.checked }));
  $("start-with-windows").addEventListener("change", (e) => set({ win_start_with_windows: e.target.checked }));
  $("notifications").addEventListener("change", (e) => set({ win_notifications_enabled: e.target.checked }));
  $("update-mode").addEventListener("change", (e) => set({ update_mode: e.target.value }));
  $("update-auto-install").addEventListener("change", (e) => set({ update_auto_install: e.target.checked }));
  $("refresh").addEventListener("click", refresh);
  for (const btn of document.querySelectorAll("button[data-action]")) {
    btn.addEventListener("click", async () => {
      const name = btn.dataset.action;
      btn.disabled = true;
      say("Working…");
      try {
        const r = await api.action(name);
        if (r && r.ok === false && !r.cancelled) say(r.error || "Failed.", "warn");
        else if (name === "copy-diagnostics") say("Diagnostics copied to the clipboard.", "ok");
        else say("");
      } catch (e) {
        say(String(e && e.message ? e.message : e), "warn");
      } finally {
        btn.disabled = false;
        await refresh();
      }
    });
  }
  refresh();
})();
