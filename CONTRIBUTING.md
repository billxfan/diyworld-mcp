# Contributing to DIYworld MCP

This is a public repository. Contributions must contain only information and code intended for permanent public distribution, including in Git history, CI logs, release artifacts, and pull-request discussions.

## Set up a clone

Use Node.js 24 or newer, then enable the local pre-push gate:

```bash
npm install
npm run hooks:install
```

Configure Git with a public-safe name and a Git hosting `noreply` email address. The repository gate rejects new commits and annotated tags that expose another email address.

## Submit a change

1. Start from the latest public `main` and create a short-lived branch.
2. Port only the smallest publishable change. Never copy a private repository or broad internal directory into this one.
3. Use synthetic fixtures and reserved example domains. Do not include credentials, real identities, internal hosts, local home paths, databases, logs, backups, exports, or private planning material.
4. Stage explicit paths and review `git diff --cached` before committing.
5. Run:

```bash
npm run repo:public-check
npm test
npm run release:check
```

6. Push the branch and open a pull request. Do not push directly to `main`.
7. Merge only after every required CI check passes.

Website changes must also pass `npm ci` and `npm run build` in `website/`. Release changes must inspect `npm pack --dry-run` output and confirm that only intended files ship.

## Security-sensitive changes

Do not open a public issue containing a vulnerability, private identifier, credential, or leaked data. Follow [SECURITY.md](SECURITY.md) and the incident procedure in [the repository boundary policy](docs/repository-boundaries.md#sensitive-data-incident-response).
