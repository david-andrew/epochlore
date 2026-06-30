"use strict";

/* ============================================================ utils */
const $ = (sel, root = document) => root.querySelector(sel);
const SVGNS = "http://www.w3.org/2000/svg";

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const c of kids) n.append(c?.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
function svg(tag, props = {}) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(props)) if (v !== null && v !== undefined) n.setAttribute(k, v);
  return n;
}

let UID = 1;
const uid = () => UID++;

function floorDiv(a, b) {
  let q = a / b;
  if (a % b !== 0n && (a < 0n) !== (b < 0n)) q -= 1n;
  return q;
}
function mod(a, b) {
  return a - floorDiv(a, b) * b;
}

const PALETTE = ["#5aa9e6", "#e6a15a", "#7bc86c", "#c86c9e", "#d6c64a", "#6cc8c0", "#b07bd6", "#e0556b"];
function randomColor() {
  return PALETTE[(Math.random() * PALETTE.length) | 0];
}
function normColor(c) {
  if (!c) return null;
  c = String(c).trim();
  if (c.startsWith("0x")) return "#" + c.slice(2);
  return c;
}
function denormColor(c) {
  if (c && c.startsWith("#")) return "0x" + c.slice(1);
  return c;
}

/* ============================================================ gregorian (proleptic, BigInt) */
function daysFromCivil(y, m, d) {
  y = m <= 2n ? y - 1n : y;
  const era = (y >= 0n ? y : y - 399n) / 400n;
  const yoe = y - era * 400n;
  const doy = (153n * (m > 2n ? m - 3n : m + 9n) + 2n) / 5n + d - 1n;
  const doe = yoe * 365n + yoe / 4n - yoe / 100n + doy;
  return era * 146097n + doe - 719468n;
}
function civilFromDays(z) {
  z += 719468n;
  const era = (z >= 0n ? z : z - 146096n) / 146097n;
  const doe = z - era * 146097n;
  const yoe = (doe - doe / 1460n + doe / 36524n - doe / 146096n) / 365n;
  const y = yoe + era * 400n;
  const doy = doe - (365n * yoe + yoe / 4n - yoe / 100n);
  const mp = (5n * doy + 2n) / 153n;
  const d = doy - (153n * mp + 2n) / 5n + 1n;
  const m = mp < 10n ? mp + 3n : mp - 9n;
  return { y: m <= 2n ? y + 1n : y, mo: m, d };
}
const DAY = 86400n;
function gregToSeconds(c) {
  return daysFromCivil(c.y, c.mo, c.d) * DAY + c.h * 3600n + c.mi * 60n + c.s;
}
function gregFromSeconds(sec) {
  const day = floorDiv(sec, DAY);
  let rem = sec - day * DAY;
  const { y, mo, d } = civilFromDays(day);
  const h = rem / 3600n;
  rem -= h * 3600n;
  const mi = rem / 60n;
  const s = rem - mi * 60n;
  return { y, mo, d, h, mi, s };
}

/* ============================================================ custom calendars */
function calDaysPerYear(cal) {
  return BigInt(cal.months.reduce((a, m) => a + m.days, 0));
}
function daysBeforeMonth(cal, mo) {
  let n = 0;
  for (let i = 0; i < Number(mo) - 1 && i < cal.months.length; i++) n += cal.months[i].days;
  return BigInt(n);
}
function customSecondsFromZero(c, cal) {
  const spd = BigInt(cal.secondsPerDay);
  const days = c.y * calDaysPerYear(cal) + daysBeforeMonth(cal, c.mo) + (c.d - 1n);
  return days * spd + c.h * 3600n + c.mi * 60n + c.s;
}
function customCompsFromSeconds(ownSec, cal) {
  const spd = BigInt(cal.secondsPerDay);
  const day = floorDiv(ownSec, spd);
  let rem = ownSec - day * spd;
  const dpy = calDaysPerYear(cal);
  const y = floorDiv(day, dpy);
  let doy = Number(day - y * dpy);
  let mo = 1;
  for (let i = 0; i < cal.months.length; i++) {
    if (doy < cal.months[i].days) { mo = i + 1; break; }
    doy -= cal.months[i].days;
    mo = i + 2;
  }
  const h = rem / 3600n; rem -= h * 3600n;
  const mi = rem / 60n; const s = rem - mi * 60n;
  return { y, mo: BigInt(mo), d: BigInt(doy + 1), h, mi, s };
}

/* ============================================================ endpoint parse/format */
function ep(y = 0, mo = 1, d = 1, h = 0, mi = 0, s = 0, prec = "day", calId = null) {
  return { y: BigInt(y), mo: BigInt(mo), d: BigInt(d), h: BigInt(h), mi: BigInt(mi), s: BigInt(s), prec, calId };
}
function parseEndpoint(str) {
  const toks = str.trim().split(/\s+/).filter(Boolean);
  let dateTok = toks[0] || "0";
  let timeTok = null, calId = null;
  for (const t of toks.slice(1)) {
    if (t.includes(":")) timeTok = t;
    else calId = t;
  }
  const neg = dateTok.startsWith("-");
  const dparts = (neg ? dateTok.slice(1) : dateTok).split("-");
  let y = BigInt(dparts0(dparts, 0));
  if (neg) y = -y;
  const mo = dparts.length > 1 ? BigInt(dparts[1]) : 1n;
  const d = dparts.length > 2 ? BigInt(dparts[2]) : 1n;
  let h = 0n, mi = 0n, s = 0n, prec;
  if (timeTok) {
    const tp = timeTok.split(":");
    h = BigInt(tp[0]); mi = BigInt(tp[1] || 0);
    if (tp.length > 2) { s = BigInt(tp[2]); prec = "second"; } else prec = "minute";
  } else {
    prec = dparts.length === 1 ? "year" : dparts.length === 2 ? "month" : "day";
  }
  return { y, mo, d, h, mi, s, prec, calId };
}
function dparts0(arr, i) { return arr[i] === "" ? "0" : arr[i]; }
const pad = (n, w = 2) => String(n).padStart(w, "0");
function formatEndpoint(c, { withCal = true } = {}) {
  const ys = c.y < 0n ? "-" + (-c.y) : String(c.y);
  let out = ys;
  if (c.prec !== "year") out += "-" + pad(c.mo);
  if (c.prec === "day" || c.prec === "minute" || c.prec === "second") out += "-" + pad(c.d);
  if (c.prec === "minute" || c.prec === "second") out += " " + pad(c.h) + ":" + pad(c.mi);
  if (c.prec === "second") out += ":" + pad(c.s);
  if (withCal && c.calId) out += " " + c.calId;
  return out;
}

/* ============================================================ model + time resolution */
const GREG_ALIASES = new Set(["CE", "AD", "BCE", "BC", "GREG", "GREGORIAN"]);
const state = {
  preamble: "",
  timelines: [],
  path: "",
};

function newTimeline(name = "New timeline") {
  return {
    uid: uid(),
    name,
    calId: "CE",
    epoch: ep(2025, 1, 1, 0, 0, 0, "year"),
    calendar: { type: "gregorian", secondsPerDay: 86400, months: [] },
    color: null,
    collapsed: false,
    events: [],
    spans: [],
    anchor: 0n,
  };
}

