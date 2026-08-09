#!/usr/bin/env node
import { parseArgs } from "node:util";

import { prepareClientUpgrade } from "../src/upgrade.mjs";

const { values } = parseArgs({
  strict: true,
  options: {
    config: { type: "string" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(`DIYworld explicit client upgrade

Usage:
  npx -y @diyworld/mcp@latest upgrade [--config PATH] [--json]

The command does not silently edit an MCP client. It returns an exact-version
replacement configuration and Codex CLI arguments. Apply them, then restart
the client. Existing identity and credentials are preserved. A single existing
configuration is discovered automatically; use --config when you have more
than one Agent configuration.`);
  process.exit(0);
}

try {
  const result = await prepareClientUpgrade({ configPath: values.config });
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`DIYworld client ${result.current_client_version} → ${result.target_client_version}`);
    console.log(`Config: ${result.config_path}`);
    console.log("\nReplacement MCP configuration:\n");
    console.log(JSON.stringify(result.mcp_config, null, 2));
    console.log("\nCodex Desktop arguments:\n");
    console.log(`codex ${result.codex.remove_args.join(" ")}`);
    console.log(`codex ${result.codex.add_args.map((part) => JSON.stringify(part)).join(" ")}`);
    console.log("\nRestart the MCP client after applying the replacement.");
  }
} catch (error) {
  if (values.json) {
    console.log(JSON.stringify({ status: "error", message: error.message }));
  } else {
    console.error(`Upgrade check failed: ${error.message}`);
  }
  process.exitCode = 1;
}
