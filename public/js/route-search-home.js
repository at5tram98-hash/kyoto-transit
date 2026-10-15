import { esc, icon } from "./vnext-state.js";

// This is an entry view of the existing search controller, not a second form.
export function mountSearchHome(host, search) {
  host.innerHTML = `<div class="home-search-navigation" role="group" aria-label="今の表示"><button type="button" data-home-page="route" aria-pressed="true">ルート検索</button><button type="button" data-home-page="nearby" aria-pressed="false">最寄駅検索</button><button type="button" class="home-pass-shortcut" data-home-pass aria-label="定期券の設定">${icon("ticket")}<small>定期券</small></button></div><section class="home-route-search" aria-label="経路を検索"><button type="button" class="planner-place-field" data-home-field="from"><span class="place-label">出発</span><span class="home-place-value" data-home-value="from"></span></button><div class="planner-place-tools"><button type="button" class="planner-add-via" data-home-via>＋ 経由</button><button type="button" class="planner-current" data-home-current aria-label="現在地を出発地にする">${icon("location")}</button><button type="button" class="planner-swap" data-home-swap aria-label="出発と到着を入れ替える">⇅</button></div><div class="home-via-list"></div><button type="button" class="planner-place-field" data-home-field="to"><span class="place-label">到着</span><span class="home-place-value" data-home-value="to"></span></button><button type="button" class="planner-date-entry" data-home-date>${icon("clock")}<span data-home-date-label></span><small>日時⌄</small></button><div class="home-search-conditions"><button type="button" data-home-filter="trainType">${icon("train")}<span data-home-train-type></span></button><button type="button" data-home-filter="buffer">${icon("clock")}<span data-home-buffer></span></button><button type="button" data-home-filter="maxWalk">${icon("walk")}<span data-home-walk></span></button><button type="button" data-home-filter=""><span>検索<br>条件⌄</span></button></div><button type="button" class="planner-submit home-search-submit" data-home-submit>検索</button><p class="search-home-feedback" data-home-feedback role="status"></p><div class="home-search-history"></div></section>`;
  const view = host.closest('[data-view="now"]');
  let page = search.mode() === "nearby" ? "nearby" : "route";
  function selectPage(value) {
    page = value;
    view.dataset.homePage = value;
    host
      .querySelectorAll("[data-home-page]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.homePage === value),
        ),
      );
    search.setMode(value);
  }
  function render() {
    const value = search.input();
    for (const name of ["from", "to"]) {
      const el = host.querySelector(`[data-home-value="${name}"]`);
      el.textContent =
        value[name] ||
        (name === "from" ? "出発地を入力" : "駅・バス停・施設を入力");
      el.classList.toggle("placeholder", !value[name]);
    }
    host.querySelector("[data-home-date-label]").textContent =
      search.dateLabel();
    host.querySelector("[data-home-train-type]").textContent = {
      all: "普通・急行",
      local: "普通のみ",
      express: "急行のみ",
    }[value.trainType];
    host.querySelector("[data-home-buffer]").textContent =
      `乗換${value.buffer}分`;
    host.querySelector("[data-home-walk]").textContent =
      `徒歩${value.maxWalk}分以内`;
    host.querySelector("[data-home-feedback]").textContent = search.feedback();
    host.querySelector("[data-home-via]").disabled = value.via.length >= 3;
    const via = value.via
      .map(
        (v, i) =>
          `<div class="home-via-row"><button type="button" class="planner-place-field" data-home-field="via${i}"><span class="place-label">経由</span><span>${esc(v.name || "経由地を入力")}${v.dwell ? `<small>滞在${v.dwell}分</small>` : ""}</span></button><button type="button" class="plain-action" data-home-remove-via="${i}" aria-label="経由地${i + 1}を削除">−</button></div>`,
      )
      .join("");
    const viaHost = host.querySelector(".home-via-list");
    if (viaHost.innerHTML !== via) viaHost.innerHTML = via;
    const pairs = search.history();
    const history = pairs.length
      ? `<h3>最近・保存した経路</h3><div class="native-list">${pairs.map((p, i) => `<button type="button" class="native-row" data-home-history="${i}"><span><b>${esc(p.from)} → ${esc(p.to)}</b></span><span class="chevron">›</span></button>`).join("")}</div>`
      : "";
    const historyHost = host.querySelector(".home-search-history");
    if (historyHost.innerHTML !== history) historyHost.innerHTML = history;
  }
  host.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.homePage) selectPage(button.dataset.homePage);
    else if (button.dataset.homeField)
      search.openField(button.dataset.homeField);
    else if (button.hasAttribute("data-home-via")) search.addVia();
    else if (button.dataset.homeRemoveVia !== undefined)
      search.removeVia(Number(button.dataset.homeRemoveVia));
    else if (button.hasAttribute("data-home-swap")) search.swap();
    else if (button.hasAttribute("data-home-current")) search.current();
    else if (button.hasAttribute("data-home-date")) search.openDate();
    else if (button.hasAttribute("data-home-filter"))
      search.openFilter(button.dataset.homeFilter);
    else if (button.hasAttribute("data-home-pass")) search.openPass();
    else if (button.hasAttribute("data-home-submit")) search.submit();
    else if (button.dataset.homeHistory !== undefined)
      search.useHistory(Number(button.dataset.homeHistory));
    render();
  });
  host.addEventListener("mymap-now-context", () => {
    search.syncLocation();
    render();
  });
  search.subscribe(render);
  selectPage(page);
  render();
}
