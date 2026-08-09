import assert from "node:assert/strict";
import test from "node:test";

import { createPetSocialApp } from "../src/app.mjs";
import { requestClientAddress } from "../src/http.mjs";

test("Cloudflare client IP is trusted only from an opted-in loopback proxy", () => {
  const loopback = {
    socket: { remoteAddress: "::ffff:127.0.0.1" },
    headers: { "cf-connecting-ip": "203.0.113.8" },
  };
  assert.equal(requestClientAddress(loopback), "127.0.0.1");
  assert.equal(
    requestClientAddress(loopback, { trustCloudflareProxy: true }),
    "203.0.113.8",
  );
  assert.equal(
    requestClientAddress({
      socket: { remoteAddress: "198.51.100.4" },
      headers: { "cf-connecting-ip": "203.0.113.8" },
    }, { trustCloudflareProxy: true }),
    "198.51.100.4",
  );
});

test("registration limits remain per public client behind a local Tunnel", async () => {
  const app = createPetSocialApp({ trustCloudflareProxy: true });
  const address = await app.listen();
  const register = (index, clientAddress) => fetch(`${address.url}/v1/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": clientAddress,
    },
    body: JSON.stringify({
      recoveryEmail: `edge-${clientAddress}-${index}@example.test`,
      displayName: `Edge ${index}`,
      deviceName: `Edge ${index}`,
      agentProvider: "other",
      clientInstanceId: `edge-${clientAddress}-${index}`,
    }),
  });
  try {
    for (let index = 0; index < 20; index += 1) {
      assert.equal((await register(index, "203.0.113.10")).status, 201);
    }
    assert.equal((await register(21, "203.0.113.10")).status, 429);
    assert.equal((await register(1, "203.0.113.11")).status, 201);
  } finally {
    await app.close();
  }
});
