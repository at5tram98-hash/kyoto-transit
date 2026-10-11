import test from 'node:test';
import assert from 'node:assert/strict';
import {REFRESH_STEPS} from '../worker/static-refresh.js';

test('静的更新は市バスを3バッチと確定処理へ分割する',()=>{
  assert.deepEqual(REFRESH_STEPS.slice(0,6),['odpt:kyotobus','odpt:citybus','citybus:batch:1','citybus:batch:2','citybus:finalize','odpt:subway']);
  assert.equal(REFRESH_STEPS.length,12);
});
