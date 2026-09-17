// Uploads a zip to an existing Chrome Web Store item and submits it for review.
// Usage: node scripts/publish-chrome.mjs dist/github-easy-stack.zip
//
// Environment:
//   CWS_SERVICE_ACCOUNT_JSON  JSON key of the service account added in the developer dashboard
//   CWS_PUBLISHER_ID          publisher ID from the developer dashboard
//   CWS_EXTENSION_ID          item ID of the extension

import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

const API = "https://chromewebstore.googleapis.com";
const SCOPE = "https://www.googleapis.com/auth/chromewebstore";

const zipPath = process.argv[2];
const { CWS_SERVICE_ACCOUNT_JSON, CWS_PUBLISHER_ID, CWS_EXTENSION_ID } = process.env;

if (!zipPath || !CWS_SERVICE_ACCOUNT_JSON || !CWS_PUBLISHER_ID || !CWS_EXTENSION_ID) {
  console.error(
    "Usage: node scripts/publish-chrome.mjs <zip>, with CWS_SERVICE_ACCOUNT_JSON, CWS_PUBLISHER_ID and CWS_EXTENSION_ID set.",
  );
  process.exit(1);
}

const item = `publishers/${CWS_PUBLISHER_ID}/items/${CWS_EXTENSION_ID}`;

async function request(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${url} failed with ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

// Exchanges a JWT signed with the service account key for an access token.
async function accessToken() {
  const key = JSON.parse(CWS_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: key.client_email,
    scope: SCOPE,
    aud: key.token_uri ?? "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(key.private_key, "base64url");

  const { access_token } = await request(key.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  return access_token;
}

const token = await accessToken();
const auth = { Authorization: `Bearer ${token}` };

const upload = await request(`${API}/upload/v2/${item}:upload`, {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/zip" },
  body: readFileSync(zipPath),
});
let uploadState = upload.uploadState;
console.log(`Upload: ${uploadState}${upload.crxVersion ? ` (version ${upload.crxVersion})` : ""}`);

// Large packages are processed asynchronously.
for (let attempt = 0; uploadState === "IN_PROGRESS" && attempt < 30; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  ({ lastAsyncUploadState: uploadState } = await request(`${API}/v2/${item}:fetchStatus`, { headers: auth }));
  console.log(`Upload: ${uploadState}`);
}

if (uploadState !== "SUCCEEDED") {
  console.error(`Upload did not succeed: ${JSON.stringify(upload)}`);
  process.exit(1);
}

const published = await request(`${API}/v2/${item}:publish`, {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({}),
});
console.log(`Publish: ${published.state}`);
if (published.warningInfo) console.log(`Warnings: ${JSON.stringify(published.warningInfo)}`);

if (["REJECTED", "CANCELLED"].includes(published.state)) process.exit(1);
