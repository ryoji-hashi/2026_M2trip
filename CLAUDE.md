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
  2. Maps each Notion page to a plain event object in `toEvent()` (reading properties named in Japanese: `予定名`, `日付（現地時間）`, `タイムゾーン`, `参加メンバー`, `チーム表示名`, `場所`, `メモ`, `ステータス`).
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
- `チーム表示名` (rich text, optional) lets an event show a custom label (e.g. "Aチーム") instead of listing names — purely cosmetic, no code-side mapping required.
- `template.html`'s `badgeInfo()` derives the badge from `members`/`teamLabel` at render time: full roster → "🌐 全員"; `teamLabel` set → that label; `members.length >= COUNT_BADGE_THRESHOLD` (5) → count display; otherwise → names joined with "・".

### Client-side rendering (in both template.html and generated index.html)

All rendering logic lives inline in a `<script>` tag at the bottom of the HTML — there is no separate JS file:
- `EVENTS` holds the event list (each event has `dt` as a local ISO string + `srcTZ` as a UTC offset number, plus `members`, `teamLabel`, `status`, `loc`, optional `isSplit`/`isRejoin` flags).
- `ALL_MEMBERS` holds the full participant roster, used for the "全員" badge check, the member-filter buttons, and the header member count.
- `toConv()` converts an event's local time from its source UTC offset to the currently selected display timezone. `TZS` is the route's leg-by-leg zone list (大阪/JST, 上海/CST, ヨーロッパ/CEST, ベトナム/ICT) — each entry carries a `place` name shown in parens next to the abbreviation in the TZ buttons, the date-section header, and the per-event "元〜" source label (`zoneForOffset()` looks up the place for an event's raw `srcTZ`). Update `TZS` if the trip route changes.
- `render()` filters by the selected member (`selMember`, single-select — `null` means no filter) and the selected `view` (`"list"` | `"calendar"`), groups events by converted date, rebuilds `#stats`, and delegates to `renderListHtml()` or `renderCalendarHtml()` to fill `#timeline`/`#calendar` (only the active view's container is populated/shown).
- The `#grp-row` filter buttons are generated dynamically from `ALL_MEMBERS` (plus a "すべて" button) — there is no fixed group-code list to maintain. `#view-row` (list/calendar toggle) is generated the same way from a small `VIEWS` array.

## Customization conventions

- Trip name: edit `TRIP_NAME` constant in `template.html`.
- Adding/removing a participant from the trip: edit `ALL_MEMBERS` in `generate.js` (single source — flows into both the roster injected into `template.html` and member-filter UI).
- Who attends a given event: set the `参加メンバー` multi-select on that event's Notion row — no code change needed.
- Sync frequency: change the `cron` expression in `.github/workflows/sync.yml`.
- The Notion database ID is hardcoded in `generate.js` (`DATABASE_ID`) and documented in `README.md`.
