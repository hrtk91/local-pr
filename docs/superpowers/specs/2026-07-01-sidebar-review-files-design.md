# Local Review Sidebar - Changed Files View

## Summary

VSCode/Cursor のサイドバー（アクティビティバー）に「Local Review」ビューを追加し、git diff のファイル一覧を表示する。ファイルクリックで diff ビューを開き、LLM 生成コードのローカルレビューを効率化する。

## Background

- local-pr は LLM の成果物を PR に出す前にローカルでレビューするための拡張機能
- 現在はパネル（下部バー）に "Unresolved Comments" TreeView があるが、レビュー対象ファイルの俯瞰ができない
- GitHub PR 拡張のようにファイル一覧から順にレビューする体験が必要

## Design

### 1. サイドバー構成

アクティビティバーに「Local Review」アイコンを追加。TreeView を 1 つ配置:

```
LOCAL REVIEW  [🔄 refresh]  [📌 base]  [📌 target]
  base: main (abc1234)
  target: HEAD (def5678)
├── M  src/api/handler.ts
├── A  src/components/NewForm.tsx
├── M  src/utils/validate.ts
└── D  src/old/legacy.ts
```

- ファイルステータスプレフィックス: `M`(modified), `A`(added), `D`(deleted), `R`(renamed)
- ファイル順: パスのアルファベット順
- 空状態: 「No changed files」メッセージ表示

### 2. ファイルクリック動作

`vscode.commands.executeCommand('vscode.diff', baseUri, targetUri, label)` で diff ビューを開く。

- base 側: `git show <base>:<file>` の内容を一時ファイルまたは仮想ドキュメントとして提供
- target 側: ワーキングツリーのファイル（HEAD の場合）
- 既存のインラインコメントスレッドは diff ビューでも自動表示される

### 3. コミット範囲セレクター

#### ベースコミット検出（優先順位）

1. `gh pr view --json baseRefName` — PR が存在すればその base ブランチ
2. `git merge-base HEAD <default-branch>` — ローカルで分岐点を特定
3. 設定 `localReview.baseBranch` — フォールバック（デフォルト: `main`）

#### コミット選択コマンド

- **`localReview.selectBase`**: QuickPick でブランチ一覧 + 最近のコミットから base を選択
- **`localReview.selectTarget`**: QuickPick で target を選択（デフォルト: `HEAD`）
- TreeView の description に現在の base..target を表示

### 4. 変更ファイル取得

```bash
git diff <base>..<target> --name-status
```

出力パース例:
```
M       src/api/handler.ts
A       src/components/NewForm.tsx
D       src/old/legacy.ts
R100    src/old/name.ts    src/new/name.ts
```

### 5. 既存機能との関係

- 下部パネルの "Unresolved Comments" はそのまま維持
- サイドバーの "Local Review" は追加であって置換ではない
- diff ビューで開いたファイルにも既存のコメントスレッドが自動表示される

### 6. package.json 変更

```jsonc
{
  "contributes": {
    "viewsContainers": {
      "activitybar": [{
        "id": "localReview",
        "title": "Local Review",
        "icon": "$(git-pull-request)"
      }],
      "panel": [/* 既存の claudeReview はそのまま */]
    },
    "views": {
      "localReview": [{
        "id": "localReview.changedFiles",
        "name": "Changed Files"
      }]
    },
    "commands": [
      { "command": "localReview.refresh", "title": "Local Review: Refresh" },
      { "command": "localReview.selectBase", "title": "Local Review: Select Base" },
      { "command": "localReview.selectTarget", "title": "Local Review: Select Target" }
    ]
  }
}
```

### 7. ファイル構成

新規ファイル:
- `src/changedFilesProvider.ts` — TreeDataProvider 実装
- `src/gitService.ts` — git コマンド実行（diff, merge-base, branch list 等）

変更ファイル:
- `src/extension.ts` — サイドバー初期化、コマンド登録
- `package.json` — views, commands 追加

## Non-Goals

- レビューステータス（reviewed/not reviewed）の永続化
- レビューサマリー（approve/request changes）
- PR 作成連携
- コメントセクションのサイドバー統合

## Testing

- `gitService.ts` のパースロジックはユニットテスト
- `changedFilesProvider.ts` は TreeDataProvider としてのインターフェーステスト
