export const variants = ['management', 'settings', 'account', 'first-run'] as const;
export type PortalVariant = (typeof variants)[number];
