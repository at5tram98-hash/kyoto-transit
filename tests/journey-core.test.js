import test from 'node:test';
import assert from 'node:assert/strict';
import {
  journeyProgress,
  reverseDirection,
  foldbackCandidates,
  assessFoldback,
  foldbackServiceDay,
  journeyClock,
} from '../public/js/journey-core.js';

const ride = {
  operator: 'subway',
  direction: 'south',
  officialStops: [
    { id: 'K07', name: '丸太町', time: 600 },
    { id: 'K08', name: '烏丸御池', time: 602 },
    { id: 'K09', name: '四条', time: 605 },
  ],
};

test('遅れを一度だけ反映し、次駅と終点の到着見込みを一致させる', () => {
  const result = journeyProgress(ride, { minute: 604, shift: 3 });
  assert.equal(result.next.id, 'K08');
  assert.equal(result.arrival, 605);
  assert.equal(result.endArrival, 608);
  assert.equal(result.remaining, 2);
});
test('時刻表と現在地が異なるときは、新鮮で精度のよい駅付近の現在地を優先する', () => {
  const result = journeyProgress(ride, {
    minute: 600,
    fix: { lat: 35, lng: 135, accuracy: 10, timestamp: Date.now() },
    geo: { stops: [{ id: 'K08', lat: 35, lng: 135 }] },
  });
  assert.equal(result.currentIndex, 1);
  assert.equal(result.next.id, 'K09');
  assert.equal(result.source, 'location');
});
test('古い位置や対象便の時刻から大きく離れた駅では停車位置を変更しない', () => {
  const point = {
      lat: 35,
      lng: 135,
      accuracy: 10,
      timestamp: Date.now() - 60000,
    },
    geo = { stops: [{ id: 'K08', lat: 35, lng: 135 }] };
  assert.equal(
    journeyProgress(ride, { minute: 600, fix: point, geo }).source,
    'schedule',
  );
  assert.equal(
    journeyProgress(ride, {
      minute: 700,
      fix: { ...point, timestamp: Date.now() },
      geo,
    }).source,
    'schedule',
  );
});
test('市バスは途中時刻を作らず、観測した停留所列から次を案内する', () => {
  const bus = {
    operator: 'citybus',
    officialStops: ride.officialStops.map((s) => ({ ...s, time: null })),
  };
  const result = journeyProgress(bus, {
    minute: 604,
    trail: [{ id: 'K08', at: Date.now() }],
  });
  assert.equal(result.next.id, 'K09');
  assert.equal(result.arrival, null);
  assert.equal(result.endArrival, null);
  assert.equal(result.source, 'location');
});
test('循環バスで出発と終点が同じ停留所でも、観測順から終点への到着を区別する', () => {
  const bus = {
    operator: 'citybus',
    officialStops: [...ride.officialStops, { ...ride.officialStops[0] }].map(
      (s) => ({ ...s, time: null }),
    ),
  };
  const fix = { lat: 35, lng: 135, accuracy: 10, timestamp: Date.now() },
    geo = { stops: [{ id: 'K07', lat: 35, lng: 135 }] };
  assert.equal(
    journeyProgress(bus, {
      minute: 604,
      fix,
      geo,
      trail: [{ id: 'K07', at: Date.now() }],
    }).currentIndex,
    0,
  );
  const result = journeyProgress(bus, {
    minute: 604,
    fix,
    geo,
    trail: ['K07', 'K08', 'K09', 'K07'].map((id) => ({ id, at: Date.now() })),
  });
  assert.equal(result.currentIndex, 3);
  assert.equal(result.remaining, 0);
  assert.equal(result.arrival, null);
});
test('終点付近では残りゼロとなり、折り返し候補にも終点が残る', () => {
  const result = journeyProgress(ride, {
    minute: 605,
    fix: { lat: 35, lng: 135, accuracy: 10, timestamp: Date.now() },
    geo: { stops: [{ id: 'K09', lat: 35, lng: 135 }] },
  });
  assert.equal(result.remaining, 0);
  assert.equal(result.fraction, 1);
  assert.deepEqual(
    foldbackCandidates(ride, 604, 0).map((s) => s.id),
    ['K09'],
  );
});
test('地下鉄・近鉄と直通列車の各区間・竹田・終点で反対方向を選ぶ', () => {
  assert.equal(reverseDirection(ride, 'K08'), 'north');
  assert.equal(reverseDirection(ride, 'K09'), 'north');
  const through = {
    operator: 'through',
    officialStops: [{ id: 'K14' }, { id: 'K15' }, { id: 'B06' }, { id: 'B07' }],
  };
  for (const id of ['K14', 'K15', 'B06', 'B07'])
    assert.equal(reverseDirection(through, id), 'north');
  const north = {
    ...through,
    officialStops: [...through.officialStops].reverse(),
  };
  for (const id of ['B07', 'B06', 'K15', 'K14'])
    assert.equal(reverseDirection(north, id), 'south');
  assert.equal(
    reverseDirection({ officialStops: [{ id: 'unknown' }] }, 'unknown'),
    null,
  );
});
test('遅れとホーム移動時間により、同じ指定列車でも乗換可否が変わる', () => {
  const stop = { time: 600 };
  assert.equal(
    assessFoldback(stop, 610, { shift: 2, buffer: 3 }).status,
    'possible',
  );
  assert.equal(
    assessFoldback(stop, 610, { shift: 6, buffer: 3 }).status,
    'tight',
  );
  assert.equal(
    assessFoldback(stop, 610, { shift: 8, buffer: 3 }).status,
    'missed',
  );
  assert.equal(assessFoldback(stop, 610, { now: 609, buffer: 3 }).slack, -2);
});
test('時刻不明では現在時刻を到着時刻に置換せず、乗換可能と断言しない', () => {
  const result = assessFoldback({ time: null }, 610, {
    shift: 2,
    buffer: 3,
    now: 600,
  });
  assert.equal(result.status, 'unknown');
  assert.equal(result.arrival, null);
  assert.equal(result.slack, null);
});
test('深夜の翌日到着と折り返しを同じ営業日の分数で判定する', () => {
  const overnight = { officialStops: [{ time: 1430 }, { time: 1470 }] };
  const clock = journeyClock(overnight, { date: '2026-10-12', minute: 10 });
  assert.equal(clock.date, '2026-10-11');
  assert.equal(clock.minute, 1450);
  assert.equal(
    journeyProgress(overnight, { minute: clock.minute }).arrival,
    1470,
  );
  assert.equal(
    assessFoldback({ time: 1470 }, 1480, {
      shift: 2,
      buffer: 3,
      now: clock.minute,
    }).slack,
    5,
  );
  assert.deepEqual(foldbackServiceDay('2026-12-31', 1450), {
    date: '2027-01-01',
    offset: 1440,
  });
});
test('日付付きの便は深夜でも午前便でも営業日を維持する', () => {
  assert.equal(
    journeyClock(
      { ...ride, serviceDate: '2026-10-11' },
      { date: '2026-10-12', minute: 10 },
    ).minute,
    1450,
  );
  assert.equal(
    journeyClock(ride, { date: '2026-10-12', minute: 10 }).date,
    '2026-10-12',
  );
});
