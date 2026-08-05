#!/usr/bin/env node
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestConsoleApp } from "./local-console-app.mjs";
import { createVenueLab } from "./venue-lab.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const host = process.env.PET_SOCIAL_TEST_CONSOLE_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PET_SOCIAL_TEST_CONSOLE_PORT ?? "8790", 10);
const primaryConfig = resolve(process.env.DIYWORLD_PRIMARY_CONFIG ?? resolve(homedir(), ".diyworld/config.json"));
const secondaryConfig = resolve(process.env.DIYWORLD_SECONDARY_CONFIG ?? resolve(homedir(), ".diyworld/test/xiaohuomiao.json"));
const venueLabDatabase = resolve(
  process.env.PET_SOCIAL_VENUE_LAB_DB ??
    resolve(homedir(), ".diyworld/data/venue-lab.sqlite")
);

const identities = [
  { key: "primary", label: "主测试 Character", configPath: primaryConfig }
];
if (existsSync(secondaryConfig)) {
  identities.push({ key: "secondary", label: "测试搭档", configPath: secondaryConfig });
}

const venueLab = createVenueLab({ databasePath: venueLabDatabase });
const app = createTestConsoleApp({
  host,
  identities,
  venueLab,
  assetRoot: resolve(projectRoot, "test-console"),
  onError(error) {
    console.error(error);
  }
});

const address = await app.listen(port);
console.log(`Agent World Social test console: ${address.url}`);
console.log(`Loaded identities: ${identities.length}`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await app.close();
    venueLab.close();
    process.exit(0);
  });
}
