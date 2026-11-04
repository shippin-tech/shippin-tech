# tokens

Color, type, space, and motion live in this folder. A component does not invent a color.

Harbor is the light theme. Kelp is the dark theme. Neither is white or black. `color.css` holds both. `theme.json` names them and lists the pairs that must stay at WCAG AA (4.5:1).

To add or change a theme, edit `color.css` and `theme.json` together. Set `data-theme` on the document to `harbor` or `kelp`. Leave the attribute off to follow the system. The key in local storage is `shippin-theme`.

`prefers-reduced-motion` zeros the motion tokens. `prefers-contrast: more` strengthens border and muted text. Focus uses `--color-focus`.
