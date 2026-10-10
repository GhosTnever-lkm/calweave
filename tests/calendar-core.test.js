import test from "node:test";
import assert from "node:assert/strict";
import { findConflicts, findFreeSlots, parseICS, serializeICS } from "../calendar-core.js";

const wrap = (body) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;

test("parses UTC events and escaped multiline text", () => {
  const { events, warnings } = parseICS(wrap("BEGIN:VEVENT\r\nUID:a\r\nSUMMARY:Review\\, planning\r\nDESCRIPTION:first\\nsecond\r\nDTSTART:20261010T090000Z\r\nDTEND:20261010T100000Z\r\nEND:VEVENT"));
  assert.equal(warnings.length, 0);
  assert.equal(events[0].summary, "Review, planning");
  assert.equal(events[0].description, "first\nsecond");
  assert.equal(events[0].start.toISOString(), "2026-10-10T09:00:00.000Z");
});

test("unfolds continuation lines and preserves unknown properties", () => {
  const { events } = parseICS(wrap("BEGIN:VEVENT\nUID:x\nSUMMARY:Long\n text\nX-EXTRA;LANGUAGE=en:kept\nDTSTART:20261010T090000Z\nDTEND:20261010T100000Z\nEND:VEVENT"));
  assert.equal(events[0].summary, "Longtext");
  const out = serializeICS(events);
  assert.match(out, /X-EXTRA;LANGUAGE=en:kept/);
  assert.equal(parseICS(out).events.length, 1);
});

test("returns visible warnings for TZID and recurrence while preserving both", () => {
  const { events, warnings } = parseICS(wrap("BEGIN:VEVENT\nUID:r\nDTSTART;TZID=Europe\/Paris:20261010T090000\nDTEND;TZID=Europe\/Paris:20261010T100000\nRRULE:FREQ=WEEKLY\nEND:VEVENT"));
  assert.equal(warnings.filter((x) => x.code === "UNSUPPORTED_TZID").length, 2);
  assert.ok(warnings.some((x) => x.code === "UNSUPPORTED_RRULE"));
  assert.match(serializeICS(events), /RRULE:FREQ=WEEKLY/);
  assert.match(serializeICS(events), /DTSTART;TZID=Europe\/Paris:20261010T090000/);
});

test("round-trips Unicode with valid 75-octet folding", () => {
  const title = "Важное совещание ".repeat(15);
  const { events } = parseICS(wrap(`BEGIN:VEVENT\nUID:u\nSUMMARY:${title}\nDTSTART:20261010T090000Z\nDTEND:20261010T100000Z\nEND:VEVENT`));
  const out = serializeICS(events);
  for (const line of out.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, `${line.length} chars`);
  assert.equal(parseICS(out).events[0].summary, title);
});

test("rejects impossible dates with diagnostics", () => {
  const { events, warnings } = parseICS(wrap("BEGIN:VEVENT\nUID:bad\nDTSTART:20260230T090000Z\nDTEND:20260230T100000Z\nEND:VEVENT"));
  assert.equal(events[0].start, null);
  assert.equal(warnings.filter((x) => x.code === "INVALID_DATETIME").length, 2);
});

function event(uid, start, end, allDay = false) { return { uid, summary: uid, start: new Date(start), end: new Date(end), allDay }; }
test("uses half-open intervals and returns overlap boundaries", () => {
  const conflicts = findConflicts([
    event("a", "2026-10-10T09:00Z", "2026-10-10T10:00Z"),
    event("b", "2026-10-10T09:30Z", "2026-10-10T10:30Z"),
    event("c", "2026-10-10T10:00Z", "2026-10-10T11:00Z"),
  ]);
  assert.equal(conflicts.length, 2);
  assert.ok(!conflicts.some((x) => x.a.uid === "a" && x.b.uid === "c"));
  assert.equal(conflicts[0].start.toISOString(), "2026-10-10T09:30:00.000Z");
  assert.equal(conflicts[0].end.toISOString(), "2026-10-10T10:00:00.000Z");
});

test("all-day events can be included as explicit date-range conflicts", () => {
  const a = event("all", "2026-10-10T00:00Z", "2026-10-11T00:00Z", true);
  const b = event("timed", "2026-10-10T09:00Z", "2026-10-10T10:00Z");
  assert.equal(findConflicts([a,b]).length, 0);
  assert.equal(findConflicts([a,b], { includeAllDay: true }).length, 1);
});

test("finds daily free windows and merges overlapping busy intervals", () => {
  const day = new Date(2026, 9, 12, 0, 0, 0); // Monday, local time
  const until = new Date(2026, 9, 13, 0, 0, 0);
  const busy = [
    event("a", new Date(2026, 9, 12, 10), new Date(2026, 9, 12, 11)),
    event("b", new Date(2026, 9, 12, 11), new Date(2026, 9, 12, 12)),
  ];
  const slots = findFreeSlots(busy, day, until, 30, { start:"09:00", end:"17:00", days:[1] });
  assert.deepEqual(slots.map((x) => [x.start.getHours(), x.end.getHours()]), [[9,10],[12,17]]);
});

test("free windows exclude gaps shorter than requested duration and validate hours", () => {
  const day = new Date(2026, 9, 12), until = new Date(2026, 9, 13);
  const busy = [event("a", new Date(2026,9,12,9,15), new Date(2026,9,12,17))];
  assert.deepEqual(findFreeSlots(busy, day, until, 30, { start:"09:00", end:"17:00", days:[1] }), []);
  assert.throws(() => findFreeSlots([], day, until, 10, { start:"17:00", end:"09:00" }), /later than start/);
});

test("serialization is deterministic", () => {
  const { events } = parseICS(wrap("BEGIN:VEVENT\nUID:stable\nSUMMARY:A, B; C\nDTSTART:20261010T090000Z\nDTEND:20261010T100000Z\nEND:VEVENT"));
  assert.equal(serializeICS(events), serializeICS(events));
});
