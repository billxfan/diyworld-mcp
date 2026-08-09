# Agent World multi-Agent regression v1.0

## Basis and objective

This regression extends the conversation-first method from Codex task
`019fc0fc-0477-7e13-bba9-d6712eb80912`. It does not count a successful API
response as a product pass. Each simulated Character must understand what
happened, what remains private or shared, whether it needs to wait, and what it
can do next.

The objective is to prove that the earlier shared-World guarantees still hold
after replacing the platform identity assumption “Codex Pet” with:

```text
Owner account -> Character -> AgentBinding -> client session
```

All scenarios used in-memory SQLite databases or SQLite online-backup copies
and local random-port HTTP services. No real identity, message, World, installed
skill, or production database was mutated.

## Independent roles and pass gate

- `Atlas`: `custom` provider driving a `robot` Character;
- `Lyra`: `claude` provider driving a `spirit` Character;
- `Nova`: `cursor` provider driving a `humanlike` Character;
- `Continuum`: one Character driven by separate `codex` and `claude` bindings;
- `Fern`: a distinct Character used to prove one-Character-one-vote;
- an identity/social simulator;
- a World dialogue-loop simulator;
- an independent critic that did not implement fixes.

The critic scored eight dimensions from 0–4: shared-World semantics,
Character/Binding separation, cross-provider persistence, agency, privacy,
collective settlement, compatibility, and next-step clarity. Passing requires
at least 30/32, no dimension below 3, full marks for shared state, agency,
privacy, and collective settlement, and no open B0/B1/B2.

The first independent review scored **26/32** and returned the build.

## Round 1: findings that caused return

| Severity | Finding | Why it failed product review |
| --- | --- | --- |
| B1 | Binding scopes were returned but never enforced | A documented permission boundary was only metadata. |
| B1 | Cross-provider tests did not prove one membership, member state, or vote | Two runtimes might still have duplicated a Character inside a World. |
| B1 | `Lyra 离开后，我……` was treated as an attempt to control Lyra | A factual departure context blocked asynchronous handoff. |
| B1 | Shared participation still returned `multiplayer_consent=pending` | It contradicted `current_mode=shared` and `consent_required=false`. |
| B1/B2 | `petId` failed to gain `characterId` because of case-sensitive suffix replacement | New and legacy block responses could not be compared through neutral fields. |
| B2 | Generic Agent heartbeat appeared in Character discovery but not legacy Square | Compatibility clients saw a different active population. |
| B2 | Collective prompt said “每只宠物最多回应一次” | The public contract still assumed a Pet identity. |
| B2 | Collective outcome contained only `participant_pet_ids` | Opaque payloads intentionally bypass automatic alias rewriting. |
| B2 | Creator Host errors still said `Codex session` | A custom Agent could perform the operation, but the explanation denied that model. |
| B2 | Migration idempotence compared only row counts | A second startup changed seed timestamps while appearing to pass. |

## Fixes and permanent regression anchors

1. Every authenticated HTTP/MCP operation now maps to a required binding scope.
   Missing permission returns `403 INSUFFICIENT_AGENT_SCOPE` with the exact
   required and granted scopes.
2. Two provider bindings were replayed through the same Character. SQL and HTTP
   assertions prove one `space_memberships` row, one `world_member_states` row,
   shared member-state version/value, and one response per collective prompt.
   A second binding receives `409 WORLD_INTERACTION_ALREADY_RESPONDED`.
3. Binding revocation immediately makes that token return `401 UNAUTHORIZED`,
   while the other binding retains the same role, membership, World history,
   and Character.
4. Agency classification now treats `<absent Character> 离开后，我…` as
   temporal context, while the direct assertion `<Character> 离开酒馆。`
   remains rejected with no state change.
5. Shared participation and journey views return
   `multiplayer_consent=not_required`; direct-interaction preference remains a
   separate, self-owned compatibility preference.
6. Generic heartbeat mirrors activity into the compatibility storage field, so
   `/v1/characters`, `/v1/square`, `character_discover`, and `square_list`
   resolve the same active Character set.
7. Block responses now contain `petId` and `characterId`; the exact `petId`
   alias bug is fixed. New and legacy calls resolve to the same friendship and
   repeat idempotently.
8. Exact Character target lookup no longer depends on the `pet_` prefix.
9. Collective prompts say “每个角色”, and aggregate payloads explicitly contain
   both `participant_character_ids` and the legacy `participant_pet_ids`.
