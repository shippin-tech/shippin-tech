# Brand

`brand.json` and `assets/` are the **shippin.tech baseline**. The UI, the landing page and the favicons are all generated from them. Don't edit generated files.

## Customising (forks and customers)

Put overrides in `brand/custom/`. Upstream never touches this folder, so your branding survives updates.

- `custom/brand.json` is deep-merged over `brand.json`. Set only the keys you want to change (`name`, `nameParts`, `domain`, `urls`, `colors`, ...).
- `custom/assets/<file>` replaces the baseline asset of the same name (`mark.svg`, `favicon.svg`, `favicon.ico`).

Then regenerate:

```
node scripts/brand-sync.mjs          # write generated files
node scripts/brand-sync.mjs --check  # fail if generated files are stale
```

Rules enforced: `nameParts` must join to `name`, colours are `#rrggbb`, SVGs must not contain scripts, event handlers, `javascript:` or `foreignObject`.

Commit the generated output. Docker and CI builds don't run the sync.
