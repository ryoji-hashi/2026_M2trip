# 🌍 旅程しおり — Notion自動同期ウェブアプリ

Notionのデータベースを更新するだけで、最大1時間後にウェブサイトへ自動反映されます。

---

## ⚙️ セットアップ手順

### Step 1 — Notionインテグレーションを作成

1. [notion.so/my-integrations](https://www.notion.so/my-integrations) を開く
2. **「+ New integration」** をクリック
3. 名前（例: `travel-itinerary`）を入力して Submit
4. 表示された **Internal Integration Token** (`secret_xxx...`) をコピーして保管

### Step 2 — データベースをインテグレーションと接続

1. Notionで **旅程データベース** のページを開く
2. 右上「**…**」→「**Connections**」→ 作ったインテグレーション名を選択
3. 「Allow access」をクリック

### Step 3 — GitHubリポジトリを作成してファイルをアップロード

1. GitHub で新しいリポジトリを作成（名前例: `travel-2026`）
2. このフォルダの中身をすべてそのままアップロード（またはgit push）

### Step 4 — Notionトークンをシークレットに登録

リポジトリページの **Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
|------|-------|
| `NOTION_TOKEN` | Step 1でコピーしたトークン (`secret_xxx...`) |

### Step 5 — GitHub Pagesを有効化

**Settings → Pages → Source: Deploy from a branch → Branch: `main` / `/ (root)` → Save**

数秒後に `https://yourname.github.io/travel-2026` の形式でURLが発行されます。

### Step 6 — 初回ビルドを手動実行

**Actions タブ → 「Notion同期 / Sync from Notion」→ 「Run workflow」**

しばらく（1〜2分）待つと `index.html` が生成されてウェブサイトが表示されます。

---

## 🔄 自動更新のしくみ

```
Notionを編集
    ↓
GitHub Actions が毎時0分に起動
    ↓
generate.js がNotion APIからデータ取得
    ↓
template.html にデータを埋め込んで index.html を生成
    ↓
GitHub Pages が index.html を配信
    ↓
ブラウザでアクセスすると最新の旅程が表示
```

**すぐに反映したい場合:** Actions タブ → 「Run workflow」で手動実行できます（10人の誰でもOK）。

---

## ✏️ カスタマイズ

### メンバー名の変更

`template.html` を開き、`MEMBERS = 10` と `TRIP_NAME = "グループ旅行 2026"` を書き換えてください。

### グループの追加・変更

Notionの「グループ」プロパティのオプションを追加・変更してください。  
`template.html` の `BADGE_CLASS` と `BADGE_LABEL` 、CSSの `.g-c` 等も合わせて編集します。

### 同期頻度の変更

`.github/workflows/sync.yml` の `cron` 式を変更してください：

```yaml
- cron: "0 * * * *"    # 毎時（デフォルト）
- cron: "*/30 * * * *" # 30分ごと
- cron: "0 */6 * * *"  # 6時間ごと
```

---

## 📁 ファイル構成

```
.github/
  workflows/
    sync.yml        ← GitHub Actions（自動同期の設定）
generate.js         ← Notionからデータ取得 + HTML生成スクリプト
template.html       ← HTMLテンプレート（直接編集してデザイン変更）
index.html          ← 生成物（generate.jsが自動更新、手動編集不要）
README.md           ← このファイル
```

---

## 🆔 データベースID

```
d12b01ae-a4db-44c0-a903-c8a1c01e511e
```

`generate.js` の `DATABASE_ID` に設定済みです。

---

## ❓ トラブルシューティング

**Q: Actions が失敗する**  
→ Secrets に `NOTION_TOKEN` が正しく設定されているか確認してください。

**Q: データが空になる**  
→ NotionのデータベースにStep 2の「Connections」設定が完了しているか確認してください。

**Q: 日時がずれる**  
→ Notionの各予定の「タイムゾーン」プロパティが正しく設定されているか確認してください（例: `🌍 CEST (UTC+2)`）。
