import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DidaTaskCreator, expectedTaskTitlePrefix, formatContext, normalizeTaskResult, validateTaskPresentation } from "../src/dida-task-creator.js";

test("invokes Codex MCP worker and validates the target project", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fake-dida-"));
  const fake = path.join(dir, "codex");
  await writeFile(fake, `#!/bin/zsh
out=""
while (( $# )); do
  if [[ "$1" == "-o" ]]; then shift; out="$1"; fi
  shift
done
cat >/dev/null
print -r -- '{"taskId":"task_1","projectId":"project_1","title":"【重要·关键】确认客户方案","titlePrefix":"【重要·关键】","urgencyLabel":"重要","keyItem":true,"url":null,"created":true,"taskAction":"created","intakeDecision":"task","actionRequired":true,"actionOwner":"changdongxu","nextAction":"确认客户方案","notificationDecision":"notify","notificationMode":"realtime","notificationDelayMinutes":0,"notificationTitle":"客户方案等你确认","ownerMessage":"我把客户方案整理成待办了，现在只差你确认一下。","cardTone":"yellow","notificationReason":"需要确认客户方案","materialChangeSummary":"新事项","summary":"ok","priority":3,"tags":["飞书","重要","关键事项"],"needsClarification":false,"blacklakeRelated":false,"researchDecision":"skip","researchChannel":"none"}' > "$out"
`, { mode: 0o755 });
  const creator = new DidaTaskCreator({
    codexCli: fake, workspaceRoot: dir, varDir: path.join(dir, "var"), didaProjectId: "project_1",
    didaResultSchemaPath: path.join(dir, "schema.json"), blacklakeCapabilityContext: "test capability catalog",
  });
  const task = await creator.createFromMention({
    message_id: "om_1", chat_id: "oc_1", chat_name: "项目群", chat_type: "group",
    create_time: "2026-08-14 10:00", content: "@常东旭 请跟进", sender: { name: "同事" },
  }, []);
  assert.equal(task.taskId, "task_1");
  assert.equal(task.projectId, "project_1");
});

test("maps priority and key status to a glanceable title prefix", () => {
  assert.equal(expectedTaskTitlePrefix(5, true), "【紧急·关键】");
  assert.equal(expectedTaskTitlePrefix(3, false), "【重要】");
  assert.equal(expectedTaskTitlePrefix(1, true), "【跟进·关键】");
  assert.equal(expectedTaskTitlePrefix(0, false), "【关注】");
});

test("rejects task presentation that cannot be scanned reliably", () => {
  assert.throws(() => validateTaskPresentation({
    created: true, priority: 3, urgencyLabel: "重要", keyItem: true,
    taskAction: "created", intakeDecision: "task", actionRequired: true,
    actionOwner: "changdongxu", nextAction: "确认方案",
    titlePrefix: "【重要·关键】", title: "【重要·关键】确认方案", tags: ["飞书", "重要"],
  }), /关键事项/);
});

test("rejects creating an automation todo without a concrete owner and next action", () => {
  assert.throws(() => validateTaskPresentation({
    created: true, taskAction: "created", intakeDecision: "information",
    actionRequired: false, actionOwner: "unknown", nextAction: "知悉并持续关注",
    priority: 1, urgencyLabel: "跟进", keyItem: false,
    titlePrefix: "【跟进】", title: "【跟进】知悉平台变更", tags: ["飞书", "跟进"],
  }), /明确未完成动作/);
});

test("rejects creating priority-zero information in the automation todo list", () => {
  assert.throws(() => validateTaskPresentation({
    created: true, taskAction: "created", intakeDecision: "task",
    actionRequired: true, actionOwner: "changdongxu", nextAction: "持续关注",
    priority: 0, urgencyLabel: "关注", keyItem: false,
    titlePrefix: "【关注】", title: "【关注】留意项目状态", tags: ["飞书", "关注"],
  }), /纯关注信息/);
});

test("rejects repeated notifications for an unchanged task", () => {
  assert.throws(() => validateTaskPresentation({
    created: false, taskAction: "unchanged", notificationDecision: "notify",
    needsClarification: false, researchDecision: "skip",
    priority: 1, urgencyLabel: "跟进", keyItem: false,
    titlePrefix: "【跟进】", title: "【跟进】确认方案", tags: ["飞书", "跟进"],
  }), /不得重复通知/);
});

test("accepts a silent unchanged legacy task without forcing a presentation rewrite", () => {
  assert.doesNotThrow(() => validateTaskPresentation({
    taskId: "legacy_1", projectId: "project_1", title: "确认旧事项",
    created: false, taskAction: "unchanged", notificationDecision: "silent",
    needsClarification: false, researchDecision: "skip", researchChannel: "none",
    priority: 1, urgencyLabel: "跟进", keyItem: false, tags: [],
  }));
});

