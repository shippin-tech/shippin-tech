export const variants = ['ai', 'sso', 'scim', 'app-password', 'setup'] as const;
export type KeysVariant = (typeof variants)[number];
