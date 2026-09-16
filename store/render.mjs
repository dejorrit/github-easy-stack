// Renders the assets in store/assets.html to PNG.
// Usage: npm install --no-save playwright-core && node store/render.mjs
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import path from "node:path";

const storeDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(storeDir);

const assets = [
  ["icon-16", "icons/icon-16.png"],
  ["icon-32", "icons/icon-32.png"],
  ["icon-48", "icons/icon-48.png"],
  ["icon-128", "icons/icon-128.png"],
  ["screenshot-1-stacks", "store/screenshot-1-stacks.png"],
  ["screenshot-2-progress", "store/screenshot-2-progress.png"],
  ["screenshot-3-fold", "store/screenshot-3-fold.png"],
  ["promo-tile-440x280", "store/promo-tile-440x280.png"],
  ["marquee-1400x560", "store/marquee-1400x560.png"],
];

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 5000, height: 2000 } });
await page.goto("file://" + path.join(storeDir, "assets.html"));
// Transparent page so the icons keep their rounded corners.
await page.addStyleTag({ content: "body { background: transparent !important; }" });

for (const [id, out] of assets) {
  await page.locator("#" + id).screenshot({ path: path.join(rootDir, out), omitBackground: true });
  console.log(out);
}

await browser.close();
