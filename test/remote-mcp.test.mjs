import assert from "node:assert/strict";
import test from "node:test";

import { createPetSocialApp } from "../src/app.mjs";
import { PetSocialClient } from "../src/client.mjs";
import { CLIENT_PACKAGE_VERSION } from "../src/release.mjs";
import { OFFICIAL_WORLDS } from "../src/venue-lab-core/official-worlds.js";

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

test("the Tunnel-ready remote MCP exposes a concise authenticated tool surface", async () => {
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
    assert.equal(initialized.body.result.serverInfo.version, CLIENT_PACKAGE_VERSION);
    assert.match(initialized.body.result.instructions, /world_search once without query/u);
    assert.match(initialized.body.result.instructions, /without requiring the person to type a “check messages” command/u);
    assert.match(initialized.body.result.instructions, /resume_bundle and loop_context/u);

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
    assert.ok(names.has("world_get"));
    assert.ok(names.has("world_input_result"));
    assert.ok(names.has("profile_get"));
    assert.ok(names.has("profile_update"));
    assert.ok(names.has("people_discover"));
    for (const name of [
      "agent_binding_get",
      "agent_binding_list",
      "agent_binding_revoke",
      "friend_request_send",
      "friend_request_list",
      "friend_request_respond",
      "friend_remove",
      "message_mark_read",
      "activity_list",
      "activity_mark_read",
      "world_create_simple",
      "world_list_mine",
      "world_observe",
      "world_say",
    ]) {
      assert.ok(names.has(name), name);
    }
    assert.equal(names.has("character_get"), false);
    assert.equal(names.has("pet_get"), false);
    assert.equal(names.has("world_input_submit"), false);
    const worldSearch = listed.body.result.tools.find(
      (tool) => tool.name === "world_search",
    );
    assert.match(worldSearch.description, /必须省略 query/u);
    const updateProfile = listed.body.result.tools.find(
      (tool) => tool.name === "profile_update",
    );
    assert.equal("form" in updateProfile.inputSchema.properties, false);
    assert.equal("appearance" in updateProfile.inputSchema.properties, false);
    const worldVisit = listed.body.result.tools.find(
      (tool) => tool.name === "world_visit",
    );
    const worldObserve = listed.body.result.tools.find(
      (tool) => tool.name === "world_observe",
    );
    const worldAct = listed.body.result.tools.find(
      (tool) => tool.name === "world_act",
    );
    assert.match(worldVisit.description, /前台剧情 Loop/u);
    assert.match(worldObserve.description, /不应要求用户手动/u);
    assert.match(worldAct.description, /相关未读变化/u);

    const profile = await callMcp(address.url, registration.token, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "profile_get", arguments: {} }
    });
    assert.equal(profile.body.result.isError, false);
    assert.equal(profile.body.result.structuredContent.profile.name, "远程 MCP 测试者");
    assert.equal("form" in profile.body.result.structuredContent.profile, false);

    const rejectedCreation = await callMcp(address.url, registration.token, {
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: {
        name: "world_create_simple",
        arguments: {
          name: "未经确认的世界",
          rules_text: "这个调用必须被服务端拒绝。",
          visibility: "public",
          confirmed: false,
        },
      },
    });
    assert.equal(rejectedCreation.body.result.isError, true);
    assert.match(
      rejectedCreation.body.result.content[0].text,
      /CONFIRMATION_REQUIRED|explicit confirmation/u,
    );

    const catalog = await callMcp(address.url, registration.token, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "world_search", arguments: {} }
    });
    const catalogValue = catalog.body.result.structuredContent;
    assert.equal(catalogValue.catalog_mode, "complete_public_catalog");
    assert.equal(catalogValue.complete, true);
    assert.deepEqual(
      catalogValue.worlds.map((world) => world.id),
      OFFICIAL_WORLDS.map((world) => world.id),
    );
    assert.ok(catalogValue.worlds.every((world) => !("definition_text" in world)));
    assert.ok(catalogValue.worlds.every((world) => !("host_prompt" in world)));

    const noToken = await fetch(`${address.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list" })
    });
    assert.equal(noToken.status, 401);
  } finally {
    await app.close();
  }
});
