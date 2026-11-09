# Aurora Site

Responsive marketing site with real navigation, a filterable work grid, a
persisted theme and a validated contact form. Built in the LÉLU software
studio; every file here is generated source, not a screenshot.

## Run

```bash
node scripts/build.mjs     # writes dist/ and checks every referenced asset
node --test tests/         # 9 logic tests
```

## Structure

- `index.html` — semantic sections, skip link, native focus order.
- `styles.css` — responsive grid; mobile nav below 720px; reduced motion.
- `src/logic.js` — pure filter/validation/theme functions (tested).
- `src/site.js` — the DOM wiring that uses them.
- `scripts/build.mjs` — copies the shipping set, verifies references, writes `dist/build.json`.

## Limitations

- The contact form validates and confirms in the page; there is no mail
  server in this studio, so nothing is sent.
- No images: the gallery is typographic, so there is nothing to optimise.
