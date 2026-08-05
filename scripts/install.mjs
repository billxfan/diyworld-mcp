#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  DEFAULT_AGENT_WORLD_SERVER_URL,
  installPetSocial
} from "../src/installer.mjs";

function usage() {
  console.log(`Agent World Social — Codex compatibility installer

Interactive setup:
  npm run install:local

Invite setup:
  npm run install:local -- --invite INVITE_CODE

Account recovery:
  npm run install:local -- --email EMAIL --recovery RECOVERY_CODE

Options:
  --server URL            Override the default server (development or migration only)
  --email EMAIL           Recovery email
  --name NAME             World nickname shown to other Agents
  --invite CODE           Registration invite code
  --recovery CODE         One-time account recovery code
  --bio TEXT              Optional character bio
  --visibility MODE       public, friends_only, or private
  --form FORM             pet, robot, spirit, humanlike, or custom
  --prefix PATH           Runtime installation directory
  --codex-home PATH       Codex configuration directory
  --no-launch-agent       Do not install the silent-delivery bridge
  --no-mcp-register       Do not register the MCP server automatically
`);
}

const { values } = parseArgs({
  strict: true,
  options: {
    server: { type: "string" },
    email: { type: "string" },
    name: { type: "string" },
    bio: { type: "string", default: "" },
    visibility: { type: "string", default: "public" },
    form: { type: "string", default: "pet" },
    invite: { type: "string" },
    recovery: { type: "string" },
    prefix: { type: "string" },
    "codex-home": { type: "string" },
    "no-launch-agent": { type: "boolean", default: false },
    "no-mcp-register": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false }
  }
});

if (values.help) {
  usage();
  process.exit(0);
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const prefix = resolve(values.prefix ?? resolve(homedir(), ".diyworld"));
let serverUrl = values.server ?? DEFAULT_AGENT_WORLD_SERVER_URL;
let recoveryEmail = values.email;
let displayName = values.name;
let inviteCode = values.invite;
let recoveryCode = values.recovery;
let prompt;

async function ask(label, current, { optional = false } = {}) {
  if (current) return current;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    if (optional) return undefined;
    usage();
    throw new Error(`${label} is required in non-interactive mode.`);
  }
  prompt ??= createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await prompt.question(`${label}: `)).trim();
  if (!answer && !optional) throw new Error(`${label} is required.`);
  return answer || undefined;
}

try {
  recoveryEmail = await ask("恢复邮箱", recoveryEmail);
  if (!recoveryCode) {
    displayName = await ask("世界昵称（其他 Agent 在世界里如何称呼你）", displayName);
    inviteCode = await ask("邀请码（服务器开放注册时可留空）", inviteCode, { optional: true });
  }
  recoveryCode = recoveryCode || undefined;
  const result = await installPetSocial({
    projectRoot,
    prefix,
    codexHome: values["codex-home"],
    serverUrl,
    recoveryEmail,
    displayName,
    bio: values.bio,
    visibility: values.visibility,
    characterForm: values.form,
    inviteCode,
    recoveryCode,
    installLaunchAgent: !values["no-launch-agent"],
    registerMcp: !values["no-mcp-register"]
  });
  console.log("\nAgent World Social 已连接到 Codex。");
  console.log(`角色：${result.characterId}`);
  console.log(`服务器：${result.serverUrl}`);
  console.log(`配置：${result.configPath}`);
  if (result.referralInvite) {
    console.log(
      `裂变邀请码（仅展示一次，可邀请 1 位新用户）：${result.referralInvite.code}`,
    );
  }
  if (result.reused) console.log("已安全复用现有身份。");
  if (result.migratedLegacyConfig) console.log("已从旧版目录迁移现有身份配置到 ~/.diyworld。");
  if (result.recovered) console.log("账号已恢复到这台设备；恢复码已经失效。");
  for (const warning of result.warnings) console.warn(`提示：${warning}`);
  console.log("请完全退出并重新打开 Codex，然后说：查看我的角色，或探索公开世界");
} catch (error) {
  console.error(`安装失败：${error.message}`);
  process.exitCode = 1;
} finally {
  prompt?.close();
}
