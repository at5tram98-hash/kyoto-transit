import { searchStops } from './network.js';
import {
  $,
  esc,
  icon,
  state,
  nearest,
  toast,
  tokyoNow,
} from './vnext-state.js';
import {
  ARRIVAL_INTERVAL,
  LIVE_MAX_AGE,
  getCached,
  fetchRealtime,
  predictCityBus,
  predictRail,
  isFresh,
  freshnessNotice,
  createLiveLoop,
  realtimeLog,
  interpolateCityBusRecovery,
  interpolateRailRecovery,
} from './realtime.js';
import { CAPTURE_API } from './live.js';
import { buildRailArrivalRows } from './rail-arrivals-core.js';
import {
  groupCityBusRows,
  busServiceLabel,
  busArrivalText,
  busCongestionText,
  shouldShowKintetsuArrival,
} from './arrival-stability.js';
import { updateArrivalRows, updateHTML } from './view-rendering.js';

const STORE = 'mymap-arrivals-v3';
const saved = () => {
  try {
    const value = JSON.parse(localStorage.getItem(STORE) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {};
  } catch {
    return {};
  }
};
const persist = (value) => {
  try {
    localStorage.setItem(STORE, JSON.stringify(value));
  } catch {}
};
const cityStops = (network) =>
  [...network.stops.values()].filter((s) => s.type === 'citybus');
const stopName = (stop) => stop?.fullName ?? stop?.name ?? '';
const sourceDot = (source) =>
  `<i class="source-dot ${source === 'live' ? 'live' : source === 'prediction' ? 'prediction' : 'schedule'}" aria-hidden="true"></i>`;
const delayText = (d) =>
  Number.isFinite(d)
    ? Math.abs(Math.round(d)) < 1
      ? '定刻'
      : `${Math.abs(Math.round(d))}分${d > 0 ? '遅れ' : '早め'}`
    : '—';
const minuteText = (r) =>
  Number.isFinite(r.minutes)
    ? `あと${Math.max(0, Math.round(r.minutes))}分`
    : (r.status ?? '—');
const sourceLabel = (source) =>
  source === 'live' ? '実測' : source === 'prediction' ? '予測' : '予定';
const updateTime = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  hour: '2-digit',
  minute: '2-digit',
});

