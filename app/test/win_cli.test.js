// [win] Tests for src/win/cli_windows.js — pure helpers with injected probes.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const win = require("../src/win/cli_windows");

describe("win cli: candidatePaths", () => {
  it("lists omnigent.exe before omni.exe in each dir, uv bin dir first", () => {
    const paths = win.candidatePaths({ home: "C:\\Users\\u", uvBinDir: "D:\\tools\\bin" });
    assert.equal(paths[0], path.join("D:\\tools\\bin", "omnigent.exe"));
    assert.equal(paths[1], path.join("D:\\tools\\bin", "omni.exe"));
    assert.ok(paths.includes(path.join("C:\\Users\\u", ".local", "bin", "omnigent.exe")));
    assert.ok(paths.includes(path.join("C:\\Users\\u", "scoop", "shims", "omni.exe")));
  });

  it("de-duplicates the uv bin dir against the default (case-insensitively)", () => {
    const dirs = win.candidateDirs({ home: "C:\\Users\\u", uvBinDir: "c:\\users\\u\\.local\\BIN" });
    assert.equal(dirs.filter((d) => d.toLowerCase().includes(".local")).length, 1);
  });

  it("works without uv", () => {
    const dirs = win.candidateDirs({ home: "C:\\Users\\u", uvBinDir: null });
    assert.equal(dirs[0], path.join("C:\\Users\\u", ".local", "bin"));
  });
});

describe("win cli: uvToolBinDir", () => {
  it("returns the last stdout line trimmed", () => {
    const dir = win.uvToolBinDir({ exec: () => "C:\\Users\\u\\.local\\bin\r\n" });
    assert.equal(dir, "C:\\Users\\u\\.local\\bin");
  });
  it("returns null when uv is missing", () => {
    assert.equal(
      win.uvToolBinDir({
        exec: () => {
          throw new Error("ENOENT");
        },
      }),
      null,
    );
  });
});

describe("win cli: spawnOptions / cliEnv", () => {
  it("adds windowsHide and UTF-8 env on Windows and is a no-op elsewhere", () => {
    const opts = win.spawnOptions({ timeout: 5, env: { PATH: "x" } });
    if (win.IS_WIN) {
      assert.equal(opts.windowsHide, true);
      assert.equal(opts.timeout, 5);
      assert.equal(opts.env.PYTHONUTF8, "1");
      assert.equal(opts.env.PYTHONIOENCODING, "utf-8");
      assert.equal(opts.env.PATH, "x");
    } else {
      assert.deepEqual(opts, { timeout: 5, env: { PATH: "x" } });
    }
  });
});

describe("win cli: cliEnv strips nested-session markers", { skip: !win.IS_WIN }, () => {
  it("drops CLAUDECODE / CLAUDE_CODE_CHILD_SESSION but keeps credentials and PATH", () => {
    const env = win.cliEnv({ PATH: "p", CLAUDECODE: "1", CLAUDE_CODE_CHILD_SESSION: "x", CLAUDE_CODE_SESSION_ID: "s", CLAUDE_CODE_OAUTH_TOKEN: "keep", ANTHROPIC_API_KEY: "keep" });
    assert.equal(env.PATH, "p");
    assert.equal(env.CLAUDECODE, undefined);
    assert.equal(env.CLAUDE_CODE_CHILD_SESSION, undefined);
    assert.equal(env.CLAUDE_CODE_SESSION_ID, undefined);
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "keep");
    assert.equal(env.ANTHROPIC_API_KEY, "keep");
  });
});

describe("win cli: killTree", () => {
  it("runs taskkill /T /F for a pid and resolves true on success", async () => {
    const calls = [];
    const ok = await win.killTree(1234, {
      exec: (file, args, _opts, cb) => {
        calls.push([file, args]);
        cb(null);
      },
    });
    assert.equal(ok, true);
    assert.deepEqual(calls, [["taskkill", ["/PID", "1234", "/T", "/F"]]]);
  });
  it("resolves false for a bad pid or a failed taskkill", async () => {
    assert.equal(await win.killTree(0), false);
    assert.equal(await win.killTree(5, { exec: (_f, _a, _o, cb) => cb(new Error("no such")) }), false);
  });
});
