(() => {
  "use strict";

  const token = window.__PET_SOCIAL_CONSOLE_TOKEN__;
  const elements = {
    refreshButton: document.querySelector("#refresh-button"),
    identityTabs: document.querySelector("#identity-tabs"),
    refreshTime: document.querySelector("#refresh-time"),
    connectionBanner: document.querySelector("#connection-banner"),
    venueLabPanel: document.querySelector("#venue-lab-panel"),
    venueLabStatus: document.querySelector("#venue-lab-status"),
    venueLabPrepare: document.querySelector("#venue-lab-prepare"),
    venueLabReset: document.querySelector("#venue-lab-reset"),
    venueLabSteps: document.querySelector("#venue-lab-steps"),
    venueLabOccupancy: document.querySelector("#venue-lab-occupancy"),
    venueLabIdentities: document.querySelector("#venue-lab-identities"),
    venueLabCreate: document.querySelector("#venue-lab-create"),
    venueLabEnter: document.querySelector("#venue-lab-enter"),
    venueLabRequest: document.querySelector("#venue-lab-request"),
    venueLabAccept: document.querySelector("#venue-lab-accept"),
    venueLabMessageForm: document.querySelector("#venue-lab-message-form"),
    venueLabMessageSender: document.querySelector("#venue-lab-message-sender"),
    venueLabMessageText: document.querySelector("#venue-lab-message-text"),
    venueLabMessageCounter: document.querySelector("#venue-lab-message-counter"),
    venueLabMessages: document.querySelector("#venue-lab-messages"),
    venueLabEvents: document.querySelector("#venue-lab-events"),
    statsGrid: document.querySelector("#stats-grid"),
    profileVisibility: document.querySelector("#profile-visibility"),
    profileContent: document.querySelector("#profile-content"),
    squareCount: document.querySelector("#square-count"),
    squareList: document.querySelector("#square-list"),
    incomingCount: document.querySelector("#incoming-count"),
    incomingList: document.querySelector("#incoming-list"),
    outgoingCount: document.querySelector("#outgoing-count"),
    outgoingList: document.querySelector("#outgoing-list"),
    friendsCount: document.querySelector("#friends-count"),
    friendsList: document.querySelector("#friends-list"),
    messageForm: document.querySelector("#message-form"),
    messageTarget: document.querySelector("#message-target"),
    messageText: document.querySelector("#message-text"),
    messageCounter: document.querySelector("#message-counter"),
    messagesList: document.querySelector("#messages-list"),
    dialog: document.querySelector("#confirm-dialog"),
    dialogTitle: document.querySelector("#dialog-title"),
    dialogDetails: document.querySelector("#dialog-details"),
    dialogCancel: document.querySelector("#dialog-cancel"),
    dialogConfirm: document.querySelector("#dialog-confirm"),
    toast: document.querySelector("#toast")
  };

  let state = null;
  let selectedKey = null;
  let loading = false;
  let pendingConfirmation = null;
  let toastTimer = null;

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  }

  function button(label, className, handler) {
    const element = node("button", `button ${className}`, label);
    element.type = "button";
    element.addEventListener("click", handler);
    return element;
  }

  function empty(message) {
    return node("p", "empty-state", message);
  }

  function formatTime(value) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date(value));
  }

  function visibilityLabel(value) {
    return ({ public: "公开", friends_only: "仅好友", private: "私密" })[value] ?? value;
  }

  function statusLabel(value) {
    return ({ queued: "等待送达", delivered: "已送达", read: "已读", pending: "等待处理" })[value] ?? value;
  }

  function currentIdentity() {
    return state?.identities.find((identity) => identity.key === selectedKey) ?? state?.identities[0];
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        "x-pet-console-token": token,
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...options.headers
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error?.message ?? `请求失败（${response.status}）`);
      error.code = body.error?.code;
      throw error;
    }
    return body;
  }

  async function perform(action, payload, identityKey = selectedKey) {
    await api("/api/actions", {
      method: "POST",
      body: JSON.stringify({ identity: identityKey, action, payload })
    });
    showToast("操作成功，状态已刷新");
    await loadState({ silent: true });
  }

  async function performVenueLab(action, payload = {}) {
    await api("/api/actions", {
      method: "POST",
      body: JSON.stringify({
        scope: "venue_lab",
        action,
        payload
      })
    });
    showToast("场馆实验室已更新");
    await loadState({ silent: true });
  }

  function showToast(message, error = false) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.toggle("error", error);
    elements.toast.hidden = false;
    toastTimer = setTimeout(() => {
      elements.toast.hidden = true;
    }, 3_200);
  }

  function showError(error) {
    elements.connectionBanner.textContent = `${error.code ? `[${error.code}] ` : ""}${error.message}`;
    elements.connectionBanner.hidden = false;
    showToast(error.message, true);
  }

  function openConfirmation({ title, details, confirmLabel = "确认", run }) {
    pendingConfirmation = run;
    elements.dialogTitle.textContent = title;
    elements.dialogDetails.textContent = details;
    elements.dialogConfirm.textContent = confirmLabel;
    elements.dialog.showModal();
  }

  function petSummary(pet) {
    return `${pet.name} ${pet.handle}`;
  }

  function venueStepComplete(lab, key) {
    return Boolean(lab?.steps.find((step) => step.key === key)?.complete);
  }

  function venueEventLabel(action) {
    return ({
      "pet.created": "创建 Character 身份",
      "space.joined": "加入场馆",
      "space.joined_or_applied": "加入场馆",
      "space.entered": "进入场馆",
      "space.left": "离开场馆",
      "friend_request.sent": "发送好友申请",
      "friend_request.responded": "处理好友申请",
      "message.sent": "发送私聊",
      "message.read": "标记消息已读"
    })[action] ?? action;
  }

  function renderVenueLab() {
    const lab = state?.venueLab;
    if (!lab) {
      elements.venueLabPanel.hidden = true;
      return;
    }
    elements.venueLabPanel.hidden = false;

    const completeCount = lab.steps.filter((step) => step.complete).length;
    const allComplete = completeCount === lab.steps.length;
    elements.venueLabStatus.textContent = allComplete
      ? "完整链路通过"
      : lab.readyToMessage
        ? "已可测试私聊"
        : `${completeCount} / ${lab.steps.length} 已完成`;
    elements.venueLabStatus.classList.toggle("complete", allComplete);

    const stepNodes = lab.steps.map((step, index) => {
      const item = node("li", `scenario-step ${step.complete ? "complete" : ""}`);
      const marker = node("span", "step-marker", step.complete ? "✓" : String(index + 1));
      const content = node("div");
      content.append(
        node("strong", "", step.label),
        node("small", "", step.complete ? "已验证" : index === completeCount ? "下一步" : "等待")
      );
      item.append(marker, content);
      return item;
    });
    elements.venueLabSteps.replaceChildren(...stepNodes);

    const presentCount = lab.identities.filter(
      (identity) => identity.membership?.is_present
    ).length;
    elements.venueLabOccupancy.textContent = `${presentCount}/2`;

    const identityCards = lab.identities.map((identity) => {
      const card = node("article", "lab-identity-card");
      const heading = node("div", "lab-pet-heading");
      const avatar = node(
        "div",
        `lab-avatar ${identity.key}`,
        identity.pet?.name?.slice(0, 1) ?? identity.expectedName.slice(0, 1)
      );
      const title = node("div");
      title.append(
        node("strong", "lab-pet-name", identity.pet?.name ?? identity.expectedName),
        node("code", "lab-tool-name", identity.toolName)
      );
      heading.append(avatar, title);

      const statusRow = node("div", "lab-status-row");
      const memberStatus = identity.membership?.status === "active" ? "已加入" : "未加入";
      const presenceStatus = identity.membership?.is_present ? "当前在场" : "不在场";
      statusRow.append(
        node(
          "span",
          `mini-pill ${identity.membership?.status === "active" ? "success" : ""}`,
          memberStatus
        ),
        node(
          "span",
          `mini-pill ${identity.membership?.is_present ? "live" : ""}`,
          presenceStatus
        )
      );

      const others = identity.presentPets.filter((pet) => !pet.is_self);
      const discovery = node(
        "p",
        "lab-discovery",
        identity.membership?.is_present
          ? others.length
            ? `同场发现：${others.map((pet) => pet.name).join("、")}`
            : "同场发现：暂无其他 Character"
          : "进入场馆后可查看同场 Character"
      );

      const action = button(
        identity.membership?.is_present ? "离开场馆" : "进入场馆",
        "button-secondary button-small",
        () => {
          const actionName = identity.membership?.is_present ? "leave" : "enter";
          performVenueLab(actionName, { identity: identity.key }).catch(showError);
        }
      );
      action.disabled = !identity.pet;
      card.append(heading, statusRow, discovery, action);
      return card;
    });
    elements.venueLabIdentities.replaceChildren(...identityCards);

    const identitiesReady = venueStepComplete(lab, "identity");
    const colocated = venueStepComplete(lab, "presence");
    const friends = venueStepComplete(lab, "friendship");
    const bob = lab.identities.find((identity) => identity.key === "bob");
    const pendingRequest = Boolean(bob?.incomingRequests.length);

    elements.venueLabCreate.disabled = identitiesReady;
    elements.venueLabEnter.disabled = colocated;
    elements.venueLabRequest.disabled = !colocated || friends || pendingRequest;
    elements.venueLabAccept.disabled = friends || !pendingRequest;
    elements.venueLabPrepare.disabled = friends;

    const messageSubmit = elements.venueLabMessageForm.querySelector(
      "button[type='submit']"
    );
    elements.venueLabMessageSender.disabled = !lab.readyToMessage;
    elements.venueLabMessageText.disabled = !lab.readyToMessage;
    messageSubmit.disabled = !lab.readyToMessage;

    if (!lab.messages.length) {
      elements.venueLabMessages.replaceChildren(
        empty("好友建立后，可在这里验证发送、送达和已读状态。")
      );
    } else {
      const messageCards = lab.messages.map((message) => {
        const card = node("article", "lab-message-card");
        const body = node("div", "lab-message-main");
        body.append(
          node("p", "lab-message-route", `${message.sender.name} → ${message.recipient.name}`),
          node("p", "lab-message-text", message.body),
          node("p", "message-meta", formatTime(message.createdAt))
        );
        const side = node("div", "item-actions");
        side.append(
          node(
            "span",
            `message-status ${message.readAt ? "read" : "delivered"}`,
            message.readAt ? "已读" : "已送达"
          )
        );
        if (!message.readAt) {
          const recipient =
            lab.identities.find(
              (identity) => identity.pet?.id === message.recipient.id
            )?.key ?? "bob";
          side.append(
            button("标记已读", "button-secondary button-small", () => {
              performVenueLab("message_mark_read", {
                recipient,
                messageId: message.id
              }).catch(showError);
            })
          );
        }
        card.append(body, side);
        return card;
      });
      elements.venueLabMessages.replaceChildren(...messageCards);
    }

    if (!lab.events.length) {
      elements.venueLabEvents.replaceChildren(empty("尚无操作记录"));
    } else {
      const eventNodes = lab.events.map((event) => {
        const item = node("div", "event-item");
        const dot = node("span", "event-dot");
        const content = node("div");
        content.append(
          node("strong", "", venueEventLabel(event.action)),
          node("small", "", `${event.actorName} · ${formatTime(event.createdAt)}`)
        );
        item.append(dot, content);
        return item;
      });
      elements.venueLabEvents.replaceChildren(...eventNodes);
    }
  }

  function renderTabs() {
    const tabs = state.identities.map((identity) => {
      const tab = node("button", "identity-tab", `${identity.pet.name} · ${identity.label}`);
      tab.type = "button";
      tab.role = "tab";
      tab.setAttribute("aria-selected", String(identity.key === selectedKey));
      tab.addEventListener("click", () => {
        selectedKey = identity.key;
        render();
      });
      return tab;
    });
    elements.identityTabs.replaceChildren(...tabs);
  }

  function renderStats(identity) {
    const discovered = identity.square.active.length + identity.square.recent.length;
    const definitions = [
      ["广场可见 Character", discovered, `${identity.square.active.length} 个当前可达`],
      ["待处理申请", identity.incoming.length, identity.incoming.length ? "需要当前身份处理" : "没有新申请"],
      ["已建立好友", identity.friends.length, "可进行一对一消息测试"],
      ["消息记录", identity.messages.length, `${identity.messages.filter((message) => message.direction === "incoming").length} 条收到的消息`]
    ];
    const cards = definitions.map(([label, value, detail]) => {
      const card = node("article", "stat-card");
      card.append(node("p", "stat-label", label), node("strong", "stat-value", value), node("span", "stat-detail", detail));
      return card;
    });
    elements.statsGrid.replaceChildren(...cards);
  }

  function renderProfile(identity) {
    elements.profileVisibility.textContent = visibilityLabel(identity.pet.visibility);
    const card = node("div", "profile-card");
    const avatar = node("div", "pet-avatar", identity.pet.name.slice(0, 1));
    avatar.setAttribute("aria-hidden", "true");
    const content = node("div");
    content.append(
      node("p", "pet-name", identity.pet.name),
      node("p", "pet-handle", identity.pet.handle),
      node("p", "pet-bio", identity.pet.bio || "暂未设置简介")
    );
    card.append(avatar, content);
    elements.profileContent.replaceChildren(card);
  }

  function itemCard(pet, meta, actions = []) {
    const item = node("article", "list-item");
    const main = node("div", "item-main");
    main.append(node("p", "item-title", petSummary(pet)), node("p", "item-meta", meta));
    item.append(main);
    if (actions.length) {
      const actionRow = node("div", "item-actions");
      actionRow.append(...actions);
      item.append(actionRow);
    }
    return item;
  }

  function renderSquare(identity) {
    const pets = [
      ...identity.square.active.map((pet) => ({ ...pet, presence: "reachable" })),
      ...identity.square.recent.map((pet) => ({ ...pet, presence: "recent" }))
    ];
    elements.squareCount.textContent = String(pets.length);
    if (!pets.length) {
      elements.squareList.replaceChildren(empty("当前广场没有其他可见 Character"));
      return;
    }
    const friendIds = new Set(identity.friends.map((friend) => friend.pet.id));
    const pendingIds = new Set(identity.outgoing.map((request) => request.pet.id));
    const cards = pets.map((pet) => {
      let action;
      if (friendIds.has(pet.id)) {
        action = button("已是好友", "button-secondary button-small", () => {});
        action.disabled = true;
      } else if (pendingIds.has(pet.id)) {
        action = button("申请中", "button-secondary button-small", () => {});
        action.disabled = true;
      } else {
        action = button("发送申请", "button-primary button-small", () => {
          openConfirmation({
            title: "发送好友申请",
            details: `发送方：${petSummary(identity.pet)}\n接收方：${petSummary(pet)}\n\n确认发送好友申请？`,
            confirmLabel: "发送申请",
            run: () => perform("friend_request_send", { target: pet.handle }, identity.key)
          });
        });
      }
      const card = itemCard(pet, pet.bio || "暂无简介", [action]);
      const presence = node("span", `presence ${pet.presence === "recent" ? "recent" : ""}`, pet.presence === "reachable" ? "当前可达" : "近 7 天活跃");
      card.querySelector(".item-main").append(presence);
      return card;
    });
    elements.squareList.replaceChildren(...cards);
  }

  function renderRequests(identity) {
    elements.incomingCount.textContent = String(identity.incoming.length);
    elements.outgoingCount.textContent = String(identity.outgoing.length);

    if (!identity.incoming.length) {
      elements.incomingList.replaceChildren(empty("没有待处理的申请"));
    } else {
      const incoming = identity.incoming.map((request) => {
        const accept = button("接受", "button-primary button-small", () => {
          openConfirmation({
            title: "接受好友申请",
            details: `当前身份：${petSummary(identity.pet)}\n申请方：${petSummary(request.pet)}\n\n接受后双方可以发送消息。`,
            confirmLabel: "接受申请",
            run: () => perform("friend_request_respond", { friendshipId: request.id, decision: "accept" }, identity.key)
          });
        });
        const reject = button("拒绝", "button-secondary button-small", () => {
          openConfirmation({
            title: "拒绝好友申请",
            details: `当前身份：${petSummary(identity.pet)}\n申请方：${petSummary(request.pet)}\n\n拒绝后会进入冷却期。`,
            confirmLabel: "确认拒绝",
            run: () => perform("friend_request_respond", { friendshipId: request.id, decision: "reject" }, identity.key)
          });
        });
        const block = button("屏蔽", "button-danger button-small", () => {
          openConfirmation({
            title: "屏蔽申请方",
            details: `当前身份：${petSummary(identity.pet)}\n屏蔽对象：${petSummary(request.pet)}\n\n屏蔽会立即阻止未来联系，但不会删除历史消息。`,
            confirmLabel: "确认屏蔽",
            run: () => perform("friend_request_respond", { friendshipId: request.id, decision: "block" }, identity.key)
          });
        });
        return itemCard(request.pet, `状态：${statusLabel(request.status)} · 失效：${formatTime(request.expiresAt)}`, [accept, reject, block]);
      });
      elements.incomingList.replaceChildren(...incoming);
    }

    if (!identity.outgoing.length) {
      elements.outgoingList.replaceChildren(empty("没有等待中的外发申请"));
    } else {
      const outgoing = identity.outgoing.map((request) => itemCard(
        request.pet,
        `状态：${statusLabel(request.status)} · 失效：${formatTime(request.expiresAt)}`
      ));
      elements.outgoingList.replaceChildren(...outgoing);
    }
  }

  function renderFriends(identity) {
    elements.friendsCount.textContent = String(identity.friends.length);
    if (!identity.friends.length) {
      elements.friendsList.replaceChildren(empty("接受好友申请后，关系会显示在这里"));
      return;
    }
    const cards = identity.friends.map((friend) => {
      const chat = button("开始聊天", "button-primary button-small", () => {
        elements.messageTarget.value = friend.pet.handle;
        elements.messageText.focus();
        elements.messageForm.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      const remove = button("删除好友", "button-danger button-small", () => {
        openConfirmation({
          title: "删除好友",
          details: `当前身份：${petSummary(identity.pet)}\n删除对象：${petSummary(friend.pet)}\n\n历史消息会保留，但双方不能继续发送消息。`,
          confirmLabel: "确认删除",
          run: () => perform("friend_remove", { friendshipId: friend.friendshipId }, identity.key)
        });
      });
      return itemCard(friend.pet, `会话：${friend.conversationId}`, [chat, remove]);
    });
    elements.friendsList.replaceChildren(...cards);
  }

  function renderComposer(identity) {
    const currentValue = elements.messageTarget.value;
    const options = identity.friends.map((friend) => {
      const option = node("option", "", petSummary(friend.pet));
      option.value = friend.pet.handle;
      return option;
    });
    if (!options.length) {
      const option = node("option", "", "请先建立好友关系");
      option.value = "";
      options.push(option);
    }
    elements.messageTarget.replaceChildren(...options);
    if (options.some((option) => option.value === currentValue)) elements.messageTarget.value = currentValue;
    const submit = elements.messageForm.querySelector("button[type='submit']");
    elements.messageTarget.disabled = !identity.friends.length;
    elements.messageText.disabled = !identity.friends.length;
    submit.disabled = !identity.friends.length;
  }

  function renderMessages(identity) {
    if (!identity.messages.length) {
      elements.messagesList.replaceChildren(empty("暂无消息。成为好友后可以测试发送、送达和已读回执。"));
      return;
    }
    const cards = [...identity.messages].reverse().map((message) => {
      const card = node("article", `message-card ${message.direction}`);
      card.append(node("div", "message-direction", message.direction === "incoming" ? "收到" : "发出"));
      const body = node("div", "message-body");
      body.append(
        node("p", "message-text", message.text),
        node("p", "message-meta", `${message.sender.name} → ${message.recipient.name} · ${formatTime(message.createdAt)}`)
      );
      card.append(body);
      const side = node("div", "item-actions");
      side.append(node("span", `message-status ${message.status}`, statusLabel(message.status)));
      if (message.direction === "incoming" && message.status !== "read") {
        side.append(button("标记已读", "button-secondary button-small", () => {
          perform("message_mark_read", {
            conversationId: message.conversationId,
            maxSequenceNo: message.sequenceNo
          }, identity.key).catch(showError);
        }));
      }
      card.append(side);
      return card;
    });
    elements.messagesList.replaceChildren(...cards);
  }

  function render() {
    const identity = currentIdentity();
    renderVenueLab();
    if (!identity) return;
    renderTabs();
    renderStats(identity);
    renderProfile(identity);
    renderSquare(identity);
    renderRequests(identity);
    renderFriends(identity);
    renderComposer(identity);
    renderMessages(identity);
  }

  async function loadState({ silent = false } = {}) {
    if (loading) return;
    loading = true;
    elements.refreshButton.disabled = true;
    if (!silent) elements.refreshTime.textContent = "正在连接本机服务…";
    try {
      const next = await api("/api/state");
      state = next;
      if (!selectedKey || !state.identities.some((identity) => identity.key === selectedKey)) {
        selectedKey = state.identities[0]?.key ?? null;
      }
      elements.connectionBanner.hidden = true;
      elements.refreshTime.textContent = `上次刷新：${formatTime(state.refreshedAt)}`;
      render();
    } catch (error) {
      showError(error);
      elements.refreshTime.textContent = "连接失败";
    } finally {
      loading = false;
      elements.refreshButton.disabled = false;
    }
  }

  elements.refreshButton.addEventListener("click", () => loadState());
  elements.venueLabPrepare.addEventListener("click", () => {
    openConfirmation({
      title: "准备场馆联调场景",
      details:
        "将依次执行：\n1. 创建阿球与豆包两个 Character\n2. 两个 Character 加入并进入「中心小镇」\n3. 阿球发送好友申请\n4. 豆包接受申请\n\n不会自动发送私聊消息。",
      confirmLabel: "开始准备",
      run: () => performVenueLab("prepare_to_chat")
    });
  });
  elements.venueLabReset.addEventListener("click", () => {
    openConfirmation({
      title: "重置场馆实验室",
      details:
        "将清除场馆实验室内的 Character、成员关系、在场状态、好友关系和消息记录。\n\n现有广场联调数据不会受到影响。",
      confirmLabel: "确认重置",
      run: () => performVenueLab("reset")
    });
  });
  elements.venueLabCreate.addEventListener("click", () => {
    performVenueLab("create_identities").catch(showError);
  });
  elements.venueLabEnter.addEventListener("click", () => {
    performVenueLab("prepare").catch(showError);
  });
  elements.venueLabRequest.addEventListener("click", () => {
    openConfirmation({
      title: "发送场馆好友申请",
      details:
        "发送方：阿球 · character_alice\n接收方：豆包 · character_bob\n来源：中心小镇\n\n确认发送好友申请？",
      confirmLabel: "发送申请",
      run: () => performVenueLab("friend_request_send")
    });
  });
  elements.venueLabAccept.addEventListener("click", () => {
    openConfirmation({
      title: "接受场馆好友申请",
      details:
        "当前身份：豆包 · character_bob\n申请方：阿球 · character_alice\n\n接受后双方可以在离场后继续私聊。",
      confirmLabel: "接受申请",
      run: () => performVenueLab("friend_request_accept")
    });
  });
  elements.venueLabMessageText.addEventListener("input", () => {
    elements.venueLabMessageCounter.textContent =
      `${elements.venueLabMessageText.value.length} / 4000`;
  });
  elements.venueLabMessageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const lab = state?.venueLab;
    const senderKey = elements.venueLabMessageSender.value;
    const text = elements.venueLabMessageText.value.trim();
    if (!lab?.readyToMessage || !text) return;
    const sender = lab.identities.find((identity) => identity.key === senderKey);
    const recipient = lab.identities.find((identity) => identity.key !== senderKey);
    openConfirmation({
      title: "确认发送场馆私聊",
      details:
        `发送方：${sender?.pet?.name ?? sender?.expectedName} · ${sender?.toolName}\n` +
        `接收方：${recipient?.pet?.name ?? recipient?.expectedName} · ${recipient?.toolName}\n\n` +
        `消息正文：\n${text}\n\n这段文字将作为外部 Character 消息发送。`,
      confirmLabel: "确认发送",
      run: async () => {
        await performVenueLab("message_send", { sender: senderKey, text });
        elements.venueLabMessageText.value = "";
        elements.venueLabMessageCounter.textContent = "0 / 4000";
      }
    });
  });
  elements.messageText.addEventListener("input", () => {
    elements.messageCounter.textContent = `${elements.messageText.value.length} / 2000`;
  });
  elements.messageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const identity = currentIdentity();
    const target = elements.messageTarget.value;
    const text = elements.messageText.value.trim();
    if (!identity || !target || !text) return;
    const friend = identity.friends.find((item) => item.pet.handle === target);
    openConfirmation({
      title: "确认发送消息",
      details: `发送方：${petSummary(identity.pet)}\n接收方：${friend ? petSummary(friend.pet) : target}\n\n消息正文：\n${text}\n\n这段文字将作为外部 Character 消息发送。`,
      confirmLabel: "确认发送",
      run: async () => {
        await perform("message_send", { target, text }, identity.key);
        elements.messageText.value = "";
        elements.messageCounter.textContent = "0 / 2000";
      }
    });
  });

  elements.dialogCancel.addEventListener("click", () => {
    pendingConfirmation = null;
    elements.dialog.close();
  });
  elements.dialogConfirm.addEventListener("click", async (event) => {
    event.preventDefault();
    const run = pendingConfirmation;
    pendingConfirmation = null;
    elements.dialog.close();
    if (!run) return;
    try {
      await run();
    } catch (error) {
      showError(error);
    }
  });
  elements.dialog.addEventListener("cancel", () => {
    pendingConfirmation = null;
  });

  loadState();
})();
