import { readFile } from "node:fs/promises";
import path from "node:path";

const SOURCE_FILES = [
  "docs/guides/reference-projects/blacklake-reference-router.md",
  "ai/devops-virtual-employee/skills/virtual-employee-router/SKILL.md",
  "harness/bl-common-harness/.claude/rules/skill-routing.md",
  "ai/ai-devops-knowledge-base/indexes/knowledge-docs.md",
  "ai/ai-devops-knowledge-base/indexes/rules.md",
];

function compact(text, maxLength = 24000) {
  const selected = String(text)
    .split("\n")
    .filter((line) => /^(#|\||-|\d+\.)/.test(line.trim()))
    .join("\n")
    .trim();
  return selected.length <= maxLength ? selected : `${selected.slice(0, maxLength)}\n[内容已截断]`;
}

function indexedKnowledgePaths(indexText) {
  return [...String(indexText).matchAll(/`((?:\.\.\/)?(?:cases|rules|flows|glossary|questions)\/[^`]+\.md)`/g)]
    .map((match) => match[1]);
}

function knowledgeKeywords(text) {
  const metadata = String(text).match(/^keywords:\s*(.+)$/m)?.[1] || "";
  return metadata.split(/[,，;；]/).map((item) => item.trim().toLowerCase()).filter((item) => item.length >= 2);
}

async function matchingKnowledge(indexDir, indexText, query, limit = 3) {
  const normalizedQuery = String(query || "").toLowerCase().replace(/\s+/g, " ");
  if (!normalizedQuery.trim()) return [];
  const candidates = [];
  for (const relativePath of indexedKnowledgePaths(indexText)) {
    const absolutePath = path.resolve(indexDir, relativePath);
    try {
      const content = await readFile(absolutePath, "utf8");
      const matched = knowledgeKeywords(content).filter((keyword) => normalizedQuery.includes(keyword));
      if (matched.length) candidates.push({ relativePath, content, score: matched.reduce((sum, keyword) => sum + keyword.length, 0) });
    } catch {
      // The freshness gate reports broken source paths. Retrieval remains read-only
      // and must not turn one stale index row into a dropped Feishu message.
    }
  }
  return candidates.sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath)).slice(0, limit);
}

export async function loadBlacklakeCapabilityContext(workspaceRoot, {
  query = "",
  assistantKnowledgeRoot = path.join(workspaceRoot, "docs/knowledge/assistant"),
} = {}) {
  const sections = [];
  let knowledgeIndex = "";
  for (const relativePath of SOURCE_FILES) {
    const absolutePath = path.join(workspaceRoot, relativePath);
    try {
      const content = await readFile(absolutePath, "utf8");
      if (relativePath.endsWith("indexes/knowledge-docs.md")) knowledgeIndex = content;
      sections.push(`### ${relativePath}\n${compact(content)}`);
    } catch (error) {
      throw new Error(`黑湖能力真源不可读：${relativePath}：${error.message}`);
    }
  }
  const assistantIndexPath = path.join(assistantKnowledgeRoot, "_index.md");
  let assistantIndex;
  try { assistantIndex = await readFile(assistantIndexPath, "utf8"); }
  catch (error) { throw new Error(`助手自有知识索引不可读：${assistantIndexPath}：${error.message}`); }
  sections.push(`### QuarkSelfAI 自有知识索引\n${compact(assistantIndex)}`);
  const [assistantMatches, referenceMatches] = await Promise.all([
    matchingKnowledge(assistantKnowledgeRoot, assistantIndex, query),
    matchingKnowledge(path.join(workspaceRoot, "ai/ai-devops-knowledge-base/indexes"), knowledgeIndex, query),
  ]);
  const matches = [
    ...assistantMatches.map((item) => ({ ...item, source: "QuarkSelfAI 自有知识" })),
    ...referenceMatches.map((item) => ({ ...item, source: "只读参考知识" })),
  ].sort((left, right) => right.score - left.score).slice(0, 3);
  if (matches.length) {
    sections.push(`### 按当前消息与上下文命中的知识详情\n${matches.map(({ relativePath, content, source }) => `#### ${source}: ${relativePath}\n${compact(content, 8000)}`).join("\n\n")}`);
  }
  return sections.join("\n\n");
}

export { SOURCE_FILES as BLACKLAKE_CAPABILITY_SOURCES };