test("requires approval tasks to notify with a concrete approval summary", () => {
  assert.throws(() => validateTaskPresentation({
    created: true, taskAction: "created", intakeDecision: "task", requestType: "approval",
    approvalRequired: true, approvalSummary: "", notificationDecision: "notify",
    actionRequired: true, actionOwner: "changdongxu", nextAction: "审批扩容申请",
    priority: 1, urgencyLabel: "跟进", keyItem: false,
    titlePrefix: "【跟进】", title: "【跟进】审批扩容申请", tags: ["飞书", "跟进", "待批准"],
  }), /批准对象/);
});

test("accepts model-selected communication parameters but keeps approval realtime", () => {
  assert.doesNotThrow(() => validateTaskPresentation({
    created: false, taskAction: "updated", intakeDecision: "task", actionRequired: true,
    actionOwner: "changdongxu", nextAction: "查看整理结果", requestType: "execution", approvalRequired: false,
    notificationDecision: "notify", notificationMode: "digest", notificationDelayMinutes: 15,
    notificationTitle: "我帮你归拢好了", ownerMessage: "这件事我已经整理进原待办，晚点看就行。", cardTone: "grey",
    priority: 1, urgencyLabel: "跟进", keyItem: false,
    titlePrefix: "【跟进】", title: "【跟进】查看整理结果", tags: ["飞书", "跟进"],
  }));
  assert.throws(() => validateTaskPresentation({
    created: false, taskAction: "updated", requestType: "approval", approvalRequired: true,
    notificationDecision: "notify", notificationMode: "digest", notificationDelayMinutes: 10,
    notificationTitle: "需要决定", ownerMessage: "请确认。", cardTone: "yellow",
    priority: 1, urgencyLabel: "跟进", keyItem: false,
    titlePrefix: "【跟进】", title: "【跟进】确认方案", tags: ["飞书", "跟进", "待批准"],
  }), /必须即时通知/);
});

test("keeps the latest user reply when formatting a long context", () => {
  const messages = Array.from({ length: 40 }, (_, index) => ({
    message_id: `om_${index}`, create_time: `2026-08-22 10:${String(index).padStart(2, "0")}`,
    content: index === 39 ? "我已经批准并回复了" : `消息 ${index}`,
    sender: { id: index === 39 ? "ou_me" : "ou_other", name: index === 39 ? "常东旭" : "同事" },
  }));
  const formatted = formatContext(messages, "om_5", "ou_me");
  assert.match(formatted, /目标消息/);
  assert.match(formatted, /常东旭本人·当前最新.*我已经批准并回复了/);
});

test("allows non-actionable information to be ignored without a task id", () => {
  assert.doesNotThrow(() => validateTaskPresentation({
    taskId: "", created: false, taskAction: "ignored", notificationDecision: "silent",
    needsClarification: false, researchDecision: "skip", researchChannel: "none",
  }));
});

test("normalizes a safe no-op without an existing task to ignored", () => {
  const result = normalizeTaskResult({
    taskId: "", created: false, taskAction: "unchanged", notificationDecision: "silent",
    needsClarification: false, researchDecision: "skip", researchChannel: "none",
    materialChangeSummary: "", summary: "只是时间同步，不需要常东旭行动",
  });
  assert.equal(result.taskAction, "ignored");
});

test("rejects a schema-shaped result that admits the Dida operation did not run", () => {
  assert.throws(() => normalizeTaskResult({
    taskId: "", created: false, taskAction: "unchanged", notificationDecision: "silent",
    needsClarification: false, researchDecision: "skip", researchChannel: "none",
    materialChangeSummary: "", summary: "滴答 MCP OAuth 授权未完成，无法执行搜索和创建操作",
  }), /未实际完成/);
  assert.throws(() => normalizeTaskResult({
    taskId: "", created: false, taskAction: "ignored", notificationDecision: "silent",
    needsClarification: false, researchDecision: "skip", researchChannel: "none",
    materialChangeSummary: "", summary: "执行失败：dida365 MCP 服务器未连接到此会话，Bash 和 Read 权限均被拒绝",
  }), /未实际完成/);
});

test("does not mistake a business OAuth task for an MCP authorization failure", () => {
  const result = normalizeTaskResult({
    taskId: "task_1", created: false, taskAction: "unchanged", notificationDecision: "silent",
    needsClarification: false, researchDecision: "skip", researchChannel: "none",
    materialChangeSummary: "", summary: "等待客户实例添加 OAuth 认证后复核访问控制",
  });
  assert.equal(result.taskAction, "unchanged");
});

