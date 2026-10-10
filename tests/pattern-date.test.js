import test from 'node:test';
import assert from 'node:assert/strict';
import {oppositePatternDate} from '../worker/static-refresh.js';

test('土曜の反対パターンは祝日の月曜を飛ばして次の平日にする',()=>{
  assert.equal(oppositePatternDate('2026-10-10','kintetsu'),'2026-10-13');
  assert.equal(oppositePatternDate('2026-10-10','subway'),'2026-10-13');
});

test('平日の反対パターンは直近の土休日にする',()=>{
  assert.equal(oppositePatternDate('2026-10-09','kintetsu'),'2026-10-10');
});

test('祝日の反対パターンは次の実平日にする',()=>{
  assert.equal(oppositePatternDate('2026-10-12','kintetsu'),'2026-10-13');
});