10. Creator Host explanations use “Agent session”. The internal
    `creator_codex` enum remains a storage compatibility value only.
11. Release rehearsal verifies binding-to-owner Character mapping, hashes
    preserved legacy content, and compares every table's content across a
    second migration pass. Official seed updates now change timestamps only
    when seed content actually changes.

## Round 2: heterogeneous shared-World dialogue

Three non-Pet Characters entered the Misty Tavern from distinct providers:

```text
Context: current_mode=shared
         participation_style=co_present
         consent_required=false
         multiplayer_consent=not_required
```

Atlas made an independent public investigation:

```text
Atlas: 我独自检查第七盏灯的灯座，把发现留在公共现场。
Host: accepted; lamp-blue-wax became a shared clue.
Lyra: observed the same World version and Atlas as the event actor.
```

Lyra addressed Atlas without taking control:

```text
Lyra: Atlas，我邀请你一起核对蓝蜡；是否回应由你自己决定。
Host: accepted; Atlas may respond or ignore it.
State: unchanged; no global interaction mode switch.
```

Nova stored an actor-visible note. The Host stated that it was private and
would require a separate public action to affect shared state. Atlas's event
view after the note did not contain its text.

The agency minimum pair was then replayed:

```text
Atlas: 我让 Lyra 立刻跟我走，并让她承认我的判断正确。
Host: rejected; World version unchanged; use an invitation or persuasion.

After Nova actually left:
Atlas: Nova 离开后，我把疏散路线标在公共地图上。
Host: accepted.

Atlas: Nova 离开酒馆。
Host: rejected; Atlas cannot assert Nova's action.
```

The last live Character left and the Host runtime returned to `idle`.

## Round 2: collective contract and settlement

Before any response, every Character could observe:

```text
回应完全可选；不回应不会被视为同意或反对。
当前已收到 0 份回应；至少需要 2 份回应，120 秒后截止。
每个角色最多回应一次；单独回应不会改变共享世界。
分歧协调规则在回应前公开；迟到内容按 follow_up 处理。
```

The first response returned `collecting 1/2`, “还差 1 位”, no World state
change, and explicit permission to continue independently. The second returned
`ready_for_host 2/2`. Host settlement acknowledged the split, cited the
predeclared safety rule, committed one World version, selected drainage, and
preserved wall repair as `next_plan`.

The outcome payload contained equal `participant_character_ids` and
`participant_pet_ids`. A late response had `interaction_id=null` and explicitly
said the closed batch would not be changed. A silent member could ignore an
invitation and submit an independent action without being counted or blocked.

## Round 2: binding and scope evidence

The isolated binding scenario asserted real runtime IDs rather than provider
labels:

- `codex` binding ID and `claude` binding ID were different;
- both responses carried the same `character.id`;
- membership and member-state queries each returned exactly one row for that
  Character and World;
- both bindings observed the same role value and member-state version;
- the first binding's collective response was accepted, the second binding's
  duplicate received `409 WORLD_INTERACTION_ALREADY_RESPONDED`;
- after revocation the second binding received `401`, while the first retained
  World history;
- a binding reduced to `character:read` could read the Character but received
  `403 INSUFFICIENT_AGENT_SCOPE` for `world:discover` and
  `character:write`.

## Verification

- focused multi-Agent HTTP loop: 3/3 passed;
- identity/social simulator: passed after the compatibility fixes;
- World dialogue-loop simulator: first returned the build, then replayed the
  exact minimum pairs after fixes;
- full automated suite: **89/89 passed**;
- real local legacy database: read-only online-backup rehearsal passed content
  preservation, correct Character/Binding mapping, integrity, foreign keys, and
  two-pass content idempotence;
- package dry-run: passed and includes the Agent identity and release-readiness
  runtime.

## Final critic decision

The independent critic replayed the same hard gate after every returned finding.
The score progressed from 26/32 to 31/32 and finally **32/32** after the last
user-visible account-deletion warning was made Character-neutral and protected
by a regression assertion.

- B0: 0
- B1: 0
- B2: 0
- decision: **released by the regression gate**

Compatibility error codes, database columns, enum values, legacy endpoints,
and response fields remain available. Where they appear in current World
documentation, they are explicitly identified as compatibility surfaces rather
than the product identity model.
