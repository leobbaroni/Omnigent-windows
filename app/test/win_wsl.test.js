// [win] Tests for src/win/wsl.js.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const wsl = require("../src/win/wsl");
const { cliCommandParts } = require("../src/omnigent_cli");

describe("win wsl", () => {
  it("builds a wsl.exe command the upstream cliCommandParts accepts", () => {
    const cmd = wsl.wslCliCommand("Ubuntu");
    const parts = cliCommandParts(cmd);
    assert.equal(parts.executable, "wsl.exe");
    assert.deepEqual(parts.prefixArgs, ["-d", "Ubuntu", "--shell-type", "login", "--", "omnigent"]);
    assert.equal(parts.displayName, "wsl -d Ubuntu --shell-type login -- omnigent");
    assert.throws(() => wsl.wslCliCommand("  "), TypeError);
  });

  it("is active only with mode=wsl and a distro", () => {
    assert.equal(wsl.activeCliCommand({}), null);
    assert.equal(wsl.activeCliCommand({ win_local_mode: "wsl" }), null);
    assert.equal(wsl.activeCliCommand({ win_local_mode: "native", win_wsl_distro: "Ubuntu" }), null);
    assert.equal(wsl.activeCliCommand({ win_local_mode: "wsl", win_wsl_distro: "Ubuntu" }).executable, "wsl.exe");
  });

  it("lists distros minus docker's internal ones", () => {
    const exec = (cmd, args) => {
      if (cmd === "wsl.exe") return Buffer.from("Ubuntu\r\ndocker-desktop\r\ndocker-desktop-data\r\n", "utf16le");
      throw new Error("ENOENT");
    };
    assert.deepEqual(wsl.listDistros({ exec }), ["Ubuntu"]);
  });

  it("reports CLI status through the distro", async () => {
    const cmd = wsl.wslCliCommand("Ubuntu");
    const ok = await wsl.cliStatus(cmd, async (c, args) => ({ code: 0, stdout: "omnigent 0.12.0\n", stderr: "" }));
    assert.equal(ok.installed, true);
    assert.equal(ok.version, "omnigent 0.12.0");
    assert.equal(ok.source, "wsl");
    assert.equal(ok.distro, "Ubuntu");
    assert.equal(cmd.prefixArgs[1], "Ubuntu");
    const missing = await wsl.cliStatus(cmd, async () => ({ code: 127, stdout: "", stderr: "omnigent: command not found" }));
    assert.equal(missing.installed, false);
  });
});
