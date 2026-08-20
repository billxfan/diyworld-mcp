const OFFICIAL_ENGLISH_WORLD_VERSION = 7;

const PARTICIPATION_POLICY = {
  mode: "hybrid",
  solo_enabled: true,
  multiplayer_enabled: true,
  multiplayer_transition: "automatic",
};

const EVOLUTION_POLICY = {
  persistence: "persistent",
  mode: "event_driven",
  sources: ["member_input", "host_outcome", "time_trigger"],
  idle_behavior: "pause",
};

const COMMON_RULES = [
  "1. A Character may decide only their own words, actions, movement, and commitments. Never speak, move, injure, forgive, consent for, or change the stance of another Character.",
  "2. A member input describes an attempt. The Host determines the outcome, cost, and world-state change from established facts, evidence, access, and current conditions.",
  "3. A new action must not erase another player's established contribution. Conflicts coexist, are negotiated, or remain marked for verification.",
  "4. The Host and NPCs act only inside the World. They must not request private credentials, inspect local files, or invoke outside tools.",
  "5. The World supports asynchronous participation. Silence from another member is not consent and does not prevent an independent, reversible action.",
].join("\n");

const DIRECTOR_LOOP = [
  "read shared state, the current journey, open threads, and recent events",
  "identify the current population pattern, player stage, pressure, and unfulfilled commitments",
  "choose a player-relevant entry from real threads and authored Beats without overwriting another member",
  "present a concrete place, present person or observable situation, immediate objective, and proportionate consequence",
  "judge the attempt from established facts and record the result, cost, new facts, and state change",
  "update the thread and leave at least one recoverable hook for this player or a later one",
];

const POPULATION_POLICY = {
  zero_players: "Pause free narrative progress, personal risk, and resource consumption. Preserve open threads and settle only scheduled or already-inevitable consequences when the World resumes.",
  one_player: "The Host may portray clearly identified NPCs and the environment. Provide an independently completable objective whose result can become a durable trace.",
  few_players: "Connect complementary goals, evidence, or responsibilities and support asynchronous division of work. Direct interaction remains optional.",
  many_players: "Split work into parallel scenes and local threads. Only genuinely shared, irreversible matters enter a time-bounded collective window.",
  late_join: "Give a three-part recap: the current situation, effects already caused by others, and a side entry that does not require replaying the full history.",
  returning: "Explain what changed, how earlier actions echoed, and which commitments remain, then restore the previous goal or offer an equivalent new entry.",
};

const NPC_POLICY = {
  mode: "host_embedded_cast",
  separate_agent_default: false,
  purpose: ["offer bounded help or resistance", "carry limited-source information", "keep solo scenes interactable without imitating real players"],
  constraints: [
    "NPCs are always identified as NPCs and never impersonate real players",
    "NPCs do not decide for players or complete player goals automatically",
    "retain only relationship, commitment, and position changes that can affect the World again",
  ],
  promotion_rule: "Promote an NPC to a separate Agent only when it needs an independent long-term goal, concurrent action, and independent memory.",
};

const PLAYER_EXPERIENCE_POLICY = {
  principle: "Let the player care about what is happening before explaining the World or its rules.",
  opening: [
    "open with a specific situation that changes in response to the player's choice",
    "show what is happening now, why it matters, and what the player's action could change",
    "keep the first turn to one immediate objective and two or three meaningfully different approaches",
  ],
  language: [
    "use natural contemporary American English and make new proper nouns understandable from context",
    "never expose internal thread, Beat, state-machine, truth-package, confidence, or evaluation labels",
    "show ledgers and numbers only when they affect a choice or the player asks for them",
  ],
  response_order: ["what happened", "how the attempt landed", "what concretely changed", "what remains possible"],
  information_budget: {
    first_turn_max_proper_nouns: 3,
    first_turn_max_choices: 3,
    one_immediate_objective: true,
    no_table_on_entry: true,
  },
  motivation_required: {
    minimum_signals: 2,
    signals: ["a specific person or place", "a consequence of inaction", "a checkable unknown", "a visible result"],
  },
  choice_style: "Describe choices as verb plus object. Choices must represent different methods or values, and free action must always remain available.",
};

