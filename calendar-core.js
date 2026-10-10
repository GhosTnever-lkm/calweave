// CalWeave: dependency-free iCalendar subset parser and calendar math.
// Floating DTSTART values use the machine's local timezone. TZID and RRULE are
// preserved but not expanded; callers must show the returned warnings.
const CRLF = "\r\n";
const KNOWN = new Set(["UID", "SUMMARY", "DESCRIPTION", "LOCATION", "DTSTART", "DTEND"]);

function unfold(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

function splitProperty(line) {
  let quoted = false, colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ":" && !quoted) { colon = i; break; }
  }
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const chunks = [];
  quoted = false; let part = "";
  for (const ch of left) {
    if (ch === '"') quoted = !quoted;
    if (ch === ";" && !quoted) { chunks.push(part); part = ""; }
    else part += ch;
  }
  chunks.push(part);
  const params = {};
  for (const item of chunks.slice(1)) {
    const i = item.indexOf("=");
    const key = (i < 0 ? item : item.slice(0, i)).toUpperCase();
    let value = i < 0 ? null : item.slice(i + 1);
    if (value?.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    params[key] = value;
  }
  return { name: chunks[0].toUpperCase(), params, left, value: line.slice(colon + 1) };
}

function unescapeText(value) {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\\" && i + 1 < value.length) {
      const next = value[i + 1];
      if (next === "n" || next === "N") { out += "\n"; i++; continue; }
      if (next === "\\" || next === ";" || next === ",") { out += next; i++; continue; }
    }
    out += value[i];
  }
  return out;
}
function escapeText(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\r/g, "").replace(/\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

function validDateParts(y, mo, d, h = 0, mi = 0, s = 0) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return false;
  const dt = new Date(0); dt.setFullYear(y, mo - 1, d); dt.setHours(h, mi, s, 0);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d && dt.getHours() === h && dt.getMinutes() === mi;
}
function parseDate(value, params, warnings, line, propName) {
  const dateMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateMatch) {
    const [, ys, mos, ds] = dateMatch, y = +ys, mo = +mos, d = +ds;
    if (!validDateParts(y, mo, d)) { warnings.push({ code: "INVALID_DATE", line, property: propName, value }); return null; }
    const date = new Date(0); date.setFullYear(y, mo - 1, d); date.setHours(0, 0, 0, 0);
    return { date, allDay: true, utc: false };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(value);
  if (!m) { warnings.push({ code: "INVALID_DATETIME", line, property: propName, value }); return null; }
  const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], s = +(m[6] || 0), utc = !!m[7];
  if (!validDateParts(y, mo, d, h, mi, s)) { warnings.push({ code: "INVALID_DATETIME", line, property: propName, value }); return null; }
  const date = utc ? new Date(Date.UTC(y, mo - 1, d, h, mi, s)) : new Date(y, mo - 1, d, h, mi, s);
  return Number.isNaN(date.getTime()) ? null : { date, allDay: false, utc };
}

function newEvent() { return { uid: null, summary: "", description: null, location: null, dtstart: null, dtend: null, start: null, end: null, allDay: false, extra: [], warnings: [] }; }
function fallbackUid(event) {
  const seed = `${event.summary}|${event.dtstart?.value || ""}|${event.dtend?.value || ""}|${event.location || ""}`;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) { hash ^= seed.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `calweave-${(hash >>> 0).toString(16).padStart(8, "0")}@local`;
}
function finishEvent(event, warnings, line) {
  if (event.dtstart) { event.start = event.dtstart.date; event.allDay = event.dtstart.allDay; }
  else warnings.push({ code: "MISSING_DTSTART", line, uid: event.uid });
  if (event.dtend) {
    event.end = event.dtend.date;
    if (event.dtstart && event.dtend.allDay !== event.dtstart.allDay) warnings.push({ code: "DTEND_TYPE_MISMATCH", line, uid: event.uid });
  } else if (event.start) {
    event.end = event.allDay ? addLocalDays(event.start, 1) : new Date(event.start);
    if (!event.allDay) warnings.push({ code: "MISSING_DTEND", line, uid: event.uid });
  }
  if (!event.uid) event.uid = fallbackUid(event);
  if (event.extra.some((x) => x.name === "RRULE")) warnings.push({ code: "UNSUPPORTED_RRULE", line, uid: event.uid, message: "Recurring instances are not expanded." });
  event.warnings = warnings.filter((w) => w.uid === event.uid || w.line === line);
}
function addLocalDays(date, days) { const next = new Date(date); next.setDate(next.getDate() + days); return next; }

