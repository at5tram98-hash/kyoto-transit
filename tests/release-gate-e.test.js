import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const pages=readFileSync(".github/workflows/pages.yml","utf8");
const worker=readFileSync(".github/workflows/worker.yml","utf8");
test("E: Pages publication cannot skip required pre-deploy validation",()=>{
 assert.doesNotMatch(pages,/defer_extended_checks/);
 for(const action of ["npm run check","npm test","npm run build",
 "npm run test:browser","npm run test:pwa","wrangler deploy --dry-run"])
  assert.ok(pages.includes(action),`Pages gate missing ${action}`);
 assert.match(pages,/  build:\n    if: github.ref == 'refs\/heads\/main'/);
 assert.match(pages,/  deploy:\n    needs: build/);
 assert.match(pages,/  verify-production:\n/);
});
test("E: production-only deploy workflows cannot trigger from feature branch",()=>{
 assert.match(pages,/branches: \[main\]/);
 assert.match(worker,/branches: \[main\]/);
 assert.match(worker,/  deploy:\n    if: github.ref == 'refs\/heads\/main'/);
 assert.match(worker,/CLOUDFLARE_API_TOKEN/);
 assert.match(worker,/keep_vars|wrangler deploy --config/);
});
test("E: provider failures never silently count as full acceptance",()=>{
 const source=readFileSync("scripts/verify-production.mjs","utf8");
 assert.match(source,/blocked_external/);
 assert.match(source,/optional_unconfigured/);
 assert.match(source,/if \(!result\.passed\)/);
});
