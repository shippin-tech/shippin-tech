export const variants = ['bar'] as const;
export type AgentVariant = (typeof variants)[number];
