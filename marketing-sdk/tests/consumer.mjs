/* global process, console */
// Candidate projection proves package contracts. --sha proves a separately published Git install.
import assert from "node:assert/strict";
import { mkdtemp, cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const creativeBrowser = process.argv.includes("--creative");
const connectionsBrowser = process.argv.includes("--connections") || creativeBrowser;
const sha = process.argv.slice(2).find(a => a !== "--connections" && a !== "--creative");
assert.ok(!sha || /^[a-f0-9]{40}$/.test(sha), "Supply a full public commit SHA or no argument for candidate projection");
const root = await mkdtemp(join(tmpdir(), "marketing-consumer-"));
const run = (bin, args) => execFileSync(bin, args, { cwd: root, stdio: "inherit", env: { ...process.env, NODE_ENV: "development" } });
try {
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "marketing-qualification-consumer", private: true, type: "module",
    dependencies: sha ? { "@handrail/marketing": `git+https://github.com/c0x65o/handrail-sdk-marketing-js.git#${sha}` } : pkg.dependencies,
    devDependencies: Object.fromEntries(["typescript", "@types/node", "@types/react", "@types/react-dom", "vite", ...(connectionsBrowser ? ["playwright"] : [])].filter(k => pkg.devDependencies[k]).map(k => [k, pkg.devDependencies[k]])),
  }, null, 2));
  run("npm", ["install", "--include=dev", "--no-audit", "--no-fund"]);
  const installed = join(root, "node_modules/@handrail/marketing");
  if (!sha) {
    // Inspect the actual packlist in an isolated consumer, without declaring a
    // tarball/file/workspace SDK dependency or pretending this is Git publication.
    // Keep prepare in the normal pack pipeline; suppress its stdout so npm's
    // JSON is parseable (pacote versions can run prepare despite ignore-scripts).
    const packed = JSON.parse(execFileSync("npm", ["pack", "--foreground-scripts=false", "--json", "--pack-destination", root],
      { cwd: process.cwd(), encoding: "utf8" }));
    assert.equal(packed.length, 1);
    assert.ok(packed[0].files.some(f => f.path === ".marketing-build/core/index.d.ts"));
    for (const path of ["marketing-sdk/react/style.css", ".marketing-build/react/style.css", "marketing-sdk/reference/dist/index.html", "marketing-sdk/reference/dist/THIRD_PARTY_NOTICES.txt"])
      assert.ok(packed[0].files.some(f => f.path === path), `Missing packaged asset ${path}`);
    await mkdir(installed, { recursive: true });
    execFileSync("tar", ["-xzf", join(root, packed[0].filename), "--strip-components=1", "-C", installed]);
    assert.equal(await readFile(join(installed, "marketing-sdk/react/style.css"), "utf8"), await readFile("marketing-sdk/react/style.css", "utf8"));
    assert.equal(await readFile(join(installed, ".marketing-build/react/style.css"), "utf8"), await readFile("marketing-sdk/react/style.css", "utf8"));
    const reference = await readFile(join(installed, "marketing-sdk/reference/dist/index.html"), "utf8");
    for (const [, asset] of reference.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g))
      assert.ok((await readFile(join(installed, "marketing-sdk/reference/dist", asset))).length, `Missing reference asset ${asset}`);
    console.log("Clean packed candidate projection:", packed[0].filename, packed[0].integrity);
  } else {
    const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
    const entry = lock.packages["node_modules/@handrail/marketing"];
    const https = `git+https://github.com/c0x65o/handrail-sdk-marketing-js.git#${sha}`;
    // npm 10's hosted-Git resolver canonicalizes even HTTPS inputs to SSH.
    // Keep the consumer lock on the explicitly requested public HTTPS transport,
    // then prove a clean install from that lock (no source overlay in this mode).
    assert.ok([https, `git+ssh://git@github.com/c0x65o/handrail-sdk-marketing-js.git#${sha}`].includes(entry.resolved));
    entry.resolved = https;
    await writeFile(join(root, "package-lock.json"), JSON.stringify(lock, null, 2) + "\n");
    run("npm", ["ci", "--include=dev", "--no-audit", "--no-fund"]);
    assert.equal(JSON.parse(await readFile(join(root, "package-lock.json"), "utf8")).packages["node_modules/@handrail/marketing"].resolved, https);
  }
  await cp(resolve("marketing-sdk/tests/consumer.ts.txt"), join(root, "consumer.ts"));
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    strict: true, skipLibCheck: false, noEmit: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext",
    types: ["node", "react"], lib: ["ES2022", "DOM"],
  }, files: ["consumer.ts"] }));
  run(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"]);
  await writeFile(join(root, "tsconfig.bundler.json"), JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { module: "ESNext", moduleResolution: "Bundler" } }));
  run(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.bundler.json"]);
  console.log("Strict NodeNext and Bundler consumer compilation passed");
  await writeFile(join(root, "imports.mjs"), `
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Store, MarketingServer } from '@handrail/marketing/server';
import { provision } from '@handrail/marketing/reference';
for (const path of ['', '/core', '/server', '/react', '/agent', '/reference', '/reference/host', '/reference/seed'])
  assert.ok(Object.keys(await import('@handrail/marketing' + path)).length);
assert.ok(readFileSync(new URL(import.meta.resolve('@handrail/marketing/react/style.css'))).length);
const metadata = createRequire(import.meta.url)('@handrail/marketing/package.json');
assert.equal(metadata.name, '@handrail/marketing');
console.log('Consumer package version:', metadata.version);
const store = new Store('./consumer.sqlite');
try {
  await provision(store, { projects: [{id: 'p', name: 'Consumer'}], users: [{username: 'test', password: '', memberships: [{projectId: 'p', role: 'admin'}]}], accountGrants: [], generationGrants: [] });
  const principal = await store.authenticate(await store.login('test', '', 'consumer'));
  const server = MarketingServer.unconnected(store);
  const draft = await server.call(principal, 'p', 'saveDraft', { requestKey: 'first', material: {name: 'Fresh consumer'} });
  assert.deepEqual((await server.call(principal, 'p', 'workspace', {})).drafts, [draft]);
  console.log('Consumer runtime imports and real SQLite draft round trip passed');
} finally { await store.close(); }
`);
  run(process.execPath, ["imports.mjs"]);
  await writeFile(join(root, "browser.js"), `export * from '@handrail/marketing/core'; export * from '@handrail/marketing/react'; import '@handrail/marketing/react/style.css';`);
  await writeFile(join(root, "unstyled.js"), `export * from '@handrail/marketing'; export * from '@handrail/marketing/core'; export * from '@handrail/marketing/react';`);
  await writeFile(join(root, "bundle.mjs"), `
import { build } from 'vite';
import assert from 'node:assert/strict';
for (const entry of ['./browser.js', './unstyled.js']) {
const result = await build({ logLevel: 'error', build: { write: false, lib: { entry, formats: ['es'] } } });
const outputs = (Array.isArray(result) ? result : [result]).flatMap(r => r.output);
const styles = outputs.filter(o => o.type === 'asset' && o.fileName.endsWith('.css'));
assert.equal(styles.length, entry === './browser.js' ? 1 : 0, 'CSS must be explicitly imported');
for (const style of styles) assert.ok(!/body\\s*\\{|:root\\s*\\{|#root/.test(String(style.source)), 'Reference resets leaked into optional CSS');
for (const output of outputs) if (output.type === 'chunk') {
  assert.ok(!Object.keys(output.modules).some(p => /marketing-build\\/(server|support|reference)|node_modules\\/(sharp|mysql2|pg|openai)\\//.test(p)), 'Server modules leaked into browser bundle');
  assert.ok(!output.code.includes('__vite-browser-external'), 'Node builtins leaked into browser bundle');
}
}
console.log('Core/React browser bundle excludes server modules');
`);
  run(process.execPath, ["bundle.mjs"]);
  if (connectionsBrowser) {
    await cp(resolve("marketing-sdk/examples/connections-server.ts"), join(root, "connections-server.ts"));
    await cp(resolve("marketing-sdk/examples/embedded.tsx"), join(root, "embedded.tsx"));
    await cp(resolve("marketing-sdk/examples/creative-server.ts"), join(root, "creative-server.ts"));
    await cp(resolve(creativeBrowser ? "marketing-sdk/tests/creative-consumer.mjs" : "marketing-sdk/tests/connections-consumer.mjs"), join(root, "connections-check.mjs"));
    await cp(resolve("marketing-sdk/tests/connection-network-guard.mjs"), join(root, "connection-network-guard.mjs"));
    await writeFile(join(root, "tsconfig.connections.json"), JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { noEmit: false, outDir: "compiled", jsx: "react-jsx" }, files: ["connections-server.ts", "creative-server.ts", "embedded.tsx"] }));
    run(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.connections.json"]);
    const artifacts = resolve(process.env.MARKETING_CONNECTION_ARTIFACTS || "artifacts/connections-review/browser");
    await mkdir(artifacts, { recursive: true });
    await cp(resolve(".marketing-build/source-manifest.json"), join(artifacts, "source-manifest.json"));
    run(process.execPath, ["connections-check.mjs", artifacts]);
  }
  console.log(sha ? `Qualified public Git install ${sha}` : "Qualified uncommitted candidate package projection; public Git publication remains separate");
} finally { await rm(root, { recursive: true, force: true }); }
