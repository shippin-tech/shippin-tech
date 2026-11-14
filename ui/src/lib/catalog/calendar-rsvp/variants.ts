export const variants = ['invitation', 'update', 'cancel', 'recorded'] as const;
export type RsvpVariant = (typeof variants)[number];
export const partStats = ['accepted', 'tentative', 'declined'] as const;
export type PartStat = (typeof partStats)[number];