export function parseICS(text) {
  if (typeof text !== "string") throw new TypeError("parseICS expects a string");
  const events = [], warnings = [], lines = unfold(text);
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]; if (!raw) continue;
    const p = splitProperty(raw);
    if (!p) { if (raw.trim()) warnings.push({ code: "MALFORMED_LINE", line: i + 1, raw }); continue; }
    if (p.name === "BEGIN" && p.value.toUpperCase() === "VEVENT") {
      if (current) warnings.push({ code: "NESTED_VEVENT", line: i + 1 });
      current = newEvent(); continue;
    }
    if (p.name === "END" && p.value.toUpperCase() === "VEVENT") {
      if (!current) { warnings.push({ code: "STRAY_END_VEVENT", line: i + 1 }); continue; }
      finishEvent(current, warnings, i + 1); events.push(current); current = null; continue;
    }
    if (!current) continue;
    if (KNOWN.has(p.name)) {
      if (p.name === "DTSTART" || p.name === "DTEND") {
        if (p.params.TZID) warnings.push({ code: "UNSUPPORTED_TZID", line: i + 1, uid: current.uid, tzid: p.params.TZID, property: p.name, message: "TZID is preserved; floating-time interpretation is used for calculations." });
        const parsed = parseDate(p.value, p.params, warnings, i + 1, p.name);
        if (parsed) current[p.name.toLowerCase()] = { ...parsed, left: p.left, value: p.value, params: p.params };
      } else current[p.name.toLowerCase()] = unescapeText(p.value);
    } else current.extra.push({ name: p.name, left: p.left, value: p.value });
  }
  if (current) { warnings.push({ code: "UNCLOSED_VEVENT", line: lines.length }); finishEvent(current, warnings, lines.length); events.push(current); }
  return { events, warnings };
}

