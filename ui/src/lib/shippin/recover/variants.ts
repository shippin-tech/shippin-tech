export const variants = ['accounts', 'messages', 'empty'] as const;
export type RecoverVariant = (typeof variants)[number];
