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
  2. Maps each Notion page to a plain event object in `toEvent()` (reading properties named in Japanese: `予定名`, `日付（現地時間）`, `タイムゾーン`, `参加メンバー`, `グループ`, `カテゴリ`, `場所`, `メモ`, `ステータス`).
  3. Reads `template.html`, replaces the literal placeholder comments `/* __EVENTS_JSON__ */`, `/* __MEMBERS_JSON__ */`, and `/* __UPDATED_AT__ */` with the real JSON data, and writes the result to `index.html`.
- **`index.html`** — the generated output that GitHub Pages serves. **Never edit this file directly** — it is overwritten by `generate.js` every run and auto-committed by CI. Treat it like a build artifact. (Historically these two files got swapped — design work was done directly in `index.html` instead of `template.html`. This was reconciled; always make design/behavior changes in `template.html` going forward.)
- **`.github/workflows/sync.yml`** — runs `generate.js` hourly (`cron: "0 * * * *"`), on manual dispatch, and whenever `template.html`/`generate.js` change on push. It commits `index.html` back to `main` if it changed, using a bot identity. Requires the `NOTION_TOKEN` repository secret.

### Data flow

```
Notion DB  →  generate.js (Notion API + mapping)  →  template.html (placeholders filled)  →  index.html  →  GitHub Pages
```

### Membership model

Participation is per-event and per-person, not per-fixed-team — the trip is one main group of 10 with individuals splitting off and rejoining at different points (not two static "Team A / Team B" tracks).

- The roster of all participants lives in exactly one place: `ALL_MEMBERS` in `generate.js`, which is injected into `template.html` via `__MEMBERS_JSON__`. Only edit this when someone actually joins/leaves the trip.
- **Notion entry is group-first.** `グループ` (multi-select) is what gets filled in day-to-day: pick a named subset option (e.g. `全員(10)`, `大多数(6)`, `山登り(3)`) and optionally add individual member-name options alongside it (e.g. `だいちゃん`, `そうし`, `りょうじ`) to flag "this named group plus one more person" — `template.html` renders that combination as `大多数＋りょうじ`. The trailing `(N)` count in a group option's own name is just a human-readable hint in Notion; it is never trusted for the actual headcount.
- `generate.js`'s `GROUP_MEMBERS` is the canonical name→roster map for known groups (currently `全員` = `ALL_MEMBERS`, `大多数` = おはる/なーちゃん/ほっぴー/たかし/せいや/もとや, `山登り` = そうし/だいちゃん/りょうじ, `ドイツ組` = そうし/だいちゃん). `expandGroupTags()` (in `toEvent()`) normalizes each `グループ` tag (strips the `(N)` suffix via `normalizeGroupTag()`), expands known group names to their full roster and individual-name tags to themselves, and unions the result — this becomes the event's `members`. **If `グループ` contains at least one resolvable tag, the row's `参加メンバー` value is ignored entirely** (no need to keep it in sync). Only when `グループ` is empty or entirely unresolvable (a tag not yet in `GROUP_MEMBERS`) does it fall back to reading `参加メンバー` directly, so that property still works for ad hoc/one-off rows. Add a new named group to `GROUP_MEMBERS` whenever a new recurring group tag shows up in Notion.
- `template.html`'s `badgeInfo()` derives the badge at render time: if `groupTags` (the per-event `グループ` values, count-suffix stripped) is non-empty, join them with "＋"; full roster → "g-all" styling, otherwise "g-team". If `groupTags` is empty (older/untagged rows), it falls back to: full roster → "🌐 全員"; `members.length >= COUNT_BADGE_THRESHOLD` (5) → count display; otherwise → names joined with "・". The actual member count (always `members.length`, i.e. real headcount, never the Notion `(N)` hint) is rendered separately next to the badge.
- `GROUP_TAGS` (top-level const in `template.html`) is derived once from every event's `groupTags`, stripped and de-duplicated, excluding anything that matches a name in `ALL_MEMBERS` (those are "add this person" tags, not group names) — this feeds the group-filter row, ordered by `GROUP_ORDER` (currently `全員, 大多数, 山登り, ドイツ組`; any group not listed there sorts after, alphabetically). Add/rename/remove `グループ` options in Notion and the filter row picks it up on next sync — but a brand-new group name won't get a deliberate position until it's also added to `GROUP_ORDER` (membership expansion for *new* group names still needs a `GROUP_MEMBERS` entry in `generate.js` to be more than just a display label).

### Client-side rendering (in both template.html and generated index.html)

