import assert from "node:assert/strict";
import test from "node:test";

import { createPetSocialApp } from "../src/app.mjs";
import { PetSocialClient } from "../src/client.mjs";

async function callMcp(url, token, message, headers = {}) {
  const response = await fetch(`${url}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(message)
  });
  return { response, body: await response.json() };
}

test("the Funnel-ready remote MCP exposes a concise authenticated tool surface", async () => {
  const app = createPetSocialApp({ inviteRequired: false });
  const address = await app.listen();
  try {
    const registration = await PetSocialClient.register(address.url, {
      recoveryEmail: "remote-mcp@example.test",
      displayName: "远程 MCP 测试者",
      deviceName: "Remote MCP test",
      agentProvider: "other"
    });

    const initialized = await callMcp(address.url, registration.token, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" }
    });
    assert.equal(initialized.response.status, 200);
    assert.equal(initialized.body.result.serverInfo.name, "diyworld");

    const listed = await callMcp(address.url, registration.token, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {}
    });
    const names = new Set(listed.body.result.tools.map((tool) => tool.name));
    assert.ok(names.has("world_search"));
    assert.ok(names.has("world_visit"));
    assert.ok(names.has("world_act"));
    assert.ok(names.has("profile_get"));
    assert.ok(names.has("profile_update"));
    assert.ok(names.has("people_discover"));
    assert.equal(names.has("character_get"), false);
    assert.equal(names.has("pet_get"), false);
    assert.equal(names.has("world_input_submit"), false);
    const updateProfile = listed.body.result.tools.find(
      (tool) => tool.name === "profile_update",
    );
    assert.equal("form" in updateProfile.inputSchema.properties, false);
    assert.equal("appearance" in updateProfile.inputSchema.properties, false);

    const profile = await callMcp(address.url, registration.token, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "profile_get", arguments: {} }
    });
    assert.equal(profile.body.result.isError, false);
    assert.equal(profile.body.result.structuredContent.profile.name, "远程 MCP 测试者");
    assert.equal("form" in profile.body.result.structuredContent.profile, false);

    const noToken = await fetch(`${address.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list" })
    });
    assert.equal(noToken.status, 401);
  } finally {
    await app.close();
  }
});
