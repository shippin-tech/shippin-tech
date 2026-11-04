export const variants = ['idle', 'loaded', 'error'] as const;
export type ScimVariant = (typeof variants)[number];
