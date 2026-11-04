export const variants = ['idle', 'empty', 'list', 'error'] as const;
export type DomainVariant = (typeof variants)[number];
