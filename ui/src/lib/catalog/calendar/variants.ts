export const variants = ['month', 'agenda', 'event', 'event-form'] as const;
export type CalendarVariant = (typeof variants)[number];
