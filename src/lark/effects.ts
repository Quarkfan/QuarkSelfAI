/** Stable Feishu capabilities consumed by workflows and implemented by the active channel owner. */
export const LARK_EFFECTS = {
  loadMessageContext: 'feishu.load-message-context.v1',
  sendAsUser: 'feishu.send-as-user.v1',
  resolveContact: 'feishu.resolve-contact.v1',
} as const
