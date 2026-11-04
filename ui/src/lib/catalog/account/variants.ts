export const variants = ['empty', 'list', 'error'] as const;
export type AccountVariant = (typeof variants)[number];