All rendering logic lives inline in a `<script>` tag at the bottom of the HTML — there is no separate JS file:
- `EVENTS` holds the event list (each event has `dt` as a local ISO string + `srcTZ` as a UTC offset number, optional `dtEnd` (also a local ISO string, set only if the Notion date property has an end date), plus `members`, `groupTags`, `category` (raw Notion `カテゴリ` value, emoji baked into the option name e.g. `✈️ 移動` — shown as-is, no separate emoji mapping), `status`, `loc`, optional `isSplit`/`isRejoin` flags).
- The list view's badge row order is fixed: category → group/member badge (`badgeInfo()`) → headcount → status. The category badge (`.g-cat`) only renders when `ev.category` is non-empty (older/uncategorized rows just skip it).
- `ALL_MEMBERS` holds the full participant roster, used for the "全員" badge check, the member-filter buttons, and the header member count.
- `toConv()` converts an event's local time from its source UTC offset to the currently selected display timezone (only `dateStr`/`timeStr`/`ms` — no day-of-month fields, since the page doesn't show "翌日/前日" shift indicators). `TZS` is the route's leg-by-leg zone list (JST/CST/CEST/ICT, i.e. 大阪・上海・ヨーロッパ・ベトナム) — buttons intentionally show only the flag + abbreviation (no place name, no UTC offset) to keep the sticky header ribbon compact; the flag is considered enough of a location cue. Update `TZS` if the trip route changes. The page intentionally never shows an individual event's raw `srcTZ` (its Notion-registered timezone) — only the converted time in the globally-selected display zone. The default selected zone is JST (`TZS[0]`); changing day-to-day Notion data-entry defaults (e.g. which `タイムゾーン`/`ステータス` option pre-fills on a new row) is a Notion property setting, not something this code controls.
- `#stats` shows two boxes — 全員予定 / サブグループ予定 counts (no day-count box).
- `#fab` is a fixed bottom-right floating button for the Notion edit link, kept out of the sticky header so the header's width/wrapping never shifts when this button's content changes. Two-tap pattern: first tap expands "＋" into "✏️ Notionで編集" (`setFabExpanded()`), second tap opens the Notion URL in a new tab; tapping outside the button while expanded collapses it back.
- `render()` filters by `filterMode` (`null` | `"member"` | `"group"` | `"category"`) plus whichever of `selMembers`/`selGroups`/`selCategories` (all `Set`s, multi-select) is active for that mode, and the selected `view` (`"list"` | `"calendar"`); groups events by converted date, rebuilds `#stats`, and delegates to `renderListHtml()` or `renderCalendarHtml()` to fill `#timeline`/`#calendar` (only the active view's container is populated/shown). Full-roster events (`members.length === ALL_MEMBERS.length`) always pass `member`/`group` filters regardless of selection, so those two narrow the sub-group events shown but never hide whole-group plans — `category` filtering is a different axis (event *type*, not attendance) and does **not** get that override, so e.g. filtering to `🍽️ 食事` hides non-food full-roster events too.
- The `#grp-row` (member) filter buttons are generated from `ALL_MEMBERS` (plus a "すべて" reset button); `#group-row` (group) buttons from `GROUP_TAGS`; `#category-row` (category) buttons from `CATEGORY_TAGS` (ordered by `CATEGORY_ORDER`, same pattern as `GROUP_ORDER`) — the group/category rows are hidden entirely if no event has that field set yet. All three rows share the `.filter-btn` class with `data-ftype`/`data-fvalue` attributes — `syncFilterButtons()` recomputes each button's `.on` state from `filterMode`/`selMembers`/`selGroups`/`selCategories` after every click. `toggleMember()`/`toggleGroup()`/`toggleCategory()` implement the interaction (sharing `clearOtherSelections()`): tapping within the active mode toggles that item in/out of its Set (multi-select); tapping a name in a *different* mode switches `filterMode` and starts a fresh single-item selection in the new mode (member/group/category are mutually exclusive with each other, but each is multi-select within itself). Selecting down to zero items in a mode falls back to `filterMode = null` (same as "すべて"). `#view-row` (list/calendar toggle) is generated the same way from a small `VIEWS` array (separate `.view-btn` class, unrelated to the filter state).

## Customization conventions

- Trip name: edit the `<title>`/`og:title` and `.hero-title` text directly in `template.html` (no JS constant — it's static markup).
- Adding/removing a participant from the trip: edit `ALL_MEMBERS` in `generate.js` (single source — flows into both the roster injected into `template.html` and member-filter UI).
- Who attends a given event: set the `グループ` multi-select on that event's Notion row (pick a known group, optionally plus individual-name tags) — no code change needed. Only fall back to filling in `参加メンバー` directly for one-off attendance that doesn't match any defined group. Adding a brand-new named group (with its own roster) does need a `GROUP_MEMBERS` entry in `generate.js`.
- Sync frequency: change the `cron` expression in `.github/workflows/sync.yml`.
- The Notion database ID is hardcoded in `generate.js` (`DATABASE_ID`) and documented in `README.md`.
