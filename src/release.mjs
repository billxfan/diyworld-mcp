import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

export const CLIENT_PACKAGE_VERSION = packageJson.version;
export const DIYWORLD_PROTOCOL_VERSION = "1";
export const MINIMUM_SUPPORTED_CLIENT_VERSION = "0.9.2";

export function packageSpec(version = CLIENT_PACKAGE_VERSION) {
  return `@diyworld/mcp@${version}`;
}

export function pinnedMcpConfig(configPath, version = CLIENT_PACKAGE_VERSION) {
  return {
    command: "npx",
    args: ["-y", packageSpec(version), "mcp", "--config", configPath],
  };
}

function numericVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(value ?? ""));
  return match ? match.slice(1).map(Number) : null;
}

export function compareVersions(left, right) {
  const a = numericVersion(left);
  const b = numericVersion(right);
  if (!a || !b) throw new Error("DIYworld versions must use semantic x.y.z format.");
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

export function clientReleaseMetadata(options = {}) {
  return {
    protocol_version: options.protocolVersion ?? DIYWORLD_PROTOCOL_VERSION,
    server_package_version:
      options.serverPackageVersion ?? CLIENT_PACKAGE_VERSION,
    recommended_client_version:
      options.recommendedClientVersion ?? CLIENT_PACKAGE_VERSION,
    minimum_supported_client_version:
      options.minimumSupportedClientVersion ?? MINIMUM_SUPPORTED_CLIENT_VERSION,
    platform_release:
      options.platformRelease ?? new Date().toISOString().slice(0, 10),
  };
}

export function clientUpdateStatus(
  clientVersion = CLIENT_PACKAGE_VERSION,
  release = clientReleaseMetadata(),
) {
  const minimum = release.minimum_supported_client_version;
  const recommended = release.recommended_client_version;
  if (compareVersions(clientVersion, minimum) < 0) return "required";
  if (compareVersions(clientVersion, recommended) < 0) return "optional";
  return "current";
}
