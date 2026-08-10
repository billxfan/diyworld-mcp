# Public repository boundaries

This repository is the public source of truth for the publishable DIYworld MCP client, runtime contracts, connector, skills, documentation, website code that has passed public review, and their tests.

Internal product work is maintained separately. Internal repositories, deployment state, unreleased plans, operational records, private identities, and customer or tester data must not be mirrored into this repository. The existence or location of an internal repository is not part of the public interface.

## What belongs here

- MCP and HTTP protocol contracts intended for public clients.
- Runtime, connector, CLI, and skill code included in public releases.
- Public-facing website code and content after explicit review.
- Reproducible tests, synthetic fixtures, migration tools, and release documentation.
- Security controls and architectural documentation needed to audit the public system.

## What stays internal

- Production credentials, environment files, databases, logs, backups, exports, and real user or tester records.
- Private deployment topology, device names, internal hostnames, local filesystem paths, and operational access instructions.
- Unreleased roadmaps, private issue discussions, incident records, commercial material, and internal analytics.
- Generated build artifacts, source maps, local Agent configuration, and developer-machine state.

## How changes move between repositories

Repositories are maintained independently. Do not force-push one repository over another and do not copy broad directory trees between them.

Move a change deliberately:

1. Identify the smallest self-contained behavior or fix.
2. Recreate or selectively port it on the destination branch.
3. Remove internal configuration, identities, links, history, and assumptions.
4. Add synthetic tests that describe only the public contract.
5. Review the staged diff and run the public repository gate.

Public fixes may be selectively incorporated into internal products. Internal changes reach this repository only after they are made suitable for public review. Commit hashes and release versions are independent unless a release note explicitly relates them.

## Required public gate

Before opening or merging a public change, run:

```bash
npm run repo:public-check
npm test
npm run release:check
```

The repository check inspects tracked and non-ignored files for sensitive filenames, private machine paths, private repository references, internal network names, personal email addresses, and common credential formats. New commit authors and committers, plus annotated tag identities, must use a Git hosting `noreply` address. Findings report rule names and locations without printing suspected secret values.

For an occasional full scan of every reachable commit, run `npm run repo:public-check -- --all-history`. Normal checks always scan every commit and diff added after the recorded public-history baseline, so a secret cannot be hidden by adding and deleting it within one pull request.

If the full-history scan fails, pause publication and classify the finding before changing history. Rotate a credential first if one is involved. History rewriting must be prepared in a separate clone, reviewed, and coordinated with repository owners because it changes commit IDs and disrupts existing clones, tags, and open branches. Rewriting a repository also cannot retract data already copied into forks, caches, or local clones.

Automated detection is a backstop, not authorization to publish. Review the complete staged diff, verify that fixtures use reserved example domains, and use a Git hosting `noreply` author address for public commits.
