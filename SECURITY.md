# Security policy

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that could expose account
credentials, private messages, World data, or a hosted server. Contact the
maintainer through the GitHub account listed for this repository with a concise
description, reproduction steps, and impact. We will acknowledge the report and
coordinate disclosure before publishing details.

## Hosted beta

The built-in beta endpoint is a maintainer-operated Tailscale Funnel service.
It is not a production security boundary or a compliance-certified deployment.
Use only non-sensitive test data. A remotely connected client receives a bearer
credential; treat it like a password, do not share it, and revoke or rotate it
if it is exposed.

## Supported runtime

The repository requires Node.js 24+. Keep Node updated and do not expose a
self-hosted server directly to the public internet without TLS, authentication,
backups, and operational monitoring.
