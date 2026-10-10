import { findConflicts, findFreeSlots, parseICS, serializeICS } from "./calendar-core.js";

const $ = (id) => document.getElementById(id);
let events = [];
let warnings = [];
let offset = 0;
let descending = false;
let activeDay = new Date(); activeDay.setHours(0, 0, 0, 0);

const demo = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:planning@calweave.local\r\nSUMMARY:Планирование недели\r\nDESCRIPTION:Задачи и фокус на ближайшие дни\r\nDTSTART:${icsDateTime(dayOffset(0, 9, 0))}\r\nDTEND:${icsDateTime(dayOffset(0, 10, 0))}\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:design@calweave.local\r\nSUMMARY:Дизайн-ревью\r\nLOCATION:Комната 2 · онлайн\r\nDTSTART:${icsDateTime(dayOffset(0, 9, 30))}\r\nDTEND:${icsDateTime(dayOffset(0, 10, 30))}\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:focus@calweave.local\r\nSUMMARY:Тихий фокус\r\nDTSTART:${icsDateTime(dayOffset(0, 13, 0))}\r\nDTEND:${icsDateTime(dayOffset(0, 14, 30))}\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:tomorrow@calweave.local\r\nSUMMARY:Проверить задачи\r\nDTSTART:${icsDateTime(dayOffset(1, 11, 0))}\r\nDTEND:${icsDateTime(dayOffset(1, 11, 45))}\r\nEND:VEVENT\r\nEND:VCALENDAR`;

function dayOffset(days, h, m) { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return d; }
function icsDateTime(date) { return `${date.getFullYear()}${String(date.getMonth()+1).padStart(2,"0")}${String(date.getDate()).padStart(2,"0")}T${String(date.getHours()).padStart(2,"0")}${String(date.getMinutes()).padStart(2,"0")}00`; }
function setNotice(message, kind = "ok") { const n = $("notice"); n.textContent = message; n.className = `notice ${kind}`; n.hidden = false; window.setTimeout(() => { n.hidden = true; }, 6000); }
function fmtDate(date, options = {}) { return new Intl.DateTimeFormat("ru-RU", { day:"numeric", month:"long", ...options }).format(date); }
function fmtTime(date) { return new Intl.DateTimeFormat("ru-RU", { hour:"2-digit", minute:"2-digit" }).format(date); }
function sameDate(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function conflictsFor(event) { return findConflicts(events).filter((c) => c.a === event || c.b === event); }

function render() {
  const sorted = [...events].filter((e) => e.start instanceof Date && e.end instanceof Date && sameDate(e.start, activeDay)).sort((a,b) => a.start-b.start);
  if (descending) sorted.reverse();
  const conflicts = findConflicts(events);
  $("event-count").textContent = String(events.length);
  $("conflict-count").textContent = String(conflicts.length);
  $("date-title").textContent = events.length ? fmtDate(activeDay, { weekday:"long", year:"numeric" }) : "Загрузите календарь";
  $("date-subtitle").textContent = events.length ? `${sorted.length} событий · локальное время` : "Поддерживаются события из .ics";
  $("export-btn").disabled = !events.length;
  const agenda = $("agenda");
  if (!events.length) {
    agenda.innerHTML = '<div class="empty-state"><div class="empty-art">◷</div><h3>Начните с календаря</h3><p>Добавьте файл .ics или откройте демо, чтобы посмотреть, как CalWeave находит накладки и свободное время.</p><button class="button primary compact" id="empty-demo" type="button">Загрузить пример</button></div>';
    $("empty-demo").addEventListener("click", loadDemo);
    return;
  }
  if (!sorted.length) { agenda.innerHTML = '<div class="empty-day"><span>✧</span><b>На этот день событий нет</b><small>Можно назначить что-то новое — проверьте свободные окна справа.</small></div>'; return; }
  const currentConflicts = conflicts;
  agenda.innerHTML = sorted.map((e) => {
    const hit = currentConflicts.filter((c) => c.a === e || c.b === e);
    const allDay = !!e.allDay;
    const time = allDay ? "Весь день" : `${fmtTime(e.start)} — ${fmtTime(e.end)}`;
    return `<article class="event-row ${hit.length ? "has-conflict" : ""}"><div class="event-time">${time}</div><div class="event-line"></div><div class="event-card"><div class="event-card-top"><h3>${escapeHtml(e.summary || "Без названия")}</h3>${hit.length ? '<span class="pill conflict">Пересечение</span>' : '<span class="pill clear">Свободно</span>'}</div><div class="event-meta">${e.location ? `<span>⌖ ${escapeHtml(e.location)}</span>` : ""}${e.description ? `<span>· ${escapeHtml(e.description)}</span>` : ""}</div>${hit.length ? `<div class="conflict-detail">Совпадает по времени с ${hit.map((x) => escapeHtml((x.a === e ? x.b : x.a).summary || "другим событием")).join(", ")}</div>` : ""}</div></article>`;
  }).join("");
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function renderWarnings() {
  const box = $("warning-box");
  if (!warnings.length) { box.hidden = true; box.innerHTML = ""; return; }
  const counts = warnings.reduce((m, w) => (m[w.code] = (m[w.code] || 0) + 1, m), {});
  const labels = { UNSUPPORTED_TZID:"часовые пояса TZID не пересчитываются — используется локальное время", UNSUPPORTED_RRULE:"повторяющиеся события сохранены, но не развёрнуты в отдельные встречи", INVALID_DATETIME:"найдены даты, которые не удалось прочитать", INVALID_DATE:"найдены некорректные даты", MALFORMED_LINE:"есть строки неизвестного формата", MISSING_DTEND:"у некоторых встреч не задан конец" };
  box.innerHTML = `<b>Есть особенности импорта</b><ul>${Object.entries(counts).map(([code, n]) => `<li>${escapeHtml(labels[code] || code)}${n > 1 ? ` (${n})` : ""}</li>`).join("")}</ul>`;
  box.hidden = false;
}
function acceptICS(text, fileName = "календарь") {
  try {
    const result = parseICS(text); events = result.events; warnings = result.warnings;
    if (!events.length) { setNotice("В файле не найдены события VEVENT.", "error"); return; }
    const first = events.find((e) => e.start)?.start; if (first) { activeDay = new Date(first); activeDay.setHours(0,0,0,0); $("slot-date").value = toDateInput(activeDay); }
    render(); renderWarnings(); updateSlots();
    setNotice(`Импортировано событий: ${events.length} · ${fileName}`);
  } catch (error) { setNotice(`Не удалось разобрать календарь: ${error.message}`, "error"); }
}
function loadDemo() { acceptICS(demo, "демо-календарь"); }
function toDateInput(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
function updateSlots() {
  const dateValue = $("slot-date").value;
  if (!dateValue) return;
  const [y,m,d] = dateValue.split("-").map(Number);
  const from = new Date(y,m-1,d,0,0,0,0), to = new Date(y,m-1,d+1,0,0,0,0);
  try {
    const slots = findFreeSlots(events, from, to, Number($("duration").value), { start:$("work-start").value, end:$("work-end").value, days:[0,1,2,3,4,5,6] });
    $("slot-count").textContent = String(slots.length);
    $("slots").innerHTML = slots.length ? slots.map((s) => `<div class="slot-item"><span>◷</span><b>${fmtTime(s.start)} — ${fmtTime(s.end)}</b><small>${Math.round((s.end-s.start)/60000)} мин свободно</small></div>`).join("") : '<p class="muted">Подходящих интервалов в рабочее время нет.</p>';
  } catch (error) { $("slots").innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`; $("slot-count").textContent = "—"; }
}

