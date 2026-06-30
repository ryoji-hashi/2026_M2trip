#!/usr/bin/env node
// Notionからデータを取得して index.html を生成するスクリプト
// 使用: NOTION_TOKEN=xxx node generate.js

const https = require("https");
const fs    = require("fs");
const path  = require("path");

const TOKEN       = process.env.NOTION_TOKEN;
const DATABASE_ID = "d12b01ae-a4db-44c0-a903-c8a1c01e511e"; // 旅程データベース

// 旅行全体のメンバー名簿。ここを1箇所変更するだけで「全員」判定・人数表示・
// メンバーフィルターの選択肢すべてに反映される（仮名、後で実名に置き換え予定）。
const ALL_MEMBERS = [
  "おはる", "ごんちゃん", "だいちゃん", "せいや", "なーちゃん",
  "ほっぴー", "もとや", "たかし", "そうし", "りょうじ",
];

if (!TOKEN) {
  console.error("❌  NOTION_TOKEN が設定されていません");
  console.error("    export NOTION_TOKEN=secret_xxx && node generate.js");
  process.exit(1);
}

/* ──────────── Notion API ──────────── */

function notionFetch(endpoint, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body ?? {});
    const req = https.request(
      {
        hostname: "api.notion.com",
        path:     endpoint,
        method:   "POST",
        headers: {
          Authorization:    `Bearer ${TOKEN}`,
          "Notion-Version": "2022-06-28",
          "Content-Type":   "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      res => {
        const chunks = [];
        res.on("data", c => chunks.push(c));
        res.on("end", () => {
          // Buffer単位で連結してから一括デコードする。
          // チャンクごとに toString() すると、マルチバイト文字（「ヴェ」等）が
          // チャンク境界をまたいだ時に文字化けする（実際に発生していた不具合）。
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            const json = JSON.parse(raw);
            if (json.object === "error") reject(new Error(`Notion: ${json.message}`));
            else resolve(json);
          } catch (e) {
            reject(new Error(`JSON parse failed: ${raw.slice(0, 200)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function fetchAllPages() {
  const pages  = [];
  let cursor   = undefined;

  while (true) {
    const body = {
      sorts:     [{ property: "日付（現地時間）", direction: "ascending" }],
      page_size: 100,
    };
    if (cursor) body.start_cursor = cursor;

    const res = await notionFetch(`/v1/databases/${DATABASE_ID}/query`, body);
    pages.push(...res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }

  return pages;
}

/* ──────────── データ変換 ──────────── */

const getTitle      = p => p?.title?.[0]?.plain_text       ?? "";
const getText       = p => p?.rich_text?.[0]?.plain_text   ?? "";
const getSelect     = p => p?.select?.name                 ?? "";
const getMultiSelect = p => (p?.multi_select ?? []).map(o => o.name);
const getDate       = p => (p?.date?.start ?? "").slice(0, 16); // "YYYY-MM-DDTHH:MM"

function parseOffset(tzStr) {
  const m = (tzStr ?? "").match(/UTC([+-])(\d+)/);
  return m ? (m[1] === "+" ? +m[2] : -m[2]) : 9; // デフォルトJST
}

function statusCode(s) {
  return (s.includes("確定") || s.includes("完了")) ? "ok" : "plan";
}

function toEvent(page) {
  const p    = page.properties;
  const name = getTitle(p["予定名"]);
  const dt   = getDate(p["日付（現地時間）"]);
  if (!name || !dt) return null;

  return {
    name,
    dt,
    srcTZ:     parseOffset(getSelect(p["タイムゾーン"])),
    members:   getMultiSelect(p["参加メンバー"]),
    teamLabel: getText(p["チーム表示名"]),
    loc:       getText(p["場所"]),
    notes:     getText(p["メモ"]),
    status:    statusCode(getSelect(p["ステータス"])),
    isSplit:   name.includes("分岐"),
    isRejoin:  name.includes("再合流"),
  };
}

/* ──────────── HTML生成 ──────────── */

async function main() {
  console.log(`🔄  Notionからデータを取得中 (DB: ${DATABASE_ID})`);

  const pages  = await fetchAllPages();
  const events = pages.map(toEvent).filter(Boolean);
  console.log(`✅  ${events.length} 件のイベントを取得`);

  const tmplPath = path.resolve(__dirname, "template.html");
  const outPath  = path.resolve(__dirname, "index.html");

  if (!fs.existsSync(tmplPath)) {
    throw new Error("template.html が見つかりません");
  }

  const updatedAt = new Date().toISOString();

  // テンプレートの "/* __MARKER__ */<デフォルト値>" を丸ごとJSON値に置き換える。
  // コメントだけでなく後ろのデフォルトリテラル（[] や null）まで含めて置換しないと
  // 構文として壊れた式が残ってしまうため、次のセミコロンまでをまとめて消す。
  function injectPlaceholder(html, marker, value) {
    return html.replace(new RegExp(`/\\* ${marker} \\*/[^;]*`), JSON.stringify(value, null, 2));
  }

  let html = fs.readFileSync(tmplPath, "utf8");
  html = injectPlaceholder(html, "__EVENTS_JSON__",  events);
  html = injectPlaceholder(html, "__MEMBERS_JSON__", ALL_MEMBERS);
  html = injectPlaceholder(html, "__UPDATED_AT__",   updatedAt);

  fs.writeFileSync(outPath, html, "utf8");
  console.log(`📄  index.html を生成しました (${(html.length / 1024).toFixed(1)} kB)`);
  console.log(`🕐  更新時刻: ${updatedAt}`);
}

main().catch(err => {
  console.error("❌ ", err.message);
  process.exit(1);
});
