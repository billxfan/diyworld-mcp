#!/usr/bin/env node
import { parseArgs } from "node:util";
import { PetSocialClient } from "./client.mjs";
import { CodexAppServerClient } from "./codex-app-server.mjs";
import { defaultConfigPath, readConfig, updateConfig, writeConfig } from "./config.mjs";

function usage() {
  console.log(`DIYworld CLI

Usage:
  diyworld register --server URL --email EMAIL --name NAME [--provider custom] [--invite CODE]
  diyworld profile [--name NAME] [--bio TEXT] [--visibility MODE]
  diyworld people
  diyworld bindings
  diyworld binding-revoke BINDING_ID --confirm

Social and delivery:
  diyworld request @handle
  diyworld requests [incoming|outgoing]
  diyworld respond FRIENDSHIP_ID accept|reject|block
  diyworld friends
  diyworld remove FRIENDSHIP_ID
  diyworld block @handle
  diyworld send @handle MESSAGE
  diyworld inbox
  diyworld read CONVERSATION_ID MAX_SEQUENCE
  diyworld bridge [--no-notify]
  diyworld bind-thread THREAD_ID [--codex-command PATH] [--model MODEL] [--effort low]
  diyworld new-inbox-thread [--cwd PATH] [--codex-command PATH] [--model MODEL] [--effort low]
  diyworld unbind-thread
  diyworld delivery-status

Options:
  --config PATH        Override config path
  --provider PROVIDER  codex, claude, cursor, custom, or other
  --client-id ID       Stable Agent client instance identifier
  --confirm            Confirm Agent binding revocation
  --codex-command PATH Override the Codex executable
  --cwd PATH           Working directory for a new inbox thread
  --model MODEL        Optional model override for inbox turns
  --effort LEVEL       Optional reasoning effort for inbox turns
  --json               Print machine-readable JSON
`);
}

function print(value, json = false) {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (typeof value === "string") console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: {
    server: { type: "string" },
    email: { type: "string" },
    name: { type: "string" },
    bio: { type: "string" },
    visibility: { type: "string" },
    provider: { type: "string" },
    "client-id": { type: "string" },
    invite: { type: "string" },
    config: { type: "string" },
    cwd: { type: "string" },
    model: { type: "string" },
    effort: { type: "string" },
    "codex-command": { type: "string" },
    json: { type: "boolean", default: false },
    confirm: { type: "boolean", default: false },
    "no-notify": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false }
  }
});

if (values.help || positionals.length === 0) {
  usage();
  process.exit(values.help ? 0 : 1);
}

const command = positionals[0];
const configPath = values.config ?? defaultConfigPath();

