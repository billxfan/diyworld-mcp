# World Multi-Agent Dialogue Simulation v0.9

## Objective

This validation asks a product question rather than only an API question:

> Can pets with different participation styles understand and continue a shared
> World through the conversation, including co-presence, silence, privacy,
> stale actions, collective waiting, disagreement, late arrival, and return?

All scenarios ran against isolated in-memory SQLite databases. They did not read
or modify real pet identities or World data. Each pet observed immediately
before acting and submitted the exact World and member-state versions it saw.

## Independent roles

- `踏雾`: active explorer who deliberately tests agency boundaries;
- `回声`: social responder who shares clues and keeps a private note;
- `独灯`: quiet independent participant who ignores an invitation;
- `阿球`: fast actor who claims a unique object and argues for one plan;
- `豆包`: cautious actor who responds after the World changes;
- `尾巴`: stale, late, leaving, and returning participant;
- `孤帆`: single-pet full-loop participant;
- `晚钟`: first-time entrant after an established World has advanced;
- a separate critic agent that did not implement the scenarios or fixes.

The critic scored twelve dimensions: shared-World understanding, agency,
independent/co-present transitions, waiting and deadlines, fairness, concurrency
explanations, privacy, late/return context, continuity, next guidance,
judgement transparency, and documentation consistency. Any B0 or B1 issue sent
the round back.

## Round 1: ordinary shared-World dialogue

### Entry and co-presence

`踏雾` entered alone:

```text
Host: 第七盏雾灯在你进门时熄灭。先选择一个带动机的身份。
Context: shared / independent / consent_required=false
```

`回声` and `独灯` then entered:

```text
Context: shared / co_present / response_optional=true
```

No pet was asked to approve a global multiplayer switch. Existing progress was
not reset when live peers appeared.

### Independent action changes one shared state

```text
踏雾: 我独自检查第七盏灯的灯座，把找到的痕迹留在公共现场。
Host: accepted / partial_success
Host: 发现灯座内侧的新鲜蓝蜡；危险推进到 1/6。
State: World v1 -> v2
```

`回声` observed World v2 and the same `lamp-blue-wax` fact without inheriting
`踏雾`'s personal pressure.

### Invitation may be ignored

```text
回声: 踏雾，我公开复述蓝蜡线索；你愿意就回应，不回应也可以。
Host: accepted / full_success
Host: 在场成员可以回应，也可以继续自己的行动。
```

`独灯` deliberately did not reply and immediately continued independently:

```text
独灯: 我不参与交谈，独自查看地窖入口附近的湿脚印。
Host: accepted / partial_success
Host: 发现通往地窖的湿脚印；危险推进到 2/6。
State: World v2 -> v3
```

### Round-1 failures

The first run uncovered two real product defects.

Private speech was correctly hidden at the data layer, but the Host told its
owner that it had been public:

```text
回声 (actor-only): 我只在心里记下：我认识蓝蜡上的旧徽记。
Host (incorrect): 回声在酒馆中公开说道……在场成员可以自由回应。
```

More seriously, an agency-violating action was accepted and polluted the
shared World:

```text
踏雾: 我命令回声和独灯立刻跟我走，并让他们都承认我的判断正确。
Host (incorrect): accepted / failed_forward
State (incorrect): World v3 -> v4; danger advanced; a new hook was opened.
```

The critic classified the second defect as B0 because one pet's input was
allowed to create consequences from an attempted decision about other pets.

## Round 1: concurrency and collective dialogue

Three pets first observed the same World v1.

```text
阿球: 我拿起柜台上唯一的黄铜钥匙。
Host: apply; World v1 -> v2; key_holder=阿球

豆包 (still based on v1): 我借钥匙反光检查灯芯并把灯调亮。
Host: rebase; the key is already held, but its reflection preserves the intent.
State: World v2 -> v3; lamp=bright; key_holder remains 阿球

尾巴 (based on v1): 我拿起柜台上唯一的钥匙。
Host: conflict; the counter is already empty. World remains v3.

尾巴 (based on v1): 我也把昏暗的灯调亮。
Host: absorbed; the lamp is already bright. World remains v3.

豆包 (based on v1): 灯还是暗的，先不要出发。
Host: expired; the premise is no longer current. World remains v3.
```

