import { spawn } from "node:child_process";

export function normalizeText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function shortId(id) {
  return id ? id.slice(0, 8) : "unknown";
}

export function formatUserTime(value, timeZone = "Asia/Shanghai") {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function localHour(value = new Date(), timeZone = "Asia/Shanghai") {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError("invalid date");
  return Number(new Intl.DateTimeFormat("en-US", {
    timeZone, hour: "2-digit", hourCycle: "h23",
  }).formatToParts(date).find((part) => part.type === "hour")?.value);
}

export function isWithinLocalHourWindow(value, timeZone = "Asia/Shanghai", startHour = 8, endHour = 20) {
  const hour = localHour(value, timeZone);
  if (startHour === endHour) return true;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

export function isExplicitCardActionConfigurationFailure(detail) {
  const text = String(detail || "");
  return /card\.action\.trigger/i.test(text)
    && /(not enabled|not configured|not subscribed|enable|configure|subscribe|missing[_ -]?scope|permission)/i.test(text);
}

export function splitMessage(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxChars) {
    let cut = remaining.lastIndexOf("\n", maxChars);
    if (cut < maxChars * 0.5) cut = maxChars;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n+/, "");
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function parseCliJson(text) {
  const source = String(text ?? "");
  for (let start = source.indexOf("{"); start >= 0; start = source.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}" && --depth === 0) {
        try { return JSON.parse(source.slice(start, index + 1)); }
        catch { break; }
      }
    }
  }
  throw new SyntaxError(`CLI 输出中没有有效 JSON：${source.trim().slice(0, 500)}`);
}

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data) => {
      stdout += data;
      options.onStdout?.(data);
    });
    child.stderr.on("data", (data) => {
      stderr += data;
      options.onStderr?.(data);
    });
    child.on("error", reject);
    let timeout;
    let timeoutTriggered = false;
    if (options.timeoutMs) {
      timeout = setTimeout(() => {
        timeoutTriggered = true;
        child.kill("SIGTERM");
      }, options.timeoutMs);
      timeout.unref();
    }
    child.on("close", (code, signal) => {
      if (timeout) clearTimeout(timeout);
      resolve({
        code,
        signal,
        stdout,
        stderr,
        // Shell launchers may translate SIGTERM into exit 143 instead of
        // preserving the signal. Track whether our own deadline fired so the
        // caller can retain and resume the job instead of treating it as a
        // terminal executor failure.
        timedOut: timeoutTriggered && (signal === "SIGTERM" || code === 143 || code === null),
      });
    });
    if (options.input !== undefined) {
      child.stdin.end(options.input);
    }
    options.onSpawn?.(child);
  });
}
