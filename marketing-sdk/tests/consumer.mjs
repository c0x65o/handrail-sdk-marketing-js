/* global process, console */
// Candidate projection proves package contracts. --sha proves a separately published Git install.
import assert from "node:assert/strict";
import { mkdtemp, cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const sha = process.argv[2];
assert.ok(!sha || /^[a-f0-9]{40}$/.test(sha), "Supply a full public commit SHA or no argument for candidate projection");
const root = await mkdtemp(join(tmpdir(), "marketing-consumer-"));
const run = (bin, args) => execFileSync(bin, args, { cwd: root, stdio: "inherit", env: { ...process.env, NODE_ENV: "development" } });
try {
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "marketing-qualification-consumer", private: true, type: "module",
    dependencies: sha ? { "@handrail/marketing": `git+https://github.com/c0x65o/handrail-sdk-marketing-js.git#${sha}` } : pkg.dependencies,
    devDependencies: Object.fromEntries(["typescript", "@types/node", "@types/react", "vite"].map(k => [k, pkg.devDependencies[k]])),
  }, null, 2));
  run("npm", ["install", "--include=dev", "--no-audit", "--no-fund"]);
  const installed = join(root, "node_modules/@handrail/marketing");
  if (!sha) {
    // No file/workspace dependency or fake Git publication: project the candidate's package files.
    await mkdir(installed, { recursive: true });
    for (const file of ["package.json", ...pkg.files])
      await cp(resolve(file), join(installed, file), { recursive: true });
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
  await writeFile(join(root, "bundle.mjs"), `
import { build } from 'vite';
import assert from 'node:assert/strict';
const result = await build({ logLevel: 'error', build: { write: false, lib: { entry: './browser.js', formats: ['es'] } } });
const outputs = (Array.isArray(result) ? result : [result]).flatMap(r => r.output);
for (const output of outputs) if (output.type === 'chunk') {
  assert.ok(!Object.keys(output.modules).some(p => /marketing-build\\/(server|support|reference)|node_modules\\/(sharp|mysql2|pg|openai)\\//.test(p)), 'Server modules leaked into browser bundle');
  assert.ok(!output.code.includes('__vite-browser-external'), 'Node builtins leaked into browser bundle');
}
console.log('Core/React browser bundle excludes server modules');
`);
  run(process.execPath, ["bundle.mjs"]);
  console.log(sha ? `Qualified public Git install ${sha}` : "Qualified uncommitted candidate package projection; public Git publication remains separate");
} finally { await rm(root, { recursive: true, force: true }); }
