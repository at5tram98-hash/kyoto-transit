import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutChanged,requireRows,shouldExpectRail,fallbackDiagnostic} from '../worker/layout.js';

test('空の目的要素はレイアウト変更として扱う',()=>{assert.throws(()=>requireRows('citybus',[],'missing'),e=>e.code==='layout_changed'&&e.source==='citybus');});
test('通常時間帯の列車0件は構造変更候補にする',()=>{assert.equal(shouldExpectRail(new Date('2026-10-10T03:00:00Z')),true);assert.equal(shouldExpectRail(new Date('2026-10-10T17:00:00Z')),false);});
test('フォールバック診断を正規化する',()=>{const d=fallbackDiagnostic(layoutChanged('kintetsu','station nodes missing'),'rail:kintetsu',0);assert.equal(d.code,'layout_changed');assert.equal(d.source,'kintetsu');assert.equal(d.message,'station nodes missing');assert.equal(d.at,'1970-01-01T00:00:00.000Z');});
