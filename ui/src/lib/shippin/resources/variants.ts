export const variants = ['server', 'organisations'] as const;
export type ResourcesVariant = (typeof variants)[number];
