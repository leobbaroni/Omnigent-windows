// [win] Tests for src/win/compat.js.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const compat = require("../src/win/compat");

describe("win compat: parseVersion", () => {
  it("reads --version output and dev tags", () => {
    assert.equal(compat.parseVersion("omnigent 0.12.0 (5d323ad, built 2026-09-01T00:00:00Z)").text, "0.12.0");
    const dev = compat.parseVersion("omnigent 0.13.0.dev0");
    assert.equal(dev.text, "0.13.0.dev0");
    assert.equal(dev.pre, "dev0");
    assert.equal(compat.parseVersion("garbage"), null);
  });
});

describe("win compat: assess", () => {
  const support = { minimum: "0.7.0", tested: ["0.12.0"], upstreamPin: "x" };
  it("classifies versions", () => {
    assert.equal(compat.assess("omnigent 0.12.0", support).status, "tested");
    assert.equal(compat.assess("omnigent 0.6.9", support).status, "unsupported");
    assert.equal(compat.assess("omnigent 0.13.0.dev0", support).status, "untested-newer");
    assert.equal(compat.assess("omnigent 0.9.1", support).status, "untested-older");
    assert.equal(compat.assess("", support).status, "unknown");
  });
  it("a dev pre-release of a tested version counts as untested", () => {
    assert.equal(compat.assess("omnigent 0.12.0.dev3", support).status, "untested-older");
  });
});

describe("win compat: maybeWarn", () => {
  function harness(versionText, initial = {}) {
    let saved = null;
    const shown = [];
    return {
      run: () =>
        compat.maybeWarn({
          versionText,
          loadSettings: () => (saved ? saved : initial),
          saveSettings: (s) => {
            saved = s;
          },
          dialog: {
            showMessageBox: async (_w, opts) => {
              shown.push(opts);
              return { response: 0 };
            },
          },
        }),
      get saved() {
        return saved;
      },
      shown,
    };
  }

  it("warns once per version and records it", async () => {
    const h = harness("omnigent 0.13.0.dev0");
    await h.run();
    await h.run();
    assert.equal(h.shown.length, 1);
    assert.deepEqual(h.saved[compat.WARNED_KEY], ["0.13.0.dev0"]);
    assert.equal(h.shown[0].type, "info");
  });

  it("never warns for a tested version", async () => {
    const h = harness("omnigent 0.12.0");
    const res = await h.run();
    assert.equal(res.status, "tested");
    assert.equal(h.shown.length, 0);
    assert.equal(h.saved, null);
  });

  it("uses a warning box for unsupported versions", async () => {
    const h = harness("omnigent 0.5.0");
    await h.run();
    assert.equal(h.shown[0].type, "warning");
  });
});
