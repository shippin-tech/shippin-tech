export const variants = ['management', 'settings', 'account'] as const;
export type PortalVariant = (typeof variants)[number];
