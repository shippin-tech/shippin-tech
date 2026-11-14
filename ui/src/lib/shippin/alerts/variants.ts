export const variants = ['list', 'form', 'empty'] as const;
export type AlertsVariant = (typeof variants)[number];
