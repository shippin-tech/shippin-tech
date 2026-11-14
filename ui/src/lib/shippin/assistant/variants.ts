export const variants = ['panel', 'settings'] as const;
export type AssistantVariant = (typeof variants)[number];
