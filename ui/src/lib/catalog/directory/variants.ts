export const variants = ['idle', 'empty', 'list', 'error'] as const;
export type DirectoryVariant = (typeof variants)[number];
