#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { PetSocialStore } from "../src/store.mjs";
import {
  DEFAULT_AGENT_WORLD_SERVER_URL,
  normalizeServerUrl
} from "../src/installer.mjs";
import { DAY_MS } from "../src/utils.mjs";
import {
  retryDeadLetterWorldDelivery,
  worldDeliveryOutboxStatus,
} from "../src/world-delivery-outbox.mjs";

function usage() {
  console.log(`Agent World Social Admin

Usage:
  npm run admin -- invite:create [--label TEXT] [--uses N] [--expires-in-days N]
  npm run admin -- invite:list
  npm run admin -- invite:disable INVITE_ID
  npm run admin -- account:recovery:create --email EMAIL [--expires-in-minutes N]
  npm run admin -- delivery:status
  npm run admin -- delivery:retry OUTBOX_ID

Options:
  --db PATH              Override the SQLite database path
  --label TEXT           Human-readable invite label; the code is never stored in plaintext
  --uses N               Maximum redemptions, from 1 to 1000 (default: 1)
  --expires-in-days N    Expire the invite after N days
  --expires-in-minutes N Expire a recovery code after N minutes (default: 30)
  --email EMAIL          Account recovery email
  --server URL           Include a ready-to-copy tester install command
  --json                 Print machine-readable JSON
`);
}

function print(value, json) {
  if (json) console.log(JSON.stringify(value));
  else console.log(JSON.stringify(value, null, 2));
}

function serverArgument(server) {
  const normalized = normalizeServerUrl(server);
  return normalized === DEFAULT_AGENT_WORLD_SERVER_URL
    ? ""
    : ` --server ${JSON.stringify(normalized)}`;
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  strict: true,
  options: {
    db: { type: "string" },
    label: { type: "string", default: "" },
    uses: { type: "string", default: "1" },
    "expires-in-days": { type: "string" },
    "expires-in-minutes": { type: "string", default: "30" },
    email: { type: "string" },
    server: { type: "string" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false }
  }
});

if (values.help || positionals.length === 0) {
  usage();
  process.exit(values.help ? 0 : 1);
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const databaseFile = resolve(
  values.db ??
    process.env.AGENT_WORLD_DB ??
    process.env.PET_SOCIAL_DB ??
    resolve(projectRoot, "data/pet-social.sqlite")
);
mkdirSync(dirname(databaseFile), { recursive: true });
const store = new PetSocialStore(databaseFile);

try {
  const command = positionals[0];
  if (command === "invite:create") {
    const days = values["expires-in-days"] == null ? null : Number(values["expires-in-days"]);
    if (days != null && (!Number.isFinite(days) || days <= 0)) {
      throw new Error("--expires-in-days must be a positive number");
    }
    const invite = store.createInvite({
      label: values.label,
      maxUses: Number(values.uses),
      expiresAt: days == null ? null : Date.now() + days * DAY_MS
    });
    print({
      ...invite,
      ...(values.server ? {
        installCommand: `npm run install:local --${serverArgument(values.server)} --invite ${JSON.stringify(invite.code)}`
      } : {}),
      note: "Copy the code now. Only its SHA-256 hash is stored and it cannot be recovered later."
    }, values.json);
  } else if (command === "invite:list") {
    print({ invites: store.listInvites() }, values.json);
  } else if (command === "invite:disable") {
    if (!positionals[1]) throw new Error("invite:disable requires INVITE_ID");
    print({ invite: store.disableInvite(positionals[1]) }, values.json);
  } else if (command === "account:recovery:create") {
    if (!values.email) throw new Error("account:recovery:create requires --email EMAIL");
    const minutes = Number(values["expires-in-minutes"]);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) {
      throw new Error("--expires-in-minutes must be between 1 and 1440");
    }
    const recovery = store.createAccountRecovery({
      recoveryEmail: values.email,
      expiresAt: Date.now() + minutes * 60 * 1000
    });
    print({
      ...recovery,
      ...(values.server ? {
        recoveryCommand: `npm run install:local --${serverArgument(values.server)} --email ${JSON.stringify(values.email)} --recovery ${JSON.stringify(recovery.recoveryCode)}`
      } : {}),
      note: "Verify the tester out of band, then send this single-use recovery code privately. Creating another code invalidates this one."
    }, values.json);
  } else if (command === "delivery:status") {
    print({ deliveryOutbox: worldDeliveryOutboxStatus(store.db) }, values.json);
  } else if (command === "delivery:retry") {
    const outboxId = Number(positionals[1]);
    if (!Number.isSafeInteger(outboxId) || outboxId < 1) {
      throw new Error("delivery:retry requires a positive OUTBOX_ID");
    }
    const retried = retryDeadLetterWorldDelivery(store.db, outboxId);
    if (!retried) {
      throw new Error("The outbox item does not exist or is not dead-lettered");
    }
    print({ retried: true, outboxId }, values.json);
  } else {
    usage();
    throw new Error(`Unknown admin command: ${command}`);
  }
} catch (error) {
  console.error(`${error.code ? `[${error.code}] ` : ""}${error.message}`);
  process.exitCode = 1;
} finally {
  store.close();
}
