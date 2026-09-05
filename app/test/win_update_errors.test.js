const test = require("node:test");
const assert = require("node:assert/strict");
const { friendlyUpdateError } = require("../src/desktop_updater.js");

test("404 on the GitHub feed becomes a 'no release yet' message without headers", () => {
  const raw =
    'HttpError: 404 "method: GET url: https://github.com/leobbaroni/Omnigent-windows/releases.atom\n\nPlease double check that your authentication token is correct. Due to security reasons, actual status maybe not reported, but 404.\n\nHeaders:\n{"set-cookie": "_gh_sess=secret; path=/; HttpOnly"}';
  const msg = friendlyUpdateError(raw);
  assert.match(msg, /No release published yet at leobbaroni\/Omnigent-windows/);
  assert.doesNotMatch(msg, /_gh_sess|Headers/);
});

test("other HTTP codes are summarised", () => {
  assert.equal(
    friendlyUpdateError("HttpError: 503 method: GET url: https://github.com/a/b/releases.atom"),
    "Update feed returned HTTP 503 for a/b.",
  );
});

test("non-HTTP errors pass through unchanged", () => {
  assert.equal(friendlyUpdateError("net::ERR_INTERNET_DISCONNECTED"), "net::ERR_INTERNET_DISCONNECTED");
});