test("restores the mandatory BlackLake router without inventing a semantic skill", () => {
  const result = normalizeTaskResult({
    taskId: "task_1", created: false, taskAction: "updated", notificationDecision: "silent",
    needsClarification: false, researchDecision: "skip", researchChannel: "none",
    materialChangeSummary: "补充现状", summary: "已更新任务",
    blacklakeRelated: true, blacklakeDomains: ["发布管理"],
    recommendedSkills: ["virtual-employee-deployment-version"], skillDecisionReason: "涉及版本核验",
  });
  assert.deepEqual(result.recommendedSkills, ["blacklake-reference-router", "virtual-employee-deployment-version"]);
});

test("deletes a newly-created NOTE and normalizes a closed item to ignored", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fake-dida-note-"));
  const fakeDida = path.join(dir, "dida");
  const logPath = path.join(dir, "delete.log");
  await writeFile(fakeDida, `#!/bin/zsh
if [[ "$1" == "task" && "$2" == "get" ]]; then
  print -r -- '{"id":"note_1","projectId":"project_1","kind":"NOTE","status":0,"content":"事项已收敛，无需进一步行动"}'
  exit 0
fi
if [[ "$1" == "task" && "$2" == "delete" ]]; then
  print -r -- "$3:$4" >> "${logPath}"
  print '任务已删除'
  exit 0
fi
exit 2
`, { mode: 0o755 });
  const creator = new DidaTaskCreator({ didaCli: fakeDida, verifyCreatedTaskKind: true });
  const result = await creator.reconcileCreatedTaskKind({
    taskId: "note_1", projectId: "project_1", created: true, taskAction: "created",
    notificationDecision: "silent", materialChangeSummary: "新事项",
    summary: "最终确认维持现状，事项已收敛无需进一步行动。",
  });

  assert.equal(result.taskAction, "ignored");
  assert.equal(result.taskId, "");
  assert.equal(result.created, false);
  assert.match(await readFile(logPath, "utf8"), /project_1:note_1/);
});

test("deletes a newly-created TEXT task when its own summary says no action remains", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fake-dida-closed-text-"));
  const fakeDida = path.join(dir, "dida");
  const logPath = path.join(dir, "delete.log");
  await writeFile(fakeDida, `#!/bin/zsh
if [[ "$1" == "task" && "$2" == "get" ]]; then
  print -r -- '{"id":"text_1","projectId":"project_1","kind":"TEXT","status":0,"content":"最终确认维持现状"}'
  exit 0
fi
if [[ "$1" == "task" && "$2" == "delete" ]]; then
  print -r -- "$3:$4" >> "${logPath}"
  exit 0
fi
exit 2
`, { mode: 0o755 });
  const creator = new DidaTaskCreator({ didaCli: fakeDida, verifyCreatedTaskKind: true });
  const result = await creator.reconcileCreatedTaskKind({
    taskId: "text_1", projectId: "project_1", created: true, taskAction: "created",
    notificationDecision: "silent", materialChangeSummary: "新事项",
    summary: "事项已经收敛，无需继续跟进。",
  });

  assert.equal(result.taskAction, "ignored");
  assert.match(await readFile(logPath, "utf8"), /project_1:text_1/);
});

test("cleans only completed tasks returned from the target automation project", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fake-dida-cleanup-"));
  const fake = path.join(dir, "codex");
  await writeFile(fake, `#!/bin/zsh
out=""
while (( $# )); do
  if [[ "$1" == "-o" ]]; then shift; out="$1"; fi
  shift
done
cat >/dev/null
print -r -- '{"projectId":"project_1","cutoff":"2026-07-21T00:00:00.000Z","inspected":2,"deleted":[{"taskId":"old_1","title":"旧任务","completedAt":"2026-06-01T00:00:00Z"}],"skipped":[{"taskId":"new_1","reason":"未超过保留期"}],"summary":"删除 1 条"}' > "$out"
`, { mode: 0o755 });
  const creator = new DidaTaskCreator({
    codexCli: fake, workspaceRoot: dir, varDir: path.join(dir, "var"), didaProjectId: "project_1",
    didaCleanupSchemaPath: path.join(dir, "schema.json"), didaCompletedRetentionDays: 30,
    didaCompletedCleanupMaxPerRun: 50, didaExecutionTimeoutMs: 10000,
  });
  const result = await creator.cleanupCompletedTasks(new Date("2026-08-20T00:00:00Z"));
  assert.equal(result.deleted[0].taskId, "old_1");
  assert.equal(result.projectId, "project_1");
});
