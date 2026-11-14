# tokens

Color, type, space, and motion live in this folder. A component does not invent a color, a font size, or a space.

`viewport.ts` is the only viewport: 320 to 1240. `scripts/emit-fluid.ts` runs `utopia-core` and writes `fluid.css`. `--x-*` clamps on the inline axis (`vi`). `--y-*` clamps on the block axis (`vb`). `--step-*` is the type scale. `--img-s`, `--img-m`, and `--img-l` are the image slots. `--measure` and `--aside` are the grid minimums. `--space-1` through `--space-4` alias the inline steps.

Columns wrap with `repeat(auto-fit, minmax(min(100%, var(--measure)), 1fr))`. There is no width breakpoint.

Each brand color is declared once in `color.css`. Light and dark are `light-dark()`. `color-scheme` follows the system unless `data-theme` is `light` or `dark`. Primary is `--green` (`#39ff14`). Gold is `--gold` (`#ffb000`). Cyber pink is `--pink` (`#ff2bd6`). Body text on the light page uses the deep shades.

`tokens.ts` is the typed list of color variable names. `ThemeChoice` is `system | light | dark`.

`prefers-reduced-motion` zeros the motion tokens. `prefers-contrast: more` sets muted text and the border to the foreground. Focus uses `--ring`. Those are preferences, not viewport breakpoints.
