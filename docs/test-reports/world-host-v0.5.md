# World Host v0.5 verification

## Automated coverage

- World Builder artifacts expose `host` and accept legacy `referee` input;
- every world exposes one Host with `guide`, `facilitate`, `judge`, `advance`,
  and `recap` capabilities;
- joining returns either an entry instruction or an approval-waiting message;
- first entry returns a welcome, objective, suggested choices, and free input;
- role selection is judged before world-local member state is written;
- the first meaningful contribution completes onboarding;
- re-entry returns a context recap and next actions;
- managed inputs return waiting guidance and resolved follow-up guidance;
- Host turns and member journeys persist independently;
- creator/admin Host updates are versioned and owner-scoped;
- stale Host versions are rejected;
- non-game worlds receive generic intent-based guidance;
- Host tool capabilities remain limited to the `world:` scope.

## Compatibility

- the database runtime role remains `referee` for the existing check constraint;
- public responses expose `role: host` and `runtime_role: referee`;
- stable template IDs such as `general-referee` are unchanged;
- existing world and social history is migrated additively;
- publication remains separate and explicit after materialization.

## Migration rehearsal and deployment

- 33 automated tests passed.
- A regression test reopens a file-backed database after a builder-created
  world has been materialized.
- Shared database rehearsal preserved 3 pets, 5 worlds, 5 Hosts, and 5 Host
  versions.
- Local venue-lab rehearsal preserved 2 pets, 7 worlds, 7 Hosts, and 7 Host
  versions.
- Both database copies were reopened and migrated twice. Each pass returned
  `PRAGMA integrity_check = ok`, zero foreign-key violations, zero worlds
  without Hosts, and zero orphaned build sessions.
- Pre-deployment backups were created for both active databases.
- The live `万象旅馆` draft was upgraded to `夜铃管家` Host v2 with active
  onboarding, five identity paths, ongoing participation suggestions, and a
  four-event return recap.
- A live owner preview returned `welcome -> setup` with the expected choices
  while the world remained unpublished.

## Hidden invitation acceptance test

The creator explicitly authorized a live hidden-invitation test.

- `万象旅馆` was published as `hidden` and `invite_only`.
- Member rules were updated to version 2 with the World Host terminology.
- `小火苗` received one targeted invitation, saw rules v2 before joining, and
  accepted the invitation.
- Join returned `ready_to_enter`; first entry returned `welcome -> setup`.
- The visitor selected the returned `住客` choice. The role was written only
  after the Host accepted the immutable input.
- The first meaningful action moved the journey from `setup` to `active`.
- Re-entry returned `recap -> returning` and preserved the role and visit count.
- All 4 visitor inputs have 4 judgements from the bound World Host; no
  mismatched World Agent was found.
- The Host tool allowlist remains empty and no private message was created.
- Live database integrity remained `ok` with zero foreign-key violations.

The test exposed and fixed two facilitation defects:

- after role selection, guidance now offers concrete participation actions
  instead of repeating role choices;
- automatic outcomes now retain the actor, role, speech, choice, or action text
  so future recaps contain meaningful activity rather than only “accepted”.

The deterministic runtime still records and summarizes accepted actions; it
does not yet invent a rich scene consequence such as what was discovered in the
attic. Model-backed scene generation remains a separate capability from the
verified authorization, judgement, persistence, and guidance path.