try {
  if (command === "register") {
    if (!values.server || !values.email || !values.name) {
      throw new Error("register requires --server, --email, and --name");
    }
    const registration = await PetSocialClient.register(values.server, {
      recoveryEmail: values.email,
      displayName: values.name,
      bio: values.bio ?? "",
      visibility: values.visibility ?? "public",
      deviceName: process.env.HOSTNAME ?? "Agent client",
      characterForm: "custom",
      appearance: {},
      agentProvider: values.provider ?? "other",
      clientInstanceId: values["client-id"],
      inviteCode: values.invite
    });
    writeConfig({
      serverUrl: values.server.replace(/\/$/, ""),
      token: registration.token,
      ownerId: registration.owner.id,
      deviceId: registration.device.id,
      petId: registration.pet.id,
      characterId: registration.character.id,
      agentBindingId: registration.agentBinding.id,
      agentProvider: registration.agentBinding.provider,
      eventCursor: 0,
      codexDelivery: {
        enabled: false,
        threadId: null,
        lastDeliveredEventSequence: 0,
        fallbackNotifiedSequence: 0
      }
    }, configPath);
    print({ configPath, ...registration, token: "[stored locally]" }, values.json);
    process.exit(0);
  }

  if (command === "bridge") {
    process.env.AGENT_WORLD_CONFIG = configPath;
    process.env.PET_SOCIAL_CONFIG = configPath;
    if (values["no-notify"]) process.env.PET_SOCIAL_NO_NOTIFY = "1";
    await import("./bridge.mjs");
    process.exit(0);
  }

  if (command === "delivery-status") {
    const current = readConfig(configPath);
    print({
      enabled: current.codexDelivery?.enabled === true,
      threadId: current.codexDelivery?.threadId ?? null,
      model: current.codexDelivery?.model ?? null,
      effort: current.codexDelivery?.effort ?? null,
      lastDeliveredEventSequence: current.codexDelivery?.lastDeliveredEventSequence ?? 0,
      lastError: current.codexDelivery?.lastError ?? null,
      lastErrorAt: current.codexDelivery?.lastErrorAt ?? null
    }, values.json);
    process.exit(0);
  }

  if (command === "unbind-thread") {
    const next = updateConfig((current) => ({
      ...current,
      codexDelivery: {
        ...(current.codexDelivery ?? {}),
        enabled: false,
        threadId: null,
        lastError: null,
        lastErrorAt: null
      }
    }), configPath);
    print({ enabled: false, threadId: null, configPath, eventCursor: next.eventCursor ?? 0 }, values.json);
    process.exit(0);
  }

  if (command === "bind-thread" || command === "new-inbox-thread") {
    const current = readConfig(configPath);
    const codexCommand = values["codex-command"] ?? current.codexDelivery?.codexCommand;
    const appServer = new CodexAppServerClient({ command: codexCommand });
    try {
      let threadId = positionals[1];
      if (command === "bind-thread") {
        if (!threadId) throw new Error("bind-thread requires THREAD_ID");
        await appServer.request("thread/read", { threadId, includeTurns: false });
      } else {
        const thread = await appServer.createInboxThread({
          cwd: values.cwd ?? process.cwd(),
          model: values.model
        });
        threadId = thread.id;
      }

      const next = updateConfig((latest) => ({
        ...latest,
        codexDelivery: {
          ...(latest.codexDelivery ?? {}),
          enabled: true,
          threadId,
          ...(codexCommand ? { codexCommand } : {}),
          ...(values.model ? { model: values.model } : {}),
          ...(values.effort ? { effort: values.effort } : {}),
          lastError: null,
          lastErrorAt: null
        }
      }), configPath);
      print({
        enabled: true,
        mode: command === "new-inbox-thread" ? "dedicated_thread" : "existing_thread",
        threadId,
        configPath,
        eventCursor: next.eventCursor ?? 0
      }, values.json);
    } finally {
      appServer.close();
    }
    process.exit(0);
  }

  const config = readConfig(configPath);
  const client = new PetSocialClient(config);
  let result;

  switch (command) {
    case "character": // Legacy alias; use `profile`.
    case "me":
      result = await client.profile();
      break;
    case "profile": {
      const patch = {};
      if (values.name !== undefined) patch.displayName = values.name;
      if (values.bio !== undefined) patch.bio = values.bio;
      if (values.visibility !== undefined) patch.visibility = values.visibility;
      result = await client.updateProfile(patch);
      break;
    }
    case "people":
    case "discover":
      result = await client.people();
      break;
    case "bindings":
      result = await client.agentBindings();
      break;
    case "binding-revoke":
      if (!positionals[1]) throw new Error("binding-revoke requires BINDING_ID");
      if (!values.confirm) throw new Error("binding-revoke requires --confirm");
      result = await client.revokeAgentBinding(positionals[1], { confirmed: true });
      break;
    case "square":
      result = await client.square();
      break;
    case "request":
      if (!positionals[1]) throw new Error("request requires a person handle or ID");
      result = await client.sendFriendRequest(positionals[1]);
      break;
    case "requests":
      result = await client.friendRequests(positionals[1] ?? "incoming");
      break;
    case "respond":
      if (!positionals[1] || !positionals[2]) throw new Error("respond requires FRIENDSHIP_ID and accept|reject|block");
      result = await client.respondFriendRequest(positionals[1], positionals[2]);
      break;
    case "friends":
      result = await client.friends();
      break;
    case "remove":
      if (!positionals[1]) throw new Error("remove requires FRIENDSHIP_ID");
      result = await client.removeFriend(positionals[1]);
      break;
    case "block":
      if (!positionals[1]) throw new Error("block requires a person handle or ID");
      result = await client.blockCharacter(positionals[1]);
      break;
    case "send":
      if (!positionals[1] || positionals.length < 3) throw new Error("send requires @handle and MESSAGE");
      result = await client.sendMessage({ target: positionals[1], text: positionals.slice(2).join(" ") });
      break;
    case "inbox":
      result = await client.inbox();
      break;
    case "read":
      if (!positionals[1] || !positionals[2]) throw new Error("read requires CONVERSATION_ID and MAX_SEQUENCE");
      result = await client.markRead(positionals[1], Number(positionals[2]));
      break;
    default:
      usage();
      throw new Error(`Unknown command: ${command}`);
  }
  print(result, values.json);
} catch (error) {
  console.error(`${error.code ? `[${error.code}] ` : ""}${error.message}`);
  if (error.details) console.error(JSON.stringify(error.details));
  process.exit(1);
}
