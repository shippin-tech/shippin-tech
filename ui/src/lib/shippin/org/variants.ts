export const variants = ['portal', 'overview', 'people', 'teams', 'domains'] as const;
export type OrgVariant = (typeof variants)[number];
