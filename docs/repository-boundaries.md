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

## Normal contribution path

1. Update local `main` from the public remote without merging unrelated internal history.
2. Create a short-lived branch. Do not develop or commit directly on `main`.
3. Run `npm run hooks:install` once per clone to enable the repository pre-push gate.
4. Stage explicit files, inspect the staged diff, and commit with a Git hosting `noreply` identity.
5. Push the branch and open a pull request using the repository checklist.
6. Merge only after the public-boundary check, tests, migration rehearsal, and website build pass in CI.
7. Create or update a release tag only from the protected `main` history.

The public `main` branch must reject deletion and non-fast-forward updates during normal operation. A temporary exception for a verified sensitive-data cleanup requires explicit repository-owner approval, a recovery bundle, an isolated dry-run, exact remote ref checks, and immediate restoration of protection.

## Sensitive-data incident response

If private data reaches any public commit, tag, pull request, release, artifact, or log:

1. Stop merges, releases, and automated publishing. Do not repeat the sensitive value in issues or chat.
2. Revoke or rotate credentials before changing Git history.
3. Record affected refs, pull requests, forks, releases, artifacts, and the first commit that introduced the exposure.
4. Create a permission-restricted recovery bundle outside the repository.
5. Use `git-filter-repo --sensitive-data-removal` in an isolated fresh clone. Run a dry-run and verify that the replacement removes every historical match, commit identity, and tag identity.
6. Run the full public gate, `npm run repo:public-check -- --all-history`, tests, migration rehearsal, package inspection, and website build on the rewritten clone.
7. Recheck every remote ref immediately before updating it. Use an exact `--force-with-lease`; never use an unconstrained force push.
8. Restore branch protection and notify collaborators to re-clone or carefully rebase. Never merge an old clone back into the rewritten history.
9. Ask the hosting provider to purge cached commit views and pull-request references. Provide the repository, affected pull-request count, first changed commits, and any orphaned LFS report without pasting the sensitive value.
10. Verify the old object is no longer reachable, close the incident record, and securely remove temporary mirrors and recovery bundles according to the retention decision.

History rewriting does not remove copies already held in clones or forks. Coordinate with their owners separately.
