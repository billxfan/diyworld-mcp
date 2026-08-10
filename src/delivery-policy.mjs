const INTERRUPTING_DELIVERY_POLICIES = new Set([
  "immediate",
  "action_required",
]);

export function deliveryPolicyForEvent(event) {
  const explicit = event?.payload?.deliveryPolicy;
  if (typeof explicit === "string" && explicit.length > 0) return explicit;

  // Events persisted before semantic delivery metadata was introduced keep
  // their historical behavior. New events should always carry an explicit
  // policy so ambient/digest updates never interrupt a bound Agent task.
  if (
    event?.eventType === "message.created" ||
    event?.eventType === "world.event_committed" ||
    event?.eventType === "world.interaction_opened"
  ) {
    return "immediate";
  }
  return "ambient";
}

export function shouldInterruptForEvent(event) {
  return INTERRUPTING_DELIVERY_POLICIES.has(deliveryPolicyForEvent(event));
}

export function isIsolatedCodexDelivery(delivery) {
  return Boolean(
    delivery?.enabled === true &&
      delivery.isolation === "dedicated_inbox" &&
      typeof delivery.threadId === "string" &&
      delivery.threadId.length > 0,
  );
}
