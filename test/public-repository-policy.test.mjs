import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  isPublicCommitEmail,
  scanPublicFiles,
  scanPublicRepository,
} from "../scripts/public-repo-check.mjs";

const projectRoot = resolve(import.meta.dirname, "..");

test("the current public tree and post-baseline commits contain no known private artifacts", () => {
  const result = scanPublicRepository(projectRoot);
  assert.deepEqual(result.findings, []);
  assert.equal(result.ok, true);
  assert.ok(result.checkedFiles > 0);
});

test("future public commits require a Git hosting noreply address", () => {
  assert.equal(isPublicCommitEmail(`123+builder@${"users.noreply.github.com"}`), true);
  assert.equal(isPublicCommitEmail(`Builder <123+builder@${"users.noreply.github.com"}>`), true);
  assert.equal(isPublicCommitEmail(`noreply@${"github.com"}`), true);
  assert.equal(isPublicCommitEmail(`developer@${"personal.invalid"}`), false);
});

test("the opt-in pre-push public gate is executable", () => {
  const hook = statSync(resolve(projectRoot, ".githooks/pre-push"));
  assert.notEqual(hook.mode & 0o111, 0);
});

test("the public gate reports locations without echoing suspected secrets", () => {
  const directory = mkdtempSync(join(tmpdir(), "diyworld-public-gate-"));
  const candidate = "sk-" + "a".repeat(32);
  try {
    writeFileSync(join(directory, "safe.txt"), "hello@example.test\n");
    writeFileSync(join(directory, "leak.txt"), `token=${candidate}\n`);
    writeFileSync(join(directory, ".env.production"), "PLACEHOLDER=true\n");

    const result = scanPublicFiles({
      root: directory,
      files: ["safe.txt", "leak.txt", ".env.production"],
    });
    assert.equal(result.ok, false);
    assert.ok(result.findings.some((item) => item.rule === "openai_api_key"));
    assert.ok(result.findings.some((item) => item.rule === "environment_file"));
    assert.equal(JSON.stringify(result).includes(candidate), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