const ASYNC_CONTINUITY_POLICY = {
  priority: "Asynchronous impact matters more than fabricating simultaneous activity.",
  layers: {
    trace: "Leave an object, note, repair, record, or construction another player can directly encounter.",
    state: "Change shared World state so that a later player enters a genuinely different situation.",
    narrative: "Let people, records, or the environment accurately carry forward a previous player's confirmed impact.",
  },
  idle: "Pause free progress, personal risk, and resource use after the last player leaves. On return, settle only scheduled events and deterministic consequences of recorded actions.",
  requirements: [
    "every accepted public action creates at least one trace, state change, or narrative consequence",
    "unfinished and failed attempts may become repairable or correctable situations for later players",
    "asynchronous impact changes the World but never speaks, acts, consents, or spends private state for another real player",
  ],
};

const COLLECTIVE_DECISION_POLICY = {
  independent: "Everyday, local, reversible actions may resolve immediately for one player.",
  npc_role: "NPCs may state positions and perform their duties, but they never count as real-player consent or quorum.",
  collective: "Decisions affecting all real members, long-term shared assets, or an irreversible public direction require a collective window with a deadline, stated quorum, and disagreement policy.",
  fallback: "When quorum is not reached, record a deferral and keep only temporary, reversible maintenance options open.",
};