function arrivalValue(r) {
  if (Number.isFinite(r.minutes))
    return `<span aria-label="${esc(minuteText(r))}"><b>${Math.max(0, Math.round(r.minutes))}</b><small>分</small></span>`;
  if (Number.isFinite(r.stopsAway))
    return `<span><b>${Math.max(0, Math.round(r.stopsAway))}</b><small>停留所前</small></span>`;
  return `<span class="arrival-unconfirmed">${esc(r.status ?? '時刻未確定')}</span>`;
}
function busRow(r) {
  const arrivals = (r.arrivals ?? [r]).slice(0, 2),
    congestion = busCongestionText(r);
  return {
    service: `<b class="arrival-route-badge" aria-label="${esc(busServiceLabel(r))}" title="${esc(busServiceLabel(r))}">${esc(r.route)}</b>`,
    destination: `<b>${esc(r.dest || '行先未確認')}</b>`,
    minutes: arrivals.map(arrivalValue).join(''),
    delay: `<span aria-label="遅延 ${esc(delayText(r.delay))}">${esc(delayText(r.delay))}</span>`,
    details: `<span class="arrival-source-label">${sourceDot(r.source)}${sourceLabel(r.source)}</span>${r.boarding ? `<span>${esc(r.boarding)}</span>` : ''}${congestion !== '—' ? `<span>${esc(congestion)}</span>` : ''}`,
    // Animate only an observed stop count; never derive minutes from it.
    stopsAway: arrivals.find((a) => Number.isFinite(a.stopsAway))?.stopsAway,
  };
}
function railRow(r) {
  return {
    service: `<b class="arrival-rail-badge">${esc(r.label ?? r.category ?? '列車')}</b>`,
    destination: `<b>${esc(r.dest ?? '行先未確認')}</b>`,
    minutes: arrivalValue(r),
    delay: `<span aria-label="遅延 ${esc(delayText(r.delay))}">${esc(delayText(r.delay))}</span>`,
    details: `<span class="arrival-source-label">${sourceDot(r.source)}${sourceLabel(r.source)}</span>`,
  };
}
function stale(data, limit = LIVE_MAX_AGE) {
  return Boolean(data?.stale) || !isFresh(data?.asOf, limit);
}
function applyNotice(el, data, { initial = false } = {}) {
  const n = freshnessNotice(data, { initial });
  el.hidden = !n.show;
  el.textContent = n.text;
}
function kintetsuNear() {
  return nearest().all.find((x) => x.stop.type === 'kintetsu') ?? null;
}
function railContext() {
  const near = kintetsuNear();
  return {
    visible: shouldShowKintetsuArrival({
      locationStatus: state.location?.status,
      rideOperator: state.ride?.operator,
      kintetsuMeters: near?.meters,
    }),
    near,
  };
}
function railTarget() {
  const { visible, near } = railContext();
  if (!visible) return null;
  if (near?.meters <= 500) return near.id;
  if (['kintetsu', 'through'].includes(state.ride?.operator)) {
    const candidate = [state.ride?.from, state.ride?.to].find(
      (id) => state.network?.stops.get(id)?.type === 'kintetsu',
    );
    return candidate ?? 'K15';
  }
  return null;
}
function normalizeRail(data, timetable = null, nowMinute = null) {
  if (!data) return null;
  const target = railTarget();
  if (!target) return { ...data, target: null, results: [] };
  const predicted = stale(data) ? predictRail(data) : data,
    results = buildRailArrivalRows(predicted, timetable, target, nowMinute);
  return { ...predicted, target, results };
}

export function compactBusHTML(data) {
  const rows = groupCityBusRows(data?.results ?? []).slice(0, 3);
  if (!rows.length) return '';
  return `<div class="arrival-compact">${rows.map((r) => `<div>${sourceDot(r.source)}<b>${esc(r.route)}</b><span>${esc(r.dest)}</span><strong>${esc(busArrivalText(r))}</strong></div>`).join('')}</div>`;
}

