import test from "node:test";
import assert from "node:assert/strict";
import { isPathContained, resolveReferencedWslPaths, windowsPathToWslSafe } from "../src/main/path-security.js";

test("Windows paths convert to WSL paths without invoking a shell", () => {
  assert.equal(windowsPathToWslSafe("C:\\Projects\\OpenClaw Desktop\\README.md"), "/mnt/c/Projects/OpenClaw Desktop/README.md");
  assert.throws(() => windowsPathToWslSafe("relative\\file.txt"), /absolute Windows drive paths/);
});

test("path containment rejects prefix tricks and traversal", () => {
  const roots = ["C:\\Projects\\openclawUI"];
  assert.equal(isPathContained("C:\\Projects\\openclawUI\\src\\main.ts", roots), true);
  assert.equal(isPathContained("C:\\Projects\\openclawUI-evil\\secret.txt", roots), false);
  assert.equal(isPathContained("C:\\Projects\\openclawUI\\..\\other\\secret.txt", roots), false);
});

test("referenced path detection only returns configured roots", () => {
  const roots = ["C:\\Projects\\openclawUI", "D:\\Portfolio\\Media"];
  assert.deepEqual(resolveReferencedWslPaths("Review the openclawUI source", roots), ["/mnt/c/Projects/openclawUI"]);
  assert.deepEqual(resolveReferencedWslPaths("Nothing local is mentioned", roots), []);
});
