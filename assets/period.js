/* 모집시기 자동 선택 — 접속 시점의 한국 시간(Asia/Seoul) 기준.
 * 수시1차: ~2026-11-10 / 수시2차: 2026-11-11~2027-01-03 / 정시: 2027-01-04~
 * 2026-09-07 이전도 수시1차(첫 구간)로 둔다. */
(function () {
  "use strict";
  var BOUND_S2 = "2026-11-11";
  var BOUND_JS = "2027-01-04";
  var fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });

  function seoulDate(now) {
    var d = now instanceof Date ? now : new Date(now);
    return fmt.format(d); // YYYY-MM-DD
  }
  function pickPeriodId(now) {
    var d = seoulDate(now);
    if (d < BOUND_S2) return "susi_1";
    if (d < BOUND_JS) return "susi_2";
    return "jeongsi";
  }
  /* 모집 종료일 — "일자별 지원비율 보기" 기본값(종료 3일 전부터 표시)에 쓴다.
     종료일 24시는 그날까지 모집으로 보고, 날짜 경계(다음 날 00:00) 기준으로 3일 전을 계산한다.
     정시 종료 = 2027-01-20 24:00 → 표시 시작 2027-01-17. */
  var END = { susi_1: "2026-09-30", susi_2: "2027-01-03", jeongsi: "2027-01-20" };

  function shift(dateStr, days) {
    var t = Date.parse(dateStr + "T00:00:00Z") + days * 86400000;
    return new Date(t).toISOString().slice(0, 10);
  }
  function endDate(periodId) {
    return END[periodId] || null;
  }
  /* 종료일 3일 전부터 기본 표시, 그 전에는 숨김. 종료일 미확정이면 숨김. */
  function ratioDefault(periodId, now) {
    var end = endDate(periodId);
    if (!end) return false;
    return seoulDate(now || new Date()) >= shift(end, -3);
  }

  window.PeriodAuto = {
    pick: pickPeriodId,
    seoulDate: seoulDate,
    endDate: endDate,
    ratioDefault: ratioDefault,
    shift: shift,
    bounds: { susi_2: BOUND_S2, jeongsi: BOUND_JS }
  };
})();
