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

// Notionの「グループ」プロパティだけで参加メンバー・人数が自動的に決まるようにするための名簿。
// ここに無いグループ名が付いた行は、今まで通り
// Notion側の「参加メンバー」を手入力する運用にフォールバックする。
const GROUP_MEMBERS = {
  "全員":     ALL_MEMBERS,
  "大多数":   ["おはる", "なーちゃん", "ほっぴー", "たかし", "せいや", "もとや"],
  "山登り":   ["そうし", "だいちゃん", "りょうじ"],
  "ドイツ組": ["そうし", "だいちゃん"],
};

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

/* ──────────── Notion API (GET) ──────────── */

function notionGet(endpoint) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.notion.com",
        path:     endpoint,
        method:   "GET",
        headers: {
          Authorization:    `Bearer ${TOKEN}`,
          "Notion-Version": "2022-06-28",
        },
      },
      res => {
        const chunks = [];
        res.on("data", c => chunks.push(c));
        res.on("end", () => {
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
    req.end();
  });
}

// rich_text 配列を HTML 文字列に変換する。インラインリンク（href）は <a> タグに変換する。
function rtToHtml(rtArr) {
  return rtArr.map(r => {
    const text = (r.plain_text || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    if (r.href) {
      const href = r.href.replace(/"/g, "&quot;");
      return `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
    }
    return text;
  }).join("");
}

async function fetchBlocks(blockId, depth) {
  if (depth === undefined) depth = 0;
  try {
    const res = await notionGet(`/v1/blocks/${blockId}/children?page_size=100`);
    const results = [];
    for (const block of (res.results || [])) {
      const type  = block.type;
      const rtArr = block[type]?.rich_text ?? [];
      const html  = rtToHtml(rtArr);
      let item = null;
      switch (type) {
        case "paragraph":          item = html ? { t: "p",     html, d: depth } : null; break;
        case "heading_1":          item = html ? { t: "h1",    html, d: depth } : null; break;
        case "heading_2":          item = html ? { t: "h2",    html, d: depth } : null; break;
        case "heading_3":          item = html ? { t: "h3",    html, d: depth } : null; break;
        case "bulleted_list_item": item = html ? { t: "li",    html, d: depth } : null; break;
        case "numbered_list_item": item = html ? { t: "li",    html, d: depth } : null; break;
        case "to_do":              item = html ? { t: "todo",  html, d: depth, checked: block.to_do?.checked ?? false } : null; break;
        case "quote":              item = html ? { t: "quote", html, d: depth } : null; break;
        case "divider":            item = { t: "hr", d: depth }; break;
        default:                   item = html ? { t: "p",     html, d: depth } : null; break;
      }
      if (item) results.push(item);
      // インデントされた子ブロックを再帰取得（深さ上限4）
      if (block.has_children && depth < 4) {
        const children = await fetchBlocks(block.id, depth + 1);
        results.push(...children);
      }
    }
    return results;
  } catch {
    return [];
  }
}

/* ──────────── データ変換 ──────────── */

const getTitle      = p => p?.title?.[0]?.plain_text       ?? "";
const getText       = p => p?.rich_text?.[0]?.plain_text   ?? "";
// Select型・Status型のどちらでも読めるようにする（Notion APIはプロパティの型によって
// select.name / status.name と参照先キーが変わるため）。デフォルト値を設定できる
// Status型に変更しても引き続き読み取れるようにするための互換対応。
const getSelect     = p => p?.select?.name ?? p?.status?.name ?? "";
const getUrl        = p => p?.url ?? "";
const getMultiSelect = p => (p?.multi_select ?? []).map(o => o.name);
const getDate    = p => (p?.date?.start ?? "").slice(0, 16); // "YYYY-MM-DDTHH:MM"
const getDateEnd = p => (p?.date?.end ?? "").slice(0, 16) || null; // Notionで終了日時を設定した場合のみ

function parseOffset(tzStr) {
  const m = (tzStr ?? "").match(/UTC([+-])(\d+)/);
  return m ? (m[1] === "+" ? +m[2] : -m[2]) : 9; // デフォルトJST
}

function statusCode(s) {
  return (s.includes("確定") || s.includes("完了")) ? "ok" : "plan";
}

// 「大多数(6)」のような表記から末尾の "(N)" 人数表記を取り除く。
function normalizeGroupTag(t) {
  return String(t).replace(/[（(]\d+[）)]\s*$/, "").trim();
}

// グループタグ（例: ["大多数(6)", "りょうじ"]）から実際の参加メンバーを展開する。
// 既知のグループ名はGROUP_MEMBERSの名簿に、個人名タグはその人自身に展開し、
// 両方を合算する。一つも展開できなければ resolved:false を返し、呼び出し側で
// Notionの「参加メンバー」への手入力にフォールバックする。
function expandGroupTags(rawTags) {
  const members = new Set();
  let resolved = false;
  for (const raw of rawTags) {
    const tag = normalizeGroupTag(raw);
    if (GROUP_MEMBERS[tag]) {
      GROUP_MEMBERS[tag].forEach(m => members.add(m));
      resolved = true;
    } else if (ALL_MEMBERS.includes(tag)) {
      members.add(tag);
      resolved = true;
    }
  }
  return { members: [...members], resolved };
}

function toEvent(page) {
  const p    = page.properties;
  const name = getTitle(p["予定名"]);
  const dt   = getDate(p["日付（現地時間）"]);
  if (!name || !dt) return null;

  const groupTags = getMultiSelect(p["グループ"]);
  const expanded  = expandGroupTags(groupTags);
  const members   = expanded.resolved ? expanded.members : getMultiSelect(p["参加メンバー"]);

  return {
    name,
    dt,
    dtEnd:     getDateEnd(p["日付（現地時間）"]),
    srcTZ:     parseOffset(getSelect(p["タイムゾーン"])),
    members,
    groupTags,
    category:  getSelect(p["カテゴリ"]),
    loc:       getText(p["場所"]),
    url:       getUrl(p["URL"]),
    notes:     getText(p["メモ"]),
    status:    statusCode(getSelect(p["ステータス"])),
    isSplit:   name.includes("分岐"),
    isRejoin:  name.includes("再合流"),
  };
}

/* ──────────── HTML生成 ──────────── */

async function main() {
  console.log(`🔄  Notionからデータを取得中 (DB: ${DATABASE_ID})`);

  const pages = await fetchAllPages();
  const valid = pages.map(page => ({ page, ev: toEvent(page) })).filter(e => e.ev !== null);
  console.log(`✅  ${valid.length} 件のイベントを取得`);

  console.log("📦  ページ本文を並列取得中...");
  const blocksList = await Promise.all(valid.map(e => fetchBlocks(e.page.id)));
  const events = valid.map(({ ev }, i) => ({ ...ev, content: blocksList[i] }));

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
