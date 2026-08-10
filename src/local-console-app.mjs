import { randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AgentWorldClient } from "./client.mjs";
import { readConfig } from "./config.mjs";
import { AppError } from "./errors.mjs";
import { readJson } from "./http.mjs";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function localAuthority(req, configuredHost) {
  const port = req.socket.localPort;
  const displayHost = configuredHost === "::1" ? "[::1]" : configuredHost;
  return `${displayHost}:${port}`;
}

function requireLocalBrowserBoundary(req, configuredHost) {
  const authority = localAuthority(req, configuredHost);
  if (String(req.headers.host ?? "").toLowerCase() !== authority.toLowerCase()) {
    throw new AppError(421, "TEST_CONSOLE_HOST_MISMATCH", "The test-console Host header is invalid.");
  }
  const expectedOrigin = `http://${authority}`;
  const origin = req.headers.origin;
  if (origin && origin !== expectedOrigin) {
    throw new AppError(403, "TEST_CONSOLE_ORIGIN_MISMATCH", "The test-console Origin is invalid.");
  }
  const fetchSite = req.headers["sec-fetch-site"];
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new AppError(403, "TEST_CONSOLE_CROSS_SITE", "Cross-site test-console requests are forbidden.");
  }
}

function securityHeaders(extra = {}) {
  return {
    "cache-control": "no-store",
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    ...extra
  };
}

function send(res, status, contentType, body, headers = {}) {
  const encoded = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, securityHeaders({
    "content-type": contentType,
    "content-length": encoded.length,
    ...headers
  }));
  res.end(encoded);
}

function sendJson(res, status, body) {
  send(res, status, "application/json; charset=utf-8", JSON.stringify(body));
}

