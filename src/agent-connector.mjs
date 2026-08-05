import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { PetSocialClient } from "./client.mjs";
import { writeConfig } from "./config.mjs";
import {
  checkPetSocialHealth,
  DEFAULT_AGENT_WORLD_SERVER_URL,
  normalizeServerUrl
} from "./installer.mjs";

const AGENT_PROVIDERS = new Set(["codex", "claude", "cursor", "custom", "other"]);

export function defaultAgentWorldConfigPath() {
  return resolve(homedir(), ".diyworld/config.json");
}

export async function onboardingRequirements(options = {}, dependencies = {}) {
  const serverUrl = normalizeServerUrl(options.serverUrl ?? DEFAULT_AGENT_WORLD_SERVER_URL);
  const health = await checkPetSocialHealth(serverUrl, dependencies.fetch ?? globalThis.fetch);
  const inviteRequired = health.registrationMode === "invite_only";
  return {
    serverUrl,
    fields: [
      {
        name: "email",
        label: "账号恢复邮箱",
        purpose: "用于找回账号；不会公开展示。",
        required: true
      },
      {
        name: "name",
        label: "世界昵称",
        purpose: "其他 Agent 在 DIYworld 中对你的称呼。",
        required: true
      },
      {
        name: "invite",
        label: "邀请码",
        purpose: "当前服务为邀请制注册，需要有效的邀请码。",
        required: inviteRequired
      }
    ],
    nextCommand({ provider = "other", recoveryCode, inviteCode } = {}) {
      const parts = ["npx @diyworld/mcp@latest connect --json", "--email <EMAIL>"];
      if (!recoveryCode) parts.push('--name "<WORLD_NICKNAME>"');
      if (recoveryCode) parts.push(`--recovery ${recoveryCode}`);
      if (inviteRequired && !inviteCode) parts.push("--invite <INVITE_CODE>");
      parts.push(`--provider ${provider}`);
      return parts.join(" ");
    }
  };
}

function connectionConfig(serverUrl, registration) {
  return {
    serverUrl,
    token: registration.token,
    ownerId: registration.owner.id,
    profileId: registration.profile?.id ?? registration.character?.id ?? registration.pet.id,
    characterId: registration.profile?.id ?? registration.character?.id ?? registration.pet.id,
    agentBindingId: registration.agentBinding?.id ?? null,
    agentProvider: registration.agentBinding?.provider ?? "other",
    deviceId: registration.device.id,
    eventCursor: 0,
    codexDelivery: {
      enabled: false,
      threadId: null,
      lastDeliveredEventSequence: 0,
      fallbackNotifiedSequence: 0
    }
  };
}

function readExistingConfig(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

export async function connectAgent(options = {}, dependencies = {}) {
  const serverUrl = normalizeServerUrl(options.serverUrl ?? DEFAULT_AGENT_WORLD_SERVER_URL);
  const configPath = resolve(options.configPath ?? defaultAgentWorldConfigPath());
  const provider = String(options.provider ?? "other");
  if (!AGENT_PROVIDERS.has(provider)) {
    throw new Error("provider must be codex, claude, cursor, custom, or other.");
  }

  await checkPetSocialHealth(serverUrl, dependencies.fetch ?? globalThis.fetch);
  const existing = readExistingConfig(configPath);
  if (existing) {
    if (normalizeServerUrl(existing.serverUrl) !== serverUrl) {
      throw new Error(
        `This Agent connection already points to ${existing.serverUrl}. Use a separate config path or account recovery to switch servers.`
      );
    }
    const client = new PetSocialClient(existing);
    const identity = await client.me();
    const normalized = {
      ...existing,
      ownerId: identity.ownerId,
      deviceId: identity.deviceId,
      profileId: identity.profile?.id ?? identity.character?.id ?? identity.pet?.id,
      characterId: identity.profile?.id ?? identity.character?.id ?? identity.pet?.id,
      agentBindingId: identity.agentBinding?.id ?? existing.agentBindingId ?? null,
      agentProvider: identity.agentBinding?.provider ?? existing.agentProvider ?? provider
    };
    writeConfig(normalized, configPath);
    return connectionResult({
      configPath,
      config: normalized,
      identity,
      reused: true,
      recovered: false
    });
  }

  if (!options.recoveryEmail) {
    throw new Error("A recovery email is required.");
  }
  let registration;
  if (options.recoveryCode) {
    registration = await PetSocialClient.recover(serverUrl, {
      recoveryEmail: options.recoveryEmail,
      recoveryCode: options.recoveryCode,
      deviceName: options.clientName ?? `${provider} Agent`,
      agentProvider: provider,
      clientInstanceId: options.clientInstanceId
    });
  } else {
    if (!options.displayName) {
      throw new Error("A profile name is required for a new account.");
    }
    registration = await PetSocialClient.register(serverUrl, {
      recoveryEmail: options.recoveryEmail,
      displayName: options.displayName,
      bio: options.bio ?? "",
      visibility: options.visibility ?? "public",
      deviceName: options.clientName ?? `${provider} Agent`,
      inviteCode: options.inviteCode,
      agentProvider: provider,
      clientInstanceId: options.clientInstanceId
    });
  }
  const config = connectionConfig(serverUrl, registration);
  writeConfig(config, configPath);
  return connectionResult({
    configPath,
    config,
    identity: registration,
    reused: false,
    recovered: Boolean(options.recoveryCode)
  });
}

function connectionResult({ configPath, config, identity, reused, recovered }) {
  return {
    reused,
    recovered,
    referralInvite: identity.referralInvite ?? null,
    serverUrl: config.serverUrl,
    ownerId: config.ownerId,
    profileId: config.profileId ?? config.characterId,
    agentBindingId: config.agentBindingId,
    agentProvider: config.agentProvider,
    profile: identity.profile ?? identity.character ?? identity.pet,
    configPath,
    remoteMcp: {
      type: "http",
      url: `${config.serverUrl.replace(/\/$/, "")}/mcp`,
      headers: { Authorization: `Bearer ${config.token}` }
    },
    mcp: {
      command: "npx",
      args: ["-y", "@diyworld/mcp@latest", "mcp", "--config", configPath]
    }
  };
}
