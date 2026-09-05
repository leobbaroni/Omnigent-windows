// [win] Tests for src/win/bootstrap.js — detection, steps, and the guarded runner.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const boot = require("../src/win/bootstrap");

/** Build an exec fake from a {"cmd args": stdout | Error} table. */
function fakeExec(table) {
  return (cmd, args, opts) => {
    const key = `${cmd} ${args.join(" ")}`;
    if (!(key in table)) throw new Error(`ENOENT ${key}`);
    const v = table[key];
    if (v instanceof Error) throw v;
    return opts && opts.encoding === "buffer" ? v : String(v);
  };
}

describe("win bootstrap: parseSemver / decodeWslOutput", () => {
  it("parses versions out of tool banners", () => {
    assert.deepEqual(boot.parseSemver("uv 0.12.7 (61291a8ca 2026-08-27)"), {
      major: 0,
      minor: 12,
      patch: 7,
      text: "0.12.7",
    });
    assert.equal(boot.parseSemver("Python was not found"), null);
  });

  it("decodes UTF-16LE wsl output and falls back to UTF-8", () => {
    const utf16 = Buffer.from("Ubuntu\r\ndocker-desktop\r\n", "utf16le");
    assert.equal(boot.decodeWslOutput(utf16), "Ubuntu\r\ndocker-desktop\r\n");
    assert.equal(boot.decodeWslOutput(Buffer.from("Ubuntu\n", "utf8")), "Ubuntu\n");
    assert.equal(boot.decodeWslOutput(null), "");
  });
});

describe("win bootstrap: detectPrerequisites", () => {
  it("reports found tools with versions and WSL distros", () => {
    const exec = fakeExec({
      "uv --version": "uv 0.12.7 (abc 2026-08-27)",
      "py -3 --version": "Python 3.13.3",
      "node --version": "v22.16.0",
      "wsl.exe -l -q": Buffer.from("Ubuntu\r\ndocker-desktop\r\n", "utf16le"),
    });
    const p = boot.detectPrerequisites({ exec, platform: "win32", release: "10.0.19045" });
    assert.deepEqual(p.uv, { found: true, version: "0.12.7" });
    assert.deepEqual(p.python, { found: true, version: "3.13.3", ok: true, launcher: "py" });
    assert.deepEqual(p.node, { found: true, version: "22.16.0", ok: true });
    assert.deepEqual(p.wsl, { available: true, distros: ["Ubuntu", "docker-desktop"] });
  });

  it("treats a missing tool, an old Python, an old Node, and no WSL correctly", () => {
    const exec = fakeExec({
      "python --version": "Python 3.11.9",
      "node --version": "v18.20.0",
    });
    const p = boot.detectPrerequisites({ exec, platform: "win32" });
    assert.equal(p.uv.found, false);
    assert.deepEqual(p.python, { found: true, version: "3.11.9", ok: false, launcher: "python" });
    assert.equal(p.node.ok, false);
    assert.deepEqual(p.wsl, { available: false, distros: [] });
  });
});

