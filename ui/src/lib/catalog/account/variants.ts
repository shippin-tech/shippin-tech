export const variants = ['idle', 'empty', 'list', 'error'] as const;
export type AccountVariant = (typeof variants)[number];
