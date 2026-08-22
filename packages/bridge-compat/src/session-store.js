import { createReadStream, existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function scoreSession(session, query) {
  const q = query.toLowerCase();
  const id = session.id.toLowerCase();
  const title = (session.title ?? "").toLowerCase();
  if (id === q) return 10000;
  if (id.startsWith(q)) return 9000;
  if (title === q) return 8000;
  if (title.startsWith(q)) return 6000;
  if (title.includes(q)) return 4000;
  const terms = q.split(/\s+/).filter(Boolean);
  if (terms.length && terms.every((term) => title.includes(term))) return 2000 + terms.length;
  return 0;
}

export class SessionStore {
  constructor(codexHome, supplementalSessions = () => []) {
    this.codexHome = codexHome;
    this.indexPath = path.join(codexHome, "session_index.jsonl");
    this.supplementalSessions = supplementalSessions;
  }

  async list() {
    const latest = new Map();
    const input = createReadStream(this.indexPath, { encoding: "utf8" });
    const lines = createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        const previous = latest.get(item.id);
        if (!previous || String(item.updated_at) >= String(previous.updatedAt)) {
          latest.set(item.id, {
            id: item.id,
            title: item.thread_name || "未命名会话",
            updatedAt: item.updated_at,
          });
        }
      } catch {
        // A partially-written final line is safe to ignore and will be visible on the next read.
      }
    }
    for (const session of this.supplementalSessions() || []) latest.set(session.id, session);
    return [...latest.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async find(query, limit = 5) {
    const normalized = query.trim();
    if (!normalized) return [];
    const sessions = await this.list();
    return sessions
      .map((session) => ({ ...session, score: scoreSession(session, normalized) }))
      .filter((session) => session.score > 0)
      .sort((a, b) => b.score - a.score || String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, limit);
  }

  async get(id) {
    return (await this.list()).find((session) => session.id === id) ?? null;
  }

  isLocked(id) {
    return existsSync(path.join(this.codexHome, "thread-writer-locks", `${id}.lock`));
  }

  async lockAgeMs(id) {
    try {
      const info = await stat(path.join(this.codexHome, "thread-writer-locks", `${id}.lock`));
      return Date.now() - info.mtimeMs;
    } catch {
      return null;
    }
  }
}

export { UUID_RE };