describe("win bootstrap: steps", () => {
  const exec = fakeExec({ "node --version": "v22.16.0" });

  it("blocks the Omnigent step until uv exists and marks required/optional", () => {
    const s = boot.status({ installed: false }, { exec, platform: "win32" });
    const byId = Object.fromEntries(s.steps.map((x) => [x.id, x]));
    assert.equal(byId.uv.done, false);
    assert.equal(byId.uv.required, true);
    assert.equal(byId.omnigent.blockedBy, "uv");
    assert.equal(byId.omnigent.command, "uv tool install --python 3.12 omnigent");
    assert.equal(byId.node.required, false);
    assert.equal(byId.node.done, true);
    assert.ok(s.limitations.length >= 2);
    assert.match(s.wslHint, /No WSL distro/);
  });

  it("recommends WSL with its own steps, blocked until a distro exists", () => {
    const s = boot.status({ installed: false }, { exec, platform: "win32" });
    assert.match(s.wslRecommendation, /Recommended on Windows/);
    const byId = Object.fromEntries(s.wslSteps.map((x) => [x.id, x]));
    assert.equal(byId["wsl-distro"].done, false);
    assert.equal(byId["wsl-omnigent"].blockedBy, "wsl-distro");
    assert.match(byId["wsl-omnigent"].command, /^wsl -d Ubuntu -- bash -lc "curl -fsSL https:\/\/omnigent\.ai\/install\.sh \| sh"$/);
    const withDistro = fakeExec({
      "node --version": "v22.16.0",
      "wsl.exe -l -q": Buffer.from("Ubuntu\r\ndocker-desktop\r\n", "utf16le"),
      "wsl.exe -d Ubuntu --shell-type login -- omnigent --version": Buffer.from("omnigent 0.12.0 (built x)\n"),
      "wsl.exe -d Ubuntu --shell-type login -- claude auth status": Buffer.from('{\n  "loggedIn": false,\n  "authMethod": null\n}\n'),
    });
    const s2 = boot.status({ installed: false }, { exec: withDistro, platform: "win32" });
    const by2 = Object.fromEntries(s2.wslSteps.map((x) => [x.id, x]));
    assert.equal(by2["wsl-distro"].done, true);
    assert.equal(by2["wsl-omnigent"].done, true);
    assert.equal(by2["wsl-omnigent"].blockedBy, null);
    assert.match(by2["wsl-omnigent"].note, /0\.12\.0/);
    assert.equal(by2["wsl-claude-login"].done, false);
    assert.equal(by2["wsl-claude-login"].blockedBy, null);
    assert.match(by2["wsl-claude-login"].note, /not signed in/);
    assert.equal(by2["wsl-claude-login"].command, "wsl -d Ubuntu --shell-type login -- claude");
  });

  it("wsl probes tolerate missing CLIs and parse auth state", () => {
    const exec = fakeExec({ "wsl.exe -d Ubuntu --shell-type login -- claude auth status": Buffer.from('{"loggedIn": true}') });
    assert.equal(boot.wslClaudeAuth(exec, "Ubuntu"), true);
    assert.equal(boot.wslOmnigentVersion(exec, "Ubuntu"), null);
    assert.equal(boot.wslClaudeAuth(fakeExec({}), "Ubuntu"), null);
  });

  it("marks steps done once uv and the CLI are present", () => {
    const withUv = fakeExec({ "uv --version": "uv 0.12.7", "node --version": "v22.16.0" });
    const s = boot.status({ installed: true, version: "omnigent 0.12.0" }, { exec: withUv, platform: "win32" });
    const byId = Object.fromEntries(s.steps.map((x) => [x.id, x]));
    assert.equal(byId.uv.done, true);
    assert.equal(byId.omnigent.done, true);
    assert.equal(byId.omnigent.blockedBy, null);
    assert.match(byId.omnigent.note, /0\.12\.0/);
  });
});

describe("win bootstrap: runInConsole", () => {
  it("opens a visible, detached PowerShell that echoes and runs the exact command", () => {
    let spawned = null;
    const res = boot.runInConsole("uv tool install --python 3.12 omnigent", {
      spawnFn: (file, args, opts) => {
        spawned = { file, args, opts };
        return { pid: 42, unref() {} };
      },
    });
    assert.equal(res.pid, 42);
    assert.equal(spawned.file, "powershell.exe");
    assert.equal(spawned.opts.detached, true);
    assert.equal(spawned.opts.windowsHide, false);
    assert.ok(spawned.args.includes("-NoExit"));
    const script = spawned.args[spawned.args.length - 1];
    assert.ok(script.includes("; uv tool install --python 3.12 omnigent; "));
  });

  it("escapes single quotes in the echoed command", () => {
    const { args } = boot.consoleArgv("echo 'hi'");
    assert.ok(args[args.length - 1].includes("Write-Host '  echo ''hi'''"));
  });
});

describe("win bootstrap: isAllowedDocsUrl", () => {
  it("allows only https docs hosts", () => {
    assert.equal(boot.isAllowedDocsUrl("https://omnigent.ai/quickstart/install"), true);
    assert.equal(boot.isAllowedDocsUrl("https://docs.astral.sh/uv/"), true);
    assert.equal(boot.isAllowedDocsUrl("http://omnigent.ai/"), false);
    assert.equal(boot.isAllowedDocsUrl("https://evil.example.com/omnigent.ai"), false);
    assert.equal(boot.isAllowedDocsUrl("javascript:alert(1)"), false);
    assert.equal(boot.isAllowedDocsUrl(null), false);
  });
});
