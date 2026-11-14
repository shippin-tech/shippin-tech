export const variants = ['not-available', 'connect', 'browse'] as const;
export type GoogleVariant = (typeof variants)[number];
