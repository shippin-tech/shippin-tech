export const variants = ['invite', 'alarm'] as const;
export type CalendarTemplatesVariant = (typeof variants)[number];
