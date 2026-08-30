# Chrome Web Store release

This project uses the Chrome Web Store API V2 for a repeatable release flow.

## One-time setup

### Option A: Service account

This is the most automation-friendly setup.

1. Enable the Chrome Web Store API in a Google Cloud project.
2. Create a service account in Google Cloud.
3. Copy the service account email.
4. Add that email in Chrome Web Store Developer Dashboard > Account > Service account.
5. Create a JSON key for the service account.
6. Copy `.env.chrome-webstore.example` to `.env.chrome-webstore`.
7. Fill in:

```sh
CHROME_WEBSTORE_EXTENSION_ID=eddnebfaphoibcpcnpiokjjcgnecfgpb
CHROME_WEBSTORE_PUBLISHER_ID=...
CHROME_WEBSTORE_SERVICE_ACCOUNT_KEY_FILE=/absolute/path/to/service-account-key.json
```

### Option B: OAuth refresh token

1. Enable the Chrome Web Store API in a Google Cloud project.
2. Create an OAuth consent screen.
3. Create an OAuth client and allow `https://developers.google.com/oauthplayground` as a redirect URI.
4. Use OAuth Playground with the `https://www.googleapis.com/auth/chromewebstore` scope to create a refresh token.
5. Find the Publisher ID in Chrome Web Store Developer Dashboard > Publisher > Settings.
6. Copy `.env.chrome-webstore.example` to `.env.chrome-webstore` and fill in the values.

The extension ID is already filled in as `eddnebfaphoibcpcnpiokjjcgnecfgpb`.

## Commands

```sh
npm run webstore:package
npm run webstore:status
npm run webstore:upload
npm run webstore:publish
npm run webstore:release
```

`webstore:release` runs the full package check, creates a Chrome Web Store zip, uploads it, waits if Chrome is still processing the upload, and then submits it for publishing.

## Optional settings

```sh
CHROME_WEBSTORE_ZIP=forward-accessibility-lens-1.0.9-chrome-web-store.zip
CHROME_WEBSTORE_PUBLISH_TYPE=DEFAULT_PUBLISH
CHROME_WEBSTORE_SKIP_REVIEW=false
CHROME_WEBSTORE_DEPLOY_PERCENTAGE=100
```

Use `CHROME_WEBSTORE_PUBLISH_TYPE=STAGED_PUBLISH` if the update should be staged after approval instead of automatically going live after review.

## Limits

The API can upload a new package, submit it for review, check status, cancel a submission, and adjust rollout percentage. It cannot replace all dashboard work:

- First-time listing and privacy fields still need the Developer Dashboard.
- Visibility changes need manual confirmation in the Developer Dashboard before API publishing can be used again.
- Store listing text and screenshots are not updated by this release script.
