#!/usr/bin/env node
import { setTimeout as wait } from "node:timers/promises";
import { AgentWorldClient } from "./client.mjs";
import { CodexAppServerClient } from "./codex-app-server.mjs";
import { defaultConfigPath, readConfig, updateConfig } from "./config.mjs";
import { isCodexOpen, showNotification } from "./macos.mjs";

const configPath = defaultConfigPath();
let config = readConfig(configPath);
const client = new AgentWorldClient(config);
const abortController = new AbortController();
const codexAppServer = new CodexAppServerClient({
  command: config.codexDelivery?.codexCommand
});
let stopped = false;
let codexOpen = false;
let streamAbortController;

function eventMessage(event) {
  switch (event.eventType) {
    case "friendship.requested":
      return { title: "Agent World Social", subtitle: "新的好友申请", message: "一个 Character 想和你成为好友。打开 Codex 后输入“查看好友申请”。" };
    case "friendship.accepted":
      return { title: "Agent World Social", subtitle: "好友申请已接受", message: "你们的 Character 现在可以互发消息了。" };
    case "friendship.rejected":
      return { title: "Agent World Social", subtitle: "好友申请未通过", message: "对方暂时没有接受好友申请。" };
    case "account.deleted":
      return { title: "Agent World Social", subtitle: "好友已注销", message: "一位好友已注销账号，历史消息仍可查看。" };
    case "message.created":
      return { title: "Agent World Social", subtitle: "Character 新消息", message: String(event.payload.text ?? "你收到了一条新消息。").slice(0, 160) };
    case "message.delivered":
      return null;
    case "message.read":
      return null;
    case "world.event_committed":
      return {
        title: "DIYworld",
        subtitle: String(event.payload.worldName ?? "世界新动态"),
        message: String(
          event.payload.targetCharacterId === config.petId
            ? `${event.payload.actorName ?? "一位成员"}在世界中对你说：${event.payload.inputBodyText ?? ""}`
            : event.payload.outcomeText ?? "所在世界有一条新动态。",
        ).slice(0, 160),
      };
    case "world.interaction_opened":
      return {
        title: "DIYworld",
        subtitle: String(event.payload.worldName ?? "新的集体事件"),
        message: "所在世界开启了一项可选的集体互动。",
      };
    default:
      return { title: "Agent World Social", subtitle: "新动态", message: "打开 Codex 查看 Character 消息。" };
  }
}

function persistProgress({ eventCursor, deliveryPatch } = {}) {
  config = updateConfig((latest) => ({
    ...latest,
    ...(eventCursor === undefined ? {} : { eventCursor }),
    ...(deliveryPatch ? {
      codexDelivery: {
        ...(latest.codexDelivery ?? {}),
        ...deliveryPatch
      }
    } : {})
  }), configPath);
  return config;
}

async function incomingMessage(event) {
  const inbox = await client.inbox(100);
  const messages = Array.isArray(inbox) ? inbox : inbox.messages;
  const found = messages?.find((message) => message.id === event.payload.messageId);
  if (found) return found;
  return {
    id: event.payload.messageId,
    conversationId: event.payload.conversationId,
    direction: "incoming",
    sender: {
      id: event.payload.senderPetId,
      name: "未知角色",
      handle: ""
    },
    text: String(event.payload.text ?? ""),
    createdAt: event.payload.createdAt ?? event.createdAt
  };
}

