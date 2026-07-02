import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSign } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env.chrome-webstore");
const apiBase = "https://chromewebstore.googleapis.com";
const tokenUrl = "https://oauth2.googleapis.com/token";
const scope = "https://www.googleapis.com/auth/chromewebstore";

loadEnvFile(envPath);

const command = process.argv[2] || "help";

try {
  switch (command) {
    case "status":
      printJson(await fetchStatus());
      break;
    case "upload":
      printJson(await uploadPackage());
      break;
    case "publish":
      printJson(await publishItem());
      break;
    case "release":
      await release();
      break;
    default:
      printHelp();
      process.exit(command === "help" ? 0 : 1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

async function release() {
  const uploadResult = await uploadPackage();
  printJson(uploadResult);
  await waitForUploadIfNeeded(uploadResult.uploadState);
  const publishResult = await publishItem();
  printJson(publishResult);
}

async function uploadPackage() {
  const { itemName, zipPath } = await getConfig();
  const zip = await readFile(zipPath);
  const response = await request(`${apiBase}/upload/v2/${itemName}:upload`, {
    method: "POST",
    body: zip,
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(zip.byteLength)
    }
  });

  const state = response.uploadState;
  if (state && state !== "SUCCEEDED" && state !== "IN_PROGRESS") {
    throw new Error(`Chrome Web Store upload did not succeed. Upload state: ${state}\n${JSON.stringify(response, null, 2)}`);
  }

  return response;
}

async function publishItem() {
  const { itemName } = await getConfig();
  return request(`${apiBase}/v2/${itemName}:publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(getPublishBody())
  });
}

async function fetchStatus() {
  const { itemName } = await getConfig();
  return request(`${apiBase}/v2/${itemName}:fetchStatus`, { method: "GET" });
}

async function waitForUploadIfNeeded(uploadState) {
  if (uploadState !== "IN_PROGRESS") {
    return;
  }

  const attempts = Number(process.env.CHROME_WEBSTORE_UPLOAD_POLL_ATTEMPTS || 12);
  const intervalMs = Number(process.env.CHROME_WEBSTORE_UPLOAD_POLL_INTERVAL_MS || 5000);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));

    const status = await fetchStatus();
    const state = status.lastAsyncUploadState;
    console.log(`Upload processing state ${attempt}/${attempts}: ${state || "unknown"}`);

    if (state === "SUCCEEDED") {
      return;
    }

    if (state === "FAILED") {
      throw new Error(`Chrome Web Store upload failed.\n${JSON.stringify(status, null, 2)}`);
    }
  }

  throw new Error("Chrome Web Store upload is still processing. Run npm run webstore:status before publishing.");
}

async function request(url, options) {
  const token = await getAccessToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const body = parseJson(text);

  if (!response.ok) {
    throw new Error(`Chrome Web Store API request failed (${response.status} ${response.statusText}).\n${JSON.stringify(body ?? text, null, 2)}`);
  }

  return body ?? {};
}

async function getAccessToken() {
  const { clientId, clientSecret, refreshToken, serviceAccountKeyFile } = await getConfig();

  if (serviceAccountKeyFile) {
    return getServiceAccountAccessToken(serviceAccountKeyFile);
  }

  return getOAuthAccessToken(clientId, clientSecret, refreshToken);
}

async function getOAuthAccessToken(clientId, clientSecret, refreshToken) {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });

  const text = await response.text();
  const body = parseJson(text);

  if (!response.ok) {
    throw new Error(`Could not refresh Chrome Web Store access token (${response.status} ${response.statusText}).\n${JSON.stringify(body ?? text, null, 2)}`);
  }

  if (body?.scope && !body.scope.split(/\s+/).includes(scope)) {
    throw new Error(`Refresh token does not include the required Chrome Web Store scope: ${scope}`);
  }

  if (!body?.access_token) {
    throw new Error(`OAuth response did not include an access token.\n${JSON.stringify(body, null, 2)}`);
  }

  return body.access_token;
}

async function getServiceAccountAccessToken(keyFile) {
  const credentials = JSON.parse(await readFile(keyFile, "utf8"));
  const email = credentials.client_email;
  const privateKey = credentials.private_key;
  const audience = credentials.token_uri || tokenUrl;

  if (!email || !privateKey) {
    throw new Error(`Service account key file is missing client_email or private_key: ${keyFile}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: email,
    scope,
    aud: audience,
    iat: now,
    exp: now + 3600
  };
  const unsignedJwt = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = createSign("RSA-SHA256").update(unsignedJwt).sign(privateKey, "base64url");
  const assertion = `${unsignedJwt}.${signature}`;

  const response = await fetch(audience, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  const text = await response.text();
  const body = parseJson(text);

  if (!response.ok) {
    throw new Error(`Could not create Chrome Web Store access token from service account (${response.status} ${response.statusText}).\n${JSON.stringify(body ?? text, null, 2)}`);
  }

  if (!body?.access_token) {
    throw new Error(`Service account OAuth response did not include an access token.\n${JSON.stringify(body, null, 2)}`);
  }

  return body.access_token;
}

async function getConfig() {
  const missing = [];
  const publisherId = requireEnv("CHROME_WEBSTORE_PUBLISHER_ID", missing);
  const extensionId = requireEnv("CHROME_WEBSTORE_EXTENSION_ID", missing);
  const clientId = process.env.CHROME_WEBSTORE_CLIENT_ID?.trim();
  const clientSecret = process.env.CHROME_WEBSTORE_CLIENT_SECRET?.trim();
  const refreshToken = process.env.CHROME_WEBSTORE_REFRESH_TOKEN?.trim();
  const serviceAccountKeyFile = process.env.CHROME_WEBSTORE_SERVICE_ACCOUNT_KEY_FILE?.trim();

  if (missing.length > 0) {
    throw new Error(`Missing Chrome Web Store settings: ${missing.join(", ")}. Copy .env.chrome-webstore.example to .env.chrome-webstore and fill it in.`);
  }

  const serviceAccountKeyPath = serviceAccountKeyFile ? resolve(root, serviceAccountKeyFile) : "";
  const hasServiceAccount = Boolean(serviceAccountKeyPath);
  const hasOAuth = Boolean(clientId && clientSecret && refreshToken);

  if (!hasServiceAccount && !hasOAuth) {
    throw new Error("Missing Chrome Web Store authentication. Provide either CHROME_WEBSTORE_SERVICE_ACCOUNT_KEY_FILE or CHROME_WEBSTORE_CLIENT_ID, CHROME_WEBSTORE_CLIENT_SECRET, and CHROME_WEBSTORE_REFRESH_TOKEN.");
  }

  if (hasServiceAccount && !existsSync(serviceAccountKeyPath)) {
    throw new Error(`Chrome Web Store service account key file was not found: ${serviceAccountKeyPath}`);
  }

  const zipPath = resolve(root, process.env.CHROME_WEBSTORE_ZIP || await getDefaultZipName());
  if ((command === "upload" || command === "release") && !existsSync(zipPath)) {
    throw new Error(`Chrome Web Store zip was not found: ${zipPath}. Run npm run webstore:package first.`);
  }

  return {
    itemName: `publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(extensionId)}`,
    zipPath,
    clientId,
    clientSecret,
    refreshToken,
    serviceAccountKeyFile: serviceAccountKeyPath
  };
}

async function getDefaultZipName() {
  const manifestPath = existsSync(resolve(root, "dist", "manifest.json"))
    ? resolve(root, "dist", "manifest.json")
    : resolve(root, "public", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  return `forward-accessibility-lens-${manifest.version}-chrome-web-store.zip`;
}

function getPublishBody() {
  const body = {};
  const publishType = process.env.CHROME_WEBSTORE_PUBLISH_TYPE?.trim();
  const skipReview = parseBoolean(process.env.CHROME_WEBSTORE_SKIP_REVIEW);
  const deployPercentage = parseNumber(process.env.CHROME_WEBSTORE_DEPLOY_PERCENTAGE);

  if (publishType) {
    body.publishType = publishType;
  }

  if (skipReview !== undefined) {
    body.skipReview = skipReview;
  }

  if (deployPercentage !== undefined) {
    if (deployPercentage < 0 || deployPercentage > 100) {
      throw new Error("CHROME_WEBSTORE_DEPLOY_PERCENTAGE must be between 0 and 100.");
    }

    body.deployInfos = [{ deployPercentage }];
  }

  return body;
}

function loadEnvFile(path) {
  if (!existsSync(path)) {
    return;
  }

  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = unquote(trimmed.slice(equalsIndex + 1).trim());

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function requireEnv(name, missing) {
  const value = process.env[name]?.trim();
  if (!value) {
    missing.push(name);
    return "";
  }

  return value;
}

function parseJson(text) {
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function parseBoolean(value) {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  if (/^(1|true|yes)$/i.test(value)) {
    return true;
  }

  if (/^(0|false|no)$/i.test(value)) {
    return false;
  }

  throw new Error("CHROME_WEBSTORE_SKIP_REVIEW must be true or false.");
}

function parseNumber(value) {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const number = Number(value);
  if (!Number.isInteger(number)) {
    throw new Error("CHROME_WEBSTORE_DEPLOY_PERCENTAGE must be an integer.");
  }

  return number;
}

function unquote(value) {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printHelp() {
  console.log(`Chrome Web Store release helper

Commands:
  status   Fetch current Chrome Web Store item status
  upload   Upload the packaged extension zip
  publish  Submit the uploaded package for publishing
  release  Upload, wait for processing when needed, then publish

Required settings:
  CHROME_WEBSTORE_EXTENSION_ID
  CHROME_WEBSTORE_PUBLISHER_ID
  CHROME_WEBSTORE_CLIENT_ID
  CHROME_WEBSTORE_CLIENT_SECRET
  CHROME_WEBSTORE_REFRESH_TOKEN

Copy .env.chrome-webstore.example to .env.chrome-webstore to use local settings.`);
}
