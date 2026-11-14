export const variants = ['list', 'editor'] as const;
export type DocVariant = (typeof variants)[number];