function foldLine(line) {
  let out = "", bytes = 0, first = true;
  for (const ch of line) {
    const size = new TextEncoder().encode(ch).length;
    if (bytes + size > 75) { out += CRLF + " "; bytes = 1; first = false; }
    out += ch; bytes += size;
  }
  return out;
}
function formatDate(date, allDay) {
  const d = allDay ? date : date;
  const y = String(allDay ? d.getFullYear() : d.getUTCFullYear()).padStart(4, "0");
  const mo = String((allDay ? d.getMonth() : d.getUTCMonth()) + 1).padStart(2, "0");
  const day = String(allDay ? d.getDate() : d.getUTCDate()).padStart(2, "0");
  if (allDay) return `${y}${mo}${day}`;
  return `${y}${mo}${day}T${String(d.getUTCHours()).padStart(2,"0")}${String(d.getUTCMinutes()).padStart(2,"0")}${String(d.getUTCSeconds()).padStart(2,"0")}Z`;
}
export function serializeICS(events) {
  if (!Array.isArray(events)) throw new TypeError("serializeICS expects an array");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//GhosTnever//CalWeave 0.1//EN", "CALSCALE:GREGORIAN"];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${escapeText(e.uid || fallbackUid(e))}`);
    if (e.dtstart?.left && e.dtstart.value != null) lines.push(`${e.dtstart.left}:${e.dtstart.value}`);
    else if (e.start instanceof Date && !Number.isNaN(e.start.getTime())) lines.push(`DTSTART${e.allDay ? ";VALUE=DATE" : ""}:${formatDate(e.start, e.allDay)}`);
    if (e.dtend?.left && e.dtend.value != null) lines.push(`${e.dtend.left}:${e.dtend.value}`);
    else if (e.end instanceof Date && !Number.isNaN(e.end.getTime())) lines.push(`DTEND${e.allDay ? ";VALUE=DATE" : ""}:${formatDate(e.end, e.allDay)}`);
    if (e.summary != null) lines.push(`SUMMARY:${escapeText(e.summary)}`);
    if (e.description != null) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.location != null) lines.push(`LOCATION:${escapeText(e.location)}`);
    for (const x of e.extra || []) if (x?.left && typeof x.value === "string") lines.push(`${x.left}:${x.value}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join(CRLF) + CRLF;
}

function timeOf(value) { const n = value instanceof Date ? value.getTime() : new Date(value).getTime(); return Number.isFinite(n) ? n : null; }
export function findConflicts(events, { includeAllDay = false } = {}) {
  const items = events.filter((e) => e.start instanceof Date && e.end instanceof Date && timeOf(e.start) != null && timeOf(e.end) > timeOf(e.start) && (includeAllDay || !e.allDay));
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end || String(a.uid).localeCompare(String(b.uid)));
  const out = [];
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) {
    const a = sorted[i], b = sorted[j]; if (b.start >= a.end) break;
    out.push({ a, b, start: new Date(Math.max(+a.start, +b.start)), end: new Date(Math.min(+a.end, +b.end)), allDay: !!a.allDay || !!b.allDay });
  }
  return out;
}
function parseHM(value, name) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value || "");
  if (!m || +m[1] > 23 || +m[2] > 59) throw new RangeError(`${name} must be HH:MM`);
  return [+m[1], +m[2]];
}
export function findFreeSlots(events, rangeStart, rangeEnd, durationMinutes, workingHours = {}) {
  const startMs = timeOf(rangeStart), endMs = timeOf(rangeEnd);
  if (startMs == null || endMs == null || endMs <= startMs) return [];
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) throw new RangeError("durationMinutes must be positive");
  const [sh, sm] = parseHM(workingHours.start || "09:00", "workingHours.start");
  const [eh, em] = parseHM(workingHours.end || "17:00", "workingHours.end");
  if (eh * 60 + em <= sh * 60 + sm) throw new RangeError("workingHours.end must be later than start on the same day");
  const days = workingHours.days || [1, 2, 3, 4, 5];
  if (!Array.isArray(days) || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new RangeError("workingHours.days must contain weekday numbers 0–6");
  const busy = events.filter((e) => !e.allDay && e.start instanceof Date && e.end instanceof Date && e.end > e.start).map((e) => [+e.start, +e.end]).sort((a,b) => a[0]-b[0]);
  const merged = [];
  for (const [s,e] of busy) { const last = merged.at(-1); if (last && s <= last[1]) last[1] = Math.max(last[1], e); else merged.push([s,e]); }
  const out = [], duration = durationMinutes * 60000;
  const day = new Date(startMs); day.setHours(0,0,0,0);
  while (+day < endMs) {
    if (days.includes(day.getDay())) {
      const a = new Date(day); a.setHours(sh, sm, 0, 0);
      const b = new Date(day); b.setHours(eh, em, 0, 0);
      const left = Math.max(+a, startMs), right = Math.min(+b, endMs);
      let cursor = left;
      for (const [bs, be] of merged) {
        if (be <= cursor || bs >= right) continue;
        const clippedStart = Math.max(bs, left), clippedEnd = Math.min(be, right);
        if (clippedStart - cursor >= duration) out.push({ start: new Date(cursor), end: new Date(clippedStart) });
        cursor = Math.max(cursor, clippedEnd);
      }
      if (right - cursor >= duration) out.push({ start: new Date(cursor), end: new Date(right) });
    }
    day.setDate(day.getDate() + 1);
  }
  return out;
}
