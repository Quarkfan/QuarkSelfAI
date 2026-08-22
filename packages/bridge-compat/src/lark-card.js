const TONES = {
  blue: { template: "blue", background: "blue-50", border: "blue-100", tag: "blue" },
  green: { template: "green", background: "green-50", border: "green-100", tag: "green" },
  yellow: { template: "yellow", background: "yellow-50", border: "yellow-100", tag: "yellow" },
  red: { template: "red", background: "red-50", border: "red-100", tag: "red" },
  grey: { template: "grey", background: "grey-50", border: "grey-100", tag: "neutral" },
};

function stripMarkdown(value) {
  return String(value ?? "")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/[>*_`#~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function detectPresentation(markdown, options = {}) {
  const text = stripMarkdown(markdown);
  if (options.title || options.tone) {
    return { title: options.title || text.slice(0, 42) || "Codex 助手", tone: options.tone || "blue" };
  }
  if (/(失败|异常|中断|错误|超期)/.test(text)) return { title: "需要关注", tone: "red" };
  if (/(已恢复|处理完成|执行成功|已创建|已归档|已取消|已确认)/.test(text)) return { title: "处理完成", tone: "green" };
  if (/(确认|选择|补充|待办|跟进|提醒|排队)/.test(text)) return { title: "等待处理", tone: "yellow" };
  if (/(执行|调研|创建|进度|送达)/.test(text)) return { title: "处理进展", tone: "blue" };
  return { title: "Codex 助手", tone: "blue" };
}

function baseCard(markdown, options = {}) {
  const presentation = detectPresentation(markdown, options);
  const tone = TONES[presentation.tone] || TONES.blue;
  const status = options.status || (options.interactive ? "待操作" : "通知");
  const summary = stripMarkdown(markdown).slice(0, 100) || presentation.title;
  return {
    card: {
      schema: "2.0",
      config: {
        update_multi: true,
        width_mode: "default",
        summary: { content: summary },
      },
      header: {
        title: { tag: "plain_text", content: presentation.title },
        subtitle: { tag: "plain_text", content: options.subtitle || "Codex 自动化" },
        template: tone.template,
        icon: { tag: "standard_icon", token: "ai-common_colorful" },
        text_tag_list: [{
          tag: "text_tag",
          text: { tag: "plain_text", content: status },
          color: options.statusColor || tone.tag,
        }],
      },
      body: {
        direction: "vertical",
        padding: "12px 12px 20px 12px",
        vertical_spacing: "12px",
        elements: [{
          tag: "column_set",
          flex_mode: "none",
          columns: [{
            tag: "column",
            width: "weighted",
            weight: 1,
            background_style: tone.background,
            padding: "12px",
            vertical_spacing: "4px",
            elements: [{ tag: "markdown", content: markdown || "已收到。" }],
          }],
        }],
      },
    },
    tone,
  };
}

function footer() {
  return {
    tag: "div",
    text: {
      tag: "plain_text",
      content: "由 Codex 自动化助手发送",
      text_size: "notation",
      text_color: "grey",
      lines: 1,
    },
  };
}

export function buildNotificationCard(markdown, options = {}) {
  const { card } = baseCard(markdown, options);
  card.body.elements.push(footer());
  return card;
}

export function buildActionCard(markdown, actions, options = {}) {
  const { card } = baseCard(markdown, { ...options, interactive: true });
  card.body.elements.push({
    tag: "column_set",
    flex_mode: "flow",
    horizontal_spacing: "8px",
    columns: actions.map((action, index) => ({
      tag: "column",
      width: "auto",
      elements: [{
        tag: "button",
        text: { tag: "plain_text", content: action.text },
        type: action.danger ? "danger" : index === 0 ? "primary_filled" : "default",
        behaviors: action.url
          ? [{ type: "open_url", default_url: action.url }]
          : [{ type: "callback", value: action.value }],
        ...(action.confirm ? { confirm: action.confirm } : {}),
      }],
    })),
  });
  card.body.elements.push(footer());
  return card;
}

export function buildSelectionCard(markdown, choices, options = {}) {
  const { card } = baseCard(markdown, { ...options, interactive: true });
  card.body.elements.push({
    tag: "select_static",
    name: "session_choice",
    width: "fill",
    placeholder: { tag: "plain_text", content: "选择目标 Codex 会话" },
    options: choices.map((choice) => ({
      text: { tag: "plain_text", content: choice.text.slice(0, 100) },
      value: choice.value,
    })),
  });
  card.body.elements.push(footer());
  return card;
}

export function buildInputCard(markdown, options = {}) {
  const { card } = baseCard(markdown, { ...options, interactive: true });
  card.body.elements.push({
    tag: "form",
    name: options.formName || "prompt_form",
    vertical_spacing: "12px",
    elements: [{
      tag: "input",
      name: "prompt",
      required: true,
      input_type: "multiline_text",
      rows: 3,
      max_length: 1000,
      width: "fill",
      label: { tag: "plain_text", content: options.label || "补充你的要求" },
      placeholder: { tag: "plain_text", content: options.placeholder || "直接描述目标，我会自动转换为指令" },
    }, {
      tag: "button",
      name: options.submitName || "prompt_submit",
      text: { tag: "plain_text", content: options.submitText || "提交" },
      type: "primary_filled",
      width: "fill",
      form_action_type: "submit",
    }],
  });
  card.body.elements.push(footer());
  return card;
}
