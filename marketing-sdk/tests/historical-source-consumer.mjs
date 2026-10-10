// Execute unmodified published Git sources; synthetic SQL/keys only. No browser/provider calls.
import { mkdtemp, writeFile, readFile, cp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const artifacts = resolve(process.env.MARKETING_HISTORICAL_ARTIFACTS || 'artifacts/external-creative/historical');
await mkdir(artifacts, { recursive: true });
for (const [version, sha] of [['0.1.8','c39c095e9f657f5cabe320d7b0aa1e0987d15012'],['0.1.7','fe24434b620ca143cf2f9b6124a7dc6a8cac04cf']]) {
  const root = await mkdtemp(join(tmpdir(), 'historical-consumer-'));
  const out = join(artifacts, version); await mkdir(out, { recursive: true });
  try {
    const dependency = `git+https://github.com/c0x65o/handrail-sdk-marketing-js.git#${sha}`;
    await writeFile(join(root,'package.json'), JSON.stringify({ private:true,type:'module',dependencies:{'@handrail/marketing':dependency} },null,2));
    const run = (bin,args) => execFileSync(bin,args,{cwd:root,encoding:'utf8',env:{...process.env,NODE_ENV:'development'},stdio:['ignore','pipe','pipe']});
    await writeFile(join(out,'install.log'),run('npm',['install','--include=dev','--no-audit','--no-fund']));
    const lock = JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));
    const entry = lock.packages['node_modules/@handrail/marketing'];
    assert.ok([dependency,dependency.replace('git+https://github.com/','git+ssh://git@github.com/')].includes(entry.resolved));
    entry.resolved=dependency; await writeFile(join(root,'package-lock.json'),JSON.stringify(lock,null,2)+'\n');
    await writeFile(join(out,'ci.log'),run('npm',['ci','--include=dev','--no-audit','--no-fund']));
    await cp(join(root,'package.json'),join(out,'consumer-package.json')); await cp(join(root,'package-lock.json'),join(out,'consumer-lock.json'));
    const installed=join(root,'node_modules/@handrail/marketing');
    assert.equal(JSON.parse(await readFile(join(installed,'package.json'),'utf8')).version,version);
    await cp(join(installed,'.marketing-build/source-manifest.json'),join(out,'published-source-manifest.json'));
    const manifest=JSON.parse(await readFile(join(out,'published-source-manifest.json'),'utf8'));
    for(const file of manifest.files) {
      const original=execFileSync('git',['show',sha+':'+file.path]);
      assert.equal(createHash('sha256').update(original).digest('hex'),file.sha256,`Published source mismatch: ${file.path}`);
      // npm omits the dependency's own lock from its installed packlist. Its prepare
      // manifest still binds that Git blob; the consumer lock is retained above.
      if (file.path !== 'package-lock.json') assert.equal(createHash('sha256').update(await readFile(join(installed,file.path))).digest('hex'),file.sha256);
    }
    await writeFile(join(out,'provenance.json'),JSON.stringify({sha,version,installation:dependency,normalPrepare:true,gitObjectByteMatches:manifest.files.length},null,2)+'\n');
    await cp(resolve('marketing-sdk/tests/historical-issue.mjs'),join(root,'issue.mjs'));
    await writeFile(join(out,'issue.log'),run(process.execPath,['issue.mjs',version,out]));
    // Open the exact old SQL database with candidate public exports, never rewrite old record shapes.
    const { qualifyHistorical } = await import('./historical-open.mjs');
    await qualifyHistorical(out);
    console.log(`Published ${version} ${sha}: source-issued pending callback safely restarted by candidate`);
  } catch(e) { await writeFile(join(out,'failure.log'),String(e)+'\n'+(e.stderr||'')); throw e; }
  finally { await rm(root,{recursive:true,force:true}); }
}
