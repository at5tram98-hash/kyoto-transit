import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHyperdia} from '../worker/timetables.js';

test('現行市バス時刻表の tt-time wek/sat/hol を読む',()=>{
  const html=`<h1>丸太町智恵光院</h1><table>
    <tr class="tt-one-hour"><td class="tt-time wek"><h3 id="h5">平日5時台</h3>58</td><td class="tt-time sat"><h3 id="d5">土曜日5時台</h3>58</td><td class="tt-time hol"><h3 id="k5">休日5時台</h3>58</td></tr>
    <tr class="tt-one-hour"><td class="tt-time wek"><h3 id="h6">平日6時台</h3>15 35 53</td><td class="tt-time sat"><h3 id="d6">土曜日6時台</h3>25 44</td><td class="tt-time hol"><h3 id="k6">休日6時台</h3>37</td></tr>
  </table>`;
  const d=parseHyperdia(html);
  assert.deepEqual(d.days.weekday.map(x=>x.depart),[358,375,395,413]);
  assert.deepEqual(d.days.saturday.map(x=>x.depart),[358,385,404]);
  assert.deepEqual(d.days.holiday.map(x=>x.depart),[358,397]);
});
