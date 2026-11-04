export const variants = ['empty', 'list', 'error'] as const;
export type DomainVariant = (typeof variants)[number];
