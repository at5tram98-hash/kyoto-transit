// E: read-only release candidate verification. Does not publish or query
// production. Cross-origin production checks run in a separate gated job.
import { readFile, readdir, stat, mkdir, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import assert from "node:assert/strict";

const source = resolve("public"), output = resolve("dist");
const files = [];
async function collect(path, prefix = "") {
  for (const name of await readdir(path)) {
    const relative = prefix + name, full = join(path, name);
    if ((await stat(full)).isDirectory()) await collect(full, relative + "/");
    else files.push(relative);
  }
}
await collect(source);
const read = (file) => readFile(join(output, file), "utf8");
const html = await read("index.html"), sw = await read("sw.js");
const version = html.match(/js\/vnext\.js\?v=([a-f0-9]{12})/)?.[1];
assert.ok(version, "Build version missing from app entry");
assert.ok(sw.includes(`const VERSION = "${version}"`),
  "App and Service Worker versions differ");
assert.ok(!sw.includes("__BUILD_VERSION__") && !sw.includes("__PRECACHE__"),
  "Service Worker has unresolved template markers");
const precacheText = sw.match(/const PRECACHE = (\[[^\n]+\]);/)?.[1];
assert.ok(precacheText, "Precache manifest missing");
const precache = JSON.parse(precacheText);
assert.equal(new Set(precache).size, precache.length, "Duplicate precache assets");
const required = files.filter(p=>p!=="sw.js");
for (const file of required)
  assert.ok(precache.includes(file),
    `Release asset omitted from offline cache: ${file}`);
const css = [...html.matchAll(/href="([^"]+\.css\?v=([a-f0-9]{12}))"/g)];
assert.ok(css.length>=10, "Not all stylesheet assets are linked");
for (const m of css) {
  assert.equal(m[2],version,`CSS version mismatch: ${m[1]}`);
  assert.ok(required.includes(m[1].split("?")[0]), `Missing stylesheet: ${m[1]}`);
}
for (const p of ["js/vnext.js","js/bootstrap.js"]) {
  assert.ok(html.includes(`${p}?v=${version}`), `Entrypoint missing: ${p}`);
  assert.ok(required.includes(p), `Compiled entrypoint missing: ${p}`);
}
for (const p of ["desktop-layout-d2.css","accessibility-polish-d5.css",
  "js/search-recovery-c6.js","js/motion-policy-d3.js",
  "js/desktop-tabs-d4.js","manifest.webmanifest"]) {
  assert.ok(required.includes(p), `Feature asset missing from release: ${p}`);
}
const modules = files.filter(p=>p.startsWith("js/")&&p.endsWith(".js"));
for (const p of modules) {
  const js=await read(p);
  // Relative modules must use this release's version, never an unversioned
  // module or another release's version.
  for (const match of js.matchAll(/from\s*["'](\.\/[^"']+\.js)(\?v=([^"']+))?["']/g)) {
    assert.equal(match[3],version,`Mixed release module import ${p}: ${match[0]}`);
    const resolved = join(dirname(p),match[1]);
    assert.ok(required.includes(resolved),`Broken import: ${p} => ${resolved}`);
  }
}
const pwa = JSON.parse(await read("manifest.webmanifest"));
assert.ok(pwa.name && pwa.start_url && pwa.display,
  "Installable PWA metadata missing");
const report = {
  kind:"candidate", sha:process.env.GITHUB_SHA??null, buildVersion:version,
  status:"passed", assetCount:required.length, moduleCount:modules.length,
  cssCount:css.length, precacheCount:precache.length,
  note:"Static candidate audit only. This is NOT real-time provider or physical iPhone acceptance.",
};
const location=resolve(process.env.E_REPORT_DIR??"e-release-artifacts");
await mkdir(location,{recursive:true});
await writeFile(join(location,"candidate-release.json"),JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
