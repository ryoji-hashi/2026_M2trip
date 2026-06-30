# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page static itinerary site for a group trip, generated from a Notion database. There is no build tool, package manager, or framework — just one Node script and two HTML files.

## Commands

```bash
NOTION_TOKEN=secret_xxx node generate.js   # fetch from Notion, regenerate index.html
```

There is no test suite, linter, or package.json. To preview locally, just open `index.html` (or `template.html`) directly in a browser.

## Architecture

- **`template.html`** — the source of truth for the page (HTML/CSS/JS, no dependencies, no build step). It contains placeholder comments (not literal sample data) for events/members/timestamp, filled in by `generate.js`. Edit this file for any design, layout, or behavior change.
- **`generate.js`** — a standalone Node script (no npm deps, uses only `https`/`fs`/`path`) that:
  1. Queries the Notion database (`DATABASE_ID` constant) via the REST API, paginating through `fetchAllPages()`.
  2. Maps each Notion page to a plain event object in `toEvent()` (reading properties named in Japanese: `予定名`, `日付（現地時間）`, `タイムゾーン`, `参加メンバー`, `グループ`, `場所`, `メモ`, `ステータス`).
  3. Reads `template.html`, replaces the literal placeholder comments `/* __EVENTS_JSON__ */`, `/* __MEMBERS_JSON__ */`, and `/* __UPDATED_AT__ */` with the real JSON data, and writes the result to `index.html`.
- **`index.html`** — the generated output that GitHub Pages serves. **Never edit this file directly** — it is overwritten by `generate.js` every run and auto-committed by CI. Treat it like a build artifact. (Historically these two files got swapped — design work was done directly in `index.html` instead of `template.html`. This was reconciled; always make design/behavior changes in `template.html` going forward.)
- **`.github/workflows/sync.yml`** — runs `generate.js` hourly (`cron: "0 * * * *"`), on manual dispatch, and whenever `template.html`/`generate.js` change on push. It commits `index.html` back to `main` if it changed, using a bot identity. Requires the `NOTION_TOKEN` repository secret.

### Data flow

```
Notion DB  →  generate.js (Notion API + mapping)  →  template.html (placeholders filled)  →  index.html  →  GitHub Pages
```

### Membership model

Participation is per-event and per-person, not per-fixed-team. Each Notion row's `参加メンバー` (multi-select) lists exactly which people attend that event, since the trip is one main group of 10 with individuals splitting off and rejoining at different points (not two static "Team A / Team B" tracks). There is no enum of group names to keep in sync between Notion and code:

- The roster of all participants lives in exactly one place: `ALL_MEMBERS` in `generate.js`, which is injected into `template.html` via `__MEMBERS_JSON__`. Only edit this when someone actually joins/leaves the trip — not when an event's attendee subset changes (that's just the per-row multi-select in Notion).
- `参加メンバー` (multi-select of individual names) is the authoritative attendee list for an event — used for the "全員"/count checks and for member-filtering. `グループ` (multi-select, optional) is a purely cosmetic display tag layered on top: pick a named subset option (e.g. `全員(10)`, `大多数(6)`, `山登り(3)`) and optionally add individual member-name options alongside it (e.g. `だいちゃん`, `そうし`, `りょうじ`) to flag "this named group plus one more person" — `template.html` renders that combination as `大多数＋りょうじ`. The trailing `(N)` count in a group option's own name is just a human-readable hint in Notion; the web page always shows the real headcount from `参加メンバー`, not that number.
- `template.html`'s `badgeInfo()` derives the badge at render time: if `groupTags` (the per-event `グループ` values, count-suffix stripped) is non-empty, join them with "＋"; full roster → "g-all" styling, otherwise "g-team". If `groupTags` is empty (older/untagged rows), it falls back to: full roster → "🌐 全員"; `members.length >= COUNT_BADGE_THRESHOLD` (5) → count display; otherwise → names joined with "・". The actual member count is always rendered separately next to the badge.
- `GROUP_TAGS` (top-level const in `template.html`) is derived once from every event's `groupTags`, stripped and de-duplicated, excluding anything that matches a name in `ALL_MEMBERS` (those are "add this person" tags, not group names) — this feeds the group-filter row. No fixed list of group names is hardcoded; add/rename/remove `グループ` options in Notion and the filter row picks it up on next sync.

### Client-side rendering (in both template.html and generated index.html)

All rendering logic lives inline in a `<script>` tag at the bottom of the HTML — there is no separate JS file:
- `EVENTS` holds the event list (each event has `dt` as a local ISO string + `srcTZ` as a UTC offset number, optional `dtEnd` (also a local ISO string, set only if the Notion date property has an end date), plus `members`, `groupTags`, `status`, `loc`, optional `isSplit`/`isRejoin` flags).
- `ALL_MEMBERS` holds the full participant roster, used for the "全員" badge check, the member-filter buttons, and the header member count.
- `toConv()` converts an event's local time from its source UTC offset to the currently selected display timezone. `TZS` is the route's leg-by-leg zone list (大阪/JST, 上海/CST, EU/CEST, ベトナム/ICT) — each entry carries a `place` name shown in parens next to the abbreviation in the TZ buttons and the date-section header. Update `TZS` if the trip route changes. The page intentionally never shows an individual event's raw `srcTZ` (its Notion-registered timezone) — only the converted time in the globally-selected display zone.
- `render()` filters by `selFilter` (`null` | `{type:"member"|"group", value}`, single-select across both filter rows) and the selected `view` (`"list"` | `"calendar"`), groups events by converted date, rebuilds `#stats`, and delegates to `renderListHtml()` or `renderCalendarHtml()` to fill `#timeline`/`#calendar` (only the active view's container is populated/shown). Full-roster events (`members.length === ALL_MEMBERS.length`) always pass the filter regardless of `selFilter`, so a member/group filter narrows the sub-group events shown but never hides whole-group plans.
- The `#grp-row` (member) filter buttons are generated from `ALL_MEMBERS` (plus a "すべて" reset button); `#group-row` (group) filter buttons are generated from `GROUP_TAGS` and the row is hidden entirely if no event has any `グループ` tag yet. Both rows share the `.filter-btn` class with `data-ftype`/`data-fvalue` attributes — `syncFilterButtons()` recomputes the `.on` state for all of them from `selFilter` after every click, so only one button across both rows is ever active. `#view-row` (list/calendar toggle) is generated the same way from a small `VIEWS` array (separate `.view-btn` class, not part of `selFilter`).

## Customization conventions

- Trip name: edit the `<title>`/`og:title` and `.hero-title` text directly in `template.html` (no JS constant — it's static markup).
- Adding/removing a participant from the trip: edit `ALL_MEMBERS` in `generate.js` (single source — flows into both the roster injected into `template.html` and member-filter UI).
- Who attends a given event: set the `参加メンバー` multi-select on that event's Notion row — no code change needed.
- Sync frequency: change the `cron` expression in `.github/workflows/sync.yml`.
- The Notion database ID is hardcoded in `generate.js` (`DATABASE_ID`) and documented in `README.md`.
