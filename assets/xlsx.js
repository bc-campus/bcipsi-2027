/* 엑셀(.xlsx) 내보내기 — 외부 라이브러리 없이 최소 OOXML + 무압축 ZIP.
 * 사용: XLSX_LITE.download([{name:"일자별", aoa:[[...],[...]]}], "파일명.xlsx")
 * 셀 값: number → 숫자, "%"로 끝나면 백분율 서식, 그 외 문자열. */
(function () {
  "use strict";

  var enc = new TextEncoder();

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    var c = 0xffffffff;
    for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function u16(n) { return [n & 255, (n >>> 8) & 255]; }
  function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }

  function zipStore(files) {
    var d = new Date();
    var dosTime = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
    var dosDate = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
    var parts = [];
    var central = [];
    var offset = 0;
    files.forEach(function (f) {
      var name = enc.encode(f.name);
      var data = f.data;
      var crc = crc32(data);
      var local = [].concat([0x50, 0x4b, 0x03, 0x04], u16(20), u16(0), u16(0), u16(dosTime), u16(dosDate),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      var lh = new Uint8Array(local);
      parts.push(lh, name, data);
      central.push(new Uint8Array([].concat([0x50, 0x4b, 0x01, 0x02], u16(20), u16(20), u16(0), u16(0),
        u16(dosTime), u16(dosDate), u32(crc), u32(data.length), u32(data.length), u16(name.length),
        u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))), name);
      offset += lh.length + name.length + data.length;
    });
    var cdStart = offset;
    var cdSize = 0;
    central.forEach(function (p) { parts.push(p); cdSize += p.length; });
    parts.push(new Uint8Array([].concat([0x50, 0x4b, 0x05, 0x06], u16(0), u16(0), u16(files.length), u16(files.length),
      u32(cdSize), u32(cdStart), u16(0))));
    var total = parts.reduce(function (a, p) { return a + p.length; }, 0);
    var out = new Uint8Array(total);
    var pos = 0;
    parts.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function colName(n) {
    var s = "";
    while (n > 0) {
      var m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  /* 숫자/백분율/문자 판별 → [타입, 값, 스타일] */
  function cellInfo(v) {
    if (v === null || v === undefined) return ["s", "", 0];
    if (typeof v === "number") return ["n", v, 2];
    var t = String(v).trim();
    if (t === "") return ["s", "", 0];
    if (/^-?[\d,]+$/.test(t)) return ["n", Number(t.replace(/,/g, "")), 2];
    if (/^-?[\d,]+(\.\d+)?$/.test(t)) return ["n", Number(t.replace(/,/g, "")), 0];
    if (/^-?[\d,]+(\.\d+)?%$/.test(t)) return ["n", Number(t.replace(/,/g, "").replace("%", "")) / 100, 3];
    return ["s", t, 0];
  }

  function sheetXml(aoa, freeRows, widths, merges) {
    var rows = aoa.map(function (row, ri) {
      var cells = row.map(function (v, ci) {
        var ref = colName(ci + 1) + (ri + 1);
        var info = cellInfo(v);
        var style = ri < freeRows ? 1 : info[2];
        var sAttr = style ? ' s="' + style + '"' : "";
        if (info[0] === "n") return '<c r="' + ref + '"' + sAttr + "><v>" + info[1] + "</v></c>";
        if (info[1] === "") return "";
        return '<c r="' + ref + '"' + sAttr + ' t="inlineStr"><is><t xml:space="preserve">' + esc(info[1]) + "</t></is></c>";
      }).join("");
      return '<row r="' + (ri + 1) + '">' + cells + "</row>";
    }).join("");
    var cols = widths.map(function (w, i) {
      return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
    }).join("");
    var pane = freeRows
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="' + freeRows + '" topLeftCell="A' + (freeRows + 1)
        + '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : "";
    const mg = (merges && merges.length)
      ? '<mergeCells count="' + merges.length + '">' + merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join("") + "</mergeCells>"
      : "";
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + pane + "<cols>" + cols + "</cols><sheetData>" + rows + "</sheetData>" + mg + "</worksheet>";
  }

  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font>'
    + '<font><b/><sz val="11"/><name val="맑은 고딕"/></font></fonts>'
    + '<fills count="3"><fill><patternFill patternType="none"/></fill>'
    + '<fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFEDF2F9"/><bgColor indexed="64"/></patternFill></fill></fills>'
    + '<borders count="1"><border/></borders>'
    + '<cellStyleXfs count="1"><xf/></cellStyleXfs>'
    + '<cellXfs count="4"><xf xfId="0"/>'
    + '<xf fontId="1" fillId="2" xfId="0" applyFont="1" applyFill="1"/>'
    + '<xf xfId="0" numFmtId="3" applyNumberFormat="1"/>'
    + '<xf xfId="0" numFmtId="10" applyNumberFormat="1"/></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + "</styleSheet>";

  function build(sheets) {
    var names = sheets.map(function (s, i) { return (s.name || "Sheet" + (i + 1)).slice(0, 31); });
    var files = [
      { name: "[Content_Types].xml", data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + sheets.map(function (s, i) {
          return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
        }).join("")
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + "</Types>") },
      { name: "_rels/.rels", data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        + "</Relationships>") },
      { name: "xl/workbook.xml", data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
        + sheets.map(function (s, i) {
          return '<sheet name="' + esc(names[i]) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
        }).join("")
        + "</sheets></workbook>") },
      { name: "xl/_rels/workbook.xml.rels", data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + sheets.map(function (s, i) {
          return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
        }).join("")
        + '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        + "</Relationships>") },
      { name: "xl/styles.xml", data: enc.encode(STYLES) }
    ];
    sheets.forEach(function (s, i) {
      files.push({ name: "xl/worksheets/sheet" + (i + 1) + ".xml", data: enc.encode(sheetXml(s.aoa, s.freeze || 0, s.widths || [], s.merges || [])) });
    });
    return zipStore(files);
  }

  function download(sheets, filename) {
    var bytes = build(sheets);
    var blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename || "download.xlsx";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  window.XLSX_LITE = { build: build, download: download };
})();
