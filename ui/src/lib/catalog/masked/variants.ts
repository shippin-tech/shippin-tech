export const variants = ['list', 'empty'] as const;
export type MaskedVariant = (typeof variants)[number];
