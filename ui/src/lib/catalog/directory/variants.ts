export const variants = ['empty', 'list', 'error'] as const;
export type DirectoryVariant = (typeof variants)[number];
