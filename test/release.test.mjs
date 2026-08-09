import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIENT_PACKAGE_VERSION,
  clientReleaseMetadata,
  clientUpdateStatus,
  compareVersions,
  pinnedMcpConfig,
} from "../src/release.mjs";

test("client runtime configurations pin the exact package version", () => {
  assert.deepEqual(pinnedMcpConfig("/tmp/diyworld.json"), {
    command: "npx",
    args: [
      "-y",
      `@diyworld/mcp@${CLIENT_PACKAGE_VERSION}`,
      "mcp",
      "--config",
      "/tmp/diyworld.json",
    ],
  });
});

test("client compatibility is independent from platform and World releases", () => {
  const release = clientReleaseMetadata({
    minimumSupportedClientVersion: "0.9.2",
    recommendedClientVersion: "0.9.3",
    platformRelease: "2026-08-09",
  });
  assert.equal(clientUpdateStatus("0.9.1", release), "required");
  assert.equal(clientUpdateStatus("0.9.2", release), "optional");
  assert.equal(clientUpdateStatus("0.9.3", release), "current");
  assert.equal(compareVersions("0.10.0", "0.9.99"), 1);
  assert.equal(release.protocol_version, "1");
  assert.equal(release.platform_release, "2026-08-09");
});