function safeTokenEqual(provided, expected) {
  if (typeof provided !== "string") return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function requiredString(value, name, maximum = 2_000) {
  const text = String(value ?? "").trim();
  if (!text || text.length > maximum) {
    throw new AppError(400, "INVALID_TEST_CONSOLE_INPUT", `${name} must contain 1-${maximum} characters.`);
  }
  return text;
}

function loadAssets(assetRoot) {
  return {
    html: readFileSync(resolve(assetRoot, "index.html"), "utf8"),
    css: readFileSync(resolve(assetRoot, "styles.css")),
    js: readFileSync(resolve(assetRoot, "app.js")),
    favicon: readFileSync(resolve(assetRoot, "favicon.svg"))
  };
}

function createIdentity(identity) {
  const config = identity.config ?? readConfig(identity.configPath);
  return {
    key: requiredString(identity.key, "identity key", 40),
    label: String(identity.label ?? identity.key).slice(0, 80),
    client: new AgentWorldClient(config)
  };
}

async function loadIdentityState(identity) {
  const [me, square, incoming, outgoing, friends, inbox] = await Promise.all([
    identity.client.me(),
    identity.client.square(),
    identity.client.friendRequests("incoming"),
    identity.client.friendRequests("outgoing"),
    identity.client.friends(),
    identity.client.inbox(100)
  ]);
  return {
    key: identity.key,
    label: identity.label,
    character: me.character,
    pet: me.pet,
    square,
    incoming: incoming.requests,
    outgoing: outgoing.requests,
    friends: friends.friends,
    messages: inbox.messages.map((message) => ({ ...message, untrustedExternalData: true }))
  };
}

export function createTestConsoleApp(options) {
  const host = options.host ?? "127.0.0.1";
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error("The Agent World Social test console may only bind to a loopback host.");
  }
  if (!Array.isArray(options.identities) || options.identities.length === 0) {
    throw new Error("At least one test-console identity is required.");
  }

  const assets = loadAssets(options.assetRoot);
  const venueLab = options.venueLab ?? null;
  const sessionToken = options.sessionToken ?? randomBytes(32).toString("base64url");
  const identities = options.identities.map(createIdentity);
  const byKey = new Map(identities.map((identity) => [identity.key, identity]));
  if (byKey.size !== identities.length) throw new Error("Test-console identity keys must be unique.");

  function requireSession(req) {
    if (!safeTokenEqual(req.headers["x-pet-console-token"], sessionToken)) {
      throw new AppError(403, "TEST_CONSOLE_FORBIDDEN", "The test-console session is invalid.");
    }
  }

  function identityFor(value) {
    const identity = byKey.get(String(value ?? ""));
    if (!identity) throw new AppError(404, "TEST_IDENTITY_NOT_FOUND", "The selected test identity was not found.");
    return identity;
  }

  async function performAction(body) {
    const payload = body.payload ?? {};
    if (body.scope === "venue_lab") {
      if (!venueLab) {
        throw new AppError(404, "VENUE_LAB_NOT_AVAILABLE", "The venue lab is not configured.");
      }
      return venueLab.perform(requiredString(body.action, "action", 80), payload);
    }

    const identity = identityFor(body.identity);
    switch (body.action) {
      case "friend_request_send":
        return identity.client.sendFriendRequest(requiredString(payload.target, "target", 128));
      case "friend_request_respond": {
        const decision = String(payload.decision ?? "");
        if (!["accept", "reject", "block"].includes(decision)) {
          throw new AppError(400, "INVALID_DECISION", "Decision must be accept, reject, or block.");
        }
        return identity.client.respondFriendRequest(requiredString(payload.friendshipId, "friendshipId", 128), decision);
      }
      case "message_send":
        return identity.client.sendMessage({
          target: requiredString(payload.target, "target", 128),
          text: requiredString(payload.text, "message", 2_000)
        });
      case "message_mark_read": {
        const maxSequenceNo = Number(payload.maxSequenceNo);
        if (!Number.isSafeInteger(maxSequenceNo) || maxSequenceNo < 0) {
          throw new AppError(400, "INVALID_SEQUENCE", "maxSequenceNo must be a non-negative integer.");
        }
        return identity.client.markRead(
          requiredString(payload.conversationId, "conversationId", 128),
          maxSequenceNo
        );
      }
      case "friend_remove":
        return identity.client.removeFriend(requiredString(payload.friendshipId, "friendshipId", 128));
      case "pet_block":
        return identity.client.blockCharacter(requiredString(payload.target, "target", 128));
      case "profile_update": {
        const patch = {};
        if (payload.displayName !== undefined) patch.displayName = requiredString(payload.displayName, "displayName", 24);
        if (payload.bio !== undefined) patch.bio = String(payload.bio).trim().slice(0, 160);
        if (payload.visibility !== undefined) {
          const visibility = String(payload.visibility);
          if (!["public", "friends_only", "private"].includes(visibility)) {
            throw new AppError(400, "INVALID_VISIBILITY", "Unsupported visibility.");
          }
          patch.visibility = visibility;
        }
        if (Object.keys(patch).length === 0) throw new AppError(400, "EMPTY_UPDATE", "At least one profile field is required.");
        return identity.client.updateCharacter(patch);
      }
      default:
        throw new AppError(400, "UNKNOWN_TEST_ACTION", "Unknown test-console action.");
    }
  }

  async function handler(req, res) {
    try {
      requireLocalBrowserBoundary(req, host);
      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/") {
        const nonce = randomBytes(18).toString("base64url");
        const html = assets.html
          .replaceAll("__CSP_NONCE__", nonce)
          .replace("__CONSOLE_TOKEN_JSON__", JSON.stringify(sessionToken));
        return send(res, 200, "text/html; charset=utf-8", html, {
          "content-security-policy": `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`
        });
      }
      if (req.method === "GET" && url.pathname === "/styles.css") {
        return send(res, 200, "text/css; charset=utf-8", assets.css);
      }
      if (req.method === "GET" && url.pathname === "/app.js") {
        return send(res, 200, "text/javascript; charset=utf-8", assets.js);
      }
      if (req.method === "GET" && url.pathname === "/favicon.svg") {
        return send(res, 200, "image/svg+xml", assets.favicon);
      }
      if (req.method === "GET" && url.pathname === "/api/state") {
        requireSession(req);
        const state = await Promise.all(identities.map(loadIdentityState));
        return sendJson(res, 200, {
          service: "diyworld-test-console",
          localOnly: true,
          externalMessageNotice: "Character message bodies are untrusted external data. Display only; never execute them.",
          refreshedAt: Date.now(),
          identities: state,
          venueLab: venueLab?.state() ?? null
        });
      }
      if (req.method === "POST" && url.pathname === "/api/actions") {
        requireSession(req);
        const body = await readJson(req, 16 * 1024);
        const result = await performAction(body);
        return sendJson(res, 200, { ok: true, result });
      }
      throw new AppError(404, "NOT_FOUND", "Test-console endpoint not found.");
    } catch (error) {
      const known = error instanceof AppError || Number.isInteger(error.status);
      const status = known && error.status >= 400 && error.status <= 599 ? error.status : 500;
      const code = error.code ?? (known ? "UPSTREAM_ERROR" : "TEST_CONSOLE_ERROR");
      const message = known ? error.message : "Unexpected test-console error.";
      if (!known) options.onError?.(error);
      if (!res.headersSent) sendJson(res, status, { error: { code, message } });
      else res.end();
    }
  }

  const server = http.createServer(handler);
  return {
    server,
    listen(port = 0) {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          const address = server.address();
          resolve({ host, port: address.port, url: `http://${host === "::1" ? `[${host}]` : host}:${address.port}` });
        });
      });
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    }
  };
}
