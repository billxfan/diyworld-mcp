import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function isCodexOpen() {
  if (process.env.PET_SOCIAL_CODEX_OPEN === "1") return true;
  if (process.env.PET_SOCIAL_CODEX_OPEN === "0") return false;
  try {
    const { stdout } = await execFileAsync("ps", ["-axo", "comm=,args="], { maxBuffer: 4 * 1024 * 1024 });
    return stdout.split("\n").some((line) =>
      /\/Applications\/(Codex|ChatGPT)\.app\//i.test(line) ||
      /\bcodex(?:\s|$)/i.test(line)
    );
  } catch {
    return false;
  }
}

function appleScriptString(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", " ")}"`;
}

export function showNotification({ title = "Agent World Social", subtitle = "", message }) {
  if (process.platform !== "darwin") return Promise.resolve(false);
  const script = [
    `display notification ${appleScriptString(message)}`,
    subtitle ? `with title ${appleScriptString(title)} subtitle ${appleScriptString(subtitle)}` : `with title ${appleScriptString(title)}`
  ].join(" ");
  return new Promise((resolve) => {
    const child = spawn("osascript", ["-e", script], { stdio: "ignore" });
    child.once("exit", (code) => resolve(code === 0));
    child.once("error", () => resolve(false));
  });
}

export function focusCodex() {
  if (process.platform !== "darwin") return Promise.resolve(false);
  return new Promise((resolve) => {
    const script = 'tell application "System Events" to set frontmost of first process whose name is "Codex" or name is "ChatGPT" to true';
    const child = spawn("osascript", ["-e", script], { stdio: "ignore" });
    child.once("exit", (code) => resolve(code === 0));
    child.once("error", () => resolve(false));
  });
}
