# Local Review CLI拡張 + スキル + 保存先変更

## Summary

CLI にgit風サブコマンド（status/diff-files/diff/config）を追加し、保存先を `~/.local-review/<project-hash>/` に移行する。Claude Codeスキル1つでLLMレビュー実行とレビュー対応の両方をカバーする。

## 1. 保存先

### ディレクトリ構造

```
~/.local-review/
  <sha256(git-remote-url)[:12]>/
    files/
      <encoded-path>.jsonl.gz      # コメントデータ（既存JSONL+gzip形式）
    config.json                     # 設定（base, target等）
```

### プロジェクト識別

`git remote get-url origin` の SHA256 先頭12文字をディレクトリ名に使用。worktree間で同じリポジトリなら同一ディレクトリを共有。

### マイグレーション

既存の `.review/` ディレクトリがあり、`~/.local-review/` に対応データがない場合、初回起動時にコピー。`.review/` は残す（ユーザーが手動削除）。

### config.json

```json
{
  "baseBranch": "develop",
  "targetRef": "HEAD",
  "projectName": "school_health_dx"
}
```

`projectName` は表示用。`git remote` から取得（`owner/repo` 形式）。

## 2. CLI追加コマンド

### 共通: 保存先解決

全コマンドで `~/.local-review/<hash>/` を自動解決。`--project-dir` オプションで上書き可能。

### `lrev status`

```
$ lrev status
Project: mi-labo/school_health_dx
Base:    develop
Target:  HEAD (feat/print-config @ abc1234)

Changed files: 12
  Modified: 8
  Added:    3
  Deleted:  1

Comments: 5 unresolved, 3 resolved
```

### `lrev diff-files`

```
$ lrev diff-files
M  src/components/EditorSidebar.vue
M  src/composables/useEditorState.ts
A  src/components/NewPanel.vue
D  tests/old.test.ts
```

`--json` フラグで JSON 出力（スキルが使う）。

### `lrev diff <file>`

```
$ lrev diff src/components/EditorSidebar.vue
```

内部で `git diff $(git merge-base HEAD <base>) -- <file>` を実行。そのまま標準出力。

### `lrev config [key] [value]`

```
$ lrev config                    # 全設定表示
$ lrev config base develop       # base設定
$ lrev config target HEAD        # target設定
```

### 既存コマンド

`add`, `list`, `resolve`, `reply`, `delete`, `install-skill` はそのまま維持。保存先のみ `~/.local-review/` に変更。

## 3. スキル: local-review

### トリガー

`local-review`, `ローカルレビュー`, `レビューして`, `レビュー対応`, `コメント確認`

### 動作フロー

スキルは起動時に `lrev status` で現状を把握し、コンテキストに応じて動作を決定:

**レビューモード**（コメントが少ない or ユーザーが「レビューして」）:
1. `lrev diff-files --json` で変更ファイル一覧取得
2. 各ファイルの `lrev diff <file>` でdiff取得
3. LLM がコードレビュー実行
4. `lrev add` でコメント書き込み
5. VSCode拡張が自動検知して表示

**対応モード**（コメントが多い or ユーザーが「対応して」「修正して」）:
1. `lrev list --json` で未解決コメント一覧取得
2. 各コメントの指摘に対してコード修正
3. `lrev resolve` で解決済みに

### スキルのreference

用途に応じたプロンプトテンプレートを reference として保持:
- `review-prompt.md`: レビュー観点（セキュリティ、パフォーマンス、可読性等）
- `fix-prompt.md`: 修正方針（最小限の変更、テスト維持等）

## 4. VSCode拡張の変更

### 保存先の変更

`commentStore.ts` の保存先を `~/.local-review/<hash>/files/` に変更。
`changedFilesProvider.ts` の config読み込みを `~/.local-review/<hash>/config.json` に変更。

### ファイルウォッチャー

`~/.local-review/<hash>/files/` を監視対象に変更（chokidarで対応可能）。

## 5. ファイル構成

### 新規

- `cli/src/commands/status.ts`
- `cli/src/commands/diffFiles.ts`
- `cli/src/commands/diff.ts`
- `cli/src/commands/config.ts`
- `cli/src/storage.ts` — 保存先解決ロジック（共通）
- `skills/local-review/SKILL.md` — Claude Codeスキル定義

### 変更

- `cli/src/index.ts` — 新コマンド登録 + 保存先変更
- `src/commentStore.ts` — 保存先を `~/.local-review/` に変更
- `src/changedFilesProvider.ts` — config読み込み先変更
- `src/extension.ts` — ウォッチャーのパス変更

## Non-Goals

- マルチユーザー対応（レビューは個人ローカル）
- GitHub PR との同期
- `.review/` の自動削除（マイグレーション後もユーザー判断）

## Testing

- `cli/src/storage.ts` — プロジェクトハッシュ生成、パス解決のユニットテスト
- `cli/src/commands/` — 各コマンドの出力パースはテスト可能な純粋関数に分離
- 既存テスト（87件）の保存先をモック対応に更新
