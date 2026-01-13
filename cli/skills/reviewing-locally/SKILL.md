---
name: reviewing-locally
description: ローカルコードレビューコメントの作成・読み取り・管理を行う。コードレビュー時やレビューコメントへの対応時に使用する。
---

# Reviewing Locally

local-pr形式（`.review/`）でコードレビューコメントを操作するスキル。

## セットアップ

```bash
# スキルインストール（初回のみ）
npx local-pr-cli install-skill
```

## データ形式

### ファイル構造
```
.review/
└── files/
    └── {encodedPath}.jsonl.gz   # URLエンコードされたパス
```

例: `src/App.tsx` → `.review/files/src%2FApp.tsx.jsonl.gz`

### ReviewComment スキーマ
```typescript
{
  id: string;              // 連番ID
  file: string;            // 相対パス
  line: number;            // 1-indexed
  endLine?: number;        // 複数行の場合
  line_content: string;    // コメント対象の行内容（outdated判定用）
  message: string;         // コメント本文
  severity: 'error' | 'warning' | 'info';
  title?: string;          // 短いタイトル
  resolved?: boolean;
  outdated?: boolean;
  created_at: string;      // ISO 8601
  author?: 'claude' | 'user';
  replies?: Array<{
    author: string;
    message: string;
    timestamp: string;
  }>;
}
```

## CLI ツール

`npx local-pr-cli` で常に最新版を実行可能（インストール不要）。

### コメント一覧

```bash
# 全ファイルの未解決コメント
npx local-pr-cli list --active true

# 特定ファイル（JSON形式）
npx local-pr-cli list --file src/App.tsx --format json
```

### コメント作成

```bash
npx local-pr-cli add \
  --file "src/App.tsx" \
  --line 42 \
  --message "ここでnullチェックが必要です" \
  --severity warning \
  --title "Null check missing"
```

### 解決・リプライ・削除

```bash
# 解決済みにする
npx local-pr-cli resolve --file "src/App.tsx" --id 3

# リプライ追加
npx local-pr-cli reply --file "src/App.tsx" --id 3 --message "修正しました"

# 削除
npx local-pr-cli delete --file "src/App.tsx" --id 3
```

## ワークフロー

### コードレビュー時
1. 対象ファイルを読み取り
2. 問題点を特定
3. `npx local-pr-cli add` でコメント作成
4. severity は問題の重大度に応じて設定:
   - `error`: バグ、セキュリティ問題、必須の修正
   - `warning`: 改善推奨、潜在的問題
   - `info`: 提案、質問、メモ

### レビュー対応時
1. 既存コメントを読み取り（`npx local-pr-cli list`）
2. 指摘内容を確認
3. コードを修正
4. 修正完了後、`npx local-pr-cli resolve` で解決

## 注意事項

- `line_content` は必ず設定する（outdated検出に必要）
- ファイル保存後、VSCode拡張が自動でoutdated判定を更新
- 複数行コメントは `--end-line` を設定
- author は `claude` を指定
