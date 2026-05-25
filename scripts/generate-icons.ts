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
  { name: "idle", color: "#E0B76E" },
  { name: "streaming", color: "#7DD3FC" },
  { name: "disconnected", color: "#7A756D" },
];

for (const variant of variants) {
  const traySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="14" fill="#171615"/>
    <path d="M43 14c-7-5-17-4-24 2-9 8-10 22-2 31 8 8 20 9 29 3l-8-9c-4 2-10 1-13-3-4-5-3-12 2-16 4-3 10-4 14-1l-5 7h16l1-16-10 2z" fill="${variant.color}"/>
    ${variant.name === "streaming" ? `<circle cx="50" cy="50" r="7" fill="#7DD3FC"/>` : ""}
  </svg>`;
  await sharp(Buffer.from(traySvg)).resize(24, 24).png().toFile(path.join(assets, `tray-${variant.name}.png`));
}