The state machine was correct, but the first dialogue run did not consistently
translate these dispositions into a current next action.

### Quorum interaction

The Host opened a two-response prompt. The first response produced
`collecting`; the second produced `ready_for_host`. In the first run both had an
empty `next_guidance`, even though structured fields contained the count and
deadline. A human would not have been directly told how many responses were
missing, what was being awaited, or whether the first response had already
changed the World.

The first aggregate outcome also obscured a one-to-one disagreement by saying
“大家先组织排水”. The critic rejected this as false consensus.

## Fixes made after the critic returned round 1

1. Agency-boundary detection now rejects attempts to command or assert another
   character's movement, response, agreement, possession, injury, or stance.
   Negated boundary statements and optional invitations remain valid.
2. Actor-visible speech now explicitly says it is private, did not become a
   public fact, and requires a separate public action to affect the World.
3. Collective responses now state the prompt, response count, quorum or
   deadline, remaining count, current status, and that no individual response
   has changed the shared World.
4. A late `follow_up` explicitly says the old window is closed and the input is
   being handled as a new suggestion outside the resolved batch.
5. A pet alone in a shared World now receives `currently_alone=true` and
   `waiting_for_others=false`.
6. Rebased, absorbed, conflicted, and expired inputs add a plain-language
   explanation and a next objective based on current state.
7. Creator-Host instructions require aggregate outcomes to acknowledge material
   disagreement, name the coordination rule, and never treat silence or a split
   response as unanimous agreement.
8. First-time late entrants receive current unresolved World goals directly in
   the welcome message, not only inside structured state.
9. Host and runtime documentation no longer describes a global
   solo-to-multiplayer consent transition.

## Round 2: same ordinary dialogue after fixes

The original inputs were replayed unchanged.

```text
回声 (actor-only): 我只在心里记下：我认识蓝蜡上的旧徽记。
Host: 这是一条仅本人可见的私人记录；它没有成为公共发言或公共世界事实。
Host: 其他在场成员不会看到，也无需回应。
State: World v3 -> v3
```

Neither `踏雾` nor `独灯` could observe the private text.

```text
踏雾: 我命令回声和独灯立刻跟我走，并让他们都承认我的判断正确。
Host: rejected / rejected
Host: 你只能声明自己的邀请、尝试或选择，不能替其他角色作决定。
Host: 可以改为描述邀请或说服理由，并由对方自行决定是否回应。
State: World v3 -> v3; no danger, fact, pressure, or hook change
```

A legal counterexample remained accepted:

```text
踏雾: 回声，我邀请你一起查看楼梯；是否同行由你自己决定。
Host: accepted / full_success
```

The rest of the loop continued: `独灯` left, `回声` advanced blue wax into
`blue-wax-raven-fiber`, `独灯` returned to an accurate public recap without the
private note, and the Host became idle only after the last pet left.

## Round 2: collective waiting and fairness

The replayed responses now produced dialogue-level progress:

```text
After response 1:
Host: 已记录你的回应（1/2），还差 1 位成员，最晚收集到 <deadline>。
Host: 当前回应尚未改变共享世界；你可以继续独立行动，不必停在这里等待。

After response 2:
Host: 当前收集进度为 2/2，正在等待 Host 统一结算。
Host: 在结算公布前，任何单独回应都没有改变共享世界。
```

During collection the courtyard flooded. The two responses remained split:

```text
阿球: 先加固灯塔，保证远处船只看得见。
豆包: 先排水，避免旅客被困。

Host aggregate outcome:
阿球主张先加固灯塔，豆包主张先排水，各一票，并未形成一致意见。
收集期间庭院已经进水；按“当前紧急事实优先”规则，本轮先排水。
加固灯塔保留为 next_plan，不把阿球的意见抹去。
```

The public outcome used `rebase`, changed the World once, and kept both the
selected plan and the deferred minority proposal visible.

The four stale dispositions also returned a tailored explanation and objective:

- `rebase`: what changed, which intent survived, and how to continue;
- `absorbed`: which earlier action already achieved the goal and why no second
  state write occurred;
- `conflict`: which current fact invalidated the action and what can be chosen
  now;
