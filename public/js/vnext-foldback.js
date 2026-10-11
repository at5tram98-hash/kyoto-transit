import { formatMinute } from './vnext-core.js';
import {
  $,
  esc,
  state,
  tokyoNow,
  haptic,
  rideKey,
  toast,
} from './vnext-state.js';
import { officialData } from './timetable-ui.js';
import {
  foldbackCandidates,
  reverseDirection,
  stopTime,
  assessFoldback,
  foldbackServiceDay,
  journeyClock,
} from './journey-core.js';
import { renderNow } from './vnext-view.js';

let version = 0,
  controller = null,
  choices = [],
  selected = null,
  opener = null;
const category = (entry) =>
  entry.category === 'express'
    ? '急行'
    : entry.category === 'local'
      ? '普通'
      : entry.category === 'other'
        ? 'その他'
        : '種別未取得';
function invalidate() {
  version++;
  controller?.abort();
  controller = null;
  choices = [];
  selected = null;
}
function replaceBody(html) {
  invalidate();
  $('#foldback-body').innerHTML = html;
  $('#foldback-body').scrollTop = 0;
}
const clock = () => journeyClock(state.foldbackRide, tokyoNow());
function stops() {
  return foldbackCandidates(
    state.foldbackRide,
    clock().minute,
    state.rideShift,
  );
}
const options = (items) =>
  items
    .map(
      (s) =>
        `<option value="${esc(s.id)}">${esc(s.name)}${Number.isFinite(stopTime(s)) ? ` · ${formatMinute(Math.round(stopTime(s) + state.rideShift))}着` : ' · 時刻未取得'}</option>`,
    )
    .join('');
const bufferField = () =>
  '<label class="sheet-field"><span>ホーム移動に必要な時間</span><select id="fold-buffer"><option value="2">2分</option><option value="3" selected>3分</option><option value="5">5分</option><option value="8">8分</option></select></label>';

