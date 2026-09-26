/* global console */
import { readdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function walk(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "dist") return [];
    const child = `${path}/${entry.name}`;
    return entry.isDirectory() ? walk(child) : [child];
  });
}
const files = [
  "package.json",
  "package-lock.json",
  ...walk("marketing-sdk"),
  "README.md", "RIGHTS.md", "THIRD_PARTY_NOTICES.md",
]
  .sort()
  .map((path) => ({ path, sha256: sha(readFileSync(path)) }));
const digest = sha(JSON.stringify(files));
writeFileSync(
  ".marketing-build/source-manifest.json",
  JSON.stringify({ digest, files }, null, 2) + "\n",
);
console.log(`Marketing build source SHA-256: ${digest}`);

copyFileSync("marketing-sdk/react/style.css", ".marketing-build/react/style.css");
copyFileSync("THIRD_PARTY_NOTICES.md", "marketing-sdk/reference/dist/THIRD_PARTY_NOTICES.txt");
