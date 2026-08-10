# Security policy

## Reporting a vulnerability

Report vulnerabilities through this repository's private vulnerability reporting form:

https://github.com/billxfan/diyworld-mcp/security/advisories/new

Do not include credentials, private identities, internal infrastructure, exploit details, or leaked data in a public issue, discussion, pull request, commit message, or CI log.

Include the affected version or commit, impact, minimal reproduction steps, and a safe contact channel. Use redacted placeholders where the exact sensitive value is unnecessary.

## Hosted beta

The built-in beta endpoint is a maintainer-operated Cloudflare Tunnel at `https://api.diyworld.ai`. The origin listens only on loopback; the Tunnel is the public TLS edge. This beta is not a compliance-certified deployment. Use only non-sensitive test data. A remotely connected client receives a bearer credential; treat it like a password, do not share it, and revoke or rotate it if it is exposed.

## Supported runtime

The repository requires Node.js 24+. Keep Node updated and do not expose a self-hosted server directly to the public internet without TLS, authentication, rate limits, backups, and operational monitoring. `CF-Connecting-IP` is trusted only when Cloudflare-proxy support is explicitly enabled and the immediate connection comes from loopback.

## Accidental public-data exposure

Treat exposed credentials as compromised and rotate them immediately. Removing a file from the current branch is not enough because commits, tags, pull requests, caches, artifacts, clones, and forks may retain it.

Repository maintainers follow the response procedure in [Public repository boundaries](docs/repository-boundaries.md#sensitive-data-incident-response), including isolated history rewriting, full-history verification, hosting-provider cache removal, and collaborator coordination.
