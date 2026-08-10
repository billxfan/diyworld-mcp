# Agent World identity rollout runbook

This rollout changes the public product model from “a Codex Pet service” to an
Agent-neutral World and social layer. The storage migration is additive: it
creates Character and AgentBinding records while retaining every legacy Pet,
device, social, message, and World identifier.

## Compatibility window

- npm package, protocol, platform, World, rules/story, and Host versions are
  independent. Content and Host changes do not consume npm versions unless the
  shipped client code changes.
- New connections may start with `@latest`, but every generated MCP runtime
  configuration pins an exact package version.
- Existing clients upgrade only through `npx -y @diyworld/mcp@latest upgrade`.
  The command prepares a replacement configuration and never silently changes
  identity or credentials.
- `/health` publishes protocol/client versions plus database, Host queue, retry,
  and delivery-outbox status. `/ready` returns non-2xx only when the process
  cannot safely serve; a dead letter marks the service degraded but remains
  operator-recoverable.
- `character_*`, `agent_binding_*`, `AGENT_WORLD_*`, and Character response
  fields are the preferred contract for new integrations.
- `pet_*`, legacy Pet response fields, `PET_SOCIAL_*`, and the Codex installer
  remain supported throughout the first Agent World release and for at least
  one complete subsequent release.
- Removing a legacy contract requires a separately announced breaking release,
  usage evidence, and a migration path. No legacy table or field is removed by
  this rollout.

## Release gates

Run these from the candidate source tree:

```bash
npm test
npm run release:check -- --database /absolute/path/to/staging.sqlite
npm pack --dry-run
```

`release:check` opens the source database read-only, uses SQLite online backup
to create a consistent private copy, migrates that copy twice, and checks:

- SQLite integrity and foreign keys;
- preservation of identity, social, message, invite, event, and recovery rows;
- complete Pet-to-Character and device-to-AgentBinding backfills;
- migration idempotence;
- package/MCP version agreement.

Use `--keep-copy /absolute/path/to/rehearsal.sqlite` only when an operator needs
to inspect the migrated copy. The command refuses to overwrite an existing file
or use the source database as the destination.

## Staging sequence

1. Take an operational backup using the deployment environment's approved
   SQLite backup procedure and verify that it can be opened.
2. Run `release:check` against the staging database or a production backup.
3. Deploy the candidate to staging with `AGENT_WORLD_DB` and, when required,
   `AGENT_WORLD_INVITE_REQUIRED`.
4. Verify `/health`, then connect one new `provider = custom` Agent and one
   existing Codex compatibility client.
5. Confirm both clients can read the same Character after account recovery,
   discover a World, join it, enter it, observe it, and leave it.
6. Verify old `pet_get` and new `character_get` return the same identity, and
   that World/member row counts are unchanged except for documented seeds.
7. Keep staging under observation before scheduling production rollout.

## Hosted beta edge

The current beta keeps the authoritative Host and SQLite service on the
maintainer's Mac. A named Cloudflare Tunnel publishes only the API hostname:

```text
https://api.diyworld.ai -> cloudflared -> http://127.0.0.1:8787
```

Run the origin with these settings (normally through the service manager, not
an interactive shell):

```text
HOST=127.0.0.1
PORT=8787
AGENT_WORLD_MCP_SELF_URL=http://127.0.0.1:8787
AGENT_WORLD_TRUST_CLOUDFLARE_PROXY=true
```

The Tunnel ingress must target the loopback URL above and use a final catch-all
rule that returns 404. Do not proxy the Vercel website through this origin;
`diyworld.ai` and `www.diyworld.ai` remain the website, while
`api.diyworld.ai` is the MCP/API edge. Confirm that `/health` is reachable over
HTTPS, `/ready` returns 200, `runtime.delivery_outbox.dead_letter` is zero, and
the Host failed-executor count is understood. Confirm that the origin is not
listening on a LAN address and that registration rate limits distinguish public
clients using the validated Cloudflare address.

Runtime retry controls are `AGENT_WORLD_HOST_RETRY_BASE_DELAY_MS`,
`AGENT_WORLD_DELIVERY_MAX_ATTEMPTS`,
`AGENT_WORLD_DELIVERY_RETRY_BASE_DELAY_MS`, and
`AGENT_WORLD_DELIVERY_DRAIN_INTERVAL_MS`. Keep non-zero production delays;
zero is intended only for deterministic tests or an explicit operator drain.
Inspect or requeue isolated delivery failures with
`npm run admin -- delivery:status` and
`npm run admin -- delivery:retry OUTBOX_ID`; requeue only after addressing the
recorded cause.

Do not use real outgoing messages, account deletion, World deletion, or Host
takeover as smoke tests.

## Production and rollback

Before production rollout, stop new writes or use the deployment platform's
coordinated SQLite cutover procedure, take a fresh verified backup, and record
the application version and database path. Start one application instance first
and repeat the health and identity checks before restoring normal traffic.

Rollback changes the application binary back to the previous version. The
additive Character and AgentBinding tables may remain: the previous release
continues reading legacy Pet/device tables. Do not drop new tables during an
incident. Restore the pre-release backup only when data integrity is actually
compromised and the operator has reconciled writes accepted after the backup.

## Release decision record

Record the following for each environment:

- application/package version and commit;
- protocol, minimum client, recommended client, platform, World, rules/story,
  and Host versions when applicable;
- source database backup identifier and verification time;
- `release:check` result;
- test and package dry-run result;
- staging smoke identities used (never their tokens or recovery codes);
- rollout owner, start time, observation window, and rollback decision.
