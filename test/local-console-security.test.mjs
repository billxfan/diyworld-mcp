import assert from "node:assert/strict";
import http from "node:http";
import { resolve } from "node:path";
import test from "node:test";

import { createTestConsoleApp } from "../src/local-console-app.mjs";

function rawGet(url, headers) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
  });
}

function testApp() {
  return createTestConsoleApp({
    host: "127.0.0.1",
    sessionToken: "test-console-session",
    assetRoot: resolve(import.meta.dirname, "../test-console"),
    identities: [
      {
        key: "primary",
        label: "Primary",
        config: { serverUrl: "http://127.0.0.1:1", token: "unused" },
      },
    ],
  });
}

test("the local console rejects DNS-rebinding Host headers before exposing its session", async () => {
  const app = testApp();
  const address = await app.listen();
  try {
    const response = await rawGet(address.url, { host: "attacker.example" });
    assert.equal(response.status, 421);
    assert.doesNotMatch(response.body, /test-console-session/u);
  } finally {
    await app.close();
  }
});

test("the local console rejects cross-origin and cross-site browser requests", async () => {
  const app = testApp();
  const address = await app.listen();
  try {
    const hostileOrigin = await fetch(address.url, {
      headers: { origin: "https://attacker.example" },
    });
    assert.equal(hostileOrigin.status, 403);

    const crossSite = await fetch(address.url, {
      headers: { "sec-fetch-site": "cross-site" },
    });
    assert.equal(crossSite.status, 403);

    const allowed = await fetch(address.url);
    assert.equal(allowed.status, 200);
    assert.match(await allowed.text(), /test-console-session/u);
  } finally {
    await app.close();
  }
});
