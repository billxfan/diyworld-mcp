import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createVenueLab } from "../src/venue-lab.mjs";

test("venue lab runs the complete center-town path and can reset", () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-pet-venue-lab-"));
  const databasePath = join(directory, "venue-lab.sqlite");
  const lab = createVenueLab({ databasePath });

  try {
    assert.deepEqual(lab.state().steps.map((step) => step.complete), [
      false,
      false,
      false,
      false,
      false
    ]);

    lab.perform("prepare_to_chat");
    let state = lab.state();
    assert.deepEqual(state.steps.map((step) => step.complete), [
      true,
      true,
      true,
      true,
      false
    ]);

    lab.perform("message_send", {
      sender: "alice",
      text: "你好，你今天吃饭了吗"
    });
    state = lab.state();
    assert.equal(state.steps.at(-1).complete, true);
    assert.equal(state.messages[0].recipient.name, "豆包");
    assert.equal(state.messages[0].body, "你好，你今天吃饭了吗");

    lab.perform("message_mark_read", {
      recipient: "bob",
      messageId: state.messages[0].id
    });
    assert.ok(lab.state().messages[0].readAt);

    lab.perform("reset");
    assert.deepEqual(lab.state().steps.map((step) => step.complete), [
      false,
      false,
      false,
      false,
      false
    ]);
  } finally {
    lab.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
