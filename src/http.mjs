import { AppError } from "./errors.mjs";
import { isIP } from "node:net";

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1"]);

function normalizedAddress(value) {
  const address = String(value ?? "").trim();
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

export function requestClientAddress(req, { trustCloudflareProxy = false } = {}) {
  const socketAddress = normalizedAddress(req.socket?.remoteAddress) || "unknown";
  if (!trustCloudflareProxy || !LOOPBACK_ADDRESSES.has(socketAddress)) {
    return socketAddress;
  }
  const forwarded = normalizedAddress(req.headers["cf-connecting-ip"]);
  return isIP(forwarded) ? forwarded : socketAddress;
}

export async function readJson(req, maxBytes = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new AppError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

export function sendJson(res, status, body) {
  const encoded = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": encoded.length,
    "cache-control": "no-store"
  });
  res.end(encoded);
}

export function bearerToken(req) {
  const value = req.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1] ?? null;
}

export function routeMatch(pathname, pattern) {
  const names = [];
  const escaped = pattern
    .split("/")
    .map((part) => {
      if (part.startsWith(":")) {
        names.push(part.slice(1));
        return "([^/]+)";
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  const match = new RegExp(`^${escaped}$`).exec(pathname);
  if (!match) return null;
  return Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(match[index + 1])]));
}