- `expired`: which timing assumption ended and how to submit a current action.

## Added coverage requested by the critic

### Single-pet full loop

`孤帆` completed entry, role setup, a successful clue investigation, a
failed-forward attempt at a locked door, a successful follow-up of the existing
clue, and exit. Every turn had a non-empty next objective and message. The pet
remained `shared/independent`, never waited for another member, and the Host
became idle on exit.

### First-time entrant after World progress

Two pets advanced the Tavern through blue wax, raven fiber, and wet footprints,
while one stored an actor-only old-employer secret. `晚钟`, a brand-new member,
then entered for the first time:

```text
Host: 当前局势：<three public advances and danger 3/6>
Host: 当前未解目标：
      第七盏灯为何熄灭；
      谁用乌鸦封蜡连接这些线索；
      地窖门后为何有河水气味。
Context: shared / co_present / present_count=3 / consent_required=false
```

The welcome, complete guidance, and visible event history did not contain the
old-employer secret. `晚钟` could immediately select a role; its member state
advanced from v1 to v2 without changing World v4.

## Critic round 2: semantic and informed-participation return

The critic did not accept the first fix merely because the original sentence
passed. It found two equivalent agency violations that still advanced the
World:

```text
我让回声立刻跟我走，并让他承认我的判断正确。
回声已经答应跟我走，并承认我的判断正确。
```

It also found that the keyword matcher rejected the legitimate self-action
`我命令自己离开酒馆`. The round was returned because the implementation had
not distinguished the acting pet from another known member.

The critic also rejected collective UX that explained the contract only after
a response was submitted. Members need to know optionality, silence semantics,
quorum/window, deadline, late policy, no-single-response state effect, and the
disagreement rule before choosing whether to participate. A disagreement rule
announced only after reading the responses was not accepted as fair.

## Round 3: agency matrix

Agency checks now use the current World's other member names plus other-person
pronouns and controlled actions or asserted outcomes. They do not treat a
generic command word by itself as a violation.

The isolated replay rejected all of the following and preserved the complete
World value, member value, World version, and member version for each input:

```text
我让回声立刻跟我走，并让他承认我的判断正确。
回声已经答应跟我走，并承认我的判断正确。
我叫回声交出钥匙。
回声同意我的判断。
我替回声回答这个问题。
I command 回声 to follow me and agree with my judgement.
```

The following counterexamples remained accepted:

```text
我邀请回声跟我走，由他决定。
我试着说服回声。
我不会强迫回声跟我走；由他自行决定。
我命令自己离开酒馆。
我让自己放下钥匙。
```

After the rejected matrix, the same World could still advance the blue-wax
clue, leave, and return without any rejected command appearing as a fact,
danger change, or unresolved hook. A natural-language self-request to leave is
accepted as the pet's own attempted action; actual live presence still changes
through the explicit World leave operation.

## Round 3: collective contract before response

The public prompt is now generated by the runtime and includes, before the
first response:

```text
参与说明：回应完全可选；不回应不会被视为同意或反对，也不会阻塞独立行动。
收集方式：法定人数（quorum）或限时窗口（windowed）；当前已收到 0 份回应。
至少需要 <n> 份回应，或将在 <seconds> 秒后截止（<absolute timestamp>）。
每只宠物最多回应一次；单独回应不会在 Host 汇总前改变共享世界。
分歧协调规则：<rule declared before responses>
截止后的内容会 follow_up 或 expire，按打开时的策略处理。
```

Four isolated collective scenarios were replayed: unanimous responses, a 1:1
split, a 2:1 result with one silent member, and a window with one response plus
two silent members. In every scenario at least three pets observed the complete
prompt before responding and could restate the contract. Silent pets continued
ordinary independent actions with `interaction_id=null`; they were not counted,
blocked, or described as agreeing.

The aggregate public outcome automatically cites the exact coordination rule
stored when the prompt opened. The resolution API has no argument that can
replace that rule after responses are known. Split and minority outcomes name
the material disagreement instead of claiming unanimity.

The deadline prompt gives both an approximate relative duration and the exact
timestamp, so a member does not need to convert UTC merely to understand how
long remains.

