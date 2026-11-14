export const variants = ['browse', 'search', 'empty', 'shared'] as const;
export type FileVariant = (typeof variants)[number];
