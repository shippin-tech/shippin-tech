export const variants = ['account', 'password', 'device', 'otp'] as const;
export type LoginVariant = (typeof variants)[number];
