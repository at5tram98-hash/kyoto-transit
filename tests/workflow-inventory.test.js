import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
const dir=".github/workflows";
const workflows=Object.fromEntries(readdirSync(dir).filter(name=>/\.ya?ml$/.test(name)).map(name=>[name,readFileSync(`${dir}/${name}`,"utf8")]));
test("Workflows: only the verified production workflows are active",()=>{
 assert.deepEqual(Object.keys(workflows).sort(),["pages.yml","pr-quality.yml","production-health.yml","worker.yml"]);
});
test("Workflows: pull requests are verified without publishing or secrets",()=>{
 const pr=workflows["pr-quality.yml"];
 assert.match(pr,/pull_request:\n    branches: \[main\]/);
 assert.match(pr,/permissions:\n  contents: read\n/);
 assert.doesNotMatch(pr,/secrets\.|deploy-pages|pages: write|id-token/);
 for(const action of ["npm run check","npm test","npm run build","npm run test:browser","npm run test:pwa","wrangler deploy --dry-run","BROWSER_ENGINE: webkit"])
  assert.ok(pr.includes(action),`PR gate missing ${action}`);
});
test("Workflows: Pages is published only by the fully tested main workflow",()=>{
 const publishers=Object.keys(workflows).filter(name=>/actions\/deploy-pages@/.test(workflows[name]));
 assert.deepEqual(publishers,["pages.yml"]);
 const pages=workflows["pages.yml"];
 assert.match(pages,/push:\n    branches: \[main\]/);
 const deploy=pages.indexOf("actions/deploy-pages@");
 for(const action of ["npm run check","npm test","npm run build","npm run test:browser","npm run test:pwa","wrangler deploy --dry-run"])
  assert.ok(pages.indexOf(action)>=0&&pages.indexOf(action)<deploy,`Pages publishes before ${action}`);
});
test("Workflows: Worker is deployed only by the tested main workflow",()=>{
 const deployers=Object.keys(workflows).filter(name=>/wrangler deploy(?! --dry-run)/.test(workflows[name]));
 assert.deepEqual(deployers,["worker.yml"]);
 const worker=workflows["worker.yml"];
 assert.ok(worker.indexOf("npm test")<worker.search(/wrangler deploy --config/));
});
