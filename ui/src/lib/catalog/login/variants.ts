export const variants = ['password', 'device', 'otp'] as const;
export type LoginVariant = (typeof variants)[number];
