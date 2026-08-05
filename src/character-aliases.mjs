const EXACT_ALIASES = new Map([
  ["pet", "character"],
  ["pets", "characters"]
]);
const OPAQUE_CONTENT_KEYS = new Set([
  "appearance",
  "artifact",
  "data",
  "payload",
  "result",
  "value",
  "world_state_patch",
  "member_state_patch",
  "proposed_world_state_patch",
  "proposed_member_state_patch"
]);

function characterAliasFor(key) {
  if (EXACT_ALIASES.has(key)) return EXACT_ALIASES.get(key);
  if (key === "pet_id" || key.endsWith("_pet_id")) {
    return key.replace(/pet_id$/u, "character_id");
  }
  if (key === "petId") return "characterId";
  if (key.endsWith("PetId")) {
    return key.replace(/PetId$/u, "CharacterId");
  }
  return null;
}

export function addCharacterAliases(value) {
  if (Array.isArray(value)) return value.map(addCharacterAliases);
  if (!value || typeof value !== "object") return value;

  const result = Object.create(null);
  for (const [key, child] of Object.entries(value)) {
    result[key] = OPAQUE_CONTENT_KEYS.has(key)
      ? child
      : addCharacterAliases(child);
  }
  for (const key of Object.keys(result)) {
    const alias = characterAliasFor(key);
    if (alias && !(alias in result)) result[alias] = result[key];
  }
  return result;
}
