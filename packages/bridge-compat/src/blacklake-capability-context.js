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

export async function loadBlacklakeCapabilityContext(workspaceRoot) {
  const sections = [];
  for (const relativePath of SOURCE_FILES) {
    const absolutePath = path.join(workspaceRoot, relativePath);
    try {
      const content = await readFile(absolutePath, "utf8");
      sections.push(`### ${relativePath}\n${compact(content)}`);
    } catch (error) {
      throw new Error(`黑湖能力真源不可读：${relativePath}：${error.message}`);
    }
  }
  return sections.join("\n\n");
}

export { SOURCE_FILES as BLACKLAKE_CAPABILITY_SOURCES };