export function openFoldback() {
  const ride = state.ride;
  if (!ride || ['citybus', 'kyotobus'].includes(ride.operator)) return;
  state.foldbackRide = ride;
  const dialog = $('#foldback-sheet');
  if (!dialog.open) opener = document.activeElement;
  replaceBody(
    '<p class="sheet-intro">この先の駅で、好きな反対方向の列車へ。現在の遅れを含む到着見込みから、乗換時間を確認します。</p><button class="choice-row" data-foldback-mode="station"><span class="choice-icon">↩</span><span><b>降りる駅から探す</b><small>乗換時間を確保できる反対方向の列車を表示</small></span><span>›</span></button><button class="choice-row" data-foldback-mode="train"><span class="choice-icon">⇄</span><span><b>好きな電車を選ぶ</b><small>指定した列車に折り返せるかを確認</small></span><span>›</span></button>',
  );
  if (!dialog.open) dialog.showModal();
  $('#foldback-body [data-foldback-mode]')?.focus({ preventScroll: true });
  haptic();
}
function showMode(mode) {
  const items = stops(),
    train = mode === 'train';
  replaceBody(
    `<button class="sheet-back" data-foldback-home>‹ 選び方に戻る</button><div class="fold-step"><span>1</span><b>${train ? '駅と列車を選ぶ' : '折り返す駅を選ぶ'}</b></div><p class="sheet-intro">${train ? '急行・普通・行き先を見ながら、反対方向の列車を選べます。' : '終点でも折り返せます。降車から反対ホームへ移動する時間を確保してください。'}</p><label class="sheet-field"><span>${train ? '列車を選ぶ駅' : '降りる駅'}</span><select id="${train ? 'target-station' : 'fold-station'}">${options(items)}</select></label>${bufferField()}<button class="primary-action" ${train ? 'data-load-target-trains' : 'data-foldback-search'} ${items.length ? '' : 'disabled'}>${train ? '反対方向の列車を表示' : '乗り換えられる列車を探す'}</button><div id="${train ? 'target-trains' : 'fold-result'}" aria-live="polite"></div><p class="source-note">到着は現在の遅れを含む推定、反対方向の列車は公式時刻表の予定です。番線や運行変更は駅の表示も確認してください。</p>`,
  );
  $('#foldback-body select')?.focus({ preventScroll: true });
}
async function reverseBoard(stopId, signal) {
  const ride = state.foldbackRide,
    reverse = reverseDirection(ride, stopId);
  if (!reverse)
    throw Error('進行方向を確認できません。乗車中の便を確認してください。');
  const data = await officialData(
      '/timetable/options',
      { stop: stopId },
      signal,
    ),
    board = data.boards?.find((x) => x.key === reverse);
  if (!board)
    throw Error(
      'この駅の反対方向の時刻表を取得できません。別の駅を選んでください。',
    );
  const now = clock(),
    stop = ride.officialStops?.find((s) => s.id === stopId),
    arrival = Number.isFinite(stopTime(stop))
      ? stopTime(stop) + state.rideShift
      : now.minute;
  const days = [{ date: now.date, offset: 0 }];
  if (arrival + Number($('#fold-buffer').value) >= 1440)
    days.push(foldbackServiceDay(now.date, Math.max(1440, arrival)));
  const tables = await Promise.all(
    days.map(async (day) => {
      const table = await officialData(
        '/timetable',
        { stop: stopId, direction: board.key, day: 'auto', date: day.date },
        signal,
      );
      return (table.entries ?? []).map((entry) => ({
        ...entry,
        serviceDepart: entry.depart,
        depart: entry.depart + day.offset,
        day: table.day,
        date: day.date,
        sourceURL: table.sourceURL,
      }));
    }),
  );
  const unique = new Map(
    tables
      .flat()
      .filter((e) => Number.isFinite(e.depart))
      .map((e) => [`${e.depart}|${e.tripId ?? ''}|${e.destination ?? ''}`, e]),
  );
  return {
    board,
    entries: [...unique.values()].sort((a, b) => a.depart - b.depart),
  };
}
async function load(mode) {
  const train = mode === 'train',
    root = $(train ? '#target-trains' : '#fold-result'),
    select = $(train ? '#target-station' : '#fold-station');
  if (!root || !select) return;
  invalidate();
  const job = version,
    id = select.value,
    ride = state.foldbackRide,
    buffer = Number($('#fold-buffer').value),
    now = clock();
  const stop = ride?.officialStops?.find((s) => s.id === id);
  root.innerHTML =
    '<p class="loading-line" role="status">反対方向の公式時刻表を確認中…</p>';
  root.setAttribute('aria-busy', 'true');
  controller = new AbortController();
  const request = controller,
    timer = setTimeout(() => request.abort(), 20000);
  const current = () =>
    job === version &&
    $('#foldback-sheet').open &&
    ride === state.ride &&
    root.isConnected;
  try {
    const { board, entries } = await reverseBoard(id, request.signal);
    if (!current()) return;
    choices = entries
      .filter(
        (entry) =>
          entry.depart >= now.minute &&
          (train ||
            assessFoldback(stop, entry.depart, {
              shift: state.rideShift,
              buffer,
              now: now.minute,
            }).slack >= 0),
      )
      .slice(0, train ? 16 : 8)
      .map((entry) => ({ ...entry, stopId: id, direction: board.key, buffer }));
    if (!Number.isFinite(stopTime(stop)) && !train) {
      root.innerHTML =
        '<p class="empty-state">この駅の到着時刻が未取得のため、乗換可能な列車を判定できません。「好きな電車を選ぶ」から予定時刻を確認できます。</p>';
      return;
    }
    root.innerHTML = choices.length
      ? `<div class="fold-step"><span>2</span><b>${train ? '好きな列車を選択' : '折り返す列車を選択'}</b></div><p class="fold-direction">${esc(board.label)}</p><div class="fold-results">${choices
          .map((entry, i) => {
            const assessment = assessFoldback(stop, entry.depart, {
              shift: state.rideShift,
              buffer,
              now: now.minute,
            });
            return `<button class="target-train" data-target-index="${i}"><b>${formatMinute(entry.depart)}<small>発</small></b><span><strong>${esc(entry.destination ?? board.label)}</strong><small>${esc(category(entry))}${entry.tripId ? ` · 便 ${esc(entry.tripId)}` : ''}</small></span><span class="fold-margin ${assessment.status}">${assessment.status === 'unknown' ? '時刻未取得' : assessment.slack < 0 ? '時間不足' : `余裕 ${Math.floor(assessment.slack)}分`}<small>選択 ›</small></span></button>`;
          })
          .join('')}</div>`
      : '<p class="empty-state">条件に合う反対方向の列車がありません。駅やホーム移動の時間を変更してください。</p>';
  } catch (error) {
    if (current() && error.name !== 'AbortError')
      root.innerHTML = `<p class="empty-state">${esc(error.message)}</p><button class="secondary-action" ${train ? 'data-load-target-trains' : 'data-foldback-search'}>もう一度取得</button>`;
    else if (current())
      root.innerHTML = `<p class="empty-state">取得に時間がかかっています。</p><button class="secondary-action" ${train ? 'data-load-target-trains' : 'data-foldback-search'}>再試行</button>`;
  } finally {
    clearTimeout(timer);
    if (current()) root.removeAttribute('aria-busy');
  }
}
function evaluate(index) {
  const entry = choices[index];
  if (!entry || state.foldbackRide !== state.ride) return;
  const buffer = Number($('#fold-buffer').value),
    stop = state.ride.officialStops?.find((s) => s.id === entry.stopId),
    assessment = assessFoldback(stop, entry.depart, {
      shift: state.rideShift,
      buffer,
      now: clock().minute,
    });
  selected = {
    ...entry,
    buffer,
    choiceIndex: index,
    rideKey: rideKey(state.ride),
  };
  const labels = {
    possible: '乗換時間を確保できます',
    tight: '乗換の余裕が少なめです',
    missed: '乗換時間が不足しています',
    unknown: '到着時刻を確認できません',
  };
  const root = $('#target-trains') ?? $('#fold-result');
  root.innerHTML = `<div class="fold-step"><span>3</span><b>折り返しを確認</b></div><article class="target-result ${assessment.status}" role="status" tabindex="-1"><span>${labels[assessment.status]}</span><b>${esc(stop?.name ?? entry.stopId)}で折り返し</b><p>${esc(category(entry))} ${esc(entry.destination ?? '反対方向')}行き</p><dl class="fold-timing"><div><dt>自分の到着見込み</dt><dd>${Number.isFinite(assessment.arrival) ? formatMinute(Math.round(assessment.arrival)) : '時刻未取得'}</dd></div><div><dt>選んだ列車の発車</dt><dd>${formatMinute(entry.depart)}</dd></div><div><dt>ホーム移動</dt><dd>${buffer}分</dd></div><div><dt>乗換余裕</dt><dd>${Number.isFinite(assessment.slack) ? (assessment.slack >= 0 ? `約${Math.floor(assessment.slack)}分` : `約${Math.ceil(-assessment.slack)}分不足`) : '判定できません'}</dd></div></dl></article><button class="primary-action" data-save-foldback ${['possible', 'tight'].includes(assessment.status) ? '' : 'disabled'}>この折り返しを案内に表示</button><button class="secondary-action" ${$('#target-station') ? 'data-load-target-trains' : 'data-foldback-search'}>別の列車を選ぶ</button>`;
  root.querySelector('.target-result').focus();
  haptic();
}
function save() {
  if (!selected || selected.rideKey !== rideKey(state.ride)) return;
  const stop = state.ride.officialStops?.find((s) => s.id === selected.stopId),
    assessment = assessFoldback(stop, selected.depart, {
      shift: state.rideShift,
      buffer: selected.buffer,
      now: clock().minute,
    });
  if (!['possible', 'tight'].includes(assessment.status)) {
    toast('到着見込みが変わりました。折り返しを再確認してください。');
    evaluate(selected.choiceIndex);
    return;
  }
  state.foldbackPlan = selected;
  $('#foldback-sheet').close();
  renderNow();
  toast('折り返し案内を設定しました');
}
export function setupFoldback() {
  const dialog = $('#foldback-sheet');
  dialog.addEventListener('close', () => {
    invalidate();
    const target = opener?.isConnected ? opener : $('#ride-foldback');
    target?.focus({ preventScroll: true });
    opener = null;
  });
  dialog.addEventListener('change', (e) => {
    if (
      !['fold-station', 'target-station', 'fold-buffer'].includes(e.target.id)
    )
      return;
    invalidate();
    const root = $('#target-trains') ?? $('#fold-result');
    if (root) {
      root.innerHTML = '';
      root.removeAttribute('aria-busy');
    }
  });
  dialog.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    if (button.dataset.foldbackMode) showMode(button.dataset.foldbackMode);
    else if (button.hasAttribute('data-foldback-home')) openFoldback();
    else if (button.hasAttribute('data-foldback-search')) void load('station');
    else if (button.hasAttribute('data-load-target-trains')) void load('train');
    else if (button.dataset.targetIndex !== undefined)
      evaluate(Number(button.dataset.targetIndex));
    else if (button.hasAttribute('data-save-foldback')) save();
    else if (button.hasAttribute('data-sheet-close')) dialog.close();
  });
}
