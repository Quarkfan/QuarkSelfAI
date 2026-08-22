import test from "node:test";
import assert from "node:assert/strict";
import { buildActionCard, buildInputCard, buildNotificationCard, buildSelectionCard } from "../src/lark-card.js";

test("notification card has Card 2.0 hierarchy and structured body", () => {
  const card = buildNotificationCard("**任务完成**\n\n结果已保存。");
  assert.equal(card.schema, "2.0");
  assert.ok(card.header.icon);
  assert.equal(card.body.elements[0].tag, "column_set");
  assert.equal(card.body.elements.at(-1).tag, "div");
});

test("action card uses callback buttons with one primary action", () => {
  const card = buildActionCard("是否开始？", [
    { text: "开始", value: { type: "start" } },
    { text: "取消", value: { type: "cancel" } },
  ]);
  const buttons = card.body.elements[1].columns.map((column) => column.elements[0]);
  assert.equal(buttons[0].type, "primary_filled");
  assert.equal(buttons[1].type, "default");
  assert.equal(buttons[0].behaviors[0].type, "callback");
});

test("approval action card can include a free-form response input", () => {
  const card = buildActionCard("策略待确认", [{ text: "确认", value: { type: "approve" } }], { includeInput: true });
  const form = card.body.elements.find((element) => element.tag === "form");
  assert.equal(form.elements[0].name, "prompt");
  assert.equal(form.elements[1].form_action_type, "submit");
});

test("action card can expose a pure navigation button", () => {
  const card = buildActionCard("请打开配置", [{ text: "打开", url: "https://example.com/setup" }]);
  const behavior = card.body.elements[1].columns[0].elements[0].behaviors[0];
  assert.deepEqual(behavior, { type: "open_url", default_url: "https://example.com/setup" });
});

test("input and selection cards expose native interactive controls", () => {
  const input = buildInputCard("请补充", { submitName: "prompt_create" });
  assert.equal(input.body.elements[1].tag, "form");
  assert.equal(input.body.elements[1].elements[1].name, "prompt_create");
  const selection = buildSelectionCard("请选择", [{ text: "会话 A", value: "session-a" }]);
  assert.equal(selection.body.elements[1].tag, "select_static");
  assert.equal(selection.body.elements[1].options[0].value, "session-a");
});