function isGregRef(calId, timelines) {
  if (!calId) return false;
  if (GREG_ALIASES.has(calId.toUpperCase())) return true;
  const t = timelines.find((x) => x.calId === calId);
  return t && t.calendar.type === "gregorian";
}
function resolveAnchors() {
  const tls = state.timelines;
  for (const t of tls) t.anchor = null;
  for (let pass = 0; pass < tls.length + 2; pass++) {
    let progressed = false;
    for (const t of tls) {
      if (t.anchor !== null) continue;
      if (t.calendar.type === "gregorian") {
        t.anchor = t.epoch ? gregToSeconds(t.epoch) : 0n;
        progressed = true;
        continue;
      }
      const e = t.epoch;
      if (!e) { t.anchor = 0n; progressed = true; continue; }
      if (!e.calId || isGregRef(e.calId, tls)) {
        t.anchor = gregToSeconds(e);
        progressed = true;
        continue;
      }
      const ref = tls.find((x) => x.calId === e.calId);
      if (ref && ref.anchor !== null) {
        t.anchor = ref.calendar.type === "gregorian"
          ? gregToSeconds(e)
          : ref.anchor + customSecondsFromZero(e, ref.calendar);
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  for (const t of tls) if (t.anchor === null) t.anchor = 0n;
}

function absOf(tl, c) {
  if (tl.calendar.type === "gregorian") return gregToSeconds(c);
  return tl.anchor + customSecondsFromZero(c, tl.calendar);
}
function compsAt(tl, abs) {
  if (tl.calendar.type === "gregorian") return gregFromSeconds(abs);
  return customCompsFromSeconds(abs - tl.anchor, tl.calendar);
}
const absStart = (tl, item) => absOf(tl, item.start);
const absEnd = (tl, item) => absOf(tl, item.end);

/* ============================================================ parser */
function shiftHeadings(text, delta) {
  const lines = text.split("\n");
  let fence = false;
  return lines.map((ln) => {
    if (/^\s*```/.test(ln)) fence = !fence;
    if (!fence) {
      const m = ln.match(/^(#{1,6})(\s.*)$/);
      if (m) {
        const lvl = Math.min(6, Math.max(1, m[1].length + delta));
        return "#".repeat(lvl) + m[2];
      }
    }
    return ln;
  }).join("\n");
}
function parseMonths(str) {
  if (!str) return [];
  return str.split(",").map((p) => {
    const [name, days] = p.split(":");
    return { name: name.trim(), days: parseInt(days, 10) || 30 };
  });
}
function parseHeadingSpec(rest) {
  const m = rest.match(/^\[([^\]]*)\]\s*(.*)$/);
  if (!m) return null;
  const inner = m[1].trim();
  const title = m[2].trim();
  if (inner.includes("..")) {
    const [a, b] = inner.split("..");
    return { kind: "span", start: parseEndpoint(a), end: parseEndpoint(b), title };
  }
  return { kind: "event", start: parseEndpoint(inner), title };
}
function applyItemMeta(item, meta) {
  if (meta.color) item.color = normColor(meta.color);
  if (meta.root) {
    const m = meta.root.replace(/[\[\]]/g, "").split(",").map((x) => parseFloat(x));
    if (m.length === 2 && m.every((x) => !isNaN(x))) item.root = m;
  }
  if (meta.z) item.z = parseInt(meta.z, 10);
}
function parse(text) {
  const lines = text.split(/\r?\n/);
  const tls = [];
  let cur = null, item = null, meta = null, inHeader = false, buf = [];
  const preamble = [];
  const flush = () => {
    if (item) item.content = shiftHeadings(buf.join("\n"), -2).replace(/^\n+|\n+$/g, "");
    buf = [];
  };
  const headerMeta = {};
  for (const raw of lines) {
    const mh = raw.match(/^(#{1,6})\s+(.*)$/);
    if (mh && mh[1].length === 1) {
      flush();
      if (cur) finalizeTimeline(cur, headerMeta[cur.uid]);
      cur = { uid: uid(), name: mh[2].trim(), events: [], spans: [] };
      tls.push(cur);
      headerMeta[cur.uid] = {};
      meta = headerMeta[cur.uid];
      item = null; inHeader = true; buf = [];
      continue;
    }
    if (mh && mh[1].length === 2 && cur) {
      flush();
      const spec = parseHeadingSpec(mh[2]);
      if (spec) {
        item = { uid: uid(), kind: spec.kind, start: spec.start, end: spec.end || null, title: spec.title, content: "" };
        (spec.kind === "span" ? cur.spans : cur.events).push(item);
        meta = {}; item._meta = meta; inHeader = true; buf = [];
      }
      continue;
    }
    const mm = raw.match(/^>\s*([A-Za-z_][\w]*)\s*=\s*(.*)$/);
    if (mm && inHeader) {
      meta[mm[1]] = mm[2].split(/\s+#/)[0].trim();
      continue;
    }
    if (raw.trim() === "" && inHeader) continue;
    if (cur === null) { preamble.push(raw); continue; }
    inHeader = false;
    if (item) buf.push(raw);
  }
  flush();
  if (cur) finalizeTimeline(cur, headerMeta[cur.uid]);
  for (const t of tls) {
    for (const it of [...t.events, ...t.spans]) {
      if (it._meta) { applyItemMeta(it, it._meta); delete it._meta; }
      if (it.kind === "span" && !it.color) it.color = randomColor();
    }
  }
  state.preamble = preamble.join("\n").replace(/\n+$/, "");
  state.timelines = tls;
  resolveAnchors();
}
function finalizeTimeline(t, meta) {
  meta = meta || {};
  const months = parseMonths(meta.months);
  t.calId = meta.id || "CE";
  t.calendar = months.length
    ? { type: "custom", secondsPerDay: parseInt(meta.secondsPerDay, 10) || 86400, months }
    : { type: "gregorian", secondsPerDay: 86400, months: [] };
  t.epoch = meta.epoch ? parseEndpoint(meta.epoch) : null;
  t.color = normColor(meta.color);
  t.collapsed = meta.collapsed === "true";
  t.anchor = 0n;
}

/* ============================================================ serializer */
function serialize() {
  const out = [];
  if (state.preamble.trim()) { out.push(state.preamble); out.push(""); }
  for (const t of state.timelines) {
    out.push("# " + t.name);
    out.push("> id=" + t.calId);
    if (t.epoch) out.push("> epoch=" + formatEndpoint(t.epoch));
    if (t.calendar.type === "custom") {
      out.push("> months=" + t.calendar.months.map((m) => m.name + ":" + m.days).join(","));
      if (t.calendar.secondsPerDay !== 86400) out.push("> secondsPerDay=" + t.calendar.secondsPerDay);
    }
    if (t.color) out.push("> color=" + denormColor(t.color));
    if (t.collapsed) out.push("> collapsed=true");
    out.push("");
    const items = [...t.events, ...t.spans].sort((a, b) => {
      const d = absStart(t, a) - absStart(t, b);
      return d < 0n ? -1 : d > 0n ? 1 : 0;
    });
    for (const it of items) {
      const spec = it.kind === "span"
        ? "[" + formatEndpoint(it.start) + " .. " + formatEndpoint(it.end) + "]"
        : "[" + formatEndpoint(it.start) + "]";
      out.push("## " + spec + (it.title ? " " + it.title : ""));
      if (it.color) out.push("> color=" + denormColor(it.color));
      if (it.root) out.push("> root=[" + it.root.map((x) => Math.round(x)).join(",") + "]");
      if (it.z) out.push("> z=" + it.z);
      out.push("");
      if (it.content && it.content.trim()) {
        out.push(shiftHeadings(it.content, 2));
        out.push("");
      }
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/* ============================================================ layout transform (gap collapse) */
const SEC_YEAR = 31557600;
const BREAK_THRESHOLD = 40 * SEC_YEAR;
const BREAK_PX = 56; // fixed on-screen width of a collapsed empty gap (never scales with zoom)
const layout = { ref: 0n, segs: null, worldH: 0 };

function buildLayout() {
  const intervals = [];
  for (const t of state.timelines) {
    for (const e of t.events) { const a = absStart(t, e); intervals.push([a, a]); }
    for (const s of t.spans) { intervals.push([absStart(t, s), absEnd(t, s)]); }
  }
  if (!intervals.length) { layout.ref = 0n; layout.segs = null; return; }
  let ref = intervals[0][0];
  for (const iv of intervals) if (iv[0] < ref) ref = iv[0];
  layout.ref = ref;
  const ivn = intervals.map(([a, b]) => [Number(a - ref), Number(b - ref)]).sort((x, y) => x[0] - y[0]);
  const clusters = [];
  for (const [a, b] of ivn) {
    const last = clusters[clusters.length - 1];
    if (last && a - last[1] <= BREAK_THRESHOLD) last[1] = Math.max(last[1], b);
    else clusters.push([a, b]);
  }
  const segs = [];
  for (let i = 0; i < clusters.length; i++) {
    if (i > 0) segs.push({ wA: clusters[i - 1][1], wB: clusters[i][0], gap: true });
    segs.push({ wA: clusters[i][0], wB: clusters[i][1], gap: false });
  }
  layout.segs = segs;
}

/* ============================================================ view transform
 * panX/panY: scroll offset in screen px
 * timeScale: world-seconds -> px before zoom (the "squish/stretch", ctrl-scroll)
 * zoom: uniform scale applied to element sizes AND both axes (true zoom, scroll)
 * Content scales with pps()=timeScale*zoom; collapsed empty gaps are always BREAK_PX wide. */
const view = { panX: 0, panY: 0, timeScale: 1, zoom: 1 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function W() { return window.innerWidth; }
function H() { return window.innerHeight - 30; }
function pps() { return view.timeScale * view.zoom; }
function SZ(v) { return v * view.zoom; }
function screenY(wy) { return wy * view.zoom + view.panY; }
function worldYAt(py) { return (py - view.panY) / view.zoom; }

// canvas-x = horizontal px from ref (n=0), before applying panX. Content segments use pps;
// gap segments are a fixed BREAK_PX. Built each render from the current pps.
let screenSegs = null;
function buildScreenSegs() {
  if (!layout.segs) { screenSegs = null; return; }
  const p = pps();
  let x = 0;
  screenSegs = layout.segs.map((s) => {
    const w = s.gap ? BREAK_PX : (s.wB - s.wA) * p;
    const seg = { wA: s.wA, wB: s.wB, xA: x, xB: x + w, gap: s.gap };
    x += w;
    return seg;
  });
}
function worldToCanvas(n) {
  const p = pps();
  if (!screenSegs || !screenSegs.length) return n * p;
  const f = screenSegs[0], l = screenSegs[screenSegs.length - 1];
  if (n <= f.wA) return f.xA + (n - f.wA) * p;
  if (n >= l.wB) return l.xB + (n - l.wB) * p;
  for (const s of screenSegs) {
    if (n >= s.wA && n <= s.wB) {
      if (s.wB === s.wA) return s.xA;
      return s.xA + (n - s.wA) * ((s.xB - s.xA) / (s.wB - s.wA));
    }
  }
  return l.xB;
}
function canvasToWorld(x) {
  const p = pps();
  if (!screenSegs || !screenSegs.length) return x / p;
  const f = screenSegs[0], l = screenSegs[screenSegs.length - 1];
  if (x <= f.xA) return f.wA + (x - f.xA) / p;
  if (x >= l.xB) return l.wB + (x - l.xB) / p;
  for (const s of screenSegs) {
    if (x >= s.xA && x <= s.xB) {
      if (s.xB === s.xA) return s.wA;
      return s.wA + (x - s.xA) * ((s.wB - s.wA) / (s.xB - s.xA));
    }
  }
  return l.wB;
}
function screenXFromN(n) { return view.panX + worldToCanvas(n); }
function nFromScreenX(px) { return canvasToWorld(px - view.panX); }
function absToX(abs) { return screenXFromN(Number(abs - layout.ref)); }
function xToAbs(px) { return layout.ref + BigInt(Math.round(nFromScreenX(px))); }
function fitView() {
  const w = W();
  view.zoom = 1;
  buildLayout();
  if (layout.segs) {
    let contentWorld = 0, nBreaks = 0;
    for (const s of layout.segs) { if (s.gap) nBreaks++; else contentWorld += (s.wB - s.wA); }
    const usable = Math.max(80, w - 300 - nBreaks * BREAK_PX);
    view.timeScale = Math.max(1e-9, usable / Math.max(contentWorld, SEC_YEAR));
    buildScreenSegs();
    view.panX = 150;
  } else {
    view.timeScale = 80 / SEC_YEAR;
    buildScreenSegs();
    view.panX = w / 2;
  }
  layoutRows();
  view.panY = Math.max(24, (H() - layout.worldH) / 2);
}

/* ============================================================ vertical rows (world space) */
const ROW_H = 168, COLLAPSED_H = 44;
function layoutRows() {
  let cur = 0;
  for (const t of state.timelines) {
    const h = t.collapsed ? COLLAPSED_H : ROW_H;
    t._wy = cur + h / 2;
    t._wh = h;
    cur += h;
  }
  layout.worldH = cur * view.zoom;
}
function applyTransform() {
  for (const t of state.timelines) {
    t._y = screenY(t._wy);
    t._rowH = SZ(t._wh);
    t._rowTop = t._y - t._rowH / 2;
  }
}

/* ============================================================ rendering */
const stage = $("#stage");
const defs = $("#defs");
const overlay = $("#overlay");
const gutter = $("#gutter");
let structuralDirty = true;
const patternIds = new Set();

function clearSVG() {
  while (stage.lastChild && stage.lastChild !== defs) stage.removeChild(stage.lastChild);
}
function ensureHatch(colors) {
  const id = "h_" + colors.map((c) => c.replace(/[^a-z0-9]/gi, "")).join("_");
  if (patternIds.has(id)) return id;
  patternIds.add(id);
  const sw = 7;
  const p = svg("pattern", { id, patternUnits: "userSpaceOnUse", width: colors.length * sw, height: 10, patternTransform: "rotate(45)" });
  colors.forEach((c, i) => p.append(svg("rect", { x: i * sw, y: 0, width: sw, height: 10, fill: c })));
  defs.append(p);
  return id;
}

function spanAt(tl, abs) {
  let best = null, bestRange = Infinity;
  for (const s of tl.spans) {
    const a = absStart(tl, s), b = absEnd(tl, s);
    if (abs >= a && abs <= b) {
      const r = Number(b - a);
      if (r < bestRange) { bestRange = r; best = s; }
    }
  }
  return best;
}

function drawSpans(tl) {
  if (!tl.spans.length) return;
  const pts = new Set();
  for (const s of tl.spans) { pts.add(absStart(tl, s)); pts.add(absEnd(tl, s)); }
  const sorted = [...pts].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const bandH = tl.collapsed ? Math.max(8, tl._rowH - 8) : clamp(SZ(18), 8, 90);
  for (let i = 0; i < sorted.length - 1; i++) {
    const p = sorted[i], q = sorted[i + 1];
    const mid = p + (q - p) / 2n;
    const cover = tl.spans.filter((s) => mid >= absStart(tl, s) && mid < absEnd(tl, s));
    if (!cover.length) continue;
    const x1 = absToX(p), x2 = absToX(q);
    if (x2 < -50 || x1 > W() + 50) continue;
    const sortedCover = [...cover].sort((a, b) =>
      Number((absEnd(tl, a) - absStart(tl, a)) - (absEnd(tl, b) - absStart(tl, b))));
    let nested = true;
    for (let k = 0; k < sortedCover.length - 1; k++) {
      const a = sortedCover[k], big = sortedCover[k + 1];
      if (!(absStart(tl, a) >= absStart(tl, big) && absEnd(tl, a) <= absEnd(tl, big))) { nested = false; break; }
    }
    let fill, opacity = 0.45;
    if (nested) fill = sortedCover[0].color || "#888";
    else {
      const cols = [...new Set(sortedCover.map((s) => s.color || "#888"))].sort();
      fill = "url(#" + ensureHatch(cols) + ")";
      opacity = 0.6;
    }
    stage.append(svg("rect", {
      x: x1, y: tl._y - bandH / 2, width: Math.max(1, x2 - x1), height: bandH,
      fill, "fill-opacity": opacity, rx: 2,
    }));
  }
}

function drawTimeline(tl) {
  const y = tl._y, w = W();
  const items = [...tl.events, ...tl.spans];
  let minA = null, maxA = null;
  for (const it of items) {
    const a = absStart(tl, it), b = it.kind === "span" ? absEnd(tl, it) : a;
    if (minA === null || a < minA) minA = a;
    if (maxA === null || b > maxA) maxA = b;
  }
  const strong = tl.collapsed ? 0.4 : 1;
  const sw = clamp(SZ(1.5), 1, 6), sws = clamp(SZ(2), 1.2, 8);
  if (minA === null) {
    stage.append(svg("line", { x1: 0, y1: y, x2: w, y2: y, stroke: "var(--line)", "stroke-width": sw, "stroke-dasharray": "2 5", opacity: strong }));
  } else {
    const x1 = absToX(minA), x2 = absToX(maxA);
    stage.append(svg("line", { x1: Math.min(0, x1), y1: y, x2: x1, y2: y, stroke: "var(--line)", "stroke-width": sw, "stroke-dasharray": "2 5", opacity: strong }));
    stage.append(svg("line", { x1: x2, y1: y, x2: Math.max(w, x2), y2: y, stroke: "var(--line)", "stroke-width": sw, "stroke-dasharray": "2 5", opacity: strong }));
    stage.append(svg("line", { x1, y1: y, x2, y2: y, stroke: "var(--line-strong)", "stroke-width": sws, opacity: strong }));
  }
  // epoch marker
  const ex = absToX(tl.anchor);
  const th = clamp(SZ(9), 5, 40);
  if (ex > -40 && ex < w + 40) {
    stage.append(svg("line", { x1: ex, y1: y - th, x2: ex, y2: y + th, stroke: "var(--accent)", "stroke-width": sw, opacity: 0.7 }));
  }
  if (tl.collapsed) return;
  drawSpans(tl);
  const r = clamp(SZ(4.5), 2.5, 16), fs = clamp(SZ(10.5), 8, 22);
  for (const e of tl.events) {
    const x = absToX(absStart(tl, e));
    if (x < -50 || x > w + 50) continue;
    stage.append(svg("circle", { cx: x, cy: y, r, fill: e.color || "var(--accent)", stroke: "var(--bg)", "stroke-width": clamp(SZ(1.5), 1, 4) }));
    const lbl = svg("text", { x, y: y + fs + 6, "text-anchor": "middle", fill: "var(--muted)", "font-size": fs });
    lbl.textContent = formatEndpoint({ ...e.start, calId: null });
    stage.append(lbl);
  }
}

function drawBreaks() {
  if (!screenSegs) return;
  for (const s of screenSegs) {
    if (!s.gap) continue;
    const x = view.panX + (s.xA + s.xB) / 2;
    if (x < -10 || x > W() + 10) continue;
    let d = "";
    const top = 40, bot = H() - 30, step = 14;
    for (let yy = top, k = 0; yy < bot; yy += step, k++) {
      d += (k === 0 ? "M" : "L") + (x + (k % 2 ? 5 : -5)) + " " + yy + " ";
    }
    stage.append(svg("path", { d, fill: "none", stroke: "var(--border)", "stroke-width": 1.5 }));
  }
}

function drawConnectors() {
  for (const t of state.timelines) {
    if (t.collapsed) continue;
    for (const it of [...t.events, ...t.spans]) {
      if (!it._box) continue;
      const box = it._box;
      const bx = box.offsetLeft, by = box.offsetTop, bw = box.offsetWidth * view.zoom, bh = box.offsetHeight * view.zoom;
      const ax = it.kind === "span" ? (absToX(absStart(t, it)) + absToX(absEnd(t, it))) / 2 : absToX(absStart(t, it));
      const ay = t._y;
      const tx = Math.max(bx, Math.min(ax, bx + bw));
      const ty = Math.max(by, Math.min(ay, by + bh));
      stage.append(svg("line", { x1: ax, y1: ay, x2: tx, y2: ty, stroke: "var(--border)", "stroke-width": 1.2, "stroke-dasharray": "3 3" }));
    }
  }
}

function render() {
  buildLayout();
  buildScreenSegs();
  layoutRows();
  applyTransform();
  if (structuralDirty) { rebuildOverlay(); structuralDirty = false; }
  rebuildGutter();
  positionOverlay();
  clearSVG();
  drawBreaks();
  for (const t of state.timelines) drawTimeline(t);
  drawConnectors();
}
// coalesce the many pointer/wheel events fired per frame into a single render, so panning
// and zooming stay smooth (the desktop webview in particular chokes on per-event renders)
let _renderQueued = false;
function scheduleRender() {
  if (_renderQueued) return;
  _renderQueued = true;
  requestAnimationFrame(() => { _renderQueued = false; render(); });
}

/* ============================================================ overlay (boxes + labels) */
function md(text) {
  const html = marked.parse(text || "", { breaks: true, gfm: true });
  return DOMPurify.sanitize(html);
}
const TRASH = "\u{1f5d1}";
function spanHasContent(it) { return !!(it.content && it.content.trim()); }
function rebuildOverlay() {
  overlay.textContent = "";
  for (const t of state.timelines) {
    for (const it of t.events) { it._box = null; makeBox(t, it); }
    for (const it of t.spans) {
      it._box = null;
      makeSpanLabel(t, it);
      if (spanHasContent(it) || it._open) makeBox(t, it);
    }
  }
}
function makeBox(tl, it) {
  const box = el("div", { class: "box" + (it.kind === "event" ? " event" : " span") });
  if (it.kind === "span" && it.color) box.style.borderTop = "3px solid " + it.color;
  it._box = box;
  const head = el("div", { class: "box-head" });
  const makeTitle = () => {
    const d = el("div", { class: "box-title" + (it.title ? "" : " empty"), title: "double-click to edit title" }, it.title || "");
    d.addEventListener("dblclick", () => startEdit(it, "title", false, d, makeTitle));
    return d;
  };
  head.append(makeTitle());
  const del = el("button", { class: "icon-btn danger", title: "delete" }, TRASH);
  del.addEventListener("mousedown", (e) => e.stopPropagation());
  del.addEventListener("click", () => deleteItem(tl, it));
  head.append(del);

  const dateRow = makeDateDisplay(it);

  const body = el("div", { class: "box-body" });
  const makeContent = () => {
    const r = el("div", { class: "rendered" + (it.content ? "" : " empty"), title: "double-click to edit" });
    r.innerHTML = md(it.content);
    rewriteLinks(r);
    r.addEventListener("dblclick", () => startEdit(it, "content", true, r, makeContent));
    return r;
  };
  body.append(makeContent());
  box.append(head, dateRow, body);
  box.addEventListener("pointerdown", (e) => { bringToFront(it); startBoxDrag(e, box, it); });
  overlay.append(box);
}

// the date line under a box title: shows the event's start (or a span's start .. end) and lets
// you retype it; reverts if the text doesn't parse, then re-resolves and re-lays-out the timeline.
function dateText(it) {
  return it.kind === "span" ? formatEndpoint(it.start) + " .. " + formatEndpoint(it.end) : formatEndpoint(it.start);
}
function makeDateDisplay(it) {
  const d = el("div", { class: "box-date", title: "double-click to edit the date" }, dateText(it));
  d.addEventListener("mousedown", (e) => e.stopPropagation());
  d.addEventListener("dblclick", () => startDateEdit(it, d));
  return d;
}
function startDateEdit(it, displayEl) {
  finalizeActiveEdit(true);
  const before = dateText(it);
  const input = el("input", { class: "date-edit", title: it.kind === "span" ? "start .. end" : "YYYY-MM-DD hh:mm:ss [cal]" });
  input.value = before;
  displayEl.replaceWith(input);
  input.focus(); input.select();
  const finalize = (save) => {
    let ok = true;
    if (save && input.value !== before) {
      try {
        if (it.kind === "span") {
          const parts = input.value.split("..");
          const a = parseEndpoint(parts[0]);
          const b = parseEndpoint(parts[1] != null ? parts[1] : parts[0]);
          it.start = a; it.end = b;
        } else {
          it.start = parseEndpoint(input.value);
        }
      } catch (e) { ok = false; }
    }
    if (input.parentNode) input.replaceWith(makeDateDisplay(it));
    if (save && ok && input.value !== before) { resolveAnchors(); structuralDirty = true; render(); commit(); }
  };
  input.addEventListener("blur", () => finalizeActiveEdit(true));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); finalizeActiveEdit(false); }
    else if (e.key === "Enter") { e.preventDefault(); finalizeActiveEdit(true); }
  });
  activeEdit = { input, finalize };
}

/* inline editing: double-click swaps a display element for an input/textarea.
 * Clicking anywhere outside commits; Escape cancels; Enter commits a title. */
let activeEdit = null;
function startEdit(it, field, multiline, displayEl, makeDisplay) {
  finalizeActiveEdit(true);
  if (it._box) bringToFront(it);
  const before = it[field] || "";
  const input = multiline ? el("textarea") : el("input", { class: "title-edit", placeholder: "title" });
  input.value = before;
  displayEl.replaceWith(input);
  input.focus();
  if (!multiline) input.select();
  const finalize = (save) => {
    const val = input.value;
    const changed = save && val !== before;
    if (save) it[field] = val;
    const fresh = makeDisplay();
    if (input.parentNode) input.replaceWith(fresh);
    if (field === "title" && it._labelTitle) {
      it._labelTitle.textContent = it.title || "";
      it._labelTitle.classList.toggle("empty", !it.title);
    }
    // an empty span (only an era, no notes) collapses back to just its highlight
    if (it.kind === "span" && !spanHasContent(it)) { it._open = false; if (it._box) { it._box.remove(); it._box = null; } }
    if (changed) commit();
  };
  input.addEventListener("blur", () => finalizeActiveEdit(true));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); finalizeActiveEdit(false); }
    else if (e.key === "Enter" && !multiline) { e.preventDefault(); finalizeActiveEdit(true); }
  });
  activeEdit = { input, finalize };
}
function finalizeActiveEdit(save = true) {
  if (!activeEdit) return;
  const a = activeEdit;
  activeEdit = null;
  a.finalize(save);
}
// commit the active editor when the user mouses down anywhere outside its input
document.addEventListener("mousedown", (e) => {
  if (activeEdit && activeEdit.input !== e.target && !activeEdit.input.contains(e.target)) finalizeActiveEdit(true);
}, true);

// Relative image/link paths are resolved through the server's /file/ route. This only works
// in the server and desktop (Neutralino) builds; on the static web build local relative paths
// won't resolve, so use absolute http(s) or data: URLs for images there.
function rewriteLinks(root) {
  root.querySelectorAll("img").forEach((img) => {
    const s = img.getAttribute("src") || "";
    if (!/^(https?:|data:|\/)/.test(s)) img.src = "/file/" + s;
  });
  root.querySelectorAll("a").forEach((a) => {
    const h = a.getAttribute("href") || "";
    if (!/^(https?:|mailto:|#|\/)/.test(h)) a.href = "/file/" + h;
    a.target = "_blank";
  });
}
function makeSpanLabel(tl, it) {
  const lab = el("div", { class: "span-label" });
  it._label = lab;
  const sw = el("span", { class: "swatch", style: "background:" + (it.color || "#888") });
  const ci = el("input", { type: "color", value: it.color || "#888888", style: "opacity:0;width:0;height:0;position:absolute" });
  ci.addEventListener("input", () => { it.color = ci.value; sw.style.background = ci.value; render(); });
  ci.addEventListener("change", () => commit());
  sw.addEventListener("mousedown", (e) => e.stopPropagation());
  sw.addEventListener("click", (e) => { e.stopPropagation(); ci.click(); });
  const lbl = el("div", { class: "lbl" + (it.title ? "" : " empty"), title: "double-click to edit" }, it.title || "");
  it._labelTitle = lbl;
  const del = el("button", { class: "icon-btn danger", title: "delete span", style: "width:16px;height:16px;font-size:12px" }, TRASH);
  del.addEventListener("mousedown", (e) => e.stopPropagation());
  del.addEventListener("click", () => deleteItem(tl, it));
  lab.append(sw, ci, lbl, del);
  lab.addEventListener("dblclick", (e) => { e.stopPropagation(); openSpanEditor(it); });
  overlay.append(lab);
}

function positionOverlay() {
  const stack = new Map();
  for (const t of state.timelines) {
    for (const it of [...t.events, ...t.spans]) {
      if (it._label) {
        const mx = (absToX(absStart(t, it)) + absToX(absEnd(t, it))) / 2;
        it._label.style.left = mx + "px";
        it._label.style.top = t._y + "px";
        it._label.style.transform = `translate(-50%, -50%) scale(${view.zoom})`;
        it._label.style.display = t.collapsed ? "none" : "";
      }
      if (it._box) {
        const ax = it.kind === "span" ? (absToX(absStart(t, it)) + absToX(absEnd(t, it))) / 2 : absToX(absStart(t, it));
        let left, top;
        if (it.root) { left = screenXFromN(it.root[0]); top = screenY(it.root[1]); }
        else {
          const k = stack.get(t.uid) || 0; stack.set(t.uid, k + 1);
          left = ax - 130 * view.zoom;
          top = t._y - SZ(96 + k * 26) - 24;
          if (top < 36) top = t._y + SZ(40) + k * 26;
        }
        it._box.style.left = Math.round(left) + "px";
        it._box.style.top = Math.round(top) + "px";
        it._box.style.transformOrigin = "top left";
        it._box.style.transform = `scale(${view.zoom})`;
        it._box.style.display = t.collapsed ? "none" : "";
        if (it.z) it._box.style.zIndex = it.z;
      }
    }
  }
  pruneZ();
}

/* ============================================================ overlap / z-index */
let zCounter = 10;
function bringToFront(it) {
  if (!it._box) return;
  it.z = ++zCounter;
  it._box.style.zIndex = it.z;
  scheduleSave();
}
function rect(b) { return { l: b.offsetLeft, t: b.offsetTop, r: b.offsetLeft + b.offsetWidth * view.zoom, b: b.offsetTop + b.offsetHeight * view.zoom }; }
function overlaps(a, b) { return !(a.r < b.l || a.l > b.r || a.b < b.t || a.t > b.b); }
function pruneZ() {
  const boxes = [];
  for (const t of state.timelines) for (const it of [...t.events, ...t.spans]) if (it._box && !t.collapsed) boxes.push(it);
  for (const it of boxes) {
    const ri = rect(it._box);
    const hit = boxes.some((o) => o !== it && overlaps(ri, rect(o._box)));
    if (!hit && it.z) { it.z = undefined; it._box.style.zIndex = ""; }
  }
}

/* ============================================================ auto-arrange
 * Boxes are grouped by (timeline, side) — sides alternate above/below so both lanes get
 * used. Within a group every box keeps a uniform standoff off the line (never on it), and
 * a 1D minimal-displacement pack spreads them left/right into empty horizontal space while
 * preserving chronological order and preventing mutual overlap. Final positions go to root. */
const A_PAD = 26, A_STANDOFF = 40, A_CLEAR = 16;
// optimal order-preserving, non-overlapping 1D placement: minimises total squared shift of
// each box centre from its anchor. items are pre-sorted by desired centre `c`; mutates `c`.
function packRow(items) {
  const blocks = [];
  for (const it of items) {
    let block = { items: [it], left: it.c - it.w / 2, width: it.w };
    while (blocks.length) {
      const p = blocks[blocks.length - 1];
      if (p.left + p.width + A_PAD <= block.left) break;
      const merged = p.items.concat(block.items);
      let off = 0, sum = 0;
      for (const m of merged) { sum += m.c - (off + m.w / 2); off += m.w + A_PAD; }
      block = { items: merged, left: sum / merged.length, width: off - A_PAD };
      blocks.pop();
    }
    blocks.push(block);
  }
  for (const b of blocks) { let off = 0; for (const m of b.items) { m.c = b.left + off + m.w / 2; off += m.w + A_PAD; } }
}
function autoArrange() {
  const vtop = 40, vbot = H() - 14, w = W();
  // group by (timeline, side) and pack each group horizontally for a tidy starting layout
  const groups = new Map();
  const all = [];
  for (const t of state.timelines) {
    if (t.collapsed) continue;
    let k = 0;
    for (const it of [...t.events, ...t.spans]) {
      if (!it._box) continue;
      const bw = it._box.offsetWidth * view.zoom, bh = it._box.offsetHeight * view.zoom;
      const ax = it.kind === "span" ? (absToX(absStart(t, it)) + absToX(absEnd(t, it))) / 2 : absToX(absStart(t, it));
      const side = k++ % 2 === 0 ? -1 : 1;
      const key = t.uid + "|" + side;
      if (!groups.has(key)) groups.set(key, { ly: t._y, side, items: [] });
      const box = { it, w: bw, h: bh, ly: t._y, side, c: ax };
      groups.get(key).items.push(box);
      all.push(box);
    }
  }
  if (!all.length) return;
  for (const g of groups.values()) {
    const row = [...g.items].sort((a, b) => a.c - b.c);
    packRow(row);
    for (const m of row) {
      m.x0 = clamp(m.c - m.w / 2, 0, w - m.w);
      m.y0 = m.side < 0 ? Math.min(Math.max(m.ly - A_STANDOFF - m.h, vtop), m.ly - A_CLEAR - m.h)
                        : Math.max(Math.min(m.ly + A_STANDOFF, vbot - m.h), m.ly + A_CLEAR);
      m.x = m.x0; m.y = m.y0;
    }
  }
  // global all-vs-all relaxation: separate any overlapping boxes (across timelines too),
  // gently spring back toward the packed spot, and keep every box off its own line + on-screen
  const constrain = (b) => {
    b.x = clamp(b.x, 0, Math.max(0, w - b.w));
    if (b.side < 0) b.y = Math.min(b.y, b.ly - A_CLEAR - b.h);
    else b.y = Math.max(b.y, b.ly + A_CLEAR);
    b.y = clamp(b.y, vtop, Math.max(vtop, vbot - b.h));
    if (b.side < 0) b.y = Math.min(b.y, b.ly - A_CLEAR - b.h);
    else b.y = Math.max(b.y, b.ly + A_CLEAR);
  };
  for (let iter = 0; iter < 500; iter++) {
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        const dx = (b.x + b.w / 2) - (a.x + a.w / 2), dy = (b.y + b.h / 2) - (a.y + a.h / 2);
        const ox = (a.w + b.w) / 2 + A_PAD - Math.abs(dx);
        const oy = (a.h + b.h) / 2 + A_PAD - Math.abs(dy);
        if (ox > 0 && oy > 0) {
          if (ox <= oy) { const s = ((dx < 0 ? -1 : 1) * ox) / 2; a.x -= s; b.x += s; }
          else { const s = ((dy < 0 ? -1 : 1) * oy) / 2; a.y -= s; b.y += s; }
        }
      }
    }
    for (const b of all) {
      b.x += (b.x0 - b.x) * 0.04;
      b.y += (b.y0 - b.y) * 0.04;
      constrain(b);
    }
  }
  for (const b of all) b.it.root = [nFromScreenX(b.x), worldYAt(b.y)];
  render();
  commit();
}

/* ============================================================ box dragging (single click drag, dbl-click edits) */
function startBoxDrag(e, box, it) {
  if (e.target.closest("input, textarea, button, a, .swatch, .box-date")) return;
  if (e.pointerType === "mouse" && e.button !== 0) return;
  e.preventDefault();
  const sx = e.clientX, sy = e.clientY, sl = box.offsetLeft, st = box.offsetTop;
  let moved = false;
  const move = (ev) => {
    if (!moved && Math.abs(ev.clientX - sx) < 3 && Math.abs(ev.clientY - sy) < 3) return;
    moved = true;
    const nl = sl + (ev.clientX - sx), nt = st + (ev.clientY - sy);
    box.style.left = nl + "px"; box.style.top = nt + "px";
    it.root = [nFromScreenX(nl), worldYAt(nt)];
    scheduleRender();
  };
  const up = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    if (moved) commit();
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
}

/* ============================================================ item ops */
// open a span's text box (creating it if needed) and jump into editing: title if it's
// still unnamed, otherwise its notes
function openSpanEditor(it) {
  it._open = true;
  structuralDirty = true;
  render();
  const sel = it.title ? ".rendered" : ".box-title";
  requestAnimationFrame(() => it._box?.querySelector(sel)?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
}
function deleteItem(tl, it) {
  const arr = it.kind === "span" ? tl.spans : tl.events;
  const i = arr.indexOf(it);
  if (i >= 0) arr.splice(i, 1);
  structuralDirty = true;
  render();
  commit();
}
function createEvent(tl, abs) {
  const c = compsAt(tl, abs);
  const e = { uid: uid(), kind: "event", start: ep(Number(c.y), Number(c.mo), Number(c.d), 0, 0, 0, "day"), title: "", content: "" };
  tl.events.push(e);
  structuralDirty = true;
  render();
  commit();
  requestAnimationFrame(() => e._box?.querySelector(".box-title")?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
}
function createSpan(tl, absA, absB) {
  const lo = absA < absB ? absA : absB, hi = absA < absB ? absB : absA;
  const ca = compsAt(tl, lo), cb = compsAt(tl, hi);
  const s = {
    uid: uid(), kind: "span",
    start: ep(Number(ca.y), Number(ca.mo), Number(ca.d), 0, 0, 0, "day"),
    end: ep(Number(cb.y), Number(cb.mo), Number(cb.d), 0, 0, 0, "day"),
    title: "", content: "", color: randomColor(),
  };
  tl.spans.push(s);
  structuralDirty = true;
  render();
  commit();
  openSpanEditor(s);
}

/* ============================================================ gutter */
function rebuildGutter() {
  gutter.textContent = "";
  const tls = state.timelines;
  const insertAt = (y, idx) => {
    const b = el("button", { class: "tl-insert", title: "add timeline", style: "top:" + y + "px" }, "+");
    b.addEventListener("click", () => addTimeline(idx));
    gutter.append(b);
  };
  if (!tls.length) { insertAt(H() / 2, 0); return; }
  insertAt(tls[0]._rowTop, 0);
  tls.forEach((t, i) => {
    insertAt(t._rowTop + t._rowH, i + 1);
    if (t.collapsed) {
      const r = el("button", { class: "tl-restore", style: "top:" + t._y + "px" }, "\u25b8 " + t.name);
      r.addEventListener("click", () => { t.collapsed = false; structuralDirty = true; render(); commit(); });
      gutter.append(r);
      return;
    }
    const ctl = el("div", { class: "tl-row-ctl", style: "top:" + t._y + "px" });
    const handle = el("span", { class: "tl-drag", title: "drag to reorder" }, "\u2630");
    handle.addEventListener("pointerdown", (e) => startTimelineReorder(e, t));
    ctl.append(handle);
    ctl.append(el("span", { class: "tl-name", title: t.name }, t.name || "untitled"));
    ctl.append(el("span", { class: "tl-cal" }, t.calId));
    const collapse = el("button", { class: "icon-btn", title: "collapse" }, "\u2013");
    collapse.addEventListener("click", () => { t.collapsed = true; structuralDirty = true; render(); commit(); });
    const gear = el("button", { class: "icon-btn", title: "settings" }, "\u2699");
    gear.addEventListener("click", () => openSettings(t));
    const del = el("button", { class: "icon-btn danger", title: "delete timeline" }, "\u{1f5d1}");
    del.addEventListener("click", () => deleteTimeline(t));
    ctl.append(collapse, gear, del);
    gutter.append(ctl);
  });
}
// drag a timeline's gutter handle up/down to reorder; a guide line shows where it will land
let reorderLine = null;
function rowBoundaryY(k) {
  const tls = state.timelines;
  if (!tls.length) return H() / 2;
  return k < tls.length ? tls[k]._rowTop : tls[tls.length - 1]._rowTop + tls[tls.length - 1]._rowH;
}
function targetIndexAt(y) {
  const tls = state.timelines;
  for (let i = 0; i < tls.length; i++) if (y < tls[i]._rowTop + tls[i]._rowH / 2) return i;
  return tls.length;
}
function startTimelineReorder(e, t) {
  e.preventDefault();
  e.stopPropagation();
  const fromIdx = state.timelines.indexOf(t);
  if (!reorderLine) { reorderLine = el("div", { class: "reorder-line" }); appEl.append(reorderLine); }
  const showAt = (y) => { reorderLine.style.display = "block"; reorderLine.style.top = rowBoundaryY(targetIndexAt(y)) + "px"; };
  showAt(e.clientY);
  const onMove = (ev) => showAt(ev.clientY);
  const onUp = (ev) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    reorderLine.style.display = "none";
    const to = targetIndexAt(ev.clientY);
    const dest = to > fromIdx ? to - 1 : to;
    if (dest !== fromIdx) {
      const [moved] = state.timelines.splice(fromIdx, 1);
      state.timelines.splice(dest, 0, moved);
      resolveAnchors();
      structuralDirty = true;
      render();
      commit();
    }
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}
function addTimeline(idx) {
  const t = newTimeline();
  state.timelines.splice(idx, 0, t);
  resolveAnchors();
  structuralDirty = true;
  render();
  commit();
  openSettings(t);
}
function deleteTimeline(t) {
  const hasContent = t.events.length || t.spans.length;
  const doDelete = () => {
    const i = state.timelines.indexOf(t);
    if (i >= 0) state.timelines.splice(i, 1);
    resolveAnchors();
    structuralDirty = true;
    render();
    commit();
  };
  if (hasContent) confirmModal(`Delete "${t.name}" and its ${t.events.length} event(s) and ${t.spans.length} span(s)?`, doDelete);
  else doDelete();
}

/* ============================================================ modals */
const modalRoot = $("#modal-root");
function closeModal() { modalRoot.classList.remove("open"); modalRoot.textContent = ""; }
function confirmModal(msg, onYes, okLabel = "Delete") {
  const m = el("div", { class: "modal" },
    el("h2", {}, "Are you sure?"),
    el("p", { class: "warn" }, msg));
  const actions = el("div", { class: "actions" });
  const cancel = el("button", { class: "btn" }, "Cancel");
  cancel.addEventListener("click", closeModal);
  const ok = el("button", { class: "btn danger" }, okLabel);
  ok.addEventListener("click", () => { closeModal(); onYes(); });
  actions.append(cancel, ok);
  m.append(actions);
  modalRoot.textContent = "";
  modalRoot.append(m);
  modalRoot.classList.add("open");
}
function openSettings(t) {
  const m = el("div", { class: "modal" }, el("h2", {}, "Timeline settings"));
  const fName = el("input", { value: t.name });
  const fId = el("input", { value: t.calId });
  const fEpoch = el("input", { value: t.epoch ? formatEndpoint(t.epoch) : "", placeholder: "e.g. 2025  or  201953 CE" });
  const fType = el("select");
  fType.append(el("option", { value: "gregorian" }, "gregorian (Earth)"), el("option", { value: "custom" }, "custom calendar"));
  fType.value = t.calendar.type;
  const fSpd = el("input", { type: "number", value: t.calendar.secondsPerDay });
  const fMonths = el("textarea", { placeholder: "Name:days, one per comma\nJan:31,Feb:28,..." }, t.calendar.months.map((x) => x.name + ":" + x.days).join(","));
  const customWrap = el("div", {},
    el("label", {}, "seconds per day"), fSpd,
    el("label", {}, "months (Name:days, comma-separated)"), fMonths);
  const syncType = () => { customWrap.style.display = fType.value === "custom" ? "" : "none"; };
  fType.addEventListener("change", syncType);
  m.append(
    el("label", {}, "name"), fName,
    el("div", { class: "row" },
      el("div", {}, el("label", {}, "calendar id (era)"), fId),
      el("div", {}, el("label", {}, "epoch / anchor"), fEpoch)),
    el("label", {}, "calendar type"), fType,
    customWrap);
  syncType();
  const actions = el("div", { class: "actions" });
  const cancel = el("button", { class: "btn" }, "Cancel");
  cancel.addEventListener("click", closeModal);
  const save = el("button", { class: "btn primary" }, "Save");
  save.addEventListener("click", () => {
    t.name = fName.value.trim() || "untitled";
    t.calId = fId.value.trim() || "CE";
    t.epoch = fEpoch.value.trim() ? parseEndpoint(fEpoch.value.trim()) : null;
    if (fType.value === "custom") {
      const months = parseMonths(fMonths.value);
      t.calendar = { type: "custom", secondsPerDay: parseInt(fSpd.value, 10) || 86400, months: months.length ? months : [{ name: "M1", days: 30 }] };
    } else t.calendar = { type: "gregorian", secondsPerDay: 86400, months: [] };
    resolveAnchors();
    structuralDirty = true;
    closeModal();
    render();
    commit();
  });
  actions.append(cancel, save);
  m.append(actions);
  modalRoot.textContent = "";
  modalRoot.append(m);
  modalRoot.classList.add("open");
}
modalRoot.addEventListener("mousedown", (e) => { if (e.target === modalRoot) closeModal(); });

/* ============================================================ stage interactions */
function timelineNear(py) {
  let best = null, bd = 16;
  for (const t of state.timelines) {
    if (t.collapsed) continue;
    const d = Math.abs(py - t._y);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}
const ghost = $("#ghost");
function hideGhost() { ghost.style.display = "none"; }
function updateHover(e) {
  if (drag || modalRoot.classList.contains("open")) { hideGhost(); return; }
  const tl = timelineNear(e.clientY);
  if (tl) {
    stage.style.cursor = "crosshair";
    ghost.style.display = "block";
    ghost.style.left = e.clientX + "px";
    ghost.style.top = tl._y + "px";
  } else {
    stage.style.cursor = "";
    hideGhost();
  }
}

// cap a span drag to ~one screen-width of world time at content scale, so a small
// drag in a compressed gap can't become a million-year span (edit for bigger spans).
function clampSpanEnd(startAbs, endAbs) {
  const maxWorld = BigInt(Math.max(1, Math.round(W() / pps())));
  const lo = startAbs - maxWorld, hi = startAbs + maxWorld;
  return endAbs < lo ? lo : endAbs > hi ? hi : endAbs;
}

// Pointer-based canvas interaction: one pointer pans the view or creates an event/span;
// two pointers pinch-zoom (true zoom around the focal midpoint) and pan together. Works for
// mouse, trackpad and touch alike. Wheel zoom is handled separately and is already global.
let drag = null, gesture = null;
const stagePointers = new Map();
function pinchMetrics() {
  const [a, b] = [...stagePointers.values()];
  return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
}
stage.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  stagePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { stage.setPointerCapture(e.pointerId); } catch (err) {}
  if (stagePointers.size === 2) {
    if (drag && drag.preview) drag.preview.remove();
    drag = null; stage.classList.remove("panning");
    const m = pinchMetrics();
    gesture = { startDist: m.dist, startZoom: view.zoom, nUnder: nFromScreenX(m.mx), wyUnder: worldYAt(m.my) };
    return;
  }
  if (stagePointers.size > 2) return;
  hideGhost();
  const py = e.clientY, px = e.clientX;
  const tl = timelineNear(py);
  if (tl) {
    drag = { mode: "create", tl, sx: px, startAbs: xToAbs(px), moved: false, preview: null };
  } else {
    drag = { mode: "pan", sx: px, sy: py, panX: view.panX, panY: view.panY };
    stage.classList.add("panning");
  }
});
stage.addEventListener("pointermove", (e) => {
  if (stagePointers.has(e.pointerId)) stagePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (gesture && stagePointers.size >= 2) {
    const m = pinchMetrics();
    view.zoom = clamp(gesture.startZoom * (m.dist / gesture.startDist), 0.08, 14);
    buildScreenSegs();
    view.panX = m.mx - worldToCanvas(gesture.nUnder);
    view.panY = m.my - gesture.wyUnder * view.zoom;
    scheduleRender();
    return;
  }
  if (!drag) return;
  if (drag.mode === "pan") {
    view.panX = drag.panX + (e.clientX - drag.sx);
    view.panY = drag.panY + (e.clientY - drag.sy);
    scheduleRender();
  } else if (drag.mode === "create") {
    if (drag.moved || Math.abs(e.clientX - drag.sx) > 4) {
      drag.moved = true;
      drag.endAbs = clampSpanEnd(drag.startAbs, xToAbs(e.clientX));
      const sx = absToX(drag.startAbs), ex = absToX(drag.endAbs);
      const x1 = Math.min(sx, ex), x2 = Math.max(sx, ex);
      const bh = clamp(SZ(18), 8, 90);
      if (!drag.preview) { drag.preview = svg("rect", { fill: "var(--accent)", "fill-opacity": 0.25, rx: 2 }); stage.append(drag.preview); }
      drag.preview.setAttribute("x", x1);
      drag.preview.setAttribute("y", drag.tl._y - bh / 2);
      drag.preview.setAttribute("height", bh);
      drag.preview.setAttribute("width", Math.max(1, x2 - x1));
    }
  }
});
function endStagePointer(e) {
  stagePointers.delete(e.pointerId);
  if (gesture) { if (stagePointers.size < 2) gesture = null; return; }
  if (!drag) return;
  stage.classList.remove("panning");
  if (drag.mode === "create") {
    if (drag.preview) drag.preview.remove();
    if (drag.moved) createSpan(drag.tl, drag.startAbs, drag.endAbs);
    else scheduleEvent(drag.tl, drag.startAbs);
  }
  drag = null;
}
// A single click on a line makes a point event (allowed inside spans too). A double-click on a
// span instead opens its editor, so we briefly defer the event and cancel it if a dblclick lands.
let pendingClick = null;
function scheduleEvent(tl, abs) {
  if (pendingClick) clearTimeout(pendingClick.timer);
  pendingClick = { timer: setTimeout(() => { pendingClick = null; createEvent(tl, abs); }, 220) };
}
stage.addEventListener("pointerup", endStagePointer);
stage.addEventListener("pointercancel", endStagePointer);
stage.addEventListener("mousemove", updateHover);
stage.addEventListener("mouseleave", hideGhost);
stage.addEventListener("dblclick", (e) => {
  if (pendingClick) { clearTimeout(pendingClick.timer); pendingClick = null; }
  const tl = timelineNear(e.clientY);
  if (!tl) return;
  const s = spanAt(tl, xToAbs(e.clientX));
  if (s) openSpanEditor(s);
});
// scroll zooms anywhere over the canvas, even with the pointer over a box. Native scroll
// is left alone only when editing that box, when its body actually overflows (scrollable),
// or when a modal is open.
function scrollableUnder(node, dy) {
  for (let el = node; el && el.classList; el = el.parentElement) {
    if (el.classList.contains("box-body") || el.classList.contains("rendered") || el.tagName === "TEXTAREA") {
      const max = el.scrollHeight - el.clientHeight;
      if (max > 1 && ((dy > 0 && el.scrollTop < max - 1) || (dy < 0 && el.scrollTop > 1))) return true;
    }
  }
  return false;
}
const appEl = $("#app");
appEl.addEventListener("wheel", (e) => {
  if (modalRoot.classList.contains("open")) return;
  if (activeEdit && activeEdit.input.contains(e.target)) return;
  if (scrollableUnder(e.target, e.deltaY)) return;
  e.preventDefault();
  const cx = e.clientX, cy = e.clientY;
  if (e.ctrlKey || e.metaKey) {
    // squish/stretch time; elements keep size and gaps keep their fixed width
    const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    const nUnder = nFromScreenX(cx);
    view.timeScale = clamp(view.timeScale * Math.pow(1.0015, -d), 1e-12, 1e9);
    buildScreenSegs();
    view.panX = cx - worldToCanvas(nUnder);
  } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    // horizontal scroll -> pan X
    view.panX -= e.deltaX;
  } else {
    // true zoom: scale elements + both axes around cursor (gaps stay fixed width)
    const nUnder = nFromScreenX(cx), beforeWy = worldYAt(cy);
    view.zoom = clamp(view.zoom * Math.pow(1.0015, -e.deltaY), 0.08, 14);
    buildScreenSegs();
    view.panX = cx - worldToCanvas(nUnder);
    view.panY = cy - beforeWy * view.zoom;
  }
  scheduleRender();
}, { passive: false });
window.addEventListener("resize", () => render());

/* ============================================================ autosave */
const statusEl = $("#status");
let saveTimer = null;
function setStatus(text, cls) { statusEl.textContent = text; statusEl.className = cls || ""; }
function scheduleSave() {
  setStatus("editing\u2026", "saving");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 600);
}
async function save() {
  saveTimer = null;
  setStatus("saving\u2026", "saving");
  try {
    await store.save(serialize());
    setStatus(store.capabilities.name === "browser" ? "saved in browser" : "saved", "saved");
  } catch (err) {
    setStatus("save failed", "error");
  }
}

/* ============================================================ external file watch (live reload)
 * When the backing file changes underneath us (hand-edited, or another window), reparse and
 * re-render keeping the current view. The watcher (set up in load()) already skips while the
 * user is mid-edit; here we just ignore echoes of our own most recent content. */
function applyExternal(text) {
  parse(text);
  structuralDirty = true;
  render();
  history.past.length = 0;
  history.future.length = 0;
  history.last = text;
  updateHistoryButtons();
  setStatus("reloaded from file", "saved");
}

/* ============================================================ undo / redo (serialized snapshots) */
const undoBtn = $("#undo-btn"), redoBtn = $("#redo-btn");
const history = { past: [], future: [], last: null };
function commit() {
  if (history.last !== null) {
    history.past.push(history.last);
    if (history.past.length > 200) history.past.shift();
  }
  history.future.length = 0;
  history.last = serialize();
  updateHistoryButtons();
  scheduleSave();
}
function applyText(text) {
  parse(text);
  structuralDirty = true;
  render();
}
function undo() {
  if (!history.past.length) return;
  history.future.push(history.last);
  history.last = history.past.pop();
  applyText(history.last);
  updateHistoryButtons();
  scheduleSave();
}
function redo() {
  if (!history.future.length) return;
  history.past.push(history.last);
  history.last = history.future.pop();
  applyText(history.last);
  updateHistoryButtons();
  scheduleSave();
}
function updateHistoryButtons() {
  undoBtn.disabled = history.past.length === 0;
  redoBtn.disabled = history.future.length === 0;
}
undoBtn.addEventListener("click", undo);
redoBtn.addEventListener("click", redo);
$("#arrange-btn").addEventListener("click", autoArrange);
$("#fit-btn").addEventListener("click", () => { fitView(); render(); });

/* ============================================================ search / jump-to */
const searchInput = $("#search-input"), searchResults = $("#search-results");
function searchIndex() {
  const out = [];
  for (const t of state.timelines)
    for (const it of [...t.events, ...t.spans])
      out.push({ t, it, hay: ((it.title || "") + " " + (it.content || "") + " " + t.name).toLowerCase() });
  return out;
}
function jumpToItem(t, it) {
  const span = it.kind === "span";
  if (span) it._open = true;
  // rough centering on the start (span midpoint) so the element is built on-screen
  const startN = Number(absStart(t, it) - layout.ref);
  const aimN = span ? startN + Number(absEnd(t, it) - absStart(t, it)) / 2 : startN;
  view.panX = W() / 2 - worldToCanvas(aimN);
  if (t._wy != null) view.panY = H() / 2 - t._wy * view.zoom;
  structuralDirty = true;
  render();
  requestAnimationFrame(() => {
    // if a content box is shown, center precisely on it; otherwise the span midpoint above is correct
    const box = it._box;
    if (box) {
      const sr = stage.getBoundingClientRect();
      const r = box.getBoundingClientRect();
      view.panX += W() / 2 - (r.left + r.width / 2 - sr.left);
      view.panY += H() / 2 - (r.top + r.height / 2 - sr.top);
      render();
    }
    const flash = it._box || it._label;
    if (flash) { flash.classList.add("flash"); setTimeout(() => flash.classList.remove("flash"), 1400); }
  });
}
function renderSearch() {
  const q = searchInput.value.trim().toLowerCase();
  searchResults.textContent = "";
  if (!q) { searchResults.classList.remove("open"); return; }
  const hits = searchIndex().filter((r) => r.hay.includes(q)).slice(0, 12);
  if (!hits.length) { searchResults.classList.remove("open"); return; }
  for (const { t, it } of hits) {
    const row = el("div", { class: "search-hit" },
      el("span", { class: "sh-title" }, it.title || "untitled"),
      el("span", { class: "sh-meta" }, t.name + " \u00b7 " + dateText(it)));
    row.addEventListener("mousedown", (e) => { e.preventDefault(); searchResults.classList.remove("open"); searchInput.blur(); jumpToItem(t, it); });
    searchResults.append(row);
  }
  searchResults.classList.add("open");
}
searchInput.addEventListener("input", renderSearch);
searchInput.addEventListener("focus", renderSearch);
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { const f = searchResults.querySelector(".search-hit"); if (f) f.dispatchEvent(new MouseEvent("mousedown")); }
  else if (e.key === "Escape") { searchInput.value = ""; searchResults.classList.remove("open"); searchInput.blur(); }
});
searchInput.addEventListener("blur", () => setTimeout(() => searchResults.classList.remove("open"), 150));

/* ============================================================ span color legend */
let legendOpen = false;
function applyGroupColor(members, color) {
  for (const m of members) m.s.color = color;
  render();
}
function buildLegend() {
  let panel = $("#legend-panel");
  if (!panel) { panel = el("div", { id: "legend-panel" }); appEl.append(panel); }
  panel.textContent = "";
  panel.classList.toggle("open", legendOpen);
  if (!legendOpen) return;
  const closeBtn = el("button", { class: "icon-btn", title: "close" }, "\u00d7");
  closeBtn.addEventListener("click", () => { legendOpen = false; buildLegend(); });
  panel.append(el("div", { class: "legend-head" }, el("span", {}, "Span colors"), closeBtn));

  const spans = [];
  for (const t of state.timelines) for (const s of t.spans) spans.push({ t, s });
  if (!spans.length) { panel.append(el("div", { class: "legend-empty" }, "No spans yet.")); return; }

  const groups = new Map();
  for (const e of spans) { const c = (e.s.color || "#888888").toLowerCase(); if (!groups.has(c)) groups.set(c, []); groups.get(c).push(e); }
  for (const [color, members] of groups) {
    const grp = el("div", { class: "legend-group" });
    const ci = el("input", { type: "color", value: color, class: "legend-color", title: "recolor this group" });
    ci.addEventListener("input", () => applyGroupColor(members, ci.value));
    ci.addEventListener("change", () => { commit(); buildLegend(); });
    const presets = el("div", { class: "legend-presets" });
    for (const c of PALETTE) {
      const sw = el("button", { class: "pal-swatch", style: "background:" + c, title: c });
      sw.addEventListener("click", () => { applyGroupColor(members, c); commit(); buildLegend(); });
      presets.append(sw);
    }
    grp.append(el("div", { class: "legend-grow" }, ci, presets));
    const list = el("div", { class: "legend-spans" });
    for (const m of members) {
      const row = el("div", { class: "legend-span" },
        el("span", { class: "ls-name" }, m.s.title || "era"),
        el("span", { class: "ls-tl" }, m.t.name));
      row.addEventListener("click", () => { legendOpen = false; buildLegend(); jumpToItem(m.t, m.s); });
      list.append(row);
    }
    grp.append(list);
    panel.append(grp);
  }
}
$("#legend-btn").addEventListener("click", () => { legendOpen = !legendOpen; buildLegend(); });
document.addEventListener("keydown", (e) => {
  const t = e.target;
  const editing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  const meta = e.ctrlKey || e.metaKey;
  if (meta && (e.key === "z" || e.key === "Z")) {
    if (editing) return;
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  } else if (meta && (e.key === "y" || e.key === "Y")) {
    if (editing) return;
    e.preventDefault();
    redo();
  }
});

/* ============================================================ storage actions UI */
function reloadFrom(r) {
  if (!r) return;
  $("#doc-title").textContent = r.label || store.label;
  parse(r.content || "");
  structuralDirty = true;
  render();
  history.past.length = 0; history.future.length = 0; history.last = serialize();
  updateHistoryButtons();
  setStatus("loaded", "saved");
}
function resetDocument() {
  state.timelines = [newTimeline("Timeline")];
  resolveAnchors();
  buildLayout();
  fitView();
  structuralDirty = true;
  render();
  history.past.length = 0; history.future.length = 0; history.last = serialize();
  updateHistoryButtons();
}
async function newDocument() {
  await store.forgetFile();          // detach the backing file so clearing won't overwrite it
  state.needsFile = !store.capabilities.inPlace ? state.needsFile : true;
  resetDocument();
  $("#doc-title").textContent = store.label || "untitled";
  setupStorageUI();
  setStatus(store.capabilities.inPlace ? "new document \u2014 choose a file to save \u2192" : "new document", "saving");
}
function setupStorageUI() {
  const host = $("#storage-actions");
  if (!host) return;
  host.textContent = "";
  const b = store.backend;
  host.append(el("span", { class: "store-badge", title: "active storage backend" }, store.capabilities.name));
  // surface failures (e.g. a cancelled or unavailable native dialog) instead of swallowing them
  const guard = (fn) => async () => {
    try { await fn(); }
    catch (err) { setStatus("error: " + (err && err.message ? err.message : err), "error"); }
  };
  const addBtn = (label, title, fn) => { const x = el("button", { class: "tb-btn wide", title }, label); x.addEventListener("click", guard(fn)); host.append(x); };
  addBtn("New", "Start a new, empty timeline (detaches the current file)", () => {
    const items = state.timelines.reduce((n, t) => n + t.events.length + t.spans.length, 0);
    if (items > 0) confirmModal("Start a new timeline? Your current file is left untouched, but the current view will be cleared.", newDocument, "New");
    else newDocument();
  });
  if (b.openFile) addBtn("Open", "Open a markdown file", async () => reloadFrom(await store.openFile()));
  if (b.pickSave) addBtn("Save as\u2026", "Choose a file to save to", async () => { const r = await store.pickSave(serialize()); if (r) { $("#doc-title").textContent = r.label; setStatus("saved", "saved"); } });
  if (b.importFile) addBtn("Import", "Import a markdown file", async () => reloadFrom(await store.importFile()));
  if (b.exportFile) addBtn("Export", "Save the markdown to a file", async () => store.exportFile(serialize()));
  if (!store.capabilities.inPlace) host.append(el("a", { class: "tb-btn wide", href: store.desktopUrl, target: "_blank", rel: "noopener", title: "Download the offline desktop app" }, "Desktop app"));
}

/* ============================================================ init */
async function load() {
  let content = "";
  try {
    await store.init();
    const r = await store.load();
    content = r.content || "";
    state.needsFile = !!r.needsFile;
    $("#doc-title").textContent = r.label || "epochlore";
  } catch (err) {
    $("#doc-title").textContent = "epochlore";
  }
  store.setBusyCheck(() => !!(activeEdit || drag || saveTimer));
  if (content && content.trim()) parse(content);
  else { state.timelines = [newTimeline("Timeline")]; resolveAnchors(); }
  buildLayout();
  fitView();
  structuralDirty = true;
  render();
  history.last = serialize();
  updateHistoryButtons();
  setupStorageUI();
  store.watch((text) => { if (!activeEdit && !drag && text !== history.last) applyExternal(text); });
  setStatus(state.needsFile ? "choose a file \u2192" : "ready", state.needsFile ? "saving" : "saved");
}
if ("serviceWorker" in navigator && location.protocol !== "file:" && typeof window.NL_PORT === "undefined") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
load();
