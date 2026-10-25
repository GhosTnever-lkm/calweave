# Changelog

## 0.1.3 — 2026-10-25

- Preserve the currently loaded calendar when an imported `.ics` file contains no events.
- Allow retrying the same oversized file after its size warning.

## 0.1.2 — 2026-10-13

- Preserve literal years 0001–0099 when parsing UTC and floating calendar dates.
- Reject unsupported leap-second values rather than silently rolling them into the next minute.

## 0.1.1 - 2026-10-11

- Add a real screenshot of the app to the README.

## 0.1.0 — 2026-10-10

- First public release of CalWeave.
- Local `.ics` import, agenda view, overlap detection, free-window search, and export.
- Dependency-free calendar core with warnings for unsupported recurrence and timezone rules.
- Responsive dark interface and sample calendar.
