export class PetSocialClient {
  constructor({ serverUrl, token }) {
    this.serverUrl = serverUrl.replace(/\/$/, "");
    this.token = token;
  }

  async request(path, options = {}) {
    const response = await fetch(`${this.serverUrl}${path}`, {
      ...options,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...options.headers
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error?.message ?? `Request failed with status ${response.status}`);
      error.status = response.status;
      error.code = body.error?.code;
      error.details = body.error?.details;
      throw error;
    }
    return body;
  }

  static async register(serverUrl, payload) {
    const response = await fetch(`${serverUrl.replace(/\/$/, "")}/v1/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error?.message ?? `Registration failed with status ${response.status}`);
      error.status = response.status;
      error.code = body.error?.code;
      throw error;
    }
    return body;
  }

  static async recover(serverUrl, payload) {
    const response = await fetch(`${serverUrl.replace(/\/$/, "")}/v1/recover`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error?.message ?? `Recovery failed with status ${response.status}`);
      error.status = response.status;
      error.code = body.error?.code;
      throw error;
    }
    return body;
  }

  me() {
    return this.request("/v1/me");
  }

  character() {
    return this.request("/v1/character");
  }

  profile() {
    return this.request("/v1/profile");
  }

  updateCharacter(patch) {
    return this.request("/v1/character", {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
  }

  updateProfile(patch) {
    return this.request("/v1/profile", {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
  }

  agentBinding() {
    return this.request("/v1/agent-binding");
  }

  agentBindings() {
    return this.request("/v1/agent-bindings");
  }

  revokeAgentBinding(bindingId, { confirmed = false } = {}) {
    return this.request(`/v1/agent-bindings/${encodeURIComponent(bindingId)}`, {
      method: "DELETE",
      body: JSON.stringify({ confirmed })
    });
  }

  agentHeartbeat(active, clientVersion = "agent") {
    return this.request("/v1/agent/heartbeat", {
      method: "POST",
      body: JSON.stringify({ active, clientVersion })
    });
  }

  updatePet(patch) {
    return this.request("/v1/pet", {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
  }

  requestAccountDeletion() {
    return this.request("/v1/account/deletion-request", {
      method: "POST",
      body: "{}"
    });
  }

  deleteAccount({ confirmationToken, confirmationText }) {
    return this.request("/v1/account", {
      method: "DELETE",
      body: JSON.stringify({ confirmationToken, confirmationText })
    });
  }

  heartbeat(codexOpen, bridgeVersion = "dev") {
    return this.request("/v1/heartbeat", {
      method: "POST",
      body: JSON.stringify({ codexOpen, bridgeVersion })
    });
  }

  square(limit = 20) {
    return this.request(`/v1/square?limit=${encodeURIComponent(limit)}`);
  }

  characters(limit = 20) {
    return this.request(`/v1/characters?limit=${encodeURIComponent(limit)}`);
  }

  people(limit = 20) {
    return this.request(`/v1/people?limit=${encodeURIComponent(limit)}`);
  }

  worlds(query = "", limit = 20) {
    return this.request(
      `/v1/worlds?query=${encodeURIComponent(query)}&limit=${encodeURIComponent(limit)}`
    );
  }

  world(worldId) {
    return this.request(`/v1/worlds/${encodeURIComponent(worldId)}`);
  }

  worldBuilderTemplates() {
    return this.request("/v1/world-builder/templates");
  }

  startWorldBuild(payload = {}) {
    return this.request("/v1/world-builds", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  worldBuild(buildId) {
    return this.request(`/v1/world-builds/${encodeURIComponent(buildId)}`);
  }

  worldRefinement(worldId) {
    return this.request(
      `/v1/worlds/${encodeURIComponent(worldId)}/refinement`
    );
  }

  updateWorldBuild(buildId, payload) {
    return this.request(`/v1/world-builds/${encodeURIComponent(buildId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  }

  materializeWorldBuild(buildId, payload) {
    return this.request(
      `/v1/world-builds/${encodeURIComponent(buildId)}/materialize`,
      {
        method: "POST",
        body: JSON.stringify(payload)
      }
    );
  }

  createWorld(payload) {
    return this.request("/v1/worlds", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  updateWorld(worldId, payload) {
    return this.request(`/v1/worlds/${encodeURIComponent(worldId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  }

  publishWorld(worldId, payload) {
    return this.request(`/v1/worlds/${encodeURIComponent(worldId)}/publish`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  closeWorld(worldId) {
    return this.request(`/v1/worlds/${encodeURIComponent(worldId)}/close`, {
      method: "POST",
      body: "{}"
    });
  }

  deleteWorld(worldId, payload) {
    return this.request(`/v1/worlds/${encodeURIComponent(worldId)}`, {
      method: "DELETE",
      body: JSON.stringify(payload)
    });
  }

  worldHost(worldId) {
    return this.request(`/v1/worlds/${encodeURIComponent(worldId)}/host`);
  }

  updateWorldHost(worldId, payload) {
    return this.request(`/v1/worlds/${encodeURIComponent(worldId)}/host`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  }

  worldHostRuntime(worldId) {
    return this.request(
      `/v1/worlds/${encodeURIComponent(worldId)}/host/runtime`
    );
  }

  takeoverWorldHost(worldId, payload = {}) {
    return this.request(
      `/v1/worlds/${encodeURIComponent(worldId)}/host/takeover`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  }

  heartbeatWorldHost(worldId, payload = {}) {
    return this.request(
      `/v1/worlds/${encodeURIComponent(worldId)}/host/heartbeat`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  }

  releaseWorldHost(worldId, payload = {}) {
    return this.request(
      `/v1/worlds/${encodeURIComponent(worldId)}/host/release`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  }

  nextWorldHostInput(worldId, { clientSessionId } = {}) {
    const query = new URLSearchParams();
    if (clientSessionId !== undefined) {
      query.set("clientSessionId", clientSessionId);
    }
    const suffix = query.size > 0 ? `?${query}` : "";
    return this.request(
      `/v1/worlds/${encodeURIComponent(worldId)}/host/inputs/next${suffix}`
    );
  }

  resolveWorldHostInput(worldId, inputId, payload) {
    return this.request(
      `/v1/worlds/${encodeURIComponent(worldId)}/host/inputs/${encodeURIComponent(inputId)}/resolve`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  }

  openWorldHostInteraction(worldId, payload) {
    return this.request(
      `/v1/worlds/${encodeURIComponent(worldId)}/host/interactions`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  }

  resolveWorldHostInteraction(worldId, interactionId, payload) {
    return this.request(
      `/v1/worlds/${encodeURIComponent(worldId)}/host/interactions/${encodeURIComponent(interactionId)}/resolve`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  }

  myWorlds() {
    return this.request("/v1/worlds/mine");
  }

  joinWorld(worldId, payload) {
    return this.request(`/v1/worlds/${encodeURIComponent(worldId)}/join`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  acceptWorldRules(worldId, payload) {
    return this.request(
      `/v1/worlds/${encodeURIComponent(worldId)}/rules/accept`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  }

  addWorldAdmin(worldId, payload) {
    return this.request(`/v1/worlds/${encodeURIComponent(worldId)}/admins`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  removeWorldAdmin(worldId, targetPetId) {
    return this.request(
      `/v1/worlds/${encodeURIComponent(worldId)}/admins/${encodeURIComponent(targetPetId)}`,
      { method: "DELETE" }
    );
  }

  createWorldShare(worldId, payload = {}) {
    return this.request(`/v1/worlds/${encodeURIComponent(worldId)}/shares`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  openWorldShare(token) {
    return this.request(`/v1/world-shares/${encodeURIComponent(token)}`);
  }

  createWorldInvitation(worldId, payload) {
    return this.request(
      `/v1/worlds/${encodeURIComponent(worldId)}/invitations`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  }

  worldInvitations() {
    return this.request("/v1/world-invitations");
  }

  worldJoinRequests(worldId) {
    return this.request(
      `/v1/worlds/${encodeURIComponent(worldId)}/join-requests`
    );
  }

  respondWorldJoinRequest(worldId, petId, payload) {
    return this.request(
      `/v1/worlds/${encodeURIComponent(worldId)}/join-requests/${encodeURIComponent(petId)}/respond`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  }

  enterWorld(worldId, payload = {}) {
    return this.request(`/v1/worlds/${encodeURIComponent(worldId)}/enter`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  leaveWorld(worldId) {
    return this.request(`/v1/worlds/${encodeURIComponent(worldId)}/leave`, {
      method: "POST",
      body: "{}"
    });
  }

  worldPresent(worldId) {
    return this.request(
      `/v1/worlds/${encodeURIComponent(worldId)}/present`
    );
  }

  observeWorld(worldId, { afterSequence, limit = 50 } = {}) {
    const query = new URLSearchParams({ limit: String(limit) });
    if (afterSequence !== undefined) query.set("after", String(afterSequence));
    return this.request(
      `/v1/worlds/${encodeURIComponent(worldId)}/observe?${query}`
    );
  }

  actInWorld(worldId, payload) {
    return this.request(`/v1/worlds/${encodeURIComponent(worldId)}/intents`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  submitWorldInput(worldId, payload) {
    return this.request(`/v1/worlds/${encodeURIComponent(worldId)}/inputs`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  worldInputResult(worldId, inputId, { waitMs = 25_000 } = {}) {
    const query = new URLSearchParams({ wait_ms: String(waitMs) });
    return this.request(
      `/v1/worlds/${encodeURIComponent(worldId)}/inputs/${encodeURIComponent(inputId)}/result?${query}`
    );
  }

  resolveWorldIntent(worldId, intentId, payload) {
    return this.request(
      `/v1/worlds/${encodeURIComponent(worldId)}/intents/${encodeURIComponent(intentId)}/resolve`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  }

  ackWorldEvents(worldId, payload) {
    return this.request(
      `/v1/worlds/${encodeURIComponent(worldId)}/events/ack`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  }

  setWorldDelegation(worldId, payload) {
    return this.request(
      `/v1/worlds/${encodeURIComponent(worldId)}/delegation`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  }

  createWorldTrigger(worldId, payload) {
    return this.request(`/v1/worlds/${encodeURIComponent(worldId)}/triggers`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  worldTriggers(worldId, status) {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.request(
      `/v1/worlds/${encodeURIComponent(worldId)}/triggers${query}`
    );
  }

  cancelWorldTrigger(worldId, triggerId) {
    return this.request(
      `/v1/worlds/${encodeURIComponent(worldId)}/triggers/${encodeURIComponent(triggerId)}`,
      { method: "DELETE" }
    );
  }

  sendFriendRequest(target, clientRequestId = crypto.randomUUID()) {
    return this.request("/v1/friend-requests", {
      method: "POST",
      body: JSON.stringify({ target, clientRequestId })
    });
  }

  friendRequests(direction = "incoming") {
    return this.request(`/v1/friend-requests?direction=${encodeURIComponent(direction)}`);
  }

  respondFriendRequest(id, decision) {
    return this.request(`/v1/friend-requests/${encodeURIComponent(id)}/respond`, {
      method: "POST",
      body: JSON.stringify({ decision })
    });
  }

  friends() {
    return this.request("/v1/friends");
  }

  removeFriend(friendshipId) {
    return this.request(`/v1/friends/${encodeURIComponent(friendshipId)}`, { method: "DELETE" });
  }

  blockPet(target) {
    return this.request("/v1/blocks", {
      method: "POST",
      body: JSON.stringify({ target })
    });
  }

  blockCharacter(target) {
    return this.request("/v1/character-blocks", {
      method: "POST",
      body: JSON.stringify({ target })
    });
  }

  sendMessage({ target, conversationId, text, clientMessageId = crypto.randomUUID() }) {
    return this.request("/v1/messages", {
      method: "POST",
      body: JSON.stringify({ target, conversationId, text, clientMessageId })
    });
  }

  inbox(limit = 50, { before } = {}) {
    const query = new URLSearchParams({ limit: String(limit) });
    if (before !== undefined) query.set("before", String(before));
    return this.request(`/v1/inbox?${query}`);
  }

  activity(limit = 50, { before, undisplayedOnly } = {}) {
    const query = new URLSearchParams({ limit: String(limit) });
    if (before !== undefined) query.set("before", String(before));
    if (undisplayedOnly !== undefined) query.set("undisplayed_only", String(undisplayedOnly));
    return this.request(`/v1/activity?${query}`);
  }

  markEventReceipt(eventId, state) {
    return this.request(`/v1/events/${encodeURIComponent(eventId)}/receipt`, {
      method: "POST",
      body: JSON.stringify({ state })
    });
  }

  markRead(conversationId, maxSequenceNo, { displayed } = {}) {
    return this.request(`/v1/conversations/${encodeURIComponent(conversationId)}/read`, {
      method: "POST",
      body: JSON.stringify({ maxSequenceNo, ...(displayed === undefined ? {} : { displayed }) })
    });
  }

  ackEvent(eventId) {
    return this.request(`/v1/events/${encodeURIComponent(eventId)}/ack`, {
      method: "POST",
      body: "{}"
    });
  }

  async *events(cursor = 0, signal) {
    const response = await fetch(`${this.serverUrl}/v1/events?cursor=${encodeURIComponent(cursor)}`, {
      headers: { authorization: `Bearer ${this.token}`, accept: "text/event-stream" },
      signal
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Event stream failed (${response.status}): ${body}`);
    }

    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      while (true) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary < 0) break;
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (!frame || frame.startsWith(":")) continue;
        let data = "";
        for (const line of frame.split("\n")) {
          if (line.startsWith("data:")) data += line.slice(5).trimStart();
        }
        if (data) yield JSON.parse(data);
      }
    }
  }
}

export const AgentWorldClient = PetSocialClient;
