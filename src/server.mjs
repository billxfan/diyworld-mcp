import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPetSocialApp } from "./app.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const databaseFile = resolve(
  process.env.AGENT_WORLD_DB ??
    process.env.PET_SOCIAL_DB ??
    resolve(projectRoot, "data/pet-social.sqlite")
);
const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const host = process.env.HOST ?? "127.0.0.1";
const inviteRequired = ["1", "true", "yes", "on"].includes(
  String(
    process.env.AGENT_WORLD_INVITE_REQUIRED ??
      process.env.PET_SOCIAL_INVITE_REQUIRED ??
      "true"
  ).toLowerCase()
);
const officialHostOwnerIds = String(
  process.env.AGENT_WORLD_OFFICIAL_HOST_OWNER_IDS ??
    process.env.PET_SOCIAL_OFFICIAL_HOST_OWNER_IDS ??
    ""
)
  .split(",")
  .map((ownerId) => ownerId.trim())
  .filter(Boolean);
const worldHostMode = String(
  process.env.AGENT_WORLD_HOST_EXECUTOR ?? "local_codex"
).toLowerCase();
if (!new Set(["local_codex", "deterministic"]).has(worldHostMode)) {
  throw new Error(
    "AGENT_WORLD_HOST_EXECUTOR must be local_codex or deterministic",
  );
}
const worldHostMaxConcurrency = Number.parseInt(
  process.env.AGENT_WORLD_HOST_MAX_CONCURRENCY ?? "2",
  10,
);
const worldHostPrewarm = !["0", "false", "no", "off"].includes(
  String(process.env.AGENT_WORLD_HOST_PREWARM ?? "true").toLowerCase(),
);
const registrationLimit = Number.parseInt(
  process.env.AGENT_WORLD_REGISTRATION_LIMIT ?? "1000",
  10,
);
const referralInviteGrantLimit = Number.parseInt(
  process.env.AGENT_WORLD_REFERRAL_INVITE_GRANT_LIMIT ?? "500",
  10,
);
if (
  !Number.isInteger(registrationLimit) || registrationLimit < 1 ||
  !Number.isInteger(referralInviteGrantLimit) ||
  referralInviteGrantLimit < 0 ||
  referralInviteGrantLimit > registrationLimit
) {
  throw new Error(
    "Registration/referral limits must be integers with 0 <= referral <= registration",
  );
}
if (
  !Number.isInteger(worldHostMaxConcurrency) ||
  worldHostMaxConcurrency < 1 ||
  worldHostMaxConcurrency > 8
) {
  throw new Error(
    "AGENT_WORLD_HOST_MAX_CONCURRENCY must be an integer between 1 and 8",
  );
}

mkdirSync(dirname(databaseFile), { recursive: true });

const app = createPetSocialApp({
  databaseFile,
  inviteRequired,
  registrationLimit,
  referralInviteGrantLimit,
  officialHostOwnerIds,
  worldHostMode,
  worldHostMaxConcurrency,
  worldHostPrewarm,
  mcpSelfUrl: process.env.AGENT_WORLD_MCP_SELF_URL,
  mcpAllowedOrigins: String(process.env.AGENT_WORLD_MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  worldHostModel: process.env.AGENT_WORLD_HOST_MODEL,
  worldHostEffort: process.env.AGENT_WORLD_HOST_EFFORT ?? "medium",
  onError(error) {
    console.error(error);
  }
});

const address = await app.listen(port, host);
console.log(`Agent World Social listening on ${address.url}`);
console.log(`Database: ${databaseFile}`);
console.log(`Registration: ${inviteRequired ? "invite only" : "open"}`);
console.log(
  `World Hosts: ${worldHostMode}` +
    (worldHostMode === "local_codex"
      ? ` (max ${worldHostMaxConcurrency} concurrent turns; ${
          worldHostPrewarm ? "prewarming published Worlds" : "on demand"
        })`
      : ""),
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