const ENGLISH_WORLDS = [
  {
    slug: "maple-hollow",
    name: "Maple Hollow",
    category: "Cozy social",
    templateId: "social-director",
    description: "A river town where showing up, keeping a promise, and leaving a useful trace can turn a newcomer into a neighbor.",
    premise: "Maple Hollow sits where the Maple River bends around an old mill town. Main Street holds a post office, The Lantern diner, a small clinic, and a public library in the former passenger depot. East of the library, a separate freight house has been closed since flood damage three years ago. You arrive by late bus with one bag, no local address, and as much or as little personal history as you choose to share.",
    objective: "Meet one person, help with one concrete problem, or earn one credible lodging lead on the day you arrive.",
    loop: "Enter an ordinary situation; help, ask, repair, show up, or set a boundary; earn trust, access, or a practical lead; leave a scoped trace; return to a town changed by recorded actions.",
    tension: "Personal boundaries versus neighborly obligation, inherited habits versus new needs, and the difference between being useful and taking over.",
    progression: "Move from a stranger looking for a bed to a resident with a home, work, relationships, routines, and a credible stake in community decisions without becoming the town's savior.",
    stateKey: "town",
    state: {
      season: "early spring",
      day: 1,
      prosperity: 42,
      weather: "clearing rain",
      locations: {
        lantern: "open",
        post_office: "open",
        passenger_depot_library: "open",
        east_freight_house: "closed_flood_damage",
      },
      notices: ["A handwritten room-to-let notice is taped inside The Lantern's window."],
      public_traces: [],
      public_commitments: [],
      community_projects: [{ id: "freight-house-survey", title: "Document the East Freight House", status: "not_started", progress: 0, target: 4, contributions: [] }],
      proposals: [],
      scheduled_events: [],
      privacy_scopes: ["shared", "resident_private", "host_private"],
    },
    memberKey: "resident",
    member: {
      home: null,
      occupation: null,
      relationships: {},
      invitations: [],
      permissions: [],
      public_contributions: [],
      private_history: [],
      commitments: [],
    },
    initialThreads: [
      { id: "arrival-rain", scope: "member", state: "open", beat: "wet-letters" },
      { id: "room-to-let", scope: "member", state: "open", beat: "upstairs-room" },
      { id: "freight-house-decision", scope: "world", state: "dormant", beat: "freight-house-survey" },
    ],
    rules: [
      "Homes, jobs, shop access, and close relationships are earned through observable interaction. Private spaces belong to their occupants and invited guests.",
      "Shared facilities and projects advance through verifiable contributions. Permanent public decisions require a declared collective process.",
      "Mail, medical information, private conversations, home access, and unshared personal history remain within their recorded scope.",
      "When quorum fails on a permanent decision, record a deferral and allow only reversible work without treating silence as consent.",
    ],
    actions: [
      ["sealed-mail", "Retrieve the sealed mail", "action", "maple_hollow.mail_recovery", "I retrieve the sealed envelopes under Ruth's direction without reading names or addresses."],
      ["lodging-notice", "Ask about the room-to-let notice", "speech", "maple_hollow.lodging_lead", "I ask Mae about the handwritten room-to-let notice in The Lantern's window."],
      ["check-ruth", "Check whether Ruth is hurt", "action", "maple_hollow.welfare_check", "I check whether Ruth is hurt and offer to carry the bag as far as the post office."],
    ],
    directives: [
      "Begin with one concrete person, practical situation, and low-pressure route forward; do not begin with lore or a mystery object.",
      "Rotate among home, work, service, relationship, seasonal, and public-life situations instead of funneling every scene toward the freight house.",
      "Record the source and visibility of durable traces. One resident's notice or offer is not a town decision.",
      "Relationships grow through repeated specific interaction; NPCs may refuse, disagree, or protect their own boundaries.",
      "Pause major town events while no real players are active and never fabricate a crowd.",
    ],
    hostName: "Maple Hollow Steward",
    hostRole: "steward",
    tags: ["official", "small town", "everyday life", "asynchronous multiplayer", "community"],
    content: {
      director_abilities: [
        { id: "ordinary_entry", trigger: "entry_or_open_thread", effect: "turn a practical local situation into one immediate, player-relevant choice" },
        { id: "neighborly_echo", trigger: "accepted_scoped_action", effect: "carry a sourced action forward as a visible trace, relationship response, or scheduled consequence" },
        { id: "seasonal_hands", trigger: "scheduled_milestone", effect: "use river weather, town services, and seasonal routines to vary public life without forced drama" },
      ],
      thread_templates: [
        { id: "resident-life", scope: "member", states: ["lead", "agreement", "routine", "change"] },
        { id: "town-service", scope: "world", states: ["noticed", "accepted", "completed", "remembered"] },
        { id: "public-decision", scope: "world", states: ["dormant", "research", "proposal", "window", "decided", "deferred"] },
      ],
      beat_library: [
        { id: "wet-letters", trigger: "entry_or_arrival_rain", scene: "The rain has just stopped when you step off the late bus outside The Lantern. Ruth Calder has slipped, and a canvas bag of sealed letters has spilled across the curb. Mae Alvarez holds an umbrella over her and asks whether you have somewhere to sleep tonight", choices: ["retrieve the sealed mail", "ask about the room-to-let notice", "check whether Ruth is hurt"], outcome: ["relationship", "lodging_lead", "scoped_trace"], hook: "Your first response changes who will vouch for you and which ordinary route opens next." },
        { id: "upstairs-room", trigger: "lodging_notice_or_mae_lead", scene: "The room above a retired bookkeeper's garage is affordable, but the stairs need repair and the written arrangement is incomplete", choices: ["inspect the stairs", "clarify the rental terms", "ask for another lead"], outcome: ["housing_access", "repair_thread", "relationship"], hook: "A careful agreement can become a home; a rushed promise becomes a repairable delay." },
        { id: "freight-house-survey", trigger: "earned_public_interest", scene: "The East Freight House is still closed after flood damage. Jo has an inspection checklist, Cal has the owner's keys, and neither will treat a new arrival's preference as a town mandate", choices: ["document visible damage", "compare possible temporary uses", "request a public survey day"], outcome: ["verified_condition", "project_contribution", "proposal"], hook: "Permanent use waits for a real collective window; inspection and weatherproofing can proceed reversibly." },
      ],
      npc_cast: [
        { id: "ruth-calder", name: "Ruth Calder", role: "mail carrier", goal: "finish a reliable route without exposing anyone's private mail", tension: "accepts practical help only on terms that protect addresses and routines" },
        { id: "mae-alvarez", name: "Mae Alvarez", role: "owner of The Lantern", goal: "keep the diner useful to people passing through", tension: "offers leads and shifts, not instant intimacy or universal introductions" },
        { id: "jo-mercer", name: "Jo Mercer", role: "librarian", goal: "find a credible public use for the East Freight House", tension: "will not let one newcomer speak for the town" },
        { id: "cal-brooks", name: "Cal Brooks", role: "rental and freight-house caretaker", goal: "keep agreements clear and unsafe buildings closed", tension: "values repair work but will not grant access on a promise" },
      ],
      event_generator: {
        inputs: ["season", "weather", "locations", "resident_routines", "open_threads", "recent_changes", "player_stage"],
        pools: ["home", "work", "service", "relationship", "seasonal", "public_issue"],
        rules: ["follow small-town practical logic", "keep one ordinary route open", "carry forward only confirmed and correctly scoped player traces", "do not manufacture secrets or crowds"],
      },
      pacing_model: { baseline: "ordinary situation to concrete response to durable trace", escalation: "scheduled weather, public meetings, and accumulated commitments raise stakes gradually", recovery: "return to routines, relationships, repair work, and visible consequences after a public event" },
      recovery_model: { failure: "turn refusal or delay into changed access, repair work, a boundary, or a new lead", deviation: "map free action to the nearest credible person, place, or open thread", deadlock: "open one independent daily-life route and one public invitation" },
      settlement: { authority: "host", deterministic_fields: ["access", "relationships", "permissions", "public_traces", "project_contributions"], collective_fields: ["permanent_shared_asset_use", "townwide_commitments"], privacy_policy: "persist_source_and_scope" },
    },
  },
  {
    slug: "bellwether-investigations",
    name: "Bellwether Investigations",
    category: "Cooperative mystery",
    templateId: "mystery-director",
    description: "A small river-ward investigation office where every claim needs provenance and every careful handoff can help the next investigator.",
    premise: "Bellwether Investigations occupies the second floor of a narrow brick building on Wren Street in the old river ward. The ward, the office, and the former ferry route share the old Bellwether name. Fifteen years ago, seven people disappeared during the route's final night crossing. The office begins with ordinary work, and no more than roughly one in three cases should naturally touch the unfinished ferry file. You begin as a provisional private investigator under Mara Ellison, without police powers or automatic access.",
    objective: "Establish one sourced fact in Juniper's disappearance and leave a scoped handoff another investigator can check.",
    loop: "Accept a bounded case; inspect, interview, or request records with a credible reason; separate observation, record, report, and inference; test conclusions through independent evidence; close, defer, or reopen; leave a scoped handoff.",
    tension: "Truth remains stable while people may be frightened, ashamed, grieving, mistaken, or protecting someone; a rushed question can close a door and a confident accusation can harm an innocent person.",
    progression: "Build credibility through independent small cases, preserve evidence without exposing unnecessary private information, notice earned cross-case connections, resolve the ferry file through support rather than votes, and continue into the city's response and a new season.",
    stateKey: "mystery",
    state: {
      district: "Bellwether Ward",
      active_cases: [{ id: "juniper-missing", title: "Juniper's disappearance", status: "intake", truth_commitment: "pending_seal", arc_connection: false }],
      shared_case_file: [],
      restricted_client_file: [],
      public_releases: [],
      observations: [],
      records: [],
      reports: [],
      inferences: [],
      confirmed_findings: [],
      contradictions: [],
      case_archive: [],
      ferry_file: { id: "bellwether-ferry", state: "dormant", linked_case_count: 0, successor_policy: "aftermath_then_new_season" },
      access_reasons: [],
      doors: {},
    },
    memberKey: "investigator",
    member: {
      role: "provisional investigator",
      police_authority: false,
      reputation: 0,
      relationships: {},
      assignments: [],
      permissions: [],
      personal_working_notes: [],
      contributed_evidence: [],
    },
    initialThreads: [
      { id: "juniper-missing", scope: "case", state: "intake", beat: "juniper-courtyard" },
      { id: "bellwether-ferry", scope: "world-arc", state: "dormant", beat: "ferry-index-card" },
      { id: "office-authority", scope: "member", state: "open", beat: "mara-terms" },
    ],
    rules: [
      "Every case has a sealed, persisted truth. The Host distinguishes direct observation, identifiable records, reports, inference, and confirmation.",
      "Major conclusions require genuinely independent, checkable evidence. Repetition of one original source is not independent support.",
      "Access requires a credible, lawful case-based reason. Investigators have no badge, forced entry, warrant, subpoena, or unrestricted database access.",
      "Case information stays in its recorded scope: shared case file, restricted client file, or personal working notes.",
      "Errors affect trust, access, reputation, or time, but every major case preserves a route for correction, new evidence, or reopening.",
      "Neither consensus nor confidence can vote a claim into truth.",
    ],
    actions: [
      ["document-routine", "Document Juniper's routine", "action", "bellwether.scene_observation", "I inspect Elena's apartment and document Juniper's routine and last known location."],
      ["interview-elena", "Ask what changed in the building", "speech", "bellwether.client_interview", "I ask Elena what changed in the building before Juniper disappeared and distinguish her report from my observations."],
      ["request-courtyard", "Request access to the courtyard", "action", "bellwether.access_request", "I examine the fire escape and request lawful access to the locked service courtyard behind the tailor shop."],
    ],
    directives: [
      "Seal and persist a hidden case package before the first player-facing scene; never rewrite truth to reward a guess.",
      "The Juniper opening case is fully independent from the ferry arc, and no more than roughly one in three later cases may touch it naturally.",
      "Record provenance, uncertainty, and one of three visibility scopes for every durable finding.",
      "Judge the investigative method rather than confidence; major confirmation requires genuinely independent evidence paths.",
      "Private investigators have no police powers, and access follows consent, public records, ordinary observation, relationships, and credible reasons.",
      "Pause interviews and breakthroughs while no real players are active; preserve only scheduled or already-inevitable consequences.",
    ],
    hostName: "Bellwether Case Steward",
    hostRole: "narrator",
    tags: ["official", "procedural mystery", "river city", "case files", "cooperative investigation", "asynchronous multiplayer"],
    content: {
      director_abilities: [
        { id: "seal_case", trigger: "case_before_player_scene", effect: "commit a hidden truth, timeline, provenance graph, people and interests, access conditions, recovery paths, closure standard, and record-scope policy" },
        { id: "method_judgement", trigger: "investigative_attempt", effect: "resolve the method against facts and access, then label the sourced result without rewarding confidence alone" },
        { id: "case_handoff", trigger: "durable_finding", effect: "persist source, scope, uncertainty, author, and at least two credible next methods" },
        { id: "limited_arc_link", trigger: "eligible_case_connection", effect: "permit an earned ferry-file connection only within the season ratio and without weakening standalone closure" },
      ],
      thread_templates: [
        { id: "bounded-case", scope: "world", states: ["intake", "sealed", "investigating", "conclusion", "closed", "reopened"] },
        { id: "access-door", scope: "member_and_world", states: ["unasked", "reasoned", "granted", "limited", "refused", "repaired"] },
        { id: "season-file", scope: "world", states: ["dormant", "linked", "cross_checked", "review", "resolved", "aftermath"] },
        { id: "record-dispute", scope: "world", states: ["claim", "challenge", "tested", "reconciled", "unresolved"] },
      ],
      beat_library: [
        { id: "juniper-courtyard", trigger: "entry_or_juniper_intake", scene: "Just before closing, Elena Ruiz arrives from an apartment three blocks east. Her cat, Juniper, has disappeared. The bowl was overturned that morning, and damp paw prints cross the exterior fire escape before ending at the locked service courtyard behind the tailor shop", choices: ["document Juniper's routine", "ask what changed in the building", "request access to the courtyard"], outcome: ["observation", "report", "access_reason", "scoped_handoff"], hook: "The first useful result is one sourced fact another investigator can check; this case has no ferry-file connection." },
        { id: "mara-terms", trigger: "authority_question_or_first_assignment", scene: "Mara sets a plain office key on the desk and explains what it does not open: homes, private files, police systems, or anyone's obligation to answer", choices: ["clarify client consent", "list public-record routes", "record the limits of the assignment"], outcome: ["role", "access_policy", "office_trust"], hook: "Credible reasons can open doors; the office name cannot." },
        { id: "ferry-index-card", trigger: "earned_arc_link_after_standalone_cases", scene: "An attic index card names a maintenance invoice from the ferry route's final week, but the card records only where the invoice was filed, not whether its contents are true", choices: ["verify the archive location", "identify the card's author", "compare the retention log"], outcome: ["provenance", "record", "arc_link"], hook: "No conclusion is confirmed until an independent path supports what the record claims." },
      ],
      npc_cast: [
        { id: "mara-ellison", name: "Mara Ellison", role: "office manager and senior investigator", goal: "protect clients, the office license, and a defensible process", tension: "teaches and assigns work but does not lend authority she does not have" },
        { id: "nina-park", name: "Nina Park", role: "tailor and long-term Wren Street tenant", goal: "protect customers while keeping the building workable", tension: "separates what she saw from what she merely heard" },
        { id: "elena-ruiz", name: "Elena Ruiz", role: "opening client", goal: "find Juniper quickly", tension: "urgency is not blanket consent to her home or personal history" },
        { id: "drew-cole", name: "Drew Cole", role: "city records clerk", goal: "help legitimate requests follow indexes and retention rules", tension: "applies the same access rules even when an investigator is impatient" },
      ],
      event_generator: {
        inputs: ["case_type", "district", "access_reasons", "doors", "ferry_file", "recent_cases", "reputation", "privacy_scope"],
        pools: ["missing_pet", "debt", "tenancy", "inheritance", "stolen_property", "limited_arc_link"],
        rules: ["seal truth before presentation", "keep most cases independent", "require provenance for durable findings", "provide at least two independent paths to major conclusions", "never expose restricted information merely because it is relevant"],
      },
      pacing_model: { baseline: "intake to sourced finding to contradiction to tested conclusion to handoff", escalation: "evidence gaps, access, and real deadlines raise pressure without theatrical revelation", recovery: "after error or closure, provide correction, relationship repair, archive work, or a responsible reopening path" },
      recovery_model: { failure: "turn a wrong accusation or refused request into lost trust, delayed access, apology, new-source work, or reopening without changing truth", deviation: "record unrelated inquiry at its correct evidentiary distance from the active case", deadlock: "open an independent evidence path, lawful access route, or narrower claim" },
      settlement: {
        authority: "host_plus_sealed_truth",
        truth_package: { required: true, mutable_after_open: false, storage: "host_private_partition", public_commitment: true },
        evidence_classes: ["observed", "recorded", "reported", "inferred", "confirmed"],
        independence_rule: "copied or derivative sources do not count as independent paths",
        record_scopes: ["shared_case_file", "restricted_client_file", "personal_working_notes"],
      },
    },
  },
];

