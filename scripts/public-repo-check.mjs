#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { dirname, basename, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const SAFE_EMAIL_DOMAINS = new Set([
  "diyworld.ai",
  "example.com",
  "example.test",
  "github.com",
  "users.noreply.github.com",
]);

const blockedDirectoryNames = new Set([
  ".codex",
  ".cursor",
  ".idea",
  ".next",
  ".vercel",
  "backups",
  "coverage",
  "data",
  "dist",
  "logs",
]);
const blockedBasenames = new Set([
  ".npmrc",
  ".pypirc",
  "config.json",
  "credentials.json",
  "service-account.json",
]);
const blockedExtensions = new Set([
  ".db",
  ".key",
  ".p12",
  ".pem",
  ".pfx",
  ".sqlite",
  ".tgz",
]);

const contentRules = [
  ["private_key", /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/],
  ["aws_access_key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["github_token", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ["openai_api_key", /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["slack_token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ["google_api_key", /\bAIza[0-9A-Za-z_-]{25,}\b/],
  ["jwt_token", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ["developer_home_path", /(?:^|[\s"'`(])(?:\/Users\/[^/\s"'`]+|\/home\/[^/\s"'`]+)(?:\/|\b)/m],
  ["windows_user_path", /\b[A-Za-z]:\\Users\\[^\\\s"']+\\/],
  ["internal_network_name", /\b[A-Za-z0-9.-]+\.ts\.net\b/i],
];

function lineAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

function pathFindings(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
  const parts = normalized.split("/");
  const name = basename(normalized).toLowerCase();
  const extension = extname(name);
  const findings = [];

  if (parts.some((part) => blockedDirectoryNames.has(part.toLowerCase()))) {
    findings.push({ file: normalized, rule: "private_or_generated_directory" });
  }
  if (blockedBasenames.has(name) || name.startsWith("config.json.")) {
    findings.push({ file: normalized, rule: "sensitive_filename" });
  }
  if ((name === ".env" || name.startsWith(".env.")) && name !== ".env.example") {
    findings.push({ file: normalized, rule: "environment_file" });
  }
  if (blockedExtensions.has(extension) || name.endsWith(".sqlite-shm") || name.endsWith(".sqlite-wal")) {
    findings.push({ file: normalized, rule: "credential_or_runtime_artifact" });
  }
  return findings;
}

function textFindings(relativePath, text) {
  const findings = [];
  for (const [rule, pattern] of contentRules) {
    const match = pattern.exec(text);
    if (match) findings.push({ file: relativePath, rule, line: lineAt(text, match.index) });
  }

  const emailPattern = /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi;
  for (const match of text.matchAll(emailPattern)) {
    const domain = match[1].toLowerCase();
    if (!SAFE_EMAIL_DOMAINS.has(domain)) {
      findings.push({
        file: relativePath,
        rule: "personal_or_unreviewed_email",
        line: lineAt(text, match.index),
      });
    }
  }

  const repositoryPattern = /github\.com\/billxfan\/([A-Z0-9_.-]+)/gi;
  for (const match of text.matchAll(repositoryPattern)) {
    const repositoryName = match[1].replace(/\.git$/i, "").toLowerCase();
    if (repositoryName !== "diyworld-mcp") {
      findings.push({
        file: relativePath,
        rule: "unreviewed_repository_reference",
        line: lineAt(text, match.index),
      });
    }
  }
  return findings;
}

function scanRevisionDiff(root, revisionArgs, label) {
  const findings = [];
  const names = execFileSync(
    "git",
    ["log", ...revisionArgs, "--format=", "--name-only"],
    { cwd: root, encoding: "utf8", maxBuffer: 100 * 1024 * 1024 },
  );
  for (const name of new Set(names.split("\n").map((item) => item.trim()).filter(Boolean))) {
    findings.push(...pathFindings(name).map((item) => ({ ...item, file: `${label}:${item.file}` })));
  }

  const patch = execFileSync(
    "git",
    ["log", ...revisionArgs, "--format=", "--no-ext-diff", "--no-color", "--text", "-p"],
    { cwd: root, encoding: "utf8", maxBuffer: 100 * 1024 * 1024 },
  );
  findings.push(...textFindings(label, patch));
  return findings;
}

export function scanPublicFiles({ root, files, maxTextBytes = MAX_TEXT_BYTES }) {
  const findings = [];
  let checkedFiles = 0;

  for (const inputPath of [...new Set(files)].sort()) {
    const relativePath = inputPath.replaceAll("\\", "/").replace(/^\.\//, "");
    findings.push(...pathFindings(relativePath));

    const absolutePath = resolve(root, relativePath);
    let stat;
    try {
      stat = lstatSync(absolutePath);
    } catch {
      continue;
    }

    checkedFiles += 1;
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(absolutePath);
      if (target.startsWith("/") || target.split(/[\\/]/).includes("..")) {
        findings.push({ file: relativePath, rule: "unsafe_symlink_target" });
      }
      continue;
    }
    if (!stat.isFile() || stat.size > maxTextBytes) continue;

    const buffer = readFileSync(absolutePath);
    if (buffer.includes(0)) continue;
    findings.push(...textFindings(relativePath, buffer.toString("utf8")));
  }

  return {
    ok: findings.length === 0,
    checkedFiles,
    findings,
  };
}

export function listPublicRepositoryFiles(root) {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" },
  );
  return output.split("\0").filter(Boolean);
}

export function isPublicCommitEmail(email) {
  let normalized = String(email ?? "").trim().toLowerCase();
  const bracketed = normalized.match(/<([^>]+)>/);
  if (bracketed) normalized = bracketed[1];
  return normalized === `noreply@${"github.com"}` || normalized.endsWith("@users.noreply.github.com");
}

export function isGitHubMergeCommit({ committerEmail, committerName, parents }) {
  const normalizedCommitter = String(committerEmail ?? "").trim().toLowerCase();
  return (
    String(committerName ?? "").trim() === "GitHub" &&
    normalizedCommitter === `noreply@${"github.com"}`
  );
}

export function selectPublicHeadRevision(root, env = process.env) {
  if (env.GITHUB_EVENT_NAME !== "pull_request" || !env.GITHUB_EVENT_PATH) return "HEAD";
  try {
    const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
    const headSha = event?.pull_request?.head?.sha;
    if (!/^[0-9a-f]{40}$/i.test(headSha ?? "")) return "HEAD";
    execFileSync("git", ["cat-file", "-e", `${headSha}^{commit}`], {
      cwd: root,
      stdio: "ignore",
    });
    return headSha;
  } catch {
    return "HEAD";
  }
}

function scanTagMetadata(root) {
  const output = execFileSync(
    "git",
    ["for-each-ref", "--format=%(refname)%00%(taggeremail)%00%(contents)%00", "refs/tags"],
    { cwd: root, encoding: "utf8", maxBuffer: 100 * 1024 * 1024 },
  );
  const fields = output.split("\0");
  const findings = [];
  let checkedTags = 0;
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const ref = fields[index].trim();
    const taggerEmail = fields[index + 1].trim();
    const message = fields[index + 2];
    if (!ref) continue;
    checkedTags += 1;
    const location = `tag:${ref.replace(/^refs\/tags\//, "")}`;
    if (taggerEmail && !isPublicCommitEmail(taggerEmail)) {
      findings.push({ file: location, rule: "public_tag_email_required" });
    }
    findings.push(...textFindings(location, message));
  }
  return { checkedTags, findings };
}

function scanNewCommitMetadata(root) {
  const baselinePath = resolve(root, ".public-history-baseline");
  if (!existsSync(baselinePath)) {
    return {
      checkedCommits: 0,
      findings: [{ file: ".public-history-baseline", rule: "history_baseline_missing" }],
    };
  }

  const baseline = readFileSync(baselinePath, "utf8").trim();
  if (!/^[0-9a-f]{40}$/i.test(baseline)) {
    return {
      checkedCommits: 0,
      findings: [{ file: ".public-history-baseline", rule: "history_baseline_invalid" }],
    };
  }

  try {
    const headRevision = selectPublicHeadRevision(root);
    execFileSync("git", ["merge-base", "--is-ancestor", baseline, headRevision], {
      cwd: root,
      stdio: "ignore",
    });
    const output = execFileSync(
      "git",
      ["log", `--format=%H%x1f%ae%x1f%ce%x1f%cn%x1f%P%x1f%B%x1e`, `${baseline}..${headRevision}`],
      { cwd: root, encoding: "utf8" },
    );
    const commits = output
      .split("\x1e")
      .map((record) => record.trim())
      .filter(Boolean);
    const findings = [];

    for (const record of commits) {
      const [
        hash = "unknown",
        authorEmail = "",
        committerEmail = "",
        committerName = "",
        parents = "",
        ...bodyParts
      ] = record.split("\x1f");
      const location = `commit:${hash.slice(0, 12)}`;
      if (
        !isPublicCommitEmail(authorEmail) &&
        !isGitHubMergeCommit({ committerEmail, committerName, parents })
      ) {
        findings.push({ file: location, rule: "public_author_email_required" });
      }
      if (!isPublicCommitEmail(committerEmail)) {
        findings.push({ file: location, rule: "public_committer_email_required" });
      }
      findings.push(...textFindings(location, bodyParts.join("\x1f")));
    }
    findings.push(...scanRevisionDiff(root, [`${baseline}..${headRevision}`], "new-commit-content"));
    return { checkedCommits: commits.length, findings };
  } catch {
    return {
      checkedCommits: 0,
      findings: [{ file: ".public-history-baseline", rule: "history_baseline_unavailable" }],
    };
  }
}

export function scanHistoricalRepository(root) {
  try {
    const findings = scanRevisionDiff(root, ["--all"], "git-history");
    const output = execFileSync(
      "git",
      ["log", "--all", "--format=%H%x1f%ae%x1f%ce%x1f%B%x1e"],
      { cwd: root, encoding: "utf8", maxBuffer: 100 * 1024 * 1024 },
    );
    for (const record of output.split("\x1e").map((item) => item.trim()).filter(Boolean)) {
      const [hash = "unknown", authorEmail = "", committerEmail = "", ...bodyParts] = record.split("\x1f");
      const location = `commit:${hash.slice(0, 12)}`;
      if (!isPublicCommitEmail(authorEmail)) {
        findings.push({ file: location, rule: "public_author_email_required" });
      }
      if (!isPublicCommitEmail(committerEmail)) {
        findings.push({ file: location, rule: "public_committer_email_required" });
      }
      findings.push(...textFindings(location, bodyParts.join("\x1f")));
    }
    findings.push(...scanTagMetadata(root).findings);
    return { ok: findings.length === 0, findings };
  } catch {
    return {
      ok: false,
      findings: [{ file: "git-history", rule: "history_scan_unavailable" }],
    };
  }
}

export function scanPublicRepository(root) {
  const files = scanPublicFiles({ root, files: listPublicRepositoryFiles(root) });
  const history = scanNewCommitMetadata(root);
  const tags = scanTagMetadata(root);
  return {
    ok: files.ok && history.findings.length === 0 && tags.findings.length === 0,
    checkedFiles: files.checkedFiles,
    checkedCommits: history.checkedCommits,
    checkedTags: tags.checkedTags,
    findings: [...files.findings, ...history.findings, ...tags.findings],
  };
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const projectRoot = resolve(dirname(scriptPath), "..");
  const result = scanPublicRepository(projectRoot);
  if (process.argv.includes("--all-history")) {
    const history = scanHistoricalRepository(projectRoot);
    result.ok &&= history.ok;
    result.findings.push(...history.findings);
  }
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(
      `Public repository check passed (${result.checkedFiles} files, ${result.checkedCommits} new commit(s), and ${result.checkedTags} tag(s) checked).`,
    );
  } else {
    console.error(`Public repository check failed (${result.findings.length} finding(s)).`);
    for (const finding of result.findings) {
      const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
      console.error(`- ${location}: ${finding.rule}`);
    }
  }
  if (!result.ok) process.exitCode = 1;
}
