/* 부천대 2027 접수현황 — 프론트엔드 v2 (메뉴 3분할)
 * ADR(6169031): manifest.json → 선택한 모집시기 period JSON 만 읽는다.
 * 상태: available(표시) / not_collected(안내만, 0건 표 금지).
 */
(function () {
  "use strict";
  const ALL_YO = [2027, 2026, 2025];   // 연도 정본(내림차순). 자료가 없는 연도는 화면에서 뺀다.
  let YO = ALL_YO.slice();             // 이 시기의 표시 연도 — 번들 years 중 값이 있는 연도
  let PREV = { 2027: 2026, 2026: 2025, 2025: null };
  const COLS = ["#2563EB", "#64748B", "#B45309"];  // 연도 위치색(최신=파랑·다음=회색·기준=갈색)
  const poseOf = (y) => Math.max(0, YO.indexOf(Number(y)));
  const spanOf = (y) => (Number(y) === YO[YO.length - 1] ? 4 : 6);
  const ycOf = (y) => ["27", "26", "25"][poseOf(y)];
  const colOf = (y) => COLS[poseOf(y)];
  const MENUS = ["home", "daily", "dept", "type"];

  /* 시기별 표시 연도 — 번들 years 중 기간 총계가 있는 연도만 남긴다.
     수시1차는 2027·2026·2025 그대로, 수시2차·정시는 아직 2027 원자료가 없어 2026·2025 가 된다. */
  function setYears(b) {
    const src = (b && Array.isArray(b.years) && b.years.length) ? b.years.map(Number) : ALL_YO.slice();
    const has = (y) => !!(b && b.term_totals && b.term_totals[String(y)] !== null && b.term_totals[String(y)] !== undefined);
    const ys = src.filter(has);
    YO = (ys.length ? ys : src.slice()).sort((a, c) => c - a);
    PREV = {};
    YO.forEach((y, i) => { PREV[y] = YO[i + 1] !== undefined ? YO[i + 1] : null; });
  }

  /* 캐시 가드가 문서를 교체하면 이전 문서의 boot 는 무효 — 세대 번호로 차단한다. */
  const GEN = (window.__siteGen = window.__siteGen || 0);

  let MANIFEST = null;
  const CACHE = {};
  let B = null;            // bundle
  let N = 24;
  let KINDS = null;        // slot kind(start/mid/end) — term_slot_pairs 기준
  let emphOn = true;
  let notice = "";

  const S = { menu: "home", period: "susi_1", scope: "all", deptId: null, mode: "cum", typeDept: null, y25: false, ratio: true, ratioManual: false, periodManual: false, mapYear: 2027 };
  const DASHCACHE = {};
  const DSTATE = { q: "", sort: "name", view: "tiles" };
  let DASH = null;          // 선택한 모집시기의 첫 화면 대시보드 데이터(서버 생성)
  let dashChart = null;     // 학과 상세 모달 차트
  let dashSortKey = "";

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => (n === null || n === undefined ? "-" : Number(n).toLocaleString("ko-KR"));
  const r1 = (v) => Math.round(v * 10) / 10;
  const pctv = (v, d) => (v === null || v === undefined ? "-" : (v >= 0 ? "" : "−") + Math.abs(v).toFixed(d === undefined ? 2 : d) + "%");
  const sgn = (v, d) => (v === null || v === undefined ? "-" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d === undefined ? 2 : d));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- 지원율 ---------- */
  /* 낮은 지원율 강조 — 2단계(이하 기준). 3.0 이하 = 2단계, 5.0 이하 = 1단계. */
  function tierOf(rate) {
    if (rate === null || rate === undefined) return 0;
    const r = r1(rate);
    if (r <= 3.0) return 2;
    if (r <= 5.0) return 1;
    return 0;
  }
  const rateText = (rate, digits) => (rate === null || rate === undefined
    ? "-"
    : (digits === 2 ? Math.round(rate * 100) / 100 : r1(rate)).toFixed(digits === 2 ? 2 : 1));
  function rateOf(rate, quota) {
    if (rate === null || rate === undefined) return null;
    if (quota === null || quota === undefined || quota === 0) return null;
    return rate;
  }
  /* 지원율 변동(%p) 표기 — 항상 소수 2자리, ▲/▼, 0은 0.00 */
  function rateDelta(v) {
    if (v === null || v === undefined) return '<span class="flat" title="값 없음">-</span>';
    const r = Math.round(v * 100) / 100;
    if (r === 0) return '<span class="zero">0.00</span>';
    return `<span class="${r > 0 ? "up" : "down"}"><span class="arr">${r > 0 ? "▲" : "▼"}</span>${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}</span>`;
  }

  function delta(v, digits) {
    if (v === null || v === undefined) return '<span class="flat" title="값 없음">-</span>';
    const d = digits || 0;
    const r = Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
    if (r === 0) return '<span class="zero">0</span>';
    const dir = r > 0 ? "up" : "down";
    return `<span class="${dir}"><span class="arr">${r > 0 ? "▲" : "▼"}</span>${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(d)}</span>`;
  }

  function rateCell(rate, quota, emph, cls, digits) {
    const v = rateOf(rate, quota);
    if (v === null) return `<td class="rate muted0${cls ? " " + cls : ""}" title="모집 인원 없음 또는 값 없음" aria-label="값 없음">-</td>`;
    const t = emph && emphOn ? tierOf(v) : 0;
    const txt = rateText(v, digits);
    const label = t ? `지원율 ${txt}, 낮음 ${t}단계` : `지원율 ${txt}`;
    return `<td class="rate${t ? " t" + t : ""}${cls ? " " + cls : ""}" aria-label="${label}" title="${label}"><span class="mk">${t ? (t === 2 ? "!!" : "!") : ""}</span>${txt}</td>`;
  }

  /* 전년 비교: kind !== 'mid' 인 슬롯만 짝을 인정한다(수시1차=시작3·종료3, 수시2차/정시=term_slot_pairs.json). */
  function slotKind(i, n) {
    if (KINDS && KINDS.length === n) return KINDS[i];
    return i < 3 || i >= n - 3 ? "start" : "mid";
  }
  function isAnchorSlot(i, n) { return slotKind(i, n) !== "mid"; }

  /* 전년 값은 "같은 n일차"(슬롯 인덱스)로 찾는다 — 시작 3일·종료 3일 공통.
     2026-10-26 송석화 확정으로 달력일(MM-DD) 짝 규칙은 폐기. 중간 구간은 비교하지 않는다. */
  function prevRowFor(det, y, i) {
    const py = PREV[y];
    if (!py || !det.years[String(py)]) return null;
    const cur = rowOf(det, y, i);
    if (!cur) return null;
    if (slotKind(i, N) === "mid") return null;
    return rowOf(det, py, i);
  }

  /* ---------- 날짜 ---------- */
  const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
  function dateLabel(iso, short) {
    if (!iso) return "-";
    const d = new Date(iso + "T00:00:00");
    return short ? `${iso.slice(5)}(${WEEK[d.getDay()]})` : `${iso} (${WEEK[d.getDay()]})`;
  }

  /* 2026.09.30.(수) — 화면 부제용 */
  function dateKr(iso) {
    if (!iso) return "-";
    const d = new Date(iso + "T00:00:00");
    return iso.replace(/-/g, ".") + ".(" + WEEK[d.getDay()] + ")";
  }

  /* ---------- 상태/URL ---------- */
  function syncUrl() {
    const q = new URLSearchParams();
    q.set("menu", S.menu);
    if (S.periodManual) q.set("period", S.period);
    if (S.y25) q.set("y25", "1");
    if (S.menu === "daily" && S.ratioManual) q.set("ratio", S.ratio ? "1" : "0");
    if (S.menu === "daily") { q.set("scope", S.scope); if (S.scope === "dept" && S.deptId) q.set("dept", S.deptId); q.set("mode", S.mode); }
    if (S.menu === "type" && S.typeDept) q.set("tdept", S.typeDept);
    if (S.menu === "dept" && B && B.map && S.mapYear !== YO[0]) q.set("my", String(S.mapYear));
    try { history.replaceState(null, "", "?" + q.toString()); } catch (e) { /* 샌드박스 iframe 등 */ }
  }
  function readUrl() {
    const q = new URLSearchParams(location.search);
    if (MENUS.includes(q.get("menu"))) S.menu = q.get("menu");
    if (q.get("period") && MANIFEST.periods[q.get("period")]) { S.period = q.get("period"); S.periodManual = true; }
    if (q.get("scope") === "dept" || q.get("scope") === "all") S.scope = q.get("scope");
    if (q.get("dept")) S.deptId = Number(q.get("dept"));
    if (q.get("mode") === "daily" || q.get("mode") === "cum") S.mode = q.get("mode");
    if (q.get("tdept")) S.typeDept = Number(q.get("tdept"));
    if (ALL_YO.map(String).includes(q.get("my"))) S.mapYear = Number(q.get("my"));
    if (q.get("y25") === "1") S.y25 = true;
    if (q.get("ratio") === "1" || q.get("ratio") === "0") { S.ratio = q.get("ratio") === "1"; S.ratioManual = true; }
  }


  /* ======================================================================
     첫 화면(대시보드) — 사양서 8642814:1 §4~§5
     데이터는 서버가 만든 시기별 dash 번들(manifest.periods[p].dash)을 읽는다.
     → 수시2차·정시 데이터가 적재되면 publish_site.py 1회 실행으로 이 화면이 그대로 갱신된다.
     ====================================================================== */
  const DMEDALS = ["🥇", "🥈", "🥉", "🏅", "🏅"];

  const dashMM = (iso) => {
    const t = String(iso || "").split("-");
    return t.length === 3 ? `${+t[1]}.${+t[2]}` : "";
  };
  const dashNum = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("ko-KR"));
  const lerp = (a, b, t) => a + (b - a) * t;
  /* 5:1 미만 경고 배경 — 3단(#FFF3CD → #F9B24E → 진한 주황), 낮을수록 진해짐 */
  function dashWarnBg(rate, minr) {
    const t = Math.max(0, Math.min(1, (5 - rate) / Math.max(0.0001, 5 - minr)));
    const s0 = [255, 243, 205], s1 = [249, 178, 78], s2 = [228, 110, 38];
    const c = t < 0.55
      ? s0.map((v, i) => Math.round(lerp(v, s1[i], t / 0.55)))
      : s1.map((v, i) => Math.round(lerp(v, s2[i], (t - 0.55) / 0.45)));
    const lite = c.map((v) => Math.round(lerp(v, 255, 0.5)));
    return `linear-gradient(155deg,rgb(${c}),rgb(${lite}))`;
  }
  /* 경고 색상 게이트 — 접수 시작일(target_dates[0]) 이후 6일이 지나야 5:1 미만 색상 적용 */
  function dashWarnActive() {
    if (!DASH) return false;
    if (DASH.pending) return true; // 2027 데이터 미적재(작년 최종 마감 기준) — 확정 데이터는 색상 유효
    const t0 = (DASH.target_dates || [])[0] || (DASH.dates || [])[0];
    const tN = DASH.as_of; // 실제 최신 접수 기준일(기간 전체 배열이 아님)
    if (!t0 || !tN) return true; // 판단 근거가 없으면 기존 동작 유지
    return (new Date(tN) - new Date(t0)) / 86400000 >= 6;
  }
  function dashCountUp(el, target, dec, dur, suffix) {
    const t0 = performance.now();
    (function f(now) {
      const p = Math.min(1, (now - t0) / (dur || 650));
      const e = 1 - Math.pow(1 - p, 3);
      const v = target * e;
      el.textContent = (dec ? v.toFixed(dec) : dashNum(Math.round(v))) + (suffix || "");
      if (p < 1) requestAnimationFrame(f);
    })(t0);
  }
  function dashStats() {
    const depts = (DASH && DASH.depts) || [];
    const byRate = [...depts].sort((a, b) => b.rate - a.rate);
    const medalOf = {};
    byRate.slice(0, 5).forEach((d, i) => (medalOf[d.name] = DMEDALS[i]));
    return {
      depts, byRate, medalOf,
      maxRate: byRate.length ? byRate[0].rate : 1,
      maxApps: Math.max(1, ...depts.map((d) => d.apps_in)),
      minRate: depts.length ? Math.min(...depts.map((d) => d.rate)) : 0,
      // '금일' 배지·열은 마지막 슬롯이 아니라 **최신 접수일** 기준(접수 중이면 오늘 접수분).
      LI: (DASH.latest_index !== null && DASH.latest_index !== undefined)
        ? Number(DASH.latest_index) : Math.max(0, (DASH.dates || []).length - 1),
      lastMD: dashMM(DASH.latest_date || (DASH.dates || [])[(DASH.dates || []).length - 1]),
    };
  }
  function dashFiltered(ST) {
    let arr = ST.depts.filter((d) => d.name.includes(DSTATE.q));
    const s = DSTATE.sort;
    arr.sort((a, b) => (s === "name" ? a.name.localeCompare(b.name, "ko") : (b[s] - a[s])));
    return arr;
  }

  function renderDash() {
    if (!DASH) {
      $("dashPending").classList.remove("hide");
      $("dashPending").innerHTML = "첫 화면 데이터를 불러오지 못했습니다 — 새로고침해 주세요.";
      $("dashKpis").innerHTML = "";
      $("dashTiles").innerHTML = "";
      $("dashRank").innerHTML = "";
      $("dashWarns").innerHTML = "";
      $("dashFoot").innerHTML = "";
      return;
    }
    renderDashPending();
    renderDashKpis();
    renderDashLegend();
    renderDashTiles();
    renderDashRank();
    renderDashFoot();
  }

  function renderDashPending() {
    const el = $("dashPending");
    if (!DASH.pending) { el.classList.add("hide"); el.innerHTML = ""; return; }
    const up = DASH.upcoming;
    let quota = "";
    if (up && up.quota_in) {
      quota = ` 2027학년도 ${esc(DASH.label)} 모집인원은 <b>정원내 ${dashNum(up.quota_in)} · 정원외 ${dashNum(up.quota_out)} · 합계 ${dashNum(up.quota_total || up.quota_in + up.quota_out)}명</b>입니다.`;
    } else {
      quota = ` 2027학년도 ${esc(DASH.label)} 모집인원은 <b>모집요강 미반영 · 미확정</b>입니다.`;
    }
    el.classList.remove("hide");
    const td0 = (DASH.target_dates || [])[0];
    const tdN = (DASH.target_dates || [])[(DASH.target_dates || []).length - 1];
    const startTxt = td0 ? ` 2027 접수 기간은 ${String(td0).replace(/-/g, ".")} ~ ${String(tdN).replace(/-/g, ".")}입니다.` : "";
    el.innerHTML = `<b>2027학년도 ${esc(DASH.label)} 접수 데이터가 아직 없습니다.</b> 아래 수치는 <b>${DASH.year}학년도 최종 마감(${String(DASH.as_of || "").replace(/-/g, ".")}) 기준</b>입니다.${quota}${startTxt} 2027 접수분이 적재되면 같은 화면이 최신 접수일 기준으로 자동 전환됩니다.`;
  }

  function renderDashKpis() {
    const T = DASH.totals || {};
    const ST = dashStats();
    const lastMD = ST.lastMD;
    const first = dashMM((DASH.dates || [])[0]);
    const last = dashMM((DASH.dates || [])[(DASH.dates || []).length - 1]);
    const nDays = (DASH.dates || []).length;
    const under = ST.depts.filter((d) => d.rate < 5).sort((a, b) => a.rate - b.rate);
    const underTxt = !under.length ? "5:1 미만 학과 없음"
      : (dashWarnActive() ? under.map((d) => `${esc(d.name)} ${d.rate.toFixed(1)}:1`).join(" · ") : "목록은 접수 시작 후 6일 경과 시 표시");
    const d0 = (DASH.dates || [])[0] || "";
    const dN = (DASH.dates || [])[(DASH.dates || []).length - 1] || "";
    const items = [
      { cls: "hl", lb: "전체 지원인원 (정원내+외)", v: T.all, s: `${nDays}일 접수 (${d0} ~ ${String(dN).slice(5)})` },
      { cls: "cy", lb: "정원내 지원인원", v: T.in, s: `정원내 모집 ${dashNum(T.quota_in)}명 기준` },
      { cls: "pp", lb: "정원외 지원인원", v: T.out, s: `정원외 모집 ${dashNum(T.quota_out)}명 · ${dashNum(T.all)} − ${dashNum(T.in)}` },
      { cls: "", lb: "정원내 모집인원", v: T.quota_in, s: `${T.n}개 학과·전공 (일반고+특성화고+특기자)` },
      { cls: "cy", lb: "평균 경쟁률 (정원내)", v: T.rate, dec: 2, suffix: ":1", s: "정원내 지원 ÷ 정원내 모집" },
      { cls: under.length && dashWarnActive() ? "rd" : "", lb: "경쟁률 5:1 미만 학과", v: under.length, s: underTxt },
    ];
    $("dashKpis").innerHTML = items.map((it) =>
      `<div class="dkpi ${it.cls}"><div class="lb">${it.lb}</div><div class="v" data-v="${it.v}" data-dec="${it.dec || 0}" data-sfx="${it.suffix || ""}">0</div><div class="s">${it.s}</div></div>`
    ).join("");
    $("dashKpis").querySelectorAll(".dkpi .v").forEach((el, i) => {
      const it = items[i];
      setTimeout(() => dashCountUp(el, Number(it.v) || 0, it.dec || 0, 900, it.suffix || ""), 70 * i);
    });
    $("dashCount").textContent = `34개 학과 중 ${dashFiltered(ST).length}개 표시 · 금일(${lastMD}) 접수 기준`;
  }

  function renderDashLegend() {
    $("dashLegend").innerHTML = `
      <div><span class="sw" style="background:linear-gradient(155deg,#EFF4FF,#fff)"></span><b>파랑 타일</b> — 정원내 경쟁률 5.0:1 이상</div>
      <div><span class="sw" style="background:linear-gradient(155deg,#FFF3CD,#F9B24E)"></span><b>경고 타일</b> — 5.0:1 미만 · <b>강한 경고</b> — 3.0:1 미만(더 진한 색) · <b>접수 시작 후 6일이 지난 날부터 색상 적용</b></div>
      <div>🥇🥈🥉🏅🏅 경쟁률 상위 5개 학과 메달</div>
      <div>타일의 경쟁률은 <b>정원내</b> 기준, 일자별 추이는 <b style="color:#6D28D9">정원내+외 합계</b> 기준입니다</div>
      <div>타일의 <b style="color:var(--amber)">금일(${dashStats().lastMD}) 접수</b> = 원서접수 마감일 당일 신규 접수 건수 (<b>정원내+외 합계</b>)</div>
      <div>타일 클릭 → 학과별 일자별 추이 모달</div>`;
  }

  function renderDashTiles() {
    const el = $("dashTiles");
    const ST = dashStats();
    el.classList.toggle("hide", DSTATE.view !== "tiles");
    $("dashTableView").classList.toggle("on", DSTATE.view === "table");
    if (DSTATE.view !== "tiles") { el.innerHTML = ""; return; }
    const rows = dashFiltered(ST);
    el.innerHTML = rows.map((d) => {
      const warn = d.rate < 5 && dashWarnActive();
      const strong = d.rate < 3 && dashWarnActive();
      const medal = ST.medalOf[d.name] || "";
      return `<article class="tile ${warn ? (strong ? "warn strong" : "warn") : "blue"}" data-name="${esc(d.name)}" tabindex="0" role="button" style="${warn ? `background:${dashWarnBg(d.rate, strong ? 3 : ST.minRate)}` : ""}">
        <div class="tile-top">${medal ? `<span class="medal">${medal}</span>` : ""}<span class="dept">${esc(d.name)}</span></div>
        <div class="rate-wrap"><span class="rate-num" data-t="${d.rate}">0.0</span><span class="rate-unit">:1</span></div>
        <div class="tile-sub"><span>모집 <b>${dashNum((d.quota_in || 0) + (d.quota_out || 0))}</b></span><span>정원내 <b>${dashNum(d.apps_in)}</b></span><span class="ob">정원외 +${dashNum(d.apps_out)}</span></div>
        <div class="mini"><i data-w="${(d.apps_in / ST.maxApps * 100).toFixed(1)}"></i></div>
        <div class="tile-today"><span>금일(${ST.lastMD}) 접수</span><b>+${dashNum((d.daily_new || [])[ST.LI] || 0)}명</b></div>
        <div class="hint">▸ 클릭하면 일자별 추이 (정원내+외)</div></article>`;
    }).join("") || '<p style="color:var(--mute)">검색 결과가 없습니다.</p>';
    el.querySelectorAll(".tile").forEach((t, i) => {
      const d = rows.find((x) => x.name === t.dataset.name);
      const num = t.querySelector(".rate-num");
      setTimeout(() => {
        dashCountUp(num, d.rate, 2, 600, "");
        const bar = t.querySelector(".mini i");
        if (bar) bar.style.width = bar.dataset.w + "%";
      }, 22 * i);
      t.addEventListener("mouseenter", () => dashCountUp(num, d.rate, 2, 550, ""));
      t.addEventListener("click", () => openDashModal(d));
      t.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDashModal(d); } });
    });
  }

  function renderDashTable() {
    const el = $("dashTableView");
    if (DSTATE.view !== "table") { el.innerHTML = ""; return; }
    const ST = dashStats();
    const rows = dashFiltered(ST);
    const rank = {};
    ST.byRate.forEach((d, i) => (rank[d.name] = i + 1));
    el.innerHTML = `<table class="dt"><thead><tr><th>순위</th><th>학과명</th><th class="num">정원내 모집</th><th class="num">정원내 지원</th><th class="rnum">지원율</th><th class="num">정원외 지원</th><th class="num">합계 지원</th><th class="num">${ST.lastMD} 금일 접수</th></tr></thead><tbody>
      ${rows.map((d) => `<tr class="rrowx ${d.rate < 5 && dashWarnActive() ? (d.rate < 3 ? "warn strong" : "warn") : ""}" data-name="${esc(d.name)}" tabindex="0" style="${d.rate < 5 && dashWarnActive() ? `background:${dashWarnBg(d.rate, d.rate < 3 ? 3 : ST.minRate)}` : ""}">
        <td>${rank[d.name]}</td><td><b>${esc(d.name)}</b></td>
        <td class="num">${dashNum(d.quota_in)}</td><td class="num">${dashNum(d.apps_in)}</td><td class="rnum">${d.rate.toFixed(2)}:1</td>
        <td class="num">${dashNum(d.apps_out)}</td><td class="num">${dashNum(d.apps_total)}</td><td class="num" style="color:var(--amber);font-weight:800">${dashNum((d.daily_new || [])[ST.LI] || 0)}</td></tr>`).join("")}
      </tbody></table>`;
    el.querySelectorAll("tr.rrowx").forEach((r) => {
      const d = rows.find((x) => x.name === r.dataset.name);
      r.addEventListener("click", () => openDashModal(d));
      r.addEventListener("keydown", (e) => { if (e.key === "Enter") openDashModal(d); });
    });
  }

  function renderDashRank() {
    const ST = dashStats();
    $("dashRank").innerHTML = ST.byRate.slice(0, 5).map((d, i) =>
      `<div class="rrow"><span class="m">${DMEDALS[i]}</span><span class="nm">${esc(d.name)}</span><span class="rt">${d.rate.toFixed(2)}:1</span></div>
       <div class="rbar"><i data-w="${(d.rate / ST.maxRate * 100).toFixed(1)}"></i></div>`).join("");
    const warns = ST.depts.filter((d) => d.rate < 5).sort((a, b) => a.rate - b.rate);
    $("dashWarns").innerHTML = !dashWarnActive()
      ? '<p style="color:var(--mute);font-size:12px;margin:0">경고 색상은 접수 시작 후 6일이 지난 날부터 적용됩니다</p>'
      : warns.map((d) =>
      `<div class="wrow" style="background:${dashWarnBg(d.rate, d.rate < 3 ? 3 : ST.minRate)};border:1px solid #EAD9AE"><span class="nm">${esc(d.name)}</span><span class="rt">${d.rate.toFixed(2)}:1</span></div>`).join("")
      || '<p style="color:var(--mute);font-size:12px;margin:0">5:1 미만 학과 없음</p>';
    requestAnimationFrame(() => document.querySelectorAll("#dashRank .rbar i").forEach((b) => (b.style.width = b.dataset.w + "%")));
  }

  function renderDashFoot() {
    const T = DASH.totals || {};
    const ST = dashStats();
    const F = DASH.footer || {};
    const lastDay = dashNum((DASH.daily_total || [])[(DASH.daily_total || []).length - 1] || 0);
    const basis = F.basis_date || new Date().toISOString().slice(0, 10);
    const head = DASH.pending
      ? `<b>데이터 근거</b> · 아래 수치는 <b>${DASH.year}학년도 ${esc(DASH.label)} 최종 마감(${String(DASH.as_of || "").replace(/-/g, ".")})</b> 기준입니다 · `
      : "<b>데이터 근거</b> · ";
    const src = F.source_file ? `원천: ${esc(F.source_file)}` : `원천: ${esc(DASH.label)} 접수현황 원자료`;
    const sheets = F.sheets ? ` — ${esc(F.sheets)}` : "";
    const qoNote = T.quota_out_bundle && T.quota_out_bundle !== T.quota_out ? `(요강 학과합 ${dashNum(T.quota_out_bundle)})` : "";
    const nums = `(정원내 모집 ${dashNum(T.quota_in)}·지원 ${dashNum(T.in)} / 정원외 모집 ${dashNum(T.quota_out)}${qoNote}·지원 ${dashNum(T.out)} / 합계 모집 ${dashNum(T.quota_in + T.quota_out)}·지원 ${dashNum(T.all)})`;
    const caveat = F.caveat ? ` · 참고: ${esc(F.caveat)}` : "";
    const todayDef = F.today_definition ? ` · '${esc(F.today_definition)}'` : "";
    const verify = F.verification ? ` · ${esc(F.verification)}` : ` · 학과별 합계 ${lastDay}명 = 전체 일자별 합계 ${lastDay}명 상호 검증`;
    $("dashFoot").innerHTML = `${head}${src}${sheets} ${nums} · 지원율(경쟁률) = 지원 ÷ 모집${caveat}${todayDef}${verify} · 데이터 기준일 ${String(DASH.as_of || "")}${DASH.pending ? " (직전 학년도 마감)" : " (마감)"}${DASH.pending && DASH.upcoming ? ` · 2027 모집인원 정원내 ${dashNum(DASH.upcoming.quota_in)}·정원외 ${dashNum(DASH.upcoming.quota_out)}·합계 ${dashNum(DASH.upcoming.quota_total)}` : ""} / 대시보드 생성 ${basis}`;
  }

  /* ---------- 학과 상세 모달 ---------- */
  let chartLoading = null;
  function ensureChart() {
    if (window.Chart) return Promise.resolve();
    if (chartLoading) return chartLoading;
    const tryLoad = (src) => new Promise((res, rej) => {
      const el = document.createElement("script");
      el.src = src;
      el.onload = () => res();
      el.onerror = () => rej(new Error("chart load failed"));
      document.head.appendChild(el);
    });
    chartLoading = tryLoad("https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js")
      .catch(() => tryLoad("assets/chart.umd.min.js"));
    return chartLoading;
  }

  function openDashModal(d) {
    if (!d) return;
    const ST = dashStats();
    const lastMD = ST.lastMD;
    $("dmTitle").textContent = d.name;
    $("dmMedal").textContent = ST.medalOf[d.name] || "📊";
    $("dmStats").innerHTML = `
      <div class="dstat o"><div class="lb">정원내 모집인원</div><div class="v">${dashNum(d.quota_in)}</div></div>
      <div class="dstat o"><div class="lb">정원내 지원인원</div><div class="v">${dashNum(d.apps_in)}</div></div>
      <div class="dstat"><div class="lb">지원율(경쟁률)</div><div class="v">${d.rate.toFixed(2)}:1</div></div>
      <div class="dstat p"><div class="lb">정원외 지원인원</div><div class="v">${dashNum(d.apps_out)}</div></div>
      <div class="dstat o"><div class="lb">금일(${lastMD}) 접수</div><div class="v">+${dashNum((d.daily_new || [])[ST.LI] || 0)}</div></div>`;
    $("dashModal").classList.add("open");
    const canvas = $("dmChart");
    const old = $("dashModal").querySelector(".dfallback");
    if (old) old.remove();
    if (dashChart) { dashChart.destroy(); dashChart = null; }
    ensureChart().then(() => {
      if (!window.Chart) throw new Error("no chart");
      const labels = (DASH.dates || []).map((x) => String(x).slice(5).replace("-", "."));
      dashChart = new Chart(canvas, {
        data: {
          labels,
          datasets: [
            { type: "bar", label: "일별 신규 (정원내+외)", data: d.daily_new, backgroundColor: "rgba(37,99,235,.40)", borderColor: "#2563EB", borderWidth: 1, borderRadius: 4, yAxisID: "y" },
            { type: "line", label: "누적 (정원내+외)", data: d.daily_cum, borderColor: "#B45309", backgroundColor: "rgba(180,83,9,.07)", fill: true, tension: 0.35, pointRadius: 2, yAxisID: "y1" },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: "#334155", usePointStyle: true } },
            tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${dashNum(c.parsed.y)}명` } },
          },
          scales: {
            x: { ticks: { color: "#626D7C", maxRotation: 0, autoSkip: true }, grid: { display: false } },
            y: { beginAtZero: true, ticks: { color: "#626D7C", callback: (v) => dashNum(v) }, grid: { color: "#EDF1F7" } },
            y1: { position: "right", beginAtZero: true, ticks: { color: "#B45309", callback: (v) => dashNum(v) }, grid: { display: false } },
          },
        },
      });
    }).catch(() => {
      const box = $("dashModal").querySelector(".dchart");
      const p = document.createElement("div");
      p.className = "dfallback";
      p.textContent = "차트 라이브러리(Chart.js)를 불러오지 못했습니다. 일별 신규·누적 값은 표 보기에서 확인할 수 있습니다.";
      box.appendChild(p);
    });
  }
  function closeDashModal() {
    $("dashModal").classList.remove("open");
    if (dashChart) { dashChart.destroy(); dashChart = null; }
  }

  function bindDashControls() {
    const q = $("dashQ");
    if (q && !q.dataset.bound) {
      q.dataset.bound = "1";
      q.addEventListener("input", (e) => { DSTATE.q = e.target.value.trim(); renderDashKpis(); renderDashTiles(); renderDashTable(); });
    }
    const srt = $("dashSort");
    if (srt && !srt.dataset.bound) {
      srt.dataset.bound = "1";
      srt.addEventListener("change", (e) => { DSTATE.sort = e.target.value; renderDashTiles(); renderDashTable(); });
    }
    const vb = $("dashViewBtn");
    if (vb && !vb.dataset.bound) {
      vb.dataset.bound = "1";
      vb.addEventListener("click", () => {
        DSTATE.view = DSTATE.view === "tiles" ? "table" : "tiles";
        vb.textContent = DSTATE.view === "tiles" ? "📋 표로 보기" : "🔲 타일로 보기";
        renderDashTiles();
        renderDashTable();
      });
    }
    const mc = $("dmClose");
    if (mc && !mc.dataset.bound) {
      mc.dataset.bound = "1";
      mc.addEventListener("click", closeDashModal);
      $("dashModal").addEventListener("click", (e) => { if (e.target.id === "dashModal") closeDashModal(); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDashModal(); });
    }
  }

  /* ---------- 실시간 시계(히어로) ---------- */
  function tickClock() {
    const n = new Date();
    const t = $("heroClockTime");
    const d = $("heroClockDate");
    if (t) t.textContent = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(n);
    if (d) d.textContent = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", weekday: "short" }).format(n);
  }
  tickClock();
  setInterval(tickClock, 1000);

  /* ---------- boot ---------- */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error("script load failed: " + src));
      document.head.appendChild(el);
    });
  }
  async function fetchJson(url, ms) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms || 6000);
    try {
      const r = await fetch(url, { cache: "no-cache", signal: ac.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }
  // fetch 가 CORS/샌드박스로 막히면 같은 내용의 .js 미러를 script 로 읽는다.
  // manifest.json/manifest.js 는 파일명이 고정이라 캐시 회피 쿼리를 붙인다(내부 요청 전용 — 주소창 무관).
  async function loadManifest() {
    const bust = "?_=" + Date.now();
    try { return await fetchJson("data/manifest.json" + bust); }
    catch (e) {
      await loadScript("data/manifest.js" + bust);
      if (window.__SITE_MANIFEST__) return window.__SITE_MANIFEST__;
      throw e;
    }
  }
  async function loadBundle(pid, p) {
    try { return await fetchJson(p.data); }
    catch (e) {
      await loadScript(p.data_js || p.data.replace(/\.json$/, ".js"));
      const b = window.__SITE_BUNDLES__ && window.__SITE_BUNDLES__[pid];
      if (b) return b;
      throw e;
    }
  }
  // 첫 화면 대시보드 데이터 — 번들과 같이 JSON → .js 미러 순서로 읽는다(샌드박스 iframe CORS 대비).
  async function loadDash(pid, p) {
    if (!p || !p.dash) return null;
    try { return await fetchJson(p.dash); }
    catch (e) {
      try {
        await loadScript(p.dash_js || p.dash.replace(/\.json$/, ".js"));
        return (window.__SITE_DASH__ || {})[pid] || null;
      } catch (e2) { return null; }
    }
  }

  function setFatal(msg) {
    $("freshDot").className = "dot red";
    $("freshText").textContent = msg;
    const host = $("controls");
    host.classList.remove("hide");
    host.innerHTML = `<span class="chip notice">${esc(msg)}</span>`;
  }

  async function boot() {
    let done = false;
    const watchdog = setTimeout(() => {
      if (!done) setFatal("데이터 응답이 지연되고 있습니다 — 새로고침해 주세요.");
    }, 9000);
    // 캐시 가드의 새 빌드 확인을 먼저 기다린다 — 옛 화면을 그린 뒤 바뀌는 깜빡임 방지(실패 시 3초 후 진행).
    const guard = window.__cacheGuard;
    if (guard && guard.promise) {
      try {
        await Promise.race([guard.promise, new Promise((r) => setTimeout(r, 3000))]);
      } catch (e) { /* 가드 실패는 무시 */ }
      if ((window.__siteGen || 0) !== GEN) { clearTimeout(watchdog); return; } // 문서가 교체됨 — 새 문서가 렌더
    }
    try {
      MANIFEST = (guard && guard.manifest) || (await loadManifest());
    } catch (e) {
      clearTimeout(watchdog);
      setFatal("데이터를 불러오지 못했습니다 — 새로고침해 주세요.");
      return;
    }
    try {
      readUrl();
      if (!S.periodManual) {
        try {
          S.period = (window.PeriodAuto && PeriodAuto.pick(new Date())) || "susi_1";
        } catch (e2) { S.period = "susi_1"; }
        if (!MANIFEST.periods[S.period]) S.period = "susi_1";
      }
      renderPeriodSeg();
      bindMenus();
      await selectPeriod(S.period, true);
      done = true;
      clearTimeout(watchdog);
    } catch (e) {
      clearTimeout(watchdog);
      setFatal("화면을 그리는 중 오류가 발생했습니다 — 새로고침해 주세요.");
    }
  }

  function bindMenus() {
    document.querySelectorAll(".menubar .mtab").forEach((b) => (b.onclick = () => {
      S.menu = b.dataset.menu;
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }));
    $("backBtn").onclick = () => { S.menu = "home"; render(); };
    bindDashControls();
  }

  function renderPeriodSeg() {
    const host = $("periodSeg");
    ["susi_1", "susi_2", "jeongsi"].forEach((k) => {
      const btn = host.querySelector(`[data-period="${k}"]`);
      const p = MANIFEST.periods[k];
      if (!btn || !p) return;
      btn.setAttribute("aria-selected", String(k === S.period));
      const ok = p.status === "available";
      if (!ok && !btn.querySelector(".tg")) {
        const tg = document.createElement("span");
        tg.className = "tg";
        tg.textContent = "데이터 없음";
        btn.appendChild(document.createTextNode(" "));
        btn.appendChild(tg);
      } else if (ok) {
        const tg = btn.querySelector(".tg");
        if (tg) tg.remove();
      }
    });
    host.querySelectorAll("button").forEach((b) => (b.onclick = () => { S.periodManual = true; selectPeriod(b.dataset.period); }));
  }

  /* 사용자가 직접 바꾼 적이 없으면 기간별 기본값(종료 3일 전부터 표시)을 따른다. */
  function applyRatioDefault() {
    if (S.ratioManual) return;
    S.ratio = window.PeriodAuto && PeriodAuto.ratioDefault ? !!PeriodAuto.ratioDefault(S.period) : true;
  }

  async function selectPeriod(id, first) {
    const p = MANIFEST.periods[id];
    if (!p) return;
    S.period = id;
    applyRatioDefault();
    document.querySelectorAll("#periodSeg button").forEach((x) => x.setAttribute("aria-selected", String(x.dataset.period === id)));
    if (p.status !== "available") {
      B = null;
      KINDS = null;
      DASH = null;
      render();
      return;
    }
    try {
      B = CACHE[id] || (CACHE[id] = await loadBundle(id, p));
    } catch (e) {
      $("controls").innerHTML = '<span class="chip">모집시기 데이터를 불러오지 못했습니다.</span>';
      return;
    }
    setYears(B);
    DASH = await loadDash(id, p);
    DSTATE.q = "";
    if ($("dashQ")) $("dashQ").value = "";
    N = Array.isArray(B.slots) ? B.slots.length : 0;
    const mp = MANIFEST.slot_pairs && MANIFEST.slot_pairs[S.period];
    KINDS = Array.isArray(B.slot_kinds) && B.slot_kinds.length === N
      ? B.slot_kinds
      : (mp && Array.isArray(mp.kinds) && mp.kinds.length === N ? mp.kinds : null);
    const exists = (id) => id !== null && B.departments.some((d) => d.dept_id === id);
    if (S.deptId !== null && !exists(S.deptId)) {
      S.deptId = null;
      notice = "요청한 학과 번호가 없어 기본 학과로 표시합니다.";
    }
    if (S.typeDept !== null && !exists(S.typeDept)) {
      S.typeDept = null;
      notice = "요청한 학과 번호가 없어 [전체]로 표시합니다.";
    }
    if (!S.deptId) S.deptId = firstDeptId();
    if (!B.map || !YO.includes(Number(S.mapYear)) || !mapHasRate(Number(S.mapYear))) S.mapYear = mapDefaultYear();
    render();
  }

  function updateHero() {
    const p = MANIFEST.periods[S.period];
    const y0 = YO[0] || 2027;
    const label = p ? p.label : "수시1차";
    const asof = (B && B.as_of) ? String(B.as_of) : "2026-09-30";
    const asofTxt = asof.replace(/-/g, ".") + ".";
    if (S.menu === "home") {
      // 사양서 §4-1: "부천대학교 2027학년도 수시1차 지원현황" · 실시간 시계 · FINAL 배지
      $("heroTitle").innerHTML = `부천대학교 2027학년도 ${esc(label)} <em>지원현황</em>`;
      $("heroSub").textContent = "부천대학 접수 정보 수집 조회 팀 · 학과별 지원율 · 누적인원 조회";
      if (DASH && DASH.pending) {
        $("freshDot").className = "dot amber";
        $("freshText").textContent = `접수 대기 · ${DASH.year}학년도 최종 마감(${String(DASH.as_of || "").replace(/-/g, ".")}) 기준`;
      } else if (DASH && DASH.status === "in_progress") {
        $("freshDot").className = "dot";
        $("freshText").textContent = `접수 마감 · 최신 접수일 ${String(DASH.as_of || "").replace(/-/g, ".")} 기준`;
      } else {
        $("freshDot").className = "dot";
        $("freshText").textContent = "FINAL · 원서접수 마감 확정";
      }
      $("heroClock").hidden = false;
      return;
    }
    $("heroClock").hidden = true;
    $("heroTitle").textContent = `${y0}학년도 ${label} 부천대학교 지원현황`;
    if (y0 === 2027) {
      $("heroSub").textContent = (p && p.status === "available")
        ? `${asofTxt} 기준 · 자료원 접수현황 원자료 · 2026학년도는 확정 마감치`
        : "데이터 없음 · 자료원 접수현황 원자료";
    } else {
      $("heroSub").textContent = (p && p.status === "available")
        ? `${asofTxt} 마감 기준 · 자료원 접수현황 원자료 · 2027학년도는 아직 수집 전`
        : "데이터 없음 · 자료원 접수현황 원자료";
    }
  }

  /* ---------- render ---------- */
  function render() {
    const p = MANIFEST.periods[S.period];
    const home = S.menu === "home";
    const available = !!(B && p && p.status === "available");

    document.querySelectorAll(".mtab").forEach((b) => {
      if (b.dataset.menu === S.menu) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });

    // 상태 토글은 데이터 유무와 무관하게 먼저 수행한다(미수집 시기에서도 내비게이션 동작 보존).
    $("menu-home").classList.toggle("hide", !home);
    $("backBtn").hidden = home;
    const showScreen = !home && available;
    ["daily", "dept", "type"].forEach((m) => $("menu-" + m).classList.toggle("hide", !showScreen || S.menu !== m));
    $("menu-empty").classList.toggle("hide", home || available);
    $("controls").classList.toggle("hide", home || !showScreen);
    updateHero();
    const avail = !!(B && p && p.status === "available");
    if (!home) {
      $("freshDot").className = "dot" + (avail ? "" : " amber");
      $("freshText").textContent = avail
        ? `최종 수집 ${B.as_of || "2026-09-30"} · 데이터 있음`
        : `${p ? p.label : ""} · 데이터 없음`;
    }

    if (home) { renderDash(); return syncUrl(); }
    if (!available) {
      if ($("emptyList")) $("emptyList").hidden = false;
      $("emptyTitle").textContent = "데이터 없음";
      $("emptyState").textContent = p ? `${p.label} · 데이터 없음` : "데이터 없음";
      $("emptyTerm").textContent = "선택한 모집시기의 데이터가 없습니다.";
      return syncUrl();
    }
    renderControls();
    if (S.menu === "daily") { renderKpis(); renderChart(); renderDaily(); }
    if (S.menu === "dept") { renderS1(); renderMap(false); }
    if (S.menu === "type") renderS2();
    syncUrl();
  }

  function renderControls() {
    const host = $("controls");
    const lead = notice ? `<span class="chip notice">${esc(notice)}</span>` : "";
    notice = "";
    if (S.menu === "daily") {
      host.innerHTML = lead + `
        <span class="lab">보기</span>
        <div class="tgl" id="scopeTgl">
          <button data-scope="all" class="${S.scope === "all" ? "on" : ""}">전체</button>
          <button data-scope="dept" class="${S.scope === "dept" ? "on" : ""}">학과별</button>
        </div>
        <span class="ctl-sep"></span>
        <div id="dailyComboHost"></div>
        <span class="ctl-sep"></span>
        <div class="tgl" id="modeTgl">
          <button data-mode="cum" class="${S.mode === "cum" ? "on" : ""}">누계</button>
          <button data-mode="daily" class="${S.mode === "daily" ? "on" : ""}">일별</button>
        </div>`;
      host.querySelectorAll("#scopeTgl button").forEach((b) => (b.onclick = () => {
        S.scope = b.dataset.scope;
        if (S.scope === "dept" && !S.deptId) S.deptId = firstDeptId();
        render();
      }));
      host.querySelectorAll("#modeTgl button").forEach((b) => (b.onclick = () => {
        S.mode = b.dataset.mode;
        host.querySelectorAll("#modeTgl button").forEach((x) => x.classList.toggle("on", x.dataset.mode === S.mode));
        renderChart();
        syncUrl();
      }));
      if (S.scope === "dept") {
        const items = B.departments.slice().sort((a, b) => a.name.localeCompare(b.name, "ko"))
          .map((d) => ({ id: d.dept_id, name: d.name, extra: totalOf(d.dept_id, YO[0]) }));
        makeCombo($("dailyComboHost"), items, S.deptId, (id) => {
          S.deptId = id;
          renderKpis(); renderChart(); renderDaily(); renderControls(); syncUrl();
        });
      }
    } else if (S.menu === "dept") {
      host.innerHTML = lead + `<span class="lab">낮은 지원율 강조</span>
        <label class="switch"><input type="checkbox" id="emphToggle" ${emphOn ? "checked" : ""}/>켜기(정원내 열만)</label>
        <span class="ctl-sep"></span><div class="emphasis-legend" id="emphLegend"></div>`;
      $("emphToggle").onchange = (e) => { emphOn = e.target.checked; renderS1(); renderEmphLegend(); };
      renderEmphLegend();
    } else {
      host.innerHTML = lead + `<span class="lab">학과</span><div id="typeComboHost"></div><span class="ctl-sep"></span>
        <span class="lab">낮은 지원율 강조</span>
        <label class="switch"><input type="checkbox" id="emphToggle" ${emphOn ? "checked" : ""}/>켜기(정원내 열만)</label>
        <span class="ctl-sep"></span><div class="emphasis-legend" id="emphLegend"></div>`;
      $("emphToggle").onchange = (e) => { emphOn = e.target.checked; renderS2(); renderEmphLegend(); };
      renderEmphLegend();
      const items = [{ id: null, name: "전체", extra: null }].concat(
        B.departments.slice().sort((a, b) => a.name.localeCompare(b.name, "ko")).map((d) => ({ id: d.dept_id, name: d.name, extra: null }))
      );
      makeCombo($("typeComboHost"), items, S.typeDept, (id) => { S.typeDept = id; renderS2(); renderControls(); syncUrl(); });
    }
  }

  function renderEmphLegend() {
    const el = $("emphLegend");
    if (!el) return;
    if (!emphOn) { el.innerHTML = "<span>강조 꺼짐 — 숫자만 표시</span>"; return; }
    el.innerHTML = `<span><i class="smp t1">!</i>5.0 이하</span>
      <span><i class="smp t2">!!</i>3.0 이하</span>
      <span>굵게 + 막대 두께로 단계 표시, 3.0 이하는 붉은 글자</span>`;
  }

  /* ---------- 콤보 ---------- */
  function makeCombo(host, items, selectedId, onPick) {
    if (!host) return;
    let activeIdx = -1;
    host.innerHTML = `<div class="combo-wrap">
      <button class="combo-btn" aria-haspopup="listbox" aria-expanded="false">
        <span id="cbLabel">${esc((items.find((i) => i.id === selectedId) || items[0]).name)}</span><span class="caret">▾</span></button>
      <div class="combo-panel"><input class="combo-search" type="text" placeholder="학과명 검색 (예: 간호)" aria-label="학과명 검색"/>
        <div class="combo-list" role="listbox" aria-label="학과 목록"></div></div></div>`;
    const wrap = host.querySelector(".combo-wrap");
    const btn = wrap.querySelector(".combo-btn");
    const panel = wrap.querySelector(".combo-panel");
    const search = wrap.querySelector(".combo-search");
    const list = wrap.querySelector(".combo-list");
    const label = wrap.querySelector("#cbLabel");

    const draw = (q) => {
      q = (q || "").trim();
      const f = items.filter((i) => i.name.includes(q));
      list.innerHTML = f.length ? f.map((i) => {
        const sel = i.id === selectedId ? 'aria-selected="true"' : "";
        return `<div class="combo-opt" ${sel} data-id="${i.id === null ? "" : i.id}" data-name="${esc(i.name)}" role="option">
          <span>${esc(i.name)}<span class="chk" style="margin-left:5px">${sel ? "✓" : ""}</span></span>
          <span>${i.extra !== null && i.extra !== undefined ? `<span class="rnk">${YO[0]}</span><span class="n${ycOf(YO[0])}">${fmt(i.extra)}</span>` : ""}</span></div>`;
      }).join("") : '<div class="combo-opt"><span class="none">일치하는 학과가 없습니다</span></div>';
      activeIdx = -1;
      list.querySelectorAll(".combo-opt[data-name]").forEach((el) => {
        el.onclick = () => {
          const raw = el.dataset.id;
          selectedId = raw === "" ? null : Number(raw);
          label.textContent = el.dataset.name;
          panel.classList.remove("open"); btn.setAttribute("aria-expanded", "false");
          onPick(selectedId);
        };
      });
    };
    const open = () => {
      const isOpen = panel.classList.toggle("open");
      btn.setAttribute("aria-expanded", String(isOpen));
      if (isOpen) { search.value = ""; draw(""); search.focus(); }
    };
    btn.onclick = open;
    search.oninput = () => draw(search.value);
    search.onkeydown = (e) => {
      const opts = Array.from(list.querySelectorAll(".combo-opt[data-name]"));
      if (e.key === "Escape") { panel.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); btn.focus(); return; }
      if (e.key === "Enter") { const a = list.querySelector(".combo-opt.active[data-name]") || opts[0]; if (a) a.click(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!opts.length) return;
        activeIdx = e.key === "ArrowDown" ? Math.min(activeIdx + 1, opts.length - 1) : Math.max(activeIdx - 1, 0);
        opts.forEach((o) => o.classList.remove("active"));
        opts[activeIdx].classList.add("active");
        opts[activeIdx].scrollIntoView({ block: "nearest" });
      }
    };
  }

  /* ---------- 공통 조회 ---------- */
  // 모집인원: 학과상세는 {정원내,정원외,합계,입학정원}, 전체(all_departments)는 스칼라.
  function cumRateCell(v, yc) {
    if (v === null || v === undefined || !isFinite(v)) return `<td class="rate muted0${yc ? " " + yc : ""}" title="모집 인원 없음 또는 값 없음" aria-label="값 없음">-</td>`;
    return `<td class="rate${yc ? " " + yc : ""}" title="누계 지원율 = 누계 ÷ 모집인원" aria-label="누계 지원율 ${v.toFixed(1)}:1">${v.toFixed(1)}:1</td>`;
  }
  function cumDelta(v) {
    if (v === null || v === undefined || !isFinite(v)) return '<span class="flat" title="값 없음">-</span>';
    const r = Math.round(v * 10) / 10;
    if (r === 0) return '<span class="zero">0.0</span>';
    return `<span class="${r > 0 ? "up" : "down"}"><span class="arr">${r > 0 ? "▲" : "▼"}</span>${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}</span>`;
  }
  function qTotal(det, y) {
    const yd = det && det.years[String(y)];
    if (!yd) return null;
    const q = yd["모집인원"];
    if (q === null || q === undefined) return null;
    return typeof q === "object" ? (q["합계"] ?? null) : q;
  }
  function qParts(det, y) {
    const yd = det && det.years[String(y)];
    const q = yd ? yd["모집인원"] : null;
    if (q === null || q === undefined) return { 합계: null, 정원내: null, 정원외: null };
    return typeof q === "object" ? q : { 합계: q, 정원내: null, 정원외: null };
  }
  const prevQuota = (det, y) => (PREV[y] ? qTotal(det, PREV[y]) : null);
  function groupHeader(yr, det) {
    const yd = det.years[String(yr)];
    const q = qTotal(det, yr);
    const pq = prevQuota(det, yr);
    let note = "";
    if (q !== null) {
      note = `모집 ${fmt(q)}명`;
      if (pq !== null) { const d = q - pq; note += ` (전년대비 ${d === 0 ? "0" : (d > 0 ? "+" : "−") + Math.abs(d)} )`; }
    }
    return `<th class="g${ycOf(yr)}" colspan="${spanOf(yr)}">${yr}학년도${note ? `<span class="grpnote">· ${note}</span>` : ""}</th>`;
  }

  /* ---------- KPI / 차트 ---------- */
  function totalOf(deptId, year) {
    const det = deptId === "all" ? B.all_departments : B.dept_detail[String(deptId)];
    if (!det || !det.years[String(year)]) return null;
    return det.years[String(year)]["최종합계"];
  }

  /* 학과 목록은 콤보와 같은 가나다순 — 첫 항목이 기본 선택값이다. */
  function deptList() {
    return B.departments.slice().sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }
  function firstDeptId() {
    const l = deptList();
    return l.length ? l[0].dept_id : null;
  }
  /* 일자별 화면에서 [학과별]을 고른 상태 = 통계·차트도 그 학과 기준. */
  function viewCtx() {
    const on = S.menu === "daily" && S.scope === "dept" && S.deptId !== null;
    const dept = on ? B.departments.find((d) => d.dept_id === S.deptId) || null : null;
    const det = on ? B.dept_detail[String(S.deptId)] || null : null;
    return { on: !!(on && det), dept, det };
  }
  function viewTotals() {
    const v = viewCtx();
    const src = v.det || B.all_departments;
    const out = {};
    YO.forEach((y) => {
      const yd = src && src.years[String(y)];
      out[y] = yd ? yd["최종합계"] : null;
    });
    return out;
  }
  /* 슬롯 길이 N 배열로 맞춘 시리즈. 구조적 빈칸의 누계는 직전값으로 수평 유지(보간·0 처리 없음). */
  function seriesOf(det, y, cumMode) {
    const arr = new Array(N).fill(null);
    if (!det) return arr;
    const yd = det.years[String(y)];
    if (!yd) return arr;
    yd.rows.forEach((r) => {
      if (r.slot_index == null || r.slot_index < 0 || r.slot_index >= N) return;
      const n = cumMode ? r.cum : r.daily;
      arr[r.slot_index] = n === undefined ? null : n;
    });
    const pres = B.slot_present[String(y)];
    if (cumMode && Array.isArray(pres)) {
      let last = null;
      for (let i = 0; i < N; i++) {
        if (arr[i] !== null) last = arr[i];
        else if (!pres[i] && last !== null) arr[i] = last;
      }
    }
    return arr;
  }
  function kpiDelta(d, p) {
    if (d === null || d === undefined) return '<span class="flat">-</span>';
    if (d === 0) return '<span class="zero">0 (0.0%)</span>';
    const cls = d > 0 ? "up" : "down";
    const sign = d > 0 ? "▲ +" : "▼ −";
    return `<span class="${cls}">${sign}${fmt(Math.abs(d))} (${p === null || p === undefined ? "-" : pctv(p, 1)})</span>`;
  }
  function renderKpis() {
    const v = viewCtx();
    const t = viewTotals();
    const y0 = YO[0], y1 = YO[1], y2 = YO[2];
    const yv = (y) => (y === undefined ? null : t[y]);
    const a0 = yv(y0), a1 = yv(y1), a2 = yv(y2);
    const d1 = (a0 !== null && a1 !== null) ? a0 - a1 : null;
    const p1 = (d1 !== null && a1) ? (d1 / a1) * 100 : null;
    const d2 = (a1 !== null && a2 !== null) ? a1 - a2 : null;
    const p2 = (d2 !== null && a2) ? (d2 / a2) * 100 : null;
    const q = qParts(v.det || B.all_departments, y0);
    const qIn = q["정원내"] !== null && q["정원내"] !== undefined ? q["정원내"] : (v.on ? null : B.s1_sum.in[0]);
    const s1row = v.on && v.dept ? B.s1[String(v.dept.dept_id)] : null;
    const scopeName = v.on && v.dept ? v.dept.name : "전체 학과";
    const late = 2027 > y0 ? `<span class="chip notice">2027학년도는 아직 수집 전 — ${y0}학년도 기준</span>` : "";
    $("kpiScope").innerHTML = `<span class="lab">기준</span><b>${esc(scopeName)}</b>`
      + `<span>${v.on ? "일자별 표·차트와 같은 학과 데이터입니다" : "34개 학과 합계입니다"}</span>` + late;
    const cards = [];
    if (y0 !== undefined) cards.push(`<div class="kpi k${ycOf(y0)}"><div class="k">총 접수인원 <span class="pill">${y0}</span></div><div class="v">${fmt(a0)}</div>
        <div class="sub">${kpiDelta(d1, p1)} ${y1 || "-"} 대비</div></div>`);
    if (y1 !== undefined) cards.push(`<div class="kpi k${ycOf(y1)}"><div class="k">총 접수인원 <span class="pill">${y1}</span></div><div class="v">${fmt(a1)}</div>
        <div class="sub">${y2 !== undefined ? kpiDelta(d2, p2) + " " + y2 + " 대비" : '<span style="color:var(--mute)">기준연도</span>'}</div></div>`);
    if (y2 !== undefined) cards.push(`<div class="kpi k${ycOf(y2)}"><div class="k">총 접수인원 <span class="pill">${y2}</span></div><div class="v">${fmt(a2)}</div>
        <div class="sub" style="color:var(--mute)">기준연도</div></div>`);
    const qMissing = q["합계"] === null || q["합계"] === undefined;
    cards.push(`<div class="kpi"><div class="k">모집인원(정원내+외)</div><div class="v">${qMissing ? '<span style="font-size:18px;color:var(--mute)">미확보</span>' : fmt(q["합계"])}</div>
        <div class="sub">${qMissing
          ? "모집인원 미확보 — 추정치를 쓰지 않고 지원 건수만 표시"
          : v.on
            ? (s1row ? `정원내 ${fmt(s1row["in"][0])} · 정원외 ${fmt(s1row["out"][0])}` : "학과 모집인원(정원내+외)")
            : (y0 < 2027
              ? `정원내 ${fmt(q["정원내"])} · 정원외 ${fmt(q["정원외"])}`
              : `<span class="badge badge-empty" style="font-size:10.5px">잠정</span> 정원내 ${fmt(qIn)} · 재외국민2호 포함`)}</div></div>`);
    $("kpis").innerHTML = cards.join("");
  }

  let CLAST = null;

  function renderChart() {
    const cumMode = S.mode === "cum";
    const v = viewCtx();
    const src = v.det || B.all_departments;
    // 차트는 표의 2025 접기/펼치기와 무관하게 항상 3개년을 보여 준다.
    const years = YO.slice();
    const vals = {};
    years.forEach((y) => { vals[y] = seriesOf(src, y, cumMode); });
    const flat = years.flatMap((y) => vals[y]).filter((n) => n !== null && n !== undefined);
    const rawMax = flat.length ? Math.max.apply(null, flat) : 0;
    // 축 눈금 — 값 규모에 맞춰 4칸 내외로 잡는다(학과 선택 시 선이 바닥에 붙지 않도록).
    const tgt = Math.max(rawMax, 1) / 4;
    const pow10 = Math.pow(10, Math.floor(Math.log10(tgt)));
    const ystep = [1, 2, 2.5, 5, 10].map((m) => m * pow10).find((c) => c >= tgt) || 10 * pow10;
    const ymax = Math.max(ystep, Math.ceil(rawMax / ystep) * ystep);
    const W = 1120, H = 300, PL = 66, PR = 104, PT = 46, PB = 44;
    const X = (i) => PL + ((W - PL - PR) * i) / (N - 1);
    const Y = (n) => PT + (H - PT - PB) * (1 - n / ymax);
    const scopeName = v.on && v.dept ? v.dept.name : "";

    let s = `<svg class="curve" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc((scopeName ? scopeName + " " : "") + years.join("·") + "학년도 " + (cumMode ? "누계" : "일별") + " 접수 추이")}">`;
    // 시작 3일 / 마감 3일 앵커 띠
    const bw = ((W - PL - PR) * 2) / (N - 1);
    s += `<rect class="band" x="${PL - bw / 2}" y="${PT}" width="${bw}" height="${H - PT - PB}"/>`;
    s += `<rect class="band" x="${X(N - 3) - bw / 2}" y="${PT}" width="${bw}" height="${H - PT - PB}"/>`;
    for (let g = 0; g <= ymax + 1e-9; g += ystep) {
      s += `<line class="grid" x1="${PL}" y1="${Y(g)}" x2="${W - PR}" y2="${Y(g)}"/>`;
      s += `<text class="ytick" x="${PL - 8}" y="${Y(g) + 4}" text-anchor="end">${g.toLocaleString("ko-KR")}</text>`;
    }
    // 구조적 빈칸 눈금
    years.forEach((y) => {
      const pres = B.slot_present[String(y)] || [];
      pres.forEach((p, i) => {
        if (!p) s += `<line class="blankmark" x1="${X(i)}" y1="${PT}" x2="${X(i)}" y2="${H - PB}"/><text class="blanklab" x="${X(i)}" y="${PT - 8}" text-anchor="middle">빈칸(${y})</text>`;
      });
    });
    // 계열(선 + 점)
    const ends = [];
    years.forEach((y) => {
      const arr = vals[y], col = colOf(y);
      const segs = []; let cur = [];
      arr.forEach((n, i) => {
        if (n === null || n === undefined) { if (cur.length) segs.push(cur); cur = []; }
        else cur.push([X(i), Y(n)]);
      });
      if (cur.length) segs.push(cur);
      segs.forEach((sg) => {
        s += `<polyline points="${sg.map((q) => q[0].toFixed(1) + "," + q[1].toFixed(1)).join(" ")}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"${Number(y) === YO[YO.length - 1] ? ' stroke-dasharray="7 4"' : ""}/>`;
      });
      arr.forEach((n, i) => {
        if (n !== null && n !== undefined) s += `<circle class="pt" cx="${X(i).toFixed(1)}" cy="${Y(n).toFixed(1)}" r="2.2" fill="${col}"/>`;
      });
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i] !== null && arr[i] !== undefined) { ends.push({ y, x: X(i), oy: Y(arr[i]), py: Y(arr[i]) }); break; }
      }
    });
    // 끝점 이름 라벨 — 겹치면 아래로 밀어 배치
    ends.sort((a, b) => a.oy - b.oy);
    for (let i = 1; i < ends.length; i++) if (ends[i].py - ends[i - 1].py < 16) ends[i].py = ends[i - 1].py + 16;
    ends.forEach((e) => {
      if (Math.abs(e.py - e.oy) > 0.6) s += `<line x1="${e.x + 4}" y1="${e.oy}" x2="${W - PR + 6}" y2="${e.py}" stroke="${colOf(e.y)}" stroke-width="1" opacity=".45"/>`;
      s += `<circle cx="${e.x}" cy="${e.oy}" r="3.4" fill="${colOf(e.y)}" stroke="#fff" stroke-width="1.4"/>`;
      s += `<text class="endlab" x="${W - PR + 9}" y="${e.py + 4}" text-anchor="start" fill="${colOf(e.y)}">${e.y}</text>`;
    });
    s += `<line class="axis" x1="${PL}" y1="${H - PB}" x2="${W - PR}" y2="${H - PB}"/>`;
    for (let i = 0; i < N; i++) {
      const lab = B.slots[i]; let cls = "xlab";
      if (/일차/.test(lab) || /^D-/.test(lab)) cls += " anchor-start";
      if (/^M/.test(lab) && Number(lab.slice(1)) % 2 === 0) continue;
      s += `<text class="${cls}" x="${X(i)}" y="${H - PB + 17}" text-anchor="middle">${lab}</text>`;
    }
    s += `<text class="bandlab" x="${PL}" y="${PT - 12}" text-anchor="start">시작 3일</text>`;
    s += `<text class="bandlab" x="${W - PR}" y="${PT - 12}" text-anchor="end">마감 3일</text>`;
    // 호버 레이어
    s += `<g id="hov" style="display:none"><line id="hovline" class="hovline" x1="0" x2="0" y1="${PT}" y2="${H - PB}"/>`;
    years.forEach((y) => { s += `<circle class="hovdot" data-hy="${y}" r="4.6" cx="0" cy="0" fill="${colOf(y)}" stroke="#fff" stroke-width="1.6"/>`; });
    s += `</g>`;
    s += `<rect id="hit" x="0" y="0" width="${W}" height="${H}" fill="transparent" style="cursor:crosshair"/>`;
    s += `</svg><div class="ctip" id="ctip" hidden></div>`;
    $("chart").innerHTML = s;

    CLAST = { years, vals, X, Y, W, PL, PR, PT, PB, H, cumMode };
    const hit = $("chart").querySelector("#hit");
    hit.addEventListener("pointermove", onChartMove);
    hit.addEventListener("pointerleave", onChartLeave);

    $("chartTitle").innerHTML = `${scopeName ? esc(scopeName) + " " : ""}${S.period === "susi_1" ? "수시1차 " : ""}${years.length}개년 추이 <span class="pill">슬롯 정렬</span>`;
    const t = viewTotals();
    const asc = years.slice().sort((a, c) => a - c);
    $("chartSub").textContent = `${scopeName ? scopeName + " · " : ""}최종 누계 ${asc.map((y) => y + " " + fmt(t[y])).join(" → ")} · 표시 순서 ${years.join(" → ")}`
      + (2027 > years[0] ? ` · 2027학년도는 아직 수집 전(${years[0]}학년도 기준)` : "");
    $("chartLegend").innerHTML = years.map((y) => (Number(y) === YO[YO.length - 1]
      ? `<span><i class="dash-s" style="color:${colOf(y)}"></i>${y}학년도</span>`
      : `<span><i class="dot-s" style="background:${colOf(y)}"></i>${y}학년도</span>`)).join("");
    $("chartFoot").textContent = cumMode
      ? `※ 빈칸(${years[1] !== undefined ? years[1] : "-"})은 누계를 직전값으로 수평 유지하고 점선으로 눈금 표시 — 보간·0 처리하지 않습니다. 선 위에 마우스를 올리면 해당 슬롯의 ${years.length}개년 값이 함께 나옵니다.`
      : `※ 빈칸(${years[1] !== undefined ? years[1] : "-"})은 구조적 빈 슬롯이므로 일별 선을 끊어 표시합니다 — 0으로 그리지 않습니다. 선 위에 마우스를 올리면 해당 슬롯의 ${years.length}개년 값이 함께 나옵니다.`;
  }

  function chartTipHtml(i) {
    const v = viewCtx();
    const src = v.det || B.all_departments;
    const rows = CLAST.years.map((y) => {
      const n = CLAST.vals[y][i];
      const yd = src.years[String(y)];
      const r = yd ? yd.rows.find((x) => x.slot_index === i) : null;
      const d = r && r.apply_date ? r.apply_date.slice(5) : "";
      return `<div class="ctip-row"><i style="background:${colOf(y)}"></i><span class="nm">${y}학년도</span><span class="dt">${d}</span><b>${n === null || n === undefined ? "-" : fmt(n)}</b></div>`;
    }).join("");
    return `<div class="ctip-h">${esc(B.slots[i])} · ${CLAST.cumMode ? "누계" : "일별"}</div>` + rows;
  }

  function onChartMove(e) {
    if (!CLAST) return;
    const wrap = $("chart"), svg = wrap.querySelector("svg");
    const r = svg.getBoundingClientRect();
    if (!r.width) return;
    const px = ((e.clientX - r.left) / r.width) * CLAST.W;
    const stepX = (CLAST.W - CLAST.PL - CLAST.PR) / (N - 1);
    let i = Math.round((px - CLAST.PL) / stepX);
    i = Math.max(0, Math.min(N - 1, i));
    const lx = CLAST.X(i);
    const g = wrap.querySelector("#hov");
    g.style.display = "";
    const line = wrap.querySelector("#hovline");
    line.setAttribute("x1", lx); line.setAttribute("x2", lx);
    CLAST.years.forEach((y) => {
      const c = wrap.querySelector('[data-hy="' + y + '"]');
      const n = CLAST.vals[y][i];
      if (n === null || n === undefined) { c.setAttribute("opacity", "0"); return; }
      c.setAttribute("opacity", "1");
      c.setAttribute("cx", lx); c.setAttribute("cy", CLAST.Y(n));
    });
    const tip = wrap.querySelector("#ctip");
    tip.hidden = false;
    tip.innerHTML = chartTipHtml(i);
    const cw = wrap.clientWidth, tw = tip.offsetWidth || 168, th = tip.offsetHeight || 96;
    const anchorPx = (lx / CLAST.W) * cw;
    let left = anchorPx + 16;
    if (left + tw > cw - 4) left = anchorPx - tw - 16;
    let top = e.clientY - r.top + 14;
    top = Math.max(4, Math.min(top, Math.max(4, r.height - th - 6)));
    tip.style.left = Math.max(4, Math.min(left, Math.max(4, cw - tw - 4))) + "px";
    tip.style.top = top + "px";
  }

  function onChartLeave() {
    const wrap = $("chart");
    const g = wrap.querySelector("#hov");
    if (g) g.style.display = "none";
    const tip = wrap.querySelector("#ctip");
    if (tip) tip.hidden = true;
  }

  /* ---------- 엑셀 내보내기 ---------- */
  function cellExportText(cell) {
    const clone = cell.cloneNode(true);
    clone.querySelectorAll(".mk").forEach((n) => n.remove());
    clone.querySelectorAll(".grpnote").forEach((n) => { n.textContent = " " + n.textContent; });
    return clone.textContent.replace(/\s+/g, " ").trim();
  }
  function tableToAoa(tbl) {
    if (!tbl) return { aoa: [], merges: [] };
    const rows = [...tbl.querySelectorAll("thead tr"), ...tbl.querySelectorAll("tbody tr"), ...tbl.querySelectorAll("tfoot tr")];
    const grid = [];
    const merges = [];
    const cn = (n) => {
      let t = "";
      while (n > 0) { const m = (n - 1) % 26; t = String.fromCharCode(65 + m) + t; n = Math.floor((n - 1) / 26); }
      return t;
    };
    rows.forEach((tr, ri) => {
      grid[ri] = grid[ri] || [];
      let c = 0;
      [...tr.children].forEach((cell) => {
        while (grid[ri][c] !== undefined) c++;
        const cs = cell.colSpan || 1, rs = cell.rowSpan || 1;
        const txt = cellExportText(cell);
        if (cs > 1 || rs > 1) {
          merges.push(cn(c + 1) + (ri + 1) + ":" + cn(c + cs) + (ri + rs));
        }
        for (let r = 0; r < rs; r++) {
          grid[ri + r] = grid[ri + r] || [];
          for (let k = 0; k < cs; k++) grid[ri + r][c + k] = (r === 0 && k === 0) ? txt : "";
        }
        c += cs;
      });
    });
    return { aoa: grid.filter((r) => r.length), merges };
  }
  function aoaWidths(aoa) {
    const w = [];
    aoa.forEach((r) => r.forEach((v, i) => {
      const n = String(v === null || v === undefined ? "" : v).length + 2;
      w[i] = Math.max(w[i] || 9, Math.min(32, n));
    }));
    return w;
  }
  function exportScopeName(menu) {
    if (menu === "daily" && S.scope === "dept") return deptNameOf(S.deptId);
    if (menu === "type" && S.typeDept) return deptNameOf(S.typeDept);
    return "전체";
  }
  function deptNameOf(id) {
    const d = B.departments.find((x) => x.dept_id === id);
    return d ? d.name : "전체";
  }
  function downloadTable(tblId, tag, menu) {
    const { aoa, merges } = tableToAoa($(tblId));
    if (!aoa.length) return;
    const p = MANIFEST.periods[S.period];
    const label = (p && p.label) || "수시1차";
    const who = exportScopeName(menu);
    const asof = (B.as_of || "").replace(/-/g, "");
    const sheet = `${label}_${tag}_${who}`.slice(0, 31);
    const file = `부천대_${YO[0]}_${label}_${tag}_${who}_${asof}.xlsx`;
    XLSX_LITE.download([{ name: sheet, aoa, merges, widths: aoaWidths(aoa), freeze: 2 }], file);
  }
  function dlButtonHtml(id, label) {
    return `<button class="dl-btn" id="${id}" type="button">${label || "엑셀 다운로드"}</button>`;
  }

  /* 미수집 연도 표시 블록 — 번들 placeholder_years 계약(접수일자만, 수치 빈칸).
     데이터 연도(YO)와 분리해 차트·KPI·사분면은 건드리지 않는다. */
  function phOf(y) {
    const list = (B && B.placeholder_years) || [];
    return list.find((p) => Number(p.year) === Number(y)) || null;
  }
  function tableYears() {
    const ys = YO.slice();
    ((B && B.placeholder_years) || []).forEach((p) => {
      const y = Number(p.year);
      if (!ys.includes(y)) ys.push(y);
    });
    return ys.sort((a, c) => c - a);
  }
  function phDayBlock(y, i) {
    const d = (phOf(y).dates || [])[i];
    return `<td class="date bg-ph">${d ? dateLabel(d, true) : ""}</td>`
      + Array.from({ length: 5 }, () => '<td class="bg-ph"></td>').join("");
  }

  /* ---------- 일자별 표 (시트3 전체 / 시트4 학과별) ---------- */
  function renderDaily() {
    const isDept = S.scope === "dept";
    const deptObj = isDept ? B.departments.find((d) => d.dept_id === S.deptId) : null;
    const det = isDept ? (deptObj ? B.dept_detail[String(S.deptId)] : null) : B.all_departments;
    const name = isDept ? (deptObj ? deptObj.name : "") : "전체";
    if (isDept && !det) {
      $("dailyTitle").innerHTML = '일자별 지원현황 — 학과 없음';
      $("dailySub").textContent = "요청한 학과 번호를 찾을 수 없습니다. 콤보리스트에서 학과를 다시 선택해 주세요.";
      const t0 = $("xl-daily");
      t0.querySelector("thead").innerHTML = "";
      t0.querySelector("tbody").innerHTML = '<tr><td style="text-align:center;padding:28px;color:var(--muted)">표시할 학과가 없습니다 — 콤보리스트에서 학과를 선택하세요.</td></tr>';
      t0.querySelector("tfoot").innerHTML = "";
      return;
    }
    $("dailyTitle").innerHTML = `일자별 지원현황 — ${esc(name)}`;
    const tools = $("dailyTools");
    // 마지막(비교) 연도 접기/펼치기 — 수시1차와 같은 틀. 3개년은 기본 접힘,
    // 2개년(수시2차·정시)은 그 해가 유일한 비교 연도라 기본 펼침.
    const TY = tableYears();
    const lastY = TY.length >= 2 ? TY[TY.length - 1] : null;
    const expanded = TY.length > 2 ? S.y25 : !S.y25;
    tools.innerHTML = (lastY ? `<button class="btn-ghost" id="y25Btn" type="button" aria-expanded="${expanded}">${expanded ? lastY + "학년도 접기 ◀" : lastY + "학년도 펼쳐 보기 ▶"}</button>` : "")
      + `<button class="toggle-btn${S.ratio ? " on" : ""}" id="ratioBtn" type="button" aria-pressed="${S.ratio}">일자별 지원비율 보기</button>`
      + dlButtonHtml("dlDaily");
    $("ratioBtn").onclick = () => {
      S.ratio = !S.ratio;
      S.ratioManual = true;
      renderDaily();
      syncUrl();
    };
    $("dlDaily").onclick = () => downloadTable("xl-daily", "일자별", "daily");
    if ($("y25Btn")) $("y25Btn").onclick = () => { S.y25 = !S.y25; renderDaily(); syncUrl(); };
    const dp = MANIFEST.periods[S.period];
    $("dailySub").textContent = `${YO[0]}학년도 ${dp ? dp.label : "수시1차"} 일자별 지원 현황(정원내+외) — ${name} · ${dateLabel(B.as_of)} 마감 기준 · 슬롯 정렬 · 단위: 명`
      + (2027 > YO[0] ? " · 2027학년도는 아직 수집 전" : "")
      + ((B.placeholder_years || []).length ? " · 2027학년도 열은 접수일자만 표시(수치 미수집)" : "");
    const hint = $("dailyHint");
    if (hint) {
      const cn = ["파랑", "회색", "갈색"];
      hint.innerHTML = `↔ 가로 스크롤 · <b>슬롯</b> 열 고정 · 차트 선: ${YO.map((y, i) => `${y} ${cn[i] || "점선"}${i === YO.length - 1 ? " 점선" : ""}`).join(" · ")}`
        + ` · 전년비(%)는 누계 ÷ 전년 누계 × 100 · 전년비는 같은 n일차(1일차↔1일차)끼리 비교합니다.`;
    }
    if (!det) return;

    const SHOW = lastY ? (expanded ? TY.slice() : TY.slice(0, TY.length - 1)) : TY.slice();
    const hd = SHOW.map((y) => (phOf(y)
      ? `<th class="gph" colspan="6">${y}학년도<span class="grpnote">· 미수집(접수일자만)</span></th>`
      : groupHeader(y, det))).join("");
    const subCols = SHOW.map((y) => {
      const c = phOf(y) ? "cph" : "c" + ycOf(y);
      const six = phOf(y) || PREV[y];
      return `<th class="${c}">접수일자</th><th class="${c}">일별</th><th class="${c}">누계</th><th class="${c}">누계 지원율</th>`
        + (six ? `<th class="${c}">전년비(%)</th><th class="${c}">지원율 변동</th>` : "");
    }).join("");
    const thead = `<tr class="grp"><th class="sc" rowspan="2">슬롯</th>
      ${hd}
      ${S.ratio ? `<th class="gratio" colspan="${SHOW.length}">일자별 지원 비율</th>` : ""}</tr>
      <tr class="sub">
        ${subCols}
        ${S.ratio ? SHOW.map((y) => `<th class="cr">${y} 비율</th>`).join("") : ""}</tr>`;

    let body = "";
    for (let i = 0; i < N; i++) {
      const anchor = isAnchorSlot(i, N);
      const kind = slotKind(i, N);
      const nextKind = i + 1 < N ? slotKind(i + 1, N) : null;
      const boundary = (kind === "start" && nextKind === "mid") || (kind === "mid" && nextKind === "end");
      body += `<tr class="${boundary ? "anchor-bottom" : ""}" data-anchor="${anchor ? 1 : 0}" data-kind="${kind}"><td class="sc">${B.slots[i]}</td>`;
      SHOW.forEach((y) => { body += phOf(y) ? phDayBlock(y, i) : dayBlock(det, y, i, anchor); });
      if (S.ratio) {
        // 비율 = 그 일차 접수 수 ÷ 해당 학년도 합계 × 100 (2027 분모 = 오늘까지 누계)
        SHOW.forEach((y) => {
          if (phOf(y)) { body += '<td></td>'; return; }
          const r = rowOf(det, y, i);
          const total = det.years[String(y)] ? det.years[String(y)]["최종합계"] : null;
          const v = r && total ? (r.daily / total) * 100 : null;
          body += `<td>${v === null ? '<span class="flat">-</span>' : v.toFixed(2) + "%"}</td>`;
        });
      }
      body += "</tr>";
    }

    // 최종합계 / 총 접수일수
    let tf = '<tr class="total"><td class="sc tot-lab">최종합계</td>';
    SHOW.forEach((y) => {
      if (phOf(y)) { tf += '<td class="date bg-ph" colspan="6"></td>'; return; }
      tf += totalBlock(det, y);
    });
    if (S.ratio) tf += SHOW.map((y) => (phOf(y) ? "<td></td>" : "<td>100.00%</td>")).join("");
    tf += '</tr>';
    const days = (y) => (det.years[String(y)] ? det.years[String(y)]["총접수일수"] : null);
    let df = '<tr><td class="sc tot-lab">총 접수일수</td>';
    SHOW.forEach((y) => {
      const yc = "bg-y" + ycOf(y);
      if (phOf(y)) {
        // 미수집 블록: 접수일자 수만 (0으로 채우지 않음)
        df += `<td class="date bg-ph">총 접수일수</td><td class="bg-ph">${(phOf(y).dates || []).length}</td><td class="bg-ph">일</td><td class="bg-ph"></td><td colspan="2" class="bg-ph"></td>`;
        return;
      }
      df += `<td class="date ${yc}">총 접수일수</td><td class="${yc}">${days(y) ?? "-"}</td><td class="${yc}">일</td><td class="${yc}"></td>`;
      // 전년비(%)는 누계 지수와 같은 방식(당해 ÷ 전년 × 100)으로 맞춘다.
      if (PREV[y]) df += `<td class="${yc}">${days(PREV[y]) ? ((days(y) / days(PREV[y])) * 100).toFixed(2) + "%" : ""}</td><td class="${yc}"></td>`;
    });
    if (S.ratio) df += SHOW.map(() => "<td></td>").join("");
    df += "</tr>";

    const t = $("xl-daily");
    t.querySelector("thead").innerHTML = thead;
    t.querySelector("tbody").innerHTML = body;
    t.querySelector("tfoot").innerHTML = tf + df;
  }

  function rowOf(det, y, i) {
    const yd = det.years[String(y)];
    return yd ? yd.rows.find((r) => r.slot_index === i) : null;
  }
  function yoyOf(det, y, i) {
    const yy = det.yoy[String(y)];
    return yy ? yy.rows.find((r) => r.slot_index === i) : null;
  }
  function dayBlock(det, y, i, anchor) {
    const yc = "bg-y" + ycOf(y);
    const yd = det.years[String(y)];
    if (!yd) return `<td class="blank ${yc}" colspan="${spanOf(y)}" title="해당 학년도 데이터 없음" aria-label="데이터 없음">-</td>`;
    const r = rowOf(det, y, i);
    if (!r) return `<td class="blank ${yc}" colspan="${spanOf(y)}" title="빈 슬롯(접수일 아님)" aria-label="빈 슬롯">-</td>`;
    const q = qTotal(det, y);
    let h = `<td class="date ${yc}">${dateLabel(r.apply_date, true)}</td><td class="${yc}">${fmt(r.daily)}</td><td class="${yc}">${fmt(r.cum)}</td>` + (r["지원율"] != null ? rateCell(r["지원율"], q, false, yc, 2) : cumRateCell(q && r.cum ? r.cum / q : null, yc));
    const MASK = (n, why) => Array.from({ length: n }, () => `<td class="yoy cmp masked flat ${yc}" title="${why}" aria-label="${why}">-</td>`).join("");
    if (PREV[y]) {
      // 모든 일차에 전년 비교를 표시한다(2026-10-26). 전년도에 같은 일차가 없을 때만 '-' + 사유.
      const py = PREV[y];
      const pr = py && det.years[String(py)] ? rowOf(det, py, i) : null;
      if (!pr) return h + MASK(2, `전년(${py}) 동일 일차 값 없음`);
      // 전년비(%) = 당해 누계 ÷ 전년 누계 × 100 (지수). 전년비 일별 열은 제거하고 여기로 합쳤다.
      const pc = pr.cum ? (r.cum / pr.cum) * 100 : null;
      const pv = (r["지원율"] != null && pr["지원율"] != null) ? r["지원율"] - pr["지원율"] : null;
      h += `<td class="yoy cmp ${yc}">${pc === null ? '<span class="flat">-</span>' : pc.toFixed(2) + "%"}</td>`;
      let pvCell;
      if (r["지원율"] != null && pr["지원율"] != null) pvCell = rateDelta(r["지원율"] - pr["지원율"]);
      else {
        const pq = qTotal(det, py);
        pvCell = cumDelta(q && pq && pr.cum ? r.cum / q - pr.cum / pq : null);
      }
      h += `<td class="yoy cmp ${yc}">${pvCell}</td>`;
    }
    return h;
  }
  function totalBlock(det, y) {
    const yc = "bg-y" + ycOf(y);
    const yd = det.years[String(y)];
    if (!yd) return `<td class="date ${yc}">데이터 없음</td><td class="${yc}">-</td><td class="${yc}"></td><td class="rate muted0 ${yc}">-</td><td class="${yc}" colspan="${spanOf(y) - 4}"></td>`;
    const total = yd["최종합계"];
    const q = qTotal(det, y);
    const last = yd.rows.length ? yd.rows[yd.rows.length - 1]["지원율"] : null;
    let h = `<td class="date tot-lab ${yc}">최종합계</td><td class="${yc}">${fmt(total)}</td><td class="${yc}"></td>` + (last != null ? rateCell(last, q, false, yc, 2) : cumRateCell(q ? total / q : null, yc));
    const py = PREV[y];
    const pT = py && det.years[String(py)] ? det.years[String(py)]["최종합계"] : null;
    const pQ = PREV[y] ? qTotal(det, PREV[y]) : null;
    if (PREV[y]) {
      const pc = pT ? (total / pT) * 100 : null;
      const rv = q && pQ ? total / q - pT / pQ : null;
      h += `<td class="${yc}">${pc === null ? '<span class="flat">-</span>' : pc.toFixed(2) + "%"}</td>`;
      h += `<td class="${yc}">${last != null ? rateDelta(rv) : cumDelta(rv)}</td>`;
    }
    return h;
  }

  /* ---------- 지원 현황 맵(사분면형 산점도) ----------
     가로 = 정원내 누적 지원율(배수·로그눈금), 세로 = 전년 대비 증감률(%).
     구간 기준선: 수시1차·수시2차 3.0/5.0, 정시 5.0/8.0 (송석화 확정 2026-10-30). */
  /* 사분면은 정원내 지원율(모집인원)이 있어야 그린다. 미확보 연도는 기본 선택에서 건너뛴다. */
  function mapHasRate(y) {
    if (!B || !B.map || !B.map.rows) return false;
    return Object.keys(B.map.rows).some((d) => {
      const r = B.map.rows[d][String(y)];
      return r && r.rate !== null && r.rate !== undefined;
    });
  }
  function mapDefaultYear() {
    const cand = YO.filter((y) => mapHasRate(y));
    return cand.length ? cand[0] : YO[0];
  }

  const MAP_TH = { susi_1: [3.0, 5.0], susi_2: [3.0, 5.0], jeongsi: [5.0, 8.0] };
  /* 단축형이 알고리즘 결과로 읽기 어려운 7곳만 고정 별칭을 쓴다(나머지는 "학과·과·전공" 생략 후 4글자). */
  const MAP_ALIAS = { 5: "미디어", 8: "뷰티", 9: "헤어", 22: "재활", 24: "스마트", 29: "컴SW", 30: "정보보안", 31: "토목", 32: "항공" };
  const MAP_YMIN = -40, MAP_YMAX = 60, MAP_XMIN = 2.0;
  const MAP_DUR = 480;
  const MAP = { nodes: new Map(), prev: new Map(), tween: 0, tip: null, sig: "", ro: null };

  const reducedMotion = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function mapThresholds(period) {
    const th = MAP_TH[period] || MAP_TH.susi_1;
    return th.slice();
  }

  /* 학과명 단축형: "학과"·"과"·"전공" 생략, 2~4글자. */
  function mapShort(deptId, name) {
    if (MAP_ALIAS[deptId]) return MAP_ALIAS[deptId];
    let s = String(name || "").trim();
    const sp = s.split(/\s+/);
    if (sp.length > 1) s = sp.slice(1).join(""); // "뷰티케어과 뷰티디자인전공" → "뷰티디자인전공"
    s = s.replace(/(학과|전공|과)$/, "").replace(/[&·,\/]/g, "");
    return s.length > 4 ? s.slice(0, 4) : s;
  }

  function mapRows(year) {
    const rows = (B && B.map && B.map.rows) || {};
    return B.departments.map((d) => {
      const r = (rows[String(d.dept_id)] || {})[String(year)] || null;
      return {
        id: d.dept_id, name: d.name, short: mapShort(d.dept_id, d.name),
        rate: r && r.rate !== null && r.rate !== undefined ? r.rate : null,
        yoy: r ? r.yoy : null, prev: r ? r.prev : null,
        q: r ? r.q : null, a: r ? r.a : null,
        na: !!(r && r.na),
        naReason: r ? r.na_reason : null,
        refNote: r ? r.ref_note : null,
        refA: r && r.ref ? r.ref.a : null,
        refQ: r && r.ref ? r.ref.q : null,
        refPrevA: r && r.ref_prev ? r.ref_prev.a : null,
      };
    });
  }

  const mapPct = (v) => (v === null || v === undefined ? "-" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + "%");

  function mapYearSeg() {
    const host = $("mapTools");
    if (!host) return;
    const label = `<span class="lab">학년도</span>`;
    host.innerHTML = label + `<div class="tgl" id="mapYearTgl" role="group" aria-label="학년도 선택">` +
      YO.map((y) => `<button type="button" data-my="${y}" class="${S.mapYear === y ? "on" : ""}" aria-pressed="${S.mapYear === y}">${y}${mapHasRate(y) ? "" : " (모집 미확보)"}</button>`).join("") +
      `</div>`;
    host.querySelectorAll("#mapYearTgl button").forEach((b) => {
      b.onclick = () => {
        const y = Number(b.dataset.my);
        if (y === S.mapYear) return;
        S.mapYear = y;
        mapYearSeg();
        syncUrl();
        renderMap(true);
      };
    });
  }

  const MAP_GH = 58; /* 플롯 아래 "비교 불가" 띠 높이 */
  function mapGeometry(w, rates, hasNa) {
    const narrow = w < 620;
    const h0 = Math.round(Math.max(narrow ? 320 : 360, Math.min(540, w * 0.42)));
    const gh = hasNa ? MAP_GH : 0;
    const h = h0 + gh;
    const pad = { l: narrow ? 40 : 64, r: narrow ? 16 : 22, t: narrow ? 26 : 24, b: narrow ? 44 : 42 };
    const maxRate = Math.max(5.5, ...rates);
    const xmax = Math.max(40, Math.ceil(maxRate / 10) * 10);
    const pw = Math.max(40, w - pad.l - pad.r);
    const ph = Math.max(60, h0 - pad.t - pad.b);
    const lx = Math.log10(xmax) - Math.log10(MAP_XMIN);
    return {
      w, h, h0, gh, narrow, pad, xmax, pw, ph,
      gx: (p) => pad.t + ((MAP_YMAX - p) / (MAP_YMAX - MAP_YMIN)) * ph,
      x: (v) => pad.l + ((Math.log10(Math.max(v, MAP_XMIN)) - Math.log10(MAP_XMIN)) / lx) * pw,
      y: (p) => pad.t + ((MAP_YMAX - p) / (MAP_YMAX - MAP_YMIN)) * ph,
    };
  }

  /* 지원율·증감률 → 화면 좌표. 축 밖 값은 가장자리에 붙이고 clip 방향을 남긴다. */
  function mapPos(g, p) {
    const rate = p.rate === null || p.rate === undefined ? null : p.rate;
    const x = rate === null ? g.x(MAP_XMIN) : g.x(rate <= 0 ? MAP_XMIN : rate);
    /* 2024 자료가 없어 증감률을 계산할 수 없는 학과: 세로축 밖(플롯 아래 띠)에 둔다. 0% 아님. */
    if (p.na) return { x, y: g.h0 + g.gh / 2, clip: 0, zero: rate !== null && rate <= 0, missing: rate === null, na: true };
    let v = p.yoy;
    let clip = 0;
    if (v === null || v === undefined) v = 0;
    else if (v > MAP_YMAX) { clip = 1; v = MAP_YMAX; }
    else if (v < MAP_YMIN) { clip = -1; v = MAP_YMIN; }
    return { x, y: g.y(v), clip, zero: rate !== null && rate <= 0, missing: rate === null };
  }

  function mapRadius(p, rates) {
    const lo = Math.min(...rates), hi = Math.max(...rates);
    const t = hi > lo && p.rate !== null ? (p.rate - lo) / (hi - lo) : 0.5;
    return 4 + 10 * Math.sqrt(Math.max(0, Math.min(1, t))); // 면적 ∝ 지원율, 4~14px 로 제한
  }

  function mapTipHtml(p) {
    const th = mapThresholds(S.period);
    const hasRef = p.refA !== null && p.refA !== undefined;
    let yoy;
    if (p.na) {
      yoy = `<span class="warn">${esc(p.naReason || "2024 자료 없음")}</span>`;
    } else if (p.yoy === null || p.yoy === undefined) {
      yoy = `<span class="warn">전년 비교 데이터 없음</span>`;
    } else {
      const up = p.yoy > 0, dn = p.yoy < 0;
      /* 2025(2024 마감 대비)는 계약값이 2자리라 그대로 표기 — 1자리 반올림 시 0.05%p 어긋남(간호·유아교육). */
      const num = hasRef ? (Math.abs(p.yoy)).toFixed(2) + "%" : mapPct(p.yoy).replace(/^[+−]/, "");
      yoy = `<span class="${up ? "up" : dn ? "down" : "zero"}">${up ? "▲ " : dn ? "▼ " : "– "}${up ? "+" : dn ? "−" : ""}${num}</span>`;
    }
    const rateTxt = p.rate === null ? "-" : (Math.round(p.rate * 10) / 10).toFixed(1);
    return `<div class="n">${esc(p.name)}</div>
      <div class="r"><span>지원율(정원내)</span><b>${rateTxt}</b></div>
      <div class="r"><span>${hasRef ? "2024→2025 합계 지원" : "전년 대비"}</span><b>${yoy}</b></div>
      ${hasRef ? `<div class="r"><span>합계 지원</span><b>${p.refPrevA === null || p.refPrevA === undefined ? "—" : fmt(p.refPrevA)} → ${fmt(p.refA)}</b></div>` : ""}
      ${p.q !== null ? `<div class="r"><span>모집·지원(정원내)</span><b>${fmt(p.q)} · ${fmt(p.a)}</b></div>` : ""}
      ${p.refNote ? `<div class="note">${esc(p.refNote)}</div>` : ""}`;
  }

  function mapTipShow(p, node) {
    const wrap = $("mapWrap");
    if (!wrap) return;
    if (!MAP.tip) {
      MAP.tip = document.createElement("div");
      MAP.tip.className = "mt-tip";
      MAP.tip.setAttribute("role", "tooltip");
      wrap.appendChild(MAP.tip);
    }
    const tip = MAP.tip;
    tip.innerHTML = mapTipHtml(p);
    tip.style.display = "block";
    const nb = node.getBoundingClientRect();
    const wb = wrap.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = nb.left - wb.left + nb.width / 2 + 12;
    if (left + tw > wb.width - 4) left = nb.left - wb.left - tw - 12;
    if (left < 4) left = 4;
    let top = nb.top - wb.top - th - 8;
    if (top < 4) top = nb.top - wb.top + nb.height + 10;
    tip.style.left = Math.round(left) + "px";
    tip.style.top = Math.round(top) + "px";
  }
  function mapTipHide() {
    if (MAP.tip) MAP.tip.style.display = "none";
  }

  function mapFocusRow(id) {
    const tr = document.querySelector(`#xl-s1 tbody tr[data-dept="${id}"]`);
    if (!tr) return;
    tr.classList.remove("rowflash");
    void tr.offsetWidth;
    tr.classList.add("rowflash");
    try { tr.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" }); }
    catch (e) { tr.scrollIntoView(); }
    clearTimeout(MAP.flashTimer);
    MAP.flashTimer = setTimeout(() => tr.classList.remove("rowflash"), 1700);
  }

  function mapTween(targets) {
    cancelAnimationFrame(MAP.tween);
    const from = new Map(MAP.prev);
    const draw = (x, y, r, g, id) => {
      if (!g) return;
      g.setAttribute("transform", `translate(${x.toFixed(2)},${y.toFixed(2)})`);
      const dot = g.querySelector("circle.dot");
      if (dot) dot.setAttribute("r", r.toFixed(2));
    };
    if (reducedMotion() || !from.size) {
      targets.forEach((t, id) => draw(t.x, t.y, t.r, MAP.nodes.get(id), id));
      MAP.prev = targets;
      return;
    }
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / MAP_DUR);
      const e = 1 - Math.pow(1 - k, 3);
      targets.forEach((t, id) => {
        const f = from.get(id);
        if (!f) return draw(t.x, t.y, t.r, MAP.nodes.get(id), id);
        draw(f.x + (t.x - f.x) * e, f.y + (t.y - f.y) * e, f.r + (t.r - f.r) * e, MAP.nodes.get(id), id);
      });
      if (k < 1) MAP.tween = requestAnimationFrame(step);
      else { MAP.tween = 0; MAP.prev = targets; }
    };
    MAP.tween = requestAnimationFrame(step);
  }

  function renderMap(animate) {
    const host = $("mapWrap");
    if (!host) return;
    const p = MANIFEST.periods[S.period];
    const titleEl = $("mapTitle");
    if (titleEl) titleEl.textContent = `학과별 지원 현황(정원내) · ${p ? p.label : "수시1차"}`;
    mapYearSeg();
    MAP.nodes = new Map();
    MAP.tip = null;
    host.innerHTML = "";

    if (!B || !B.map) {
      host.innerHTML = '<div class="mt-state">지원 현황 맵 데이터가 없습니다.</div>';
      ["mapSub", "mapLegend", "mapFoot"].forEach((id) => { const e = $(id); if (e) e.innerHTML = ""; });
      return;
    }
    const th = mapThresholds(S.period);
    const rows = mapRows(S.mapYear);
    const rated = rows.filter((r) => r.rate !== null);
    const years = (B.map.years || []).slice();
    const prevYear = S.mapYear === years[years.length - 1] ? null : years[years.indexOf(S.mapYear) + 1];
    const noYoy = rated.filter((r) => r.yoy === null || r.yoy === undefined).length;
    const naRows = rated.filter((r) => r.na);
    const y24 = (B.map && B.map.yoy_2024) || null;
    const is2025 = String(S.mapYear) === "2025" && !!y24;

    const w = Math.max(280, Math.floor(host.clientWidth || host.parentNode.clientWidth || 900));
    const g = mapGeometry(w, rated.map((r) => r.rate), naRows.length > 0);
    const rates = rated.map((r) => r.rate);

    if ($("mapSub")) {
      const missing = rows.length - rated.length;
      const cov = (B.meta_ext && B.meta_ext.quota_coverage && B.meta_ext.quota_coverage[String(S.mapYear)]) || "";
      const qMiss = cov.includes("미확보");
      let note = "";
      if (qMiss) {
        /* 모집인원이 없으면 지원율(x축) 자체를 계산할 수 없다 — '자료 없음'이 아니라 사유를 밝힌다. */
        note = ` · <span class="flat">모집인원 미확보로 지원율을 계산할 수 없습니다 — 지원 건수는 아래 학과별 표를 보세요.</span>`;
      } else if (is2025) {
        /* 2025 세로축 = 2024 마감 대비. 기준이 2026·2027(정원내 지원율)과 달라 문구로 구분한다. */
        note = ` · <span class="flat">증감률 기준: ${esc(y24.basis_label)}</span>`;
        if (naRows.length) note += ` · <span class="flat">비교 불가 ${naRows.length}곳(2024 자료 없음)</span>`;
      } else if (noYoy && noYoy === rated.length) {
        note = ` · <span class="flat">${S.mapYear - 1}학년도 자료가 없어 증감률(세로축)을 표시할 수 없습니다 — 지원율 비교만 가능합니다.</span>`;
      } else if (noYoy) {
        note = ` · <span class="flat">증감률 비교 불가 ${noYoy}곳(전년 자료 없음)</span>`;
      }
      if (missing && !qMiss) note += ` · <span class="flat">${missing}개 학과는 ${S.mapYear}학년도 자료 없음</span>`;
      const anyQMiss = Object.keys((B.meta_ext && B.meta_ext.quota_coverage) || {}).some((y) => String(B.meta_ext.quota_coverage[y]).includes("미확보"));
      const lead = (anyQMiss && S.mapYear !== YO[0])
        ? `<b class="mtyear">차트 ${S.mapYear}학년도 기준</b> <span class="flat">(표는 ${YO[0]}학년도 기준)</span> · `
        : "";
      const cnt = qMiss ? `정원내 지원율 산출 불가(${rows.length}개 학과)` : `${rated.length}개 학과`;
      $("mapSub").innerHTML = lead + `${S.mapYear}학년도 ${p ? p.label : "수시1차"} · 정원내 누적 지원율 · ${esc(B.as_of || "")} 기준 · ${cnt}` + note;
    }
    if ($("mapLegend")) {
      $("mapLegend").innerHTML =
        `<span><i class="z-d"></i>위험 구간 ≤ ${th[0].toFixed(1)}</span>` +
        `<span><i class="z-w"></i>주의 구간 ${th[0].toFixed(1)}~${th[1].toFixed(1)}</span>` +
        `<span><i class="z-s"></i>안정 구간 > ${th[1].toFixed(1)}</span>` +
        (naRows.length ? `<span><i class="noyoy"></i>비교 불가(2024 자료 없음)</span>` : (noYoy ? `<span><i class="noyoy"></i>전년 비교 데이터 없음</span>` : "")) +
        `<span>점 크기 = 지원율 · 라벨 = 학과 단축명</span>`;
    }
    if ($("mapFoot")) {
      $("mapFoot").innerHTML =
        `가로축 <b>정원내 누적 지원율</b>(배수·로그눈금) · 세로축 <b>전년 대비 증감률</b>(%) — 기준선은 지원율 구간이며 증감률 축과 무관합니다. ` +
        `점을 클릭하면 아래 표의 해당 학과 행으로 이동합니다. −40%~+60%를 벗어난 점은 가장자리에 붙고 실제 값은 툴팁에 있습니다. ` +
        `<span class="flat">${esc(is2025 ? y24.notice : (B.map.same_day_rule || ""))}</span>`;
    }

    if (!rated.length) {
      const qc = (B && B.meta_ext && B.meta_ext.quota_coverage && B.meta_ext.quota_coverage[String(S.mapYear)]) || "";
      host.innerHTML = qc.includes("미확보")
        ? `<div class="mt-state"><b>${S.mapYear}학년도는 모집인원이 확보되지 않아 지원율(정원내)을 계산할 수 없습니다.</b>
            <br/>추정치를 쓰지 않는 원칙에 따라 사분면을 그리지 않습니다 — 지원 건수는 아래 <b>학과별 지원현황</b> 표에 있습니다.
            <br/><span class="flat">${esc(qc)}</span></div>`
        : '<div class="mt-state">선택한 학년도의 정원내 지원율이 없습니다.</div>';
      MAP.prev = new Map();
      return;
    }

    const xt = [2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 40, 50].filter((v) => v >= MAP_XMIN && v <= g.xmax);
    if (xt[xt.length - 1] !== g.xmax) xt.push(g.xmax);
    const yt = [-40, -20, 0, 20, 40, 60];

    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${g.w} ${g.h}`);
    svg.setAttribute("role", "group");
    svg.setAttribute("aria-label", `${S.mapYear}학년도 학과별 지원 현황 맵 — 가로 정원내 지원율, 세로 전년 대비 증감률`);
    svg.setAttribute("height", g.h);
    host.appendChild(svg);

    const add = (tag, attrs, cls) => {
      const el = document.createElementNS(ns, tag);
      Object.keys(attrs || {}).forEach((k) => el.setAttribute(k, attrs[k]));
      if (cls) el.setAttribute("class", cls);
      return el;
    };

    // 1) 지원율 3구간 밴드 (x축 기준 색 — 증감률 축과 섞지 않는다)
    const bands = [
      ["z-d", MAP_XMIN, th[0], "위험 구간"],
      ["z-w", th[0], th[1], "주의 구간"],
      ["z-s", th[1], g.xmax, "안정 구간"],
    ];
    bands.forEach(([cls, a, b, lab]) => {
      const x1 = g.x(a), x2 = g.x(b);
      if (x2 - x1 < 1) return;
      svg.appendChild(add("rect", { x: x1.toFixed(1), y: g.pad.t, width: (x2 - x1).toFixed(1), height: g.ph }, `mt-band ${cls}`));
      const t = add("text", {
        x: ((x1 + x2) / 2).toFixed(1), y: (g.pad.t - 8).toFixed(1), "text-anchor": "middle",
      }, `mt-zonelab ${cls}`);
      t.textContent = g.narrow ? lab.replace(" 구간", "") : lab;
      if (x2 - x1 >= (g.narrow ? 30 : 54)) svg.appendChild(t);
    });

    // 2) 그리드 + 눈금
    yt.forEach((v) => {
      const y = g.y(v);
      svg.appendChild(add("line", { x1: g.pad.l, x2: g.pad.l + g.pw, y1: y.toFixed(1), y2: y.toFixed(1) }, v === 0 ? "mt-grid zero" : "mt-grid"));
      const t = add("text", { x: g.pad.l - 7, y: (y + 3.6).toFixed(1) }, "mt-tick y");
      t.textContent = (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v) + (v === 0 ? "" : "%");
      svg.appendChild(t);
    });
    xt.forEach((v) => {
      const x = g.x(v);
      svg.appendChild(add("line", { x1: x.toFixed(1), x2: x.toFixed(1), y1: g.pad.t, y2: g.pad.t + g.ph }, "mt-grid"));
      const t = add("text", { x: x.toFixed(1), y: (g.pad.t + g.ph + 15).toFixed(1), "text-anchor": "middle" }, "mt-tick");
      t.textContent = String(v);
      svg.appendChild(t);
    });
    if (!g.narrow) {
      const ylab = add("text", {
        x: 14, y: (g.pad.t + g.ph / 2).toFixed(1), "text-anchor": "middle",
        transform: `rotate(-90 14 ${(g.pad.t + g.ph / 2).toFixed(1)})`,
      }, "mt-axlab");
      ylab.textContent = is2025 ? (g.narrow ? "증감률 (2024 합계 기준)" : y24.axis_label) : "전년 대비 증감률(%)";
      svg.appendChild(ylab);
    }
    // 축
    svg.appendChild(add("line", { x1: g.pad.l, x2: g.pad.l, y1: g.pad.t, y2: g.pad.t + g.ph }, "mt-axis"));
    svg.appendChild(add("line", { x1: g.pad.l, x2: g.pad.l + g.pw, y1: g.pad.t + g.ph, y2: g.pad.t + g.ph }, "mt-axis"));

    // 2b) 비교 불가 띠 — 세로축(플롯) 밖, 점선 경계로 분리. 축 눈금·클립 대상 아님.
    if (g.gh) {
      svg.appendChild(add("rect", {
        x: g.pad.l, y: g.h0.toFixed(1), width: g.pw.toFixed(1), height: g.gh.toFixed(1),
      }, "mt-gutterbg"));
      svg.appendChild(add("line", {
        x1: g.pad.l, x2: g.pad.l + g.pw, y1: g.h0.toFixed(1), y2: g.h0.toFixed(1),
      }, "mt-gutterline"));
      const gt = add("text", {
        x: (g.pad.l - 7).toFixed(1), y: (g.h0 + 15).toFixed(1), "text-anchor": "end",
      }, "mt-tick na");
      gt.textContent = g.narrow ? "비교불가" : "비교 불가";
      svg.appendChild(gt);
      const gl2 = add("text", {
        x: (g.pad.l + 6).toFixed(1), y: (g.h0 + g.gh - 6).toFixed(1), "text-anchor": "start",
      }, "mt-gutterlab");
      gl2.textContent = "2024 자료 없음 — 세로축(증감률) 밖";
      svg.appendChild(gl2);
    }

    // 3) 기준선(수시 3.0/5.0, 정시 5.0/8.0)
    th.forEach((v, i) => {
      const x = g.x(v);
      svg.appendChild(add("line", { x1: x.toFixed(1), x2: x.toFixed(1), y1: g.pad.t, y2: g.pad.t + g.ph }, `mt-line d${i + 1}`));
      const t = add("text", { x: (x + 4).toFixed(1), y: (g.pad.t + g.ph - 6).toFixed(1) }, `mt-linelab d${i + 1}`);
      t.textContent = v.toFixed(1);
      svg.appendChild(t);
    });

    // 4) 점 + 라벨 (겹침은 greedy 회피, 실패하면 겹침 허용 — 요구: 34개 모두 표시)
    const placed = [];
    const pts = rated.slice().sort((a, b) => b.rate - a.rate);
    const targets = new Map();
    const labels = [];
    pts.forEach((r) => {
      const pos = mapPos(g, r);
      const rad = mapRadius(r, rates);
      const node = add("g", { "data-id": r.id, tabindex: "0", role: "button" }, "mt-pt " + tierCls(r.rate, th)
        + (r.yoy === null || r.yoy === undefined ? " noyoy" : "") + (pos.na ? " na" : "")
        + (pos.clip ? " clip" : "") + (pos.zero ? " zero" : ""));
      node.setAttribute("aria-label", mapAria(r));
      node.appendChild(add("circle", { cx: 0, cy: 0, r: Math.max(11, rad + 4).toFixed(1) }, "hit"));
      node.appendChild(add("circle", { cx: 0, cy: 0, r: rad.toFixed(1) }, "dot"));
      svg.appendChild(node);
      MAP.nodes.set(r.id, node);
      targets.set(r.id, { x: pos.x, y: pos.y, r: rad });

      if (pos.clip) {
        const m = add("text", { x: 0, y: pos.clip > 0 ? -rad - 3 : rad + 10, "text-anchor": "middle" }, "mt-clipmark");
        m.textContent = pos.clip > 0 ? "▲" : "▼";
        node.appendChild(m);
      }
      node.addEventListener("pointerenter", () => mapTipShow(r, node));
      node.addEventListener("pointerleave", mapTipHide);
      node.addEventListener("focus", () => mapTipShow(r, node));
      node.addEventListener("blur", mapTipHide);
      const go = () => { mapTipHide(); mapFocusRow(r.id); };
      node.addEventListener("click", go);
      node.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
      });
      labels.push({ r, pos, rad });
    });

    // 라벨은 작은 점부터 배치(큰 점이 자리를 차지하면 작은 라벨이 밀린다) — 가독성 우선
    const dotBoxes = labels.map((l) => ({ id: l.r.id, b: [l.pos.x - l.rad, l.pos.y - l.rad, l.rad * 2, l.rad * 2] }));
    const hit = (a, b) => !(a[0] + a[2] < b[0] || a[0] > b[0] + b[2] || a[1] + a[3] < b[1] || a[1] > b[1] + b[3]);
    const order = labels.slice().sort((a, b) => a.r.rate - b.r.rate);
    order.forEach(({ r, pos, rad }) => {
      const tw = Math.max(20, r.short.length * (g.narrow ? 10.4 : 10.9));
      const thh = 12;
      const dx1 = rad + 5, dx2 = Math.round(rad * 0.72 + 4), dy2 = Math.round(rad * 0.72);
      const cands = [
        { dx: dx1, dy: 3.7, anchor: "start", box: [dx1, -5.5, tw, thh] },
        { dx: -dx1, dy: 3.7, anchor: "end", box: [-dx1 - tw, -5.5, tw, thh] },
        { dx: 0, dy: -(rad + 4), anchor: "middle", box: [-tw / 2, -(rad + 4) - thh, tw, thh] },
        { dx: 0, dy: rad + 12, anchor: "middle", box: [-tw / 2, rad + 12 - thh / 2, tw, thh] },
        { dx: dx2, dy: -(dy2 + 3), anchor: "start", box: [dx2, -(dy2 + 3) - thh, tw, thh] },
        { dx: dx2, dy: dy2 + 11, anchor: "start", box: [dx2, dy2 + 11 - thh / 2, tw, thh] },
        { dx: -dx2, dy: -(dy2 + 3), anchor: "end", box: [-dx2 - tw, -(dy2 + 3) - thh, tw, thh] },
        { dx: -dx2, dy: dy2 + 11, anchor: "end", box: [-dx2 - tw, dy2 + 11 - thh / 2, tw, thh] },
        { dx: rad + 26, dy: 3.7, anchor: "start", box: [rad + 26, -5.5, tw, thh] },
        { dx: -(rad + 26), dy: 3.7, anchor: "end", box: [-(rad + 26) - tw, -5.5, tw, thh] },
        { dx: 0, dy: -(rad + 22), anchor: "middle", box: [-tw / 2, -(rad + 22) - thh, tw, thh] },
        { dx: 0, dy: rad + 30, anchor: "middle", box: [-tw / 2, rad + 30 - thh / 2, tw, thh] },
      ];
      const inside = (b) => {
        const x0 = pos.x + b[0], y0 = pos.y + b[1];
        return x0 >= g.pad.l - 2 && x0 + b[2] <= g.pad.l + g.pw + 8
          && y0 >= g.pad.t - 12 && y0 + b[3] <= g.pad.t + g.ph + 4;
      };
      const abs = (b) => [pos.x + b[0], pos.y + b[1], b[2], b[3]];
      const fits = (b) => inside(b) && !placed.some((p2) => hit(abs(b), p2))
        && !dotBoxes.some((d) => d.id !== r.id && hit(abs(b), d.b));
      const pick = cands.find((c) => fits(c.box)) || cands.find((c) => inside(c.box)) || cands[0];
      placed.push(abs(pick.box));
      const t = add("text", { x: pick.dx.toFixed(1), y: pick.dy.toFixed(1), "text-anchor": pick.anchor }, "mt-pl");
      t.textContent = r.short;
      MAP.nodes.get(r.id).appendChild(t);
    });

    cancelAnimationFrame(MAP.tween);
    if (animate) {
      mapTween(targets);
    } else {
      targets.forEach((t, id) => {
        const node = MAP.nodes.get(id);
        if (!node) return;
        node.setAttribute("transform", `translate(${t.x.toFixed(2)},${t.y.toFixed(2)})`);
        node.querySelector("circle.dot").setAttribute("r", t.r.toFixed(2));
      });
      MAP.prev = targets;
    }

    if (!MAP.ro && window.ResizeObserver) {
      let last = host.clientWidth;
      MAP.ro = new ResizeObserver(() => {
        const now = host.clientWidth;
        if (Math.abs(now - last) < 24) return;
        last = now;
        if (S.menu === "dept" && !$("menu-dept").classList.contains("hide")) renderMap(false);
      });
      MAP.ro.observe(host);
    }
  }

  function tierCls(rate, th) {
    if (rate === null || rate === undefined) return "z-s";
    const r = r1(rate);
    if (r <= th[0]) return "z-d";
    if (r <= th[1]) return "z-w";
    return "z-s";
  }

  function mapAria(r) {
    const rateTxt = r.rate === null ? "없음" : (Math.round(r.rate * 10) / 10).toFixed(1);
    const yoyTxt = r.na ? (r.naReason || "2024 자료 없음")
      : r.yoy === null || r.yoy === undefined ? "비교 데이터 없음"
        : (r.yoy > 0 ? "▲ " : r.yoy < 0 ? "▼ " : "") + mapPct(r.yoy);
    return `${r.name}, 정원내 지원율 ${rateTxt}, 전년 대비 ${yoyTxt}`;
  }

  window.BU_MAP = { thresholds: mapThresholds, shortName: mapShort, radius: (p, all) => mapRadius(p, all) };

  /* ---------- 학과전형별 부제 ---------- */
  function renderS1() {
    const rows = Object.values(B.s1).sort((a, b) => a.name.localeCompare(b.name, "ko"));
    const y0 = YO[0], y1 = YO[1];
    const g0 = "g" + ycOf(y0), g1 = y1 !== undefined ? "g" + ycOf(y1) : "g" + ycOf(y0);
    const c0 = "c" + ycOf(y0), c1 = y1 !== undefined ? "c" + ycOf(y1) : c0;
    const thead = `<tr class="grp"><th class="sc" rowspan="2">학과명</th><th rowspan="2">입학정원</th>
      <th class="${g0}" colspan="3">${y0} 정원내</th><th class="${g0}" colspan="3">${y0} 정원외</th><th class="${g0}" colspan="3">${y0} 합계</th>
      <th class="${g1}" colspan="3">${y1 !== undefined ? y1 : "-"} 마감(합계)</th><th class="gratio" colspan="3">전년대비</th></tr>
      <tr class="sub">
        <th class="${c0}">모집</th><th class="${c0}">지원</th><th class="${c0}">지원율</th>
        <th class="${c0}">모집</th><th class="${c0}">지원</th><th class="${c0}">지원율</th>
        <th class="${c0}">모집</th><th class="${c0}">지원</th><th class="${c0}">지원율</th>
        <th class="${c1}">모집</th><th class="${c1}">지원</th><th class="${c1}">지원율</th>
        <th class="cr">모집 증감</th><th class="cr">지원율 증감</th><th class="cr">지원인원 비율</th></tr>`;
    const rowHtml = (d) => {
      const t = (arr, qc, emph, cls) => `<td class="${cls}">${fmt(arr[0])}</td><td class="${cls}">${fmt(arr[1])}</td>` + rateCell(arr[2], arr[0], emph, cls);
      return `<tr data-dept="${d.dept_id === null || d.dept_id === undefined ? "" : d.dept_id}"><td class="sc">${esc(d.name)}</td><td>${fmt(d.cap)}</td>`
        + t(d.in, "정원내", true, "bg-in") + t(d.out, "정원외", false, "bg-out") + t(d.tot, "합계", false, "bg-tot") + t(d.m26, "합계", false, "bg-m26")
        + `<td>${delta(d.d[0])}</td>`
        + `<td>${delta(d.d[1], 2)}</td>`
        + `<td>${d.d[2] === null ? "-" : d.d[2].toFixed(2) + "%"}</td></tr>`;
    };
    const el = $("xl-s1");
    el.querySelector("thead").innerHTML = thead;
    el.querySelector("tbody").innerHTML = rows.map(rowHtml).join("");
    el.querySelector("tfoot").innerHTML = rowHtml(B.s1_sum);
    const t1 = $("s1Tools");
    if (t1) { t1.innerHTML = dlButtonHtml("dlS1"); $("dlS1").onclick = () => downloadTable("xl-s1", "학과별", "dept"); }
    const badge = $("s1YearBadge");
    if (badge) {
      if (y0 < 2027) {
        badge.hidden = false;
        badge.textContent = `${y0} 기준`;
        badge.title = `2027학년도는 아직 수집 전 — 가장 최근 수집 연도(${y0}) 기준으로 표시합니다.`;
      } else {
        badge.hidden = true;
        badge.textContent = "";
      }
    }
    const sub = $("s1Sub");
    if (sub) {
      const p = MANIFEST.periods[S.period];
      const late = (y0 < 2027) ? ` · 2027학년도는 아직 수집 전(${y0} 기준)` : "";
      const qmiss = (B.meta_ext && B.meta_ext.quota_coverage && String(B.meta_ext.quota_coverage[String(y0)] || "").includes("미확보"))
        ? " · 모집인원·입학정원 미확보 — 지원 건수만 표시(추정치 없음)" : "";
      sub.textContent = `${y0}학년도 ${p ? p.label : "수시1차"} 학과별 지원 현황(총괄표) · ${dateKr(B.as_of)} 기준 · ${B.departments.length}개 학과 + 합계${late}${qmiss}`;
    }
  }

  /* ---------- 학과전형별 (시트2, 2027) ---------- */
  function renderS2() {
    const G = B.type_groups;
    let thead = '<tr class="grp"><th class="sc" rowspan="2">학과명</th><th rowspan="2">입학정원</th>';
    let sub = '<tr class="sub">';
    G.forEach((g) => {
      const cls = g.qc === "정원내" ? "g27" : g.qc === "정원외" ? "g26" : "gratio";
      thead += `<th class="${cls}" colspan="3">${esc(g.lab)}</th>`;
      sub += '<th>모집</th><th>지원</th><th>지원율</th>';
    });
    thead += "</tr>"; sub += "</tr>";

    // 정원내합계(파랑)·정원외합계(노랑)·합계(보라)는 의미색으로 고정하고,
    // 나머지 전형 그룹은 그 세 색을 피해 순환 배정한다.
    const SEM = { "정원내합계": "bg-in", "정원외합계": "bg-out", "합계": "bg-tot" };
    const POOL = ["bg-g3", "bg-g4", "bg-g5", "bg-g6", "bg-g7"];
    let poolIdx = 0;
    const rows = B.s2.filter((d) => S.typeDept === null || d.dept_id === S.typeDept);
    const body = rows.map((d) => {
      let h = `<tr><td class="sc">${esc(d.name)}</td><td>${fmt(d.cap)}</td>`;
      G.forEach((g, gi) => {
        const v = d.types[g.lab] || [null, null, null];
        const meta = d.meta && d.meta[g.lab];
        // 북한이탈주민: 모집인원 수치가 없으므로 지원자가 있는 학과만 ◈(모집 미상·제한 없음 표시)
        const nkMark = g.lab === "북한이탈주민" && v[1] > 0;
        const noQ = (meta && meta.no_quota) || nkMark;
        const qMiss = !!(meta && meta.quota_missing);
        const mCell = noQ ? "◈" : (qMiss ? "-" : fmt(v[0]));
        const emph = g.qc === "정원내";
        const bg = SEM[g.lab] || POOL[gi % POOL.length];
        // ◈는 재외국민(7호)과 같은 의미(모집제한 없음) — 툴팁도 같은 문구로 통일
        const cellTitle = nkMark ? "모집제한 없음" : (meta && meta.note ? meta.note : "");
        h += `<td class="${bg}"${cellTitle ? ` title="${esc(cellTitle)}"` : ""}>${mCell}</td><td class="${bg}">${fmt(v[1])}</td>`;
        h += noQ ? `<td class="rate muted0 ${bg}" title="모집제한 없음">-</td>`
          : qMiss ? `<td class="rate muted0 ${bg}" title="모집인원 미확보">-</td>` : rateCell(v[2], v[0], emph, bg);
      });
      return h + "</tr>";
    }).join("");

    const sub2 = $("s2Sub");
    if (sub2) {
      const p = MANIFEST.periods[S.period];
      const late = (YO[0] < 2027) ? ` · 2027학년도는 아직 수집 전(${YO[0]} 기준)` : "";
      const miss = (B.meta_ext && B.meta_ext.quota_coverage && B.meta_ext.quota_coverage[String(YO[0])] || "").includes("미확보")
        ? ` · 모집인원 미확보(-)는 지원 건수만 표시` : "";
      sub2.textContent = `${YO[0]}학년도 ${p ? p.label : "수시1차"} 학과/전형별 지원 현황 · ${dateKr(B.as_of)} 기준 · 단위: 명${late}${miss}`;
    }
    const el = $("xl-s2");
    el.querySelector("thead").innerHTML = thead + sub;
    el.querySelector("tbody").innerHTML = rows.length ? body
      : `<tr><td colspan="${2 + G.length * 3}" style="text-align:center;padding:28px;color:var(--muted)">선택한 학과가 없습니다 — 콤보에서 [전체]를 선택해 주세요.</td></tr>`;
    // 합계 행: 표시 학과의 전형별 모집·지원 합산, 지원율 = 합계지원 ÷ 합계모집(2026-11-12 매니저 요청)
    let tsum = `<tr><td class="sc">합계</td><td>${fmt(rows.reduce((a, d) => a + (typeof d.cap === "number" ? d.cap : 0), 0))}</td>`;
    G.forEach((g, gi) => {
      const val = (d, i) => { const v = d.types[g.lab] || [null, null, null]; return typeof v[i] === "number" ? v[i] : 0; };
      const noQCnt = rows.filter((d) => { const m = d.meta && d.meta[g.lab]; return (m && m.no_quota) || (g.lab === "북한이탈주민" && val(d, 1) > 0); }).length;
      const qmCnt = rows.filter((d) => d.meta && d.meta[g.lab] && d.meta[g.lab].quota_missing).length;
      const mSum = rows.reduce((a, d) => a + val(d, 0), 0);
      const aSum = rows.reduce((a, d) => a + val(d, 1), 0);
      const allNoQ = rows.length > 0 && noQCnt === rows.length;
      const allQm = rows.length > 0 && qmCnt === rows.length;
      const emph = g.qc === "정원내";
      const bg = SEM[g.lab] || POOL[gi % POOL.length];
      const mCell = allNoQ ? "◈" : (allQm ? "-" : fmt(mSum));
      const rate = (!allNoQ && !allQm && mSum > 0) ? aSum / mSum : null;
      tsum += `<td class="${bg}">${mCell}</td><td class="${bg}">${aSum ? fmt(aSum) : "-"}</td>`;
      tsum += rate === null ? `<td class="rate muted0 ${bg}">-</td>` : rateCell(rate, mSum, emph, bg);
    });
    el.querySelector("tfoot").innerHTML = rows.length ? tsum + "</tr>" : "";
    const t2 = $("s2Tools");
    if (t2) { t2.innerHTML = dlButtonHtml("dlS2"); $("dlS2").onclick = () => downloadTable("xl-s2", "학과전형별", "type"); }
  }

  function bindGlobalComboClose() {
    // 콤보가 재생성돼도 문서 리스너는 1개만 유지한다(리스너 누적 방지).
    document.addEventListener("click", (e) => {
      document.querySelectorAll(".combo-wrap").forEach((w) => {
        if (!w.contains(e.target)) {
          const pn = w.querySelector(".combo-panel");
          const bt = w.querySelector(".combo-btn");
          if (pn) pn.classList.remove("open");
          if (bt) bt.setAttribute("aria-expanded", "false");
        }
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => { bindGlobalComboClose(); boot(); });
})();


