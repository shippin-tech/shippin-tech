export const themes = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof themes)[number];
