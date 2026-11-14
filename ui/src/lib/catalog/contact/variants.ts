export const variants = ['list', 'detail', 'form'] as const;
export type ContactVariant = (typeof variants)[number];