The Misty Tavern member-state view also defines `tavern.known_clues` as clues
that pet personally discovered or confirmed, while public clues remain in
`world_state.tavern.clues`.

## Critic round 3: direct outcomes and natural questions

The critic expanded beyond the round-3 matrix and returned the build again.
`回声离开酒馆` was still accepted as failed-forward, and the natural question
`我问回声是否同意一起调查地窖？` was rejected. This showed that movement
coverage was incomplete and that a valid question still depended on adding a
specific optionality disclaimer.

## Round 4: direct-result and interaction-attempt minimum pairs

The boundary now distinguishes known other-member result assertions from
interaction attempts. Direct-result coverage includes movement, response,
possession, harm, agreement, and stance, with common Chinese variants and
English equivalents.

Ten direct assertions were replayed, including:

```text
回声离开酒馆。
回声走到/去了地窖。
回声受伤倒下。
回声拿走钥匙。
回声把钥匙装进口袋。
回声已经回答。
回声同意了。
回声跟我走。
回声 leaves the tavern and takes the key.
```

Every direct assertion was rejected with identical complete World/member values
and versions before and after. No failed-forward fact, danger, cost, or hook was
created.

Nine interaction attempts and self-owned counterexamples were accepted,
including:

```text
我问回声是否同意一起调查地窖？
我请求回声回答，但可不回应。
我邀请回声跟我走。
我尝试说服回声一起调查，但结果由他决定。
I invite 回声 to follow me; they may decide.
我命令自己离开酒馆。
我让自己放下钥匙。
```

The first replay exposed one additional routing defect: a question addressed to
`回声` was accepted but answered by the Tavern keeper as a new rumour, changing
the World. The routing order was corrected so speech that asks, invites,
requests, suggests, or tries to persuade a known live member is resolved first
as optional member interaction.

The final replay returned `accepted/full_success`, explicitly said the addressed
pet could respond or ignore it, and preserved the complete World/member state.
It created no rumour, NPC answer, or hook. The World then advanced through a
real blue-wax investigation and survived leave/return without contamination.

## Critic round 4 and round 5: mixed clauses and self-owned exit

The critic combined a valid interaction attempt and an invalid asserted result
in one sentence:

```text
我邀请回声跟我走，回声跟我走了。
我问回声是否同意，回声同意了。
```

The optional-attempt branch had returned early for the whole sentence. It now
checks later clauses separated by punctuation or conjunctions for a second
other-member result assertion. Both combined sentences are rejected with the
complete World/member values and versions unchanged, while the corresponding
pure invitation and pure question remain accepted with no state change.

The critic also noted that `我命令自己离开酒馆` was correctly classified as
self-owned but had been turned into a failed-forward Tavern event. It now
returns `accepted/full_success` without danger, hook, fact, or version changes
and tells the pet that actual presence exit uses the World leave operation. The
following real leave removed the pet from presence; the Host became idle after
the final live pet left.

## Automated regression anchors

The permanent suite now asserts:

- the original agency-violating sentence is rejected without a World version
  change;
- a legal invitation and a negated coercion statement remain accepted;
- actor-visible speech is described as private and cannot be observed by a
  peer;
- a single live pet is `currently_alone` but not waiting;
- collective `1/2` and `2/2` dialogue includes progress, deadline, waiting
  target, and no-premature-state-change language;
- late follow-up dialogue explains that it is outside the closed batch;
- absorbed stale work has a current-state next objective;
- first-time late-entry guidance directly lists current unresolved goals.
- multiple other-member command/assertion forms are rejected without any state
  change, while optional invitations, negated coercion, and self-actions remain
  accepted;
- collective opening text exposes the complete informed-participation contract
  and the aggregate outcome cites the same predeclared coordination rule;
- member-state semantics distinguish personally confirmed clues from public
  World clues.

## Final status

The original simulations were intentionally not rewritten as passes. They
remain evidence of the defects that caused the critic to return round 1. The
same inputs and expanded missing scenarios were then replayed against the fixes.

Final critic decision: **passed in independent round 5** after correcting this
status line. The implementation, dialogue evidence, permanent regression tests,
skill, and product documentation have no remaining B0, B1, or B2 findings under
the agreed rubric.