async function deliverMessageToCodex(event, delivery) {
  const lastDelivered = Number(delivery.lastDeliveredEventSequence ?? 0);
  if (event.sequence <= lastDelivered) return true;

  try {
    if (event.eventType === "message.created") {
      const message = await incomingMessage(event);
      await codexAppServer.deliverIncomingMessage({
        threadId: delivery.threadId,
        message,
        model: delivery.model,
        effort: delivery.effort
      });
    } else {
      await codexAppServer.deliverIncomingWorldEvent({
        threadId: delivery.threadId,
        update: {
          ...event.payload,
          eventType: event.eventType,
          createdAt: event.occurredAt,
          isTarget: event.payload.targetCharacterId === config.petId,
        },
        model: delivery.model,
        effort: delivery.effort,
      });
    }
    persistProgress({
      deliveryPatch: {
        lastDeliveredEventSequence: event.sequence,
        fallbackNotifiedSequence: 0,
        lastError: null,
        lastErrorAt: null
      }
    });
    return true;
  } catch (error) {
    const latest = readConfig(configPath).codexDelivery ?? delivery;
    if (
      Number(latest.fallbackNotifiedSequence ?? 0) < event.sequence &&
      process.env.PET_SOCIAL_NO_NOTIFY !== "1"
    ) {
      await showNotification({
        title: "Agent World Social",
        subtitle: "动态暂未进入 Codex",
        message: "动态已持久保存；打开绑定任务后会自动重试。"
      });
    }
    persistProgress({
      deliveryPatch: {
        fallbackNotifiedSequence: event.sequence,
        lastError: String(error.message ?? error),
        lastErrorAt: new Date().toISOString()
      }
    });
    throw error;
  } finally {
    codexAppServer.close();
  }
}

async function heartbeatLoop() {
  let lastReportedOpen;
  let lastHeartbeatAt = 0;
  while (!stopped) {
    try {
      const open = await isCodexOpen();
      if (codexOpen && !open) streamAbortController?.abort();
      codexOpen = open;
      config = readConfig(configPath);
      if (open !== lastReportedOpen || Date.now() - lastHeartbeatAt >= 30_000) {
        await client.heartbeat(open, "0.5.0");
        lastReportedOpen = open;
        lastHeartbeatAt = Date.now();
      }
    } catch (error) {
      console.error(`[bridge] heartbeat failed: ${error.message}`);
    }
    await wait(2_000, undefined, { signal: abortController.signal }).catch(() => {});
  }
}

async function eventLoop() {
  let delay = 1_000;
  while (!stopped) {
    if (!codexOpen) {
      await wait(500, undefined, { signal: abortController.signal }).catch(() => {});
      continue;
    }
    try {
      config = readConfig(configPath);
      streamAbortController = new AbortController();
      const streamSignal = AbortSignal.any([abortController.signal, streamAbortController.signal]);
      for await (const event of client.events(config.eventCursor ?? 0, streamSignal)) {
        if (stopped) return;
        config = readConfig(configPath);
        if (event.sequence <= (config.eventCursor ?? 0)) continue;
        console.log(`[bridge] ${event.eventType} #${event.sequence}`);

        const delivery = config.codexDelivery ?? {};
        await client.markEventReceipt(event.eventId, "delivered");
        const deliverInCodex =
          ["message.created", "world.event_committed", "world.interaction_opened"].includes(event.eventType) &&
          delivery.enabled === true &&
          typeof delivery.threadId === "string" &&
          delivery.threadId.length > 0;
        let displayed = false;

        if (deliverInCodex) {
          displayed = await deliverMessageToCodex(event, delivery);
        } else {
          const notification = eventMessage(event);
          if (notification && process.env.PET_SOCIAL_NO_NOTIFY !== "1") {
            await showNotification(notification);
          }
        }

        if (displayed) await client.ackEvent(event.eventId);
        persistProgress({ eventCursor: event.sequence });
      }
      delay = 1_000;
    } catch (error) {
      if (stopped) return;
      if (error.name === "AbortError" && !codexOpen) {
        delay = 1_000;
        continue;
      }
      if (error.name === "AbortError") return;
      console.error(`[bridge] event stream failed: ${error.message}; reconnecting in ${delay}ms`);
      await wait(delay).catch(() => {});
      delay = Math.min(30_000, Math.round(delay * 1.8));
    } finally {
      streamAbortController = undefined;
    }
  }
}

function stop() {
  if (stopped) return;
  stopped = true;
  abortController.abort();
  streamAbortController?.abort();
  codexAppServer.close();
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

console.log(`[bridge] starting for pet ${config.petId}`);
await Promise.all([heartbeatLoop(), eventLoop()]);
