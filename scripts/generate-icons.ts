import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const root = process.cwd();
const assets = path.join(root, "assets");
const svg = path.join(assets, "icon.svg");
const sizes = [16, 24, 32, 48, 256];

await fs.mkdir(assets, { recursive: true });

for (const size of sizes) {
  await sharp(svg).resize(size, size).png().toFile(path.join(assets, `icon-${size}.png`));
}

await sharp(svg).resize(256, 256).png().toFile(path.join(assets, "icon.png"));
await fs.writeFile(path.join(assets, "icon.ico"), await pngToIco(sizes.map((size) => path.join(assets, `icon-${size}.png`))));

const variants = [
  { name: "idle", color: "#b5a1e0" },
  { name: "streaming", color: "#7DD3FC" },
  { name: "disconnected", color: "#7A756D" },
];

for (const variant of variants) {
  const traySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="16" fill="#292335"/>
    <path d="M17 31C5 15 19 9 26 24C28 3 42 7 39 25C54 9 63 22 45 33C62 35 55 53 40 46C34 62 16 54 21 41C6 50 3 34 17 31Z" fill="${variant.color}"/>
    <circle cx="33" cy="35" r="8" fill="#292335"/>
    ${variant.name === "streaming" ? `<circle cx="50" cy="50" r="7" fill="#7DD3FC"/>` : ""}
  </svg>`;
  await sharp(Buffer.from(traySvg)).resize(24, 24).png().toFile(path.join(assets, `tray-${variant.name}.png`));
}