export function mountArrivals({ network }) {
  const root = $('#arrivals-root');
  let stopId = saved().stopId ?? null,
    busData = null,
    railData = null,
    railSchedule = null,
    railScheduleDate = null,
    railScheduleAt = 0,
    busBusy = false,
    railBusy = false;
  if (network.stops.get(stopId)?.type !== 'citybus') stopId = null;
  let busController = null,
    stopVersion = 0,
    shown = false,
    lastRailTarget = null,
    disposed = false,
    railScheduleJob = null,
    awaitingLocation = !stopId && !state.fix;
  root.innerHTML = `<section class="section-block arrival-card"><div class="section-heading"><div><span class="section-label">京都市バス</span><h3>接近情報</h3></div><button class="round-action" data-arrival-nearest aria-label="現在地から停留所を選ぶ">${icon('location')}</button></div><button class="arrival-stop" data-arrival-change><span><small>停留所</small><b id="arrival-stop-name">停留所を選択</b></span><span class="chevron">›</span></button><div id="arrival-stop-picker" hidden><div class="native-search"><span>⌕</span><input id="arrival-stop-search" type="search" placeholder="停留所名・系統を検索" autocomplete="off"></div><div id="arrival-stop-results"></div></div><p class="stale-warning" id="bus-stale" hidden></p><div class="arrival-columns"><span>系統・方面</span><span>行先</span><span>到着</span><span>遅延</span></div><div class="arrival-lines" id="arrival-live" aria-live="polite"></div></section><section class="section-block arrival-card" id="kintetsu-arrival-card" hidden><div class="section-heading"><div><span class="section-label">近鉄京都線</span><h3>接近情報</h3></div><button class="round-action" data-rail-refresh aria-label="更新">${icon('refresh')}</button></div><p class="stale-warning" id="rail-stale" hidden></p><div class="arrival-columns"><span>種別</span><span>行先</span><span>到着</span><span>遅延</span></div><div class="arrival-lines" id="arrival-rail" aria-live="polite"></div></section>`;
  const stopEl = () => root.querySelector('#arrival-stop-name'),
    busRoot = () => root.querySelector('#arrival-live'),
    railRoot = () => root.querySelector('#arrival-rail'),
    railCard = () => root.querySelector('#kintetsu-arrival-card');
  root
    .querySelector('#arrival-stop-search')
    .setAttribute('aria-label', '停留所名・系統を検索');
  const stopButton = root.querySelector('[data-arrival-change]');
  stopButton.setAttribute('aria-expanded', 'false');
  stopButton.setAttribute('aria-controls', 'arrival-stop-picker');
  for (const [card, id] of [
    [root.querySelector('.arrival-card'), 'bus-update-status'],
    [railCard(), 'rail-update-status'],
  ]) {
    const status = document.createElement('p');
    status.className = 'arrival-update-status';
    status.id = id;
    status.textContent = '更新中';
    card.querySelector('.section-heading').after(status);
  }
  const setStatus = (id, data) => {
    const at = Date.parse(data?.asOf),
      text = data
        ? `${sourceLabel(data.source)}${Number.isFinite(at) ? ` · ${updateTime.format(at)} 更新` : ''}`
        : '接続を確認してください';
    root.querySelector(`#${id}`).textContent = text;
  };
  const showEmpty = (target, message) =>
    updateHTML(
      target,
      `<div class="arrival-empty"><span>${icon('bus')}</span><p>${esc(message)}</p><button class="plain-action" data-arrival-retry>再試行</button></div>`,
    );
  function showLoading() {
    updateHTML(
      busRoot(),
      '<div class="arrival-skeleton" aria-hidden="true"><i></i><i></i><i></i></div>',
    );
    root.querySelector('#bus-update-status').textContent = '更新中';
  }
  const currentStop = () => network.stops.get(stopId);
  function updateRailVisibility() {
    const visible = railContext().visible;
    railCard().hidden = !visible;
    return visible;
  }
  function renderStop() {
    stopEl().textContent = currentStop()?.name ?? '停留所を選択';
  }
  function renderSearch(q = '') {
    const items = searchStops(network, q, 'bus')
      .filter((s) => s.type === 'citybus')
      .slice(0, 24);
    root.querySelector('#arrival-stop-results').innerHTML =
      `<div class="native-list">${items.map((s) => `<button class="native-row" data-arrival-stop="${esc(s.id)}"><span class="mode-symbol bus">${icon('bus')}</span><span><b>${esc(s.name)}</b><small>${esc(s.lines.join('・'))}</small></span><span class="chevron">›</span></button>`).join('')}</div>${!items.length ? '<p class="empty-state">停留所が見つかりません。</p>' : ''}`;
  }
  function renderBus(data, opts = {}) {
    if (!data) {
      setStatus('bus-update-status', null);
      showEmpty(
        busRoot(),
        '接近情報を取得できません。通信を確認して再試行できます。',
      );
      return;
    }
    const recovered = interpolateCityBusRecovery(busData, data);
    busData = recovered;
    const projected = stale(recovered) ? predictCityBus(recovered) : recovered,
      rows = groupCityBusRows(projected.results ?? []);
    applyNotice(root.querySelector('#bus-stale'), projected, opts);
    updateArrivalRows(busRoot(), rows, busRow);
    if (!rows.length)
      updateHTML(
        busRoot(),
        '<p class="empty-state">接近中のバスはありません。</p>',
      );
    setStatus('bus-update-status', projected);
    state.busLive = projected;
    state.busLiveAt = Date.now();
  }
  function renderRail(data, opts = {}) {
    if (!updateRailVisibility()) return;
    if (!data) {
      setStatus('rail-update-status', null);
      showEmpty(
        railRoot(),
        '接近情報を取得できません。通信を確認して再試行できます。',
      );
      return;
    }
    const recovered = interpolateRailRecovery(railData, data);
    railData = recovered;
    const view = normalizeRail(recovered, railSchedule, tokyoNow().minute);
    applyNotice(root.querySelector('#rail-stale'), view, opts);
    updateArrivalRows(railRoot(), view?.results ?? [], railRow);
    if (view && !view.results.length)
      updateHTML(
        railRoot(),
        '<p class="empty-state">接近中の列車はありません。</p>',
      );
    setStatus('rail-update-status', view);
    state.railFeed = {
      ...recovered,
      sourceUpdatedAt: recovered.asOf,
      capturedAt: recovered.asOf,
      trains: (recovered.trains ?? []).map((t) => ({
        ...t,
        destination: t.destination ?? t.dest,
      })),
    };
    state.railFeedAt = Date.now();
  }
  function chooseNearest() {
    const n = nearest().all.find((x) => x.stop.type === 'citybus');
    if (!n) {
      toast('近くの市バス停を確認できません');
      return false;
    }
    return selectStop(n.id, true);
  }
  async function selectStop(id, close = false) {
    if (network.stops.get(id)?.type !== 'citybus') return false;
    awaitingLocation = false;
    if (close) {
      root.querySelector('#arrival-stop-picker').hidden = true;
      stopButton.setAttribute('aria-expanded', 'false');
      stopButton.focus();
    }
    if (id === stopId) {
      busLoop.poke();
      return true;
    }
    stopVersion++;
    busController?.abort();
    busController = null;
    busBusy = false;
    stopId = id;
    busData = null;
    state.busLive = null;
    renderStop();
    persist({ stopId });
    showLoading();
    await loadBusCache();
    busLoop.poke();
    return true;
  }
  async function loadBusCache() {
    if (!currentStop()) return;
    const version = stopVersion,
      c = await getCached(`citybus:${stopName(currentStop())}`);
    if (version === stopVersion && !disposed && !busData && c?.data)
      renderBus(c.data, { initial: true });
  }
  async function loadRailCache() {
    if (!updateRailVisibility()) return;
    const c = await getCached('rail:kintetsu');
    if (!disposed && !railData && c?.data)
      renderRail(c.data, { initial: true });
  }
  async function loadRailSchedule(force = false) {
    if (!updateRailVisibility()) return null;
    const date = tokyoNow().date;
    if (
      !force &&
      railSchedule &&
      railScheduleDate === date &&
      Date.now() - railScheduleAt < 30 * 60 * 1000
    )
      return railSchedule;
    if (railScheduleJob) return railScheduleJob;
    const u = new URL('/api/static/feed', CAPTURE_API);
    u.searchParams.set('operator', 'kintetsu');
    u.searchParams.set('date', date);
    railScheduleJob = (async () => {
      const r = await fetch(u, {
        signal: AbortSignal.timeout(7000),
        cache: 'no-store',
      });
      if (!r.ok) throw Error('近鉄の時刻データを取得できませんでした。');
      const d = await r.json();
      railSchedule = d;
      railScheduleDate = date;
      railScheduleAt = Date.now();
      return d;
    })();
    try {
      return await railScheduleJob;
    } finally {
      railScheduleJob = null;
    }
  }
  async function refreshBus() {
    if (busBusy || !currentStop() || disposed) return;
    busBusy = true;
    const version = stopVersion,
      controller = new AbortController();
    busController = controller;
    busRoot().setAttribute('aria-busy', 'true');
    try {
      const data = await fetchRealtime(
        `citybus:${stopName(currentStop())}`,
        '/api/citybus/arrivals',
        { stop: stopName(currentStop()) },
        { timeout: 10000, signal: controller.signal },
      );
      if (version === stopVersion && !disposed) renderBus(data);
    } catch (e) {
      if (version !== stopVersion || disposed) return;
      const cached = e.cached?.data ?? busData;
      if (cached) renderBus(predictCityBus(cached));
      else renderBus(null);
      throw e;
    } finally {
      if (busController === controller) {
        busBusy = false;
        busController = null;
        busRoot().removeAttribute('aria-busy');
      }
    }
  }
  async function refreshRail() {
    if (railBusy || !updateRailVisibility() || disposed) return;
    railBusy = true;
    railRoot().setAttribute('aria-busy', 'true');
    try {
      const schedule = loadRailSchedule().catch(() => null),
        data = await fetchRealtime(
          'rail:kintetsu',
          '/api/rail/live',
          {},
          { timeout: 9000 },
        );
      await schedule;
      if (!disposed) renderRail(data);
    } catch (e) {
      if (disposed) return;
      const cached = e.cached?.data ?? railData;
      if (cached) renderRail(predictRail(cached));
      else renderRail(null);
      throw e;
    } finally {
      railBusy = false;
      railRoot().removeAttribute('aria-busy');
    }
  }
  const active = () => !document.hidden && state.tab === 'now';
  const busLoop = createLiveLoop({
      run: refreshBus,
      active,
      interval: ARRIVAL_INTERVAL,
    }),
    railLoop = createLiveLoop({
      run: refreshRail,
      active: () => active() && railContext().visible,
      interval: ARRIVAL_INTERVAL,
    });
  root.addEventListener('input', (e) => {
    if (e.target.id === 'arrival-stop-search') renderSearch(e.target.value);
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-arrival-change')) {
      const picker = root.querySelector('#arrival-stop-picker');
      picker.hidden = !picker.hidden;
      stopButton.setAttribute('aria-expanded', String(!picker.hidden));
      if (!picker.hidden) {
        renderSearch('');
        root.querySelector('#arrival-stop-search').focus();
      }
    } else if (b.dataset.arrivalStop) selectStop(b.dataset.arrivalStop, true);
    else if (b.hasAttribute('data-arrival-nearest')) chooseNearest();
    else if (b.hasAttribute('data-rail-refresh')) {
      railScheduleAt = 0;
      railLoop.poke();
    } else if (b.hasAttribute('data-arrival-retry')) {
      if (b.closest('#arrival-rail')) railLoop.poke();
      else busLoop.poke();
    }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      root.querySelector('#arrival-stop-picker').hidden = true;
      stopButton.setAttribute('aria-expanded', 'false');
      stopButton.focus();
    }
  });
  async function show() {
    if (disposed) return;
    if (!stopId) {
      const n = nearest().all.find((x) => x.stop.type === 'citybus');
      stopId =
        n?.id ??
        cityStops(network).find((s) => s.name.includes('烏丸丸太町'))?.id ??
        cityStops(network)[0]?.id;
      persist({ stopId });
      renderStop();
    }
    if (awaitingLocation && state.fix) {
      awaitingLocation = false;
      const n = nearest().all.find((x) => x.stop.type === 'citybus');
      if (n && n.id !== stopId) await selectStop(n.id);
    }
    const first = !shown;
    shown = true;
    if (first) {
      showLoading();
      await loadBusCache();
    }
    if (!active()) return;
    const target = railTarget(),
      railChanged = target !== lastRailTarget;
    lastRailTarget = target;
    const railVisible = updateRailVisibility();
    busLoop.start();
    if (railVisible) {
      if (railChanged) {
        if (railData) renderRail(railData);
        else await loadRailCache();
      }
      railLoop.start();
    } else railLoop.stop();
  }
  function logChanged() {
    state.realtimeLog = realtimeLog();
  }
  renderStop();
  updateRailVisibility();
  window.addEventListener('mymap-realtime-log', logChanged);
  return {
    show,
    selectStop,
    refreshBus,
    refreshRail,
    pause() {
      busLoop.stop();
      railLoop.stop();
    },
    dispose() {
      disposed = true;
      busController?.abort();
      busLoop.stop();
      railLoop.stop();
      window.removeEventListener('mymap-realtime-log', logChanged);
    },
    get data() {
      return busData;
    },
  };
}
