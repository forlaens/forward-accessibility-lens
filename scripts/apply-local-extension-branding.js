import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "canvas";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const manifestPath = args.manifest ?? resolve(root, "dist/manifest.json");
const iconsDir = args.iconsDir ?? resolve(root, "dist/icons");
const iconSizes = [16, 32, 48, 128];

await mkdir(iconsDir, { recursive: true });

for (const size of iconSizes) {
  await writeLocalIcon(size);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const localIcons = Object.fromEntries(iconSizes.map((size) => [String(size), `icons/local-icon-${size}.png`]));

manifest.name = `${manifest.name} (Local)`;
manifest.action = {
  ...manifest.action,
  default_title: `${manifest.action?.default_title ?? manifest.name} (Local)`,
  default_icon: localIcons
};
manifest.icons = localIcons;

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

async function writeLocalIcon(size) {
  const source = await loadImage(resolve(root, `public/icons/icon-${size}.png`));
  const canvas = createCanvas(size, size);
  const context = canvas.getContext("2d");

  context.drawImage(source, 0, 0, size, size);

  const imageData = context.getImageData(0, 0, size, size);
  const data = imageData.data;

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];

    if (alpha === 0) {
      continue;
    }

    const luminance = (0.299 * data[index]) + (0.587 * data[index + 1]) + (0.114 * data[index + 2]);
    const value = luminance >= 92 ? 255 : 0;

    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
  }

  context.putImageData(imageData, 0, 0);
  drawLocalBadge(context, size);

  await writeFile(resolve(iconsDir, `local-icon-${size}.png`), canvas.toBuffer("image/png"));
}

function drawLocalBadge(context, size) {
  const badgeSize = Math.max(7, Math.round(size * 0.36));
  const badgeX = size - badgeSize;
  const badgeY = size - badgeSize;
  const fontSize = Math.max(6, Math.round(size * 0.28));

  context.fillStyle = "#ffffff";
  context.fillRect(badgeX, badgeY, badgeSize, badgeSize);
  context.strokeStyle = "#000000";
  context.lineWidth = Math.max(1, Math.round(size / 32));
  context.strokeRect(badgeX + 0.5, badgeY + 0.5, badgeSize - 1, badgeSize - 1);

  context.fillStyle = "#000000";
  context.font = `900 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("L", badgeX + (badgeSize / 2), badgeY + (badgeSize / 2) + Math.max(0, Math.round(size / 48)));
}

function parseArgs(values) {
  const parsed = {};

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const next = values[index + 1];

    if (value === "--manifest" && next) {
      parsed.manifest = resolve(next);
      index += 1;
    }

    if (value === "--icons-dir" && next) {
      parsed.iconsDir = resolve(next);
      index += 1;
    }
  }

  return parsed;
}
