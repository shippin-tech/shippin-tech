export const themes = ['system', 'harbor', 'kelp'] as const;
export type ThemeChoice = (typeof themes)[number];
