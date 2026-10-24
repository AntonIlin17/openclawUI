// electron-builder 25's Windows resource tools bundle includes macOS symlinks.
// Extract only the relevant platforms so a normal Windows user can embed icons
// without granting symlink privileges or disabling executable resource editing.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
async function prepare() {
  if (process.platform !== "win32") return;
  const version = "winCodeSign-2.6.0";
  const cache =
    process.env.ELECTRON_BUILDER_CACHE ||
    path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
      "electron-builder",
      "Cache",
    );
  const root = path.join(cache, "winCodeSign"),
    target = path.join(root, version);
  if (
    fs.existsSync(path.join(target, "rcedit-x64.exe")) &&
    fs.existsSync(path.join(target, "windows-10", "x64", "signtool.exe"))
  )
    return;
  fs.mkdirSync(root, { recursive: true });
  const url = `https://github.com/electron-userland/electron-builder-binaries/releases/download/${version}/${version}.7z`;
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok)
    throw new Error(
      `Windows build tools download failed: HTTP ${response.status}`,
    );
  const data = Buffer.from(await response.arrayBuffer());
  const expected =
    "E8B408D9DF413C2DD7B346684D07B5A37B4F880DBC73BF8F63AF50F62FE90FC958E39A6C32D1EE2F0BF7BD1724895AF7671D5C6CDC8B94147C493C0275C1F0B4";
  if (
    createHash("sha512").update(data).digest("hex").toUpperCase() !== expected
  )
    throw new Error(
      "Windows build tools checksum did not match the pinned official artifact.",
    );
  const archive = path.join(root, version + ".7z");
  fs.writeFileSync(archive, data);
  execFileSync(
    require("7zip-bin").path7za,
    ["x", "-bd", "-y", "-xr!darwin", archive, `-o${target}`],
    { stdio: "inherit", windowsHide: true },
  );
  console.log("Windows executable resource tools are ready.");
}
prepare().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
