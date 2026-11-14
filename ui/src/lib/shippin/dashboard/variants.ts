export const variants = ['overview', 'network', 'security', 'delivery', 'performance', 'storage', 'all-metrics'] as const;
export type DashboardVariant = (typeof variants)[number];
