## Summary

Describe the public behavior changed and why it belongs in this repository.

## Public-boundary checklist

- [ ] I reviewed the complete staged diff and commit messages.
- [ ] The change contains no credentials, real identities, private repository references, internal hosts, local home paths, databases, logs, backups, exports, or private planning material.
- [ ] Tests and fixtures use synthetic data and reserved example domains.
- [ ] Commit and annotated-tag identities use a Git hosting `noreply` address.
- [ ] `npm run repo:public-check` passes.
- [ ] `npm test` passes.
- [ ] `npm run release:check` passes when runtime or persistence behavior changes.
- [ ] Website changes pass `npm ci` and `npm run build` in `website/`.
- [ ] Package changes were inspected with `npm pack --dry-run`.

## Security impact

State whether the change alters authentication, authorization, privacy, external communication, deletion, World state authority, Host execution, or release behavior. Link private security reports only through GitHub's private advisory workflow.
