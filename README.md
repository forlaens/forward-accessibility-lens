# Forward Accessibility Lens

Forward Accessibility Lens is a Chrome side-panel extension for quick accessibility inspection while auditing pages.

## What It Does

- Shows headings, landmarks, images, ARIA labels, live regions, interactive items, and tables.
- Adds optional on-page visual overlays for structure checks.
- Provides a semantic linear view for reading-order inspection.
- Includes color contrast and text resize tools.
- Supports packaging and release helpers for the Chrome Web Store.

## Development

Install dependencies:

```sh
npm ci
```

Run the test suite:

```sh
npm test
```

Build the extension:

```sh
npm run build:extension
```

For a locally branded build:

```sh
npm run build:local
```

The production extension output is written to `dist/`.

## Chrome Web Store

Release helpers are documented in [CHROME_WEB_STORE_RELEASE.md](CHROME_WEB_STORE_RELEASE.md).

Keep `.env.chrome-webstore` local. Use `.env.chrome-webstore.example` as the template.