$("ics-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0]; if (!file) return;
  if (file.size > 15 * 1024 * 1024) { setNotice("Файл больше 15 МБ. Выберите календарь меньшего размера.", "error"); return; }
  acceptICS(await file.text(), file.name); event.target.value = "";
});
$("demo-btn").addEventListener("click", loadDemo);
$("empty-demo")?.addEventListener("click", loadDemo);
$("export-btn").addEventListener("click", () => {
  const blob = new Blob([serializeICS(events)], { type:"text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "calweave-export.ics"; a.click(); URL.revokeObjectURL(url);
});
$("find-slots").addEventListener("click", updateSlots);
for (const id of ["duration", "slot-date", "work-start", "work-end"]) $(id).addEventListener("change", updateSlots);
$("sort-btn").addEventListener("click", (event) => { descending = !descending; event.currentTarget.textContent = descending ? "По времени ↓" : "По времени ↑"; render(); });
$("prev-day").addEventListener("click", () => { activeDay.setDate(activeDay.getDate()-1); render(); });
$("next-day").addEventListener("click", () => { activeDay.setDate(activeDay.getDate()+1); render(); });
$("today-btn").addEventListener("click", () => { activeDay = new Date(); activeDay.setHours(0,0,0,0); $("slot-date").value = toDateInput(activeDay); render(); updateSlots(); });
$("free-nav").addEventListener("click", () => $("slot-date").focus());
activeDay = new Date(); activeDay.setHours(0,0,0,0); $("slot-date").value = toDateInput(activeDay);
render(); updateSlots();
