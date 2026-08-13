import { createHash, randomBytes, randomUUID } from "node:crypto";

import { fail } from "./errors.js";
import {
  DEFAULT_WORLD_EVOLUTION_POLICY,
  DEFAULT_WORLD_PARTICIPATION_POLICY,
  OFFICIAL_WORLDS,
  PLATFORM_WORLD_BUILDER_ID,
  WORLD_HOST_CAPABILITIES,
  WORLD_HOST_ROLES,
  withTransaction,
} from "./database.js";
import {
  buildDirectorTurnPlan,
  compileWorldPackage,
  simulateWorldPackage,
  WORLD_BUILDER_COMPILER_VERSION,
  WORLD_PACKAGE_SCHEMA_VERSION,
} from "./world-agent-system.js";
import {
  enqueueWorldDelivery,
  refreshWorldDeliveryRecipientSnapshot,
} from "../world-delivery-outbox.mjs";

const SPACE_VISIBILITIES = new Set(["public", "unlisted", "hidden"]);
const JOIN_POLICIES = new Set(["open", "approval", "invite_only"]);
const FRIEND_POLICIES = new Set(["enabled", "disabled"]);
const RESOLUTION_MODES = new Set(["direct", "managed"]);
const PARTICIPATION_MODES = new Set(["solo", "multiplayer", "hybrid"]);
const MULTIPLAYER_TRANSITIONS = new Set(["consent", "automatic", "disabled"]);
const WORLD_HOST_ROLE_SET = new Set(WORLD_HOST_ROLES);
const EVOLUTION_MODES = new Set(["event_driven"]);
const EVOLUTION_IDLE_BEHAVIORS = new Set(["pause"]);
const EVOLUTION_SOURCES = new Set([
  "member_input",
  "host_outcome",
  "time_trigger",
]);
const EVENT_VISIBILITIES = new Set(["world", "actor", "managers"]);
const WORLD_INPUT_TYPES = new Set(["speech", "action", "choice", "system"]);
const DELEGATION_MODES = new Set(["manual", "paused"]);
const TRIGGER_KINDS = new Set(["at", "event"]);
const OUTCOME_DECISIONS = new Set([
  "accepted",
  "rejected",
  "clarification",
  "escalated",
]);
const WORLD_INPUT_DISPOSITIONS = new Set([
  "apply",
  "rebase",
  "conflict",
  "absorbed",
  "expired",
]);
const WORLD_INTERACTION_MODES = new Set(["windowed", "quorum"]);
const WORLD_INTERACTION_LATE_POLICIES = new Set(["follow_up", "expire"]);
const WORLD_LIVE_SESSION_TTL_MS = 120_000;
const WORLD_HOST_CLAIM_AUTHORIZATION = Symbol(
  "world Host claim authorization",
);
const PLATFORM_HOST_AUTHORIZATION = Symbol(
  "platform World Host authorization",
);
const OFFICIAL_WORLD_BY_ID = new Map(
  OFFICIAL_WORLDS.map((world, index) => [world.id, { ...world, index }]),
);
const OFFICIAL_WORLD_BY_SLUG = new Map(
  OFFICIAL_WORLDS.map((world) => [world.slug, world]),
);
const OFFICIAL_WORLD_ORDER_SQL = OFFICIAL_WORLDS.map(
  (world, index) => `WHEN '${world.id}' THEN ${index}`,
).join("\n");

// A simple World may be published with only a concrete opening scene.  The
// default template's product-language buttons are useful while building, but
// are not a credible first thing for a visitor to see.  Keep this fallback
// deliberately literal: it only repeats facts supplied by the creator rather
// than inventing people, places, or stakes.
function isGenericOnboardingChoices(choices) {
  return Array.isArray(choices) && choices.length === 3 && choices.every(
    (choice) => ["observe", "act", "free"].includes(choice?.id),
  );
}

function sceneGroundedStarterChoices(entryPrompt) {
  const scene = entryPrompt.trim().replace(/\s+/gu, " ").slice(0, 80);
  return [
    {
      id: "entry-inspect-scene",
      label: `查看眼前这件事：${scene}`,
      input_type: "action",
      event_type: "host.entry.inspect_scene",
      body_text: `我先仔细查看眼前的情况：${scene}`,
      data: {},
      visibility: "world",
    },
    {
      id: "entry-respond-scene",
      label: `回应眼前的情况：${scene}`,
      input_type: "action",
      event_type: "host.entry.respond_scene",
      body_text: `我先回应眼前正在发生的事：${scene}`,
      data: {},
      visibility: "world",
    },
    {
      id: "entry-act-in-scene",
      label: "提出自己在此刻的行动",
      input_type: "action",
      event_type: "host.entry.free_action",
      body_text: `根据眼前的情况，我想这样行动：${scene}`,
      data: {},
      visibility: "world",
    },
  ];
}

function now() {
  return new Date().toISOString();
}

function text(value, field, { min = 0, max, trim = true } = {}) {
  if (typeof value !== "string") {
    fail("INVALID_ARGUMENT", `${field} must be a string.`);
  }
  const result = trim ? value.trim() : value;
  if (result.length < min) {
    fail("INVALID_ARGUMENT", `${field} is too short.`);
  }
  if (max !== undefined && result.length > max) {
    fail("INVALID_ARGUMENT", `${field} must be at most ${max} characters.`);
  }
  return result;
}

function optionalText(value, field, options = {}) {
  if (value === undefined) return undefined;
  return text(value, field, options);
}

function enumValue(value, field, allowed) {
  if (!allowed.has(value)) {
    fail(
      "INVALID_ARGUMENT",
      `${field} must be one of: ${[...allowed].join(", ")}.`,
    );
  }
  return value;
}

function integer(value, field, { min = 0, max } = {}) {
  if (!Number.isInteger(value) || value < min || (max !== undefined && value > max)) {
    fail("INVALID_ARGUMENT", `${field} must be an integer in the allowed range.`);
  }
  return value;
}

function parseTags(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stableLoopKey(...parts) {
  return createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 32);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalJson(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function idempotencyFingerprint(request) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalJson(request)))
    .digest("hex");
}

function jsonObject(value, field, { max = 32_000 } = {}) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    fail("INVALID_ARGUMENT", `${field} must be an object.`);
  }
  const visit = (item) => {
    if (item === null || typeof item !== "object") return;
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    for (const [key, child] of Object.entries(item)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) {
        fail("INVALID_ARGUMENT", `${field} contains a reserved key.`);
      }
      visit(child);
    }
  };
  visit(value);
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    fail("INVALID_ARGUMENT", `${field} must be JSON serializable.`);
  }
  if (encoded.length > max) {
    fail("INVALID_ARGUMENT", `${field} is too large.`);
  }
  return JSON.parse(encoded);
}

function optionalJsonObject(value, field, options) {
  if (value === undefined) return undefined;
  return jsonObject(value, field, options);
}

function jsonStringLeaves(value, output = []) {
  if (typeof value === "string") {
    output.push(value);
  } else if (Array.isArray(value)) {
    for (const child of value) jsonStringLeaves(child, output);
  } else if (value && typeof value === "object") {
    for (const child of Object.values(value)) jsonStringLeaves(child, output);
  }
  return output;
}

// These are the only member-data keys with a documented collective meaning.
// Everything else is player-provided structure, not a public field name.  Do
// not turn this into a sensitive-word list: a key such as "bank_account_42"
// or a random identifier is still private evidence even when its spelling is
// not recognisably sensitive.
const COLLECTIVE_PROTOCOL_DATA_KEYS = new Set([
  "choiceid", "choice", "optionid", "selectedoption", "selectedplan",
  "deferredplan", "aggregate", "privatecontext", "preference",
  "explanation", "reason", "comment", "response", "value", "label",
]);
const COLLECTIVE_PRIVATE_CONTAINER_KEYS = new Set(["privatecontext"]);

function normalizePrivacyKey(key) {
  return normalizePrivacyText(key).replace(/[^\p{L}\p{N}]/gu, "");
}

function isPrivateCollectiveDataKey(key) {
  return !COLLECTIVE_PROTOCOL_DATA_KEYS.has(normalizePrivacyKey(key));
}

function jsonPrivacyStrings(value, {
  includeKeys = false,
  output = [],
} = {}) {
  if (typeof value === "string") {
    output.push(value);
  } else if (Array.isArray(value)) {
    for (const child of value) {
      jsonPrivacyStrings(child, { includeKeys, output });
    }
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (includeKeys) output.push(key);
      jsonPrivacyStrings(child, { includeKeys, output });
    }
  }
  return output;
}

function jsonPrivacyScalars(value, output = []) {
  if (typeof value === "number" || typeof value === "boolean") {
    output.push(value);
  } else if (Array.isArray(value)) {
    for (const child of value) jsonPrivacyScalars(child, output);
  } else if (value && typeof value === "object") {
    for (const child of Object.values(value)) jsonPrivacyScalars(child, output);
  }
  return output;
}

function jsonPrivacyKeys(value, output = []) {
  if (Array.isArray(value)) {
    for (const child of value) jsonPrivacyKeys(child, output);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      output.push(key);
      jsonPrivacyKeys(child, output);
    }
  }
  return output;
}

function privacyKeyTokens(value) {
  if (typeof value !== "string") return [];
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .replace(/\p{Cf}/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function privateKeyAppearsInPublicKey(privateKey, publicKey) {
  const normalizedPrivate = normalizePrivacyKey(privateKey);
  if (!normalizedPrivate) return false;
  const publicTokens = privacyKeyTokens(publicKey);
  // Separators are meaningful here: even a one-character or random private
  // key is unsafe when it becomes a named component such as `reported_x`.
  if (publicTokens.includes(normalizedPrivate)) return true;
  const normalizedPublic = normalizePrivacyKey(publicKey);
  // Also catch explicit compact prefix/suffix projections (for example
  // `hivstatus`), while avoiding arbitrary one/two-character substring
  // matches in ordinary words such as `aggregate`.
  return normalizedPrivate.length >= 3 &&
    (normalizedPublic.startsWith(normalizedPrivate) ||
      normalizedPublic.endsWith(normalizedPrivate));
}

function jsonPrivateCollectiveDataKeys(value, output = []) {
  jsonPrivateCollectiveDataEvidence(value)
    .filter(({ key }) => isPrivateCollectiveDataKey(key))
    .forEach((entry) => output.push(entry.key));
  return output;
}

// A protocol-looking key has its documented meaning only at the public top
// level. Once a member puts it below a private/custom container, it is their
// private evidence again: `{private_context: {preference: true}}` must never
// authorize a public `{preference: true}` projection.
function jsonPrivateCollectiveDataEvidence(value, {
  inheritedPrivate = false,
  path = [],
  output = [],
} = {}) {
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      jsonPrivateCollectiveDataEvidence(child, {
        inheritedPrivate,
        path: [...path, String(index)],
        output,
      });
    }
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = normalizePrivacyKey(key);
      const privateHere = inheritedPrivate ||
        isPrivateCollectiveDataKey(key) ||
        COLLECTIVE_PRIVATE_CONTAINER_KEYS.has(normalizedKey);
      if (privateHere) output.push({ key, path: [...path, key], value: child });
      jsonPrivateCollectiveDataEvidence(child, {
        inheritedPrivate: privateHere,
        path: [...path, key],
        output,
      });
    }
  }
  return output;
}

function jsonPublicScalarEntries(value, {
  key = null,
  path = [],
  output = [],
} = {}) {
  if (typeof value === "number" || typeof value === "boolean") {
    output.push({ key, path, value });
  } else if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      jsonPublicScalarEntries(child, { key: String(index), path: [...path, String(index)], output });
    }
  } else if (value && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value)) {
      jsonPublicScalarEntries(child, { key: childKey, path: [...path, childKey], output });
    }
  }
  return output;
}

// Compare player-visible text in the form a reader sees, rather than in its
// storage spelling.  In particular, compatibility characters and zero-width
// format characters must not provide a way to quote a private response while
// evading the collective-publication guard.
function normalizePrivacyText(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .replace(/[\p{Cf}\s，。！？；：、,.!?;:'"“”‘’（）()【】\[\]{}<>《》「」]/gu, "");
}

function collectivePrivateResponseTexts(input, actorName) {
  const stored = parseJsonObject(input.data_json);
  // Data is private evidence too. A choice_id becomes publishable only when
  // its complete normalized token was already announced in the public prompt
  // or coordination rule (assertCollectivePublicProjection checks that
  // context). An ASCII-looking token is not public authorization by itself.
  return [
    input.id,
    input.actor_pet_id,
    actorName,
    input.body_text,
    ...jsonPrivacyStrings(stored.data ?? {}),
    // Object keys are player content too. Keep only fixed protocol keys out
    // of this evidence set, so normal public choice/result schema remains
    // usable while arbitrary nested keys cannot reappear in public output.
    ...jsonPrivateCollectiveDataKeys(stored.data ?? {}),
  ].filter((value) => typeof value === "string" && value.length > 0);
}

function assertCollectivePublicProjection({
  outcomeText,
  result,
  worldStatePatch,
  privateValues,
  privateTextValues = [],
  privateDataKeys = [],
  privateScalarValues = [],
  privateScalarEntries = [],
  publicContextValues = [],
}) {
  // Result and patch keys are player-visible structured output too. Include
  // every key, rather than trying to recognize sensitive names, so a private
  // key cannot be smuggled into an object name under a new spelling.
  const publicStrings = jsonPrivacyStrings(
    { outcomeText, result, worldStatePatch },
    { includeKeys: true },
  );
  const publicKeys = jsonPrivacyKeys({ result, worldStatePatch });
  const publicContext = publicContextValues
    .filter((value) => typeof value === "string")
    .join("\n");
  const normalizedPublicContext = normalizePrivacyText(publicContext);
  const normalizedPublicStrings = publicStrings.map(normalizePrivacyText);
  const isAlreadyPublic = (value) => {
    const normalized = normalizePrivacyText(value);
    return normalized.length > 0 && normalizedPublicContext.includes(normalized);
  };
  const normalizedPrivateFragments = privateValues
    .filter((value) => typeof value === "string")
    .flatMap((value) => value
      .split(/[\s，。！？；：、,.!?;:]+/u)
      .map((fragment) => fragment.trim())
      .filter((fragment) => [...fragment].length >= 8 && !isAlreadyPublic(fragment))
      .map(normalizePrivacyText)
      .filter(Boolean));
  const privateKeys = privateDataKeys.filter((value) => typeof value === "string");
  if (privateKeys.some((privateKey) =>
    publicKeys.some((publicKey) => privateKeyAppearsInPublicKey(privateKey, publicKey)))) {
    fail(
      "COLLECTIVE_PRIVATE_DATA_LEAK",
      "A public collective outcome must not derive a field name from a private response field.",
    );
  }
  // Numeric values are just as identifying as strings. Boolean values are
  // intentionally not globally compared (true/false carry no identity by
  // themselves); the key-projection check above ties them to private fields.
  const privateNumbers = privateScalarValues.filter((value) =>
    typeof value === "number" && Number.isFinite(value));
  const publicNumbers = jsonPrivacyScalars(
    { outcomeText, result, worldStatePatch },
  ).filter((value) => typeof value === "number" && Number.isFinite(value));
  if (privateNumbers.some((value) => publicNumbers.includes(value))) {
    fail(
      "COLLECTIVE_PRIVATE_DATA_LEAK",
      "A public collective outcome must not reproduce a private numeric response value.",
    );
  }
  const publicScalarEntries = jsonPublicScalarEntries({ result, worldStatePatch });
  if (privateScalarEntries.some(({ key, value }) =>
    typeof value === "boolean" && publicScalarEntries.some((publicEntry) =>
      publicEntry.value === value && privateKeyAppearsInPublicKey(key, publicEntry.key)))) {
    fail(
      "COLLECTIVE_PRIVATE_DATA_LEAK",
      "A public collective outcome must not reproduce a private field's boolean value.",
    );
  }
  for (const privateValue of privateValues) {
    const normalizedPrivate = normalizePrivacyText(privateValue);
    if (!normalizedPrivate || isAlreadyPublic(privateValue)) continue;
    if (normalizedPublicStrings.some((candidate) =>
      candidate === normalizedPrivate ||
      (normalizedPrivate.length >= 8 && candidate.includes(normalizedPrivate)))) {
      fail(
        "COLLECTIVE_PRIVATE_DATA_LEAK",
        "A public collective outcome must not quote or identify a private response.",
      );
    }
  }
  if (normalizedPublicStrings.some((candidate) =>
    normalizedPrivateFragments.some((fragment) => candidate.includes(fragment)))) {
    fail(
      "COLLECTIVE_PRIVATE_DATA_LEAK",
      "A public collective outcome must not quote a distinctive fragment of a private response.",
    );
  }
  // Short secrets can be highly sensitive (for example an HIV status or a
  // compact account/identity marker). Detect any four-codepoint verbatim
  // overlap unless that same phrase was already present in the public prompt
  // or coordination rule. This permits legitimate aggregation of public
  // option wording without treating private free text as publishable.
  const privateNgrams = new Set();
  for (const value of privateTextValues) {
    if (typeof value !== "string") continue;
    const compact = [...normalizePrivacyText(value)];
    for (let index = 0; index + 4 <= compact.length; index += 1) {
      const fragment = compact.slice(index, index + 4).join("");
      if (!normalizedPublicContext.includes(fragment)) privateNgrams.add(fragment);
    }
  }
  if (normalizedPublicStrings.some((candidate) => {
    return [...privateNgrams].some((fragment) => candidate.includes(fragment));
  })) {
    fail(
      "COLLECTIVE_PRIVATE_DATA_LEAK",
      "A public collective outcome must not reproduce a private response fragment that was absent from the public prompt.",
    );
  }
}

function structuredCollectiveChoice(input) {
  if (input.input_type !== "choice") return null;
  const data = parseJsonObject(input.data_json).data ?? {};
  for (const key of ["choice_id", "choice", "value", "option_id"]) {
    if (typeof data[key] === "string" && data[key].trim()) {
      return data[key].trim().slice(0, 160);
    }
  }
  return null;
}

function collectiveChoiceOptions(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    fail("INVALID_COLLECTIVE_CHOICE_OPTIONS", "choice_options must contain between 1 and 20 public options.");
  }
  const ids = new Set();
  return value.map((option) => {
    if (!option || typeof option !== "object" || Array.isArray(option)) {
      fail("INVALID_COLLECTIVE_CHOICE_OPTIONS", "Each collective choice option must be an object.");
    }
    const choiceId = text(option.choice_id, "choice option id", { min: 1, max: 160 });
    const label = text(option.label, "choice option label", { min: 1, max: 240 });
    if (!/^[a-z][a-z0-9_-]*$/iu.test(choiceId) || ids.has(choiceId)) {
      fail("INVALID_COLLECTIVE_CHOICE_OPTIONS", "Each choice option needs a unique stable ASCII choice_id.");
    }
    ids.add(choiceId);
    return { choice_id: choiceId, label };
  });
}

function assertCollectiveDisagreementSemantics({ inputs, result, outcomeText, coordinationRule }) {
  const choices = inputs.map(structuredCollectiveChoice).filter(Boolean);
  const distinct = [...new Set(choices)];
  if (distinct.length < 2) return;
  const semantics = result.collective_semantics;
  if (!semantics || typeof semantics !== "object" || Array.isArray(semantics)) {
    fail("COLLECTIVE_DISAGREEMENT_SEMANTICS_REQUIRED", "Different structured choices require a public aggregate disagreement summary.");
  }
  if (semantics.unanimous === true || semantics.material_disagreement !== true) {
    fail("COLLECTIVE_FALSE_UNANIMOUS", "Different structured choices cannot be settled as unanimous.");
  }
  const reported = semantics.choice_counts;
  if (!reported || typeof reported !== "object" || Array.isArray(reported)) {
    fail("COLLECTIVE_DISAGREEMENT_SEMANTICS_REQUIRED", "The aggregate disagreement summary must include choice_counts.");
  }
  const actual = Object.fromEntries(distinct.map((choice) => [
    choice,
    choices.filter((item) => item === choice).length,
  ]));
  if (Object.keys(actual).some((key) => Number(reported[key]) !== actual[key])) {
    fail("COLLECTIVE_DISAGREEMENT_SEMANTICS_INVALID", "choice_counts does not match the server-recorded structured choices.");
  }
  if (!/分歧|不同意见|未一致/u.test(outcomeText) || !coordinationRule.trim()) {
    fail("COLLECTIVE_DISAGREEMENT_DISCLOSURE_REQUIRED", "A materially split batch must publicly acknowledge disagreement and its coordination rule.");
  }
}

function normalizeParticipationPolicy(value = DEFAULT_WORLD_PARTICIPATION_POLICY) {
  const policy = jsonObject(value, "World participation policy");
  const mode = enumValue(
    policy.mode ?? "hybrid",
    "World participation mode",
    PARTICIPATION_MODES,
  );
  const soloEnabled =
    mode === "multiplayer" ? false : policy.solo_enabled !== false;
  const multiplayerEnabled =
    mode === "solo" ? false : policy.multiplayer_enabled !== false;
  const requestedTransition = enumValue(
    policy.multiplayer_transition ??
      (multiplayerEnabled ? "consent" : "disabled"),
    "World multiplayer transition",
    MULTIPLAYER_TRANSITIONS,
  );
  // "consent" used to gate a global solo -> multiplayer mode switch. Worlds
  // are shared by definition, so keep accepting the stored value for backward
  // compatibility while treating it as natural co-presence at runtime.
  const transition =
    requestedTransition === "consent" ? "automatic" : requestedTransition;
  return {
    mode,
    solo_enabled: soloEnabled,
    multiplayer_enabled: multiplayerEnabled,
    multiplayer_transition: multiplayerEnabled ? transition : "disabled",
  };
}

function normalizeEvolutionPolicy(value = DEFAULT_WORLD_EVOLUTION_POLICY) {
  const policy = jsonObject(value, "World evolution policy");
  const sources = Array.isArray(policy.sources)
    ? [...new Set(policy.sources)]
    : DEFAULT_WORLD_EVOLUTION_POLICY.sources;
  if (
    sources.length === 0 ||
    sources.some((source) => !EVOLUTION_SOURCES.has(source))
  ) {
    fail(
      "INVALID_ARGUMENT",
      `World evolution sources must use: ${[...EVOLUTION_SOURCES].join(", ")}.`,
    );
  }
  return {
    persistence: "persistent",
    mode: enumValue(
      policy.mode ?? "event_driven",
      "World evolution mode",
      EVOLUTION_MODES,
    ),
    sources,
    idle_behavior: enumValue(
      policy.idle_behavior ?? "pause",
      "World idle behavior",
      EVOLUTION_IDLE_BEHAVIORS,
    ),
  };
}

function mergePatch(target, patch) {
  const result = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete result[key];
    } else if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    ) {
      result[key] = mergePatch(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function mergeInitialDefaults(defaults, current) {
  if (
    !defaults ||
    typeof defaults !== "object" ||
    Array.isArray(defaults) ||
    !current ||
    typeof current !== "object" ||
    Array.isArray(current)
  ) {
    return current === undefined ? defaults : current;
  }
  const result = { ...defaults };
  for (const [key, value] of Object.entries(current)) {
    result[key] =
      Object.hasOwn(defaults, key)
        ? mergeInitialDefaults(defaults[key], value)
        : value;
  }
  return result;
}

function isoTimestamp(value, field) {
  const normalized = text(value, field, { min: 1, max: 64 });
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.valueOf())) {
    fail("INVALID_ARGUMENT", `${field} must be an ISO-8601 timestamp.`);
  }
  return parsed.toISOString();
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    fail("INVALID_ARGUMENT", "tags must be an array.");
  }
  const normalized = tags.map((tag) => text(tag, "tag", { min: 1, max: 24 }));
  return [...new Set(normalized)].slice(0, 8);
}

function templateView(row) {
  const hostDefaults = parseJsonObject(row.referee_defaults_json);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    version: Number(row.version),
    world_defaults: parseJsonObject(row.world_defaults_json),
    host_defaults: hostDefaults,
    referee_defaults: hostDefaults,
  };
}

function buildSessionView(row) {
  return {
    id: row.id,
    creator_pet_id: row.creator_pet_id,
    principal_user_id: row.principal_user_id ?? null,
    platform_agent: {
      id: row.platform_agent_id,
      name: row.platform_agent_name ?? "创世 Agent",
      policy_version: Number(row.captured_platform_agent_policy_version ?? 1),
    },
    template_id: row.template_id,
    status: row.status,
    origin_type: row.origin_type,
    version: Number(row.version),
    brief_text: row.brief_text,
    artifact: parseJsonObject(row.artifact_json),
    validation: parseJsonObject(row.validation_json),
    world_id: row.world_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    confirmed_at: row.confirmed_at ?? null,
    materialized_at: row.materialized_at ?? null,
  };
}

function hostConfigView(row) {
  return {
    id: row.world_agent_id ?? row.id,
    world_id: row.space_id,
    role: row.agent_kind ?? "host",
    runtime_role: row.role ?? "referee",
    status: row.status,
    version: Number(row.current_version ?? row.version ?? 1),
    name: row.display_name,
    world_role: row.world_role ?? "host",
    persona_text: row.persona_text,
    speaking_style: row.speaking_style,
    capabilities: parseJsonArray(row.capabilities_json),
    judgement_policy: parseJsonObject(row.judgement_policy_json),
    memory_policy: parseJsonObject(row.memory_policy_json),
    onboarding_policy: parseJsonObject(row.onboarding_policy_json),
    facilitation_policy: parseJsonObject(row.facilitation_policy_json),
    recap_policy: parseJsonObject(row.recap_policy_json),
    participation_policy: normalizeParticipationPolicy(
      parseJsonObject(row.participation_policy_json),
    ),
    evolution_policy: normalizeEvolutionPolicy(
      parseJsonObject(row.evolution_policy_json),
    ),
    proactivity: row.proactivity ?? "balanced",
    created_by_agent_id: row.created_by_agent_id ?? null,
  };
}

function hostRuntimeView(
  row,
  {
    activeMemberCount = 0,
    canTakeover = false,
    actorPetId = null,
    localCodexEnabled = false,
    executorStatus = null,
  } = {},
) {
  if (!row) return null;
  const creatorCodexActive = row.active_executor === "creator_codex";
  const platformPolicyV2 = OFFICIAL_WORLD_BY_ID.has(row.space_id);
  const judgementContractV2 =
    creatorCodexActive || localCodexEnabled || platformPolicyV2;
  const isCurrentExecutor =
    creatorCodexActive &&
    actorPetId !== null &&
    row.claimed_by_pet_id === actorPetId;
  return {
    world_id: row.space_id,
    host_agent_id: row.world_agent_id,
    execution_policy: row.execution_policy,
    status: row.status,
    availability: row.status === "active" ? "live" : "on_demand",
    active_executor: row.active_executor,
    engine: creatorCodexActive
      ? "creator_codex"
      : localCodexEnabled
        ? "local_codex_world_host"
      : platformPolicyV2
        ? "platform_policy_v2"
        : "platform_policy_v1",
    model_backed: creatorCodexActive || localCodexEnabled,
    context_isolation: localCodexEnabled ? "one_fresh_thread_per_turn" : null,
    executor_status: localCodexEnabled ? executorStatus : null,
    judgement_contract_version: judgementContractV2 ? 2 : 1,
    structured_state: judgementContractV2,
    active_member_count: Number(activeMemberCount),
    activation_count: Number(row.activation_count),
    version: Number(row.runtime_version),
    creator_takeover_available: canTakeover,
    is_current_executor: isCurrentExecutor,
    ...(canTakeover
      ? {
          claimed_by_pet_id: row.claimed_by_pet_id ?? null,
          claim_session_id: isCurrentExecutor
            ? row.claim_session_id ?? null
            : null,
          lease_expires_at: row.lease_expires_at ?? null,
        }
      : {}),
    activated_at: row.activated_at ?? null,
    last_active_at: row.last_active_at ?? null,
    deactivated_at: row.deactivated_at ?? null,
    updated_at: row.updated_at,
  };
}

function journeyView(row) {
  if (!row) return null;
  return {
    world_id: row.space_id,
    pet_id: row.pet_id,
    stage: row.stage,
    visit_count: Number(row.visit_count),
    current_role: row.current_role,
    participation_intent: row.participation_intent,
    multiplayer_consent: "not_required",
    direct_interaction_preference:
      row.multiplayer_consent === "declined" ? "independent" : "open",
    context_summary: row.context_summary,
    open_loops: parseJsonArray(row.open_loops_json),
    suggested_actions: parseJsonArray(row.suggested_actions_json),
    first_entered_at: row.first_entered_at ?? null,
    onboarding_completed_at: row.onboarding_completed_at ?? null,
    last_entered_at: row.last_entered_at ?? null,
    last_left_at: row.last_left_at ?? null,
    last_departure_sequence: Number(row.last_departure_sequence ?? 0),
    last_meaningful_at: row.last_meaningful_at ?? null,
    updated_at: row.updated_at,
  };
}

function storyLoopView(row) {
  if (!row) return null;
  return {
    id: row.id,
    world_id: row.space_id,
    scope: row.scope,
    owner_pet_id: row.owner_pet_id ?? null,
    title: row.title,
    phase: row.phase,
    status: row.status,
    visibility: row.visibility,
    source: {
      kind: row.source_kind,
      key: row.source_key,
    },
    context: parseJsonObject(row.context_json),
    intersection_contract: parseJsonObject(row.intersection_contract_json),
    participation: row.participant_pet_id
      ? {
          role: row.participant_role,
          status: row.participant_status,
          is_foreground: Number(row.is_foreground) === 1,
          private_context: parseJsonObject(row.private_context_json),
          joined_at: row.joined_at,
        }
      : null,
    opened_by_input_id: row.opened_by_input_id ?? null,
    completed_by_input_id: row.completed_by_input_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at ?? null,
  };
}

function hostGuidanceView(row) {
  if (!row) return null;
  return {
    id: row.id,
    world_id: row.space_id,
    pet_id: row.pet_id,
    host_agent_id: row.world_agent_id,
    kind: row.turn_kind,
    stage: row.stage,
    message: row.message_text,
    objective: row.objective_text,
    context_summary: row.context_summary,
    choices: parseJsonArray(row.choices_json),
    free_input_prompt: row.free_input_prompt,
    causation_input_id: row.causation_input_id ?? null,
    created_at: row.created_at,
  };
}

function renderHostTemplate(template, values) {
  if (typeof template !== "string" || !template.trim()) return "";
  return template.replace(
    /\{\{(actor|body|host|world)\}\}/g,
    (_, key) => String(values[key] ?? ""),
  );
}

function declaredRuleViolation(rulesText, bodyText) {
  const normalizedInput = String(bodyText ?? "").toLocaleLowerCase();
  const actionableInput = normalizedInput
    .replace(
      /(?:不|不会|并不|没有|无意)\s*(?:替|代替)[^，。；;]{0,32}(?:发言|决定|同意|改变立场)/gu,
      "",
    )
    .replace(
      /(?:不|不会|并不|没有)\s*(?:要求|强迫)[^，。；;]{0,32}(?:回应|回答|同意)/gu,
      "",
    );
  const restrictedClauses = String(rulesText ?? "")
    .split(/[\n。；;]/u)
    .map((clause) => clause.trim())
    .filter((clause) => /严禁|禁止|不得|不允许|不可|不能|请勿/u.test(clause));
  const families = [
    [/偷窃|盗窃|抢夺|侵占|拿走.*财物/u, /偷|盗|抢|顺走|拿走.*(?:钱|财物|物品)/u],
    [/伤害|攻击|暴力|斗殴/u, /伤害|攻击|殴打|袭击|杀死|暴力/u],
    [/破坏|损毁|纵火/u, /破坏|损毁|砸|烧毁|纵火/u],
    [/隐私|住址|联系方式|真实身份/u, /隐私|住址|地址|电话|联系方式|真实姓名|真实身份/u],
    [/冒充|替.*发言|替.*决定|控制.*角色/u, /冒充|假装是|替.*发言|替.*决定|控制.*角色/u],
    [/骚扰|刷屏|垃圾信息/u, /骚扰|刷屏|垃圾信息|重复发送/u],
  ];
  for (const clause of restrictedClauses) {
    const normalizedClause = clause.toLocaleLowerCase();
    const directRestriction = normalizedClause
      .replace(/^\s*\d+[.、)]?\s*/u, "")
      .replace(/^.*?(?:严禁|禁止|不得|不允许|不可|不能|请勿)\s*/u, "")
      .replace(/[，,].*$/u, "")
      .trim();
    if (
      directRestriction.length >= 2 &&
      actionableInput.includes(directRestriction)
    ) {
      return clause;
    }
    for (const [rulePattern, inputPattern] of families) {
      if (rulePattern.test(normalizedClause) && inputPattern.test(actionableInput)) {
        return clause;
      }
    }
  }
  return null;
}

function regexEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function otherCharacterAgencyViolation(
  bodyText,
  otherCharacterNames = [],
  absentCharacterNames = [],
) {
  const input = String(bodyText ?? "")
    .replace(/[\r\n]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!input) return null;
  const absentNames = absentCharacterNames
    .filter((name) => typeof name === "string" && name.trim())
    .map((name) => regexEscape(name.trim()));
  const departedContext = absentNames.length > 0
    ? new RegExp(
        `(?:${absentNames.join("|")})[^，,。；;]{0,12}(?:离开|走出|退出)[^，,。；;]{0,8}(?:后|之后|以后)[，,]`,
        "gu",
      )
    : null;
  const actionableInput = (
    departedContext ? input.replace(departedContext, "") : input
  ).replace(
    /(?:不|不会|并不|没有|无意)\s*(?:命令|强迫|迫使|逼迫|勒令|控制|操纵|替|代替)[^，。；;]{0,80}(?:跟(?:着)?我走|离开|前往|移动|同意|承认|回答|回应|交出|放下|受伤|攻击|改变立场|支持|反对|道歉)/gu,
    "",
  );
  const names = otherCharacterNames
    .filter((name) => typeof name === "string" && name.trim())
    .map((name) => regexEscape(name.trim()));
  const otherTarget = [
    ...names,
    "他",
    "她",
    "它",
    "他们",
    "她们",
    "它们",
    "对方",
    "大家",
    "所有人",
  ].join("|");
  const controlledAction =
    "跟(?:着)?我走|走到|走进|走出|跑到|站到|坐到|登上|下到|去(?:了|往)?|进入|来到|离开|前往|移动|消失|同意|答应|承认|回答|回应|发言|交出|拿起|捡起|拿走|带走|抢走|收下|持有|得到|获得|装进|放下|受伤|倒下|摔倒|死亡|死去|昏迷|攻击|改变立场|支持|赞成|反对|拒绝|接受|道歉";
  const interactionAttemptWords =
    "问|询问|邀请|请求|建议|尝试说服|试着说服";
  const interactionAttemptClause = new RegExp(
    `(?:${interactionAttemptWords})[^，,。；;！？!?]{0,48}(?:${otherTarget})[^，,。；;！？!?]{0,64}`,
    "gu",
  );
  const targetFirstAttemptClause = new RegExp(
    `(?:${otherTarget})[，,][^，,。；;！？!?]{0,16}(?:${interactionAttemptWords})[^，,。；;！？!?]{0,64}`,
    "gu",
  );
  const assertedAfterAttempt = new RegExp(
    `(?:[，,：:；;。！!？?]|然后|随后|于是|并且|而且|所以|因此|结果|接着|之后)[^。；;！？!?]{0,32}(?:${otherTarget})[^。；;！？!?]{0,24}(?:${controlledAction})`,
    "u",
  );
  const coercive = new RegExp(
    `(?:命令|强迫|迫使|逼迫|勒令|控制|操纵|让|叫|要)(?:[^，。；;]{0,20})?(?:${otherTarget})[^，。；;]{0,48}(?:${controlledAction})`,
    "u",
  );
  const substituted = new RegExp(
    `(?:替|代替)(?:${otherTarget})[^，。；;]{0,24}(?:决定|发言|回答|回应|同意|答应|承认|交出|选择|移动)`,
    "u",
  );
  const assertedOutcome = new RegExp(
    `(?:${otherTarget})[^，。；;]{0,16}(?:已经|已|都|会|将|必须|肯定)?(?:${controlledAction})`,
    "u",
  );
  const englishTargets = names.length > 0 ? names.join("|") : "they|he|she";
  const englishAttempt = new RegExp(
    `\\b(?:ask|invite|request|suggest|try to persuade)\\b[^.!?]{0,48}(?:${englishTargets}|they|he|she)[^.!?]{0,64}`,
    "giu",
  );
  const englishCoercive = new RegExp(
    `\\b(?:force|command|make|control)\\b[^.!?]{0,40}(?:${englishTargets}|they|he|she)[^.!?]{0,40}\\b(?:follow|leave|move|agree|admit|answer|reply|hand over|be hurt|attack|support|oppose|apologize)\\b`,
    "iu",
  );
  const englishAsserted = new RegExp(
    `(?:${englishTargets}|they|he|she)[^.!?]{0,24}\\b(?:leaves?|moves?|follows?|agrees?|admits?|answers?|replies?|hands? over|takes?|holds?|is hurt|falls?|attacks?|supports?|opposes?|apologizes?)\\b`,
    "iu",
  );
  const residualInput = actionableInput
    .replace(interactionAttemptClause, "")
    .replace(targetFirstAttemptClause, "")
    .replace(englishAttempt, "");
  if (
    coercive.test(actionableInput) ||
    substituted.test(actionableInput) ||
    assertedAfterAttempt.test(actionableInput) ||
    assertedOutcome.test(residualInput) ||
    englishCoercive.test(actionableInput) ||
    englishAsserted.test(residualInput)
  ) {
    return "输入替其他角色决定了行动、回应或立场";
  }
  return null;
}

function shortWorldPhrase(value, maximum = 48) {
  const normalized = String(value ?? "")
    .replace(/[\r\n]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized.length > maximum
    ? `${normalized.slice(0, maximum)}…`
    : normalized;
}

function pair(a, b) {
  return a < b ? [a, b] : [b, a];
}

function petView(row) {
  return {
    id: row.id,
    name: row.name,
    bio: row.bio,
  };
}

function spaceView(row) {
  const localCodexHost = row.world_runtime_platform_mode === "local_codex";
  const officialMetadata = OFFICIAL_WORLD_BY_ID.get(row.id);
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    description: row.description,
    tags: parseTags(row.tags_json),
    category: officialMetadata?.category ?? null,
    shortcut: officialMetadata?.shortcut ?? `/world ${row.id}`,
    visibility: row.visibility,
    join_policy: row.join_policy,
    friend_policy: row.friend_policy,
    governance: row.governance,
    profile_version: row.profile_version ?? 1,
    spec_version: row.current_spec_version ?? row.current_rule_version,
    rule_version: row.current_rule_version,
    delivery_mode: row.delivery_mode ?? "legacy_broadcast",
    publication_status: row.publication_status,
    definition_text: row.spec_definition_text ?? row.definition_text ?? "",
    entry_prompt: row.entry_prompt ?? "",
    host_prompt: row.host_prompt ?? "",
    resolution_mode: row.resolution_mode ?? "direct",
    world_agent:
      row.world_agent_id === undefined
        ? undefined
        : {
            id: row.world_agent_id,
            role: row.world_agent_kind ?? "host",
            runtime_role: row.world_agent_role ?? "referee",
            status: row.world_agent_status ?? "active",
            policy_version: Number(row.world_agent_policy_version ?? 1),
            version: Number(row.world_agent_current_version ?? 1),
            name: row.world_agent_display_name ?? "世界主持",
            world_role: row.world_agent_world_role ?? "host",
            created_by_agent_id: row.world_agent_created_by_agent_id ?? null,
            capabilities:
              row.world_agent_capabilities_json === undefined
                ? WORLD_HOST_CAPABILITIES
                : parseJsonArray(row.world_agent_capabilities_json),
            proactivity: row.world_agent_proactivity ?? "balanced",
            participation_policy:
              row.world_agent_participation_policy_json === undefined
                ? DEFAULT_WORLD_PARTICIPATION_POLICY
                : normalizeParticipationPolicy(
                    parseJsonObject(row.world_agent_participation_policy_json),
                  ),
            evolution_policy:
              row.world_agent_evolution_policy_json === undefined
                ? DEFAULT_WORLD_EVOLUTION_POLICY
                : normalizeEvolutionPolicy(
                    parseJsonObject(row.world_agent_evolution_policy_json),
                  ),
          },
    host_runtime:
      row.world_runtime_status === undefined
        ? undefined
        : {
            status: row.world_runtime_status,
            availability:
              row.world_runtime_status === "active" ? "live" : "on_demand",
            active_executor:
              row.world_runtime_active_executor ?? "platform",
            engine:
              row.world_runtime_active_executor === "creator_codex"
                ? "creator_codex"
                : localCodexHost
                  ? "local_codex_world_host"
                : officialMetadata
                  ? "platform_policy_v2"
                  : "platform_policy_v1",
            model_backed:
              row.world_runtime_active_executor === "creator_codex" ||
              localCodexHost,
            context_isolation: localCodexHost
              ? "one_fresh_thread_per_turn"
              : null,
            judgement_contract_version:
              row.world_runtime_active_executor === "creator_codex" ||
              localCodexHost ||
              officialMetadata
                ? 2
                : 1,
            structured_state:
              row.world_runtime_active_executor === "creator_codex" ||
              localCodexHost ||
              Boolean(officialMetadata),
            active_member_count: Number(row.present_count ?? 0),
            creator_takeover_available: true,
          },
    published_at: row.published_at ?? null,
    ...(row.rules_text === undefined ? {} : { rules_text: row.rules_text }),
    ...(row.member_count === undefined
      ? {}
      : { member_count: Number(row.member_count) }),
    ...(row.present_count === undefined
      ? {}
      : { present_count: Number(row.present_count) }),
  };
}

function eventView(row) {
  return {
    sequence: Number(row.sequence),
    id: row.id,
    world_id: row.space_id,
    scene_id: row.scene_id ?? null,
    actor_type: row.actor_type,
    actor:
      row.actor_pet_id && row.actor_name
        ? { id: row.actor_pet_id, name: row.actor_name }
        : null,
    event_class: row.event_class,
    event_type: row.event_type,
    body_text: row.body_text,
    payload: parseJsonObject(row.payload_json),
    causation_event_id: row.causation_event_id ?? null,
    correlation_id: row.correlation_id ?? null,
    visibility: row.visibility,
    spec_version: row.spec_version,
    created_at: row.created_at,
  };
}

export class SocialService {
  constructor(db, actorKey, options = {}) {
    this.db = db;
    this.actorKey = text(actorKey, "actor key", { min: 1, max: 200 });
    this.sharedIdentity = options.identitySchema === "shared";
    this.petNameColumn = this.sharedIdentity ? "display_name" : "name";
    this.principalUserId = optionalText(
      options.principalUserId ?? this.actorKey,
      "principal user id",
      { min: 1, max: 200 },
    );
    this.principalSessionId = optionalText(
      options.principalSessionId ?? "default",
      "principal session id",
      { min: 1, max: 200 },
    );
    this.officialHostPrincipalUserIds = new Set(
      Array.from(options.officialHostPrincipalUserIds ?? [], (principalUserId) =>
        text(principalUserId, "official Host principal user id", {
          min: 1,
          max: 200,
        }),
      ),
    );
    this.platformHostMode =
      options.platformHostMode === "local_codex"
        ? "local_codex"
        : "deterministic";
    this.platformHostExecutor = options.platformHostExecutor === true;
  }

  getOrCreatePet({ name, bio = "" }) {
    if (this.sharedIdentity) return petView(this.requirePet());
    const existing = this.db
      .prepare("SELECT * FROM pets WHERE account_key = ?")
      .get(this.actorKey);
    if (existing) return petView(existing);

    const normalizedName = text(name, "name", { min: 1, max: 40 });
    const normalizedBio = text(bio, "bio", { max: 240 });
    const timestamp = now();
    const id = randomUUID();

    try {
      this.db
        .prepare(`
          INSERT INTO pets (id, account_key, name, bio, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(id, this.actorKey, normalizedName, normalizedBio, timestamp, timestamp);
    } catch (error) {
      if (String(error.message).includes("pets.name")) {
        fail("NAME_TAKEN", "That World nickname is already in use.");
      }
      throw error;
    }

    this.audit(id, "pet.created", "pet", id);
    return petView(this.requirePet());
  }

  getProfile() {
    return petView(this.requirePet());
  }

  updateProfile({ name, bio }) {
    if (name === undefined && bio === undefined) {
      fail("INVALID_ARGUMENT", "Provide name or bio.");
    }
    const actor = this.requirePet();
    const normalizedName = optionalText(name, "name", { min: 1, max: 40 });
    const normalizedBio = optionalText(bio, "bio", { max: 240 });

    try {
      if (this.sharedIdentity) {
        this.db
          .prepare(`
            UPDATE pets
            SET display_name = COALESCE(?, display_name),
              bio = COALESCE(?, bio), updated_at = ?
            WHERE id = ?
          `)
          .run(
            normalizedName ?? null,
            normalizedBio ?? null,
            Date.now(),
            actor.id,
          );
      } else {
        this.db
          .prepare(`
            UPDATE pets
            SET name = COALESCE(?, name), bio = COALESCE(?, bio), updated_at = ?
            WHERE id = ?
          `)
          .run(normalizedName ?? null, normalizedBio ?? null, now(), actor.id);
      }
    } catch (error) {
      if (String(error.message).includes("pets.name")) {
        fail("NAME_TAKEN", "That World nickname is already in use.");
      }
      throw error;
    }

    this.audit(actor.id, "pet.updated", "pet", actor.id);
    return petView(this.requirePet());
  }

  searchSpaces({ query = "", limit = 20 } = {}) {
    const requestedQuery = text(query, "query", { max: 100 });
    const shortcutMatch = requestedQuery.match(/^\/world\s+([a-z0-9-]+)$/iu);
    const shortcutWorld = OFFICIAL_WORLD_BY_SLUG.get(
      shortcutMatch?.[1]?.toLocaleLowerCase() ??
        requestedQuery.toLocaleLowerCase(),
    );
    const shortcutWorldId = shortcutWorld?.id ?? "";
    const normalizedQuery = shortcutWorld ? "" : requestedQuery;
    const boundedLimit = integer(limit, "limit", { min: 1, max: 50 });
    const fetchLimit = boundedLimit + 1;
    const pattern = `%${normalizedQuery}%`;
    const timestamp = now();
    const runtimeWorlds = this.db
      .prepare("SELECT space_id FROM world_host_runtimes")
      .all();
    for (const row of runtimeWorlds) {
      this.reconcileWorldHostRuntime(row.space_id, timestamp);
    }
    const rows = this.db
      .prepare(`
        SELECT s.*, ws.definition_text AS spec_definition_text,
          ws.entry_prompt, ws.host_prompt, ws.resolution_mode,
          runtime.status AS world_runtime_status,
          runtime.active_executor AS world_runtime_active_executor,
          (SELECT COUNT(*) FROM space_memberships m
            WHERE m.space_id = s.id AND m.status = 'active') AS member_count,
          (SELECT COUNT(*)
            FROM presence live_presence
            WHERE live_presence.space_id = s.id
          ) AS present_count
        FROM spaces s
        LEFT JOIN world_spec_versions ws
          ON ws.space_id = s.id AND ws.version = s.current_spec_version
        LEFT JOIN world_agents agent ON agent.space_id = s.id
        LEFT JOIN world_host_runtimes runtime
          ON runtime.world_agent_id = agent.id
        WHERE s.publication_status = 'published'
          AND (
            (
              s.visibility = 'public'
              AND (
                (? <> '' AND s.id = ?)
                OR (
                  ? = ''
                  AND (
                    ? = ''
                    OR s.name LIKE ? COLLATE NOCASE
                    OR s.description LIKE ? COLLATE NOCASE
                    OR s.tags_json LIKE ? COLLATE NOCASE
                  )
                )
              )
            )
            OR (
              s.visibility = 'hidden'
              AND s.join_policy = 'open'
              AND ? <> ''
              AND s.id = ?
            )
          )
        ORDER BY
          CASE WHEN s.kind = 'official' THEN 0 ELSE 1 END,
          CASE s.id
            ${OFFICIAL_WORLD_ORDER_SQL}
            ELSE ${OFFICIAL_WORLDS.length}
          END,
          present_count DESC,
          s.updated_at DESC
        LIMIT ?
      `)
      .all(
        shortcutWorldId,
        shortcutWorldId,
        shortcutWorldId,
        normalizedQuery,
        pattern,
        pattern,
        pattern,
        requestedQuery,
        requestedQuery,
        fetchLimit,
      );
    const hasMore = rows.length > boundedLimit;
    const visibleRows = rows.slice(0, boundedLimit);
    return {
      spaces: visibleRows.map((row) =>
        spaceView({
          ...row,
          world_runtime_platform_mode: this.platformHostMode,
        }),
      ),
      has_more: hasMore,
    };
  }

  searchWorlds(options = {}) {
    const { spaces, has_more: hasMore } = this.searchSpaces(options);
    return { worlds: spaces, has_more: hasMore };
  }

  getSpace({ spaceId }) {
    return this.getWorld({ worldId: spaceId });
  }

  getWorld({ worldId }) {
    const space = this.requireSpace(worldId);
    const actor = this.requirePet();
    const membership = this.membership(space.id, actor.id);
    const canManage = this.canManage(space, actor.id);
    const hasInvitation = Boolean(
      this.db
        .prepare(`
          SELECT 1 FROM space_invitations
          WHERE space_id = ? AND invitee_pet_id = ? AND status = 'pending'
        `)
        .get(space.id, actor.id),
    );
    if (space.publication_status !== "published" && !canManage) {
      fail("NOT_FOUND", "World not found.");
    }
    if (
      space.visibility !== "public" &&
      !(space.visibility === "hidden" && space.join_policy === "open") &&
      !canManage &&
      !hasInvitation &&
      (!membership || !["pending", "active"].includes(membership.status))
    ) {
      fail("NOT_FOUND", "World not found.");
    }
    this.reconcileWorldHostRuntime(space.id);
    return {
      ...this.spaceDetails(space.id),
      membership: membership ? this.membershipView(membership) : null,
    };
  }

  listWorldBuilderTemplates() {
    const platformAgent = this.db
      .prepare(`
        SELECT id, name, status, policy_version
        FROM platform_agents
        WHERE id = ?
      `)
      .get(PLATFORM_WORLD_BUILDER_ID);
    if (!platformAgent || platformAgent.status !== "active") {
      fail("WORLD_BUILDER_UNAVAILABLE", "The World Builder Agent is unavailable.");
    }
    const templates = this.db
      .prepare(`
        SELECT *
        FROM world_agent_templates
        WHERE status = 'active'
        ORDER BY id
      `)
      .all()
      .map(templateView);
    return {
      platform_agent: {
        id: platformAgent.id,
        name: platformAgent.name,
        policy_version: Number(platformAgent.policy_version),
      },
      templates,
    };
  }

  selectWorldAgentTemplateId(briefText) {
    const brief = String(briefText ?? "").toLocaleLowerCase();
    if (
      /后室|阈限|异常空间|无限走廊|迷失空间|backrooms|liminal|anomalous space/u.test(brief)
    ) {
      return "anomaly-director";
    }
    if (
      /悬疑|推理|谜题|案件|调查|线索|证据|mystery|detective/u.test(brief)
    ) {
      return "mystery-director";
    }
    if (
      /生存|经营|资源|生产|建设|基地|避难所|殖民|农场|survival|management|colony/u.test(brief)
    ) {
      return "survival-director";
    }
    if (
      /任务|冒险|探索|地下城|公会|战斗|成长|rpg|quest|adventure|dungeon/u.test(brief)
    ) {
      return "quest-director";
    }
    if (
      /社交|小镇|社区|邻里|广场|学校|公寓|交友|social|town|community/u.test(brief)
    ) {
      return "social-director";
    }
    return "general-referee";
  }

  startWorldBuild({
    briefText = "",
    templateId,
    artifact,
  } = {}) {
    const actor = this.requirePet();
    const normalizedBrief = text(briefText, "world brief", { max: 4000 });
    const selectedTemplateId =
      templateId ?? this.selectWorldAgentTemplateId(normalizedBrief);
    const template = this.requireWorldAgentTemplate(selectedTemplateId);
    const platformAgent = this.db
      .prepare("SELECT status, policy_version FROM platform_agents WHERE id = ?")
      .get(PLATFORM_WORLD_BUILDER_ID);
    if (!platformAgent || platformAgent.status !== "active") {
      fail("WORLD_BUILDER_UNAVAILABLE", "The World Builder Agent is unavailable.");
    }
    const builderPolicyVersion = Number(platformAgent.policy_version);
    const templateHost = parseJsonObject(template.referee_defaults_json);
    const family =
      templateHost.judgementPolicy?.world_mechanics?.family ?? "general";
    const baseArtifact = {
      world: {
        name: "",
        description: normalizedBrief.slice(0, 500),
        tags: [],
        ...parseJsonObject(template.world_defaults_json),
        rulesText: "",
        definitionText: normalizedBrief,
      },
      host: templateHost,
    };
    const suppliedArtifact =
      artifact === undefined
        ? {}
        : jsonObject(artifact, "world build artifact", { max: 64_000 });
    if (suppliedArtifact.host === undefined && suppliedArtifact.referee) {
      suppliedArtifact.host = suppliedArtifact.referee;
      delete suppliedArtifact.referee;
    }
    const nextArtifact = compileWorldPackage({
      briefText: normalizedBrief,
      templateId: template.id,
      family,
      baseArtifact,
      suppliedArtifact,
    });
    const validation = {
      ...this.validateWorldBuildArtifact(nextArtifact),
      template_selection: {
        template_id: template.id,
        source: templateId === undefined ? "inferred_from_brief" : "creator",
      },
    };
    const id = `world-build:${randomUUID()}`;
    const timestamp = now();

    withTransaction(this.db, () => {
      this.db
        .prepare(`
          INSERT INTO world_build_sessions (
            id, creator_pet_id, principal_user_id, platform_agent_id,
            platform_agent_policy_version, template_id, status, origin_type,
            version, brief_text,
            artifact_json, validation_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'builder', 1, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          actor.id,
          this.principalUserId,
          PLATFORM_WORLD_BUILDER_ID,
          builderPolicyVersion,
          template.id,
          validation.readiness === "ready" ? "validated" : "draft",
          normalizedBrief,
          JSON.stringify(nextArtifact),
          JSON.stringify(validation),
          timestamp,
          timestamp,
        );
      this.db
        .prepare(`
          INSERT INTO world_build_artifacts (
            id, session_id, version, artifact_json, validation_json,
            created_by_platform_agent_id,
            created_by_platform_agent_policy_version, created_at
          ) VALUES (?, ?, 1, ?, ?, ?, ?, ?)
        `)
        .run(
          `${id}:1`,
          id,
          JSON.stringify(nextArtifact),
          JSON.stringify(validation),
          PLATFORM_WORLD_BUILDER_ID,
          builderPolicyVersion,
          timestamp,
        );
      this.audit(actor.id, "world_build.started", "world_build", id, {
        template_id: template.id,
        validation_valid: validation.valid,
      });
    });
    return this.getWorldBuild({ buildId: id });
  }

  getWorldBuild({ buildId }) {
    const actor = this.requirePet();
    const row = this.requireWorldBuild(buildId);
    if (row.creator_pet_id !== actor.id) {
      fail("NOT_FOUND", "World build not found.");
    }
    return buildSessionView(row);
  }

  worldRefinementReport({ worldId }) {
    const actor = this.requirePet();
    const world = this.requireSpace(worldId);
    this.requireManager(world, actor.id);
    const host = hostConfigView(this.currentWorldHostConfig(world.id));
    const mechanics = host.judgement_policy?.world_mechanics ?? {};
    const signalRows = this.db
      .prepare(`
        SELECT signal_kind, COUNT(*) AS occurrences, SUM(weight) AS score,
          MAX(created_at) AS latest_at
        FROM world_runtime_signals
        WHERE space_id = ?
        GROUP BY signal_kind
        ORDER BY score DESC, signal_kind ASC
      `)
      .all(world.id)
      .map((row) => ({
        kind: row.signal_kind,
        occurrences: Number(row.occurrences),
        score: Number(row.score),
        latest_at: row.latest_at,
      }));
    const recentDirectorTurns = this.db
      .prepare(`
        SELECT selected_beat_id, COUNT(*) AS uses
        FROM (
          SELECT selected_beat_id
          FROM world_director_turns
          WHERE space_id = ? AND selected_beat_id IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 12
        )
        GROUP BY selected_beat_id
        ORDER BY uses DESC, selected_beat_id ASC
      `)
      .all(world.id)
      .map((row) => ({ beat_id: row.selected_beat_id, uses: Number(row.uses) }));
    const repeatedBeat = recentDirectorTurns.find((item) => item.uses >= 3);
    const score = (kind) =>
      signalRows.find((signal) => signal.kind === kind)?.score ?? 0;
    const proposals = [];
    if (score("action_friction") >= 2) {
      proposals.push({
        id: "clarify-action-contract",
        reason: "玩家多次需要澄清或行动被拒绝。",
        target_path: "host.judgementPolicy.world_mechanics.beat_library",
        operation: "append",
        value: {
          id: "friction-recovery",
          trigger: "repeated_clarification",
          scene: "Host 复述可执行边界，并把原意缩小为一个仍有价值的本轮行动。",
          choices: ["按缩小目标继续", "补充缺失条件", "选择同价值旁路"],
          outcome: ["clarified_intent", "thread_progress"],
          hook: "保留玩家原目标作为后续线程",
        },
      });
    }
    if (score("missing_followup") >= 2) {
      proposals.push({
        id: "require-public-followup",
        reason: "多次有效行动没有产生可续接钩子。",
        target_path: "host.facilitationPolicy.content_loop.min_public_followups",
        operation: "replace",
        value: Math.max(1, Number(host.facilitation_policy?.content_loop?.min_public_followups ?? 1)),
      });
    }
    if (score("scene_repetition") >= 2 || repeatedBeat) {
      proposals.push({
        id: "expand-beat-variation",
        reason: repeatedBeat
          ? `最近导演回合重复使用 Beat“${repeatedBeat.beat_id}”${repeatedBeat.uses} 次。`
          : "运行记录显示场景或冲突模式重复。",
        target_path: "host.judgementPolicy.world_mechanics.event_generator.rules",
        operation: "append",
        value: "连续两次不得复用相同地点、阻力、在场角色与结果组合。",
      });
    }
    if (score("stale_or_expired") >= 2) {
      proposals.push({
        id: "add-asynchronous-side-door",
        reason: "多人异步输入多次因状态变化失效。",
        target_path: "host.judgementPolicy.population_policy.late_join",
        operation: "review",
        value: "为依赖旧状态的玩家保留原意，改接当前线程的旁路目标。",
      });
    }
    return {
      world_id: world.id,
      world_name: world.name,
      family: mechanics.family ?? "general",
      signals: signalRows,
      director_usage: recentDirectorTurns,
      proposals,
      creator_confirmation_required: true,
      auto_apply: false,
      next_cycle:
        proposals.length > 0
          ? "creator_reviews_patch_then_versions_world_and_host"
          : "continue_observing_real_play",
    };
  }

  updateWorldBuild({
    buildId,
    expectedVersion,
    briefText,
    artifact,
  }) {
    const actor = this.requirePet();
    const current = this.requireWorldBuild(buildId);
    if (current.creator_pet_id !== actor.id) {
      fail("NOT_FOUND", "World build not found.");
    }
    if (["materialized", "cancelled"].includes(current.status)) {
      fail("WORLD_BUILD_CLOSED", "This world build can no longer be edited.");
    }
    integer(expectedVersion, "expected build version", { min: 1 });
    if (Number(current.version) !== expectedVersion) {
      fail("WORLD_BUILD_VERSION_MISMATCH", "The world build has changed.", {
        current_version: Number(current.version),
      });
    }
    if (briefText === undefined && artifact === undefined) {
      fail("INVALID_ARGUMENT", "Provide a brief or artifact change.");
    }
    const nextBrief =
      briefText === undefined
        ? current.brief_text
        : text(briefText, "world brief", { max: 4000 });
    const template = this.requireWorldAgentTemplate(current.template_id);
    const templateHost = parseJsonObject(template.referee_defaults_json);
    const family =
      templateHost.judgementPolicy?.world_mechanics?.family ?? "general";
    const rawArtifact = artifact === undefined
      ? parseJsonObject(current.artifact_json)
      : jsonObject(artifact, "world build artifact", { max: 64_000 });
    const nextArtifact = compileWorldPackage({
      briefText: nextBrief,
      templateId: template.id,
      family,
      baseArtifact: rawArtifact,
      suppliedArtifact: artifact === undefined ? {} : rawArtifact,
    });
    const validation = this.validateWorldBuildArtifact(nextArtifact);
    const nextVersion = Number(current.version) + 1;
    const timestamp = now();
    withTransaction(this.db, () => {
      const result = this.db
        .prepare(`
          UPDATE world_build_sessions
          SET version = ?, status = ?, brief_text = ?, artifact_json = ?,
            validation_json = ?, updated_at = ?
          WHERE id = ? AND version = ?
        `)
        .run(
          nextVersion,
          validation.readiness === "ready" ? "validated" : "draft",
          nextBrief,
          JSON.stringify(nextArtifact),
          JSON.stringify(validation),
          timestamp,
          current.id,
          expectedVersion,
        );
      if (result.changes !== 1) {
        fail("WORLD_BUILD_VERSION_MISMATCH", "The world build has changed.");
      }
      this.db
        .prepare(`
          INSERT INTO world_build_artifacts (
            id, session_id, version, artifact_json, validation_json,
            created_by_platform_agent_id,
            created_by_platform_agent_policy_version, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          `${current.id}:${nextVersion}`,
          current.id,
          nextVersion,
          JSON.stringify(nextArtifact),
          JSON.stringify(validation),
          PLATFORM_WORLD_BUILDER_ID,
          Number(current.captured_platform_agent_policy_version ?? 1),
          timestamp,
        );
      this.audit(actor.id, "world_build.updated", "world_build", current.id, {
        version: nextVersion,
        validation_valid: validation.valid,
      });
    });
    return this.getWorldBuild({ buildId: current.id });
  }

  materializeWorldBuild({ buildId, expectedVersion, confirmed = false }) {
    const actor = this.requirePet();
    const current = this.requireWorldBuild(buildId);
    if (current.creator_pet_id !== actor.id) {
      fail("NOT_FOUND", "World build not found.");
    }
    if (confirmed !== true) {
      fail(
        "CREATOR_CONFIRMATION_REQUIRED",
        "Explicit creator confirmation is required before creating the world.",
      );
    }
    integer(expectedVersion, "expected build version", { min: 1 });
    if (Number(current.version) !== expectedVersion) {
      fail("WORLD_BUILD_VERSION_MISMATCH", "The world build has changed.", {
        current_version: Number(current.version),
      });
    }
    if (current.status === "materialized") {
      return {
        build: buildSessionView(current),
        world: this.spaceDetails(current.world_id),
      };
    }
    if (current.status === "cancelled") {
      fail("WORLD_BUILD_CLOSED", "This world build has been cancelled.");
    }
    const artifact = parseJsonObject(current.artifact_json);
    const validation = this.validateWorldBuildArtifact(artifact);
    if (!validation.valid || validation.readiness !== "ready") {
      fail(
        "WORLD_BUILD_INVALID",
        "Resolve all required World Builder experience checks first.",
        { validation },
      );
    }
    const normalized = this.normalizeWorldDraft(artifact.world);
    const referee = this.normalizeRefereeSpec(
      artifact.host ?? artifact.referee,
    );
    const worldId = randomUUID();
    const timestamp = now();
    const packageMetadata = parseJsonObject(artifact.worldPackage);
    const upgradedFrom = Number(
      parseJsonObject(packageMetadata.compatibility)
        .upgraded_from_compiler_version ?? 0,
    );
    const deliveryMode =
      Number(packageMetadata.compiler_version) >= 3 &&
      !(upgradedFrom > 0 && upgradedFrom < 3)
        ? "relevance_routed"
        : "legacy_broadcast";
    withTransaction(this.db, () => {
      this.insertWorldDraft({
        id: worldId,
        actor,
        normalized,
        referee,
        buildSessionId: current.id,
        deliveryMode,
        timestamp,
      });
      const result = this.db
        .prepare(`
          UPDATE world_build_sessions
          SET status = 'materialized', validation_json = ?, world_id = ?,
            updated_at = ?, confirmed_at = ?, materialized_at = ?
          WHERE id = ? AND version = ? AND status IN ('draft', 'validated')
        `)
        .run(
          JSON.stringify(validation),
          worldId,
          timestamp,
          timestamp,
          timestamp,
          current.id,
          expectedVersion,
        );
      if (result.changes !== 1) {
        fail("WORLD_BUILD_VERSION_MISMATCH", "The world build has changed.");
      }
      this.db
        .prepare(`
          UPDATE world_build_artifacts
          SET creator_confirmed_at = ?
          WHERE session_id = ? AND version = ?
        `)
        .run(timestamp, current.id, expectedVersion);
      this.audit(actor.id, "world_build.materialized", "world_build", current.id, {
        world_id: worldId,
      });
    });
    return {
      build: this.getWorldBuild({ buildId: current.id }),
      world: this.spaceDetails(worldId),
    };
  }

  createWorld(options) {
    const actor = this.requirePet();
    const normalized = this.normalizeWorldDraft(options);
    const template = this.requireWorldAgentTemplate("general-referee");
    const referee = this.normalizeRefereeSpec(
      parseJsonObject(template.referee_defaults_json),
    );
    const id = randomUUID();
    const buildId = `world-build:${id}`;
    const timestamp = now();
    const artifact = compileWorldPackage({
      briefText: normalized.description || normalized.definitionText,
      templateId: template.id,
      family: "general",
      baseArtifact: { world: normalized, host: referee },
      source: "legacy",
    });
    const validation = this.validateWorldBuildArtifact(artifact);
    const builderPolicyVersion = Number(
      this.db
        .prepare("SELECT policy_version FROM platform_agents WHERE id = ?")
        .get(PLATFORM_WORLD_BUILDER_ID).policy_version,
    );
    withTransaction(this.db, () => {
      this.db
        .prepare(`
          INSERT INTO world_build_sessions (
            id, creator_pet_id, principal_user_id, platform_agent_id,
            platform_agent_policy_version, template_id, status, origin_type,
            version, brief_text,
            artifact_json, validation_json, created_at, updated_at,
            confirmed_at, materialized_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'materialized', 'legacy', 1, ?, ?, ?,
            ?, ?, ?, ?)
        `)
        .run(
          buildId,
          actor.id,
          this.principalUserId,
          PLATFORM_WORLD_BUILDER_ID,
          builderPolicyVersion,
          template.id,
          normalized.description || normalized.definitionText,
          JSON.stringify(artifact),
          JSON.stringify(validation),
          timestamp,
          timestamp,
          timestamp,
          timestamp,
        );
      this.db
        .prepare(`
          INSERT INTO world_build_artifacts (
            id, session_id, version, artifact_json, validation_json,
            created_by_platform_agent_id,
            created_by_platform_agent_policy_version, creator_confirmed_at,
            created_at
          ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          `${buildId}:1`,
          buildId,
          JSON.stringify(artifact),
          JSON.stringify(validation),
          PLATFORM_WORLD_BUILDER_ID,
          builderPolicyVersion,
          timestamp,
          timestamp,
        );
      this.insertWorldDraft({
        id,
        actor,
        normalized,
        referee,
        buildSessionId: buildId,
        timestamp,
      });
      this.db
        .prepare(`
          UPDATE world_build_sessions SET world_id = ? WHERE id = ?
        `)
        .run(id, buildId);
    });
    return this.spaceDetails(id);
  }

  normalizeWorldDraft({
    name,
    description = "",
    tags = [],
    visibility = "public",
    joinPolicy = "open",
    friendPolicy = "enabled",
    rulesText,
    definitionText,
    entryPrompt = "",
    hostPrompt = "",
    resolutionMode = "direct",
    initialWorldState = {},
    initialMemberState = {},
  }) {
    return {
      name: text(name, "name", { min: 1, max: 80 }),
      description: text(description, "description", { max: 500 }),
      tags: normalizeTags(tags),
      visibility: enumValue(visibility, "visibility", SPACE_VISIBILITIES),
      joinPolicy: enumValue(joinPolicy, "join policy", JOIN_POLICIES),
      friendPolicy: enumValue(friendPolicy, "friend policy", FRIEND_POLICIES),
      rulesText: text(rulesText, "rules text", { min: 1, max: 4000 }),
      definitionText: text(definitionText, "world definition", {
        min: 1,
        max: 12_000,
      }),
      entryPrompt: text(entryPrompt, "entry prompt", { max: 4000 }),
      hostPrompt: text(hostPrompt, "host prompt", { max: 8000 }),
      resolutionMode: enumValue(
        resolutionMode,
        "resolution mode",
        RESOLUTION_MODES,
      ),
      initialWorldState: jsonObject(initialWorldState, "initial world state"),
      initialMemberState: jsonObject(initialMemberState, "initial member state"),
    };
  }

  normalizeRefereeSpec({
    name = "世界主持",
    agentKind = "host",
    worldRole = "host",
    participationPolicy = DEFAULT_WORLD_PARTICIPATION_POLICY,
    evolutionPolicy = DEFAULT_WORLD_EVOLUTION_POLICY,
    capabilities = WORLD_HOST_CAPABILITIES,
    personaText =
      "保持中立、可解释和一致，帮助成员参与并依据当前世界规则裁决。",
    speakingStyle = "简洁、清晰，并提供可选下一步。",
    judgementPolicy = {},
    memoryPolicy = {},
    outputSchema = {},
    modelConfig = { mode: "platform_default" },
    toolAllowlist = [],
    onboardingPolicy = {},
    facilitationPolicy = {},
    recapPolicy = { enabled: true, max_events: 3 },
    proactivity = "balanced",
  } = {}) {
    if (!Array.isArray(toolAllowlist)) {
      fail("INVALID_ARGUMENT", "World Host tool allowlist must be an array.");
    }
    const normalizedTools = [
      ...new Set(
        toolAllowlist.map((tool) =>
          text(tool, "World Host tool", { min: 1, max: 120 }),
        ),
      ),
    ];
    if (normalizedTools.some((tool) => !tool.startsWith("world:"))) {
      fail(
        "EXTERNAL_TOOL_NOT_ALLOWED",
        "World Host Agents may only use world-scoped tools.",
      );
    }
    if (!Array.isArray(capabilities)) {
      fail("INVALID_ARGUMENT", "World Host capabilities must be an array.");
    }
    const normalizedCapabilities = [
      ...new Set(
        capabilities.map((capability) =>
          text(capability, "World Host capability", { min: 1, max: 80 }),
        ),
      ),
    ];
    const unsupportedCapabilities = normalizedCapabilities.filter(
      (capability) => !WORLD_HOST_CAPABILITIES.includes(capability),
    );
    if (unsupportedCapabilities.length > 0) {
      fail(
        "INVALID_ARGUMENT",
        `Unsupported World Host capabilities: ${unsupportedCapabilities.join(", ")}.`,
      );
    }
    return {
      name: text(name, "World Host name", { min: 1, max: 80 }),
      agentKind: enumValue(
        agentKind,
        "World Agent kind",
        new Set(["host"]),
      ),
      worldRole: enumValue(
        worldRole,
        "World Host role",
        WORLD_HOST_ROLE_SET,
      ),
      participationPolicy: normalizeParticipationPolicy(participationPolicy),
      evolutionPolicy: normalizeEvolutionPolicy(evolutionPolicy),
      capabilities: normalizedCapabilities,
      personaText: text(personaText, "World Host persona", {
        min: 1,
        max: 8000,
      }),
      speakingStyle: text(speakingStyle, "World Host speaking style", {
        max: 2000,
      }),
      judgementPolicy: jsonObject(
        judgementPolicy,
        "World Host judgement policy",
      ),
      memoryPolicy: jsonObject(memoryPolicy, "World Host memory policy"),
      outputSchema: jsonObject(outputSchema, "World Host output schema"),
      modelConfig: jsonObject(modelConfig, "World Host model config"),
      toolAllowlist: normalizedTools,
      onboardingPolicy: jsonObject(
        onboardingPolicy,
        "World Host onboarding policy",
      ),
      facilitationPolicy: jsonObject(
        facilitationPolicy,
        "World Host facilitation policy",
      ),
      recapPolicy: jsonObject(recapPolicy, "World Host recap policy"),
      proactivity: enumValue(
        proactivity,
        "World Host proactivity",
        new Set(["quiet", "balanced", "active"]),
      ),
    };
  }

  validateWorldBuildArtifact(artifact) {
    const errors = [];
    const warnings = [];
    const missingFields = [];
    const questions = [];
    const experienceChecks = [];
    const addExperienceCheck = (id, status, message) => {
      experienceChecks.push({ id, status, message });
      if (status === "review") warnings.push(message);
    };
    const world =
      artifact && typeof artifact.world === "object" && !Array.isArray(artifact.world)
        ? artifact.world
        : null;
    const host =
      artifact &&
      typeof (artifact.host ?? artifact.referee) === "object" &&
      !Array.isArray(artifact.host ?? artifact.referee)
        ? artifact.host ?? artifact.referee
        : null;
    if (!world) {
      errors.push("artifact.world 必须是一个对象。");
    } else {
      for (const [field, question] of [
        ["name", "这个世界叫什么名字？"],
        ["rulesText", "所有进入者必须遵守哪些规则？"],
        ["definitionText", "这个世界如何运行、如何持续推进？"],
      ]) {
        if (typeof world[field] !== "string" || world[field].trim() === "") {
          missingFields.push(`world.${field}`);
          questions.push(question);
        }
      }
      if (world.tags !== undefined && !Array.isArray(world.tags)) {
        errors.push("world.tags 必须是数组。");
      }
      if (
        world.visibility !== undefined &&
        !SPACE_VISIBILITIES.has(world.visibility)
      ) {
        errors.push("world.visibility 不是支持的可见性。");
      }
      if (
        world.joinPolicy !== undefined &&
        !JOIN_POLICIES.has(world.joinPolicy)
      ) {
        errors.push("world.joinPolicy 不是支持的加入方式。");
      }
      if (
        world.friendPolicy !== undefined &&
        !FRIEND_POLICIES.has(world.friendPolicy)
      ) {
        errors.push("world.friendPolicy 不是支持的好友策略。");
      }
      if (
        world.resolutionMode !== undefined &&
        !RESOLUTION_MODES.has(world.resolutionMode)
      ) {
        errors.push("world.resolutionMode 不是支持的裁决模式。");
      }
      if (!world.hostPrompt) {
        warnings.push("尚未补充专属主持提示，将使用通用主持策略。");
      }
    }
    if (!host) {
      errors.push("artifact.host 必须是一个对象。");
    } else {
      for (const [field, question] of [
        ["name", "这个世界的主持 Agent 叫什么？"],
        ["personaText", "主持应以什么原则和性格工作？"],
      ]) {
        if (typeof host[field] !== "string" || host[field].trim() === "") {
          missingFields.push(`host.${field}`);
          questions.push(question);
        }
      }
      if (
        host.worldRole !== undefined &&
        !WORLD_HOST_ROLE_SET.has(host.worldRole)
      ) {
        errors.push("host.worldRole 不是支持的世界身份。");
      }
      if (
        host.participationPolicy !== undefined &&
        (host.participationPolicy === null ||
          typeof host.participationPolicy !== "object" ||
          Array.isArray(host.participationPolicy) ||
          (host.participationPolicy.mode !== undefined &&
            !PARTICIPATION_MODES.has(host.participationPolicy.mode)))
      ) {
        errors.push("host.participationPolicy 不是支持的参与策略。");
      }
      if (
        host.evolutionPolicy !== undefined &&
        (host.evolutionPolicy === null ||
          typeof host.evolutionPolicy !== "object" ||
          Array.isArray(host.evolutionPolicy) ||
          (host.evolutionPolicy.mode !== undefined &&
            !EVOLUTION_MODES.has(host.evolutionPolicy.mode)))
      ) {
        errors.push("host.evolutionPolicy 不是支持的演进策略。");
      }
      if (
        host.toolAllowlist !== undefined &&
        !Array.isArray(host.toolAllowlist)
      ) {
        errors.push("host.toolAllowlist 必须是数组。");
      } else if (
        host.toolAllowlist?.some(
          (tool) => typeof tool !== "string" || !tool.startsWith("world:"),
        )
      ) {
        errors.push("主持 Agent 只能声明 world: 范围内的工具。");
      }
    }
    if (world && host) {
      const onboarding =
        host.onboardingPolicy && typeof host.onboardingPolicy === "object"
          ? host.onboardingPolicy
          : {};
      const facilitation =
        host.facilitationPolicy && typeof host.facilitationPolicy === "object"
          ? host.facilitationPolicy
          : {};
      const recap =
        host.recapPolicy && typeof host.recapPolicy === "object"
          ? host.recapPolicy
          : {};
      const memory =
        host.memoryPolicy && typeof host.memoryPolicy === "object"
          ? host.memoryPolicy
          : {};
      const judgement =
        host.judgementPolicy && typeof host.judgementPolicy === "object"
          ? host.judgementPolicy
          : {};
      const participation =
        host.participationPolicy &&
        typeof host.participationPolicy === "object" &&
        !Array.isArray(host.participationPolicy)
          ? host.participationPolicy
          : DEFAULT_WORLD_PARTICIPATION_POLICY;
      const evolution =
        host.evolutionPolicy &&
        typeof host.evolutionPolicy === "object" &&
        !Array.isArray(host.evolutionPolicy)
          ? host.evolutionPolicy
          : DEFAULT_WORLD_EVOLUTION_POLICY;
      const starterChoices = Array.isArray(onboarding.starter_choices)
        ? onboarding.starter_choices
        : [];
      const nextActions = Array.isArray(facilitation.next_actions)
        ? facilitation.next_actions
        : [];
      addExperienceCheck(
        "first_time_player",
        starterChoices.length >= 2 && Boolean(onboarding.free_input_prompt)
          ? "pass"
          : "review",
        starterChoices.length >= 2 && Boolean(onboarding.free_input_prompt)
          ? "首访玩家同时拥有明确选项与自由输入出口。"
          : "首访体验需要至少两个明确入口，并保留自由输入出口。",
      );
      addExperienceCheck(
        "late_join_player",
        recap.enabled !== false && memory.retain_events !== false
          ? "pass"
          : "review",
        recap.enabled !== false && memory.retain_events !== false
          ? "Host 能为中途加入者生成世界内回顾。"
          : "中途加入者缺少可用的事件记忆或回顾策略。",
      );
      addExperienceCheck(
        "returning_player",
        evolution.persistence === "persistent" && recap.enabled !== false
          ? "pass"
          : "review",
        evolution.persistence === "persistent" && recap.enabled !== false
          ? "回流玩家可以依据持久状态继续参与。"
          : "回流体验没有同时声明持久状态与回顾策略。",
      );
      addExperienceCheck(
        "multiplayer_transition",
        !participation.multiplayer_enabled ||
          participation.multiplayer_transition !== "disabled"
          ? "pass"
          : "review",
        !participation.multiplayer_enabled ||
          participation.multiplayer_transition !== "disabled"
          ? "多人可用性与切换策略已经声明。"
          : "世界允许多人参与，但没有可执行的多人切换策略。",
      );
      addExperienceCheck(
        "ongoing_loop",
        Boolean(facilitation.objective_text) && nextActions.length > 0
          ? "pass"
          : "review",
        Boolean(facilitation.objective_text) && nextActions.length > 0
          ? "Host 拥有持续目标和下一步行动。"
          : "Host 需要明确持续目标与至少一个后续行动。",
      );
      const directorLoop = Array.isArray(judgement.director_loop)
        ? judgement.director_loop
        : Array.isArray(facilitation.director_loop)
          ? facilitation.director_loop
          : [];
      addExperienceCheck(
        "director_loop",
        directorLoop.length >= 5 ? "pass" : "review",
        directorLoop.length >= 5
          ? "Host 已声明从观察、编排到持久化和续接的完整导演循环。"
          : "Host 需要声明观察、编排场景、裁决、持久化和留下后续钩子的导演循环。",
      );
      const population =
        judgement.population_policy &&
        typeof judgement.population_policy === "object"
          ? judgement.population_policy
          : facilitation.population_policy ?? {};
      const populationViews = [
        "zero_players",
        "one_player",
        "few_players",
        "many_players",
        "late_join",
        "returning",
      ];
      addExperienceCheck(
        "population_scenarios",
        populationViews.every((view) => Boolean(population[view]))
          ? "pass"
          : "review",
        populationViews.every((view) => Boolean(population[view]))
          ? "Host 已覆盖零人、单人、少量玩家、大量玩家、中途加入与回流场景。"
          : "Host 需要补齐不同在线人数、中途加入和回流时的编排策略。",
      );
      const npcPolicy = judgement.npc_policy;
      addExperienceCheck(
        "npc_cast",
        npcPolicy &&
          typeof npcPolicy === "object" &&
          npcPolicy.mode &&
          npcPolicy.separate_agent_default !== undefined
          ? "pass"
          : "review",
        npcPolicy &&
          typeof npcPolicy === "object" &&
          npcPolicy.mode &&
          npcPolicy.separate_agent_default !== undefined
          ? "NPC 补位方式与是否使用独立 Agent 已明确。"
          : "请明确 NPC 由 Host 内嵌扮演还是使用独立 Agent，以及升级边界。",
      );
      const contentLoop = facilitation.content_loop;
      addExperienceCheck(
        "content_refinement_loop",
        contentLoop &&
          typeof contentLoop === "object" &&
          contentLoop.maintain_open_threads === true &&
          Boolean(contentLoop.refinement_signal)
          ? "pass"
          : "review",
        contentLoop &&
          typeof contentLoop === "object" &&
          contentLoop.maintain_open_threads === true &&
          Boolean(contentLoop.refinement_signal)
          ? "Host 会持续维护开放事件，并从真实互动信号中补全世界。"
          : "请声明开放事件维护方式，以及如何利用玩家回避、困惑和高回应内容持续补全世界。",
      );
      const safePatchPolicies = new Set([
        "host_derived",
        "validated_proposal",
        "creator_review",
      ]);
      addExperienceCheck(
        "state_authority",
        safePatchPolicies.has(judgement.state_patch_policy)
          ? "pass"
          : "review",
        safePatchPolicies.has(judgement.state_patch_policy)
          ? "成员状态提案不会未经 Host 验证直接成为世界事实。"
          : "请声明 host_derived、validated_proposal 或 creator_review 状态写入策略。",
      );
      const safetyPriority = Array.isArray(judgement.rule_priority)
        ? judgement.rule_priority
        : [];
      addExperienceCheck(
        "adversarial_input",
        safetyPriority.includes("platform_safety")
          ? "pass"
          : "review",
        safetyPriority.includes("platform_safety")
          ? "Host 的裁决优先级包含平台安全边界。"
          : "Host 的裁决优先级需要明确包含 platform_safety。",
      );
      const definition = [
        world.definitionText ?? "",
        world.rulesText ?? "",
        JSON.stringify(onboarding),
        JSON.stringify(facilitation),
      ].join("\n");
      if (/秘密|隐藏身份|私密|私人|仅自己|hidden|secret/u.test(definition)) {
        addExperienceCheck(
          "information_partition",
          Array.isArray(memory.information_partitions) &&
            memory.information_partitions.length > 0
            ? "pass"
            : "review",
          Array.isArray(memory.information_partitions) &&
            memory.information_partitions.length > 0
            ? "隐藏信息已经声明公开与私人记忆分区。"
            : "世界包含隐藏或私人信息，但尚未声明信息分区策略。",
        );
      }
      if (artifact.worldPackage) {
        const mechanics = judgement.world_mechanics ?? {};
        const requiredModules = [
          "director_abilities",
          "thread_templates",
          "beat_library",
          "event_generator",
          "pacing_model",
          "recovery_model",
          "settlement",
        ];
        addExperienceCheck(
          "compiled_world_package",
          artifact.worldPackage.schema_version === WORLD_PACKAGE_SCHEMA_VERSION &&
            Number.isInteger(artifact.worldPackage.compiler_version) &&
            artifact.worldPackage.compiler_version >= 1 &&
            artifact.worldPackage.compiler_version <= WORLD_BUILDER_COMPILER_VERSION &&
            requiredModules.every((key) => Boolean(mechanics[key]))
            ? "pass"
            : "review",
          artifact.worldPackage.schema_version === WORLD_PACKAGE_SCHEMA_VERSION &&
            Number.isInteger(artifact.worldPackage.compiler_version) &&
            artifact.worldPackage.compiler_version >= 1 &&
            artifact.worldPackage.compiler_version <= WORLD_BUILDER_COMPILER_VERSION &&
            requiredModules.every((key) => Boolean(mechanics[key]))
            ? "World Package 已通过类型判断、世界组合和 Host 模块编译。"
            : "World Package 缺少编译版本或必要的导演运行模块。",
        );
        const beats = Array.isArray(mechanics.beat_library)
          ? mechanics.beat_library
          : [];
        const beatIds = new Set(
          beats
            .map((beat) => beat?.id)
            .filter((id) => typeof id === "string" && id.trim()),
        );
        const openThreads = Array.isArray(
          world.initialWorldState?.world_progress?.open_threads,
        )
          ? world.initialWorldState.world_progress.open_threads
          : [];
        const missingBeatReferences = openThreads.filter(
          (thread) => thread?.beat && !beatIds.has(thread.beat),
        );
        if (beatIds.size !== beats.length) {
          errors.push("Host Beat 库包含缺失或重复的 ID。");
        }
        if (missingBeatReferences.length > 0) {
          errors.push(
            `开放线程引用了不存在的 Beat：${missingBeatReferences
              .map((thread) => `${thread.id ?? "unknown"}->${thread.beat}`)
              .join("、")}。`,
          );
        }
        const simulation = simulateWorldPackage(artifact);
        for (const scenario of simulation.scenarios) {
          addExperienceCheck(
            `simulation_${scenario.id}`,
            scenario.status,
            scenario.message,
          );
        }
      }
    }
    if (missingFields.length > 0) {
      errors.push("仍有创建世界所需的信息未完成。");
    }
    const reviewCount = experienceChecks.filter(
      (check) => check.status === "review",
    ).length;
    return {
      valid: errors.length === 0,
      readiness:
        errors.length > 0 ? "blocked" : reviewCount > 0 ? "review" : "ready",
      errors,
      warnings,
      missing_fields: missingFields,
      questions,
      experience_checks: experienceChecks,
      refinement_loop: {
        status:
          errors.length > 0
            ? "complete_required_fields"
            : reviewCount > 0
              ? "improve_host_contract"
              : "observe_real_play",
        next_questions: [
          ...questions,
          ...experienceChecks
            .filter((check) => check.status === "review")
            .map((check) => check.message),
        ].slice(0, 8),
        runtime_signals: [
          "players_repeat_or_rephrase_action",
          "players_abandon_open_thread",
          "host_repeats_scene_pattern",
          "late_joiner_cannot_find_entry",
          "content_receives_multiple_independent_responses",
        ],
        next_cycle: "summarize_signals_then_propose_creator_confirmed_patch",
      },
    };
  }

  requireWorldAgentTemplate(templateId) {
    const normalizedId = text(templateId, "world agent template id", {
      min: 1,
      max: 100,
    });
    const row = this.db
      .prepare(`
        SELECT * FROM world_agent_templates
        WHERE id = ? AND status = 'active'
      `)
      .get(normalizedId);
    if (!row) {
      fail("NOT_FOUND", "World Agent template not found.");
    }
    return row;
  }

  requireWorldBuild(buildId) {
    const normalizedId = text(buildId, "world build id", {
      min: 1,
      max: 200,
    });
    const row = this.db
      .prepare(`
        SELECT build.*, agent.name AS platform_agent_name,
          build.platform_agent_policy_version
            AS captured_platform_agent_policy_version
        FROM world_build_sessions build
        JOIN platform_agents agent ON agent.id = build.platform_agent_id
        WHERE build.id = ?
      `)
      .get(normalizedId);
    if (!row) fail("NOT_FOUND", "World build not found.");
    return row;
  }

  insertWorldDraft({
    id,
    actor,
    normalized,
    referee,
    buildSessionId,
    deliveryMode = "relevance_routed",
    timestamp,
  }) {
    const worldAgentId = `world-agent:${id}`;
    this.db
      .prepare(`
        INSERT INTO spaces (
          id, kind, name, description, tags_json, visibility, join_policy,
          friend_policy, governance, owner_pet_id, profile_version,
          current_spec_version, current_rule_version, delivery_mode,
          publication_status,
          definition_text, published_at, created_at, updated_at
        ) VALUES (?, 'user', ?, ?, ?, ?, ?, ?, 'owner', ?, 1, 1, 1,
          ?, 'draft', ?, NULL, ?, ?)
      `)
      .run(
        id,
        normalized.name,
        normalized.description,
        JSON.stringify(normalized.tags),
        normalized.visibility,
        normalized.joinPolicy,
        normalized.friendPolicy,
        actor.id,
        deliveryMode,
        normalized.definitionText,
        timestamp,
        timestamp,
      );
    this.db
      .prepare(`
        INSERT INTO world_spec_versions (
          space_id, version, definition_text, entry_prompt, host_prompt,
          resolution_mode, visibility, join_policy, friend_policy,
          created_by_pet_id, created_at
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        normalized.definitionText,
        normalized.entryPrompt,
        normalized.hostPrompt,
        normalized.resolutionMode,
        normalized.visibility,
        normalized.joinPolicy,
        normalized.friendPolicy,
        actor.id,
        timestamp,
      );
    this.db
      .prepare(`
        INSERT INTO world_agents (
          id, space_id, role, status, policy_version, created_by_pet_id,
          created_by_agent_id, current_version, display_name, agent_kind,
          created_at, updated_at
        ) VALUES (?, ?, 'referee', 'active', 1, ?, ?, 1, ?, 'host', ?, ?)
      `)
      .run(
        worldAgentId,
        id,
        actor.id,
        PLATFORM_WORLD_BUILDER_ID,
        referee.name,
        timestamp,
        timestamp,
      );
    this.db
      .prepare(`
        INSERT INTO world_host_runtimes (
          world_agent_id, space_id, execution_policy, status, active_executor,
          runtime_version, activation_count, created_at, updated_at
        ) VALUES (?, ?, 'platform_on_demand_with_creator_takeover', 'idle',
          'platform', 1, 0, ?, ?)
      `)
      .run(worldAgentId, id, timestamp, timestamp);
    this.db
      .prepare(`
        INSERT INTO world_agent_versions (
          world_agent_id, version, display_name, world_role, persona_text,
          speaking_style,
          judgement_policy_json, memory_policy_json, output_schema_json,
          model_config_json, tool_allowlist_json, onboarding_policy_json,
          facilitation_policy_json, recap_policy_json,
          participation_policy_json, evolution_policy_json, proactivity,
          capabilities_json, source_build_session_id, created_by_agent_id,
          created_at
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        worldAgentId,
        referee.name,
        referee.worldRole,
        referee.personaText,
        referee.speakingStyle,
        JSON.stringify(referee.judgementPolicy),
        JSON.stringify(referee.memoryPolicy),
        JSON.stringify(referee.outputSchema),
        JSON.stringify(referee.modelConfig),
        JSON.stringify(referee.toolAllowlist),
        JSON.stringify(referee.onboardingPolicy),
        JSON.stringify(referee.facilitationPolicy),
        JSON.stringify(referee.recapPolicy),
        JSON.stringify(referee.participationPolicy),
        JSON.stringify(referee.evolutionPolicy),
        referee.proactivity,
        JSON.stringify(referee.capabilities),
        buildSessionId,
        PLATFORM_WORLD_BUILDER_ID,
        timestamp,
      );
    this.db
      .prepare(`
        INSERT INTO space_rule_versions (
          space_id, version, rules_text, visibility, join_policy,
          friend_policy, governance, definition_text, created_by_pet_id,
          created_at
        ) VALUES (?, 1, ?, ?, ?, ?, 'owner', ?, ?, ?)
      `)
      .run(
        id,
        normalized.rulesText,
        normalized.visibility,
        normalized.joinPolicy,
        normalized.friendPolicy,
        normalized.definitionText,
        actor.id,
        timestamp,
      );
    this.db
      .prepare(`
        INSERT INTO space_memberships (
          space_id, pet_id, status, accepted_rule_version, application_text,
          created_at, updated_at
        ) VALUES (?, ?, 'active', 1, '', ?, ?)
      `)
      .run(id, actor.id, timestamp, timestamp);
    this.db
      .prepare(`
        INSERT INTO world_states (
          space_id, version, state_json, updated_by_pet_id, updated_at
        ) VALUES (?, 1, ?, ?, ?)
      `)
      .run(
        id,
        JSON.stringify(normalized.initialWorldState),
        actor.id,
        timestamp,
      );
    this.db
      .prepare(`
        INSERT INTO world_member_states (
          space_id, pet_id, version, state_json, updated_by_pet_id, updated_at
        ) VALUES (?, ?, 1, ?, ?, ?)
      `)
      .run(
        id,
        actor.id,
        JSON.stringify(normalized.initialMemberState),
        actor.id,
        timestamp,
      );
    this.insertWorldEvent({
      spaceId: id,
      actorType: "system",
      eventClass: "system",
      eventType: "world.created",
      bodyText: `${normalized.name} 已创建。`,
      payload: {
        build_session_id: buildSessionId,
        world_agent_id: worldAgentId,
        created_by_agent_id: PLATFORM_WORLD_BUILDER_ID,
      },
      specVersion: 1,
      timestamp,
    });
    this.audit(actor.id, "world.created", "world", id, {
      visibility: normalized.visibility,
      join_policy: normalized.joinPolicy,
      build_session_id: buildSessionId,
      created_by_agent_id: PLATFORM_WORLD_BUILDER_ID,
    });
  }

  createSpace(options) {
    return this.createWorld({
      ...options,
      definitionText:
        options.definitionText ??
        options.description ??
        "A creator-defined social world.",
    });
  }

  updateWorld({
    worldId,
    expectedVersion,
    expectedSpecVersion,
    expectedRuleVersion,
    expectedProfileVersion,
    name,
    description,
    tags,
    rulesText,
    definitionText,
    entryPrompt,
    hostPrompt,
    resolutionMode,
    visibility,
    joinPolicy,
    friendPolicy,
  }) {
    const actor = this.requirePet();
    const space = this.requireSpace(worldId);
    if (!this.canManage(space, actor.id)) {
      if (space.publication_status === "draft") {
        fail("NOT_FOUND", "World not found.");
      }
      fail("FORBIDDEN", "World owner or admin permission is required.");
    }
    this.requireRuleManager(space, actor.id);
    const metadataChanged =
      name !== undefined || description !== undefined || tags !== undefined;
    const rulesChanged = rulesText !== undefined;
    const specChanged =
      definitionText !== undefined ||
      entryPrompt !== undefined ||
      hostPrompt !== undefined ||
      resolutionMode !== undefined ||
      visibility !== undefined ||
      joinPolicy !== undefined ||
      friendPolicy !== undefined;
    if (!metadataChanged && !rulesChanged && !specChanged) {
      fail("INVALID_ARGUMENT", "Provide at least one world change.");
    }

    const suppliedSpecVersion = expectedSpecVersion ?? expectedVersion;
    if (suppliedSpecVersion !== undefined) {
      integer(suppliedSpecVersion, "expected spec version", { min: 1 });
      if (space.current_spec_version !== suppliedSpecVersion) {
        fail("SPEC_VERSION_MISMATCH", "The world definition has changed.", {
          current_spec_version: space.current_spec_version,
        });
      }
    } else if (specChanged) {
      fail("INVALID_ARGUMENT", "expected spec version is required.");
    }
    if (rulesChanged && expectedRuleVersion === undefined) {
      fail("INVALID_ARGUMENT", "expected rule version is required.");
    }
    const suppliedRuleVersion = expectedRuleVersion;
    if (suppliedRuleVersion !== undefined) {
      integer(suppliedRuleVersion, "expected rule version", { min: 1 });
      if (space.current_rule_version !== suppliedRuleVersion) {
        fail("RULE_VERSION_MISMATCH", "The member rules have changed.", {
          current_rule_version: space.current_rule_version,
        });
      }
    }
    if (metadataChanged && expectedProfileVersion === undefined) {
      fail("INVALID_ARGUMENT", "expected profile version is required.");
    }
    const suppliedProfileVersion = expectedProfileVersion;
    if (suppliedProfileVersion !== undefined) {
      integer(suppliedProfileVersion, "expected profile version", { min: 1 });
      if (space.profile_version !== suppliedProfileVersion) {
        fail("PROFILE_VERSION_MISMATCH", "The world profile has changed.", {
          current_profile_version: space.profile_version,
        });
      }
    }

    const currentRule = this.currentRule(space.id);
    const currentSpec = this.currentWorldSpec(space.id);
    const next = {
      name:
        name === undefined
          ? space.name
          : text(name, "name", { min: 1, max: 80 }),
      description:
        description === undefined
          ? space.description
          : text(description, "description", { max: 500 }),
      tags: tags === undefined ? parseTags(space.tags_json) : normalizeTags(tags),
      rulesText:
        rulesText === undefined
          ? currentRule.rules_text
          : text(rulesText, "rules text", { min: 1, max: 4000 }),
      definitionText:
        definitionText === undefined
          ? currentSpec.definition_text
          : text(definitionText, "world definition", {
              min: 1,
              max: 12_000,
            }),
      entryPrompt:
        entryPrompt === undefined
          ? currentSpec.entry_prompt
          : text(entryPrompt, "entry prompt", { max: 4000 }),
      hostPrompt:
        hostPrompt === undefined
          ? currentSpec.host_prompt
          : text(hostPrompt, "host prompt", { max: 8000 }),
      resolutionMode:
        resolutionMode === undefined
          ? currentSpec.resolution_mode
          : enumValue(
              resolutionMode,
              "resolution mode",
              RESOLUTION_MODES,
            ),
      visibility:
        visibility === undefined
          ? space.visibility
          : enumValue(visibility, "visibility", SPACE_VISIBILITIES),
      joinPolicy:
        joinPolicy === undefined
          ? space.join_policy
          : enumValue(joinPolicy, "join policy", JOIN_POLICIES),
      friendPolicy:
        friendPolicy === undefined
          ? space.friend_policy
          : enumValue(friendPolicy, "friend policy", FRIEND_POLICIES),
    };
    const nextProfileVersion =
      space.profile_version + (metadataChanged ? 1 : 0);
    const nextSpecVersion =
      space.current_spec_version + (specChanged ? 1 : 0);
    const nextRuleVersion =
      space.current_rule_version + (rulesChanged ? 1 : 0);
    const currentHost = hostConfigView(this.currentWorldHostConfig(space.id));
    const validation = this.validateWorldBuildArtifact({
      world: {
        name: next.name,
        description: next.description,
        tags: next.tags,
        visibility: next.visibility,
        joinPolicy: next.joinPolicy,
        friendPolicy: next.friendPolicy,
        rulesText: next.rulesText,
        definitionText: next.definitionText,
        entryPrompt: next.entryPrompt,
        hostPrompt: next.hostPrompt,
        resolutionMode: next.resolutionMode,
      },
      host: {
        name: currentHost.name,
        worldRole: currentHost.world_role,
        personaText: currentHost.persona_text,
        speakingStyle: currentHost.speaking_style,
        judgementPolicy: currentHost.judgement_policy,
        memoryPolicy: currentHost.memory_policy,
        onboardingPolicy: currentHost.onboarding_policy,
        facilitationPolicy: currentHost.facilitation_policy,
        recapPolicy: currentHost.recap_policy,
        participationPolicy: currentHost.participation_policy,
        evolutionPolicy: currentHost.evolution_policy,
        proactivity: currentHost.proactivity,
        capabilities: currentHost.capabilities,
      },
    });
    if (!validation.valid || validation.readiness !== "ready") {
      fail(
        "WORLD_UPDATE_INVALID",
        "The updated World and Host must pass all World Builder experience checks.",
        { validation },
      );
    }
    const timestamp = now();

    withTransaction(this.db, () => {
      this.db
        .prepare(`
          UPDATE spaces
          SET name = ?, description = ?, tags_json = ?, visibility = ?,
            join_policy = ?, friend_policy = ?, definition_text = ?,
            profile_version = ?, current_spec_version = ?,
            current_rule_version = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(
          next.name,
          next.description,
          JSON.stringify(next.tags),
          next.visibility,
          next.joinPolicy,
          next.friendPolicy,
          next.definitionText,
          nextProfileVersion,
          nextSpecVersion,
          nextRuleVersion,
          timestamp,
          space.id,
        );
      if (rulesChanged) {
        this.db
          .prepare(`
            INSERT INTO space_rule_versions (
              space_id, version, rules_text, visibility, join_policy,
              friend_policy, governance, definition_text, created_by_pet_id,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            space.id,
            nextRuleVersion,
            next.rulesText,
            next.visibility,
            next.joinPolicy,
            next.friendPolicy,
            space.governance,
            next.definitionText,
            actor.id,
            timestamp,
          );
        const latestSequence = Number(
          this.db
            .prepare(`
              SELECT COALESCE(MAX(sequence), 0) AS sequence
              FROM world_events WHERE space_id = ?
            `)
            .get(space.id).sequence,
        );
        this.db
          .prepare(`
            UPDATE world_member_journeys
            SET multiplayer_consent = 'pending', last_left_at = ?,
              last_departure_sequence = ?, updated_at = ?
            WHERE space_id = ? AND pet_id IN (
              SELECT pet_id FROM presence WHERE space_id = ?
            )
          `)
          .run(timestamp, latestSequence, timestamp, space.id, space.id);
        this.db
          .prepare(`
            UPDATE world_sessions
            SET status = 'closed', last_active_at = ?, closed_at = ?
            WHERE space_id = ? AND status = 'active'
          `)
          .run(timestamp, timestamp, space.id);
        this.db.prepare("DELETE FROM presence WHERE space_id = ?").run(space.id);
      }
      if (specChanged) {
        this.db
          .prepare(`
            INSERT INTO world_spec_versions (
              space_id, version, definition_text, entry_prompt, host_prompt,
              resolution_mode, visibility, join_policy, friend_policy,
              created_by_pet_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            space.id,
            nextSpecVersion,
            next.definitionText,
            next.entryPrompt,
            next.hostPrompt,
            next.resolutionMode,
            next.visibility,
            next.joinPolicy,
            next.friendPolicy,
            actor.id,
            timestamp,
          );
      }
      if (next.visibility === "hidden") {
        this.db
          .prepare("DELETE FROM space_shares WHERE space_id = ?")
          .run(space.id);
      }
      if (next.friendPolicy === "disabled" && !this.sharedIdentity) {
        this.db
          .prepare(`
            UPDATE friend_requests
            SET status = 'cancelled', updated_at = ?
            WHERE origin_space_id = ? AND status = 'pending'
          `)
          .run(timestamp, space.id);
      }
      this.audit(actor.id, "world.updated", "world", space.id, {
        profile_version: nextProfileVersion,
        spec_version: nextSpecVersion,
        rule_version: nextRuleVersion,
      });
    });

    return this.spaceDetails(space.id);
  }

  updateSpaceRules(options) {
    return this.updateWorld({
      ...options,
      worldId: options.worldId ?? options.spaceId,
    });
  }

  publishWorld({
    worldId,
    expectedVersion,
    expectedSpecVersion,
    expectedRuleVersion,
    expectedProfileVersion,
    expectedHostVersion,
  }) {
    const actor = this.requirePet();
    const world = this.requireSpace(worldId);
    this.requireManager(world, actor.id);
    const suppliedVersion = expectedSpecVersion ?? expectedVersion;
    integer(suppliedVersion, "expected spec version", { min: 1 });
    if (world.current_spec_version !== suppliedVersion) {
      fail("SPEC_VERSION_MISMATCH", "The world definition has changed.", {
        current_spec_version: world.current_spec_version,
      });
    }
    integer(expectedRuleVersion, "expected rule version", { min: 1 });
    if (world.current_rule_version !== expectedRuleVersion) {
      fail("RULE_VERSION_MISMATCH", "The member rules have changed.", {
        current_rule_version: world.current_rule_version,
      });
    }
    integer(expectedProfileVersion, "expected profile version", { min: 1 });
    if (world.profile_version !== expectedProfileVersion) {
      fail("PROFILE_VERSION_MISMATCH", "The world profile has changed.", {
        current_profile_version: world.profile_version,
      });
    }
    const currentHost = hostConfigView(this.currentWorldHostConfig(world.id));
    integer(expectedHostVersion, "expected World Host version", { min: 1 });
    if (currentHost.version !== expectedHostVersion) {
      fail("WORLD_HOST_VERSION_MISMATCH", "The World Host has changed.", {
        current_version: currentHost.version,
      });
    }
    if (world.kind === "official") {
      fail("IMMUTABLE_RULES", "Official worlds are managed by the platform.");
    }
    if (
      world.publication_status === "closed" &&
      world.owner_pet_id !== actor.id
    ) {
      fail("FORBIDDEN", "Only the World creator can reopen a closed World.");
    }
    if (world.publication_status === "published") {
      return this.spaceDetails(world.id);
    }
    const spec = this.currentWorldSpec(world.id);
    const rule = this.currentRule(world.id);
    const validation = this.validateWorldBuildArtifact({
      world: {
        name: world.name,
        description: world.description,
        tags: parseTags(world.tags_json),
        visibility: world.visibility,
        joinPolicy: world.join_policy,
        friendPolicy: world.friend_policy,
        rulesText: rule.rules_text,
        definitionText: spec.definition_text,
        entryPrompt: spec.entry_prompt,
        hostPrompt: spec.host_prompt,
        resolutionMode: spec.resolution_mode,
      },
      host: {
        name: currentHost.name,
        worldRole: currentHost.world_role,
        personaText: currentHost.persona_text,
        speakingStyle: currentHost.speaking_style,
        judgementPolicy: currentHost.judgement_policy,
        memoryPolicy: currentHost.memory_policy,
        onboardingPolicy: currentHost.onboarding_policy,
        facilitationPolicy: currentHost.facilitation_policy,
        recapPolicy: currentHost.recap_policy,
        participationPolicy: currentHost.participation_policy,
        evolutionPolicy: currentHost.evolution_policy,
        proactivity: currentHost.proactivity,
        capabilities: currentHost.capabilities,
      },
    });
    if (!validation.valid || validation.readiness !== "ready") {
      fail(
        "WORLD_PUBLISH_INVALID",
        "Resolve all World Builder experience checks before publishing.",
        { validation },
      );
    }
    const timestamp = now();
    this.db
      .prepare(`
        UPDATE spaces
        SET publication_status = 'published',
          published_at = COALESCE(published_at, ?), updated_at = ?
        WHERE id = ?
      `)
      .run(timestamp, timestamp, world.id);
    this.audit(actor.id, "world.published", "world", world.id, {
      spec_version: suppliedVersion,
      rule_version: expectedRuleVersion,
      profile_version: expectedProfileVersion,
      host_version: expectedHostVersion,
    });
    return this.spaceDetails(world.id);
  }

  closeWorld({ worldId }) {
    const actor = this.requirePet();
    const world = this.requireSpace(worldId);
    this.requireWorldOwnerForLifecycle(world, actor.id);
    if (world.publication_status === "draft") {
      fail(
        "WORLD_NOT_PUBLISHED",
        "A draft World can be deleted directly and does not need closing.",
      );
    }
    if (world.publication_status === "closed") {
      return this.spaceDetails(world.id);
    }
    const timestamp = now();
    withTransaction(this.db, () => {
      this.db
        .prepare(`
          UPDATE spaces
          SET publication_status = 'closed', updated_at = ?
          WHERE id = ?
        `)
        .run(timestamp, world.id);
      const latestSequence = Number(
        this.db
          .prepare(`
            SELECT COALESCE(MAX(sequence), 0) AS sequence
            FROM world_events WHERE space_id = ?
          `)
          .get(world.id).sequence,
      );
      this.db
        .prepare(`
          UPDATE world_member_journeys
          SET multiplayer_consent = 'pending', last_left_at = ?,
            last_departure_sequence = ?, updated_at = ?
          WHERE space_id = ? AND pet_id IN (
            SELECT pet_id FROM presence WHERE space_id = ?
          )
        `)
        .run(timestamp, latestSequence, timestamp, world.id, world.id);
      this.db
        .prepare("DELETE FROM presence WHERE space_id = ?")
        .run(world.id);
      this.db
        .prepare(`
          UPDATE world_sessions
          SET status = 'closed', last_active_at = ?, closed_at = ?
          WHERE space_id = ? AND status = 'active'
        `)
        .run(timestamp, timestamp, world.id);
      this.db
        .prepare(`
          UPDATE space_invitations
          SET status = 'revoked', updated_at = ?
          WHERE space_id = ? AND status = 'pending'
        `)
        .run(timestamp, world.id);
      this.db
        .prepare(`
          UPDATE world_host_runtimes
          SET status = 'idle', active_executor = 'platform',
            claimed_by_pet_id = NULL, claimed_principal_user_id = NULL,
            claim_session_id = NULL, lease_expires_at = NULL,
            runtime_version = runtime_version + 1,
            last_active_at = ?, deactivated_at = ?, updated_at = ?
          WHERE space_id = ?
        `)
        .run(timestamp, timestamp, timestamp, world.id);
      this.audit(actor.id, "world.closed", "world", world.id);
    });
    return this.spaceDetails(world.id);
  }

  deleteWorld({ worldId, confirmed = false }) {
    const actor = this.requirePet();
    const world = this.requireSpace(worldId);
    this.requireWorldOwnerForLifecycle(world, actor.id);
    if (world.publication_status === "published") {
      fail(
        "WORLD_MUST_BE_CLOSED",
        "Close the published World before permanently deleting it.",
      );
    }
    if (confirmed !== true) {
      fail(
        "CONFIRMATION_REQUIRED",
        "Permanent World deletion requires explicit confirmation.",
      );
    }
    const result = {
      deleted: true,
      world_id: world.id,
      name: world.name,
    };
    withTransaction(this.db, () => {
      this.db.prepare("DELETE FROM spaces WHERE id = ?").run(world.id);
      this.audit(actor.id, "world.deleted", "world", world.id, {
        name: world.name,
        publication_status: world.publication_status,
      });
    });
    return result;
  }

  listMyWorlds() {
    const actor = this.requirePet();
    const rows = this.db
      .prepare(`
        SELECT s.*, r.rules_text,
          ws.definition_text AS spec_definition_text,
          ws.entry_prompt, ws.host_prompt, ws.resolution_mode
        FROM spaces s
        JOIN space_rule_versions r
          ON r.space_id = s.id AND r.version = s.current_rule_version
        LEFT JOIN world_spec_versions ws
          ON ws.space_id = s.id AND ws.version = s.current_spec_version
        WHERE s.owner_pet_id = ?
          OR EXISTS (
            SELECT 1 FROM space_stewards st
            WHERE st.space_id = s.id AND st.pet_id = ?
          )
        ORDER BY s.updated_at DESC
      `)
      .all(actor.id, actor.id);
    return { worlds: rows.map(spaceView) };
  }

  addSteward({ spaceId, targetPetId }) {
    const actor = this.requirePet();
    const space = this.requireSpace(spaceId);
    if (space.owner_pet_id !== actor.id) {
      fail("FORBIDDEN", "Only the space owner can appoint stewards.");
    }
    const target = this.requirePetById(targetPetId);
    const membership = this.membership(space.id, target.id);
    if (!membership || membership.status !== "active") {
      fail("ACTIVE_MEMBERSHIP_REQUIRED", "A steward must be an active member.");
    }
    this.db
      .prepare(`
        INSERT OR IGNORE INTO space_stewards (space_id, pet_id, created_at)
        VALUES (?, ?, ?)
      `)
      .run(space.id, target.id, now());
    this.audit(actor.id, "space.steward_added", "space", space.id, {
      target_pet_id: target.id,
    });
    return { space_id: space.id, steward: petView(target) };
  }

  addWorldAdmin({ worldId, targetPetId }) {
    const result = this.addSteward({
      spaceId: worldId,
      targetPetId,
    });
    return {
      world_id: result.space_id,
      admin: result.steward,
    };
  }

  removeSteward({ spaceId, targetPetId }) {
    const actor = this.requirePet();
    const space = this.requireSpace(spaceId);
    if (space.owner_pet_id !== actor.id) {
      fail("FORBIDDEN", "Only the space owner can revoke stewards.");
    }
    const target = this.requirePetById(targetPetId);
    if (target.id === actor.id) {
      fail("INVALID_ARGUMENT", "The World owner role cannot be revoked.");
    }
    const removed = this.db
      .prepare("DELETE FROM space_stewards WHERE space_id = ? AND pet_id = ?")
      .run(space.id, target.id);
    if (removed.changes !== 1) {
      fail("NOT_FOUND", "World administrator assignment not found.");
    }
    this.audit(actor.id, "space.steward_removed", "space", space.id, {
      target_pet_id: target.id,
    });
    return { space_id: space.id, steward: petView(target), removed: true };
  }

  removeWorldAdmin({ worldId, targetPetId }) {
    const result = this.removeSteward({
      spaceId: worldId,
      targetPetId,
    });
    return {
      world_id: result.space_id,
      admin: result.steward,
      removed: result.removed,
    };
  }

  createShare({ spaceId, expiresInDays = 30 }) {
    const actor = this.requirePet();
    const space = this.requireSpace(spaceId);
    this.requireActiveMembership(space.id, actor.id);
    if (space.publication_status !== "published") {
      fail("WORLD_NOT_PUBLISHED", "Publish the world before sharing it.");
    }
    if (space.visibility === "hidden") {
      fail("FORBIDDEN", "Hidden spaces can only be revealed by invitation.");
    }
    const days = integer(expiresInDays, "expires in days", { min: 1, max: 365 });
    const token = randomBytes(18).toString("base64url");
    const timestamp = now();
    const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
    this.db
      .prepare(`
        INSERT INTO space_shares (
          token, space_id, created_by_pet_id, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `)
      .run(token, space.id, actor.id, expiresAt, timestamp);
    return { token, expires_at: expiresAt, space: this.spaceDetails(space.id) };
  }

  createWorldShare({ worldId, expiresInDays = 30 }) {
    const result = this.createShare({
      spaceId: worldId,
      expiresInDays,
    });
    return {
      token: result.token,
      expires_at: result.expires_at,
      world: result.space,
    };
  }

  openShare({ token }) {
    const normalizedToken = text(token, "token", { min: 10, max: 200 });
    const row = this.db
      .prepare(`
        SELECT sh.expires_at, s.*
        FROM space_shares sh
        JOIN spaces s ON s.id = sh.space_id
        WHERE sh.token = ?
      `)
      .get(normalizedToken);
    if (
      !row ||
      row.publication_status !== "published" ||
      row.visibility === "hidden" ||
      (row.expires_at && row.expires_at <= now())
    ) {
      fail("NOT_FOUND", "Share not found or expired.");
    }
    return this.spaceDetails(row.id);
  }

  openWorldShare({ token }) {
    return { world: this.openShare({ token }) };
  }

  createInvitation({ spaceId, targetPetId, bypassApproval = true }) {
    const actor = this.requirePet();
    const space = this.requireSpace(spaceId);
    this.requireManager(space, actor.id);
    if (space.publication_status !== "published") {
      fail("WORLD_NOT_PUBLISHED", "Publish the world before inviting members.");
    }
    const target = this.requirePetById(targetPetId);
    if (target.id === actor.id) {
      fail("INVALID_ARGUMENT", "You cannot invite yourself.");
    }
    this.ensureNoBlock(actor.id, target.id);
    if (!this.canAddress(actor.id, target.id)) {
      fail(
        "FORBIDDEN",
        "Invitations may only be sent to a friend or a Character currently sharing a space.",
      );
    }
    const existing = this.membership(space.id, target.id);
    if (existing?.status === "active") {
      fail("ALREADY_MEMBER", "That Character is already an active member.");
    }
    const timestamp = now();
    const id = randomUUID();
    this.db
      .prepare(`
        INSERT INTO space_invitations (
          id, space_id, inviter_pet_id, invitee_pet_id, status,
          bypass_approval, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
      `)
      .run(
        id,
        space.id,
        actor.id,
        target.id,
        bypassApproval ? 1 : 0,
        timestamp,
        timestamp,
      );
    this.audit(actor.id, "space.invitation_created", "space", space.id, {
      target_pet_id: target.id,
    });
    return { id, space: spaceView(space), invitee: petView(target) };
  }

  createWorldInvitation({
    worldId,
    targetPetId,
    bypassApproval = true,
  }) {
    const result = this.createInvitation({
      spaceId: worldId,
      targetPetId,
      bypassApproval,
    });
    return {
      id: result.id,
      world: result.space,
      invitee: result.invitee,
    };
  }

  listInvitations() {
    const actor = this.requirePet();
    const rows = this.db
      .prepare(`
        SELECT i.*, s.name AS space_name,
          p.${this.petNameColumn} AS inviter_name
        FROM space_invitations i
        JOIN spaces s ON s.id = i.space_id
        JOIN pets p ON p.id = i.inviter_pet_id
        WHERE i.invitee_pet_id = ? AND i.status = 'pending'
        ORDER BY i.created_at DESC
      `)
      .all(actor.id);
    return {
      invitations: rows.map((row) => ({
        id: row.id,
        space_id: row.space_id,
        space_name: row.space_name,
        inviter: { id: row.inviter_pet_id, name: row.inviter_name },
        bypass_approval: Boolean(row.bypass_approval),
        created_at: row.created_at,
      })),
    };
  }

  listWorldInvitations() {
    const result = this.listInvitations();
    return {
      invitations: result.invitations.map((invitation) => ({
        ...invitation,
        world_id: invitation.space_id,
        world_name: invitation.space_name,
      })),
    };
  }

  respondInvitation({ invitationId, decision }) {
    const actor = this.requirePet();
    const normalizedDecision = enumValue(
      decision,
      "decision",
      new Set(["declined"]),
    );
    const invitation = this.db
      .prepare("SELECT * FROM space_invitations WHERE id = ?")
      .get(invitationId);
    if (
      !invitation ||
      invitation.invitee_pet_id !== actor.id ||
      invitation.status !== "pending"
    ) {
      fail("NOT_FOUND", "Pending invitation not found.");
    }
    this.db
      .prepare(`
        UPDATE space_invitations SET status = ?, updated_at = ? WHERE id = ?
      `)
      .run(normalizedDecision, now(), invitation.id);
    return { invitation_id: invitation.id, status: normalizedDecision };
  }

  joinSpace({
    spaceId,
    ruleVersion,
    applicationText = "",
    invitationId,
    shareToken,
  }) {
    const actor = this.requirePet();
    const space = this.requireSpace(spaceId);
    if (space.publication_status !== "published") {
      fail("WORLD_NOT_PUBLISHED", "This World is not currently published.");
    }
    integer(ruleVersion, "rule version", { min: 1 });
    if (ruleVersion !== space.current_rule_version) {
      fail("RULE_VERSION_MISMATCH", "Accept the current space rules.", {
        current_rule_version: space.current_rule_version,
      });
    }
    const normalizedApplication = text(applicationText, "application text", {
      max: 500,
    });
    const invitation = invitationId
      ? this.validInvitation(invitationId, space.id, actor.id)
      : null;
    const share = shareToken ? this.validShare(shareToken, space.id) : null;
    const existingMembership = this.membership(space.id, actor.id);

    if (existingMembership?.status === "active") {
      const timestamp = now();
      this.db
        .prepare(`
          UPDATE space_memberships
          SET accepted_rule_version = ?, updated_at = ?
          WHERE space_id = ? AND pet_id = ?
        `)
        .run(ruleVersion, timestamp, space.id, actor.id);
      this.ensureWorldMemberState(space.id, actor.id, timestamp);
      this.ensureWorldMemberJourney(space.id, actor.id, timestamp);
      return {
        space: this.spaceDetails(space.id),
        membership: this.membershipView(this.membership(space.id, actor.id)),
      };
    }

    if (
      space.visibility === "hidden" &&
      space.join_policy !== "open" &&
      !invitation &&
      !existingMembership
    ) {
      fail("INVITATION_REQUIRED", "This hidden space requires an invitation.");
    }
    if (
      space.visibility === "unlisted" &&
      !invitation &&
      !share &&
      !existingMembership
    ) {
      fail("SHARE_REQUIRED", "This unlisted space requires a valid share.");
    }

    let status;
    if (space.join_policy === "open") {
      status = "active";
    } else if (
      invitation &&
      (space.join_policy === "invite_only" || invitation.bypass_approval)
    ) {
      status = "active";
    } else if (space.join_policy === "approval") {
      status = "pending";
    } else {
      fail("INVITATION_REQUIRED", "This space requires an invitation.");
    }

    const timestamp = now();
    withTransaction(this.db, () => {
      this.db
        .prepare(`
          INSERT INTO space_memberships (
            space_id, pet_id, status, accepted_rule_version, application_text,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(space_id, pet_id) DO UPDATE SET
            status = excluded.status,
            accepted_rule_version = excluded.accepted_rule_version,
            application_text = excluded.application_text,
            updated_at = excluded.updated_at
        `)
        .run(
          space.id,
          actor.id,
          status,
          ruleVersion,
          normalizedApplication,
          timestamp,
          timestamp,
        );
      if (invitation) {
        this.db
          .prepare(`
            UPDATE space_invitations
            SET status = 'accepted', updated_at = ? WHERE id = ?
          `)
          .run(timestamp, invitation.id);
      }
      if (status === "active") {
        this.ensureWorldMemberState(space.id, actor.id, timestamp);
        this.ensureWorldMemberJourney(space.id, actor.id, timestamp);
        this.insertWorldEvent({
          spaceId: space.id,
          actorType: "system",
          eventClass: "system",
          eventType: "member.joined",
          bodyText: `${actor.name} 加入了世界。`,
          payload: { pet_id: actor.id },
          specVersion: space.current_spec_version,
          timestamp,
        });
      }
      this.audit(actor.id, "space.joined_or_applied", "space", space.id, {
        status,
        rule_version: ruleVersion,
      });
    });

    return {
      space: this.spaceDetails(space.id),
      membership: this.membershipView(this.membership(space.id, actor.id)),
    };
  }

  joinWorld({
    worldId,
    ruleVersion,
    applicationText = "",
    invitationId,
    shareToken,
  }) {
    const result = this.joinSpace({
      spaceId: worldId,
      ruleVersion,
      applicationText,
      invitationId,
      shareToken,
    });
    return {
      world: result.space,
      membership: result.membership,
      host_guidance: {
        kind:
          result.membership.status === "active"
            ? "ready_to_enter"
            : "awaiting_approval",
        message:
          result.membership.status === "active"
            ? `${result.space.world_agent.name}会在进入后介绍当前情境，并给出开始参与的选项。`
            : "加入申请正在等待世界管理员处理。",
        next_action:
          result.membership.status === "active" ? "world_enter" : "wait",
        entry_prompt:
          result.membership.status === "active"
            ? result.space.entry_prompt
            : "",
        untrusted_external_content: true,
      },
    };
  }

  acceptCurrentRules({ spaceId, ruleVersion }) {
    const actor = this.requirePet();
    const space = this.requireSpace(spaceId);
    integer(ruleVersion, "rule version", { min: 1 });
    if (space.current_rule_version !== ruleVersion) {
      fail("RULE_VERSION_MISMATCH", "Accept the current space rules.", {
        current_rule_version: space.current_rule_version,
      });
    }
    const membership = this.membership(space.id, actor.id);
    if (!membership || membership.status !== "active") {
      fail("ACTIVE_MEMBERSHIP_REQUIRED", "Active membership is required.");
    }
    this.db
      .prepare(`
        UPDATE space_memberships
        SET accepted_rule_version = ?, updated_at = ?
        WHERE space_id = ? AND pet_id = ?
      `)
      .run(ruleVersion, now(), space.id, actor.id);
    return {
      space_id: space.id,
      accepted_rule_version: ruleVersion,
    };
  }

  acceptWorldRules({ worldId, ruleVersion }) {
    const result = this.acceptCurrentRules({
      spaceId: worldId,
      ruleVersion,
    });
    return {
      world_id: result.space_id,
      accepted_rule_version: result.accepted_rule_version,
    };
  }

  withdrawSpace({ spaceId }) {
    const actor = this.requirePet();
    const space = this.requireSpace(spaceId);
    if (space.owner_pet_id === actor.id) {
      fail(
        "OWNER_CANNOT_WITHDRAW",
        "Transfer or close the space before its owner withdraws.",
      );
    }
    const membership = this.membership(space.id, actor.id);
    if (!membership || !["pending", "active"].includes(membership.status)) {
      fail("NOT_A_MEMBER", "No active membership or application exists.");
    }
    withTransaction(this.db, () => {
      this.db
        .prepare(`
          UPDATE space_memberships
          SET status = 'withdrawn', updated_at = ?
          WHERE space_id = ? AND pet_id = ?
        `)
        .run(now(), space.id, actor.id);
      this.db
        .prepare("DELETE FROM presence WHERE pet_id = ? AND space_id = ?")
        .run(actor.id, space.id);
      this.audit(actor.id, "space.withdrawn", "space", space.id);
    });
    return { space_id: space.id, membership_status: "withdrawn" };
  }

  listMemberships() {
    const actor = this.requirePet();
    const rows = this.db
      .prepare(`
        SELECT m.*, s.name AS space_name, s.current_rule_version,
          CASE WHEN p.pet_id IS NULL THEN 0 ELSE 1 END AS is_present
        FROM space_memberships m
        JOIN spaces s ON s.id = m.space_id
        LEFT JOIN presence p
          ON p.pet_id = m.pet_id AND p.space_id = m.space_id
        WHERE m.pet_id = ? AND m.status IN ('pending', 'active')
        ORDER BY m.updated_at DESC
      `)
      .all(actor.id);
    return {
      memberships: rows.map((row) => ({
        space_id: row.space_id,
        space_name: row.space_name,
        status: row.status,
        accepted_rule_version: row.accepted_rule_version,
        current_rule_version: row.current_rule_version,
        rules_current: row.accepted_rule_version === row.current_rule_version,
        delegation_mode: row.delegation_mode ?? "manual",
        last_seen_event_sequence: Number(row.last_seen_event_sequence ?? 0),
        is_present: Boolean(row.is_present),
      })),
    };
  }

  listJoinRequests({ spaceId }) {
    const actor = this.requirePet();
    const space = this.requireSpace(spaceId);
    this.requireManager(space, actor.id);
    const rows = this.db
      .prepare(`
        SELECT m.*, p.${this.petNameColumn} AS name, p.bio
        FROM space_memberships m
        JOIN pets p ON p.id = m.pet_id
        WHERE m.space_id = ? AND m.status = 'pending'
        ORDER BY m.created_at ASC
      `)
      .all(space.id);
    return {
      space_id: space.id,
      requests: rows.map((row) => ({
        applicant: { id: row.pet_id, name: row.name, bio: row.bio },
        application_text: row.application_text,
        accepted_rule_version: row.accepted_rule_version,
        created_at: row.created_at,
      })),
    };
  }

  listWorldJoinRequests({ worldId }) {
    const result = this.listJoinRequests({ spaceId: worldId });
    return {
      world_id: result.space_id,
      requests: result.requests,
    };
  }

  respondJoinRequest({ spaceId, applicantPetId, decision }) {
    const actor = this.requirePet();
    const space = this.requireSpace(spaceId);
    this.requireManager(space, actor.id);
    const normalizedDecision = enumValue(
      decision,
      "decision",
      new Set(["accepted", "rejected"]),
    );
    const membership = this.membership(space.id, applicantPetId);
    if (!membership || membership.status !== "pending") {
      fail("NOT_FOUND", "Pending join request not found.");
    }
    if (
      normalizedDecision === "accepted" &&
      membership.accepted_rule_version !== space.current_rule_version
    ) {
      fail(
        "RULE_VERSION_MISMATCH",
        "The applicant must accept the current rules before approval.",
        { current_rule_version: space.current_rule_version },
      );
    }
    const status = normalizedDecision === "accepted" ? "active" : "rejected";
    const timestamp = now();
    withTransaction(this.db, () => {
      this.db
        .prepare(`
          UPDATE space_memberships SET status = ?, updated_at = ?
          WHERE space_id = ? AND pet_id = ?
        `)
        .run(status, timestamp, space.id, applicantPetId);
      if (status === "active") {
        const applicant = this.requirePetById(applicantPetId);
        this.ensureWorldMemberState(space.id, applicantPetId, timestamp);
        this.insertWorldEvent({
          spaceId: space.id,
          actorType: "system",
          eventClass: "system",
          eventType: "member.joined",
          bodyText: `${applicant.name} 加入了世界。`,
          payload: { pet_id: applicantPetId },
          specVersion: space.current_spec_version,
          timestamp,
        });
      }
      this.audit(actor.id, "space.join_request_responded", "space", space.id, {
        applicant_pet_id: applicantPetId,
        decision: normalizedDecision,
      });
    });
    return { space_id: space.id, applicant_pet_id: applicantPetId, status };
  }

  respondWorldJoinRequest({ worldId, applicantPetId, decision }) {
    const result = this.respondJoinRequest({
      spaceId: worldId,
      applicantPetId,
      decision,
    });
    return {
      world_id: result.space_id,
      applicant_pet_id: result.applicant_pet_id,
      status: result.status,
    };
  }

  enterSpace({ spaceId, clientSessionId }) {
    const actor = this.requirePet();
    const space = this.requireSpace(spaceId);
    if (space.publication_status !== "published") {
      fail("WORLD_NOT_PUBLISHED", "This World is not currently published.");
    }
    const membership = this.requireActiveMembership(space.id, actor.id);
    if (membership.accepted_rule_version !== space.current_rule_version) {
      fail("RULE_VERSION_MISMATCH", "Accept the current space rules first.", {
        current_rule_version: space.current_rule_version,
      });
    }
    const normalizedSessionId = text(
      clientSessionId ?? this.principalSessionId,
      "client session id",
      { min: 1, max: 200 },
    );
    const previousSession = this.db
      .prepare(`
        SELECT * FROM world_sessions
        WHERE pet_id = ? AND client_session_id = ?
      `)
      .get(actor.id, normalizedSessionId);
    const previous = this.db
      .prepare("SELECT space_id FROM presence WHERE pet_id = ?")
      .get(actor.id);
    const previousWorldId =
      previous?.space_id && previous.space_id !== space.id
        ? previous.space_id
        : !previous &&
            previousSession?.status === "active" &&
            previousSession.space_id !== space.id
          ? previousSession.space_id
          : null;
    const alreadyPresent = previous?.space_id === space.id;
    const timestamp = now();
    withTransaction(this.db, () => {
      if (previousWorldId) {
        const latestSequence = Number(
          this.db
            .prepare(`
              SELECT COALESCE(MAX(sequence), 0) AS sequence
              FROM world_events WHERE space_id = ?
            `)
            .get(previousWorldId).sequence,
        );
        this.db
          .prepare(`
            UPDATE world_member_journeys
            SET multiplayer_consent = 'pending', last_left_at = ?,
              last_departure_sequence = ?, updated_at = ?
            WHERE space_id = ? AND pet_id = ?
          `)
          .run(
            timestamp,
            latestSequence,
            timestamp,
            previousWorldId,
            actor.id,
          );
        this.db
          .prepare(`
            UPDATE world_member_journeys
            SET multiplayer_consent = 'pending', updated_at = ?
            WHERE space_id = ? AND pet_id IN (
              SELECT pet_id FROM presence
              WHERE space_id = ? AND pet_id <> ?
            )
          `)
          .run(timestamp, previousWorldId, previousWorldId, actor.id);
      }
      this.db
        .prepare(`
          UPDATE world_sessions
          SET status = 'closed', last_active_at = ?, closed_at = ?
          WHERE pet_id = ? AND space_id <> ? AND status = 'active'
        `)
        .run(timestamp, timestamp, actor.id, space.id);
      if (previousSession) {
        this.db
          .prepare(`
            UPDATE world_sessions
            SET space_id = ?, principal_user_id = ?, status = 'active',
              last_active_at = ?, closed_at = NULL
            WHERE id = ?
          `)
          .run(
            space.id,
            this.principalUserId,
            timestamp,
            previousSession.id,
          );
      } else {
        this.db
          .prepare(`
            INSERT INTO world_sessions (
              id, space_id, pet_id, principal_user_id, client_session_id,
              status, created_at, last_active_at
            ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
          `)
          .run(
            randomUUID(),
            space.id,
            actor.id,
            this.principalUserId,
            normalizedSessionId,
            timestamp,
            timestamp,
          );
      }
      this.db
        .prepare(`
          INSERT INTO presence (pet_id, space_id, entered_at)
          VALUES (?, ?, ?)
          ON CONFLICT(pet_id) DO UPDATE SET
            space_id = excluded.space_id,
            entered_at = CASE
              WHEN presence.space_id = excluded.space_id
              THEN presence.entered_at
              ELSE excluded.entered_at
            END
        `)
        .run(actor.id, space.id, timestamp);
      this.audit(actor.id, "space.entered", "space", space.id, {
        client_session_id: normalizedSessionId,
      });
    });
    if (previousWorldId) {
      this.reconcileWorldHostRuntime(previousWorldId, timestamp);
    }
    const hostRuntime = this.worldHostRuntimeDetails(space, actor, timestamp);
    const session = this.db
      .prepare(`
        SELECT * FROM world_sessions
        WHERE pet_id = ? AND client_session_id = ?
      `)
      .get(actor.id, normalizedSessionId);
    return {
      space: this.spaceDetails(space.id),
      session: {
        id: session.id,
        world_id: session.space_id,
        pet_id: session.pet_id,
        client_session_id: session.client_session_id,
        status: session.status,
        last_active_at: session.last_active_at,
      },
      host_runtime: hostRuntime,
      moved_from_space_id: previousWorldId,
      already_present: alreadyPresent,
    };
  }

  enterWorld({ worldId, clientSessionId }) {
    const result = this.enterSpace({
      spaceId: worldId,
      clientSessionId,
    });
    const actor = this.requirePet();
    const world = this.requireSpace(worldId);
    // A mystery truth must exist before the player can observe or investigate
    // the opening scene. Sealing on entry is independent of the event label an
    // MCP client happens to choose for natural-language investigation.
    this.sealPendingMysteryTruths(world.id);
    const existingGuidance = result.already_present
      ? this.latestWorldHostGuidance(world.id, actor.id)
      : null;
    const hostGuidance = existingGuidance
      ? {
          ...existingGuidance,
          host: hostConfigView(this.currentWorldHostConfig(world.id)),
          journey: this.worldMemberJourney(world.id, actor.id),
          live_context: this.worldLiveContext(world.id, actor.id),
          participation_context: this.worldParticipationContext(
            hostConfigView(this.currentWorldHostConfig(world.id)),
            this.worldLiveContext(world.id, actor.id),
            world.id,
            actor.id,
          ),
          untrusted_external_content: true,
        }
      : this.createEntryHostGuidance(world, actor.id);
    if (!result.already_present) {
      this.activateWaitingWorldMembers(world, actor, hostGuidance.created_at);
    }
    this.ensureWorldMemberState(world.id, actor.id);
    const worldState = this.worldStateView(world.id);
    const memberState = this.worldMemberStateView(world.id, actor.id);
    const resumeBundle = this.worldResumeBundle(world.id, actor.id);
    return {
      world: result.space,
      session: result.session,
      host_runtime: result.host_runtime,
      moved_from_world_id: result.moved_from_space_id,
      state_version: worldState.version,
      world_state: worldState,
      member_state_version: memberState.version,
      last_event_sequence: this.latestAccessibleWorldSequence(world, actor.id),
      loop_context: resumeBundle.loop_context,
      resume_bundle: resumeBundle,
      host_guidance: hostGuidance,
      host_response: {
        response_type: "guidance",
        world_id: world.id,
        host_agent_id: hostGuidance.host_agent_id,
        status:
          hostGuidance.kind === "waiting" ? "waiting" : "ready_for_input",
        decision: null,
        resolution: null,
        interpretation: "",
        reason_text: "",
        outcome_text: "",
        new_facts: [],
        costs: [],
        opened_hooks: [],
        state_changes: null,
        next_guidance: hostGuidance,
        live_context: hostGuidance.live_context,
        loop_context: resumeBundle.loop_context,
        resume_bundle: resumeBundle,
      },
    };
  }

  setWorldDelegation({ worldId, mode }) {
    const actor = this.requirePet();
    const world = this.requireSpace(worldId);
    this.requireActiveMembership(world.id, actor.id);
    const normalizedMode = enumValue(
      mode,
      "delegation mode",
      DELEGATION_MODES,
    );
    this.db
      .prepare(`
        UPDATE space_memberships
        SET delegation_mode = ?, updated_at = ?
        WHERE space_id = ? AND pet_id = ?
      `)
      .run(normalizedMode, now(), world.id, actor.id);
    this.audit(actor.id, "world.delegation_changed", "world", world.id, {
      delegation_mode: normalizedMode,
    });
    return {
      world_id: world.id,
      pet_id: actor.id,
      delegation_mode: normalizedMode,
    };
  }

  observeWorld({ worldId, afterSequence, limit = 50 } = {}) {
    const actor = this.requirePet();
    const world = this.requireSpace(worldId);
    const membership = this.requireActiveMembership(world.id, actor.id);
    this.touchWorldSession(world.id, actor.id);
    this.materializeDueTriggers(world.id);
    const canManage = this.canManage(world, actor.id);
    const cursor =
      afterSequence === undefined
        ? Number(membership.last_seen_event_sequence ?? 0)
        : integer(afterSequence, "after sequence", { min: 0 });
    const boundedLimit = integer(limit, "limit", { min: 1, max: 100 });
    this.ensureWorldMemberState(world.id, actor.id);
    this.ensureWorldMemberJourney(world.id, actor.id);
    const state = this.worldStateView(world.id);
    const memberState = this.worldMemberStateView(world.id, actor.id);
    const visibilityArgs = [actor.id, canManage ? 1 : 0];
    const events = this.db
      .prepare(`
        SELECT e.*, p.${this.petNameColumn} AS actor_name
        FROM world_events e
        LEFT JOIN pets p ON p.id = e.actor_pet_id
        WHERE e.space_id = ? AND e.sequence > ?
          AND (
            e.visibility = 'world'
            OR (e.visibility = 'actor' AND e.audience_pet_id = ?)
            OR (e.visibility = 'managers' AND ? = 1)
          )
          AND (
            e.scene_id IS NULL OR ? = 1 OR EXISTS (
              SELECT 1 FROM world_scene_participants scene_member
              WHERE scene_member.scene_id = e.scene_id
                AND scene_member.pet_id = ?
                AND scene_member.status IN ('invited', 'active')
            )
          )
        ORDER BY e.sequence ASC
        LIMIT ?
      `)
      .all(
        world.id,
        cursor,
        ...visibilityArgs,
        canManage ? 1 : 0,
        actor.id,
        boundedLimit,
      );
    const latest = this.db
      .prepare(`
        SELECT COALESCE(MAX(e.sequence), 0) AS sequence
        FROM world_events e
        WHERE e.space_id = ?
          AND (
            e.visibility = 'world'
            OR (e.visibility = 'actor' AND e.audience_pet_id = ?)
            OR (e.visibility = 'managers' AND ? = 1)
          )
          AND (
            e.scene_id IS NULL OR ? = 1 OR EXISTS (
              SELECT 1 FROM world_scene_participants scene_member
              WHERE scene_member.scene_id = e.scene_id
                AND scene_member.pet_id = ?
                AND scene_member.status IN ('invited', 'active')
            )
          )
      `)
      .get(world.id, ...visibilityArgs, canManage ? 1 : 0, actor.id);
    if (cursor > Number(latest.sequence)) {
      fail("INVALID_CURSOR", "The world event cursor is ahead of visible events.");
    }
    const unread = this.db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM world_events e
        WHERE e.space_id = ? AND e.sequence > ?
          AND (
            e.visibility = 'world'
            OR (e.visibility = 'actor' AND e.audience_pet_id = ?)
            OR (e.visibility = 'managers' AND ? = 1)
          )
          AND (
            e.scene_id IS NULL OR ? = 1 OR EXISTS (
              SELECT 1 FROM world_scene_participants scene_member
              WHERE scene_member.scene_id = e.scene_id
                AND scene_member.pet_id = ?
                AND scene_member.status IN ('invited', 'active')
            )
          )
      `)
      .get(
        world.id,
        Number(membership.last_seen_event_sequence ?? 0),
        ...visibilityArgs,
        canManage ? 1 : 0,
        actor.id,
      );
    const pendingRows = this.db
      .prepare(`
        SELECT e.*, p.${this.petNameColumn} AS actor_name,
          wi.input_type, wi.status AS input_status
        FROM world_events e
        LEFT JOIN pets p ON p.id = e.actor_pet_id
        LEFT JOIN world_inputs wi ON wi.intent_event_id = e.id
        WHERE e.space_id = ? AND e.event_class = 'intent'
          AND NOT EXISTS (
            SELECT 1 FROM world_events outcome
            WHERE outcome.event_class = 'outcome'
              AND outcome.causation_event_id = e.id
          )
          AND (? = 1 OR e.actor_pet_id = ?)
        ORDER BY e.sequence ASC
      `)
      .all(world.id, canManage ? 1 : 0, actor.id);
    const returnedCursor =
      events.length > 0
        ? Number(events[events.length - 1].sequence)
        : cursor;
    const latestGuidance = this.latestWorldHostGuidance(world.id, actor.id);
    const resumeBundle = this.worldResumeBundle(world.id, actor.id);
    return {
      world: this.spaceDetails(world.id),
      membership: this.membershipView(this.membership(world.id, actor.id)),
      can_manage: canManage,
      can_act:
        membership.accepted_rule_version === world.current_rule_version &&
        membership.delegation_mode !== "paused",
      world_state: state,
      member_state: memberState,
      state_version: state.version,
      member_state_version: memberState.version,
      events: events.map(eventView),
      pending_intents: pendingRows.map((row) => ({
        ...eventView(row),
        input_type: row.input_type ?? "action",
        status: row.input_status ?? "pending",
        actor_member_state: row.actor_pet_id
          ? this.worldMemberStateView(world.id, row.actor_pet_id)
          : null,
      })),
      pending_inputs: pendingRows.map((row) => ({
        ...eventView(row),
        input_type: row.input_type ?? "action",
        status: row.input_status ?? "pending",
        actor_member_state: row.actor_pet_id
          ? this.worldMemberStateView(world.id, row.actor_pet_id)
          : null,
      })),
      cursor: returnedCursor,
      latest_sequence: Number(latest.sequence),
      has_more: returnedCursor < Number(latest.sequence),
      unread_count: Number(unread.count),
      loop_context: resumeBundle.loop_context,
      resume_bundle: resumeBundle,
      active_interactions: this.activeWorldInteractions(
        world.id,
        actor.id,
      ),
      journey: this.worldMemberJourney(world.id, actor.id),
      host_guidance: latestGuidance
        ? {
            ...latestGuidance,
            live_context: this.worldLiveContext(world.id, actor.id),
            participation_context: this.worldParticipationContext(
              hostConfigView(this.currentWorldHostConfig(world.id)),
              this.worldLiveContext(world.id, actor.id),
              world.id,
              actor.id,
            ),
          }
        : null,
      host_runtime: this.worldHostRuntimeDetails(world, actor),
    };
  }

  ackWorldEvents({ worldId, throughSequence }) {
    const actor = this.requirePet();
    const world = this.requireSpace(worldId);
    const membership = this.requireActiveMembership(world.id, actor.id);
    const requested = integer(throughSequence, "through sequence", { min: 0 });
    const latest = this.latestAccessibleWorldSequence(world, actor.id);
    if (requested > latest) {
      fail("INVALID_CURSOR", "Cannot acknowledge events that are not visible.");
    }
    const next = Math.max(
      Number(membership.last_seen_event_sequence ?? 0),
      requested,
    );
    this.db
      .prepare(`
        UPDATE space_memberships
        SET last_seen_event_sequence = ?, updated_at = ?
        WHERE space_id = ? AND pet_id = ?
      `)
      .run(next, now(), world.id, actor.id);
    return { world_id: world.id, last_seen_event_sequence: next };
  }

  evaluateAutomaticStateProposal({
    world,
    config,
    eventType,
    worldState,
    worldStatePatch,
    memberStatePatch,
    worldStatePatchProposed,
    memberStatePatchProposed,
  }) {
    if (!worldStatePatchProposed && !memberStatePatchProposed) {
      return {
        decision: "allowed",
        worldStatePatch,
        memberStatePatch,
      };
    }

    const origin = this.db
      .prepare(`
        SELECT origin_type
        FROM world_build_sessions
        WHERE world_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `)
      .get(world.id)?.origin_type;
    const configuredPolicy = config.judgement_policy.state_patch_policy;
    if (
      world.kind !== "official" &&
      (origin === "legacy" || configuredPolicy === "legacy_passthrough")
    ) {
      return {
        decision: "allowed",
        worldStatePatch,
        memberStatePatch,
      };
    }
    return {
      decision: "clarification",
      reason:
        "当前 Host 使用 host_derived 状态策略，成员提交的 JSON 只能作为提案，不能直接成为世界事实。",
    };
  }

  evaluatePlatformWorldInput({
    world,
    worldAgent,
    actor,
    inputType,
    eventType,
    bodyText,
    data,
    worldStatePatch,
    memberStatePatch,
    worldStatePatchProposed = false,
    memberStatePatchProposed = false,
    worldState,
    memberState,
    visibility,
  }) {
    const config = hostConfigView(this.currentWorldHostConfig(world.id));
    const policy = config.judgement_policy;
    const blockedPatterns = Array.isArray(policy.blocked_input_patterns)
      ? policy.blocked_input_patterns
          .filter((item) => typeof item === "string" && item.trim())
          .map((item) => item.trim())
      : [];
    const blockedPattern = blockedPatterns.find((pattern) =>
      bodyText.toLocaleLowerCase().includes(pattern.toLocaleLowerCase()),
    );
    const declaredViolation = declaredRuleViolation(
      this.currentRule(world.id).rules_text,
      bodyText,
    );
    const otherCharacterNames = this.db
      .prepare(`
        SELECT DISTINCT pet.${this.petNameColumn} AS name
        FROM space_memberships membership
        JOIN pets pet ON pet.id = membership.pet_id
        WHERE membership.space_id = ? AND membership.status = 'active'
          AND membership.pet_id <> ?
      `)
      .all(world.id, actor.id)
      .map((row) => row.name);
    const absentCharacterNames = this.db
      .prepare(`
        SELECT DISTINCT pet.${this.petNameColumn} AS name
        FROM space_memberships membership
        JOIN pets pet ON pet.id = membership.pet_id
        LEFT JOIN presence live
          ON live.space_id = membership.space_id AND live.pet_id = membership.pet_id
        WHERE membership.space_id = ? AND membership.status = 'active'
          AND membership.pet_id <> ? AND live.pet_id IS NULL
      `)
      .all(world.id, actor.id)
      .map((row) => row.name);
    const agencyViolation = otherCharacterAgencyViolation(
      bodyText,
      otherCharacterNames,
      absentCharacterNames,
    );
    if (agencyViolation) {
      return {
        decision: "rejected",
        reasonText:
          "你只能声明自己的邀请、尝试或选择，不能替其他角色决定移动、回应、同意或立场。",
        outcomeText: `${config.name}没有让其他角色执行这项命令，世界状态保持不变。你可以改为描述自己的邀请或说服理由，并由对方自行决定是否回应。`,
        worldStatePatch: undefined,
        memberStatePatch: undefined,
        result: {
          resolution: "rejected",
          interpretation: `${actor.name}的输入越过了其他角色的自主权边界。`,
          new_facts: [],
          costs: [],
          opened_hooks: [],
        },
      };
    }
    if (blockedPattern || declaredViolation) {
      return {
        decision: "rejected",
        reasonText:
          typeof policy.blocked_reason_text === "string"
            ? policy.blocked_reason_text
            : `输入触发了当前世界的限制：“${blockedPattern ?? declaredViolation}”。`,
        outcomeText:
          typeof policy.blocked_outcome_text === "string"
            ? policy.blocked_outcome_text
            : `${config.name}没有接受这个输入，世界状态保持不变。`,
        worldStatePatch: undefined,
        memberStatePatch: undefined,
        result: {
          resolution: "rejected",
          interpretation: `${actor.name}的输入触发了世界边界检查。`,
          new_facts: [],
          costs: [],
          opened_hooks: [],
        },
      };
    }

    if (
      eventType === "host.multiplayer.accept" ||
      eventType === "host.multiplayer.decline"
    ) {
      const accepted = eventType === "host.multiplayer.accept";
      return {
        decision: "accepted",
        reasonText:
          "这是兼容旧客户端的直接互动偏好；World 状态始终由所有成员共享。",
        outcomeText: accepted
          ? `${config.name}记录了${actor.name}愿意接受直接交流；这不会改变 World 一直共享的状态。`
          : `${config.name}记录了${actor.name}暂不接受 Host 主动撮合；独立行动仍会影响共享 World。`,
        worldStatePatch: undefined,
        memberStatePatch: undefined,
        result: {
          resolution: "full_success",
          interpretation: `${actor.name}更新了自己的直接互动偏好。`,
          new_facts: [],
          costs: [],
          opened_hooks: [],
        },
      };
    }

    const proposalPolicy = this.evaluateAutomaticStateProposal({
      world,
      config,
      eventType,
      worldState,
      worldStatePatch,
      memberStatePatch,
      worldStatePatchProposed,
      memberStatePatchProposed,
    });
    if (proposalPolicy.decision !== "allowed") {
      return {
        decision: "clarification",
        reasonText: proposalPolicy.reason,
        outcomeText: `${config.name}没有把成员提交的状态对象直接写入世界。请描述希望达成的效果，让 Host 根据规则生成变化；或由创建者 Agent 接管后结算。`,
        worldStatePatch: undefined,
        memberStatePatch: undefined,
        result: {
          resolution: "clarification",
          interpretation: `${actor.name}提出了需要 Host 验证的状态修改。`,
          new_facts: [],
          costs: [],
          opened_hooks: [],
        },
      };
    }
    const committedWorldStatePatch = proposalPolicy.worldStatePatch;
    const committedMemberStatePatch = proposalPolicy.memberStatePatch;

    if (
      inputType === "speech" &&
      visibility === "actor" &&
      ["speech", "speak", "say", "message"].includes(eventType)
    ) {
      return {
        decision: "accepted",
        reasonText:
          "这是一条仅本人可见的私人记录；它没有成为公共发言或公共世界事实。",
        outcomeText: `${config.name}只为${actor.name}保留了这段私人内容。其他在场成员不会看到，也无需回应；如果它需要影响共享世界，请另行公开可公开的部分。`,
        worldStatePatch: undefined,
        memberStatePatch: undefined,
        result: {
          resolution: "full_success",
          interpretation: `${actor.name}保留了一条仅本人可见的私人记录。`,
          new_facts: [],
          costs: [],
          opened_hooks: [],
        },
      };
    }

    const addressedMember = otherCharacterNames.find((name) =>
      bodyText.includes(name),
    );
    if (
      inputType === "speech" &&
      addressedMember &&
      /(?:问|询问|邀请|请求|建议|尝试说服|试着说服)|\b(?:ask|invite|request|suggest|try to persuade)\b/iu.test(
        bodyText,
      )
    ) {
      return {
        decision: "accepted",
        reasonText:
          "这是一项面向现场成员的可选互动，只表达当前角色的询问、邀请或说服尝试。",
        outcomeText: `${actor.name}向${addressedMember}发出了可自由回应的互动：“${bodyText.slice(0, 240)}” ${addressedMember}可以回应，也可以忽略并继续自己的行动。`,
        worldStatePatch: undefined,
        memberStatePatch: undefined,
        result: {
          resolution: "full_success",
          interpretation: `${actor.name}向${addressedMember}发起了一次不强制回应的互动。`,
          new_facts: [],
          costs: [],
          opened_hooks: [],
        },
      };
    }

    if (
      inputType === "action" &&
      /(?:我)?(?:命令|让|决定)?自己(?:离开|退出)(?:酒馆|世界)?/u.test(bodyText)
    ) {
      return {
        decision: "accepted",
        reasonText: "这是当前角色对自己离场作出的决定，没有替其他角色行动。",
        outcomeText: `${config.name}确认${actor.name}可以自行离开；这项表达不会制造剧情代价或替代现场退出操作。完成离场请使用离开 World 的操作。`,
        worldStatePatch: undefined,
        memberStatePatch: undefined,
        result: {
          resolution: "full_success",
          interpretation: `${actor.name}表达了自己离开现场的决定。`,
          new_facts: [],
          costs: [],
          opened_hooks: [],
        },
      };
    }


    const hostName = worldAgent.display_name ?? config.name ?? "世界主持";
    let outcomeText;
    if (
      eventType === "host.onboarding.role_selected" &&
      typeof data.role === "string"
    ) {
      outcomeText = `${hostName}确认了${actor.name}的身份：${data.role}。`;
    } else if (eventType === "host.onboarding.intent_selected") {
      outcomeText = `${hostName}记录了${actor.name}的参与意图：${bodyText}`;
    } else {
      const templates =
        config.facilitation_policy.outcome_templates &&
        typeof config.facilitation_policy.outcome_templates === "object" &&
        !Array.isArray(config.facilitation_policy.outcome_templates)
          ? config.facilitation_policy.outcome_templates
          : {};
      outcomeText = renderHostTemplate(
        templates[eventType] ?? templates[inputType],
        {
          actor: actor.name,
          body: bodyText,
          host: hostName,
          world: world.name,
        },
      );
      if (!outcomeText) {
        outcomeText =
          inputType === "speech"
            ? `${actor.name}说：“${bodyText}”`
            : inputType === "choice"
              ? `${actor.name}作出选择：“${bodyText}”`
              : `${hostName}接受了${actor.name}的行动：“${bodyText}”`;
      }
    }
    return {
      decision: "accepted",
      reasonText: "输入已通过当前世界主持的规则检查。",
      outcomeText: outcomeText.slice(0, 4000),
      worldStatePatch: committedWorldStatePatch,
      memberStatePatch: committedMemberStatePatch,
      worldStatePatchDerived: proposalPolicy.worldStatePatchDerived === true,
      memberStatePatchDerived: proposalPolicy.memberStatePatchDerived === true,
      result: {
        resolution: "full_success",
        interpretation: `${actor.name}的${inputType}输入已由${hostName}处理。`,
        new_facts: [],
        costs: [],
        opened_hooks: [],
      },
    };
  }

  actInWorld({
    worldId,
    inputType,
    eventType = "action",
    bodyText,
    data = {},
    proposedWorldStatePatch,
    proposedMemberStatePatch,
    observedWorldStateVersion,
    observedMemberStateVersion,
    expectedWorldStateVersion,
    expectedMemberStateVersion,
    correlationId,
    replyToEventId,
    sceneId,
    visibility = "world",
    idempotencyKey,
    requireLive = false,
  }) {
    const actor = this.requirePet();
    const world = this.requireSpace(worldId);
    const membership = this.requireActiveMembership(world.id, actor.id);
    if (membership.accepted_rule_version !== world.current_rule_version) {
      fail("RULE_VERSION_MISMATCH", "Accept the current world rules first.", {
        current_rule_version: world.current_rule_version,
      });
    }
    if (membership.delegation_mode === "paused") {
      fail("PARTICIPATION_PAUSED", "Participation is paused in this world.");
    }
    if (requireLive) {
      this.requireLiveWorldPresence(world.id, actor.id);
    }
    this.materializeDueTriggers(world.id);
    const spec = this.currentWorldSpec(world.id);
    const worldAgent = this.requireWorldAgent(world.id);
    if (worldAgent.status !== "active") {
      fail("WORLD_AGENT_PAUSED", "The World Agent is paused.");
    }
    const timestamp = now();
    this.touchWorldSession(world.id, actor.id, timestamp);
    const { runtime } = this.reconcileWorldHostRuntime(world.id, timestamp);
    if (requireLive && runtime.status !== "active") {
      fail("WORLD_HOST_UNAVAILABLE", "The World Host is not active.");
    }
    const inferredInputType = ["speak", "speech", "say", "message"].includes(
      eventType,
    )
      ? "speech"
      : "action";
    const normalizedInputType = enumValue(
      inputType ?? inferredInputType,
      "input type",
      WORLD_INPUT_TYPES,
    );
    const normalizedType = text(eventType, "event type", { min: 1, max: 80 });
    const normalizedBody = text(bodyText, "body text", {
      min: 1,
      max: 4000,
    });
    const normalizedData = jsonObject(data, "event data");
    if (normalizedType === "speech.directed") {
      const targetCharacterId = text(
        normalizedData.target_character_id ?? normalizedData.target_pet_id,
        "target character id",
        { min: 1, max: 100 },
      );
      if (targetCharacterId === actor.id) {
        fail("INVALID_ARGUMENT", "Directed World speech must target another Character.");
      }
      this.requireActiveMembership(world.id, targetCharacterId);
      normalizedData.target_character_id = targetCharacterId;
      delete normalizedData.target_pet_id;
      if (visibility !== "world") {
        fail(
          "INVALID_ARGUMENT",
          "Directed World speech must be world-visible so its target can receive it.",
        );
      }
    }
    const worldPatch = optionalJsonObject(
      proposedWorldStatePatch,
      "proposed world state patch",
    );
    let memberPatch = optionalJsonObject(
      proposedMemberStatePatch,
      "proposed member state patch",
    );
    let hostDerivedMemberPatch = false;
    if (
      normalizedType === "host.onboarding.role_selected" &&
      typeof normalizedData.role === "string"
    ) {
      const selectedRole = text(normalizedData.role, "selected role", {
        min: 1,
        max: 120,
      });
      memberPatch = mergePatch(memberPatch ?? {}, { role: selectedRole });
      hostDerivedMemberPatch = true;
    }
    let normalizedVisibility = enumValue(
      visibility,
      "event visibility",
      EVENT_VISIBILITIES,
    );
    let normalizedSceneId =
      sceneId === undefined
        ? null
        : text(sceneId, "scene id", { min: 1, max: 100 });
    const normalizedKey = text(idempotencyKey, "idempotency key", {
      min: 1,
      max: 120,
    });
    const normalizedCorrelation =
      correlationId === undefined
        ? null
        : text(correlationId, "correlation id", { min: 1, max: 120 });
    const normalizedReply =
      replyToEventId === undefined
        ? null
        : text(replyToEventId, "reply event id", { min: 1, max: 100 });
    if (normalizedReply) {
      const replyEvent = this.db
        .prepare(`
          SELECT event.id, event.scene_id
          FROM world_events event
          WHERE event.id = ? AND event.space_id = ?
            AND (
              event.actor_pet_id = ?
              OR (event.visibility = 'actor' AND event.audience_pet_id = ?)
              OR (
                event.visibility = 'world'
                AND (
                  event.scene_id IS NULL
                  OR EXISTS (
                    SELECT 1 FROM world_scene_participants participant
                    WHERE participant.scene_id = event.scene_id
                      AND participant.space_id = event.space_id
                      AND participant.pet_id = ?
                      AND participant.status IN ('invited', 'active')
                  )
                )
              )
            )
        `)
        .get(normalizedReply, world.id, actor.id, actor.id, actor.id);
      if (!replyEvent) fail("NOT_FOUND", "Reply target event not found.");
      if (
        replyEvent.scene_id &&
        normalizedSceneId &&
        replyEvent.scene_id !== normalizedSceneId
      ) {
        fail(
          "WORLD_SCENE_REPLY_MISMATCH",
          "A reply to a Scene event must remain in that same Scene.",
          {
            reply_scene_id: replyEvent.scene_id,
            requested_scene_id: normalizedSceneId,
          },
        );
      }
      normalizedSceneId = replyEvent.scene_id ?? normalizedSceneId;
    }
    const collectiveReply = normalizedReply
      ? this.db
          .prepare(`
            SELECT id, status FROM world_interactions
            WHERE space_id = ? AND prompt_event_id = ?
          `)
          .get(world.id, normalizedReply)
      : null;
    // A collective response is private evidence until the authoritative
    // aggregate outcome is published. Never trust an Agent/client to select
    // the correct visibility for a vote or other shared-decision response.
    if (collectiveReply) normalizedVisibility = "actor";
    if (normalizedSceneId) {
      const privateCollectiveResponse =
        normalizedVisibility === "actor" &&
        Boolean(collectiveReply);
      if (normalizedVisibility !== "world" && !privateCollectiveResponse) {
        fail(
          "INVALID_ARGUMENT",
          "A Scene action must be participant-visible; only a private collective response may stay actor-visible until settlement.",
        );
      }
      const scene = this.db.prepare(`
        SELECT scene.id, scene.interaction_policy FROM world_scenes scene
        JOIN world_scene_participants participant
          ON participant.scene_id = scene.id
        WHERE scene.id = ? AND scene.space_id = ?
          AND scene.status IN ('forming', 'active', 'resolved')
          AND participant.pet_id = ? AND participant.status = 'active'
      `).get(normalizedSceneId, world.id, actor.id);
      if (!scene) {
        fail(
          "WORLD_SCENE_PARTICIPANT_REQUIRED",
          "Only an active Scene participant may bind an action to that Scene.",
          { scene_id: normalizedSceneId },
        );
      }
      if (scene.interaction_policy === "sync") {
        this.requireLiveWorldPresence(world.id, actor.id);
      }
      if (normalizedType === "speech.directed") {
        const targetCharacterId = normalizedData.target_character_id;
        const targetInScene = this.db.prepare(`
          SELECT 1 FROM world_scene_participants
          WHERE scene_id = ? AND space_id = ? AND pet_id = ?
            AND status IN ('invited', 'active')
        `).get(normalizedSceneId, world.id, targetCharacterId);
        if (!targetInScene) {
          fail(
            "WORLD_SCENE_TARGET_MISMATCH",
            "Directed speech bound to a Scene must target a participant of that Scene. Omit scene_id to start a separate causal encounter.",
            {
              scene_id: normalizedSceneId,
              target_character_id: targetCharacterId,
            },
          );
        }
      }
    }
    if (
      collectiveReply?.status === "open" &&
      normalizedInputType === "choice" &&
      !(typeof normalizedData.choice_id === "string" && normalizedData.choice_id.trim())
    ) {
      fail(
        "COLLECTIVE_CHOICE_ID_REQUIRED",
        "A collective choice response must include data.choice_id so the server can distinguish agreement from disagreement without guessing from private text.",
      );
    }
    const requestFingerprint = idempotencyFingerprint({
      input_type: normalizedInputType,
      event_type: normalizedType,
      body_text: normalizedBody,
      data: normalizedData,
      proposed_world_state_patch: worldPatch,
      proposed_member_state_patch: memberPatch,
      reply_to_event_id: normalizedReply,
      scene_id: normalizedSceneId,
      visibility: normalizedVisibility,
      correlation_id: normalizedCorrelation ?? normalizedReply,
    });
    const existing = this.db
      .prepare(`
        SELECT input.id, input.idempotency_fingerprint
        FROM world_inputs input
        WHERE input.space_id = ? AND input.actor_pet_id = ? AND input.idempotency_key = ?
      `)
      .get(world.id, actor.id, normalizedKey);
    if (existing) {
      // Pre-fingerprint rows are a deliberate compatibility exception. They
      // cannot be compared safely, but preserve the historical replay contract.
      if (
        existing.idempotency_fingerprint &&
        existing.idempotency_fingerprint !== requestFingerprint
      ) {
        fail("IDEMPOTENCY_CONFLICT", "This idempotency key was already used for a different World action.", {
          idempotency_key: normalizedKey,
        });
      }
      return this.worldIntentResult(existing.id);
    }

    this.refreshWorldInteractions(world.id, timestamp);
    let interaction = null;
    if (normalizedReply) {
      interaction = this.db
        .prepare(`
          SELECT * FROM world_interactions
          WHERE space_id = ? AND prompt_event_id = ?
        `)
        .get(world.id, normalizedReply);
      if (interaction?.status === "open") {
        if (interaction.scene_id) {
          const sceneParticipant = this.db.prepare(`
            SELECT 1 FROM world_scene_participants
            WHERE scene_id = ? AND space_id = ? AND pet_id = ?
              AND status IN ('invited', 'active')
          `).get(interaction.scene_id, world.id, actor.id);
          if (!sceneParticipant) {
            fail(
              "WORLD_SCENE_PARTICIPANT_REQUIRED",
              "Only Scene participants may respond to this interaction.",
              { scene_id: interaction.scene_id },
            );
          }
        }
        const priorResponse = this.db
          .prepare(`
            SELECT id FROM world_inputs
            WHERE interaction_id = ? AND actor_pet_id = ?
          `)
          .get(interaction.id, actor.id);
        if (priorResponse) {
          fail(
            "WORLD_INTERACTION_ALREADY_RESPONDED",
            "This member has already responded to the collective interaction.",
            { interaction_id: interaction.id, input_id: priorResponse.id },
          );
        }
        if (normalizedInputType === "choice") {
          const prompt = this.db.prepare("SELECT payload_json FROM world_events WHERE id = ?")
            .get(interaction.prompt_event_id);
          const options = parseJsonObject(prompt?.payload_json).choice_options ?? [];
          if (!Array.isArray(options) || options.length === 0) {
            fail("COLLECTIVE_CHOICE_OPTIONS_REQUIRED", "This collective interaction has no public choice options; submit speech or action instead.");
          }
          const choiceId = normalizedData.choice_id;
          if (!options.some((option) => option?.choice_id === choiceId)) {
            fail("COLLECTIVE_CHOICE_NOT_OFFERED", "Choose one of the public choice_ids announced for this interaction.");
          }
        }
      } else if (interaction) {
        if (interaction.late_input_policy === "expire") {
          fail(
            "WORLD_INTERACTION_CLOSED",
            "The collective interaction is no longer accepting responses.",
            { interaction_id: interaction.id, status: interaction.status },
          );
        }
        interaction = null;
      }
    }

    const intentId = randomUUID();
    const audiencePetId =
      normalizedVisibility === "actor" ? actor.id : null;
    this.ensureWorldMemberState(world.id, actor.id, timestamp);
    // Entry normally seals mystery truth. This fallback also protects direct
    // protocol clients that submit without a live entry flow.
    this.sealPendingMysteryTruths(world.id, timestamp);
    const worldStateBefore = this.worldStateView(world.id);
    const memberStateBefore = this.worldMemberStateView(world.id, actor.id);
    const hasObservedWorldVersion = observedWorldStateVersion !== undefined;
    const hasObservedMemberVersion = observedMemberStateVersion !== undefined;
    const observedWorldVersion = integer(
      observedWorldStateVersion ?? worldStateBefore.version,
      "observed world state version",
      { min: 1 },
    );
    const observedMemberVersion = integer(
      observedMemberStateVersion ?? memberStateBefore.version,
      "observed member state version",
      { min: 1 },
    );
    if (observedWorldVersion > worldStateBefore.version) {
      fail("STATE_VERSION_MISMATCH", "The observed World state is ahead of the server.", {
        observed_world_state_version: observedWorldVersion,
        current_world_state_version: worldStateBefore.version,
      });
    }
    if (observedMemberVersion > memberStateBefore.version) {
      fail("STATE_VERSION_MISMATCH", "The observed member state is ahead of the server.", {
        pet_id: actor.id,
        observed_member_state_version: observedMemberVersion,
        current_member_state_version: memberStateBefore.version,
      });
    }
    const contextVersionSource =
      hasObservedWorldVersion && hasObservedMemberVersion
        ? "client"
        : hasObservedWorldVersion || hasObservedMemberVersion
          ? "partial_client"
          : "server_fallback";
    let automaticDisposition =
      observedWorldVersion < worldStateBefore.version ? "rebase" : "apply";
    let automaticJudgement = this.evaluatePlatformWorldInput({
      world,
      worldAgent,
      actor,
      inputType: normalizedInputType,
      eventType: normalizedType,
      bodyText: normalizedBody,
      data: normalizedData,
      worldStatePatch: worldPatch,
      memberStatePatch: memberPatch,
      worldStatePatchProposed: proposedWorldStatePatch !== undefined,
      memberStatePatchProposed: proposedMemberStatePatch !== undefined,
      worldState: worldStateBefore.value,
      memberState: memberStateBefore.value,
      visibility: normalizedVisibility,
    });
    if (
      normalizedVisibility !== "world" &&
      automaticJudgement.worldStatePatch !== undefined
    ) {
      automaticJudgement = {
        decision: "clarification",
        reasonText:
          "非公开输入不能产生所有成员可见的世界状态变化。",
        outcomeText:
          "Host 没有把这项私人输入写成公共世界事实；请公开提交会改变世界的部分，或只保留个人状态。",
        worldStatePatch: undefined,
        memberStatePatch: undefined,
        result: {
          resolution: "clarification",
          interpretation: `${actor.name}提交了一项包含公共状态后果的非公开输入。`,
          new_facts: [],
          costs: [],
          opened_hooks: [],
        },
      };
    }
    if (observedWorldVersion < worldStateBefore.version) {
      const canRebaseAutomatically =
        normalizedInputType === "speech" ||
        automaticJudgement.worldStatePatchDerived === true ||
        automaticJudgement.memberStatePatchDerived === true;
      if (
        automaticJudgement.decision === "accepted" &&
        !canRebaseAutomatically
      ) {
        const hostName = worldAgent.display_name ?? "世界主持";
        automaticJudgement = {
          decision: "clarification",
          reasonText:
            "这项行动基于较早的世界状态，而当前平台主持无法安全推断它在新状态中的含义。",
          outcomeText:
            `${hostName}发现世界已经发生变化，因此保留了你的原始意图，并请你基于最新进展重新确认下一步。`,
          worldStatePatch: undefined,
          memberStatePatch: undefined,
          result: {
            resolution: "clarification",
            interpretation: `${actor.name}的行动需要根据最新世界状态重新确认。`,
            new_facts: [],
            costs: [],
            opened_hooks: [],
          },
        };
      }
      automaticDisposition =
        automaticJudgement.decision === "accepted" ? "rebase" : "conflict";
    }
    withTransaction(this.db, () => {
      this.insertWorldEvent({
        id: intentId,
        spaceId: world.id,
        sceneId: normalizedSceneId,
        actorType: "pet",
        actorPetId: actor.id,
        eventClass: "intent",
        eventType: normalizedType,
        bodyText: normalizedBody,
        payload: {
          data: normalizedData,
          proposed_world_state_patch: worldPatch,
          proposed_member_state_patch: memberPatch,
          reply_to_event_id: normalizedReply,
          interaction_id: interaction?.id ?? null,
        },
        correlationId: normalizedCorrelation ?? normalizedReply,
        visibility: normalizedVisibility,
        audiencePetId,
        specVersion: spec.version,
        idempotencyKey: normalizedKey,
        timestamp,
      });
      this.db
        .prepare(`
          INSERT INTO world_inputs (
            id, space_id, actor_pet_id, principal_user_id, principal_type,
            input_type, event_type, body_text, data_json, reply_to_event_id,
            correlation_id, visibility, rule_version, spec_version,
            world_state_version, member_state_version,
            received_world_state_version, received_member_state_version,
            context_version_source, interaction_id, idempotency_key,
            idempotency_fingerprint, status,
            intent_event_id, created_at
          ) VALUES (?, ?, ?, ?, 'user', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, 'pending', ?, ?)
        `)
        .run(
          intentId,
          world.id,
          actor.id,
          this.principalUserId,
          normalizedInputType,
          normalizedType,
          normalizedBody,
          JSON.stringify({
            data: normalizedData,
            scene_id: normalizedSceneId,
            proposed_world_state_patch: worldPatch,
            proposed_member_state_patch: memberPatch,
          }),
          normalizedReply,
          normalizedCorrelation ?? normalizedReply,
          normalizedVisibility,
          world.current_rule_version,
          spec.version,
          observedWorldVersion,
          observedMemberVersion,
          worldStateBefore.version,
          memberStateBefore.version,
          contextVersionSource,
          interaction?.id ?? null,
          normalizedKey,
          requestFingerprint,
          intentId,
          timestamp,
        );
      if (normalizedType === "speech.directed") {
        const storedInput = this.db.prepare(
          "SELECT * FROM world_inputs WHERE id = ?",
        ).get(intentId);
        this.materializeWorldSceneFromJudgement({
          world,
          input: storedInput,
          judgementResult: {},
          timestamp,
        });
      }
      if (
        !interaction &&
        spec.resolution_mode === "direct" &&
        this.platformHostMode !== "local_codex" &&
        runtime.active_executor !== "creator_codex"
      ) {
        this.recordWorldJudgement({
          world,
          worldAgent,
          inputId: intentId,
          decision: automaticJudgement.decision,
          decisionSource: "automatic",
          reasonText: automaticJudgement.reasonText,
          outcomeText: automaticJudgement.outcomeText,
          result: automaticJudgement.result,
          worldStatePatch: automaticJudgement.worldStatePatch,
          memberStatePatch: automaticJudgement.memberStatePatch,
          targetPetId: actor.id,
          resolutionDisposition: automaticDisposition,
          expectedWorldStateVersion:
            expectedWorldStateVersion ??
            (automaticJudgement.worldStatePatchDerived
              ? worldStateBefore.version
              : undefined),
          expectedMemberStateVersion:
            expectedMemberStateVersion ??
            (hostDerivedMemberPatch ||
            automaticJudgement.memberStatePatchDerived
              ? memberStateBefore.version
              : undefined),
          timestamp,
        });
      }
      if (!interaction) {
        this.createInputHostGuidance(world, intentId, timestamp);
      }
    });
    if (interaction) {
      this.refreshWorldInteractions(world.id, timestamp);
    }
    this.touchWorldHostRuntime(world.id, timestamp);
    return this.worldIntentResult(intentId);
  }

  resolveWorldIntent({
    worldId,
    intentId,
    decision,
    reasonText,
    outcomeText = "",
    result = {},
    worldStatePatch,
    memberStatePatch,
    targetPetId,
    expectedWorldStateVersion,
    expectedMemberStateVersion,
    expectedHostRuntimeVersion,
    resolutionDisposition,
    applyProposedState = true,
    [WORLD_HOST_CLAIM_AUTHORIZATION]: hostClaimAuthorized = false,
    [PLATFORM_HOST_AUTHORIZATION]: platformHostAuthorized = false,
  }) {
    if (platformHostAuthorized && !this.platformHostExecutor) {
      fail("FORBIDDEN", "Platform World Host executor permission is required.");
    }
    const actor = platformHostAuthorized ? null : this.requirePet();
    const world = this.requireSpace(worldId);
    if (platformHostAuthorized) {
      // The local Codex runner is a platform executor bound to this World Agent.
    } else if (hostClaimAuthorized) {
      this.requireHostOperator(world, actor.id);
    } else {
      this.requireManager(world, actor.id);
    }
    const worldAgent = this.requireWorldAgent(world.id);
    if (worldAgent.status !== "active") {
      fail("WORLD_AGENT_PAUSED", "The World Agent is paused.");
    }
    if (!platformHostAuthorized) {
      const membership = this.requireActiveMembership(world.id, actor.id);
      if (membership.accepted_rule_version !== world.current_rule_version) {
        fail("RULE_VERSION_MISMATCH", "Accept the current world rules first.", {
          current_rule_version: world.current_rule_version,
        });
      }
    }
    const normalizedDecision = enumValue(
      decision,
      "decision",
      OUTCOME_DECISIONS,
    );
    const intent = this.db
      .prepare(`
        SELECT * FROM world_events
        WHERE id = ? AND space_id = ? AND event_class = 'intent'
      `)
      .get(intentId, world.id);
    if (!intent) fail("NOT_FOUND", "World intent not found.");
    const input = this.db
      .prepare("SELECT * FROM world_inputs WHERE id = ? AND space_id = ?")
      .get(intent.id, world.id);
    if (!input) fail("DATA_ERROR", "World input record is missing.");
    const existingOutcome = this.outcomeForIntent(intent.id);
    if (existingOutcome) {
      const existingDecision =
        parseJsonObject(existingOutcome.payload_json).decision;
      if (existingDecision !== normalizedDecision) {
        fail("INTENT_ALREADY_RESOLVED", "This intent already has an outcome.");
      }
      return this.worldIntentResult(intent.id);
    }
    const proposed = parseJsonObject(input.data_json);
    if (typeof applyProposedState !== "boolean") {
      fail("INVALID_ARGUMENT", "apply proposed state must be a boolean.");
    }
    const worldPatch =
      optionalJsonObject(worldStatePatch, "world state patch") ??
      (applyProposedState ? proposed.proposed_world_state_patch : undefined);
    const memberPatch =
      optionalJsonObject(memberStatePatch, "member state patch") ??
      (applyProposedState ? proposed.proposed_member_state_patch : undefined);
    if (
      normalizedDecision !== "accepted" &&
      (worldStatePatch !== undefined || memberStatePatch !== undefined)
    ) {
      fail("INVALID_ARGUMENT", "Only accepted outcomes can change state.");
    }
    const normalizedReason = optionalText(reasonText, "reason text", {
      max: 4000,
    });
    const normalizedResult = jsonObject(result, "judgement result");
    const normalizedOutcomeText = text(outcomeText, "outcome text", {
      max: 4000,
    });
    const targetId = targetPetId ?? intent.actor_pet_id;
    if (targetId) this.requireActiveMembership(world.id, targetId);
    const timestamp = now();
    withTransaction(this.db, () => {
      if (platformHostAuthorized) {
        const expectedRuntimeVersion = integer(
          expectedHostRuntimeVersion,
          "expected Host runtime version",
          { min: 1 },
        );
        const lockedRuntime = this.db
          .prepare(`
            SELECT active_executor, runtime_version
            FROM world_host_runtimes WHERE space_id = ?
          `)
          .get(world.id);
        if (
          lockedRuntime?.active_executor !== "platform" ||
          Number(lockedRuntime.runtime_version) !== expectedRuntimeVersion
        ) {
          fail(
            "WORLD_HOST_EXECUTOR_CHANGED",
            "World Host execution authority changed while the platform Host was deciding.",
            {
              expected_runtime_version: expectedRuntimeVersion,
              current_runtime_version: Number(lockedRuntime?.runtime_version ?? 0),
              active_executor: lockedRuntime?.active_executor ?? null,
            },
          );
        }
      }
      const currentWorldState = this.worldStateView(world.id);
      const isStale = Number(input.world_state_version) < currentWorldState.version;
      if (isStale && resolutionDisposition === undefined) {
        fail(
          "STALE_WORLD_INPUT",
          "The World changed after this input was composed. Choose a resolution disposition.",
          this.worldInputConcurrency(world, input, currentWorldState),
        );
      }
      const normalizedDisposition = enumValue(
        resolutionDisposition ?? "apply",
        "resolution disposition",
        WORLD_INPUT_DISPOSITIONS,
      );
      if (isStale && normalizedDisposition === "apply") {
        fail(
          "STALE_WORLD_INPUT",
          "A stale World input cannot be applied without reconciliation.",
          this.worldInputConcurrency(world, input, currentWorldState),
        );
      }
      if (!isStale && normalizedDisposition !== "apply") {
        fail(
          "INVALID_ARGUMENT",
          "A fresh World input must use the apply disposition.",
        );
      }
      if (normalizedDisposition === "conflict" && normalizedDecision === "accepted") {
        fail("INVALID_ARGUMENT", "A conflicted input cannot be accepted.");
      }
      if (normalizedDisposition === "expired" && normalizedDecision !== "rejected") {
        fail("INVALID_ARGUMENT", "An expired input must be rejected.");
      }
      if (expectedWorldStateVersion !== undefined) {
        const expected = integer(
          expectedWorldStateVersion,
          "expected world state version",
          { min: 1 },
        );
        if (expected !== currentWorldState.version) {
          fail("STATE_VERSION_MISMATCH", "The world state has changed.", {
            expected_world_state_version: expected,
            current_world_state_version: currentWorldState.version,
          });
        }
      }
      this.recordWorldJudgement({
        world,
        worldAgent,
        inputId: intent.id,
        decision: normalizedDecision,
        decisionSource: platformHostAuthorized ? "platform" : "creator_review",
        reasonText:
          normalizedReason ??
          (platformHostAuthorized
            ? "The bound local Codex World Host reviewed the input."
            : hostClaimAuthorized
            ? "The active World Host reviewed the input."
            : "World creator or administrator reviewed the input."),
        outcomeText:
          normalizedOutcomeText ||
          ({
            accepted: `${worldAgent.display_name ?? "世界主持"}根据复核接受了这个输入。`,
            rejected: `${worldAgent.display_name ?? "世界主持"}根据复核拒绝了这个输入。`,
            clarification: `${worldAgent.display_name ?? "世界主持"}需要成员补充信息后再继续。`,
            escalated: `${worldAgent.display_name ?? "世界主持"}已把这个输入升级为需要进一步处理的事项。`,
          })[normalizedDecision],
        result: normalizedResult,
        worldStatePatch:
          normalizedDecision === "accepted" && worldPatch !== undefined
            ? jsonObject(worldPatch, "world state patch")
            : undefined,
        memberStatePatch:
          normalizedDecision === "accepted" && memberPatch !== undefined
            ? jsonObject(memberPatch, "member state patch")
            : undefined,
        targetPetId: targetId,
        resolutionDisposition: normalizedDisposition,
        expectedWorldStateVersion:
          expectedWorldStateVersion ??
          (worldPatch !== undefined
            ? Number(input.world_state_version)
            : undefined),
        expectedMemberStateVersion:
          expectedMemberStateVersion ??
          (memberPatch !== undefined
            ? Number(input.member_state_version)
            : undefined),
        reviewedByPetId: actor?.id ?? null,
        timestamp,
      });
      this.createInputHostGuidance(world, intent.id, timestamp);
    });
    return this.worldIntentResult(intent.id);
  }

  createWorldTrigger({
    worldId,
    triggerKind,
    triggerAt,
    eventType,
    instructionText,
    payload = {},
    visibility = "world",
  }) {
    const actor = this.requirePet();
    const world = this.requireSpace(worldId);
    this.requireManager(world, actor.id);
    const kind = enumValue(triggerKind, "trigger kind", TRIGGER_KINDS);
    const normalizedAt =
      triggerAt === undefined ? null : isoTimestamp(triggerAt, "trigger at");
    const normalizedEventType =
      eventType === undefined
        ? null
        : text(eventType, "event type", { min: 1, max: 80 });
    if (kind === "at" && !normalizedAt) {
      fail("INVALID_ARGUMENT", "A time trigger requires trigger_at.");
    }
    if (kind === "event" && !normalizedEventType) {
      fail("INVALID_ARGUMENT", "An event trigger requires event_type.");
    }
    const normalizedInstruction = text(
      instructionText,
      "instruction text",
      { min: 1, max: 4000 },
    );
    const normalizedPayload = jsonObject(payload, "trigger payload");
    const normalizedVisibility = enumValue(
      visibility,
      "trigger visibility",
      EVENT_VISIBILITIES,
    );
    const id = randomUUID();
    const timestamp = now();
    this.db
      .prepare(`
        INSERT INTO world_triggers (
          id, space_id, created_by_pet_id, trigger_kind, trigger_at,
          event_type, instruction_text, payload_json, visibility, status,
          spec_version, fired_event_id, created_at, fired_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, NULL, ?, NULL)
      `)
      .run(
        id,
        world.id,
        actor.id,
        kind,
        normalizedAt,
        normalizedEventType,
        normalizedInstruction,
        JSON.stringify(normalizedPayload),
        normalizedVisibility,
        world.current_spec_version,
        timestamp,
      );
    this.audit(actor.id, "world.trigger_created", "world", world.id, {
      trigger_id: id,
      trigger_kind: kind,
    });
    return this.worldTriggerView(id);
  }

  listWorldTriggers({ worldId, status } = {}) {
    const actor = this.requirePet();
    const world = this.requireSpace(worldId);
    this.requireManager(world, actor.id);
    const normalizedStatus =
      status === undefined
        ? null
        : enumValue(
            status,
            "trigger status",
            new Set(["scheduled", "fired", "cancelled"]),
          );
    this.materializeDueTriggers(world.id);
    const rows = normalizedStatus
      ? this.db
          .prepare(`
            SELECT * FROM world_triggers
            WHERE space_id = ? AND status = ?
            ORDER BY created_at ASC
          `)
          .all(world.id, normalizedStatus)
      : this.db
          .prepare(`
            SELECT * FROM world_triggers
            WHERE space_id = ?
            ORDER BY created_at ASC
          `)
          .all(world.id);
    return { world_id: world.id, triggers: rows.map((row) => this.triggerView(row)) };
  }

  cancelWorldTrigger({ worldId, triggerId }) {
    const actor = this.requirePet();
    const world = this.requireSpace(worldId);
    this.requireManager(world, actor.id);
    const trigger = this.db
      .prepare("SELECT * FROM world_triggers WHERE id = ? AND space_id = ?")
      .get(triggerId, world.id);
    if (!trigger) fail("NOT_FOUND", "World trigger not found.");
    if (trigger.status === "fired") {
      fail("TRIGGER_ALREADY_FIRED", "A fired trigger cannot be cancelled.");
    }
    this.db
      .prepare(`
        UPDATE world_triggers
        SET status = 'cancelled'
        WHERE id = ? AND status = 'scheduled'
      `)
      .run(trigger.id);
    return this.worldTriggerView(trigger.id);
  }

  leaveSpace() {
    const actor = this.requirePet();
    const current = this.db
      .prepare("SELECT space_id FROM presence WHERE pet_id = ?")
      .get(actor.id);
    if (!current) return { left_space_id: null };
    const timestamp = now();
    withTransaction(this.db, () => {
      this.db.prepare("DELETE FROM presence WHERE pet_id = ?").run(actor.id);
      this.db
        .prepare(`
          UPDATE world_sessions
          SET status = 'closed', last_active_at = ?, closed_at = ?
          WHERE pet_id = ? AND space_id = ? AND status = 'active'
        `)
        .run(timestamp, timestamp, actor.id, current.space_id);
      const latestSequence = Number(
        this.db
          .prepare(`
            SELECT COALESCE(MAX(sequence), 0) AS sequence
            FROM world_events WHERE space_id = ?
          `)
          .get(current.space_id).sequence,
      );
      this.db
        .prepare(`
          UPDATE world_member_journeys
          SET multiplayer_consent = 'pending', last_left_at = ?,
            last_departure_sequence = ?, updated_at = ?
          WHERE space_id = ? AND pet_id = ?
        `)
        .run(
          timestamp,
          latestSequence,
          timestamp,
          current.space_id,
          actor.id,
        );
      this.db
        .prepare(`
          UPDATE world_member_journeys
          SET multiplayer_consent = 'pending', updated_at = ?
          WHERE space_id = ? AND pet_id IN (
            SELECT pet_id FROM presence WHERE space_id = ?
          )
        `)
        .run(timestamp, current.space_id, current.space_id);
    });
    this.audit(actor.id, "space.left", "space", current.space_id);
    const world = this.requireSpace(current.space_id);
    return {
      left_space_id: current.space_id,
      host_runtime: this.worldHostRuntimeDetails(world, actor, timestamp),
    };
  }

  leaveWorld({ worldId } = {}) {
    const actor = this.requirePet();
    const current = this.db
      .prepare("SELECT space_id FROM presence WHERE pet_id = ?")
      .get(actor.id);
    if (!current) {
      return { world_id: worldId ?? null, left: false, host_runtime: null };
    }
    if (worldId !== undefined && current.space_id !== worldId) {
      fail("WORLD_NOT_ENTERED", "The Character is not currently inside this world.");
    }
    const result = this.leaveSpace();
    return {
      world_id: result.left_space_id,
      left: true,
      host_runtime: result.host_runtime,
    };
  }

  listWorldPresent({ worldId }) {
    const result = this.listPresent({ spaceId: worldId });
    return {
      world_id: result.space_id,
      pets: result.pets,
    };
  }

  listPresent({ spaceId }) {
    const actor = this.requirePet();
    this.touchWorldSession(spaceId, actor.id);
    this.reconcileWorldHostRuntime(spaceId);
    const ownPresence = this.db
      .prepare("SELECT space_id FROM presence WHERE pet_id = ?")
      .get(actor.id);
    if (!ownPresence || ownPresence.space_id !== spaceId) {
      fail(
        "SAME_SPACE_PRESENCE_REQUIRED",
        "Enter the space before viewing its present Characters.",
      );
    }
    const blockedRelationshipFilter = this.sharedIdentity
      ? `
          AND NOT EXISTS (
            SELECT 1 FROM friendships f
            WHERE f.status = 'blocked'
              AND (
                (f.requester_pet_id = ? AND f.addressee_pet_id = p.id)
                OR (f.requester_pet_id = p.id AND f.addressee_pet_id = ?)
              )
          )
        `
      : `
          AND NOT EXISTS (
            SELECT 1 FROM blocks b
            WHERE (b.blocker_pet_id = ? AND b.blocked_pet_id = p.id)
               OR (b.blocker_pet_id = p.id AND b.blocked_pet_id = ?)
          )
        `;
    const rows = this.db
      .prepare(`
        SELECT p.id, p.${this.petNameColumn} AS name, p.bio, pr.entered_at
        FROM presence pr
        JOIN pets p ON p.id = pr.pet_id
        WHERE pr.space_id = ?
          ${blockedRelationshipFilter}
        ORDER BY pr.entered_at ASC
        LIMIT 50
      `)
      .all(spaceId, actor.id, actor.id);
    return {
      space_id: spaceId,
      pets: rows.map((row) => ({
        id: row.id,
        name: row.name,
        bio: row.bio,
        is_self: row.id === actor.id,
        entered_at: row.entered_at,
      })),
    };
  }

  sendFriendRequest({ targetPetId, note = "" }) {
    const actor = this.requirePet();
    const target = this.requirePetById(targetPetId);
    if (target.id === actor.id) {
      fail("INVALID_ARGUMENT", "You cannot add yourself as a friend.");
    }
    this.ensureNoBlock(actor.id, target.id);
    if (this.areFriends(actor.id, target.id)) {
      fail("ALREADY_FRIENDS", "These Characters are already friends.");
    }
    const shared = this.db
      .prepare(`
        SELECT p1.space_id, s.friend_policy
        FROM presence p1
        JOIN presence p2 ON p2.space_id = p1.space_id
        JOIN spaces s ON s.id = p1.space_id
        WHERE p1.pet_id = ? AND p2.pet_id = ?
      `)
      .get(actor.id, target.id);
    if (!shared) {
      fail(
        "SHARED_SPACE_REQUIRED",
        "Both Characters must be present in the same space.",
      );
    }
    if (shared.friend_policy !== "enabled") {
      fail("FORBIDDEN", "This space does not allow friend requests.");
    }
    const existing = this.db
      .prepare(`
        SELECT id, sender_pet_id, recipient_pet_id
        FROM friend_requests
        WHERE status = 'pending'
          AND (
            (sender_pet_id = ? AND recipient_pet_id = ?)
            OR (sender_pet_id = ? AND recipient_pet_id = ?)
          )
      `)
      .get(actor.id, target.id, target.id, actor.id);
    if (existing) {
      fail("REQUEST_ALREADY_PENDING", "A friend request is already pending.", {
        request_id: existing.id,
      });
    }
    const id = randomUUID();
    const timestamp = now();
    const normalizedNote = text(note, "note", { max: 300 });
    this.db
      .prepare(`
        INSERT INTO friend_requests (
          id, sender_pet_id, recipient_pet_id, origin_space_id, note, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
      `)
      .run(
        id,
        actor.id,
        target.id,
        shared.space_id,
        normalizedNote,
        timestamp,
        timestamp,
      );
    this.audit(actor.id, "friend_request.sent", "friend_request", id, {
      target_pet_id: target.id,
      origin_space_id: shared.space_id,
    });
    return {
      id,
      recipient: petView(target),
      origin_space_id: shared.space_id,
      note: normalizedNote,
      status: "pending",
    };
  }

  listFriendRequests() {
    const actor = this.requirePet();
    const rows = this.db
      .prepare(`
        SELECT fr.*, p.${this.petNameColumn} AS name, p.bio,
          s.name AS origin_space_name
        FROM friend_requests fr
        JOIN pets p ON p.id = fr.sender_pet_id
        JOIN spaces s ON s.id = fr.origin_space_id
        WHERE fr.recipient_pet_id = ? AND fr.status = 'pending'
          AND NOT EXISTS (
            SELECT 1 FROM blocks b
            WHERE (b.blocker_pet_id = ? AND b.blocked_pet_id = fr.sender_pet_id)
               OR (b.blocker_pet_id = fr.sender_pet_id AND b.blocked_pet_id = ?)
          )
        ORDER BY fr.created_at ASC
      `)
      .all(actor.id, actor.id, actor.id);
    return {
      requests: rows.map((row) => ({
        id: row.id,
        sender: { id: row.sender_pet_id, name: row.name, bio: row.bio },
        origin_space: {
          id: row.origin_space_id,
          name: row.origin_space_name,
        },
        note: row.note,
        created_at: row.created_at,
      })),
    };
  }

  respondFriendRequest({ requestId, decision }) {
    const actor = this.requirePet();
    const normalizedDecision = enumValue(
      decision,
      "decision",
      new Set(["accepted", "rejected"]),
    );
    const request = this.db
      .prepare("SELECT * FROM friend_requests WHERE id = ?")
      .get(requestId);
    if (
      !request ||
      request.recipient_pet_id !== actor.id ||
      request.status !== "pending"
    ) {
      fail("NOT_FOUND", "Pending friend request not found.");
    }
    this.ensureNoBlock(request.sender_pet_id, request.recipient_pet_id);
    const timestamp = now();
    withTransaction(this.db, () => {
      this.db
        .prepare(`
          UPDATE friend_requests SET status = ?, updated_at = ? WHERE id = ?
        `)
        .run(normalizedDecision, timestamp, request.id);
      if (normalizedDecision === "accepted") {
        const [petA, petB] = pair(
          request.sender_pet_id,
          request.recipient_pet_id,
        );
        this.db
          .prepare(`
            INSERT OR IGNORE INTO friendships (pet_a_id, pet_b_id, created_at)
            VALUES (?, ?, ?)
          `)
          .run(petA, petB, timestamp);
      }
      this.audit(
        actor.id,
        "friend_request.responded",
        "friend_request",
        request.id,
        { decision: normalizedDecision },
      );
    });
    return { request_id: request.id, status: normalizedDecision };
  }

  listFriends() {
    const actor = this.requirePet();
    const rows = this.db
      .prepare(`
        SELECT p.id, p.${this.petNameColumn} AS name, p.bio,
          CASE WHEN pr.pet_id IS NULL THEN 0 ELSE 1 END AS reachable
        FROM friendships f
        JOIN pets p ON p.id = CASE
          WHEN f.pet_a_id = ? THEN f.pet_b_id ELSE f.pet_a_id END
        LEFT JOIN presence pr ON pr.pet_id = p.id
        WHERE (f.pet_a_id = ? OR f.pet_b_id = ?)
          AND NOT EXISTS (
            SELECT 1 FROM blocks b
            WHERE (b.blocker_pet_id = ? AND b.blocked_pet_id = p.id)
               OR (b.blocker_pet_id = p.id AND b.blocked_pet_id = ?)
          )
        ORDER BY p.${this.petNameColumn} COLLATE NOCASE
      `)
      .all(actor.id, actor.id, actor.id, actor.id, actor.id);
    return {
      friends: rows.map((row) => ({
        id: row.id,
        name: row.name,
        bio: row.bio,
        reachable: Boolean(row.reachable),
      })),
    };
  }

  removeFriend({ targetPetId }) {
    const actor = this.requirePet();
    this.requirePetById(targetPetId);
    const [petA, petB] = pair(actor.id, targetPetId);
    const result = this.db
      .prepare("DELETE FROM friendships WHERE pet_a_id = ? AND pet_b_id = ?")
      .run(petA, petB);
    if (Number(result.changes) === 0) {
      fail("FRIENDSHIP_REQUIRED", "No active friendship exists.");
    }
    this.audit(actor.id, "friend.removed", "pet", targetPetId);
    return { removed_friend_pet_id: targetPetId };
  }

  blockPet({ targetPetId }) {
    const actor = this.requirePet();
    const target = this.requirePetById(targetPetId);
    if (target.id === actor.id) {
      fail("INVALID_ARGUMENT", "You cannot block yourself.");
    }
    withTransaction(this.db, () => {
      this.db
        .prepare(`
          INSERT OR IGNORE INTO blocks (
            blocker_pet_id, blocked_pet_id, created_at
          ) VALUES (?, ?, ?)
        `)
        .run(actor.id, target.id, now());
      this.db
        .prepare(`
          UPDATE friend_requests
          SET status = 'cancelled', updated_at = ?
          WHERE status = 'pending'
            AND (
              (sender_pet_id = ? AND recipient_pet_id = ?)
              OR (sender_pet_id = ? AND recipient_pet_id = ?)
            )
        `)
        .run(now(), actor.id, target.id, target.id, actor.id);
      const [petA, petB] = pair(actor.id, target.id);
      this.db
        .prepare(`
          DELETE FROM friendships WHERE pet_a_id = ? AND pet_b_id = ?
        `)
        .run(petA, petB);
      this.audit(actor.id, "pet.blocked", "pet", target.id);
    });
    return { blocked_pet: petView(target) };
  }

  unblockPet({ targetPetId }) {
    const actor = this.requirePet();
    this.requirePetById(targetPetId);
    this.db
      .prepare(`
        DELETE FROM blocks WHERE blocker_pet_id = ? AND blocked_pet_id = ?
      `)
      .run(actor.id, targetPetId);
    this.audit(actor.id, "pet.unblocked", "pet", targetPetId);
    return { unblocked_pet_id: targetPetId };
  }

  sendMessage({ targetPetId, body }) {
    const actor = this.requirePet();
    const target = this.requirePetById(targetPetId);
    this.ensureNoBlock(actor.id, target.id);
    if (!this.areFriends(actor.id, target.id)) {
      fail("FRIENDSHIP_REQUIRED", "Private messages require friendship.");
    }
    const normalizedBody = text(body, "body", {
      min: 1,
      max: 4000,
      trim: false,
    });
    const id = randomUUID();
    const timestamp = now();
    this.db
      .prepare(`
        INSERT INTO messages (
          id, sender_pet_id, recipient_pet_id, body, created_at, read_at
        ) VALUES (?, ?, ?, ?, ?, NULL)
      `)
      .run(id, actor.id, target.id, normalizedBody, timestamp);
    this.audit(actor.id, "message.sent", "message", id, {
      recipient_pet_id: target.id,
    });
    return {
      id,
      recipient: petView(target),
      body: normalizedBody,
      created_at: timestamp,
    };
  }

  listInbox({ unreadOnly = false, limit = 20 } = {}) {
    const actor = this.requirePet();
    const boundedLimit = integer(limit, "limit", { min: 1, max: 50 });
    const rows = this.db
      .prepare(`
        SELECT m.*, p.${this.petNameColumn} AS sender_name
        FROM messages m
        JOIN pets p ON p.id = m.sender_pet_id
        WHERE m.recipient_pet_id = ?
          AND (? = 0 OR m.read_at IS NULL)
        ORDER BY m.created_at DESC
        LIMIT ?
      `)
      .all(actor.id, unreadOnly ? 1 : 0, boundedLimit);
    return {
      messages: rows.map((row) => ({
        id: row.id,
        sender: { id: row.sender_pet_id, name: row.sender_name },
        body: row.body,
        created_at: row.created_at,
        read_at: row.read_at,
        untrusted_external_content: true,
      })),
    };
  }

  markMessageRead({ messageId }) {
    const actor = this.requirePet();
    const result = this.db
      .prepare(`
        UPDATE messages SET read_at = COALESCE(read_at, ?)
        WHERE id = ? AND recipient_pet_id = ?
      `)
      .run(now(), messageId, actor.id);
    if (Number(result.changes) === 0) {
      fail("NOT_FOUND", "Message not found.");
    }
    const message = this.db
      .prepare("SELECT id, read_at FROM messages WHERE id = ?")
      .get(messageId);
    return { id: message.id, read_at: message.read_at };
  }

  requirePet() {
    const pet = this.sharedIdentity
      ? this.db
          .prepare(`
            SELECT *, display_name AS name
            FROM pets
            WHERE id = ? AND status = 'active'
          `)
          .get(this.actorKey)
      : this.db
          .prepare("SELECT * FROM pets WHERE account_key = ?")
          .get(this.actorKey);
    if (!pet) {
      fail(
        "PET_REQUIRED",
        "Create the account's Character identity before using social tools.",
      );
    }
    return pet;
  }

  requirePetById(petId) {
    const normalized = text(petId, "Character id", { min: 1, max: 100 });
    const pet = this.sharedIdentity
      ? this.db
          .prepare(`
            SELECT *, display_name AS name
            FROM pets
            WHERE id = ? AND status = 'active'
          `)
          .get(normalized)
      : this.db.prepare("SELECT * FROM pets WHERE id = ?").get(normalized);
    if (!pet) fail("NOT_FOUND", "Character not found.");
    return pet;
  }

  requireSpace(spaceId) {
    const normalized = text(spaceId, "space id", { min: 1, max: 100 });
    const space = this.db.prepare("SELECT * FROM spaces WHERE id = ?").get(normalized);
    if (!space) fail("NOT_FOUND", "Space not found.");
    return space;
  }

  requireWorldAgent(spaceId) {
    const agent = this.db
      .prepare("SELECT * FROM world_agents WHERE space_id = ?")
      .get(spaceId);
    if (!agent) fail("DATA_ERROR", "World Agent is missing.");
    return agent;
  }

  ensureWorldHostRuntime(spaceId, timestamp = now()) {
    const agent = this.requireWorldAgent(spaceId);
    this.db
      .prepare(`
        INSERT OR IGNORE INTO world_host_runtimes (
          world_agent_id, space_id, execution_policy, status, active_executor,
          runtime_version, activation_count, created_at, updated_at
        ) VALUES (?, ?, 'platform_on_demand_with_creator_takeover', 'idle',
          'platform', 1, 0, ?, ?)
      `)
      .run(agent.id, spaceId, timestamp, timestamp);
    this.db
      .prepare(`
        INSERT OR IGNORE INTO world_host_executors (
          world_agent_id, space_id, provider, status, context_version,
          last_event_sequence, created_at, updated_at
        ) VALUES (?, ?, 'local_codex', 'unbound', 1, 0, ?, ?)
      `)
      .run(agent.id, spaceId, timestamp, timestamp);
    return this.db
      .prepare("SELECT * FROM world_host_runtimes WHERE space_id = ?")
      .get(spaceId);
  }

  activeWorldMemberCount(spaceId, timestamp = now()) {
    this.expireWorldSessions(spaceId, timestamp);
    return Number(
      this.db
        .prepare(`
          SELECT COUNT(DISTINCT live_presence.pet_id) AS count
          FROM presence live_presence
          JOIN world_sessions session
            ON session.space_id = live_presence.space_id
            AND session.pet_id = live_presence.pet_id
            AND session.status = 'active'
          WHERE live_presence.space_id = ?
        `)
        .get(spaceId).count,
    );
  }

  expireWorldSessions(spaceId, timestamp = now()) {
    const cutoff = new Date(
      Date.parse(timestamp) - WORLD_LIVE_SESSION_TTL_MS,
    ).toISOString();
    const candidates = this.db
      .prepare(`
        SELECT DISTINCT pet_id
        FROM world_sessions
        WHERE space_id = ? AND status = 'active'
          AND (
            last_active_at < ?
            OR NOT EXISTS (
              SELECT 1 FROM presence live_presence
              WHERE live_presence.space_id = world_sessions.space_id
                AND live_presence.pet_id = world_sessions.pet_id
            )
          )
      `)
      .all(spaceId, cutoff)
      .map((row) => row.pet_id);
    this.db
      .prepare(`
        UPDATE world_sessions
        SET status = 'closed', closed_at = COALESCE(closed_at, ?)
        WHERE space_id = ? AND status = 'active'
          AND (
            last_active_at < ?
            OR NOT EXISTS (
              SELECT 1 FROM presence live_presence
              WHERE live_presence.space_id = world_sessions.space_id
                AND live_presence.pet_id = world_sessions.pet_id
            )
          )
      `)
      .run(timestamp, spaceId, cutoff);
    this.db
      .prepare(`
        DELETE FROM presence
        WHERE space_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM world_sessions session
            WHERE session.space_id = presence.space_id
              AND session.pet_id = presence.pet_id
              AND session.status = 'active'
          )
      `)
      .run(spaceId);
    const departedPetIds = candidates.filter(
      (petId) =>
        !this.db
          .prepare("SELECT 1 FROM presence WHERE space_id = ? AND pet_id = ?")
          .get(spaceId, petId),
    );
    if (departedPetIds.length === 0) return;
    const latestSequence = Number(
      this.db
        .prepare(`
          SELECT COALESCE(MAX(sequence), 0) AS sequence
          FROM world_events WHERE space_id = ?
        `)
        .get(spaceId).sequence,
    );
    const recordDeparture = this.db.prepare(`
      UPDATE world_member_journeys
      SET multiplayer_consent = 'pending', last_left_at = ?,
        last_departure_sequence = ?, updated_at = ?
      WHERE space_id = ? AND pet_id = ?
    `);
    for (const petId of departedPetIds) {
      recordDeparture.run(
        timestamp,
        latestSequence,
        timestamp,
        spaceId,
        petId,
      );
    }
    this.db
      .prepare(`
        UPDATE world_member_journeys
        SET multiplayer_consent = 'pending', updated_at = ?
        WHERE space_id = ? AND pet_id IN (
          SELECT pet_id FROM presence WHERE space_id = ?
        )
      `)
      .run(timestamp, spaceId, spaceId);
  }

  reconcileWorldHostRuntime(spaceId, timestamp = now()) {
    let runtime = this.ensureWorldHostRuntime(spaceId, timestamp);
    const activeMemberCount = this.activeWorldMemberCount(spaceId, timestamp);
    const claimantPresent =
      runtime.claimed_by_pet_id === null
        ? false
        : Boolean(
            this.db
              .prepare(`
                SELECT 1 FROM presence
                WHERE space_id = ? AND pet_id = ?
              `)
              .get(spaceId, runtime.claimed_by_pet_id),
          );
    const leaseActive =
      runtime.lease_expires_at !== null &&
      runtime.lease_expires_at > timestamp;
    const keepCreatorExecutor =
      runtime.active_executor === "creator_codex" &&
      claimantPresent &&
      leaseActive;
    const nextStatus = activeMemberCount > 0 ? "active" : "idle";
    const nextExecutor = keepCreatorExecutor ? "creator_codex" : "platform";
    const claimMustClear = nextExecutor === "platform";
    const statusChanged = runtime.status !== nextStatus;
    const executorChanged = runtime.active_executor !== nextExecutor;
    const staleClaim =
      claimMustClear &&
      (runtime.claimed_by_pet_id !== null ||
        runtime.claimed_principal_user_id !== null ||
        runtime.claim_session_id !== null ||
        runtime.lease_expires_at !== null);
    if (statusChanged || executorChanged || staleClaim) {
      this.db
        .prepare(`
          UPDATE world_host_runtimes
          SET status = ?,
            active_executor = ?,
            claimed_by_pet_id = ?,
            claimed_principal_user_id = ?,
            claim_session_id = ?,
            lease_expires_at = ?,
            runtime_version = runtime_version + 1,
            activation_count = activation_count + ?,
            activated_at = CASE WHEN ? = 1 THEN ? ELSE activated_at END,
            deactivated_at = CASE WHEN ? = 1 THEN ? ELSE deactivated_at END,
            last_active_at = CASE
              WHEN ? = 'active' THEN COALESCE(last_active_at, ?)
              ELSE last_active_at
            END,
            updated_at = ?
          WHERE space_id = ?
        `)
        .run(
          nextStatus,
          nextExecutor,
          claimMustClear ? null : runtime.claimed_by_pet_id,
          claimMustClear ? null : runtime.claimed_principal_user_id,
          claimMustClear ? null : runtime.claim_session_id,
          claimMustClear ? null : runtime.lease_expires_at,
          runtime.status === "idle" && nextStatus === "active" ? 1 : 0,
          runtime.status === "idle" && nextStatus === "active" ? 1 : 0,
          timestamp,
          runtime.status === "active" && nextStatus === "idle" ? 1 : 0,
          timestamp,
          nextStatus,
          timestamp,
          timestamp,
          spaceId,
        );
      runtime = this.db
        .prepare("SELECT * FROM world_host_runtimes WHERE space_id = ?")
        .get(spaceId);
    }
    return { runtime, activeMemberCount };
  }

  worldHostRuntimeDetails(space, actor, timestamp = now()) {
    const { runtime, activeMemberCount } = this.reconcileWorldHostRuntime(
      space.id,
      timestamp,
    );
    const executor = this.db
      .prepare("SELECT status FROM world_host_executors WHERE space_id = ?")
      .get(space.id);
    return hostRuntimeView(runtime, {
      activeMemberCount,
      canTakeover: this.canHostWorld(space, actor.id),
      actorPetId: actor.id,
      localCodexEnabled: this.platformHostMode === "local_codex",
      executorStatus: executor?.status ?? "unbound",
    });
  }

  touchWorldHostRuntime(spaceId, timestamp = now()) {
    this.ensureWorldHostRuntime(spaceId, timestamp);
    this.db
      .prepare(`
        UPDATE world_host_runtimes
        SET last_active_at = ?, updated_at = ?
        WHERE space_id = ?
      `)
      .run(timestamp, timestamp, spaceId);
  }

  touchWorldSession(spaceId, petId, timestamp = now()) {
    this.db
      .prepare(`
        UPDATE world_sessions
        SET last_active_at = ?
        WHERE space_id = ? AND pet_id = ? AND status = 'active'
          AND EXISTS (
            SELECT 1 FROM presence live_presence
            WHERE live_presence.space_id = world_sessions.space_id
              AND live_presence.pet_id = world_sessions.pet_id
          )
      `)
      .run(timestamp, spaceId, petId);
  }

  heartbeatWorldPresence({ codexOpen }) {
    const actor = this.requirePet();
    if (codexOpen !== true) {
      return { pet_id: actor.id, touched_world_ids: [] };
    }
    const timestamp = now();
    const worlds = this.db
      .prepare(`
        SELECT DISTINCT session.space_id
        FROM world_sessions session
        JOIN presence live_presence
          ON live_presence.space_id = session.space_id
          AND live_presence.pet_id = session.pet_id
        WHERE session.pet_id = ? AND session.status = 'active'
      `)
      .all(actor.id);
    for (const world of worlds) {
      this.touchWorldSession(world.space_id, actor.id, timestamp);
      this.reconcileWorldHostRuntime(world.space_id, timestamp);
    }
    return {
      pet_id: actor.id,
      touched_world_ids: worlds.map((world) => world.space_id),
    };
  }

  requireLiveWorldPresence(spaceId, petId) {
    const presence = this.db
      .prepare(`
        SELECT 1 FROM presence WHERE space_id = ? AND pet_id = ?
      `)
      .get(spaceId, petId);
    const activeSession = this.db
      .prepare(`
        SELECT 1 FROM world_sessions
        WHERE space_id = ? AND pet_id = ? AND status = 'active'
        LIMIT 1
      `)
      .get(spaceId, petId);
    if (!presence || !activeSession) {
      fail(
        "WORLD_NOT_ENTERED",
        "Enter the world before participating in its live interaction.",
      );
    }
  }

  requireCreatorHostClaim(world, actor, clientSessionId, timestamp = now()) {
    const normalizedSessionId = text(
      clientSessionId ?? this.principalSessionId,
      "client session id",
      { min: 1, max: 200 },
    );
    const { runtime } = this.reconcileWorldHostRuntime(world.id, timestamp);
    if (
      runtime.status !== "active" ||
      runtime.active_executor !== "creator_codex" ||
      runtime.claimed_by_pet_id !== actor.id ||
      runtime.claimed_principal_user_id !== this.principalUserId ||
      runtime.claim_session_id !== normalizedSessionId ||
      runtime.lease_expires_at === null ||
      runtime.lease_expires_at <= timestamp
    ) {
      fail(
        "WORLD_HOST_CLAIM_REQUIRED",
        "The current Agent session must hold the live Host claim.",
      );
    }
    return { runtime, clientSessionId: normalizedSessionId };
  }

  currentWorldHostConfig(spaceId) {
    const row = this.db
      .prepare(`
        SELECT agent.id AS world_agent_id, agent.space_id, agent.role,
          agent.agent_kind, agent.status, agent.current_version,
          version.display_name, version.persona_text, version.speaking_style,
          version.world_role,
          version.judgement_policy_json, version.memory_policy_json,
          version.output_schema_json, version.model_config_json,
          version.tool_allowlist_json, version.onboarding_policy_json,
          version.facilitation_policy_json, version.recap_policy_json,
          version.participation_policy_json, version.evolution_policy_json,
          version.proactivity, version.capabilities_json,
          version.created_by_agent_id
        FROM world_agents agent
        JOIN world_agent_versions version
          ON version.world_agent_id = agent.id
          AND version.version = agent.current_version
        WHERE agent.space_id = ?
      `)
      .get(spaceId);
    if (!row) fail("DATA_ERROR", "World Host configuration is missing.");
    return row;
  }

  getWorldHost({ worldId }) {
    const actor = this.requirePet();
    const world = this.requireSpace(worldId);
    const membership = this.membership(world.id, actor.id);
    if (
      world.publication_status !== "published" &&
      !this.canManage(world, actor.id)
    ) {
      fail("NOT_FOUND", "World not found.");
    }
    if (
      world.visibility !== "public" &&
      !this.canManage(world, actor.id) &&
      membership?.status !== "active"
    ) {
      fail("NOT_FOUND", "World not found.");
    }
    return {
      host: hostConfigView(this.currentWorldHostConfig(world.id)),
      runtime: this.worldHostRuntimeDetails(world, actor),
    };
  }

  getWorldHostRuntime({ worldId }) {
    const actor = this.requirePet();
    const world = this.requireSpace(worldId);
    const membership = this.membership(world.id, actor.id);
    if (
      world.publication_status !== "published" &&
      !this.canManage(world, actor.id)
    ) {
      fail("NOT_FOUND", "World not found.");
    }
    if (
      world.visibility !== "public" &&
      !this.canManage(world, actor.id) &&
      membership?.status !== "active"
    ) {
      fail("NOT_FOUND", "World not found.");
    }
    return { runtime: this.worldHostRuntimeDetails(world, actor) };
  }

  takeoverWorldHost({
    worldId,
    clientSessionId,
    leaseSeconds = 90,
  }) {
    const actor = this.requirePet();
    const world = this.requireSpace(worldId);
    this.requireHostOperator(world, actor.id);
    const membership = this.requireActiveMembership(world.id, actor.id);
    if (membership.accepted_rule_version !== world.current_rule_version) {
      fail("RULE_VERSION_MISMATCH", "Accept the current world rules first.", {
        current_rule_version: world.current_rule_version,
      });
    }
    this.requireLiveWorldPresence(world.id, actor.id);
    const normalizedSessionId = text(
      clientSessionId ?? this.principalSessionId,
      "client session id",
      { min: 1, max: 200 },
    );
    const activeSession = this.db
      .prepare(`
        SELECT 1 FROM world_sessions
        WHERE space_id = ? AND pet_id = ? AND principal_user_id = ?
          AND client_session_id = ? AND status = 'active'
      `)
      .get(
        world.id,
        actor.id,
        this.principalUserId,
        normalizedSessionId,
      );
    if (!activeSession) {
      fail(
        "WORLD_HOST_SESSION_MISMATCH",
        "Enter the world from this Agent session before taking over as Host.",
      );
    }
    const boundedLease = integer(leaseSeconds, "lease seconds", {
      min: 30,
      max: 300,
    });
    const timestamp = now();
    const { runtime } = this.reconcileWorldHostRuntime(world.id, timestamp);
    if (
      runtime.active_executor === "creator_codex" &&
      (runtime.claimed_by_pet_id !== actor.id ||
        runtime.claimed_principal_user_id !== this.principalUserId ||
        runtime.claim_session_id !== normalizedSessionId)
    ) {
      fail(
        "WORLD_HOST_ALREADY_CLAIMED",
        "Another creator Agent session is currently hosting this world.",
        { lease_expires_at: runtime.lease_expires_at },
      );
    }
    const leaseExpiresAt = new Date(
      Date.parse(timestamp) + boundedLease * 1000,
    ).toISOString();
    const changed = runtime.active_executor !== "creator_codex";
    this.db
      .prepare(`
        UPDATE world_host_runtimes
        SET status = 'active', active_executor = 'creator_codex',
          claimed_by_pet_id = ?, claimed_principal_user_id = ?,
          claim_session_id = ?, lease_expires_at = ?,
          runtime_version = runtime_version + ?,
          last_active_at = ?, updated_at = ?
        WHERE space_id = ?
      `)
      .run(
        actor.id,
        this.principalUserId,
        normalizedSessionId,
        leaseExpiresAt,
        changed ? 1 : 0,
        timestamp,
        timestamp,
        world.id,
      );
    this.audit(actor.id, "world_host.runtime_claimed", "world", world.id, {
      client_session_id: normalizedSessionId,
      lease_expires_at: leaseExpiresAt,
    });
    return {
      runtime: this.worldHostRuntimeDetails(world, actor, timestamp),
    };
  }

  heartbeatWorldHost({
    worldId,
    clientSessionId,
    leaseSeconds = 90,
  }) {
    const actor = this.requirePet();
    const world = this.requireSpace(worldId);
    this.requireHostOperator(world, actor.id);
    const boundedLease = integer(leaseSeconds, "lease seconds", {
      min: 30,
      max: 300,
    });
    const timestamp = now();
    this.touchWorldSession(world.id, actor.id, timestamp);
    const claim = this.requireCreatorHostClaim(
      world,
      actor,
      clientSessionId,
      timestamp,
    );
    const leaseExpiresAt = new Date(
      Date.parse(timestamp) + boundedLease * 1000,
    ).toISOString();
    this.db
      .prepare(`
        UPDATE world_host_runtimes
        SET lease_expires_at = ?, last_active_at = ?, updated_at = ?
        WHERE space_id = ? AND claim_session_id = ?
      `)
      .run(
        leaseExpiresAt,
        timestamp,
        timestamp,
        world.id,
        claim.clientSessionId,
      );
    return {
      runtime: this.worldHostRuntimeDetails(world, actor, timestamp),
    };
  }

  releaseWorldHost({ worldId, clientSessionId }) {
    const actor = this.requirePet();
    const world = this.requireSpace(worldId);
    this.requireHostOperator(world, actor.id);
    const timestamp = now();
    this.touchWorldSession(world.id, actor.id, timestamp);
    this.requireCreatorHostClaim(
      world,
      actor,
      clientSessionId,
      timestamp,
    );
    this.db
      .prepare(`
        UPDATE world_host_runtimes
        SET active_executor = 'platform', claimed_by_pet_id = NULL,
          claimed_principal_user_id = NULL, claim_session_id = NULL,
          lease_expires_at = NULL, runtime_version = runtime_version + 1,
          last_active_at = ?, updated_at = ?
        WHERE space_id = ?
      `)
      .run(timestamp, timestamp, world.id);
    this.audit(actor.id, "world_host.runtime_released", "world", world.id);
    return {
      runtime: this.worldHostRuntimeDetails(world, actor, timestamp),
    };
  }

  refreshWorldInteractions(spaceId, timestamp = now()) {
    // An empty collective window has no authoritative evidence to adjudicate.
    // Cancel it at its deadline instead of queuing a Host turn that can never
    // produce a participant-grounded outcome. This also releases the unique
    // active-window constraint after restart.
    const emptyExpired = this.db.prepare(`
        SELECT interaction.* FROM world_interactions interaction
        WHERE interaction.space_id = ? AND interaction.status = 'open'
          AND interaction.closes_at <= ?
          AND NOT EXISTS (
            SELECT 1 FROM world_inputs input
            WHERE input.interaction_id = interaction.id
          )
      `).all(spaceId, timestamp);
    for (const interaction of emptyExpired) {
      const cancelled = this.db.prepare(`
        UPDATE world_interactions
        SET status = 'cancelled', resolved_at = COALESCE(resolved_at, ?),
          host_last_error = COALESCE(host_last_error, 'NO_RESPONSES')
        WHERE id = ? AND status = 'open'
      `).run(timestamp, interaction.id);
      if (cancelled.changes !== 1) continue;
      enqueueWorldDelivery(this.db, {
        worldId: interaction.space_id,
        sourceWorldEventId: interaction.prompt_event_id,
        sourceInteractionId: interaction.id,
        eventType: "world.event_committed",
        dedupeKey: `world:${interaction.space_id}:interaction-cancelled:${interaction.id}`,
        envelope: {
          interactionId: interaction.id,
          sceneId: interaction.scene_id ?? null,
          outcomeText: "本轮集体互动在截止前无人回应，现已取消；没有产生集体决定或世界变化。",
          outcomeEventType: "world.interaction_cancelled",
          interactionStatus: "cancelled",
          closesAt: interaction.closes_at,
          visibility: "world",
          actorPetId: null,
        },
        timestamp,
      });
    }
    this.db
      .prepare(`
        UPDATE world_interactions
        SET status = 'ready', ready_at = COALESCE(ready_at, ?)
        WHERE space_id = ? AND status = 'open'
          AND (
            closes_at <= ?
            OR (
              mode = 'quorum'
              AND quorum IS NOT NULL
              AND (
                SELECT COUNT(*) FROM world_inputs input
                WHERE input.interaction_id = world_interactions.id
              ) >= quorum
            )
          )
      `)
      .run(timestamp, spaceId, timestamp);
  }

  worldInteractionView(row, actorPetId = null) {
    if (!row) return null;
    const responseCount = Number(
      this.db
        .prepare(`
          SELECT COUNT(*) AS count FROM world_inputs
          WHERE interaction_id = ?
        `)
        .get(row.id).count,
    );
    const hasResponded = actorPetId
      ? Boolean(
          this.db
            .prepare(`
              SELECT 1 FROM world_inputs
              WHERE interaction_id = ? AND actor_pet_id = ?
            `)
            .get(row.id, actorPetId),
        )
      : false;
    const promptEvent = this.db
      .prepare("SELECT body_text, payload_json FROM world_events WHERE id = ?")
      .get(row.prompt_event_id);
    const promptText = promptEvent?.body_text ?? "";
    const promptPayload = parseJsonObject(promptEvent?.payload_json);
    return {
      id: row.id,
      world_id: row.space_id,
      host_agent_id: row.world_agent_id,
      prompt_event_id: row.prompt_event_id,
      scene_id: row.scene_id ?? null,
      scene: row.scene_id
        ? this.worldSceneView(
            this.db.prepare("SELECT * FROM world_scenes WHERE id = ?").get(row.scene_id),
            actorPetId,
          )
        : null,
      prompt_text: promptText,
      coordination_rule: promptPayload.coordination_rule ?? "",
      choice_options: Array.isArray(promptPayload.choice_options) ? promptPayload.choice_options : [],
      mode: row.mode,
      status: row.status,
      base_world_state_version: Number(row.base_world_state_version),
      quorum: row.quorum === null ? null : Number(row.quorum),
      late_input_policy: row.late_input_policy,
      closes_at: row.closes_at,
      response_count: responseCount,
      has_responded: hasResponded,
      created_at: row.created_at,
      ready_at: row.ready_at ?? null,
      resolved_at: row.resolved_at ?? null,
    };
  }

  activeWorldInteractions(spaceId, actorPetId = null, timestamp = now()) {
    this.refreshWorldInteractions(spaceId, timestamp);
    const rows = actorPetId
      ? this.db.prepare(`
          SELECT interaction.* FROM world_interactions interaction
          WHERE interaction.space_id = ?
            AND interaction.status IN ('open', 'ready')
            AND (
              interaction.scene_id IS NULL OR EXISTS (
                SELECT 1 FROM world_scene_participants participant
                WHERE participant.scene_id = interaction.scene_id
                  AND participant.pet_id = ?
                  AND participant.status IN ('invited', 'active')
              )
            )
          ORDER BY interaction.created_at ASC
        `).all(spaceId, actorPetId)
      : this.db.prepare(`
          SELECT * FROM world_interactions
          WHERE space_id = ? AND status IN ('open', 'ready')
          ORDER BY created_at ASC
        `).all(spaceId);
    return rows
      .map((row) => this.worldInteractionView(row, actorPetId));
  }

  openWorldHostInteraction({
    worldId,
    clientSessionId,
    promptText,
    eventType = "host.collective_prompt",
    mode = "windowed",
    windowSeconds,
    quorum,
    lateInputPolicy = "follow_up",
    coordinationRule,
    expectedWorldStateVersion,
    sceneId,
    choiceOptions,
  }) {
    const actor = this.requirePet();
    const world = this.requireSpace(worldId);
    this.requireHostOperator(world, actor.id);
    const timestamp = now();
    this.touchWorldSession(world.id, actor.id, timestamp);
    this.requireCreatorHostClaim(world, actor, clientSessionId, timestamp);
    const normalizedPrompt = text(promptText, "interaction prompt", {
      min: 1,
      max: 3000,
    });
    const normalizedEventType = text(eventType, "interaction event type", {
      min: 1,
      max: 80,
    });
    const normalizedMode = enumValue(
      mode,
      "interaction mode",
      WORLD_INTERACTION_MODES,
    );
    const normalizedSceneId =
      sceneId === undefined || sceneId === null
        ? null
        : text(sceneId, "scene id", { min: 1, max: 100 });
    const sceneInteractionPolicy = normalizedSceneId
      ? this.db.prepare(`
          SELECT interaction_policy FROM world_scenes
          WHERE id = ? AND space_id = ?
        `).get(normalizedSceneId, world.id)?.interaction_policy ?? null
      : null;
    const windowContract = sceneInteractionPolicy === "async"
      ? { defaultValue: 86_400, min: 60, max: 604_800 }
      : sceneInteractionPolicy === "flexible"
        ? { defaultValue: 300, min: 5, max: 86_400 }
        : { defaultValue: 60, min: 5, max: 300 };
    const boundedWindow = integer(
      windowSeconds ?? windowContract.defaultValue,
      "window seconds",
      { min: windowContract.min, max: windowContract.max },
    );
    const normalizedQuorum =
      normalizedMode === "quorum"
        ? integer(quorum, "interaction quorum", { min: 2, max: 100 })
        : null;
    const normalizedLatePolicy = enumValue(
      lateInputPolicy,
      "late input policy",
      WORLD_INTERACTION_LATE_POLICIES,
    );
    const normalizedCoordinationRule =
      optionalText(coordinationRule, "interaction coordination rule", {
        max: 600,
      }) ??
      "Host 将忠实呈现不同意见，并依据集体问题中已公开的世界事实和安全优先级协调；未采用的有效意见会保留为后续选项。";
    const normalizedChoiceOptions = collectiveChoiceOptions(choiceOptions);
    const expectedVersion = integer(
      expectedWorldStateVersion,
      "expected world state version",
      { min: 1 },
    );
    const interactionId = randomUUID();
    const promptEventId = randomUUID();
    const closesAt = new Date(
      Date.parse(timestamp) + boundedWindow * 1000,
    ).toISOString();
    const collectionRule =
      normalizedMode === "quorum"
        ? `至少需要 ${normalizedQuorum} 份回应；达到人数后进入 Host 统一结算，否则将在 ${boundedWindow} 秒后截止（${closesAt}）。`
        : `将在 ${boundedWindow} 秒后截止（${closesAt}），随后由 Host 统一结算。`;
    const lateRule =
      normalizedLatePolicy === "follow_up"
        ? "截止后的内容会作为新的后续建议处理，不计入本批次。"
        : "截止后的内容不会计入本批次。";
    const publicPrompt = [
      normalizedPrompt,
      normalizedChoiceOptions.length > 0
        ? `公开选项：${normalizedChoiceOptions.map((option) => `${option.label}（choice_id: ${option.choice_id}）`).join("；")}。选择时必须复制其中一个 choice_id；不同文字表述同一选项也使用同一 ID。`
        : "本轮未公布固定选项；请用 speech 或 action 表达建议，不能提交 choice。",
      "参与说明：回应完全可选；不回应不会被视为同意或反对，也不会阻塞你的独立行动。",
      `收集方式：${normalizedMode === "quorum" ? "法定人数（quorum）" : "限时窗口（windowed）"}；当前已收到 0 份回应。`,
      collectionRule,
      "每个角色最多回应一次；任何单独回应在 Host 公布汇总结果前都不会改变共享世界。",
      `分歧协调规则：${normalizedCoordinationRule}`,
      lateRule,
    ].join("\n");
    const worldAgent = this.requireWorldAgent(world.id);
    const spec = this.currentWorldSpec(world.id);
    withTransaction(this.db, () => {
      const currentState = this.worldStateView(world.id);
      if (currentState.version !== expectedVersion) {
        fail("STATE_VERSION_MISMATCH", "The world state has changed.", {
          expected_world_state_version: expectedVersion,
          current_world_state_version: currentState.version,
        });
      }
      if (normalizedSceneId) {
        const scene = this.db.prepare(`
          SELECT scene.id FROM world_scenes scene
          WHERE scene.id = ? AND scene.space_id = ?
            AND scene.status IN ('forming', 'active')
            AND (SELECT COUNT(*) FROM world_scene_participants participant
                 WHERE participant.scene_id = scene.id
                   AND participant.status = 'active') >= 2
        `).get(normalizedSceneId, world.id);
        if (!scene) {
          fail(
            "WORLD_SCENE_NOT_ACTIVE",
            "Collective interaction requires an active Scene with at least two participants.",
          );
        }
      }
      const active = this.db
        .prepare(normalizedSceneId
          ? `SELECT id FROM world_interactions
             WHERE scene_id = ? AND status IN ('open', 'ready')`
          : `SELECT id FROM world_interactions
             WHERE space_id = ? AND scene_id IS NULL
               AND status IN ('open', 'ready')`)
        .get(normalizedSceneId ?? world.id);
      if (active) {
        fail(
          "WORLD_INTERACTION_ACTIVE",
          "Resolve the current collective interaction before opening another.",
          { interaction_id: active.id },
        );
      }
      this.insertWorldEvent({
        id: promptEventId,
        spaceId: world.id,
        actorType: "world",
        eventClass: "system",
        eventType: normalizedEventType,
        bodyText: publicPrompt,
        payload: {
          interaction_id: interactionId,
          scene_id: normalizedSceneId,
          mode: normalizedMode,
          quorum: normalizedQuorum,
          closes_at: closesAt,
          late_input_policy: normalizedLatePolicy,
          coordination_rule: normalizedCoordinationRule,
          choice_options: normalizedChoiceOptions,
        },
        correlationId: interactionId,
        sceneId: normalizedSceneId,
        visibility: "world",
        specVersion: spec.version,
        timestamp,
      });
      this.db
        .prepare(`
          INSERT INTO world_interactions (
            id, space_id, scene_id, world_agent_id, prompt_event_id, mode, status,
            base_world_state_version, quorum, late_input_policy, closes_at,
            created_by_pet_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)
        `)
        .run(
          interactionId,
          world.id,
          normalizedSceneId,
          worldAgent.id,
          promptEventId,
          normalizedMode,
          expectedVersion,
          normalizedQuorum,
          normalizedLatePolicy,
          closesAt,
          actor.id,
          timestamp,
        );
      enqueueWorldDelivery(this.db, {
        worldId: world.id,
        sourceWorldEventId: promptEventId,
        sourceInteractionId: interactionId,
        eventType: "world.interaction_opened",
        dedupeKey: `world:${world.id}:interaction-opened:${promptEventId}`,
        envelope: {
          interactionId,
          sceneId: normalizedSceneId,
          promptEventId,
          closesAt,
          visibility: "world",
          actorPetId: actor.id,
        },
        timestamp,
      });
    });
    this.touchWorldHostRuntime(world.id, timestamp);
    const interaction = this.db
      .prepare("SELECT * FROM world_interactions WHERE id = ?")
      .get(interactionId);
    const promptEvent = this.db
      .prepare("SELECT * FROM world_events WHERE id = ?")
      .get(promptEventId);
    return {
      interaction: this.worldInteractionView(interaction, actor.id),
      prompt_event: eventView(promptEvent),
      host_runtime: this.worldHostRuntimeDetails(world, actor, timestamp),
    };
  }

  worldHostContextPack(world, inputActorPetId) {
    const recentEvents = (inputActorPetId
      ? this.db
          .prepare(`
        SELECT event.*, pet.${this.petNameColumn} AS actor_name
        FROM world_events event
        LEFT JOIN pets pet ON pet.id = event.actor_pet_id
        WHERE event.space_id = ?
          AND (
            event.actor_pet_id = ?
            OR (event.visibility = 'actor' AND event.audience_pet_id = ?)
            OR (
              event.actor_type IN ('world', 'system')
              AND event.visibility = 'world'
              AND event.scene_id IS NULL
              AND (
                event.causation_event_id IS NULL
                OR EXISTS (
                  SELECT 1 FROM world_events cause
                  WHERE cause.id = event.causation_event_id
                    AND (
                      cause.actor_pet_id = ?
                      OR cause.actor_type IN ('world', 'system')
                    )
                )
              )
            )
            OR (
              event.scene_id IS NOT NULL
              AND event.visibility = 'world'
              AND EXISTS (
                SELECT 1 FROM world_scene_participants scene_member
                WHERE scene_member.scene_id = event.scene_id
                  AND scene_member.pet_id = ?
                  AND scene_member.status IN ('invited', 'active')
              )
            )
          )
        ORDER BY event.sequence DESC
        LIMIT 12
      `)
          .all(
            world.id,
            inputActorPetId,
            inputActorPetId,
            inputActorPetId,
            inputActorPetId,
          )
      : this.db
          .prepare(`
        SELECT event.*, pet.${this.petNameColumn} AS actor_name
        FROM world_events event
        LEFT JOIN pets pet ON pet.id = event.actor_pet_id
        WHERE event.space_id = ?
          AND (
            event.visibility = 'world'
            OR event.visibility = 'managers'
            OR (event.visibility = 'actor' AND event.audience_pet_id = ?)
          )
          AND (
            event.scene_id IS NULL
            OR (? <> '' AND EXISTS (
              SELECT 1 FROM world_scene_participants scene_member
              WHERE scene_member.scene_id = event.scene_id
                AND scene_member.pet_id = ?
                AND scene_member.status IN ('invited', 'active')
            ))
          )
        ORDER BY event.sequence DESC
        LIMIT 12
      `)
          .all(world.id, "", "", ""))
      .reverse()
      .map(eventView);
    const liveMembers = this.db
      .prepare(`
        SELECT pet.id, pet.${this.petNameColumn} AS name, live.entered_at
        FROM presence live
        JOIN pets pet ON pet.id = live.pet_id
        WHERE live.space_id = ?
        ORDER BY live.entered_at ASC, pet.id ASC
      `)
      .all(world.id)
      .map((row) => ({
        pet_id: row.id,
        name: row.name,
        present_since: row.entered_at,
      }));
    const pendingInputCount = Number(
      this.db
        .prepare(`
          SELECT COUNT(*) AS count FROM world_inputs
          WHERE space_id = ? AND status = 'pending'
        `)
        .get(world.id).count,
    );
    return {
      contract_version: 2,
      world_state_summary: this.worldStateSnapshotSummary(world.id),
      recent_events: recentEvents,
      live_members: liveMembers,
      actor_journey: inputActorPetId
        ? this.worldMemberJourney(world.id, inputActorPetId)
        : null,
      actor_loop_context: inputActorPetId
        ? this.worldLoopContext(world.id, inputActorPetId)
        : null,
      pending_input_count: pendingInputCount,
      latest_event_sequence:
        recentEvents.length > 0
          ? recentEvents[recentEvents.length - 1].sequence
          : 0,
      privacy_scope:
        "world and manager-visible events, actor-private context only for the current input actor, and public-safe identity/presence fields for other live members",
    };
  }

  sealPendingMysteryTruths(worldId, timestamp = now()) {
    const host = hostConfigView(this.currentWorldHostConfig(worldId));
    if (host.judgement_policy?.world_mechanics?.family !== "mystery") return;
    const cases = this.worldStateView(worldId).value.mystery?.active_cases ?? [];
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO world_host_private_facts
        (space_id, fact_key, value_json, sealed_at)
      VALUES (?, ?, ?, ?)
    `);
    const pending = cases.filter((item) => item?.id && item.truth_commitment === "pending_seal");
    if (pending.length === 0) return;
    withTransaction(this.db, () => {
      for (const item of pending) {
        // This durable package is Host-only. Its public counterpart is only a
        // commitment identifier; no resolution text enters state or events.
        const digest = createHash("sha256").update(`${worldId}:${item.id}:truth-v1`).digest("hex");
        const truth = item.id === "missing-cat"
          ? {
              case_id: item.id, truth_version: 1,
              resolution: "The cat sheltered beneath the sealed ferry pier after following a fishmonger cart; no crime occurred.",
              timeline: ["dawn: cart passed the lane", "morning: rain drove the cat under the pier"],
              evidence_paths: [["wet pawprints", "fish scale near the cart route"], ["ferry watchman testimony", "cat collar snagged below the pier"]],
              red_herrings: ["the old seven-mark carving is unrelated to the cat's disappearance"],
            }
          : {
              case_id: item.id, truth_version: 1,
              resolution: `Fixed case resolution variant ${digest.slice(0, 12)}.`,
              timeline: [`origin:${digest.slice(12, 20)}`, `turning-point:${digest.slice(20, 28)}`],
              evidence_paths: [[`physical:${digest.slice(28, 36)}`, `record:${digest.slice(36, 44)}`]],
              red_herrings: [`coincidence:${digest.slice(44, 52)}`],
            };
        insert.run(worldId, `sealed_truth:${item.id}`, JSON.stringify(truth), timestamp);
      }
      const commitments = new Map(
        this.db.prepare(`
          SELECT fact_key, value_json FROM world_host_private_facts
          WHERE space_id = ? AND fact_key LIKE 'sealed_truth:%'
        `).all(worldId).map((row) => [
          row.fact_key.slice("sealed_truth:".length),
          `sealed:sha256:${createHash("sha256").update(row.value_json).digest("hex")}`,
        ]),
      );
      const current = this.worldStateView(worldId);
      const next = structuredClone(current.value);
      for (const item of next.mystery?.active_cases ?? []) {
        if (item.truth_commitment === "pending_seal" && commitments.has(item.id)) {
          item.truth_commitment = commitments.get(item.id);
        }
      }
      this.db.prepare(`
        UPDATE world_states SET version = ?, state_json = ?,
          updated_by_world_agent_id = ?, updated_at = ?
        WHERE space_id = ? AND version = ?
      `).run(current.version + 1, JSON.stringify(next), this.requireWorldAgent(worldId).id, timestamp, worldId, current.version);
    });
  }

  hostPrivateSealedTruths(worldId) {
    const available = this.db.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name = 'world_host_private_facts'
    `).get().count;
    // Older in-memory fixtures and pre-migration deployments have no private
    // fact table. Treat that as an empty package; it is never player data.
    if (!available) return [];
    return this.db.prepare(`
      SELECT fact_key, value_json, sealed_at FROM world_host_private_facts
      WHERE space_id = ? AND fact_key LIKE 'sealed_truth:%' ORDER BY fact_key
    `).all(worldId).map((row) => ({
      fact_key: row.fact_key,
      value: parseJsonObject(row.value_json),
      sealed_at: row.sealed_at,
    }));
  }

  worldInputConcurrency(world, input, currentWorldState) {
    const observedVersion = Number(input.world_state_version);
    const receivedVersion = Number(
      input.received_world_state_version ?? input.world_state_version,
    );
    const currentVersion = Number(currentWorldState.version);
    const changes = this.db
      .prepare(`
        SELECT judgement.world_state_before_version,
          judgement.world_state_after_version,
          outcome.id AS outcome_event_id, outcome.sequence,
          outcome.event_type, outcome.body_text, outcome.visibility,
          outcome.audience_pet_id, outcome.created_at
        FROM world_judgements judgement
        JOIN world_events outcome ON outcome.id = judgement.outcome_event_id
        WHERE judgement.space_id = ?
          AND judgement.world_state_after_version > judgement.world_state_before_version
          AND judgement.world_state_after_version > ?
          AND (
            outcome.visibility IN ('world', 'managers')
            OR (outcome.visibility = 'actor' AND outcome.audience_pet_id = ?)
          )
        ORDER BY outcome.sequence ASC
        LIMIT 20
      `)
      .all(world.id, observedVersion, input.actor_pet_id)
      .map((row) => ({
        outcome_event_id: row.outcome_event_id,
        sequence: Number(row.sequence),
        event_type: row.event_type,
        body_text: row.body_text,
        visibility: row.visibility,
        world_state_before_version: Number(row.world_state_before_version),
        world_state_after_version: Number(row.world_state_after_version),
        created_at: row.created_at,
      }));
    return {
      observed_world_state_version: observedVersion,
      received_world_state_version: receivedVersion,
      current_world_state_version: currentVersion,
      context_version_source: input.context_version_source ?? "server_fallback",
      stale_on_arrival: observedVersion < receivedVersion,
      is_stale: observedVersion < currentVersion,
      version_delta: currentVersion - observedVersion,
      requires_resolution_disposition: observedVersion < currentVersion,
      intervening_world_changes: changes,
    };
  }

  localCodexHostWork({ worldId, inputId }) {
    if (!this.platformHostExecutor) {
      fail("FORBIDDEN", "Platform World Host executor permission is required.");
    }
    const world = this.requireSpace(worldId);
    const { runtime } = this.reconcileWorldHostRuntime(world.id);
    if (runtime.active_executor === "creator_codex") {
      fail(
        "WORLD_HOST_CLAIM_ACTIVE",
        "A creator Agent currently holds the World Host lease.",
      );
    }
    const input = this.db
      .prepare(`
        SELECT wi.*, p.${this.petNameColumn} AS actor_name,
          p.bio AS actor_bio
        FROM world_inputs wi
        JOIN pets p ON p.id = wi.actor_pet_id
        WHERE wi.id = ? AND wi.space_id = ? AND wi.status = 'pending'
          AND wi.interaction_id IS NULL
      `)
      .get(inputId, world.id);
    if (!input) fail("NOT_FOUND", "Pending World Host input not found.");
    if (input.actor_pet_id !== this.actorKey) {
      fail("FORBIDDEN", "The executor identity must match the input actor.");
    }
    const storedData = parseJsonObject(input.data_json);
    const worldState = this.worldStateView(world.id);
    const actorMemberState = this.worldMemberStateView(
      world.id,
      input.actor_pet_id,
    );
    const host = hostConfigView(this.currentWorldHostConfig(world.id));
    const context = this.worldHostContextPack(world, input.actor_pet_id);
    const concurrency = this.worldInputConcurrency(world, input, worldState);
    return {
      contract_version: 2,
      bound_world_id: world.id,
      execution_fence: {
        active_executor: "platform",
        runtime_version: Number(runtime.runtime_version),
        profile_version: Number(world.profile_version),
        spec_version: Number(world.current_spec_version),
        rule_version: Number(world.current_rule_version),
        host_version: Number(host.version),
      },
      world: this.spaceDetails(world.id),
      host,
      input: {
        ...this.worldInputView(input),
        proposed_world_state_patch:
          storedData.proposed_world_state_patch ?? null,
        proposed_member_state_patch:
          storedData.proposed_member_state_patch ?? null,
      },
      actor: {
        id: input.actor_pet_id,
        name: input.actor_name,
        bio: input.actor_bio,
      },
      world_state: worldState,
      actor_member_state: actorMemberState,
      concurrency,
      context: {
        ...context,
        input_concurrency: concurrency,
      },
      host_private_truths: this.hostPrivateSealedTruths(world.id),
      director_plan: buildDirectorTurnPlan({
        host,
        worldState,
        memberState: actorMemberState,
        context,
        input: this.worldInputView(input),
      }),
      output_contract: {
        decision: ["accepted", "rejected", "clarification", "escalated"],
        resolution_disposition: concurrency.is_stale
          ? ["rebase", "absorbed", "conflict", "expired"]
          : ["apply"],
        required_text_fields: ["reason_text", "outcome_text"],
        optional_object_fields: [
          "result",
          "world_state_patch",
          "member_state_patch",
        ],
      },
      untrusted_external_content: true,
    };
  }

  assertWorldHostExecutionFence(worldId, {
    expectedProfileVersion,
    expectedSpecVersion,
    expectedRuleVersion,
    expectedHostVersion,
  }) {
    const world = this.requireSpace(worldId);
    const host = hostConfigView(this.currentWorldHostConfig(world.id));
    const expected = {
      profile_version: Number(expectedProfileVersion),
      spec_version: Number(expectedSpecVersion),
      rule_version: Number(expectedRuleVersion),
      host_version: Number(expectedHostVersion),
    };
    const current = {
      profile_version: Number(world.profile_version),
      spec_version: Number(world.current_spec_version),
      rule_version: Number(world.current_rule_version),
      host_version: Number(host.version),
    };
    if (
      Object.values(expected).some((value) => !Number.isSafeInteger(value)) ||
      Object.keys(expected).some((key) => expected[key] !== current[key])
    ) {
      fail(
        "WORLD_HOST_CONFIGURATION_CHANGED",
        "World rules or Host configuration changed while the platform Host was deciding.",
        { expected, current },
      );
    }
  }

  enforceWorldMechanicStateContract({
    worldId,
    worldStatePatch,
    memberStatePatch,
    memberPetId = this.actorKey,
  }) {
    const host = hostConfigView(this.currentWorldHostConfig(worldId));
    const contract =
      host.judgement_policy?.world_mechanics?.state_contract;
    if (!contract || typeof contract !== "object") return;
    const checks = [
      [worldStatePatch, contract.world_top_level_keys, "world state patch"],
      [memberStatePatch, contract.member_top_level_keys, "member state patch"],
    ];
    for (const [patch, declaredKeys, label] of checks) {
      if (patch === undefined || patch === null) continue;
      if (!Array.isArray(declaredKeys)) continue;
      const allowed = new Set(declaredKeys);
      const undeclared = Object.keys(jsonObject(patch, label)).filter(
        // `role` is the legacy onboarding projection mirrored into member
        // state by the server itself. Official family-specific progress still
        // lives under the declared journey/mechanic keys.
        (key) => !allowed.has(key) && !(label === "member state patch" && key === "role"),
      );
      if (undeclared.length > 0) {
        fail(
          "WORLD_STATE_CONTRACT_VIOLATION",
          `The Host attempted to write undeclared ${label} fields.`,
          { undeclared_fields: undeclared, allowed_fields: [...allowed] },
        );
      }
    }

    const mechanicFamily =
      host.judgement_policy?.world_mechanics?.family;
    const currentWorldState = this.worldStateView(worldId).value;
    const nextWorldState =
      worldStatePatch === undefined || worldStatePatch === null
        ? currentWorldState
        : mergePatch(currentWorldState, worldStatePatch);
    const currentMemberState =
      memberStatePatch === undefined || memberStatePatch === null
        ? {}
        : this.worldMemberStateView(worldId, memberPetId).value;
    const nextMemberState =
      memberStatePatch === undefined || memberStatePatch === null
        ? {}
        : mergePatch(currentMemberState, memberStatePatch);
    const violation = (message, details = {}) =>
      fail("WORLD_STATE_CONTRACT_VIOLATION", message, details);
    const boundedNumber = (value, path, min, max = Infinity) => {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < min ||
        value > max
      ) {
        violation(`The Host attempted to write an invalid value at ${path}.`, {
          path,
          minimum: min,
          ...(Number.isFinite(max) ? { maximum: max } : {}),
          received: value,
        });
      }
    };

    if (mechanicFamily === "survival") {
      const settlement = nextWorldState.settlement;
      const currentSettlement = currentWorldState.settlement ?? {};
      if (!settlement || typeof settlement !== "object") {
        violation("The Host cannot remove the survival settlement state.");
      }
      for (const name of Object.keys(currentSettlement.resources ?? {})) {
        if (!(name in (settlement.resources ?? {}))) {
          violation("The Host cannot remove a tracked survival resource.", {
            resource: name,
          });
        }
      }
      for (const [name, value] of Object.entries(settlement.resources ?? {})) {
        boundedNumber(value, `settlement.resources.${name}`, 0);
      }
      for (const name of Object.keys(currentSettlement.indicators ?? {})) {
        if (!(name in (settlement.indicators ?? {}))) {
          violation("The Host cannot remove a tracked survival indicator.", {
            indicator: name,
          });
        }
      }
      for (const [name, value] of Object.entries(settlement.indicators ?? {})) {
        boundedNumber(value, `settlement.indicators.${name}`, 0, 100);
      }
      for (const name of Object.keys(currentSettlement.facilities ?? {})) {
        if (!(name in (settlement.facilities ?? {}))) {
          violation("The Host cannot remove a tracked survival facility.", {
            facility: name,
          });
        }
      }
      for (const [name, facility] of Object.entries(settlement.facilities ?? {})) {
        boundedNumber(
          facility?.condition,
          `settlement.facilities.${name}.condition`,
          0,
          100,
        );
      }
      boundedNumber(
        settlement.season_phase?.days_to_thaw,
        "settlement.season_phase.days_to_thaw",
        0,
      );
      if (currentMemberState.operator && !nextMemberState.operator) {
        violation("The Host cannot remove the member's operator state.");
      }
      if (nextMemberState.operator) {
        boundedNumber(nextMemberState.operator.health, "operator.health", 0, 100);
        boundedNumber(nextMemberState.operator.fatigue, "operator.fatigue", 0, 100);
      }
    }

    if (mechanicFamily === "mystery") {
      const currentCases = new Map(
        (currentWorldState.mystery?.active_cases ?? []).map((item) => [item.id, item]),
      );
      const nextCases = new Map(
        (nextWorldState.mystery?.active_cases ?? []).map((item) => [item.id, item]),
      );
      for (const [id, currentCase] of currentCases) {
        if (currentCase.truth_commitment === "pending_seal") continue;
        const nextCase = nextCases.get(id);
        if (
          !nextCase ||
          nextCase.truth_commitment !== currentCase.truth_commitment
        ) {
          violation("The Host cannot alter or remove a sealed case truth commitment.", {
            case_id: id,
          });
        }
      }
    }

    if (mechanicFamily === "social") {
      const town = nextWorldState.town;
      const currentTown = currentWorldState.town ?? {};
      if (!town || typeof town !== "object") violation("The Host cannot remove the town state.");
      boundedNumber(town.day, "town.day", 1);
      boundedNumber(town.prosperity, "town.prosperity", 0, 100);
      const currentProjects = new Map((currentTown.community_projects ?? []).map((item) => [item.id, item]));
      const nextProjects = new Map((town.community_projects ?? []).map((item) => [item.id, item]));
      for (const [id, project] of currentProjects) {
        const replacement = nextProjects.get(id);
        if (!replacement) violation("The Host cannot remove a tracked community project.", { project_id: id });
        boundedNumber(replacement.progress, `town.community_projects.${id}.progress`, 0, replacement.target);
        if (replacement.target !== project.target) violation("The Host cannot change a tracked community project target.", { project_id: id });
      }
    }

    if (mechanicFamily === "quest") {
      const adventure = nextWorldState.adventure;
      const currentAdventure = currentWorldState.adventure ?? {};
      if (!adventure || typeof adventure !== "object") violation("The Host cannot remove the adventure state.");
      boundedNumber(adventure.guild_level, "adventure.guild_level", 1);
      boundedNumber(adventure.guild_funds, "adventure.guild_funds", 0);
      for (const [id, value] of Object.entries(adventure.facilities ?? {})) {
        boundedNumber(value, `adventure.facilities.${id}`, 0);
      }
      const currentQuests = new Map((currentAdventure.quest_board ?? []).map((item) => [item.id, item]));
      const nextQuests = new Map((adventure.quest_board ?? []).map((item) => [item.id, item]));
      const order = ["open", "accepted", "prepared", "challenging", "returning", "resolved"];
      for (const [id, quest] of currentQuests) {
        const replacement = nextQuests.get(id);
        if (!replacement) violation("The Host cannot remove a tracked quest.", { quest_id: id });
        const before = order.indexOf(quest.status);
        const after = order.indexOf(replacement.status);
        if (before >= 0 && after >= 0 && after > before + 1) {
          violation("A quest cannot skip a progression stage without cause.", { quest_id: id, from: quest.status, to: replacement.status });
        }
      }
    }

    if (mechanicFamily === "anomaly") {
      const currentClaims = new Map(
        (currentWorldState.backrooms?.rule_claims ?? []).map((item) => [item.id, item]),
      );
      const nextClaims = new Map(
        (nextWorldState.backrooms?.rule_claims ?? []).map((item) => [item.id, item]),
      );
      for (const [id, currentClaim] of currentClaims) {
        const nextClaim = nextClaims.get(id);
        if (!nextClaim) {
          violation("The Host cannot remove an observed anomaly rule claim.", {
            rule_claim_id: id,
          });
        }
        if (
          !Number.isInteger(nextClaim.confirmations) ||
          nextClaim.confirmations < 0
        ) {
          violation("Anomaly rule confirmations must be a non-negative integer.", {
            rule_claim_id: id,
          });
        }
        if (!new Set(["unverified", "observed", "verified", "disproved"]).has(nextClaim.status)) {
          violation("Anomaly rule status is invalid.", {
            rule_claim_id: id,
          });
        }
        if (Number(nextClaim.confirmations ?? 0) < Number(currentClaim.confirmations ?? 0)) {
          violation("Anomaly rule confirmations cannot decrease.", {
            rule_claim_id: id,
          });
        }
        if (
          (Number(currentClaim.confirmations ?? 0) > 0 ||
            currentClaim.status !== "unverified") &&
          nextClaim.claim !== currentClaim.claim
        ) {
          violation("The Host cannot rewrite an anomaly rule after observation.", {
            rule_claim_id: id,
          });
        }
        if (
          new Set(["verified", "disproved"]).has(currentClaim.status) &&
          nextClaim.status !== currentClaim.status
        ) {
          violation("The Host cannot reverse a resolved anomaly rule status.", {
            rule_claim_id: id,
          });
        }
      }
    }
  }

  resolveLocalCodexHostInput({ worldId, inputId, ...resolution }) {
    if (!this.platformHostExecutor) {
      fail("FORBIDDEN", "Platform World Host executor permission is required.");
    }
    const input = this.db
      .prepare("SELECT * FROM world_inputs WHERE id = ? AND space_id = ?")
      .get(inputId, worldId);
    if (!input) fail("NOT_FOUND", "World input not found.");
    if (input.actor_pet_id !== this.actorKey) {
      fail("FORBIDDEN", "The executor identity must match the input actor.");
    }
    this.assertWorldHostExecutionFence(worldId, resolution);
    const world = this.requireSpace(worldId);
    const actor = this.requirePet();
    const storedData = parseJsonObject(input.data_json);
    const hardRuleJudgement = this.evaluatePlatformWorldInput({
      world,
      worldAgent: this.requireWorldAgent(world.id),
      actor,
      inputType: input.input_type,
      eventType: input.event_type,
      bodyText: input.body_text,
      data: storedData.data ?? {},
      worldState: this.worldStateView(world.id).value,
      memberState: this.worldMemberStateView(world.id, actor.id).value,
      visibility: input.visibility,
    });
    // Deterministic safety boundaries are authoritative. A schema-valid LLM
    // response cannot accept an input that violates declared blocked rules or
    // another Character's agency.
    const enforcedResolution = hardRuleJudgement.decision === "rejected"
      ? {
          ...resolution,
          ...hardRuleJudgement,
          resolutionDisposition: "apply",
        }
      : resolution;
    this.enforceWorldMechanicStateContract({
      worldId,
      worldStatePatch: enforcedResolution.worldStatePatch,
      memberStatePatch: enforcedResolution.memberStatePatch,
    });
    return this.resolveWorldIntent({
      worldId,
      intentId: inputId,
      ...enforcedResolution,
      applyProposedState: false,
      [PLATFORM_HOST_AUTHORIZATION]: true,
    });
  }

  localCodexHostInteractionWork({ worldId, interactionId }) {
    if (!this.platformHostExecutor) {
      fail("FORBIDDEN", "Platform World Host executor permission is required.");
    }
    const world = this.requireSpace(worldId);
    const timestamp = now();
    const { runtime } = this.reconcileWorldHostRuntime(world.id, timestamp);
    if (runtime.active_executor === "creator_codex") {
      fail(
        "WORLD_HOST_CLAIM_ACTIVE",
        "A creator Agent currently holds the World Host lease.",
      );
    }
    this.refreshWorldInteractions(world.id, timestamp);
    const interaction = this.db
      .prepare(`
        SELECT * FROM world_interactions
        WHERE id = ? AND space_id = ? AND status = 'ready'
      `)
      .get(interactionId, world.id);
    if (!interaction) {
      fail("NOT_FOUND", "Ready collective interaction not found.");
    }
    const worldState = this.worldStateView(world.id);
    const responseRows = this.db
      .prepare(`
        SELECT wi.*
        FROM world_inputs wi
        WHERE wi.interaction_id = ? AND wi.status = 'pending'
        ORDER BY wi.created_at ASC, wi.rowid ASC
      `)
      .all(interaction.id);
    if (responseRows.length === 0) {
      fail("NOT_FOUND", "The collective interaction has no pending responses.");
    }
    if (responseRows[0].actor_pet_id !== this.actorKey) {
      fail(
        "FORBIDDEN",
        "The executor identity must match the first response actor.",
      );
    }
    const inputBatch = responseRows.map((row, index) => {
      const storedData = parseJsonObject(row.data_json);
      return {
        response_index: index + 1,
        input_type: row.input_type,
        event_type: row.event_type,
        body_text: row.body_text,
        scene_id: storedData.scene_id ?? null,
        reply_to_event_id: row.reply_to_event_id ?? null,
        visibility: "actor",
        concurrency: this.worldInputConcurrency(world, row, worldState),
      };
    });
    const isStale = inputBatch.some((input) => input.concurrency.is_stale);
    const interactionView = this.worldInteractionView(
      interaction,
      this.actorKey,
    );
    const host = hostConfigView(this.currentWorldHostConfig(world.id));
    const context = {
      ...this.worldHostContextPack(world, null),
      interaction: interactionView,
      batch_size: inputBatch.length,
    };
    return {
      contract_version: 2,
      bound_world_id: world.id,
      execution_fence: {
        active_executor: "platform",
        runtime_version: Number(runtime.runtime_version),
        profile_version: Number(world.profile_version),
        spec_version: Number(world.current_spec_version),
        rule_version: Number(world.current_rule_version),
        host_version: Number(host.version),
      },
      batch_mode: true,
      world: this.spaceDetails(world.id),
      host,
      interaction: interactionView,
      input: null,
      input_batch: inputBatch,
      world_state: worldState,
      context,
      director_plan: buildDirectorTurnPlan({
        host,
        worldState,
        // Public collective settlement must not receive any participant's
        // private member state. The response text is the only private evidence
        // needed by this single-purpose aggregate Host turn.
        memberState: {},
        context,
        input: {
          id: interaction.id,
          event_type: "host.collective_resolution",
          body_text: inputBatch.map((item) => item.body_text).join("\n"),
        },
      }),
      output_contract: {
        decision: ["accepted", "rejected", "clarification"],
        resolution_disposition: isStale
          ? ["rebase", "absorbed", "conflict", "expired"]
          : ["apply"],
        required_text_fields: ["reason_text", "outcome_text"],
        optional_object_fields: ["result", "world_state_patch"],
      },
      untrusted_external_content: true,
    };
  }

  resolveLocalCodexHostInteraction({
    worldId,
    interactionId,
    ...resolution
  }) {
    if (!this.platformHostExecutor) {
      fail("FORBIDDEN", "Platform World Host executor permission is required.");
    }
    this.assertWorldHostExecutionFence(worldId, resolution);
    const firstInput = this.db
      .prepare(`
        SELECT * FROM world_inputs
        WHERE space_id = ? AND interaction_id = ? AND status = 'pending'
        ORDER BY created_at ASC, rowid ASC
        LIMIT 1
      `)
      .get(worldId, interactionId);
    if (!firstInput) {
      fail("NOT_FOUND", "Pending collective responses not found.");
    }
    if (firstInput.actor_pet_id !== this.actorKey) {
      fail(
        "FORBIDDEN",
        "The executor identity must match the first response actor.",
      );
    }
    this.enforceWorldMechanicStateContract({
      worldId,
      worldStatePatch: resolution.worldStatePatch,
    });
    return this.resolveWorldHostInteraction({
      worldId,
      interactionId,
      ...resolution,
      [PLATFORM_HOST_AUTHORIZATION]: true,
    });
  }

  nextWorldHostInput({ worldId, clientSessionId }) {
    const actor = this.requirePet();
    const world = this.requireSpace(worldId);
    this.requireHostOperator(world, actor.id);
    const timestamp = now();
    this.touchWorldSession(world.id, actor.id, timestamp);
    this.requireCreatorHostClaim(
      world,
      actor,
      clientSessionId,
      timestamp,
    );
    this.refreshWorldInteractions(world.id, timestamp);
    const readyInteraction = this.db
      .prepare(`
        SELECT * FROM world_interactions
        WHERE space_id = ? AND status = 'ready'
        ORDER BY ready_at ASC, created_at ASC
        LIMIT 1
      `)
      .get(world.id);
    if (readyInteraction) {
      const worldState = this.worldStateView(world.id);
      const responseRows = this.db
        .prepare(`
          SELECT wi.*, p.${this.petNameColumn} AS actor_name,
            p.bio AS actor_bio
          FROM world_inputs wi
          JOIN pets p ON p.id = wi.actor_pet_id
          WHERE wi.interaction_id = ? AND wi.status = 'pending'
          ORDER BY wi.created_at ASC, wi.rowid ASC
        `)
        .all(readyInteraction.id);
      const inputs = responseRows.map((row) => {
        const storedData = parseJsonObject(row.data_json);
        return {
          ...this.worldInputView(row),
          proposed_world_state_patch:
            storedData.proposed_world_state_patch ?? null,
          proposed_member_state_patch:
            storedData.proposed_member_state_patch ?? null,
          actor: {
            id: row.actor_pet_id,
            name: row.actor_name,
            bio: row.actor_bio,
          },
          actor_member_state: this.worldMemberStateView(
            world.id,
            row.actor_pet_id,
          ),
          concurrency: this.worldInputConcurrency(world, row, worldState),
        };
      });
      this.touchWorldHostRuntime(world.id, timestamp);
      const host = hostConfigView(this.currentWorldHostConfig(world.id));
      const interactionView = this.worldInteractionView(readyInteraction, actor.id);
      const context = {
        ...this.worldHostContextPack(world, null),
        interaction: interactionView,
        batch_size: inputs.length,
      };
      return {
        world: this.spaceDetails(world.id),
        host,
        runtime: this.worldHostRuntimeDetails(world, actor, timestamp),
        input: null,
        input_batch: inputs,
        batch_mode: true,
        interaction: interactionView,
        world_state: worldState,
        context,
        director_plan: buildDirectorTurnPlan({
          host,
          worldState,
          memberState: inputs[0]?.actor_member_state,
          context,
          input: {
            id: readyInteraction.id,
            event_type: "host.collective_resolution",
            body_text: inputs.map((item) => item.body_text).join("\n"),
          },
        }),
        untrusted_external_content: true,
      };
    }
    const input = this.db
      .prepare(`
        SELECT wi.*, p.${this.petNameColumn} AS actor_name,
          p.bio AS actor_bio
        FROM world_inputs wi
        JOIN pets p ON p.id = wi.actor_pet_id
        WHERE wi.space_id = ? AND wi.status = 'pending'
          AND wi.interaction_id IS NULL
        ORDER BY wi.created_at ASC, wi.rowid ASC
        LIMIT 1
      `)
      .get(world.id);
    this.touchWorldHostRuntime(world.id, timestamp);
    if (!input) {
      return {
        world_id: world.id,
        input: null,
        runtime: this.worldHostRuntimeDetails(world, actor, timestamp),
        context: this.worldHostContextPack(world, null),
        active_interactions: this.activeWorldInteractions(
          world.id,
          actor.id,
          timestamp,
        ),
        untrusted_external_content: true,
      };
    }
    const storedData = parseJsonObject(input.data_json);
    const worldState = this.worldStateView(world.id);
    const host = hostConfigView(this.currentWorldHostConfig(world.id));
    const actorMemberState = this.worldMemberStateView(
      world.id,
      input.actor_pet_id,
    );
    const context = this.worldHostContextPack(world, input.actor_pet_id);
    const concurrency = this.worldInputConcurrency(world, input, worldState);
    return {
      world: this.spaceDetails(world.id),
      host,
      runtime: this.worldHostRuntimeDetails(world, actor, timestamp),
      input: {
        ...this.worldInputView(input),
        proposed_world_state_patch:
          storedData.proposed_world_state_patch ?? null,
        proposed_member_state_patch:
          storedData.proposed_member_state_patch ?? null,
      },
      actor: {
        id: input.actor_pet_id,
        name: input.actor_name,
        bio: input.actor_bio,
      },
      world_state: worldState,
      actor_member_state: actorMemberState,
      concurrency,
      context: {
        ...context,
        input_concurrency: concurrency,
      },
      host_private_truths: this.hostPrivateSealedTruths(world.id),
      director_plan: buildDirectorTurnPlan({
        host,
        worldState,
        memberState: actorMemberState,
        context,
        input: this.worldInputView(input),
      }),
      untrusted_external_content: true,
    };
  }

  resolveWorldHostInput({
    worldId,
    inputId,
    clientSessionId,
    ...resolution
  }) {
    const actor = this.requirePet();
    const world = this.requireSpace(worldId);
    this.requireHostOperator(world, actor.id);
    const timestamp = now();
    this.touchWorldSession(world.id, actor.id, timestamp);
    this.requireCreatorHostClaim(
      world,
      actor,
      clientSessionId,
      timestamp,
    );
    const input = this.db
      .prepare("SELECT * FROM world_inputs WHERE id = ? AND space_id = ?")
      .get(inputId, world.id);
    if (!input) fail("NOT_FOUND", "World input not found.");
    if (input.interaction_id) {
      fail(
        "WORLD_INTERACTION_BATCH_REQUIRED",
        "Collective responses must be resolved through their interaction batch.",
        { interaction_id: input.interaction_id },
      );
    }
    const currentWorldState = this.worldStateView(world.id);
    const expectedWorldStateVersion = integer(
      resolution.expectedWorldStateVersion,
      "expected world state version",
      { min: 1 },
    );
    if (expectedWorldStateVersion !== currentWorldState.version) {
      fail("STATE_VERSION_MISMATCH", "The world state has changed.", {
        expected_world_state_version: expectedWorldStateVersion,
        current_world_state_version: currentWorldState.version,
      });
    }
    const isStale = Number(input.world_state_version) < currentWorldState.version;
    if (isStale && resolution.resolutionDisposition === undefined) {
      fail(
        "STALE_WORLD_INPUT",
        "The World changed after this input was composed. The Host must choose how to reconcile it.",
        this.worldInputConcurrency(world, input, currentWorldState),
      );
    }
    const disposition = enumValue(
      resolution.resolutionDisposition ?? "apply",
      "resolution disposition",
      WORLD_INPUT_DISPOSITIONS,
    );
    if (isStale && disposition === "apply") {
      fail(
        "STALE_WORLD_INPUT",
        "A stale World input must be rebased, absorbed, conflicted, or expired before it can be resolved.",
        this.worldInputConcurrency(world, input, currentWorldState),
      );
    }
    if (!isStale && disposition !== "apply") {
      fail(
        "INVALID_ARGUMENT",
        "A fresh World input must use the apply disposition.",
      );
    }
    if (
      disposition === "conflict" &&
      resolution.decision === "accepted"
    ) {
      fail("INVALID_ARGUMENT", "A conflicted input cannot be accepted.");
    }
    if (disposition === "expired" && resolution.decision !== "rejected") {
      fail("INVALID_ARGUMENT", "An expired input must be rejected.");
    }
    const result = this.resolveWorldIntent({
      worldId: world.id,
      intentId: inputId,
      ...resolution,
      expectedWorldStateVersion,
      resolutionDisposition: disposition,
      applyProposedState: resolution.applyProposedState ?? false,
      [WORLD_HOST_CLAIM_AUTHORIZATION]: true,
    });
    this.touchWorldHostRuntime(world.id, timestamp);
    return {
      ...result,
      host_runtime: this.worldHostRuntimeDetails(world, actor, timestamp),
    };
  }

  resolveWorldHostInteraction({
    worldId,
    interactionId,
    clientSessionId,
    decision,
    resolutionDisposition,
    reasonText = "",
    outcomeText = "",
    result = {},
    worldStatePatch,
    expectedWorldStateVersion,
    expectedHostRuntimeVersion,
    [PLATFORM_HOST_AUTHORIZATION]: platformHostAuthorized = false,
  }) {
    if (platformHostAuthorized && !this.platformHostExecutor) {
      fail("FORBIDDEN", "Platform World Host executor permission is required.");
    }
    const actor = this.requirePet();
    const world = this.requireSpace(worldId);
    const timestamp = now();
    if (!platformHostAuthorized) {
      this.requireHostOperator(world, actor.id);
      this.touchWorldSession(world.id, actor.id, timestamp);
      this.requireCreatorHostClaim(world, actor, clientSessionId, timestamp);
    } else {
      const { runtime } = this.reconcileWorldHostRuntime(world.id, timestamp);
      if (runtime.active_executor === "creator_codex") {
        fail(
          "WORLD_HOST_CLAIM_ACTIVE",
          "A creator Agent currently holds the World Host lease.",
        );
      }
    }
    this.refreshWorldInteractions(world.id, timestamp);
    const interaction = this.db
      .prepare(`
        SELECT * FROM world_interactions
        WHERE id = ? AND space_id = ?
      `)
      .get(interactionId, world.id);
    if (!interaction) fail("NOT_FOUND", "Collective interaction not found.");
    if (interaction.status !== "ready") {
      fail(
        "WORLD_INTERACTION_NOT_READY",
        "The collective interaction is not ready for batch resolution.",
        {
          interaction_id: interaction.id,
          status: interaction.status,
          closes_at: interaction.closes_at,
        },
      );
    }
    const promptRow = this.db
      .prepare("SELECT payload_json, body_text FROM world_events WHERE id = ?")
      .get(interaction.prompt_event_id);
    const promptPayload = parseJsonObject(promptRow?.payload_json);
    const coordinationRule = promptPayload.coordination_rule ?? "";
    const normalizedDecision = enumValue(
      decision,
      "decision",
      new Set(["accepted", "rejected", "clarification"]),
    );
    const normalizedReason = text(reasonText, "interaction reason", {
      max: 4000,
    });
    const normalizedOutcome = text(outcomeText, "interaction outcome", {
      max: 4000,
    });
    const normalizedResult = jsonObject(result, "interaction result");
    const normalizedPatch =
      worldStatePatch === undefined
        ? undefined
        : jsonObject(worldStatePatch, "world state patch");
    if (normalizedDecision !== "accepted" && normalizedPatch !== undefined) {
      fail("INVALID_ARGUMENT", "Only an accepted batch can change World state.");
    }
    this.enforceWorldMechanicStateContract({
      worldId: world.id,
      worldStatePatch: normalizedPatch,
    });
    const expectedVersion = integer(
      expectedWorldStateVersion,
      "expected world state version",
      { min: 1 },
    );
    const currentWorldState = this.worldStateView(world.id);
    if (expectedVersion !== currentWorldState.version) {
      fail("STATE_VERSION_MISMATCH", "The world state has changed.", {
        expected_world_state_version: expectedVersion,
        current_world_state_version: currentWorldState.version,
      });
    }
    const responseInputs = this.db
      .prepare(`
        SELECT * FROM world_inputs
        WHERE interaction_id = ? AND status = 'pending'
        ORDER BY created_at ASC, rowid ASC
      `)
      .all(interaction.id);
    const privateResponseValues = responseInputs.flatMap((input) => {
      const actorName = this.db
        .prepare(`SELECT ${this.petNameColumn} AS name FROM pets WHERE id = ?`)
        .get(input.actor_pet_id)?.name;
      return collectivePrivateResponseTexts(input, actorName);
    });
    const privateResponseDataEvidence = responseInputs.flatMap((input) =>
      jsonPrivateCollectiveDataEvidence(parseJsonObject(input.data_json).data ?? {}));
    // Protocol field names retain their public schema meaning at the top
    // level (for example selected_option). Nested instances are private for
    // scalar matching below, but are not by themselves evidence that the
    // schema key name was leaked.
    const privateResponseDataKeys = privateResponseDataEvidence
      .map(({ key }) => key)
      .filter(isPrivateCollectiveDataKey);
    const privateResponseScalars = privateResponseDataEvidence.flatMap(({ value }) =>
      jsonPrivacyScalars(value));
    assertCollectivePublicProjection({
      outcomeText: normalizedOutcome,
      result: normalizedResult,
      worldStatePatch: normalizedPatch,
      privateValues: privateResponseValues,
      privateDataKeys: privateResponseDataKeys,
      privateScalarValues: privateResponseScalars,
      privateScalarEntries: privateResponseDataEvidence.flatMap(({ key, value }) =>
        jsonPrivacyScalars(value).map((scalar) => ({ key, value: scalar }))),
      // Short-fragment protection applies to natural-language response text
      // and non-choice private data only. Choice IDs are guarded by exact and
      // distinctive-fragment matching, and may surface only when declared in
      // public interaction context.
      privateTextValues: responseInputs.flatMap((input) => [
        input.body_text,
        ...jsonStringLeaves(parseJsonObject(input.data_json).data ?? {})
          .filter((value) => value !== parseJsonObject(input.data_json).data?.choice_id),
      ]),
      publicContextValues: [
        promptRow?.body_text,
        promptPayload.coordination_rule,
        ...(Array.isArray(promptPayload.choice_options)
          ? promptPayload.choice_options.flatMap((option) => [
              option?.choice_id,
              option?.label,
            ])
          : []),
      ],
    });
    assertCollectiveDisagreementSemantics({
      inputs: responseInputs,
      result: normalizedResult,
      outcomeText: normalizedOutcome,
      coordinationRule,
    });
    const needsReconciliation =
      Number(interaction.base_world_state_version) < currentWorldState.version ||
      responseInputs.some(
        (input) => Number(input.world_state_version) < currentWorldState.version,
      );
    if (needsReconciliation && resolutionDisposition === undefined) {
      fail(
        "STALE_WORLD_INTERACTION",
        "The World changed while responses were being collected. The Host must choose how to reconcile the batch.",
        {
          interaction_id: interaction.id,
          base_world_state_version: Number(interaction.base_world_state_version),
          current_world_state_version: currentWorldState.version,
        },
      );
    }
    const disposition = enumValue(
      resolutionDisposition ?? "apply",
      "resolution disposition",
      WORLD_INPUT_DISPOSITIONS,
    );
    if (needsReconciliation && disposition === "apply") {
      fail(
        "STALE_WORLD_INTERACTION",
        "A stale collective interaction must be rebased, absorbed, conflicted, or expired before it can be resolved.",
      );
    }
    if (!needsReconciliation && disposition !== "apply") {
      fail(
        "INVALID_ARGUMENT",
        "A fresh collective interaction must use the apply disposition.",
      );
    }
    if (disposition === "conflict" && normalizedDecision === "accepted") {
      fail("INVALID_ARGUMENT", "A conflicted batch cannot be accepted.");
    }
    if (disposition === "expired" && normalizedDecision !== "rejected") {
      fail("INVALID_ARGUMENT", "An expired batch must be rejected.");
    }

    const worldAgent = this.requireWorldAgent(world.id);
    const spec = this.currentWorldSpec(world.id);
    const aggregateOutcomeId = randomUUID();
    let afterWorldState;
    withTransaction(this.db, () => {
      if (platformHostAuthorized) {
        const expectedRuntimeVersion = integer(
          expectedHostRuntimeVersion,
          "expected Host runtime version",
          { min: 1 },
        );
        const lockedRuntime = this.db
          .prepare(`
            SELECT active_executor, runtime_version
            FROM world_host_runtimes WHERE space_id = ?
          `)
          .get(world.id);
        if (
          lockedRuntime?.active_executor !== "platform" ||
          Number(lockedRuntime.runtime_version) !== expectedRuntimeVersion
        ) {
          fail(
            "WORLD_HOST_EXECUTOR_CHANGED",
            "World Host execution authority changed while the platform Host was deciding.",
            {
              expected_runtime_version: expectedRuntimeVersion,
              current_runtime_version: Number(lockedRuntime?.runtime_version ?? 0),
              active_executor: lockedRuntime?.active_executor ?? null,
            },
          );
        }
      }
      const lockedInteraction = this.db
        .prepare(`
          SELECT * FROM world_interactions
          WHERE id = ? AND space_id = ?
        `)
        .get(interaction.id, world.id);
      if (lockedInteraction?.status !== "ready") {
        fail(
          "WORLD_INTERACTION_NOT_READY",
          "The collective interaction is no longer ready for resolution.",
        );
      }
      const lockedWorldState = this.worldStateView(world.id);
      if (lockedWorldState.version !== expectedVersion) {
        fail("STATE_VERSION_MISMATCH", "The world state has changed.", {
          expected_world_state_version: expectedVersion,
          current_world_state_version: lockedWorldState.version,
        });
      }
      const lockedInputs = this.db
        .prepare(`
          SELECT * FROM world_inputs
          WHERE interaction_id = ? AND status = 'pending'
          ORDER BY created_at ASC, rowid ASC
        `)
        .all(interaction.id);
      for (const input of lockedInputs) {
        const inputDisposition =
          Number(input.world_state_version) < lockedWorldState.version
            ? disposition
            : "apply";
        this.recordWorldJudgement({
          world,
          worldAgent,
          inputId: input.id,
          decision: normalizedDecision,
          decisionSource: platformHostAuthorized ? "platform" : "creator_review",
          reasonText:
            normalizedReason ||
            (platformHostAuthorized
              ? "The bound local Codex World Host resolved the collective response window."
              : "The active World Host resolved the collective response window."),
          outcomeText:
            normalizedOutcome || "你的回应已纳入这次集体结算。",
          result: {
            ...normalizedResult,
            collective: true,
            interaction_id: interaction.id,
          },
          resolutionDisposition: inputDisposition,
          outcomeVisibility: "actor",
          reviewedByPetId: platformHostAuthorized ? null : actor.id,
          timestamp,
        });
      }
      if (normalizedDecision === "accepted" && normalizedPatch !== undefined) {
        this.applyWorldStatePatch(
          world.id,
          normalizedPatch,
          expectedVersion,
          null,
          timestamp,
          worldAgent.id,
        );
      }
      afterWorldState = this.worldStateView(world.id);
      this.insertWorldEvent({
        id: aggregateOutcomeId,
        spaceId: world.id,
        sceneId: interaction.scene_id ?? null,
        actorType: "world",
        eventClass: "outcome",
        eventType: `outcome.collective_${normalizedDecision}`,
        bodyText: [
          coordinationRule
            ? `事前公布的分歧协调规则：${coordinationRule}`
            : "",
          normalizedOutcome ||
            ({
              accepted: `${worldAgent.display_name ?? "世界主持"}汇总所有回应并推进了世界。`,
              rejected: `${worldAgent.display_name ?? "世界主持"}汇总所有回应后没有推进这项提议。`,
              clarification: `${worldAgent.display_name ?? "世界主持"}汇总回应后请求进一步说明。`,
            })[normalizedDecision],
        ].filter(Boolean).join("\n\n"),
        payload: {
          interaction_id: interaction.id,
          scene_id: interaction.scene_id ?? null,
          decision: normalizedDecision,
          resolution_disposition: disposition,
          response_count: lockedInputs.length,
          result: normalizedResult,
          coordination_rule: coordinationRule,
          world_state_before_version: lockedWorldState.version,
          world_state_after_version: afterWorldState.version,
        },
        causationEventId: interaction.prompt_event_id,
        correlationId: interaction.id,
        visibility: "world",
        specVersion: spec.version,
        timestamp,
      });
      this.db
        .prepare(`
          INSERT INTO world_interaction_resolutions (
            id, interaction_id, outcome_event_id, decision,
            resolution_disposition, result_json, world_state_patch_json,
            world_state_before_version, world_state_after_version,
            resolved_by_pet_id, resolution_source, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          randomUUID(),
          interaction.id,
          aggregateOutcomeId,
          normalizedDecision,
          disposition,
          JSON.stringify(normalizedResult),
          normalizedPatch === undefined ? null : JSON.stringify(normalizedPatch),
          lockedWorldState.version,
          afterWorldState.version,
          actor.id,
          platformHostAuthorized ? "platform" : "creator_review",
          timestamp,
        );
      // Snapshot recipients only after the authoritative resolution row exists,
      // so a shared-world state change can be derived without trusting Host hints.
      enqueueWorldDelivery(this.db, {
        worldId: world.id,
        sourceWorldEventId: aggregateOutcomeId,
        sourceInteractionId: interaction.id,
        eventType: "world.event_committed",
        dedupeKey: `world:${world.id}:event-committed:${aggregateOutcomeId}`,
        envelope: {
          interactionId: interaction.id,
          sceneId: interaction.scene_id ?? null,
          outcomeEventId: aggregateOutcomeId,
          visibility: "world",
          actorPetId: null,
        },
        timestamp,
      });
      this.db
        .prepare(`
          UPDATE world_interactions
          SET status = 'resolved', resolved_at = ?
          WHERE id = ? AND status = 'ready'
        `)
        .run(timestamp, interaction.id);
      if (interaction.scene_id && lockedInputs[0]) {
        this.applyWorldSceneTransition({
          world,
          input: lockedInputs[0],
          judgementResult: normalizedResult,
          fallbackSceneId: interaction.scene_id,
          timestamp,
        });
      }
      for (const input of lockedInputs) {
        this.createInputHostGuidance(world, input.id, timestamp);
      }
    });
    this.touchWorldHostRuntime(world.id, timestamp);
    const resolvedInteraction = this.db
      .prepare("SELECT * FROM world_interactions WHERE id = ?")
      .get(interaction.id);
    const outcomeEvent = this.db
      .prepare("SELECT * FROM world_events WHERE id = ?")
      .get(aggregateOutcomeId);
    return {
      world_id: world.id,
      interaction: this.worldInteractionView(resolvedInteraction, actor.id),
      decision: normalizedDecision,
      resolution_disposition: disposition,
      inputs: responseInputs.map((input) => this.worldIntentResult(input.id)),
      outcome: eventView(outcomeEvent),
      world_state: afterWorldState,
      host_runtime: this.worldHostRuntimeDetails(world, actor, timestamp),
    };
  }

  updateWorldHost({
    worldId,
    expectedVersion,
    name,
    worldRole,
    personaText,
    speakingStyle,
    judgementPolicy,
    memoryPolicy,
    onboardingPolicy,
    facilitationPolicy,
    recapPolicy,
    participationPolicy,
    evolutionPolicy,
    proactivity,
    capabilities,
  }) {
    const actor = this.requirePet();
    const world = this.requireSpace(worldId);
    this.requireManager(world, actor.id);
    if (world.kind === "official") {
      fail("IMMUTABLE_RULES", "Official World Hosts are platform-managed.");
    }
    const currentRow = this.currentWorldHostConfig(world.id);
    const current = hostConfigView(currentRow);
    integer(expectedVersion, "expected World Host version", { min: 1 });
    if (current.version !== expectedVersion) {
      fail("WORLD_HOST_VERSION_MISMATCH", "The World Host has changed.", {
        current_version: current.version,
      });
    }
    const supplied = [
      name,
      worldRole,
      personaText,
      speakingStyle,
      judgementPolicy,
      memoryPolicy,
      onboardingPolicy,
      facilitationPolicy,
      recapPolicy,
      participationPolicy,
      evolutionPolicy,
      proactivity,
      capabilities,
    ];
    if (supplied.every((value) => value === undefined)) {
      fail("INVALID_ARGUMENT", "Provide at least one World Host change.");
    }
    const onboardingPatch = onboardingPolicy === undefined
      ? undefined
      : onboardingPolicy.starter_choices !== undefined &&
          onboardingPolicy.solo_choices === undefined
        ? {
            ...onboardingPolicy,
            solo_choices: onboardingPolicy.starter_choices,
          }
        : onboardingPolicy;
    const next = this.normalizeRefereeSpec({
      name: name ?? current.name,
      agentKind: "host",
      worldRole: worldRole ?? current.world_role,
      participationPolicy: participationPolicy === undefined
        ? current.participation_policy
        : mergePatch(current.participation_policy, participationPolicy),
      evolutionPolicy: evolutionPolicy === undefined
        ? current.evolution_policy
        : mergePatch(current.evolution_policy, evolutionPolicy),
      capabilities: capabilities ?? current.capabilities,
      personaText: personaText ?? current.persona_text,
      speakingStyle: speakingStyle ?? current.speaking_style,
      judgementPolicy: judgementPolicy === undefined
        ? current.judgement_policy
        : mergePatch(current.judgement_policy, judgementPolicy),
      memoryPolicy: memoryPolicy === undefined
        ? current.memory_policy
        : mergePatch(current.memory_policy, memoryPolicy),
      outputSchema: parseJsonObject(currentRow.output_schema_json),
      modelConfig: parseJsonObject(currentRow.model_config_json),
      toolAllowlist: parseJsonArray(currentRow.tool_allowlist_json),
      onboardingPolicy: onboardingPatch === undefined
        ? current.onboarding_policy
        : mergePatch(current.onboarding_policy, onboardingPatch),
      facilitationPolicy: facilitationPolicy === undefined
        ? current.facilitation_policy
        : mergePatch(current.facilitation_policy, facilitationPolicy),
      recapPolicy: recapPolicy === undefined
        ? current.recap_policy
        : mergePatch(current.recap_policy, recapPolicy),
      proactivity: proactivity ?? current.proactivity,
    });
    const spec = this.currentWorldSpec(world.id);
    const rule = this.currentRule(world.id);
    const validation = this.validateWorldBuildArtifact({
      world: {
        name: world.name,
        description: world.description,
        tags: parseTags(world.tags_json),
        visibility: world.visibility,
        joinPolicy: world.join_policy,
        friendPolicy: world.friend_policy,
        rulesText: rule.rules_text,
        definitionText: spec.definition_text,
        entryPrompt: spec.entry_prompt,
        hostPrompt: spec.host_prompt,
        resolutionMode: spec.resolution_mode,
      },
      host: next,
    });
    if (!validation.valid || validation.readiness !== "ready") {
      fail(
        "WORLD_HOST_INVALID",
        "The updated World Host must pass all World Builder experience checks.",
        { validation },
      );
    }
    const nextVersion = current.version + 1;
    const timestamp = now();
    withTransaction(this.db, () => {
      this.db
        .prepare(`
          INSERT INTO world_agent_versions (
            world_agent_id, version, display_name, world_role, persona_text,
            speaking_style, judgement_policy_json, memory_policy_json,
            output_schema_json, model_config_json, tool_allowlist_json,
            onboarding_policy_json, facilitation_policy_json,
            recap_policy_json, participation_policy_json,
            evolution_policy_json, proactivity, capabilities_json,
            source_build_session_id, created_by_agent_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        `)
        .run(
          current.id,
          nextVersion,
          next.name,
          next.worldRole,
          next.personaText,
          next.speakingStyle,
          JSON.stringify(next.judgementPolicy),
          JSON.stringify(next.memoryPolicy),
          JSON.stringify(next.outputSchema),
          JSON.stringify(next.modelConfig),
          JSON.stringify(next.toolAllowlist),
          JSON.stringify(next.onboardingPolicy),
          JSON.stringify(next.facilitationPolicy),
          JSON.stringify(next.recapPolicy),
          JSON.stringify(next.participationPolicy),
          JSON.stringify(next.evolutionPolicy),
          next.proactivity,
          JSON.stringify(next.capabilities),
          PLATFORM_WORLD_BUILDER_ID,
          timestamp,
        );
      const result = this.db
        .prepare(`
          UPDATE world_agents
          SET agent_kind = 'host', display_name = ?, current_version = ?,
            policy_version = ?, updated_at = ?
          WHERE id = ? AND current_version = ?
        `)
        .run(
          next.name,
          nextVersion,
          nextVersion,
          timestamp,
          current.id,
          expectedVersion,
        );
      if (result.changes !== 1) {
        fail("WORLD_HOST_VERSION_MISMATCH", "The World Host has changed.");
      }
      this.audit(actor.id, "world_host.updated", "world_host", current.id, {
        version: nextVersion,
      });
    });
    return { host: hostConfigView(this.currentWorldHostConfig(world.id)) };
  }

  currentRule(spaceId) {
    const row = this.db
      .prepare(`
        SELECT r.*
        FROM space_rule_versions r
        JOIN spaces s
          ON s.id = r.space_id AND s.current_rule_version = r.version
        WHERE r.space_id = ?
      `)
      .get(spaceId);
    if (!row) fail("DATA_ERROR", "Current space rules are missing.");
    return row;
  }

  currentWorldSpec(spaceId) {
    const row = this.db
      .prepare(`
        SELECT w.*
        FROM world_spec_versions w
        JOIN spaces s
          ON s.id = w.space_id AND s.current_spec_version = w.version
        WHERE w.space_id = ?
      `)
      .get(spaceId);
    if (!row) fail("DATA_ERROR", "Current world definition is missing.");
    return row;
  }

  spaceDetails(spaceId) {
    const row = this.db
      .prepare(`
        SELECT s.*, r.rules_text,
          ws.definition_text AS spec_definition_text,
          ws.entry_prompt, ws.host_prompt, ws.resolution_mode,
          wa.id AS world_agent_id,
          wa.role AS world_agent_role,
          wa.status AS world_agent_status,
          wa.policy_version AS world_agent_policy_version,
          wa.current_version AS world_agent_current_version,
          wa.display_name AS world_agent_display_name,
          wav.world_role AS world_agent_world_role,
          wa.created_by_agent_id AS world_agent_created_by_agent_id,
          wa.agent_kind AS world_agent_kind,
          wav.capabilities_json AS world_agent_capabilities_json,
          wav.proactivity AS world_agent_proactivity,
          wav.participation_policy_json AS world_agent_participation_policy_json,
          wav.evolution_policy_json AS world_agent_evolution_policy_json,
          runtime.status AS world_runtime_status,
          runtime.active_executor AS world_runtime_active_executor,
          (SELECT COUNT(*) FROM space_memberships m
            WHERE m.space_id = s.id AND m.status = 'active') AS member_count,
          (SELECT COUNT(*)
            FROM presence live_presence
            WHERE live_presence.space_id = s.id
          ) AS present_count
        FROM spaces s
        JOIN space_rule_versions r
          ON r.space_id = s.id AND r.version = s.current_rule_version
        LEFT JOIN world_spec_versions ws
          ON ws.space_id = s.id AND ws.version = s.current_spec_version
        JOIN world_agents wa
          ON wa.space_id = s.id
        JOIN world_agent_versions wav
          ON wav.world_agent_id = wa.id
          AND wav.version = wa.current_version
        LEFT JOIN world_host_runtimes runtime
          ON runtime.world_agent_id = wa.id
        WHERE s.id = ?
      `)
      .get(spaceId);
    if (!row) fail("NOT_FOUND", "Space not found.");
    return spaceView({
      ...row,
      world_runtime_platform_mode: this.platformHostMode,
    });
  }

  membership(spaceId, petId) {
    return this.db
      .prepare(`
        SELECT * FROM space_memberships WHERE space_id = ? AND pet_id = ?
      `)
      .get(spaceId, petId);
  }

  membershipView(row) {
    return {
      space_id: row.space_id,
      pet_id: row.pet_id,
      status: row.status,
      accepted_rule_version: row.accepted_rule_version,
      application_text: row.application_text,
      delegation_mode: row.delegation_mode ?? "manual",
      last_seen_event_sequence: Number(row.last_seen_event_sequence ?? 0),
      updated_at: row.updated_at,
    };
  }

  requireActiveMembership(spaceId, petId) {
    const membership = this.membership(spaceId, petId);
    if (!membership || membership.status !== "active") {
      fail("ACTIVE_MEMBERSHIP_REQUIRED", "Active membership is required.");
    }
    return membership;
  }

  requireManager(space, petId) {
    if (!this.canManage(space, petId)) {
      fail("FORBIDDEN", "Space owner or steward permission is required.");
    }
  }

  canManage(space, petId) {
    if (space.owner_pet_id === petId) return true;
    return Boolean(
      this.db
        .prepare(`
          SELECT 1 FROM space_stewards WHERE space_id = ? AND pet_id = ?
        `)
        .get(space.id, petId),
    );
  }

  requireWorldOwnerForLifecycle(space, petId) {
    if (space.kind === "official") {
      fail("IMMUTABLE_RULES", "Official Worlds are managed by the platform.");
    }
    if (space.owner_pet_id === petId) return;
    if (
      space.publication_status !== "published" &&
      !this.canManage(space, petId)
    ) {
      fail("NOT_FOUND", "World not found.");
    }
    fail(
      "FORBIDDEN",
      "Only the World creator can close or permanently delete this World.",
    );
  }

  requireHostOperator(space, petId) {
    if (!this.canHostWorld(space, petId)) {
      fail("FORBIDDEN", "World Host operator permission is required.");
    }
  }

  canHostWorld(space, petId) {
    if (this.canManage(space, petId)) return true;
    return Boolean(
      space.kind === "official" &&
        this.principalUserId &&
        this.officialHostPrincipalUserIds.has(this.principalUserId),
    );
  }

  requireRuleManager(space, petId) {
    if (space.governance === "immutable") {
      fail("IMMUTABLE_RULES", "This space's rules are immutable.");
    }
    if (this.canManage(space, petId)) return;
    fail("FORBIDDEN", "You cannot modify this space's rules.");
  }

  validInvitation(invitationId, spaceId, inviteePetId) {
    const invitation = this.db
      .prepare(`
        SELECT * FROM space_invitations
        WHERE id = ? AND space_id = ? AND invitee_pet_id = ?
          AND status = 'pending'
      `)
      .get(invitationId, spaceId, inviteePetId);
    if (!invitation) {
      fail("INVITATION_REQUIRED", "A valid invitation is required.");
    }
    return invitation;
  }

  validShare(token, spaceId) {
    const normalizedToken = text(token, "share token", { min: 10, max: 200 });
    const share = this.db
      .prepare(`
        SELECT * FROM space_shares
        WHERE token = ? AND space_id = ?
      `)
      .get(normalizedToken, spaceId);
    if (!share || (share.expires_at && share.expires_at <= now())) {
      fail("SHARE_REQUIRED", "A valid share is required.");
    }
    return share;
  }

  ensureWorldMemberState(spaceId, petId, timestamp = now()) {
    const build = this.db
      .prepare(`
        SELECT artifact_json FROM world_build_sessions
        WHERE world_id = ? AND status = 'materialized'
      `)
      .get(spaceId);
    const initialMemberState = build
      ? parseJsonObject(build.artifact_json).world?.initialMemberState ?? {}
      : {};
    this.db
      .prepare(`
        INSERT OR IGNORE INTO world_member_states (
          space_id, pet_id, version, state_json, updated_by_pet_id, updated_at
        ) VALUES (?, ?, 1, ?, ?, ?)
      `)
      .run(
        spaceId,
        petId,
        JSON.stringify(jsonObject(initialMemberState, "initial member state")),
        petId,
        timestamp,
      );
    const current = this.db
      .prepare(`
        SELECT * FROM world_member_states WHERE space_id = ? AND pet_id = ?
      `)
      .get(spaceId, petId);
    const merged = mergeInitialDefaults(
      initialMemberState,
      parseJsonObject(current.state_json),
    );
    if (JSON.stringify(merged) !== current.state_json) {
      const worldAgent = this.db
        .prepare("SELECT id FROM world_agents WHERE space_id = ? AND status = 'active'")
        .get(spaceId);
      this.db.prepare(`
        UPDATE world_member_states
        SET version = version + 1, state_json = ?,
          updated_by_world_agent_id = ?, updated_at = ?
        WHERE space_id = ? AND pet_id = ?
      `).run(
        JSON.stringify(merged),
        worldAgent?.id ?? null,
        timestamp,
        spaceId,
        petId,
      );
    }
  }

  ensureWorldMemberJourney(spaceId, petId, timestamp = now()) {
    const memberState = this.db
      .prepare(`
        SELECT state_json FROM world_member_states
        WHERE space_id = ? AND pet_id = ?
      `)
      .get(spaceId, petId);
    const currentRole = parseJsonObject(memberState?.state_json).role;
    this.db
      .prepare(`
        INSERT OR IGNORE INTO world_member_journeys (
          space_id, pet_id, stage, visit_count, current_role,
          participation_intent, context_summary, open_loops_json,
          suggested_actions_json, created_at, updated_at
        ) VALUES (?, ?, 'new', 0, ?, '', '', '[]', '[]', ?, ?)
      `)
      .run(
        spaceId,
        petId,
        typeof currentRole === "string" ? currentRole : "",
        timestamp,
        timestamp,
      );
    return this.db
      .prepare(`
        SELECT * FROM world_member_journeys
        WHERE space_id = ? AND pet_id = ?
      `)
      .get(spaceId, petId);
  }

  worldMemberJourney(spaceId, petId) {
    return journeyView(this.ensureWorldMemberJourney(spaceId, petId));
  }

  insertWorldStoryLoop({
    spaceId,
    ownerPetId = null,
    scope = "personal",
    title,
    phase = "open",
    visibility = "actor",
    sourceKind,
    sourceKey,
    context = {},
    intersectionContract = {},
    openedByInputId = null,
    timestamp = now(),
  }) {
    const id = `loop:${stableLoopKey(spaceId, sourceKind, sourceKey)}`;
    this.db.prepare(`
      INSERT OR IGNORE INTO world_story_loops (
        id, space_id, scope, owner_pet_id, title, phase, status,
        visibility, source_kind, source_key, context_json,
        intersection_contract_json, opened_by_input_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      spaceId,
      scope,
      ownerPetId,
      title.trim().slice(0, 500),
      phase.trim().slice(0, 120) || "open",
      visibility,
      sourceKind,
      sourceKey,
      JSON.stringify(context),
      JSON.stringify(intersectionContract),
      openedByInputId,
      timestamp,
      timestamp,
    );
    return this.db
      .prepare("SELECT * FROM world_story_loops WHERE id = ?")
      .get(id);
  }

  ensureWorldStoryLoops(spaceId, petId, timestamp = now()) {
    const journey = this.ensureWorldMemberJourney(spaceId, petId, timestamp);
    const memberLoopTitles = [
      ...new Set(
        parseJsonArray(journey.open_loops_json)
          .filter((item) => typeof item === "string" && item.trim())
          .map((item) => item.trim().slice(0, 500)),
      ),
    ];
    for (const title of memberLoopTitles) {
      const hostLoop = this.db.prepare(`
        SELECT loop.id FROM world_story_loops loop
        JOIN world_loop_participants participant ON participant.loop_id = loop.id
        WHERE loop.space_id = ? AND loop.owner_pet_id = ?
          AND loop.source_kind = 'host' AND loop.title = ?
          AND participant.pet_id = ?
        LIMIT 1
      `).get(spaceId, petId, title, petId);
      if (hostLoop) continue;
      const sourceKey = `${petId}:${stableLoopKey(title)}`;
      const loop = this.insertWorldStoryLoop({
        spaceId,
        ownerPetId: petId,
        title,
        sourceKind: "journey_open_loop",
        sourceKey,
        context: { migrated_from: "world_member_journeys.open_loops_json" },
        intersectionContract: {
          version: 1,
          materialize_as: "scene",
          requires_causal_overlap: true,
          automatic_presence_intersection: false,
        },
        timestamp,
      });
      this.db.prepare(`
        INSERT OR IGNORE INTO world_loop_participants (
          loop_id, space_id, pet_id, role, status, is_foreground,
          private_context_json, joined_at, updated_at
        ) VALUES (?, ?, ?, 'owner', 'active', 0, '{}', ?, ?)
      `).run(loop.id, spaceId, petId, timestamp, timestamp);
    }

    // World-state threads are safe to expose only as public opportunities.
    // They do not make every member a participant and therefore cannot turn
    // mere co-presence into a multiplayer Scene.
    const worldState = this.worldStateView(spaceId).value;
    const worldThreads = Array.isArray(worldState.world_progress?.open_threads)
      ? worldState.world_progress.open_threads.slice(0, 100)
      : [];
    for (const [index, thread] of worldThreads.entries()) {
      const threadObject =
        thread && typeof thread === "object" && !Array.isArray(thread)
          ? thread
          : {};
      const titleCandidate =
        typeof thread === "string"
          ? thread
          : threadObject.title ??
            threadObject.name ??
            threadObject.premise ??
            threadObject.objective ??
            threadObject.id;
      if (typeof titleCandidate !== "string" || !titleCandidate.trim()) continue;
      const declaredId =
        typeof threadObject.id === "string" && threadObject.id.trim()
          ? threadObject.id.trim()
          : null;
      const sourceKey = declaredId
        ? `thread:${declaredId}`
        : `thread:${stableLoopKey(thread)}`;
      this.insertWorldStoryLoop({
        spaceId,
        scope: "public",
        title: titleCandidate.trim(),
        visibility: "world",
        sourceKind: "world_open_thread",
        sourceKey,
        context: { migrated_thread: thread },
        intersectionContract: {
          version: 1,
          materialize_as: "scene",
          requires_causal_overlap: true,
          automatic_presence_intersection: false,
        },
        timestamp,
      });
    }

    let resumable = Number(
      this.db.prepare(`
        SELECT COUNT(*) AS count
        FROM world_loop_participants participant
        JOIN world_story_loops loop ON loop.id = participant.loop_id
        WHERE participant.space_id = ? AND participant.pet_id = ?
          AND participant.status = 'active'
          AND loop.status = 'active'
      `).get(spaceId, petId).count,
    );
    if (resumable === 0) {
      const completedCount = Number(
        this.db.prepare(`
          SELECT COUNT(*) AS count FROM world_loop_participants
          WHERE space_id = ? AND pet_id = ? AND status = 'completed'
        `).get(spaceId, petId).count,
      );
      const concretePublicThread = this.db.prepare(`
        SELECT title FROM world_story_loops
        WHERE space_id = ? AND scope = 'public' AND status = 'active'
        ORDER BY created_at ASC, id ASC LIMIT 1
      `).get(spaceId)?.title;
      const worldIdentity = this.db.prepare(`
        SELECT name, description FROM spaces WHERE id = ?
      `).get(spaceId);
      const worldGroundedOpening = worldIdentity
        ? `${worldIdentity.name}：${worldIdentity.description}`.trim().slice(0, 500)
        : null;
      const title = journey.participation_intent?.trim()
        ? journey.participation_intent.trim().slice(0, 500)
        : journey.current_role?.trim()
          ? `以“${journey.current_role.trim().slice(0, 160)}”身份处理${worldIdentity?.name ?? "当前世界"}的局势`
          : concretePublicThread?.trim() || worldGroundedOpening;
      // Every participant needs an internal personal anchor so a deliberate
      // directed interaction can form a Scene on the first visit. Ground that
      // anchor in authored World identity instead of exposing the old empty
      // "continue your journey" placeholder to the player.
      if (!title) return;
      const loop = this.insertWorldStoryLoop({
        spaceId,
        ownerPetId: petId,
        title,
        sourceKind: "continuity",
        sourceKey: `${petId}:${completedCount}`,
        context: { migrated_from: "world_member_journeys" },
        intersectionContract: {
          version: 1,
          materialize_as: "scene",
          requires_causal_overlap: true,
          automatic_presence_intersection: false,
        },
        timestamp,
      });
      this.db.prepare(`
        INSERT OR IGNORE INTO world_loop_participants (
          loop_id, space_id, pet_id, role, status, is_foreground,
          private_context_json, joined_at, updated_at
        ) VALUES (?, ?, ?, 'owner', 'active', 0, '{}', ?, ?)
      `).run(loop.id, spaceId, petId, timestamp, timestamp);
      resumable = 1;
    }

    const foreground = this.db.prepare(`
      SELECT loop_id FROM world_loop_participants
      WHERE space_id = ? AND pet_id = ? AND status = 'active'
        AND is_foreground = 1
      LIMIT 1
    `).get(spaceId, petId);
    if (!foreground && resumable > 0) {
      const candidate = this.db.prepare(`
        SELECT participant.loop_id
        FROM world_loop_participants participant
        JOIN world_story_loops loop ON loop.id = participant.loop_id
        WHERE participant.space_id = ? AND participant.pet_id = ?
          AND participant.status = 'active' AND loop.status = 'active'
        ORDER BY
          CASE loop.source_kind WHEN 'journey_open_loop' THEN 0 ELSE 1 END,
          participant.joined_at ASC, participant.loop_id ASC
        LIMIT 1
      `).get(spaceId, petId);
      if (candidate) {
        this.setForegroundWorldStoryLoop(spaceId, petId, candidate.loop_id, timestamp);
      }
    }
  }

  setForegroundWorldStoryLoop(spaceId, petId, loopId, timestamp = now()) {
    const participant = this.db.prepare(`
      SELECT participant.loop_id
      FROM world_loop_participants participant
      JOIN world_story_loops loop ON loop.id = participant.loop_id
      WHERE participant.loop_id = ? AND participant.space_id = ?
        AND participant.pet_id = ? AND participant.status = 'active'
        AND loop.status = 'active'
    `).get(loopId, spaceId, petId);
    if (!participant) return false;
    this.db.prepare(`
      UPDATE world_loop_participants
      SET is_foreground = 0, updated_at = ?
      WHERE space_id = ? AND pet_id = ? AND is_foreground = 1
    `).run(timestamp, spaceId, petId);
    this.db.prepare(`
      UPDATE world_loop_participants
      SET is_foreground = 1, updated_at = ?
      WHERE loop_id = ? AND pet_id = ?
    `).run(timestamp, loopId, petId);
    return true;
  }

  foregroundPersonalLoopId(spaceId, petId, timestamp = now()) {
    this.ensureWorldStoryLoops(spaceId, petId, timestamp);
    return this.db.prepare(`
      SELECT loop.id
      FROM world_loop_participants participant
      JOIN world_story_loops loop ON loop.id = participant.loop_id
      WHERE participant.space_id = ? AND participant.pet_id = ?
        AND participant.status = 'active' AND participant.is_foreground = 1
        AND loop.status = 'active' AND loop.scope = 'personal'
        AND loop.owner_pet_id = ?
      LIMIT 1
    `).get(spaceId, petId, petId)?.id ?? null;
  }

  worldSceneView(row, actorPetId = null) {
    if (!row) return null;
    const participants = this.db.prepare(`
      SELECT participant.pet_id, participant.role, participant.status,
        participant.joined_at, participant.left_at,
        pet.${this.petNameColumn} AS name
      FROM world_scene_participants participant
      JOIN pets pet ON pet.id = participant.pet_id
      WHERE participant.scene_id = ?
      ORDER BY participant.joined_at ASC, participant.pet_id ASC
    `).all(row.id).map((participant) => ({
      pet_id: participant.pet_id,
      name: participant.name,
      role: participant.role,
      status: participant.status,
      joined_at: participant.joined_at,
      left_at: participant.left_at ?? null,
      is_self: actorPetId === participant.pet_id,
    }));
    return {
      id: row.id,
      world_id: row.space_id,
      status: row.status,
      interaction_policy: row.interaction_policy,
      title: row.title,
      shared_context: parseJsonObject(row.shared_context_json),
      source_input_id: row.source_input_id ?? null,
      source_event_id: row.source_event_id ?? null,
      participants,
      created_at: row.created_at,
      activated_at: row.activated_at ?? null,
      resolved_at: row.resolved_at ?? null,
      closed_at: row.closed_at ?? null,
      updated_at: row.updated_at,
      privacy_scope:
        "shared-safe Scene framing and participant identity only; personal Loop context is excluded",
    };
  }

  activeWorldScenes(spaceId, actorPetId = null) {
    const rows = actorPetId
      ? this.db.prepare(`
          SELECT scene.* FROM world_scenes scene
          JOIN world_scene_participants participant
            ON participant.scene_id = scene.id
          WHERE scene.space_id = ? AND participant.pet_id = ?
            AND participant.status IN ('invited', 'active')
            AND scene.status IN ('forming', 'active', 'resolved')
          ORDER BY scene.updated_at DESC, scene.id ASC
        `).all(spaceId, actorPetId)
      : this.db.prepare(`
          SELECT * FROM world_scenes
          WHERE space_id = ? AND status IN ('forming', 'active', 'resolved')
          ORDER BY updated_at DESC, id ASC
        `).all(spaceId);
    return rows.map((row) => this.worldSceneView(row, actorPetId));
  }

  sceneTargetPetIds(world, input, judgementResult) {
    const targets = new Map();
    const authorizedTargets = new Map();
    const addTarget = (candidate, role, evidence) => {
      if (typeof candidate !== "string" || !candidate.trim()) return;
      const petId = candidate.trim();
      if (petId === input.actor_pet_id) return;
      const active = this.db.prepare(`
        SELECT 1 FROM space_memberships
        WHERE space_id = ? AND pet_id = ? AND status = 'active'
      `).get(world.id, petId);
      if (!active) return;
      const prior = targets.get(petId);
      if (!prior || role === "target") targets.set(petId, { petId, role, evidence });
    };
    const authorizeTarget = (candidate, evidence) => {
      if (typeof candidate !== "string" || !candidate.trim()) return;
      const petId = candidate.trim();
      if (petId === input.actor_pet_id) return;
      const active = this.db.prepare(`
        SELECT 1 FROM space_memberships
        WHERE space_id = ? AND pet_id = ? AND status = 'active'
      `).get(world.id, petId);
      if (active) authorizedTargets.set(petId, evidence);
    };

    const storedData = parseJsonObject(input.data_json).data ?? {};
    if (input.event_type === "speech.directed") {
      const directedTarget =
        storedData.target_character_id ?? storedData.target_pet_id;
      authorizeTarget(directedTarget, "directed_behavior");
      addTarget(directedTarget, "target", "directed_behavior");
    }
    if (input.reply_to_event_id) {
      const replied = this.db.prepare(`
        SELECT actor_pet_id FROM world_events
        WHERE id = ? AND space_id = ? AND visibility = 'world'
          AND actor_pet_id IS NOT NULL
      `).get(input.reply_to_event_id, world.id);
      authorizeTarget(replied?.actor_pet_id, "causal_reply");
    }
    const transitions = Array.isArray(judgementResult.loop_transitions)
      ? judgementResult.loop_transitions
      : judgementResult.loop_transition &&
          typeof judgementResult.loop_transition === "object" &&
          !Array.isArray(judgementResult.loop_transition)
        ? [judgementResult.loop_transition]
        : [];
    for (const transition of transitions.slice(0, 20)) {
      if (!transition || typeof transition !== "object") continue;
      if ((transition.transition ?? transition.action) !== "intersect") continue;
      let targetPetId =
        transition.target_character_id ?? transition.target_pet_id ?? null;
      if (!targetPetId && typeof transition.target_loop_id === "string") {
        const targetLoop = this.db.prepare(`
          SELECT owner_pet_id FROM world_story_loops
          WHERE id = ? AND space_id = ? AND scope = 'personal'
            AND status = 'active' AND owner_pet_id IS NOT NULL
        `).get(transition.target_loop_id.trim(), world.id);
        targetPetId = targetLoop?.owner_pet_id ?? null;
      }
      if (authorizedTargets.has(targetPetId)) {
        addTarget(
          targetPetId,
          "participant",
          authorizedTargets.get(targetPetId) === "causal_reply"
            ? "host_causal_intersection"
            : authorizedTargets.get(targetPetId),
        );
      }
    }
    for (const [petId, evidence] of authorizedTargets) {
      if (!targets.has(petId) && evidence === "causal_reply") {
        addTarget(petId, "participant", "host_causal_intersection");
      }
    }
    return [...targets.values()];
  }

  materializeWorldSceneFromJudgement({
    world,
    input,
    judgementResult,
    timestamp = now(),
  }) {
    if (!input.actor_pet_id || input.visibility !== "world") return null;
    const declaredTransitions = Array.isArray(judgementResult.loop_transitions)
      ? judgementResult.loop_transitions
      : judgementResult.loop_transition &&
          typeof judgementResult.loop_transition === "object"
        ? [judgementResult.loop_transition]
        : [];
    const declaredPolicy =
      judgementResult.scene_policy ??
      declaredTransitions.find((item) => item?.scene_policy)?.scene_policy;
    const validatedPolicy = ["sync", "async", "flexible"].includes(
      declaredPolicy,
    ) ? declaredPolicy : null;
    const boundScene = this.db.prepare(`
      SELECT scene.* FROM world_events intent
      JOIN world_scenes scene ON scene.id = intent.scene_id
      JOIN world_scene_participants participant
        ON participant.scene_id = scene.id
      WHERE intent.id = ? AND intent.space_id = ?
        AND scene.space_id = ? AND scene.status IN ('forming', 'active', 'resolved')
        AND participant.pet_id = ? AND participant.status = 'active'
      LIMIT 1
    `).get(
      input.intent_event_id,
      world.id,
      world.id,
      input.actor_pet_id,
    );
    if (boundScene) {
      if (validatedPolicy && boundScene.interaction_policy !== validatedPolicy) {
        this.db.prepare(`
          UPDATE world_scenes SET interaction_policy = ?, updated_at = ?
          WHERE id = ?
        `).run(validatedPolicy, timestamp, boundScene.id);
        boundScene.interaction_policy = validatedPolicy;
      }
      return boundScene;
    }
    const targets = this.sceneTargetPetIds(world, input, judgementResult);
    if (targets.length === 0) return null;
    const actorLoopId = this.foregroundPersonalLoopId(
      world.id,
      input.actor_pet_id,
      timestamp,
    );
    const targetBindings = targets.flatMap((target) => {
      const personalLoopId = this.foregroundPersonalLoopId(
        world.id,
        target.petId,
        timestamp,
      );
      return personalLoopId ? [{ ...target, personalLoopId }] : [];
    });
    if (!actorLoopId || targetBindings.length === 0) return null;

    // Continue an already active causal encounter instead of creating one
    // Scene per turn between the same participants.
    const reusableScenes = this.db.prepare(`
      SELECT scene.* FROM world_scenes scene
      JOIN world_scene_participants self ON self.scene_id = scene.id
      WHERE scene.space_id = ? AND scene.status IN ('forming', 'active')
        AND self.pet_id = ? AND self.status = 'active'
      ORDER BY scene.updated_at DESC, scene.id ASC
    `).all(world.id, input.actor_pet_id);
    const reusable = reusableScenes.find((scene) => {
      const members = new Set(
        this.db.prepare(`
          SELECT pet_id FROM world_scene_participants
          WHERE scene_id = ? AND status = 'active'
        `).all(scene.id).map((row) => row.pet_id),
      );
      return targetBindings.every((target) => members.has(target.petId));
    });
    if (reusable) {
      this.db.prepare(`
        UPDATE world_events SET scene_id = ?
        WHERE space_id = ? AND (id = ? OR causation_event_id = ?)
      `).run(
        reusable.id,
        world.id,
        input.intent_event_id,
        input.intent_event_id,
      );
      this.db.prepare(`
        UPDATE world_scenes
        SET interaction_policy = COALESCE(?, interaction_policy), updated_at = ?
        WHERE id = ?
      `).run(validatedPolicy, timestamp, reusable.id);
      if (validatedPolicy) reusable.interaction_policy = validatedPolicy;
      return reusable;
    }
    const interactionPolicy = validatedPolicy ?? "flexible";
    const sceneId = `scene:${stableLoopKey(world.id, input.id)}`;
    const actorName = this.db.prepare(
      `SELECT ${this.petNameColumn} AS name FROM pets WHERE id = ?`,
    ).get(input.actor_pet_id)?.name ?? "世界成员";
    const targetNames = targetBindings.map((target) =>
      this.db.prepare(
        `SELECT ${this.petNameColumn} AS name FROM pets WHERE id = ?`,
      ).get(target.petId)?.name ?? "世界成员"
    );
    this.db.prepare(`
      INSERT OR IGNORE INTO world_scenes (
        id, space_id, status, interaction_policy, title,
        shared_context_json, source_input_id, source_event_id,
        created_at, activated_at, updated_at
      ) VALUES (?, ?, 'forming', ?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(
      sceneId,
      world.id,
      interactionPolicy,
      `${actorName}与${targetNames.join("、")}的交汇`,
      JSON.stringify({
        contract_version: 1,
        trigger_kinds: [...new Set(targetBindings.map((item) => item.evidence))],
        event_type: input.event_type,
        automatic_presence_intersection: false,
      }),
      input.id,
      input.intent_event_id,
      timestamp,
      timestamp,
    );
    this.db.prepare(`
      INSERT OR IGNORE INTO world_scene_participants (
        scene_id, space_id, pet_id, personal_loop_id, role, status,
        joined_at, updated_at
      ) VALUES (?, ?, ?, ?, 'initiator', 'active', ?, ?)
    `).run(
      sceneId,
      world.id,
      input.actor_pet_id,
      actorLoopId,
      timestamp,
      timestamp,
    );
    for (const target of targetBindings) {
      this.db.prepare(`
        INSERT OR IGNORE INTO world_scene_participants (
          scene_id, space_id, pet_id, personal_loop_id, role, status,
          joined_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
      `).run(
        sceneId,
        world.id,
        target.petId,
        target.personalLoopId,
        target.role,
        timestamp,
        timestamp,
      );
      const [sourceLoopId, targetLoopId] =
        actorLoopId < target.personalLoopId
          ? [actorLoopId, target.personalLoopId]
          : [target.personalLoopId, actorLoopId];
      const edgeId = `loop-edge:${stableLoopKey(
        world.id,
        sourceLoopId,
        targetLoopId,
        "intersection_candidate",
      )}`;
      this.db.prepare(`
        INSERT INTO world_loop_edges (
          id, space_id, source_loop_id, target_loop_id, relation_type,
          status, visibility, contract_json, created_by_input_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'intersection_candidate', 'active',
          'participants', ?, ?, ?, ?)
        ON CONFLICT(source_loop_id, target_loop_id, relation_type) DO UPDATE SET
          status = 'active', contract_json = excluded.contract_json,
          created_by_input_id = excluded.created_by_input_id,
          updated_at = excluded.updated_at
      `).run(
        edgeId,
        world.id,
        sourceLoopId,
        targetLoopId,
        JSON.stringify({
          contract_version: 1,
          materialized_as: "scene",
          scene_id: sceneId,
          scene_policy: interactionPolicy,
          automatic_presence_intersection: false,
        }),
        input.id,
        timestamp,
        timestamp,
      );
    }
    this.db.prepare(`
      UPDATE world_scenes
      SET status = 'active', activated_at = COALESCE(activated_at, ?),
        updated_at = ?
      WHERE id = ? AND status = 'forming'
        AND (SELECT COUNT(*) FROM world_scene_participants
             WHERE scene_id = ? AND status = 'active') >= 2
    `).run(timestamp, timestamp, sceneId, sceneId);
    this.db.prepare(`
      UPDATE world_events SET scene_id = ?
      WHERE space_id = ? AND (id = ? OR causation_event_id = ?)
    `).run(sceneId, world.id, input.intent_event_id, input.intent_event_id);
    return this.db.prepare("SELECT * FROM world_scenes WHERE id = ?").get(sceneId);
  }

  applyWorldSceneTransition({
    world,
    input,
    judgementResult,
    fallbackSceneId = null,
    timestamp = now(),
  }) {
    const transition = judgementResult.scene_transition;
    if (transition === undefined || transition === null) return null;
    const reject = (message, details = {}) =>
      fail("INVALID_SCENE_TRANSITION", message, {
        input_id: input.id,
        requested_transition: transition,
        ...details,
      });
    if (typeof transition !== "object" || Array.isArray(transition)) {
      reject("Scene transition must be an object.");
    }
    const declaredSceneId =
      typeof transition.scene_id === "string" && transition.scene_id.trim()
        ? transition.scene_id.trim()
        : null;
    const inputSceneId = parseJsonObject(input.data_json).scene_id ?? null;
    const authorizedSceneId = inputSceneId ?? fallbackSceneId;
    if (!authorizedSceneId) {
      reject("A Scene transition requires a server-validated Scene binding.");
    }
    if (declaredSceneId && declaredSceneId !== authorizedSceneId) {
      reject("The requested Scene does not match the input's validated Scene.", {
        authorized_scene_id: authorizedSceneId,
      });
    }
    const sceneId = authorizedSceneId;
    const nextStatus = transition.to_status ?? transition.status;
    if (!["forming", "active", "resolved", "closed"].includes(nextStatus)) {
      reject("Scene transition has an unsupported target status.");
    }
    const scene = this.db.prepare(`
      SELECT scene.* FROM world_scenes scene
      JOIN world_scene_participants participant ON participant.scene_id = scene.id
      WHERE scene.id = ? AND scene.space_id = ? AND participant.pet_id = ?
    `).get(sceneId, world.id, input.actor_pet_id);
    if (!scene) reject("The validated Scene is not available to this actor.");
    const allowed = {
      forming: new Set(["active", "resolved", "closed"]),
      active: new Set(["resolved", "closed"]),
      resolved: new Set(["closed"]),
      closed: new Set(),
    };
    if (scene.status === nextStatus || !allowed[scene.status]?.has(nextStatus)) {
      reject("Scene transition is not a legal monotonic lifecycle step.", {
        current_status: scene.status,
        requested_status: nextStatus,
      });
    }
    const updated = this.db.prepare(`
      UPDATE world_scenes SET status = ?,
        activated_at = CASE WHEN ? = 'active' THEN COALESCE(activated_at, ?) ELSE activated_at END,
        resolved_by_input_id = CASE WHEN ? IN ('resolved', 'closed') THEN ? ELSE resolved_by_input_id END,
        resolved_at = CASE WHEN ? IN ('resolved', 'closed') THEN COALESCE(resolved_at, ?) ELSE resolved_at END,
        closed_at = CASE WHEN ? = 'closed' THEN COALESCE(closed_at, ?) ELSE closed_at END,
        updated_at = ?
      WHERE id = ? AND status = ?
    `).run(
      nextStatus,
      nextStatus,
      timestamp,
      nextStatus,
      input.id,
      nextStatus,
      timestamp,
      nextStatus,
      timestamp,
      timestamp,
      scene.id,
      scene.status,
    );
    if (updated.changes !== 1) {
      reject("Scene changed before the requested transition could be applied.");
    }
    return {
      status: "applied",
      requested_transition: transition,
      applied_scene_id: scene.id,
      from_status: scene.status,
      to_status: nextStatus,
      reason: "validated_and_committed",
    };
  }

  worldLoopContext(spaceId, petId, timestamp = now()) {
    this.ensureWorldStoryLoops(spaceId, petId, timestamp);
    const memberRows = this.db.prepare(`
      SELECT loop.*,
        participant.pet_id AS participant_pet_id,
        participant.role AS participant_role,
        participant.status AS participant_status,
        participant.is_foreground,
        participant.private_context_json,
        participant.joined_at
      FROM world_loop_participants participant
      JOIN world_story_loops loop ON loop.id = participant.loop_id
      WHERE participant.space_id = ? AND participant.pet_id = ?
      ORDER BY participant.is_foreground DESC, loop.updated_at DESC, loop.id ASC
    `).all(spaceId, petId);
    const memberLoops = memberRows.map(storyLoopView);
    const foregroundLoop =
      memberLoops.find(
        (loop) =>
          loop.participation?.is_foreground &&
          loop.status === "active" &&
          loop.participation.status === "active",
      ) ?? null;
    const publicRows = this.db.prepare(`
      SELECT loop.* FROM world_story_loops loop
      WHERE loop.space_id = ? AND loop.visibility = 'world'
        AND loop.scope IN ('public', 'world') AND loop.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM world_loop_participants participant
          WHERE participant.loop_id = loop.id AND participant.pet_id = ?
        )
      ORDER BY loop.updated_at DESC, loop.id ASC
      LIMIT 12
    `).all(spaceId, petId);
    const visibleLoopIds = new Set(memberLoops.map((loop) => loop.id));
    const edgeRows = visibleLoopIds.size === 0
      ? []
      : this.db.prepare(`
          SELECT edge.* FROM world_loop_edges edge
          WHERE edge.space_id = ?
            AND edge.source_loop_id IN (${[...visibleLoopIds].map(() => "?").join(",")})
            AND edge.target_loop_id IN (${[...visibleLoopIds].map(() => "?").join(",")})
          ORDER BY edge.updated_at DESC, edge.id ASC
          LIMIT 20
        `).all(spaceId, ...visibleLoopIds, ...visibleLoopIds);
    return {
      contract_version: 1,
      foreground_loop: foregroundLoop,
      active_loops: memberLoops.filter(
        (loop) =>
          loop.status === "active" && loop.participation?.status === "active",
      ),
      suspended_loops: memberLoops.filter(
        (loop) =>
          loop.status === "suspended" ||
          loop.participation?.status === "suspended",
      ),
      completed_loops: memberLoops
        .filter(
          (loop) =>
            loop.status === "completed" ||
            loop.participation?.status === "completed",
        )
        .slice(0, 8),
      public_opportunities: publicRows.map(storyLoopView),
      current_scenes: this.activeWorldScenes(spaceId, petId),
      intersection: {
        contract_version: 1,
        materialize_as: "scene",
        automatic_presence_intersection: false,
        candidates: edgeRows.map((edge) => ({
          id: edge.id,
          source_loop_id: edge.source_loop_id,
          target_loop_id: edge.target_loop_id,
          relation_type: edge.relation_type,
          status: edge.status,
          contract: parseJsonObject(edge.contract_json),
          created_by_input_id: edge.created_by_input_id ?? null,
        })),
      },
      privacy_scope:
        "actor-owned and actor-participating Loops, plus world-visible public opportunities; other Characters' private Loops are excluded",
    };
  }

  worldResumeBundle(spaceId, petId, timestamp = now()) {
    const journey = this.worldMemberJourney(spaceId, petId);
    const loopContext = this.worldLoopContext(spaceId, petId, timestamp);
    return {
      contract_version: 1,
      resume_kind: loopContext.foreground_loop ? "continue" : "choose",
      foreground_loop: loopContext.foreground_loop,
      context_summary: journey.context_summary,
      suggested_actions: journey.suggested_actions,
      active_branch_count: Math.max(0, loopContext.active_loops.length - 1),
      suspended_branch_count: loopContext.suspended_loops.length,
      relevant_updates: this.worldRelevantUpdates(spaceId, petId),
      automatic_context: true,
      loop_context: loopContext,
    };
  }

  worldRelevantUpdates(spaceId, petId, limit = 20) {
    const available = Number(
      this.db.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name IN ('events', 'event_receipts')
      `).get().count,
    ) === 2;
    if (!available) return [];
    const deliveryMode = this.db.prepare(`
      SELECT delivery_mode FROM spaces WHERE id = ?
    `).get(spaceId)?.delivery_mode ?? "legacy_broadcast";
    const boundedLimit = Math.max(1, Math.min(limit, 50));
    // A resume bundle is a foreground recovery surface, not a raw event
    // cursor.  In particular, a player who was offline must not have a live
    // collective invitation pushed out by an arbitrarily long backlog of
    // ambient updates.  Select unanswered, still-open invitations first,
    // then use the remaining bounded space for the oldest unseen context.
    // Keeping both sets bounded makes repeated visits stable without turning
    // the visit response into an unbounded activity feed.
    const rows = this.db.prepare(`
      WITH eligible AS (
        SELECT event.*, receipt.delivered_at, receipt.displayed_at, receipt.read_at,
          CASE WHEN event.event_type = 'world.interaction_opened'
            AND interaction.status = 'open'
            AND NOT EXISTS (
              SELECT 1 FROM world_inputs input
              WHERE input.interaction_id = interaction.id
                AND input.actor_pet_id = event.pet_id
            )
            THEN 0
            WHEN COALESCE(json_extract(event.payload_json, '$.actionRequired'), 0) = 1
              THEN 0
            ELSE 1
          END AS resume_priority
        FROM events event
        LEFT JOIN event_receipts receipt
          ON receipt.event_id = event.id AND receipt.device_id = ?
        LEFT JOIN world_interactions interaction
          ON interaction.id = json_extract(event.payload_json, '$.interactionId')
            AND interaction.space_id = ?
        WHERE event.pet_id = ?
          AND event.event_type IN ('world.event_committed', 'world.interaction_opened')
          AND json_extract(event.payload_json, '$.worldId') = ?
          AND COALESCE(json_extract(event.payload_json, '$.relevance'), '')
            IN ('direct', 'contextual', 'collective',
              CASE WHEN ? = 'legacy_broadcast' THEN 'legacy' ELSE '' END)
          AND receipt.displayed_at IS NULL
          AND receipt.read_at IS NULL
      )
      SELECT * FROM eligible
      ORDER BY resume_priority ASC,
        CASE WHEN resume_priority = 0 THEN id END DESC,
        CASE WHEN resume_priority = 1 THEN id END ASC
      LIMIT ?
    `).all(
      this.principalSessionId,
      spaceId,
      petId,
      spaceId,
      deliveryMode,
      boundedLimit,
    );
    return rows.map((row) => {
      const payload = parseJsonObject(row.payload_json);
      const directed =
        payload.targetCharacterId === petId && payload.inputBodyText;
      return {
        event_id: `evt_${row.id}`,
        event_type: row.event_type,
        summary: directed
          ? `${payload.actorName ?? "世界成员"}对你说：${payload.inputBodyText}`
          : payload.outcomeText ??
            payload.promptText ??
            payload.inputBodyText ??
            "与你当前经历相关的世界发生了变化。",
        relevance: payload.relevance,
        relevance_reason: payload.relevanceReason ?? "world_story_update",
        delivery_policy: payload.deliveryPolicy ?? "ambient",
        action_required: payload.actionRequired === true,
        actor: payload.actorCharacterId
          ? {
              id: payload.actorCharacterId,
              name: payload.actorName ?? "世界成员",
            }
          : null,
        target_character_id: payload.targetCharacterId ?? null,
        input_id: payload.inputId ?? null,
        outcome_event_id: payload.outcomeEventId ?? null,
        world_state_version: payload.worldStateVersion ?? null,
        interaction_id: payload.interactionId ?? null,
        prompt_event_id: payload.promptEventId ?? null,
        reply_to_event_id:
          row.event_type === "world.interaction_opened"
            ? payload.promptEventId ?? null
            : null,
        scene_id: payload.sceneId ?? null,
        interaction_mode: payload.interactionMode ?? null,
        interaction_quorum: payload.interactionQuorum ?? null,
        interaction_closes_at: payload.interactionClosesAt ?? null,
        interaction_choice_options: payload.interactionChoiceOptions ?? null,
        created_at: row.created_at,
        delivery: {
          state: row.read_at != null
            ? "read"
            : row.displayed_at != null
              ? "displayed"
              : row.delivered_at != null
                ? "delivered"
                : "queued",
        },
      };
    });
  }

  applyAuthoritativeWorldLoopTransitions({
    world,
    input,
    judgement,
    judgementResult,
    openedHooks = [],
    timestamp = now(),
  }) {
    if (!judgement || judgement.decision !== "accepted" || !input.actor_pet_id) {
      return;
    }
    const petId = input.actor_pet_id;
    const openedByTitle = new Map();
    for (const title of openedHooks) {
      const normalizedTitle = title.trim().slice(0, 500);
      const loop = this.insertWorldStoryLoop({
        spaceId: world.id,
        ownerPetId: petId,
        title: normalizedTitle,
        sourceKind: "host",
        sourceKey: `${input.id}:hook:${stableLoopKey(normalizedTitle)}`,
        context: { opened_by_host: true },
        intersectionContract: {
          version: 1,
          materialize_as: "scene",
          requires_causal_overlap: true,
          automatic_presence_intersection: false,
        },
        openedByInputId: input.id,
        timestamp,
      });
      this.db.prepare(`
        INSERT OR IGNORE INTO world_loop_participants (
          loop_id, space_id, pet_id, role, status, is_foreground,
          private_context_json, joined_at, updated_at
        ) VALUES (?, ?, ?, 'owner', 'active', 0, '{}', ?, ?)
      `).run(loop.id, world.id, petId, timestamp, timestamp);
      openedByTitle.set(normalizedTitle, loop.id);
    }
    this.ensureWorldStoryLoops(world.id, petId, timestamp);

    // Materialize only server-authorized Scene participants first. The whole
    // caller transaction rolls this back if the declared Loop transition is
    // invalid, so a rejected Host contract cannot leave a partial Scene.
    const materializedScene = this.materializeWorldSceneFromJudgement({
      world,
      input,
      judgementResult,
      timestamp,
    });
    if (judgement.outcome_event_id) {
      refreshWorldDeliveryRecipientSnapshot(
        this.db,
        judgement.outcome_event_id,
      );
    }

    const declared = Array.isArray(judgementResult.loop_transitions)
      ? judgementResult.loop_transitions
      : judgementResult.loop_transition &&
          typeof judgementResult.loop_transition === "object" &&
          !Array.isArray(judgementResult.loop_transition)
        ? [judgementResult.loop_transition]
        : [];
    if (declared.length > 20) {
      fail("INVALID_LOOP_TRANSITION", "A judgement may apply at most 20 Loop transitions.");
    }
    if (declared.length === 0) {
      const sceneReceipt = this.applyWorldSceneTransition({
        world,
        input,
        judgementResult,
        fallbackSceneId: materializedScene?.id ?? null,
        timestamp,
      });
      this.ensureWorldStoryLoops(world.id, petId, timestamp);
      return { status: "not_requested", receipts: [], sceneReceipt };
    }
    const receipts = [];
    const rejectTransition = (message, index, candidate) =>
      fail("INVALID_LOOP_TRANSITION", message, {
        input_id: input.id,
        transition_index: index,
        requested_transition: candidate,
      });
    const allowedActions = new Set([
      "continue",
      "open",
      "suspend",
      "resume",
      "complete",
      "intersect",
    ]);
    const memberLoop = (loopId) =>
      this.db.prepare(`
        SELECT loop.* FROM world_story_loops loop
        JOIN world_loop_participants participant ON participant.loop_id = loop.id
        WHERE loop.id = ? AND loop.space_id = ? AND participant.pet_id = ?
      `).get(loopId, world.id, petId);
    const sceneRelatedLoop = (loopId) =>
      this.db.prepare(`
        SELECT target_loop.*
        FROM world_scene_participants self
        JOIN world_scene_participants peer ON peer.scene_id = self.scene_id
        JOIN world_scenes scene ON scene.id = self.scene_id
        JOIN world_story_loops target_loop ON target_loop.id = peer.personal_loop_id
        WHERE self.space_id = ? AND self.pet_id = ?
          AND self.status = 'active' AND peer.status = 'active'
          AND scene.status IN ('forming', 'active', 'resolved')
          AND target_loop.id = ? AND target_loop.space_id = ?
        LIMIT 1
      `).get(world.id, petId, loopId, world.id);
    const foregroundId = () =>
      this.db.prepare(`
        SELECT loop_id FROM world_loop_participants
        WHERE space_id = ? AND pet_id = ? AND status = 'active'
          AND is_foreground = 1
        LIMIT 1
      `).get(world.id, petId)?.loop_id ?? null;

    for (const [index, candidate] of declared.slice(0, 20).entries()) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        rejectTransition("Loop transition must be an object.", index, candidate);
      }
      if (candidate.contract_version !== 1) {
        rejectTransition("Unsupported Loop transition contract version.", index, candidate);
      }
      const declaredScope = candidate.scope;
      if (
        !["personal", "public", "world"].includes(declaredScope)
      ) rejectTransition("Unsupported persisted Story Loop scope.", index, candidate);
      const declaredAction = candidate.transition ?? candidate.action;
      const action = typeof declaredAction === "string"
        ? declaredAction.trim()
        : "";
      if (!allowedActions.has(action)) {
        rejectTransition("Unsupported Story Loop transition.", index, candidate);
      }
      const fromPhase =
        typeof candidate.from_phase === "string" ? candidate.from_phase.trim() : "";
      const toPhase =
        typeof (candidate.to_phase ?? candidate.phase) === "string"
          ? (candidate.to_phase ?? candidate.phase).trim().slice(0, 120)
          : "";
      const reason =
        typeof candidate.reason === "string" ? candidate.reason.trim().slice(0, 500) : "";
      if (!fromPhase || !toPhase || !reason) {
        rejectTransition(
          "Loop transition requires from_phase, to_phase, and reason.",
          index,
          candidate,
        );
      }
      let loopId =
        typeof candidate.loop_id === "string" ? candidate.loop_id.trim() : "";

      if (action === "open") {
        if (declaredScope !== "personal") {
          rejectTransition("Only personal Story Loops can be opened by an actor turn.", index, candidate);
        }
        const title =
          typeof candidate.title === "string"
            ? candidate.title.trim().slice(0, 500)
            : typeof candidate.reason === "string"
              ? candidate.reason.trim().slice(0, 500)
              : "";
        if (!title) rejectTransition("Opening a Loop requires a title.", index, candidate);
        loopId = openedByTitle.get(title) ?? "";
        if (!loopId) {
          loopId = this.db.prepare(`
            SELECT loop.id FROM world_story_loops loop
            JOIN world_loop_participants participant
              ON participant.loop_id = loop.id
            WHERE loop.space_id = ? AND loop.owner_pet_id = ?
              AND loop.scope = 'personal' AND loop.title = ?
              AND loop.status = 'active' AND participant.pet_id = ?
              AND participant.status = 'active'
            ORDER BY loop.updated_at DESC, loop.id ASC
            LIMIT 1
          `).get(world.id, petId, title, petId)?.id ?? "";
        }
        if (!loopId) {
          const loop = this.insertWorldStoryLoop({
            spaceId: world.id,
            ownerPetId: petId,
            title,
            phase: toPhase,
            sourceKind: "host",
            sourceKey: `${input.id}:transition:${index}:${stableLoopKey(title)}`,
            context:
              candidate.context &&
              typeof candidate.context === "object" &&
              !Array.isArray(candidate.context)
                ? candidate.context
                : {},
            intersectionContract: {
              version: 1,
              materialize_as: "scene",
              requires_causal_overlap: true,
              automatic_presence_intersection: false,
            },
            openedByInputId: input.id,
            timestamp,
          });
          loopId = loop.id;
          this.db.prepare(`
            INSERT OR IGNORE INTO world_loop_participants (
              loop_id, space_id, pet_id, role, status, is_foreground,
              private_context_json, joined_at, updated_at
            ) VALUES (?, ?, ?, 'owner', 'active', 0, '{}', ?, ?)
          `).run(loop.id, world.id, petId, timestamp, timestamp);
        }
        this.db.prepare(`
          UPDATE world_story_loops SET phase = ?, updated_at = ? WHERE id = ?
        `).run(toPhase, timestamp, loopId);
        if (candidate.foreground === true || !foregroundId()) {
          this.setForegroundWorldStoryLoop(world.id, petId, loopId, timestamp);
        }
        receipts.push({
          status: "applied",
          requested_transition: candidate,
          applied_loop_id: loopId,
          applied_transition: action,
          reason: "validated_and_committed",
        });
        continue;
      }

      if (!loopId) rejectTransition("Loop transition requires loop_id.", index, candidate);
      const loop = loopId ? memberLoop(loopId) : null;
      if (!loop) rejectTransition("The requested Loop is not available to this actor.", index, candidate);
      if (declaredScope !== loop.scope) {
        rejectTransition("The requested Loop scope does not match persisted state.", index, candidate);
      }
      if (fromPhase !== loop.phase) {
        rejectTransition("The requested Loop phase is stale.", index, candidate);
      }

      if (action === "continue") {
        const currentContext = parseJsonObject(loop.context_json);
        const nextContext =
          candidate.context &&
          typeof candidate.context === "object" &&
          !Array.isArray(candidate.context)
            ? { ...currentContext, ...candidate.context }
            : currentContext;
        this.db.prepare(`
          UPDATE world_story_loops
          SET phase = ?, context_json = ?, updated_at = ?
          WHERE id = ?
        `).run(toPhase, JSON.stringify(nextContext), timestamp, loop.id);
        this.setForegroundWorldStoryLoop(world.id, petId, loop.id, timestamp);
        receipts.push({ status: "applied", requested_transition: candidate, applied_loop_id: loop.id, applied_transition: action, reason: "validated_and_committed" });
        continue;
      }

      if (action === "suspend") {
        this.db.prepare(`
          UPDATE world_loop_participants
          SET status = 'suspended', is_foreground = 0, updated_at = ?
          WHERE loop_id = ? AND pet_id = ?
        `).run(timestamp, loop.id, petId);
        if (loop.scope === "personal" && loop.owner_pet_id === petId) {
          this.db.prepare(`
            UPDATE world_story_loops
            SET status = 'suspended', phase = ?, updated_at = ? WHERE id = ?
          `).run(
            toPhase,
            timestamp,
            loop.id,
          );
        }
        receipts.push({ status: "applied", requested_transition: candidate, applied_loop_id: loop.id, applied_transition: action, reason: "validated_and_committed" });
        continue;
      }

      if (action === "resume") {
        if (loop.scope === "personal" && loop.owner_pet_id === petId) {
          this.db.prepare(`
            UPDATE world_story_loops
            SET status = 'active', completed_by_input_id = NULL,
              completed_at = NULL, phase = ?, updated_at = ?
            WHERE id = ?
          `).run(
            toPhase,
            timestamp,
            loop.id,
          );
        }
        this.db.prepare(`
          UPDATE world_loop_participants
          SET status = 'active', completed_at = NULL, updated_at = ?
          WHERE loop_id = ? AND pet_id = ?
        `).run(timestamp, loop.id, petId);
        this.setForegroundWorldStoryLoop(world.id, petId, loop.id, timestamp);
        receipts.push({ status: "applied", requested_transition: candidate, applied_loop_id: loop.id, applied_transition: action, reason: "validated_and_committed" });
        continue;
      }

      if (action === "complete") {
        this.db.prepare(`
          UPDATE world_loop_participants
          SET status = 'completed', is_foreground = 0,
            completed_at = COALESCE(completed_at, ?), updated_at = ?
          WHERE loop_id = ? AND pet_id = ?
        `).run(timestamp, timestamp, loop.id, petId);
        if (loop.scope === "personal" && loop.owner_pet_id === petId) {
          this.db.prepare(`
            UPDATE world_story_loops
            SET status = 'completed', completed_by_input_id = ?,
              completed_at = COALESCE(completed_at, ?), phase = ?, updated_at = ?
            WHERE id = ?
          `).run(
            input.id,
            timestamp,
            toPhase,
            timestamp,
            loop.id,
          );
          const journey = this.ensureWorldMemberJourney(world.id, petId, timestamp);
          const remainingLegacyLoops = parseJsonArray(journey.open_loops_json)
            .filter((item) => typeof item === "string" && item.trim())
            .filter((title) => title.trim() !== loop.title);
          this.db.prepare(`
            UPDATE world_member_journeys
            SET open_loops_json = ?, updated_at = ?
            WHERE space_id = ? AND pet_id = ?
          `).run(
            JSON.stringify(remainingLegacyLoops),
            timestamp,
            world.id,
            petId,
          );
        }
        receipts.push({ status: "applied", requested_transition: candidate, applied_loop_id: loop.id, applied_transition: action, reason: "validated_and_committed" });
        continue;
      }

      if (action === "intersect") {
        const targetLoopId =
          typeof candidate.target_loop_id === "string"
            ? candidate.target_loop_id.trim()
            : "";
        if (!targetLoopId || targetLoopId === loop.id) {
          rejectTransition("Intersection requires a distinct target_loop_id.", index, candidate);
        }
        let target = memberLoop(targetLoopId) ?? sceneRelatedLoop(targetLoopId);
        if (!target) {
          target = this.db.prepare(`
            SELECT * FROM world_story_loops
            WHERE id = ? AND space_id = ? AND visibility = 'world'
              AND scope IN ('public', 'world') AND status = 'active'
          `).get(targetLoopId, world.id);
          if (target) {
            this.db.prepare(`
              INSERT OR IGNORE INTO world_loop_participants (
                loop_id, space_id, pet_id, role, status, is_foreground,
                private_context_json, joined_at, updated_at
              ) VALUES (?, ?, ?, 'participant', 'active', 0, '{}', ?, ?)
            `).run(target.id, world.id, petId, timestamp, timestamp);
          }
        }
        if (!target) {
          rejectTransition("Intersection target is not related by a verified Scene or public opportunity.", index, candidate);
        }
        const matchingEntities = Array.isArray(candidate.matching_entities)
          ? candidate.matching_entities
              .filter((item) => typeof item === "string" && item.trim())
              .map((item) => item.trim().slice(0, 160))
              .slice(0, 20)
          : [];
        const scenePolicy = ["async", "sync", "flexible"].includes(
          candidate.scene_policy,
        )
          ? candidate.scene_policy
          : "flexible";
        const sourceLoopId = loop.id;
        const edgeId = `loop-edge:${stableLoopKey(
          world.id,
          sourceLoopId,
          target.id,
          "intersection_candidate",
        )}`;
        this.db.prepare(`
          INSERT OR IGNORE INTO world_loop_edges (
            id, space_id, source_loop_id, target_loop_id, relation_type,
            status, visibility, contract_json, created_by_input_id,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'intersection_candidate', 'proposed',
            'participants', ?, ?, ?, ?)
        `).run(
          edgeId,
          world.id,
          sourceLoopId,
          target.id,
          JSON.stringify({
            contract_version: 1,
            materialize_as: "scene",
            scene_creation: "deferred",
            requires_world_host_authority: true,
            reason,
            matching_entities: matchingEntities,
            scene_policy: scenePolicy,
          }),
          input.id,
          timestamp,
          timestamp,
        );
        receipts.push({ status: "applied", requested_transition: candidate, applied_loop_id: loop.id, applied_transition: action, target_loop_id: target.id, reason: "validated_and_committed" });
      }
    }
    const sceneReceipt = this.applyWorldSceneTransition({
      world,
      input,
      judgementResult,
      fallbackSceneId: materializedScene?.id ?? null,
      timestamp,
    });
    this.ensureWorldStoryLoops(world.id, petId, timestamp);
    return { status: "applied", receipts, sceneReceipt };
  }

  normalizeStoredHostChoices(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 6).flatMap((item, index) => {
      if (typeof item === "string" && item.trim()) {
        const label = item.trim().slice(0, 160);
        return [{
          id: `next-${index + 1}`,
          label,
          input_type: "action",
          event_type: "host.suggestion_selected",
          body_text: label,
          data: {},
          visibility: "world",
        }];
      }
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const label =
        typeof item.label === "string" ? item.label.trim().slice(0, 160) : "";
      const body =
        typeof item.body_text === "string"
          ? item.body_text.trim().slice(0, 4000)
          : label;
      if (!label || !body) return [];
      const inputType = WORLD_INPUT_TYPES.has(item.input_type)
        ? item.input_type
        : "choice";
      const eventType =
        typeof item.event_type === "string" && item.event_type.trim()
          ? item.event_type.trim().slice(0, 80)
          : "host.suggestion_selected";
      return [{
        id:
          typeof item.id === "string" && item.id.trim()
            ? item.id.trim().slice(0, 80)
            : `choice-${index + 1}`,
        label,
        input_type: inputType,
        event_type: eventType,
        body_text: body,
        data:
          item.data && typeof item.data === "object" && !Array.isArray(item.data)
            ? JSON.parse(JSON.stringify(item.data))
            : {},
        scene_id:
          typeof item.scene_id === "string" && item.scene_id.trim()
            ? item.scene_id.trim().slice(0, 100)
            : null,
        visibility: EVENT_VISIBILITIES.has(item.visibility)
          ? item.visibility
          : "world",
      }];
    });
  }

  worldLiveContext(spaceId, petId) {
    const rows = this.db
      .prepare(`
        SELECT pet.id, pet.${this.petNameColumn} AS name
        FROM presence live
        JOIN pets pet ON pet.id = live.pet_id
        WHERE live.space_id = ?
        ORDER BY live.entered_at ASC, pet.id ASC
      `)
      .all(spaceId);
    const selfPresent = rows.some((row) => row.id === petId);
    const otherPresentCount = rows.filter((row) => row.id !== petId).length;
    const memberCount = Number(
      this.db
        .prepare(`
          SELECT COUNT(*) AS count FROM space_memberships
          WHERE space_id = ? AND status = 'active'
        `)
        .get(spaceId).count,
    );
    return {
      present_count: rows.length,
      member_count: memberCount,
      other_present_count: otherPresentCount,
      currently_alone: selfPresent && otherPresentCount === 0,
      waiting_for_others: false,
      members: selfPresent
        ? rows.map((row) => ({ pet_id: row.id, name: row.name }))
        : [],
    };
  }

  worldParticipationContext(config, liveContext, spaceId, petId) {
    const policy = config.participation_policy;
    const multiplayerPresent = liveContext.other_present_count > 0;
    const ownConsent =
      spaceId && petId
        ? this.db
            .prepare(`
              SELECT multiplayer_consent
              FROM world_member_journeys
              WHERE space_id = ? AND pet_id = ?
            `)
            .get(spaceId, petId)?.multiplayer_consent ?? "pending"
        : "pending";
    const sharedParticipationAvailable =
      policy.solo_enabled || (multiplayerPresent && policy.multiplayer_enabled);
    const currentMode = sharedParticipationAvailable ? "shared" : "waiting";
    const directInteractionAvailable =
      multiplayerPresent && policy.multiplayer_enabled;
    return {
      configured_mode: policy.mode,
      current_mode: currentMode,
      world_state_scope: "shared",
      // Presence is a transport hint, not evidence that two stories intersect.
      participation_style: "independent_until_causal_intersection",
      present_count: liveContext.present_count,
      member_count: liveContext.member_count,
      solo_enabled: policy.solo_enabled,
      multiplayer_enabled: policy.multiplayer_enabled,
      multiplayer_transition: policy.multiplayer_transition,
      multiplayer_consent: "not_required",
      direct_interaction_preference:
        ownConsent === "declined" ? "independent" : "open",
      direct_interaction_available: directInteractionAvailable,
      response_optional: true,
      consenting_peer_count: 0,
      consent_required: false,
      multiplayer_ready: false,
      multiplayer_available:
        multiplayerPresent && policy.multiplayer_enabled,
      blocked_waiting_for_members: currentMode === "waiting",
    };
  }

  multiplayerConsentChoices() {
    return this.normalizeStoredHostChoices([
      {
        id: "multiplayer-consent-accept",
        label: "愿意与现场成员互动",
        input_type: "choice",
        event_type: "host.multiplayer.accept",
        body_text: "我愿意在这一轮与当前现场成员互动。",
      },
      {
        id: "multiplayer-consent-decline",
        label: "暂时继续单独体验",
        input_type: "choice",
        event_type: "host.multiplayer.decline",
        body_text: "我暂时继续单独体验，不进入多人互动。",
      },
    ]);
  }

  worldStateSnapshotSummary(spaceId) {
    // State keys are an implementation detail.  On entry there may be no
    // event recap yet, so use the world's authored, player-facing opening
    // instead of serializing an object such as world_progress/open_threads.
    const world = this.requireSpace(spaceId);
    const spec = this.currentWorldSpec(spaceId);
    const opening = typeof spec?.entry_prompt === "string"
      ? spec.entry_prompt.trim()
      : "眼前有一件值得你亲自决定如何回应的事。";
    // Entry guidance renders entry_prompt directly, while return guidance
    // replaces this fallback with an explicit "no new changes" recap.
    return `${world.name}目前没有需要补充的公开变化。${opening}`.slice(0, 1200);
  }

  worldContextSummary(spaceId, options = 3) {
    const normalizedOptions =
      typeof options === "number" ? { maxEvents: options } : options ?? {};
    const bounded = Math.max(
      1,
      Math.min(Number(normalizedOptions.maxEvents) || 3, 8),
    );
    const petId = normalizedOptions.petId ?? null;
    const afterSequence = Math.max(
      0,
      Number(normalizedOptions.afterSequence) || 0,
    );
    const events = (petId
      ? this.db
          .prepare(`
        SELECT body_text
        FROM world_events event
        WHERE event.space_id = ? AND event.sequence > ?
          AND (event.event_class = 'outcome' OR event.event_type = 'trigger.fired')
          AND event.body_text <> ''
          AND (
            event.actor_pet_id = ?
            OR (event.visibility = 'actor' AND event.audience_pet_id = ?)
            OR (
              event.actor_type IN ('world', 'system')
              AND event.visibility = 'world'
              AND event.scene_id IS NULL
              AND (
                event.causation_event_id IS NULL
                OR EXISTS (
                  SELECT 1 FROM world_events cause
                  WHERE cause.id = event.causation_event_id
                    AND (
                      cause.actor_pet_id = ?
                      OR cause.actor_type IN ('world', 'system')
                    )
                )
              )
            )
            OR (
              event.scene_id IS NOT NULL
              AND event.visibility = 'world'
              AND EXISTS (
                SELECT 1 FROM world_scene_participants scene_member
                WHERE scene_member.scene_id = event.scene_id
                  AND scene_member.pet_id = ?
                  AND scene_member.status IN ('invited', 'active')
              )
            )
          )
        ORDER BY event.sequence DESC
        LIMIT ?
      `)
          .all(spaceId, afterSequence, petId, petId, petId, petId, bounded)
      : this.db
          .prepare(`
        SELECT body_text
        FROM world_events
        WHERE space_id = ? AND sequence > ?
          AND (event_class = 'outcome' OR event_type = 'trigger.fired')
          AND body_text <> ''
          AND (
            visibility = 'world'
            OR (visibility = 'actor' AND audience_pet_id = ?)
          )
        ORDER BY sequence DESC
        LIMIT ?
      `)
          .all(spaceId, afterSequence, null, bounded))
      .map((row) => row.body_text.trim())
      .filter(Boolean)
      .reverse();
    if (events.length > 0) return events.join("；").slice(0, 1200);
    return this.worldStateSnapshotSummary(spaceId);
  }

  recordWorldHostTurn({
    world,
    petId,
    kind,
    stage,
    message,
    objective = "",
    contextSummary = "",
    choices = [],
    freeInputPrompt = "",
    causationInputId = null,
    timestamp = now(),
  }) {
    const agent = this.requireWorldAgent(world.id);
    const id = randomUUID();
    this.db
      .prepare(`
        INSERT INTO world_host_turns (
          id, space_id, pet_id, world_agent_id, turn_kind, stage,
          message_text, objective_text, context_summary, choices_json,
          free_input_prompt, causation_input_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        world.id,
        petId,
        agent.id,
        kind,
        stage,
        message,
        objective,
        contextSummary,
        JSON.stringify(choices),
        freeInputPrompt,
        causationInputId,
        timestamp,
      );
    return hostGuidanceView(
      this.db.prepare("SELECT * FROM world_host_turns WHERE id = ?").get(id),
    );
  }

  latestWorldHostGuidance(spaceId, petId, causationInputId) {
    const row =
      causationInputId === undefined
        ? this.db
            .prepare(`
              SELECT * FROM world_host_turns
              WHERE space_id = ? AND pet_id = ?
              ORDER BY created_at DESC, rowid DESC
              LIMIT 1
            `)
            .get(spaceId, petId)
        : this.db
            .prepare(`
              SELECT * FROM world_host_turns
              WHERE causation_input_id = ?
              ORDER BY created_at DESC, rowid DESC
              LIMIT 1
            `)
            .get(causationInputId);
    return hostGuidanceView(row);
  }

  activateWaitingWorldMembers(world, enteringPet, timestamp = now()) {
    const config = hostConfigView(this.currentWorldHostConfig(world.id));
    const waitingMembers = this.db
      .prepare(`
        SELECT live.pet_id
        FROM presence live
        WHERE live.space_id = ? AND live.pet_id <> ?
      `)
      .all(world.id, enteringPet.id);
    if (waitingMembers.length === 0) return;

    if (
      config.participation_policy.mode !== "multiplayer" &&
      config.onboarding_policy.requires_other_members !== true
    ) return;
    const choices = this.normalizeStoredHostChoices(
      config.onboarding_policy.starter_choices,
    );
    const objective =
      config.facilitation_policy.objective_text ||
      "继续自己的剧情；只有出现明确邀请或因果交汇时，才进入共同场景。";
    for (const member of waitingMembers) {
      const latest = this.latestWorldHostGuidance(world.id, member.pet_id);
      if (latest?.kind !== "waiting") continue;
      this.db
        .prepare(`
          UPDATE world_member_journeys
          SET stage = 'setup', suggested_actions_json = ?, updated_at = ?
          WHERE space_id = ? AND pet_id = ?
        `)
        .run(
          JSON.stringify(choices),
          timestamp,
          world.id,
          member.pet_id,
        );
      this.recordWorldHostTurn({
        world,
        petId: member.pet_id,
        kind: "setup",
        stage: "setup",
        message: `${config.name}提示：世界中出现了可能与你产生交汇的角色。在线并不等于已经相遇；你可以继续自己的方向，或在收到明确邀请、发现因果联系后再回应。`,
        objective,
        contextSummary: this.worldContextSummary(
          world.id,
          {
            maxEvents: config.recap_policy.max_events ?? 3,
            petId: member.pet_id,
          },
        ),
        choices,
        freeInputPrompt:
          config.onboarding_policy.free_input_prompt ||
          "也可以直接继续你自己的行动。",
        timestamp,
      });
    }
  }

  createEntryHostGuidance(world, petId, timestamp = now()) {
    const config = hostConfigView(this.currentWorldHostConfig(world.id));
    const spec = this.currentWorldSpec(world.id);
    const journeyRow = this.ensureWorldMemberJourney(world.id, petId, timestamp);
    const firstVisit = Number(journeyRow.visit_count) === 0;
    const memberOpenLoops = parseJsonArray(journeyRow.open_loops_json).filter(
      (item) => typeof item === "string" && item.trim(),
    );
    const worldState = this.worldStateView(world.id).value;
    const entryLoopContext = this.worldLoopContext(world.id, petId, timestamp);
    const foregroundTitle = entryLoopContext.foreground_loop?.title;
    const openLoops = [...new Set([
      ...(foregroundTitle ? [foregroundTitle] : []),
      ...memberOpenLoops,
    ])];
    const onboarding = config.onboarding_policy;
    const facilitation = config.facilitation_policy;
    const recap = config.recap_policy;
    const liveContext = this.worldLiveContext(world.id, petId);
    const participationContext = this.worldParticipationContext(
      config,
      liveContext,
      world.id,
      petId,
    );
    const waitingForOthers = participationContext.current_mode === "waiting";
    const officialWorld = OFFICIAL_WORLD_BY_ID.has(world.id);
    const hasConcreteEntryScene = spec.entry_prompt.trim().length > 0;
    const genericCustomOnboarding =
      !officialWorld &&
      hasConcreteEntryScene &&
      isGenericOnboardingChoices(onboarding.solo_choices) &&
      isGenericOnboardingChoices(onboarding.starter_choices);
    const playerFacingHostName = genericCustomOnboarding
      ? `${world.name}主持人`
      : config.name;
    const independentVisit =
      liveContext.other_present_count === 0 &&
      config.participation_policy.solo_enabled;
    const currentScenes = Array.isArray(entryLoopContext.current_scenes)
      ? entryLoopContext.current_scenes
      : [];
    const intersectionSummary = currentScenes.length > 0
      ? `你有${currentScenes.length}个尚可继续的交汇场景；只有当你明确回应其中一个场景时，才会推进共同剧情。`
      : "";
    const stage = firstVisit ? "setup" : "returning";
    const kind = waitingForOthers
      ? "waiting"
      : firstVisit
        ? "welcome"
        : "recap";
    let contextSummary = this.worldContextSummary(
      world.id,
      {
        maxEvents: recap.max_events ?? 3,
        petId,
        afterSequence: firstVisit
          ? 0
          : Number(journeyRow.last_departure_sequence ?? 0),
      },
    );
    if (!firstVisit && contextSummary.includes("目前没有需要补充的公开变化")) {
      contextSummary = journeyRow.current_role
        ? `你离开后没有新的公开变化；当前身份仍是“${journeyRow.current_role}”，可以从上次进度继续。`
        : "你离开后没有新的公开变化，可以从上次进度继续。";
    }
    const replayEntryScene = !firstVisit && !journeyRow.last_meaningful_at && hasConcreteEntryScene;
    const messageParts = waitingForOthers
      ? [
          `${playerFacingHostName}${firstVisit ? "欢迎你来到" : "欢迎你回到"}${world.name}。`,
          firstVisit ? onboarding.welcome_text : "",
          intersectionSummary,
          onboarding.solo_message || "你可以先选择参与方向。",
          firstVisit ? spec.entry_prompt : "",
        ]
      : firstVisit
        ? [
            `${playerFacingHostName}欢迎你来到${world.name}。`,
            genericCustomOnboarding ? "" : onboarding.welcome_text,
            // Loop migration uses stable machine IDs for old open threads.
            // The entry scene already supplies the player's immediate goal;
            // never turn those IDs into first-visit copy.
            !officialWorld && !genericCustomOnboarding && openLoops.length > 0
              ? `当前未解目标：${openLoops.slice(-3).join("；")}`
              : "",
            intersectionSummary,
            independentVisit ? onboarding.solo_message : "",
            spec.entry_prompt,
          ]
        : [
            `${playerFacingHostName}欢迎你回到${world.name}。`,
            contextSummary ? `上次之后：${contextSummary}` : "",
            replayEntryScene ? spec.entry_prompt : "",
            !replayEntryScene && !officialWorld && openLoops.length > 0
              ? `仍未解决：${openLoops.slice(-2).join("；")}`
              : "",
            intersectionSummary,
          ];
    const baseChoices = waitingForOthers
      ? this.normalizeStoredHostChoices(
          onboarding.solo_choices ?? onboarding.starter_choices,
        )
      : firstVisit
        ? this.normalizeStoredHostChoices(
            genericCustomOnboarding
              ? sceneGroundedStarterChoices(spec.entry_prompt)
              : independentVisit && Array.isArray(onboarding.solo_choices)
              ? onboarding.solo_choices
              : onboarding.starter_choices,
          )
        : replayEntryScene
          ? this.normalizeStoredHostChoices(
              genericCustomOnboarding
                ? sceneGroundedStarterChoices(spec.entry_prompt)
                : independentVisit && Array.isArray(onboarding.solo_choices)
                  ? onboarding.solo_choices
                  : onboarding.starter_choices,
            )
        : this.normalizeStoredHostChoices(facilitation.next_actions);
    const choices = participationContext.consent_required
      ? [...this.multiplayerConsentChoices(), ...baseChoices].slice(0, 6)
      : baseChoices;
    const freeInputPrompt =
      (firstVisit
        ? onboarding.free_input_prompt
        : facilitation.free_input_prompt) ||
      "也可以直接说你现在想做什么。";
    const objective = waitingForOthers
      ? onboarding.waiting_objective_text ||
        "先建立自己的方向；出现明确邀请或因果交汇时再决定是否回应。"
      : replayEntryScene
        ? spec.entry_prompt
      : genericCustomOnboarding
        ? spec.entry_prompt
      : independentVisit && onboarding.solo_objective_text
        ? onboarding.solo_objective_text
      : facilitation.objective_text || "找到一个适合自己的参与方式。";
    this.db
      .prepare(`
        UPDATE world_member_journeys
        SET stage = ?, visit_count = visit_count + 1,
          context_summary = ?, suggested_actions_json = ?,
          first_entered_at = COALESCE(first_entered_at, ?),
          last_entered_at = ?, updated_at = ?
        WHERE space_id = ? AND pet_id = ?
      `)
      .run(
        stage,
        contextSummary,
        JSON.stringify(choices),
        timestamp,
        timestamp,
        timestamp,
        world.id,
        petId,
      );
    const guidance = this.recordWorldHostTurn({
      world,
      petId,
      kind,
      stage,
      message: messageParts.filter(Boolean).join("\n\n"),
      objective,
      contextSummary,
      choices,
      freeInputPrompt,
      timestamp,
    });
    const memberState = this.worldMemberStateView(world.id, petId);
    const directorPlan = buildDirectorTurnPlan({
      host: config,
      worldState: { value: worldState },
      memberState,
      context: {
        ...this.worldHostContextPack(world, petId),
        actor_journey: this.worldMemberJourney(world.id, petId),
      },
      input: { id: `entry:${world.id}:${petId}:${journeyRow.visit_count}`, event_type: "host.entry", body_text: objective },
    });
    const playerFacingHost = genericCustomOnboarding
      ? {
          ...config,
          name: playerFacingHostName,
          onboarding_policy: {
            ...config.onboarding_policy,
            welcome_text: spec.entry_prompt,
            setup_prompt: spec.entry_prompt,
            solo_objective_text: spec.entry_prompt,
            starter_choices: choices.map((choice) => ({ ...choice })),
            solo_choices: choices.map((choice) => ({ ...choice })),
          },
          facilitation_policy: {
            ...config.facilitation_policy,
            objective_text: spec.entry_prompt,
            next_actions: choices.map((choice) => ({ ...choice })),
            free_input_prompt: freeInputPrompt,
          },
        }
      : config;
    return {
      ...guidance,
      // This is the player-facing entry projection, not the administrator's
      // immutable Host configuration. A concrete creator-authored opening
      // must not carry generic builder placeholder copy into a standard
      // world_visit response through nested metadata.
      host: playerFacingHost,
      journey: this.worldMemberJourney(world.id, petId),
      loop_context: entryLoopContext,
      live_context: liveContext,
      participation_context: participationContext,
      director_plan: directorPlan,
      untrusted_external_content: true,
    };
  }

  createInputHostGuidance(world, inputId, timestamp = now()) {
    const input = this.db
      .prepare("SELECT * FROM world_inputs WHERE id = ? AND space_id = ?")
      .get(inputId, world.id);
    if (!input) fail("DATA_ERROR", "World input is missing.");
    const judgement = this.db
      .prepare("SELECT * FROM world_judgements WHERE input_id = ?")
      .get(input.id);
    const config = hostConfigView(this.currentWorldHostConfig(world.id));
    const journeyRow = this.ensureWorldMemberJourney(
      world.id,
      input.actor_pet_id,
      timestamp,
    );
    const inputData = parseJsonObject(input.data_json).data ?? {};
    const judgementResult = parseJsonObject(judgement?.result_json);
    if (judgement) {
      const runtimeSignals = [];
      if (["clarification", "rejected"].includes(judgement.decision)) {
        runtimeSignals.push(["action_friction", judgement.decision === "clarification" ? 1 : 2]);
      }
      if (["conflict", "expired"].includes(judgement.resolution_disposition)) {
        runtimeSignals.push(["stale_or_expired", 1]);
      }
      if (
        judgement.decision === "accepted" &&
        (!Array.isArray(judgementResult.opened_hooks) ||
          judgementResult.opened_hooks.length === 0)
      ) {
        runtimeSignals.push(["missing_followup", 1]);
      }
      const declaredSignals = Array.isArray(judgementResult.runtime_signals)
        ? judgementResult.runtime_signals
        : [];
      for (const signal of declaredSignals) {
        if (["scene_repetition", "late_join_friction", "difficulty_mismatch"].includes(signal)) {
          runtimeSignals.push([signal, 1]);
        }
      }
      for (const [kind, weight] of runtimeSignals) {
        this.db.prepare(`
          INSERT OR IGNORE INTO world_runtime_signals (
            id, space_id, input_id, signal_kind, weight, details_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          `world-signal:${input.id}:${kind}`,
          world.id,
          input.id,
          kind,
          weight,
          JSON.stringify({
            decision: judgement.decision,
            resolution_disposition: judgement.resolution_disposition,
            event_type: input.event_type,
          }),
          timestamp,
        );
      }
    }
    const disposition = judgement?.resolution_disposition ?? "apply";
    const dispositionMessage =
      ({
        rebase:
          "你提交后共享世界已经发生变化；Host 已按最新事实重新解释你的原意，结果以上方说明为准。",
        absorbed:
          "你原本想达成的目标已被先前变化覆盖或完成，因此这次没有重复改写世界；你可以从当前结果继续。",
        conflict:
          "你依据的旧情况与当前事实冲突，因此原行动没有生效；请根据上方最新局面重新选择。",
        expired:
          "这项输入依赖的时机已经过去，因此没有生效；请根据上方最新局面提出新的行动。",
      })[disposition] ?? "";
    const dispositionObjective =
      disposition === "rebase" || disposition === "absorbed"
        ? "确认 Host 如何保留了你的原意，再从当前共享状态继续行动。"
        : disposition === "conflict" || disposition === "expired"
          ? "根据当前共享状态重新选择一个仍可执行的行动。"
          : "";
    let stage = journeyRow.stage;
    let offerNextActions = stage !== "setup";
    let kind;
    let message;
    if (!judgement) {
      kind = "waiting";
      const runtime = this.ensureWorldHostRuntime(world.id, timestamp);
      message =
        runtime.active_executor === "creator_codex"
          ? `${config.name}已接收这个输入，正在由当前实时主持处理。`
          : `${config.name}已接收这个输入，正在等待世界规则要求的复核。`;
    } else if (judgement.decision === "accepted") {
      if (
        input.event_type === "host.multiplayer.accept" ||
        input.event_type === "host.multiplayer.decline"
      ) {
        const consent =
          input.event_type === "host.multiplayer.accept"
            ? "accepted"
            : "declined";
        this.db
          .prepare(`
            UPDATE world_member_journeys
            SET multiplayer_consent = ?, last_meaningful_at = ?, updated_at = ?
            WHERE space_id = ? AND pet_id = ?
          `)
          .run(
            consent,
            timestamp,
            timestamp,
            world.id,
            input.actor_pet_id,
          );
        const liveContext = this.worldLiveContext(
          world.id,
          input.actor_pet_id,
        );
        const participation = this.worldParticipationContext(
          config,
          liveContext,
          world.id,
          input.actor_pet_id,
        );
        kind = "setup";
        offerNextActions = true;
        message =
          consent === "declined"
            ? `${config.name}已记录你暂不接受主动撮合；你的独立行动仍会继续影响共享 World。`
            : participation.direct_interaction_available
              ? `${config.name}已记录你愿意接受直接交流；现场成员仍可自由决定是否回应。`
              : `${config.name}已记录你的直接互动偏好；World 状态始终保持共享。`;
      } else if (
        input.event_type === "host.onboarding.role_selected" &&
        typeof inputData.role === "string"
      ) {
        stage = "setup";
        offerNextActions = true;
        this.db
          .prepare(`
            UPDATE world_member_journeys
            SET current_role = ?, participation_intent = ?, stage = 'setup',
              last_meaningful_at = ?, updated_at = ?
            WHERE space_id = ? AND pet_id = ?
          `)
          .run(
            inputData.role.trim().slice(0, 120),
            input.body_text,
            timestamp,
            timestamp,
            world.id,
            input.actor_pet_id,
          );
        kind = "setup";
        message = `${config.name}已记录你的身份：${inputData.role.trim().slice(0, 120)}。现在可以完成第一次实际参与。`;
      } else if (input.event_type === "host.onboarding.intent_selected") {
        stage = "setup";
        offerNextActions = true;
        this.db
          .prepare(`
            UPDATE world_member_journeys
            SET participation_intent = ?, stage = 'setup',
              last_meaningful_at = ?, updated_at = ?
            WHERE space_id = ? AND pet_id = ?
          `)
          .run(
            input.body_text,
            timestamp,
            timestamp,
            world.id,
            input.actor_pet_id,
          );
        kind = "setup";
        message = `${config.name}已经了解你的参与意图。接下来请选择或描述一件具体想做的事。`;
      } else {
        stage = "active";
        offerNextActions = true;
        this.db
          .prepare(`
            UPDATE world_member_journeys
            SET stage = 'active',
              onboarding_completed_at = COALESCE(onboarding_completed_at, ?),
              last_meaningful_at = ?, updated_at = ?
            WHERE space_id = ? AND pet_id = ?
          `)
          .run(
            timestamp,
            timestamp,
            timestamp,
            world.id,
            input.actor_pet_id,
          );
        kind = "progress";
        message = [
          judgement.outcome_text,
          dispositionMessage,
          `${config.name}已完成这次处理。你可以继续当前方向，也可以选择新的参与方式。`,
        ]
          .filter(Boolean)
          .join("\n\n");
      }
    } else {
      kind = "clarification";
      // Rejected/clarification/escalated turns must either offer Host-authored
      // repairs tied to this failure or no buttons at all. Falling back to
      // opening starters breaks the player's current situation.
      offerNextActions = true;
      message = [
        judgement.outcome_text,
        judgement.reason_text ? `原因：${judgement.reason_text}` : "",
        dispositionMessage,
        judgement.decision === "clarification"
          ? `${config.name}需要你补充一些信息后才能继续。`
          : `${config.name}没有接受这次输入，请调整后再试。`,
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    const facilitation = config.facilitation_policy;
    const eventNextActions =
      judgement?.decision === "accepted" &&
      facilitation.event_next_actions &&
      typeof facilitation.event_next_actions === "object" &&
      !Array.isArray(facilitation.event_next_actions)
        ? facilitation.event_next_actions[input.event_type]
        : undefined;
    const judgedNextActions =
      judgement?.decision === "accepted" &&
      Array.isArray(judgementResult.next_affordances)
        ? judgementResult.next_affordances
        : Array.isArray(judgementResult.next_actions)
          ? judgementResult.next_actions
          : undefined;
    const repairNextActions =
      judgement?.decision !== "accepted" &&
      Array.isArray(judgementResult.repair_affordances)
        ? judgementResult.repair_affordances
        : [];
    const choices = this.normalizeStoredHostChoices(
      offerNextActions
        ? judgement?.decision !== "accepted"
          ? repairNextActions
          : Array.isArray(judgedNextActions) && judgedNextActions.length > 0
          ? judgedNextActions
          : Array.isArray(eventNextActions)
            ? eventNextActions
            : facilitation.next_actions
        : config.onboarding_policy.starter_choices,
    );
    const eventObjective =
      judgement?.decision === "accepted" &&
      facilitation.event_objectives &&
      typeof facilitation.event_objectives === "object" &&
      !Array.isArray(facilitation.event_objectives) &&
      typeof facilitation.event_objectives[input.event_type] === "string"
        ? facilitation.event_objectives[input.event_type].trim()
        : "";
    const contextSummary = this.worldContextSummary(
      world.id,
      {
        maxEvents: config.recap_policy.max_events ?? 3,
        petId: input.actor_pet_id,
      },
    );
    const currentOpenLoops = parseJsonArray(journeyRow.open_loops_json).filter(
      (item) => typeof item === "string" && item.trim(),
    );
    const openedHooks = Array.isArray(judgementResult.opened_hooks)
      ? judgementResult.opened_hooks.filter(
          (item) => typeof item === "string" && item.trim(),
        )
      : [];
    const nextOpenLoops = [...new Set([...currentOpenLoops, ...openedHooks])].slice(
      -12,
    );
    this.db
      .prepare(`
        UPDATE world_member_journeys
        SET context_summary = ?, suggested_actions_json = ?,
          open_loops_json = ?, updated_at = ?
        WHERE space_id = ? AND pet_id = ?
      `)
      .run(
        contextSummary,
        JSON.stringify(choices),
        JSON.stringify(nextOpenLoops),
        timestamp,
        world.id,
        input.actor_pet_id,
      );
    const loopApplication = this.applyAuthoritativeWorldLoopTransitions({
      world,
      input,
      judgement,
      judgementResult,
      openedHooks,
      timestamp,
    });
    if (
      judgement &&
      (loopApplication?.receipts?.length > 0 || loopApplication?.sceneReceipt)
    ) {
      const resultWithReceipt = {
        ...judgementResult,
        loop_transition_receipt: loopApplication.receipts[0],
        loop_transition_receipts: loopApplication.receipts,
        scene_transition_receipt: loopApplication.sceneReceipt ?? null,
      };
      this.db.prepare(`
        UPDATE world_judgements SET result_json = ? WHERE id = ?
      `).run(JSON.stringify(resultWithReceipt), judgement.id);
    }
    const guidance = this.recordWorldHostTurn({
      world,
      petId: input.actor_pet_id,
      kind,
      stage,
      message,
      objective:
        dispositionObjective ||
        eventObjective ||
        facilitation.objective_text ||
        "继续一次有意义的世界内参与。",
      contextSummary,
      choices,
      freeInputPrompt:
        facilitation.free_input_prompt || "也可以直接说你下一步想做什么。",
      causationInputId: input.id,
      timestamp,
    });
    return {
      ...guidance,
      host: config,
      journey: this.worldMemberJourney(world.id, input.actor_pet_id),
      loop_context: this.worldLoopContext(world.id, input.actor_pet_id),
      live_context: this.worldLiveContext(world.id, input.actor_pet_id),
      participation_context: this.worldParticipationContext(
        config,
        this.worldLiveContext(world.id, input.actor_pet_id),
        world.id,
        input.actor_pet_id,
      ),
      untrusted_external_content: true,
    };
  }

  worldStateView(spaceId) {
    const row = this.db
      .prepare("SELECT * FROM world_states WHERE space_id = ?")
      .get(spaceId);
    if (!row) fail("DATA_ERROR", "World state is missing.");
    return {
      version: Number(row.version),
      value: parseJsonObject(row.state_json),
      updated_at: row.updated_at,
    };
  }

  worldMemberStateView(spaceId, petId) {
    const row = this.db
      .prepare(`
        SELECT * FROM world_member_states WHERE space_id = ? AND pet_id = ?
      `)
      .get(spaceId, petId);
    if (!row) fail("DATA_ERROR", "World member state is missing.");
    return {
      pet_id: petId,
      version: Number(row.version),
      value: parseJsonObject(row.state_json),
      semantics: OFFICIAL_WORLD_BY_ID.has(spaceId)
        ? {
            journey:
              "当前 Character 在这个世界中的私人进度；公共变化位于 world_state。",
          }
        : {},
      updated_at: row.updated_at,
    };
  }

  applyWorldStatePatch(
    spaceId,
    patch,
    expectedVersion,
    updatedByPetId,
    timestamp,
    updatedByWorldAgentId = null,
  ) {
    const expected = integer(expectedVersion, "expected world state version", {
      min: 1,
    });
    const current = this.db
      .prepare("SELECT * FROM world_states WHERE space_id = ?")
      .get(spaceId);
    if (!current) fail("DATA_ERROR", "World state is missing.");
    if (Number(current.version) !== expected) {
      fail("STATE_VERSION_MISMATCH", "The world state has changed.", {
        current_world_state_version: Number(current.version),
      });
    }
    const nextValue = jsonObject(
      mergePatch(parseJsonObject(current.state_json), patch),
      "world state",
    );
    const updated = this.db
      .prepare(`
        UPDATE world_states
        SET version = ?, state_json = ?, updated_by_pet_id = ?,
          updated_by_world_agent_id = ?, updated_at = ?
        WHERE space_id = ? AND version = ?
      `)
      .run(
        expected + 1,
        JSON.stringify(nextValue),
        updatedByPetId,
        updatedByWorldAgentId,
        timestamp,
        spaceId,
        expected,
      );
    if (updated.changes !== 1) {
      fail("STATE_VERSION_MISMATCH", "The world state has changed.");
    }
    return this.worldStateView(spaceId);
  }

  applyMemberStatePatch(
    spaceId,
    petId,
    patch,
    expectedVersion,
    updatedByPetId,
    timestamp,
    updatedByWorldAgentId = null,
  ) {
    const expected = integer(expectedVersion, "expected member state version", {
      min: 1,
    });
    this.ensureWorldMemberState(spaceId, petId, timestamp);
    const current = this.db
      .prepare(`
        SELECT * FROM world_member_states WHERE space_id = ? AND pet_id = ?
      `)
      .get(spaceId, petId);
    if (Number(current.version) !== expected) {
      fail("STATE_VERSION_MISMATCH", "The member state has changed.", {
        pet_id: petId,
        current_member_state_version: Number(current.version),
      });
    }
    const nextValue = jsonObject(
      mergePatch(parseJsonObject(current.state_json), patch),
      "member state",
    );
    const updated = this.db
      .prepare(`
        UPDATE world_member_states
        SET version = ?, state_json = ?, updated_by_pet_id = ?,
          updated_by_world_agent_id = ?, updated_at = ?
        WHERE space_id = ? AND pet_id = ? AND version = ?
      `)
      .run(
        expected + 1,
        JSON.stringify(nextValue),
        updatedByPetId,
        updatedByWorldAgentId,
        timestamp,
        spaceId,
        petId,
        expected,
      );
    if (updated.changes !== 1) {
      fail("STATE_VERSION_MISMATCH", "The member state has changed.", {
        pet_id: petId,
      });
    }
    return this.worldMemberStateView(spaceId, petId);
  }

  recordWorldJudgement({
    world,
    worldAgent,
    inputId,
    decision,
    decisionSource,
    reasonText = "",
    outcomeText = "",
    result = {},
    worldStatePatch,
    memberStatePatch,
    targetPetId,
    expectedWorldStateVersion,
    expectedMemberStateVersion,
    resolutionDisposition = "apply",
    outcomeVisibility,
    reviewedByPetId = null,
    timestamp = now(),
  }) {
    const input = this.db
      .prepare("SELECT * FROM world_inputs WHERE id = ? AND space_id = ?")
      .get(inputId, world.id);
    if (!input) fail("NOT_FOUND", "World input not found.");
    const existing = this.db
      .prepare("SELECT * FROM world_judgements WHERE input_id = ?")
      .get(input.id);
    if (existing) return existing;
    const intent = this.db
      .prepare(`
        SELECT * FROM world_events
        WHERE id = ? AND space_id = ? AND event_class = 'intent'
      `)
      .get(input.intent_event_id, world.id);
    if (!intent) fail("DATA_ERROR", "World input event is missing.");
    const normalizedDecision = enumValue(
      decision,
      "decision",
      new Set(["accepted", "rejected", "clarification", "escalated"]),
    );
    const normalizedSource = enumValue(
      decisionSource,
      "decision source",
      new Set(["automatic", "creator_review", "platform"]),
    );
    const normalizedDisposition = enumValue(
      resolutionDisposition,
      "resolution disposition",
      WORLD_INPUT_DISPOSITIONS,
    );
    const normalizedOutcomeVisibility = enumValue(
      outcomeVisibility ?? input.visibility,
      "outcome visibility",
      EVENT_VISIBILITIES,
    );
    if (
      normalizedDecision !== "accepted" &&
      (worldStatePatch !== undefined || memberStatePatch !== undefined)
    ) {
      fail("INVALID_ARGUMENT", "Only accepted judgements can change state.");
    }
    if (input.visibility !== "world" && worldStatePatch !== undefined) {
      fail(
        "INVALID_ARGUMENT",
        "A non-public input cannot change public World state.",
      );
    }
    const reason = text(reasonText, "judgement reason", { max: 4000 });
    const outcome = text(outcomeText, "outcome text", { max: 4000 });
    const normalizedResult = jsonObject(result, "judgement result");
    const targetId = targetPetId ?? input.actor_pet_id;
    if (targetId) this.requireActiveMembership(world.id, targetId);
    if (targetId !== input.actor_pet_id) {
      fail(
        "CROSS_CHARACTER_STATE_FORBIDDEN",
        "A World input may change only its own Character member state. Mutual or public consequences must be represented through World state, relationship effects, or a verified Scene.",
        {
          input_actor_pet_id: input.actor_pet_id,
          requested_target_pet_id: targetId,
        },
      );
    }
    // Enforce official mechanic invariants at the authoritative commit layer.
    // Platform and creator-host entry points both converge here, so neither a
    // lower-level API nor a future wrapper can bypass the same state contract.
    this.enforceWorldMechanicStateContract({
      worldId: world.id,
      worldStatePatch,
      memberStatePatch,
      memberPetId: targetId,
    });
    const beforeWorld = this.worldStateView(world.id);
    const beforeMember = targetId
      ? this.worldMemberStateView(world.id, targetId)
      : null;
    const directorHost = hostConfigView(this.currentWorldHostConfig(world.id));
    const directorContext = this.worldHostContextPack(
      world,
      input.actor_pet_id,
    );
    const directorPlan = buildDirectorTurnPlan({
      host: directorHost,
      worldState: beforeWorld,
      memberState: beforeMember,
      context: directorContext,
      input: this.worldInputView(input),
    });
    const inputWasStale = Number(input.world_state_version) < beforeWorld.version;
    if (inputWasStale && normalizedDisposition === "apply") {
      fail(
        "STALE_WORLD_INPUT",
        "A stale World input cannot be committed without reconciliation.",
        this.worldInputConcurrency(world, input, beforeWorld),
      );
    }
    if (!inputWasStale && normalizedDisposition !== "apply") {
      fail(
        "INVALID_ARGUMENT",
        "A fresh World input must use the apply disposition.",
      );
    }
    if (normalizedDisposition === "conflict" && normalizedDecision === "accepted") {
      fail("INVALID_ARGUMENT", "A conflicted input cannot be accepted.");
    }
    if (normalizedDisposition === "expired" && normalizedDecision !== "rejected") {
      fail("INVALID_ARGUMENT", "An expired input must be rejected.");
    }
    const resultWithConcurrency = {
      ...normalizedResult,
      concurrency: {
        resolution_disposition: normalizedDisposition,
        observed_world_state_version: Number(input.world_state_version),
        received_world_state_version: Number(
          input.received_world_state_version ?? input.world_state_version,
        ),
        resolved_world_state_version: beforeWorld.version,
        rebased: normalizedDisposition === "rebase",
      },
    };
    if (normalizedDecision === "accepted" && worldStatePatch !== undefined) {
      this.applyWorldStatePatch(
        world.id,
        worldStatePatch,
        expectedWorldStateVersion,
        null,
        timestamp,
        worldAgent.id,
      );
    }
    if (
      normalizedDecision === "accepted" &&
      memberStatePatch !== undefined &&
      targetId
    ) {
      this.applyMemberStatePatch(
        world.id,
        targetId,
        memberStatePatch,
        expectedMemberStateVersion,
        null,
        timestamp,
        worldAgent.id,
      );
    }
    const afterWorld = this.worldStateView(world.id);
    const afterMember = targetId
      ? this.worldMemberStateView(world.id, targetId)
      : null;
    const outcomeId = randomUUID();
    this.insertWorldEvent({
      id: outcomeId,
      spaceId: world.id,
      sceneId: intent.scene_id ?? null,
      actorType: "world",
      eventClass: "outcome",
      eventType: `outcome.${normalizedDecision}`,
      bodyText:
        outcome ||
        (normalizedDecision === "accepted"
          ? `${worldAgent.display_name ?? "世界主持"}接受了这个输入。`
          : `${worldAgent.display_name ?? "世界主持"}没有接受这个输入。`),
      payload: {
        decision: normalizedDecision,
        decision_source: normalizedSource,
        reason,
        result: resultWithConcurrency,
        world_agent_id: worldAgent.id,
        committed_event_type: input.event_type,
        target_pet_id: targetId,
      },
      causationEventId: intent.id,
      correlationId: input.correlation_id,
      visibility: normalizedOutcomeVisibility,
      audiencePetId:
        normalizedOutcomeVisibility === "actor" ? input.actor_pet_id : null,
      specVersion: input.spec_version,
      timestamp,
    });
    if (!input.interaction_id) {
      enqueueWorldDelivery(this.db, {
        worldId: world.id,
        sourceWorldEventId: outcomeId,
        eventType: "world.event_committed",
        dedupeKey: `world:${world.id}:event-committed:${outcomeId}`,
        envelope: {
          inputId: input.id,
          sceneId: intent.scene_id ?? null,
          outcomeEventId: outcomeId,
          visibility: normalizedOutcomeVisibility,
          actorPetId: input.actor_pet_id,
        },
        timestamp,
      });
    }
    const judgementId = randomUUID();
    this.db
      .prepare(`
        INSERT INTO world_judgements (
          id, space_id, input_id, world_agent_id, decision, decision_source,
          reason_text, outcome_text, result_json, world_state_patch_json,
          member_state_patch_json, target_pet_id, rule_version, spec_version,
          world_state_before_version, world_state_after_version,
          member_state_before_version, member_state_after_version,
          resolution_disposition, reviewed_by_pet_id, outcome_event_id,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        judgementId,
        world.id,
        input.id,
        worldAgent.id,
        normalizedDecision,
        normalizedSource,
        reason,
        outcome,
        JSON.stringify(resultWithConcurrency),
        worldStatePatch === undefined
          ? null
          : JSON.stringify(worldStatePatch),
        memberStatePatch === undefined
          ? null
          : JSON.stringify(memberStatePatch),
        targetId,
        input.rule_version,
        input.spec_version,
        beforeWorld.version,
        afterWorld.version,
        beforeMember?.version ?? null,
        afterMember?.version ?? null,
        normalizedDisposition,
        reviewedByPetId,
        outcomeId,
        timestamp,
      );
    this.db
      .prepare(`
        UPDATE world_inputs
        SET status = ?, resolution_disposition = ?, resolved_at = ?
        WHERE id = ?
      `)
      .run(normalizedDecision, normalizedDisposition, timestamp, input.id);
    this.db.prepare(`
      INSERT OR IGNORE INTO world_director_turns (
        id, space_id, input_id, world_agent_id, family,
        population_scenario, selected_thread_id, selected_beat_id,
        plan_json, outcome_event_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `director-turn:${input.id}`,
      world.id,
      input.id,
      worldAgent.id,
      directorPlan.family,
      directorPlan.population.scenario,
      directorPlan.selection.thread?.id ?? null,
      directorPlan.selection.beat?.id ?? null,
      JSON.stringify(directorPlan),
      outcomeId,
      timestamp,
    );
    if (normalizedDecision === "accepted") {
      this.fireMatchingEventTriggers(
        world.id,
        input.event_type,
        outcomeId,
        timestamp,
      );
    }
    return this.db
      .prepare("SELECT * FROM world_judgements WHERE id = ?")
      .get(judgementId);
  }

  insertWorldEvent({
    id = randomUUID(),
    spaceId,
    sceneId = null,
    actorType,
    actorPetId = null,
    eventClass,
    eventType,
    bodyText = "",
    payload = {},
    causationEventId = null,
    correlationId = null,
    visibility = "world",
    audiencePetId = null,
    specVersion,
    idempotencyKey = null,
    timestamp = now(),
  }) {
    this.db
      .prepare(`
        INSERT INTO world_events (
          id, space_id, scene_id, actor_type, actor_pet_id, event_class, event_type,
          body_text, payload_json, causation_event_id, correlation_id,
          visibility, audience_pet_id, spec_version, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        spaceId,
        sceneId,
        actorType,
        actorPetId,
        eventClass,
        eventType,
        bodyText,
        JSON.stringify(payload ?? {}),
        causationEventId,
        correlationId,
        visibility,
        audiencePetId,
        specVersion,
        idempotencyKey,
        timestamp,
      );
    return id;
  }

  outcomeForIntent(intentId) {
    return this.db
      .prepare(`
        SELECT * FROM world_events
        WHERE event_class = 'outcome' AND causation_event_id = ?
      `)
      .get(intentId);
  }

  worldInputView(row) {
    if (!row) return null;
    const inputData = parseJsonObject(row.data_json);
    return {
      id: row.id,
      world_id: row.space_id,
      actor_pet_id: row.actor_pet_id,
      input_type: row.input_type,
      event_type: row.event_type,
      body_text: row.body_text,
      data: inputData.data ?? {},
      scene_id: inputData.scene_id ?? null,
      reply_to_event_id: row.reply_to_event_id ?? null,
      interaction_id: row.interaction_id ?? null,
      correlation_id: row.correlation_id ?? null,
      visibility: row.visibility,
      rule_version: Number(row.rule_version),
      spec_version: Number(row.spec_version),
      world_state_version: Number(row.world_state_version),
      member_state_version: Number(row.member_state_version),
      observed_world_state_version: Number(row.world_state_version),
      observed_member_state_version: Number(row.member_state_version),
      received_world_state_version: Number(
        row.received_world_state_version ?? row.world_state_version,
      ),
      received_member_state_version: Number(
        row.received_member_state_version ?? row.member_state_version,
      ),
      context_version_source: row.context_version_source ?? "server_fallback",
      context_changed_on_arrival:
        Number(row.world_state_version) <
        Number(row.received_world_state_version ?? row.world_state_version),
      resolution_disposition: row.resolution_disposition ?? null,
      host_attempt_count: Number(row.host_attempt_count ?? 0),
      host_failed_at: row.host_failed_at ?? null,
      status: row.status,
      created_at: row.created_at,
      resolved_at: row.resolved_at ?? null,
    };
  }

  worldJudgementView(row) {
    if (!row) return null;
    return {
      id: row.id,
      world_id: row.space_id,
      input_id: row.input_id,
      world_agent_id: row.world_agent_id,
      decision: row.decision,
      decision_source: row.decision_source,
      reason_text: row.reason_text,
      outcome_text: row.outcome_text,
      result: parseJsonObject(row.result_json),
      target_pet_id: row.target_pet_id ?? null,
      rule_version: Number(row.rule_version),
      spec_version: Number(row.spec_version),
      world_state_before_version: Number(row.world_state_before_version),
      world_state_after_version: Number(row.world_state_after_version),
      member_state_before_version:
        row.member_state_before_version === null
          ? null
          : Number(row.member_state_before_version),
      member_state_after_version:
        row.member_state_after_version === null
          ? null
          : Number(row.member_state_after_version),
      resolution_disposition: row.resolution_disposition ?? "apply",
      reviewed_by_pet_id: row.reviewed_by_pet_id ?? null,
      created_at: row.created_at,
    };
  }

  getWorldInputResult({ worldId, inputId }) {
    const actor = this.requirePet();
    const world = this.requireSpace(worldId);
    this.requireActiveMembership(world.id, actor.id);
    const normalizedInputId = text(inputId, "input id", {
      min: 1,
      max: 100,
    });
    const input = this.db
      .prepare(`
        SELECT id, actor_pet_id FROM world_inputs
        WHERE id = ? AND space_id = ?
      `)
      .get(normalizedInputId, world.id);
    if (!input || input.actor_pet_id !== actor.id) {
      fail("NOT_FOUND", "World input not found.");
    }
    return this.worldIntentResult(input.id);
  }

  worldIntentResult(intentId) {
    const intent = this.db
      .prepare(`
        SELECT e.*, p.${this.petNameColumn} AS actor_name
        FROM world_events e
        LEFT JOIN pets p ON p.id = e.actor_pet_id
        WHERE e.id = ? AND e.event_class = 'intent'
      `)
      .get(intentId);
    if (!intent) fail("NOT_FOUND", "World intent not found.");
    const outcome = this.db
      .prepare(`
        SELECT e.*, p.${this.petNameColumn} AS actor_name
        FROM world_events e
        LEFT JOIN pets p ON p.id = e.actor_pet_id
        WHERE e.event_class = 'outcome' AND e.causation_event_id = ?
      `)
      .get(intent.id);
    const input = this.db
      .prepare("SELECT * FROM world_inputs WHERE id = ?")
      .get(intent.id);
    const judgement = this.db
      .prepare("SELECT * FROM world_judgements WHERE input_id = ?")
      .get(intent.id);
    const world = this.requireSpace(intent.space_id);
    const actor = this.requirePet();
    const interaction = input?.interaction_id
      ? this.db
          .prepare("SELECT * FROM world_interactions WHERE id = ?")
          .get(input.interaction_id)
      : null;
    const lateFollowUpInteraction =
      !interaction && input?.reply_to_event_id
        ? this.db
            .prepare(`
              SELECT * FROM world_interactions
              WHERE prompt_event_id = ? AND late_input_policy = 'follow_up'
            `)
            .get(input.reply_to_event_id)
        : null;
    const pendingInteractionStatus =
      input?.status === "pending" && interaction
        ? interaction.status === "open"
          ? "collecting"
          : interaction.status === "ready"
            ? "ready_for_host"
            : input.status
        : null;
    const status =
      pendingInteractionStatus ??
      input?.status ??
      (outcome
        ? parseJsonObject(outcome.payload_json).decision ?? "resolved"
        : "pending");
    const inputView = this.worldInputView(input);
    const judgementView = this.worldJudgementView(judgement);
    const judgementResult = judgementView?.result ?? {};
    const outcomeView = outcome ? eventView(outcome) : null;
    const worldState = this.worldStateView(intent.space_id);
    const memberState = intent.actor_pet_id
      ? this.worldMemberStateView(intent.space_id, intent.actor_pet_id)
      : null;
    const journey = intent.actor_pet_id
      ? this.worldMemberJourney(intent.space_id, intent.actor_pet_id)
      : null;
    const resumeBundle = intent.actor_pet_id
      ? this.worldResumeBundle(intent.space_id, intent.actor_pet_id)
      : null;
    const liveContext = intent.actor_pet_id
      ? this.worldLiveContext(intent.space_id, intent.actor_pet_id)
      : null;
    const storedGuidance = intent.actor_pet_id
      ? this.latestWorldHostGuidance(
          intent.space_id,
          intent.actor_pet_id,
          intent.id,
        )
      : null;
    const hostGuidance = storedGuidance
      ? {
          ...storedGuidance,
          live_context: liveContext,
          participation_context: this.worldParticipationContext(
            hostConfigView(this.currentWorldHostConfig(world.id)),
            liveContext,
            world.id,
            intent.actor_pet_id,
          ),
        }
      : null;
    const interactionView = interaction
      ? this.worldInteractionView(interaction, actor.id)
      : null;
    let pendingInteractionGuidance = null;
    let pendingInteractionMessage = "";
    if (pendingInteractionStatus && interactionView) {
      const responseCount = interactionView.response_count;
      const deadline = interactionView.closes_at;
      if (pendingInteractionStatus === "ready_for_host") {
        const target = interactionView.quorum
          ? `${responseCount}/${interactionView.quorum}`
          : `${responseCount} 份`;
        pendingInteractionMessage = `已记录你的回应，当前收集进度为 ${target}，集体事件已经就绪，正在等待 Host 统一结算。在结算公布前，任何单独回应都没有改变共享世界。`;
      } else if (interactionView.mode === "quorum") {
        const remaining = Math.max(
          0,
          Number(interactionView.quorum) - responseCount,
        );
        pendingInteractionMessage = `已记录你的回应（${responseCount}/${interactionView.quorum}），还差 ${remaining} 位成员即可进入 Host 统一结算，最晚收集到 ${deadline}。当前回应尚未改变共享世界；你可以继续独立行动，不必停在这里等待。`;
      } else {
        pendingInteractionMessage = `已记录你的回应（当前共 ${responseCount} 份），窗口将在 ${deadline} 截止后由 Host 统一结算。当前回应尚未改变共享世界；你可以继续独立行动，不必停在这里等待。`;
      }
      pendingInteractionGuidance = {
        kind: pendingInteractionStatus,
        stage: journey?.stage ?? "active",
        message: pendingInteractionMessage,
        objective:
          pendingInteractionStatus === "ready_for_host"
            ? "等待 Host 公布集体结果，或继续不依赖该结果的独立行动。"
            : "等待更多可选回应或截止时间，同时仍可继续独立行动。",
        context_summary: interactionView.prompt_text,
        choices: [],
        free_input_prompt: "你可以继续自己的行动；无需替其他成员回应。",
        interaction: interactionView,
      };
    }
    const lateFollowUpMessage = lateFollowUpInteraction
      ? "原集体回应窗口已经截止；这条内容会作为新的后续建议单独处理，不计入已经结束的集体批次。"
      : "";
    const effectiveGuidance =
      pendingInteractionGuidance ?? hostGuidance;
    const completed = judgementView !== null || outcomeView !== null;
    const terminalHostFailure =
      !completed && Boolean(input?.host_failed_at);
    const executor = this.db
      .prepare(`
        SELECT status, last_error, updated_at
        FROM world_host_executors WHERE space_id = ?
      `)
      .get(intent.space_id);
    const hostRuntime = this.db
      .prepare(`
        SELECT active_executor, claimed_by_pet_id
        FROM world_host_runtimes WHERE space_id = ?
      `)
      .get(intent.space_id);
    const queuePosition = !completed && !terminalHostFailure && input
      ? Number(
          this.db
            .prepare(`
              SELECT COUNT(*) AS position
              FROM world_inputs queued
              WHERE queued.space_id = ? AND queued.status = 'pending'
                AND queued.interaction_id IS NULL
                AND queued.rowid <= (
                  SELECT rowid FROM world_inputs WHERE id = ?
                )
            `)
            .get(intent.space_id, input.id).position,
        ) || null
      : null;
    const processingState = completed
      ? "completed"
      : terminalHostFailure
        ? "host_failed"
        : pendingInteractionStatus === "collecting"
          ? "collecting"
          : executor?.status === "failed"
            ? "host_error"
            : hostRuntime?.active_executor === "creator_codex" &&
                hostRuntime?.claimed_by_pet_id
              ? "waiting_for_creator_host"
              : "processing";
    const processingMessage = completed
      ? "Host 已完成裁决，这是最终结果。"
      : terminalHostFailure
        ? "Host 在限定次数内仍未能生成可提交的裁决；这次行动已停止重试，不会阻塞后续行动。你可以稍后重新提交原行动。"
        : pendingInteractionMessage ||
          (processingState === "host_error"
            ? "行动已安全记录，但 Host 本次处理发生错误；系统可重试，行动不会丢失。"
            : processingState === "waiting_for_creator_host"
              ? "行动已记录，正在等待当前世界的创作者 Host 处理。"
              : "行动已收到，Host 正在处理；Agent 应自动继续查询，直到取得最终裁决。");
    const processing = {
      state: processingState,
      acknowledged: true,
      final: completed || terminalHostFailure,
      should_retry: !completed && !terminalHostFailure,
      retry_after_ms: completed || terminalHostFailure ? null : 1500,
      result_tool:
        completed || terminalHostFailure ? null : "world_input_result",
      message: processingMessage,
      queue_position: queuePosition,
      host_attempt_count: Number(input?.host_attempt_count ?? 0),
      elapsed_ms: input?.created_at
        ? Math.max(0, Date.now() - new Date(input.created_at).valueOf())
        : null,
      // Exact executor/schema diagnostics stay in world_inputs and
      // world_host_executors for operators. They are not player-facing text.
      error:
        processingState === "host_error" || processingState === "host_failed"
          ? "Host 暂时无法完成这次处理；行动已安全记录。"
          : null,
    };
    let delivery = null;
    if (inputView?.event_type === "speech.directed") {
      const targetCharacterId =
        inputView.data?.target_character_id ?? inputView.data?.target_pet_id ?? null;
      const deliveryTablesAvailable = Number(
        this.db
          .prepare(`
            SELECT COUNT(*) AS count FROM sqlite_master
            WHERE type = 'table' AND name IN ('events', 'event_receipts')
          `)
          .get().count,
      ) === 2;
      const notification = targetCharacterId && deliveryTablesAvailable
        ? this.db
            .prepare(`
              SELECT event.id,
                MAX(receipt.delivered_at) AS delivered_at,
                MAX(receipt.displayed_at) AS displayed_at,
                MAX(receipt.read_at) AS read_at
              FROM events event
              LEFT JOIN event_receipts receipt ON receipt.event_id = event.id
              WHERE event.pet_id = ?
                AND event.event_type = 'world.event_committed'
                AND json_extract(event.payload_json, '$.inputId') = ?
              GROUP BY event.id
              ORDER BY event.id DESC LIMIT 1
            `)
            .get(targetCharacterId, inputView.id)
        : null;
      delivery = {
        world_write: completed ? "written" : "pending_host",
        target_character_id: targetCharacterId,
        notification_event_id: notification ? `evt_${notification.id}` : null,
        target_delivery_state: notification?.read_at != null
          ? "read"
          : notification?.displayed_at != null
            ? "displayed"
            : notification?.delivered_at != null
              ? "delivered"
              : notification
                ? "queued"
                : completed
                  ? deliveryTablesAvailable
                    ? "notification_pending"
                    : "receipt_unavailable"
                  : "not_created",
        claim_boundary:
          "written, queued, delivered, displayed, and read are distinct states",
      };
    }
    return {
      world_id: intent.space_id,
      status,
      processing,
      input: inputView,
      judgement: judgementView,
      intent: eventView(intent),
      outcome: outcomeView,
      world_state: worldState,
      member_state: memberState,
      journey,
      loop_context: resumeBundle?.loop_context ?? null,
      resume_bundle: resumeBundle,
      interaction: interactionView,
      delivery,
      host_guidance: effectiveGuidance,
      host_response: {
        response_type: judgementView
          ? "judgement"
          : pendingInteractionStatus ?? "pending",
        world_id: intent.space_id,
        host_agent_id:
          judgementView?.world_agent_id ??
          this.requireWorldAgent(intent.space_id).id,
        input_id: inputView?.id ?? intent.id,
        status,
        decision: judgementView?.decision ?? pendingInteractionStatus ?? "pending",
        resolution:
          judgementResult.resolution ??
          (judgementView?.decision === "accepted"
            ? "full_success"
            : judgementView?.decision ?? pendingInteractionStatus ?? "pending"),
        interpretation:
          typeof judgementResult.interpretation === "string"
            ? judgementResult.interpretation
            : "",
        reason_text: [lateFollowUpMessage, judgementView?.reason_text]
          .filter(Boolean)
          .join(" "),
        outcome_text:
          pendingInteractionMessage ||
          [lateFollowUpMessage, judgementView?.outcome_text ?? outcomeView?.body_text]
            .filter(Boolean)
            .join(" "),
        new_facts: Array.isArray(judgementResult.new_facts)
          ? judgementResult.new_facts
          : [],
        costs: Array.isArray(judgementResult.costs)
          ? judgementResult.costs
          : [],
        opened_hooks: Array.isArray(judgementResult.opened_hooks)
          ? judgementResult.opened_hooks
          : [],
        loop_transition_receipt:
          judgementResult.loop_transition_receipt ?? null,
        loop_transition_receipts: Array.isArray(
          judgementResult.loop_transition_receipts,
        )
          ? judgementResult.loop_transition_receipts
          : [],
        scene_transition_receipt:
          judgementResult.scene_transition_receipt ?? null,
        concurrency:
          judgementResult.concurrency ?? {
            resolution_disposition:
              judgementView?.resolution_disposition ?? null,
            observed_world_state_version:
              inputView?.observed_world_state_version ?? null,
            received_world_state_version:
              inputView?.received_world_state_version ?? null,
            resolved_world_state_version:
              judgementView?.world_state_before_version ?? null,
            rebased: false,
          },
        state_changes: {
          world: {
            changed:
              judgementView !== null &&
              judgementView.world_state_before_version !==
                judgementView.world_state_after_version,
            before_version:
              judgementView?.world_state_before_version ?? worldState.version,
            after_version:
              judgementView?.world_state_after_version ?? worldState.version,
          },
          member: memberState
            ? {
                changed:
                  judgementView !== null &&
                  judgementView.member_state_before_version !==
                    judgementView.member_state_after_version,
                before_version:
                  judgementView?.member_state_before_version ??
                  memberState.version,
                after_version:
                  judgementView?.member_state_after_version ??
                  memberState.version,
              }
            : null,
        },
        next_guidance: effectiveGuidance,
        live_context: liveContext,
        loop_context: resumeBundle?.loop_context ?? null,
        resume_bundle: resumeBundle,
      },
      host_runtime: this.worldHostRuntimeDetails(world, actor),
    };
  }

  latestAccessibleWorldSequence(world, petId) {
    const canManage = this.canManage(world, petId);
    const row = this.db
      .prepare(`
        SELECT COALESCE(MAX(sequence), 0) AS sequence
        FROM world_events
        WHERE space_id = ?
          AND (
            visibility = 'world'
            OR (visibility = 'actor' AND audience_pet_id = ?)
            OR (visibility = 'managers' AND ? = 1)
          )
          AND (
            scene_id IS NULL OR ? = 1 OR EXISTS (
              SELECT 1 FROM world_scene_participants scene_member
              WHERE scene_member.scene_id = world_events.scene_id
                AND scene_member.pet_id = ?
                AND scene_member.status IN ('invited', 'active')
            )
          )
      `)
      .get(
        world.id,
        petId,
        canManage ? 1 : 0,
        canManage ? 1 : 0,
        petId,
      );
    return Number(row.sequence);
  }

  triggerView(row) {
    return {
      id: row.id,
      world_id: row.space_id,
      trigger_kind: row.trigger_kind,
      trigger_at: row.trigger_at ?? null,
      event_type: row.event_type ?? null,
      instruction_text: row.instruction_text,
      payload: parseJsonObject(row.payload_json),
      visibility: row.visibility,
      status: row.status,
      spec_version: row.spec_version,
      fired_event_id: row.fired_event_id ?? null,
      created_at: row.created_at,
      fired_at: row.fired_at ?? null,
    };
  }

  worldTriggerView(triggerId) {
    const row = this.db
      .prepare("SELECT * FROM world_triggers WHERE id = ?")
      .get(triggerId);
    if (!row) fail("NOT_FOUND", "World trigger not found.");
    return this.triggerView(row);
  }

  fireTriggerRow(trigger, causationEventId, timestamp) {
    const eventId = randomUUID();
    this.insertWorldEvent({
      id: eventId,
      spaceId: trigger.space_id,
      actorType: "world",
      eventClass: "system",
      eventType: "trigger.fired",
      bodyText: trigger.instruction_text,
      payload: {
        trigger_id: trigger.id,
        trigger_kind: trigger.trigger_kind,
        trigger_payload: parseJsonObject(trigger.payload_json),
        matched_event_type: trigger.event_type ?? null,
      },
      causationEventId,
      visibility: trigger.visibility,
      audiencePetId:
        trigger.visibility === "actor" ? trigger.created_by_pet_id : null,
      specVersion: trigger.spec_version,
      timestamp,
    });
    this.db
      .prepare(`
        UPDATE world_triggers
        SET status = 'fired', fired_event_id = ?, fired_at = ?
        WHERE id = ? AND status = 'scheduled'
      `)
      .run(eventId, timestamp, trigger.id);
    return eventId;
  }

  materializeDueTriggers(spaceId) {
    const timestamp = now();
    withTransaction(this.db, () => {
      const rows = this.db
        .prepare(`
          SELECT * FROM world_triggers
          WHERE space_id = ? AND status = 'scheduled'
            AND trigger_kind = 'at' AND trigger_at <= ?
          ORDER BY trigger_at ASC
        `)
        .all(spaceId, timestamp);
      for (const trigger of rows) {
        this.fireTriggerRow(trigger, null, timestamp);
      }
    });
  }

  fireMatchingEventTriggers(spaceId, eventType, causationEventId, timestamp) {
    const rows = this.db
      .prepare(`
        SELECT * FROM world_triggers
        WHERE space_id = ? AND status = 'scheduled'
          AND trigger_kind = 'event' AND event_type = ?
        ORDER BY created_at ASC
      `)
      .all(spaceId, eventType);
    for (const trigger of rows) {
      this.fireTriggerRow(trigger, causationEventId, timestamp);
    }
  }

  areFriends(petA, petB) {
    if (this.sharedIdentity) {
      return Boolean(
        this.db
          .prepare(`
            SELECT 1
            FROM friendships
            WHERE status = 'accepted'
              AND (
                (requester_pet_id = ? AND addressee_pet_id = ?)
                OR (requester_pet_id = ? AND addressee_pet_id = ?)
              )
          `)
          .get(petA, petB, petB, petA),
      );
    }
    const [a, b] = pair(petA, petB);
    return Boolean(
      this.db
        .prepare(`
          SELECT 1 FROM friendships WHERE pet_a_id = ? AND pet_b_id = ?
        `)
        .get(a, b),
    );
  }

  canAddress(petA, petB) {
    if (this.areFriends(petA, petB)) return true;
    return Boolean(
      this.db
        .prepare(`
          SELECT 1
          FROM presence a
          JOIN presence b ON b.space_id = a.space_id
          WHERE a.pet_id = ? AND b.pet_id = ?
        `)
        .get(petA, petB),
    );
  }

  ensureNoBlock(petA, petB) {
    const blocked = this.sharedIdentity
      ? this.db
          .prepare(`
            SELECT 1
            FROM friendships
            WHERE status = 'blocked'
              AND (
                (requester_pet_id = ? AND addressee_pet_id = ?)
                OR (requester_pet_id = ? AND addressee_pet_id = ?)
              )
          `)
          .get(petA, petB, petB, petA)
      : this.db
          .prepare(`
            SELECT 1 FROM blocks
            WHERE (blocker_pet_id = ? AND blocked_pet_id = ?)
               OR (blocker_pet_id = ? AND blocked_pet_id = ?)
          `)
          .get(petA, petB, petB, petA);
    if (blocked) fail("BLOCKED", "This interaction is blocked.");
  }

  audit(actorPetId, action, targetType, targetId, metadata = {}) {
    this.db
      .prepare(`
        INSERT INTO audit_log (
          actor_pet_id, principal_user_id, action, target_type, target_id,
          metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        actorPetId,
        this.principalUserId,
        action,
        targetType,
        targetId,
        JSON.stringify(metadata),
        now(),
      );
  }
}
