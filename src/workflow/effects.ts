/** Stable effect kinds implemented by infrastructure adapters, never by feature workflows. */
export const ASSISTANT_EFFECTS = {
  notifyOwner: 'assistant.notify-owner.v1',
  requestInteraction: 'assistant.request-interaction.v1',
} as const
