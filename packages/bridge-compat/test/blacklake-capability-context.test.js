import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadBlacklakeCapabilityContext } from "../src/blacklake-capability-context.js";

test("loads bounded knowledge details that match the current conversation context", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "blacklake-context-"));
  const files = {
    "docs/guides/reference-projects/blacklake-reference-router.md": "# Router\n- route",
    "ai/devops-virtual-employee/skills/virtual-employee-router/SKILL.md": "# Virtual employee\n- route",
    "harness/bl-common-harness/.claude/rules/skill-routing.md": "# Harness\n- route",
    "ai/ai-devops-knowledge-base/indexes/rules.md": "# Rules\n- none",
    "ai/ai-devops-knowledge-base/indexes/knowledge-docs.md": "# Index\n- unchanged reference repository",
    "docs/knowledge/assistant/_index.md": "# Assistant index\n| id | file |\n| edge | `cases/CASE-EDGE.md` |",
    "docs/knowledge/assistant/cases/CASE-EDGE.md": "---\nkeywords: 边缘数据同步, MaterialInventoryBizKey, 批次字段\n---\n# 边缘同步字段配置\n- 先配置字段，再补同步数据。",
  };
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  const context = await loadBlacklakeCapabilityContext(root, {
    query: "之前讨论过 MaterialInventoryBizKey 的批次字段",
    assistantKnowledgeRoot: path.join(root, "docs/knowledge/assistant"),
  });
  assert.match(context, /按当前消息与上下文命中的知识详情/);
  assert.match(context, /QuarkSelfAI 自有知识/);
  assert.match(context, /先配置字段，再补同步数据/);
});
