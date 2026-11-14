export const variants = ['people', 'teams', 'person-form', 'team-detail'] as const;
export type PeopleVariant = (typeof variants)[number];
