# Local PR

VSCode/Cursor拡張機能で、コードレビューコメントをインラインで表示します。ファイルベース（JSONL + gzip）で動作します。

## Features

- コードレビューコメントをインラインで表示
- `.review`フォルダでコメントを管理
- Unresolved Commentsビューで未解決のコメントを一覧表示
- コメントの追加、返信、編集、削除、解決が可能
- ファイル履歴の表示
- Outdatedコメントのフィルタリング

## Installation

### 開発版のインストール

1. リポジトリをクローン:
```bash
git clone <repository-url>
cd local-pr
```

2. 依存関係をインストール:
```bash
npm install
```

3. 拡張機能をビルド:
```bash
npm run compile
```

4. VSCode/Cursorで拡張機能を開く:
   - `F5`キーを押してExtension Development Hostを起動
   - または、コマンドパレット (`Ctrl+Shift+P`) から `Developer: Install Extension from Location...` を選択してプロジェクトフォルダを指定

### VSIXファイルからのインストール

1. 拡張機能をパッケージ化:
```bash
npm install -g @vscode/vsce
vsce package
```

2. 生成された`.vsix`ファイルをインストール:
   - VSCode/Cursorのコマンドパレット (`Ctrl+Shift+P`) を開く
   - `Extensions: Install from VSIX...` を選択
   - 生成された`.vsix`ファイルを選択

## Usage

1. プロジェクトのルートに`.review`フォルダが作成されます
2. コードエディタでコメントを追加したい行を選択し、右クリックメニューから`Add Comment`を選択
3. サイドバーの`Claude Review`パネルで未解決のコメントを確認できます

## Commands

- `Claude Review: Refresh Comments` - コメントを再読み込み
- `Claude Review: Clear All Comments` - すべてのコメントをクリア
- `Claude Review: List Reviewed Files` - レビュー済みファイル一覧を表示
- `Claude Review: Show File History` - ファイル履歴を表示

## CLI Tool

local-prコメントをコマンドラインから操作できるCLIツールです。

### インストール不要で実行

```bash
# コメント追加
npx local-pr-cli add --file src/App.tsx --line 42 --message "Null check needed" --severity warning

# 全ファイルの未解決コメント一覧
npx local-pr-cli list --active true

# 特定ファイルのコメント（JSON形式）
npx local-pr-cli list --file src/App.tsx --format json

# コメント解決
npx local-pr-cli resolve --file src/App.tsx --id 1

# コメント返信
npx local-pr-cli reply --file src/App.tsx --id 1 --message "Fixed"

# コメント削除
npx local-pr-cli delete --file src/App.tsx --id 1
```

### グローバルインストール

```bash
npm install -g local-pr-cli
local-pr list --active true
```

詳細は[cli/README.md](cli/README.md)を参照してください。

## Claude Code / Cursor Skill

Claude CodeやCursorで使えるスキルをワンコマンドでインストールできます。

### スキルのインストール

```bash
npx local-pr-cli install-skill
```

このコマンドは以下を実行します：
1. `.claude/`, `.cursor/`, `.codex/` ディレクトリを自動検出
2. 複数ある場合はユーザーに選択させる
3. GitHubから最新のスキルをダウンロード
4. `~/.claude/skills/reviewing-locally/SKILL.md` にインストール

### スキルの使い方

Claude CodeやCursorで以下のように実行：

```
/reviewing-locally
```

スキルがコードレビューのワークフローをサポートします：
- コメントの作成・読み取り・管理
- severity設定（error/warning/info）
- 複数行コメント対応
- outdatedコメントのフィルタリング

## Development

```bash
# Watch mode for development
npm run watch

# Run tests
npm test
```

## License

MIT