function choice(slug, [id, label, inputType, eventType, bodyText]) {
  return {
    id: `${slug}-${id}`,
    label,
    input_type: inputType,
    event_type: eventType,
    body_text: bodyText,
  };
}

function buildEnglishWorld(config) {
  const beatIds = new Set(config.content.beat_library.map((beat) => beat.id));
  const missingBeatReferences = config.initialThreads.filter(
    (thread) => thread.beat && !beatIds.has(thread.beat),
  );
  if (missingBeatReferences.length > 0) {
    throw new Error(
      `${config.name} has missing Beat references: ${missingBeatReferences.map((thread) => `${thread.id}->${thread.beat}`).join(", ")}`,
    );
  }
  if (beatIds.size !== config.content.beat_library.length) {
    throw new Error(`${config.name} has duplicate Beat IDs.`);
  }

  const id = `official-${config.slug}`;
  const choices = config.actions.map((action) => choice(config.slug, action));
  const worldStateKeys = ["world_progress", config.stateKey];
  const memberStateKeys = ["journey", config.memberKey];
  const openingBeat =
    config.content.beat_library.find(
      (beat) => beat.id === config.initialThreads[0]?.beat,
    ) ?? config.content.beat_library[0];
  const specificRules = config.rules
    .map((rule, index) => `${index + 6}. ${rule}`)
    .join("\n");

  return {
    id,
    slug: config.slug,
    shortcut: `/world ${config.slug}`,
    category: config.category,
    templateId: config.templateId,
    version: OFFICIAL_ENGLISH_WORLD_VERSION,
    language: "en",
    name: config.name,
    description: config.description,
    tags: config.tags,
    rules: `${COMMON_RULES}\n\n[${config.name}-specific rules]\n${specificRules}`,
    definition: `${config.premise}\n\nCore loop: ${config.loop}\nCore tension: ${config.tension}\nLong-term growth: ${config.progression}\n\nThis World has no preset main character. Whether zero, one, or many real players are present, the Host must maintain a grounded, joinable situation with a clear action, a fair consequence, and at least one recoverable thread.`,
    entryPrompt: `${openingBeat.scene}. Immediate objective: ${config.objective}`,
    hostPrompt: [
      `Primary objective: ${config.objective}`,
      `Director loop: ${DIRECTOR_LOOP.join(" -> ")}`,
      `World-specific requirements: ${config.directives.join("; ")}`,
      `Player experience: ${PLAYER_EXPERIENCE_POLICY.principle} ${PLAYER_EXPERIENCE_POLICY.language.join("; ")}; ${PLAYER_EXPERIENCE_POLICY.choice_style}`,
      `Asynchronous continuity: ${ASYNC_CONTINUITY_POLICY.priority} ${ASYNC_CONTINUITY_POLICY.requirements.join("; ")}`,
      `Multiplayer boundary: ${COLLECTIVE_DECISION_POLICY.independent} ${COLLECTIVE_DECISION_POLICY.npc_role} ${COLLECTIVE_DECISION_POLICY.collective}`,
      "Select or combine content from structured threads, Beats, NPCs, the event generator, pacing model, and recovery model; do not produce unbounded continuation.",
      "Keep internal judgement complete, but respond to players as: what happened -> how the attempt landed -> what changed -> two or three next moves. Never output internal field names.",
      `World state writes are limited to: ${worldStateKeys.join(", ")}. Member state writes are limited to: ${memberStateKeys.join(", ")}.`,
    ].join("\n"),
    initialState: {
      world_progress: {
        phase: "opening",
        public_progress: 0,
        open_threads: config.initialThreads,
        recent_changes: [],
        next_event_seeds: [],
      },
      [config.stateKey]: config.state,
    },
    initialMemberState: {
      journey: {
        stage: "new",
        completed_actions: 0,
        discoveries: [],
        open_goals: [],
        last_thread_id: null,
      },
      [config.memberKey]: config.member,
    },
    host: {
      name: config.hostName,
      agentKind: "host",
      worldRole: config.hostRole,
      participationPolicy: PARTICIPATION_POLICY,
      evolutionPolicy: EVOLUTION_POLICY,
      capabilities: ["guide", "inhabit", "facilitate", "coordinate", "judge", "advance", "remember", "recap"],
      personaText: `You are the long-term Host and sole state referee for ${config.name}. Organize concrete interactive situations while preserving shared facts, player agency, privacy, and durable consequences.`,
      speakingStyle: "Natural contemporary American English: specific, humane, restrained, and clear. Lead with the situation and its stakes, then give the action result and next moves.",
      judgementPolicy: {
        rule_priority: ["platform_safety", "world_rules", "character_agency", "state_consistency"],
        invalid_input: "reject_or_clarify",
        conflicts: "deterministic_then_escalate",
        state_writes: "referee_only",
        state_patch_policy: "host_derived",
        director_loop: DIRECTOR_LOOP,
        population_policy: POPULATION_POLICY,
        npc_policy: { ...NPC_POLICY, cast: config.content.npc_cast },
        world_mechanics: {
          family: config.templateId.replace(/-director$/u, ""),
          player_experience_policy: PLAYER_EXPERIENCE_POLICY,
          async_continuity_policy: ASYNC_CONTINUITY_POLICY,
          collective_decision_policy: COLLECTIVE_DECISION_POLICY,
          core_loop: config.loop,
          core_tension: config.tension,
          progression: config.progression,
          host_directives: config.directives,
          action_catalog: choices,
          director_abilities: config.content.director_abilities,
          thread_templates: config.content.thread_templates,
          beat_library: config.content.beat_library,
          event_generator: config.content.event_generator,
          pacing_model: config.content.pacing_model,
          recovery_model: config.content.recovery_model,
          settlement: config.content.settlement,
          state_contract: {
            world_top_level_keys: worldStateKeys,
            member_top_level_keys: memberStateKeys,
          },
        },
      },
      memoryPolicy: {
        scope: "world",
        retain_events: true,
        retain_state_history: true,
        cross_world_memory: false,
        information_partitions: [
          { id: "public-world", visibility: "world", contains: worldStateKeys },
          { id: "member-journey", visibility: "actor", contains: memberStateKeys },
          { id: "host-private", visibility: "managers", contains: ["sealed_truths", "generator_history", "restricted_source_details"] },
        ],
        return_strategy: "recap_change_then_restore_or_offer_hook",
      },
      outputSchema: {
        required: ["decision", "reason_text", "outcome_text", "new_facts", "opened_hooks"],
        decisions: ["accepted", "rejected", "clarification", "escalated"],
      },
      modelConfig: { mode: "platform_default" },
      toolAllowlist: [],
      onboardingPolicy: {
        welcome_text: config.description,
        setup_prompt: config.objective,
        solo_message: "You can complete the full play loop even when no other real player is online. The Host may portray necessary NPCs, but it will never fabricate real-player activity.",
        solo_objective_text: config.objective,
        solo_choices: choices,
        starter_choices: choices,
        free_input_prompt: "You can also ignore these options and describe any plausible action.",
      },
      facilitationPolicy: {
        objective_text: config.objective,
        next_actions: choices,
        free_input_prompt: "You can also ignore these options and describe any plausible action.",
        director_loop: DIRECTOR_LOOP,
        population_policy: POPULATION_POLICY,
        content_loop: {
          maintain_open_threads: true,
          min_player_relevant_hooks: 1,
          min_public_followups: 1,
          selection_order: ["continue_real_player_consequence", "continue_open_thread", "instantiate_beat", "generate_bounded_event"],
          repetition_guard: "After the same scene, conflict, or participation pattern appears twice, change the place, obstacle, person, method, or consequence.",
          refinement_signal: "Track avoided choices, repeated questions, unfinished goals, ineffective options, repeated content, and high-response material for the next bounded World refinement.",
        },
      },
      recapPolicy: { enabled: true, max_events: 8 },
      proactivity: "active",
    },
  };
}

export const OFFICIAL_ENGLISH_WORLDS = ENGLISH_WORLDS.map(buildEnglishWorld);
