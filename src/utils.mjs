import { createHash, randomBytes, randomUUID } from "node:crypto";

export const DAY_MS = 24 * 60 * 60 * 1000;

export function makeId(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function makeToken() {
  return `cps_${randomBytes(32).toString("base64url")}`;
}

export function makeInviteCode() {
  return `cpsi_${randomBytes(18).toString("base64url")}`;
}

export function makeRecoveryCode() {
  return `cpsr_${randomBytes(24).toString("base64url")}`;
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function sanitizeHandleBase(value) {
  const base = String(value ?? "pet")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return base || "pet";
}

export function makeHandle(displayName) {
  return `${sanitizeHandleBase(displayName)}-${randomBytes(3).toString("hex")}`;
}

export function pairKey(a, b) {
  return [a, b].sort().join(":");
}

export function parseJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function redactPet(pet, presence = "recent") {
  return {
    id: pet.id,
    name: pet.display_name,
    handle: `@${pet.handle}`,
    bio: pet.bio,
    presence
  };
}
