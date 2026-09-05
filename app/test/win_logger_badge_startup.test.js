// [win] Tests for logger.js, badge.js, startup.js.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const { createLogger, redact } = require("../src/win/logger");
const badge = require("../src/win/badge");
const { createStartup, HIDDEN_ARG } = require("../src/win/startup");

describe("win logger", () => {
  it("writes timestamped, levelled, redacted lines and rotates", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-log-"));
    const log = createLogger({ dir, maxBytes: 200, keep: 3, now: () => new Date("2026-09-05T00:00:00Z") });
    log.info("hello", { a: 1 });
    log.warn("Authorization: Bearer abc.def-ghi and token=secret123");
    const text = fs.readFileSync(log.file, "utf8");
    assert.match(text, /^2026-09-05T00:00:00.000Z \[info\] hello \{"a":1\}\n/);
    assert.ok(text.includes("Bearer [redacted]"));
    assert.ok(text.includes("token=[redacted]"));
    assert.ok(!text.includes("secret123"));
    // Rotation: push past maxBytes several times.
    for (let i = 0; i < 20; i += 1) log.info("x".repeat(50));
    const files = fs.readdirSync(dir).sort();
    assert.ok(files.includes("omnigent-desktop.log.1"));
    assert.ok(!files.includes("omnigent-desktop.log.3"), `kept too many: ${files}`);
  });

  it("captures console and restores it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-log-"));
    const log = createLogger({ dir });
    const fake = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
    const orig = fake.warn;
    const restore = log.captureConsole(fake);
    fake.warn("captured", "line");
    restore();
    assert.equal(fake.warn, orig);
    assert.match(fs.readFileSync(log.file, "utf8"), /\[warn\] captured line/);
  });

  it("redact leaves ordinary text alone", () => {
    assert.equal(redact("server status running at http://127.0.0.1:6767"), "server status running at http://127.0.0.1:6767");
    assert.equal(redact("[win] badge overlay 3 -> 1 window(s)"), "[win] badge overlay 3 -> 1 window(s)");
  });

  it("redact scrubs cookie headers and long opaque tokens", () => {
    const line = '"set-cookie": ["_gh_sess=fnX5dz07iQG9RJtCJlHKFdUBkE7QnoyQIFxI88cicJ1R5i24RSJnC3Uhh; path=/; HttpOnly", "logged_in=no; path=/"]';
    const out = redact(line);
    assert.ok(!out.includes("fnX5dz07"), out);
    assert.ok(!out.includes("logged_in=no"), out);
    assert.equal(redact("_octo=GH1.1.1411486345.1788575608; expires=x"), "_octo=[redacted]; expires=x");
    assert.equal(redact("id=abc"), "id=abc");
  });
});

describe("win badge", () => {
  it("labels counts", () => {
    assert.equal(badge.labelFor(0), "");
    assert.equal(badge.labelFor(3), "3");
    assert.equal(badge.labelFor(12), "9+");
    assert.equal(badge.labelFor(-2), "");
  });

  it("encodes a valid PNG with the expected size", () => {
    const png = badge.badgePng(7);
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(png.readUInt32BE(16), badge.SIZE);
    assert.equal(png.readUInt32BE(20), badge.SIZE);
    // IDAT inflates to (w*4+1)*h bytes.
    const idatLen = png.readUInt32BE(33);
    const idat = png.subarray(41, 41 + idatLen);
    assert.equal(zlib.inflateSync(idat).length, (badge.SIZE * 4 + 1) * badge.SIZE);
  });

  it("renders white text pixels inside a red disc and transparent corners", () => {
    const px = badge.renderRgba("3");
    const at = (x, y) => px.subarray((y * badge.SIZE + x) * 4, (y * badge.SIZE + x) * 4 + 4);
    assert.equal(at(0, 0)[3], 0);
    const c = at(3, 16);
    assert.deepEqual([...c], [0xd9, 0x2b, 0x2b, 255]);
    let white = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] === 255 && px[i + 1] === 255 && px[i + 2] === 255) white += 1;
    assert.ok(white > 20);
  });

  it("applies (and clears) the overlay on every live window", () => {
    const calls = [];
    const windows = [
      { setOverlayIcon: (img, d) => calls.push(["a", img, d]) },
      { isDestroyed: () => true, setOverlayIcon: () => calls.push(["destroyed"]) },
      {
        setOverlayIcon: () => {
          throw new Error("boom");
        },
      },
    ];
    const nativeImage = { createFromBuffer: (b) => ({ png: b.length }) };
    assert.equal(badge.applyBadge(2, { nativeImage, windows }), 1);
    assert.equal(calls[0][0], "a");
    assert.equal(calls[0][2], "2 unread Omnigent sessions");
    assert.equal(badge.applyBadge(0, { nativeImage, windows }), 1);
    assert.equal(calls[1][1], null);
    assert.equal(calls[1][2], "");
  });
});

describe("win startup", () => {
  it("registers with the hidden arg only in packaged builds", () => {
    let settings = { openAtLogin: false };
    const app = {
      isPackaged: true,
      getLoginItemSettings: () => settings,
      setLoginItemSettings: (s) => {
        settings = { openAtLogin: s.openAtLogin, args: s.args };
      },
    };
    const st = createStartup({ app });
    assert.equal(st.setEnabled(true), true);
    assert.deepEqual(settings.args, [HIDDEN_ARG]);
    assert.equal(st.setEnabled(false), false);
    const dev = createStartup({ app, isPackaged: false });
    assert.equal(dev.setEnabled(true), false);
    assert.equal(st.launchedHidden(["x", "--hidden"]), true);
    assert.equal(st.launchedHidden(["x"]), false);
  });
});
