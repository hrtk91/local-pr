# local-pr-cli

CLI tool for [local-pr](https://github.com/hirotaka-taminato/local-pr) code review comments.

## Installation

```bash
# Run directly with npx from GitHub (always uses latest version)
npx hrtk91/local-pr list

# Or install locally for development
git clone https://github.com/hrtk91/local-pr.git
cd local-pr/cli
npm install
npm run build
npm link
```

## Claude Code/Cursor Skill

Install the reviewing-locally skill for Claude Code or Cursor:

```bash
# Interactive mode - choose directory
npx hrtk91/local-pr install-skill

# Install to global (home directory)
npx hrtk91/local-pr install-skill --scope global

# Install to local (project directory)
npx hrtk91/local-pr install-skill --scope local

# Install to specific directory
npx hrtk91/local-pr install-skill --dir .claude

# Install to all available directories
npx hrtk91/local-pr install-skill --all
```

This will:
1. Detect your skill directories (`.claude`, `.cursor`, or `.codex`) in both local and global locations
2. Use `--scope <local|global|all>` to specify search scope (default: all)
3. Use `--dir <name>` to specify a directory or `--all` for all directories
4. Download the latest skill from GitHub
5. Install to `~/.claude/skills/reviewing-locally/` (global) or `./.claude/skills/reviewing-locally/` (local)

Usage in Claude Code/Cursor:
```
/reviewing-locally
```

## Usage

### List comments

```bash
# List all active comments
npx hrtk91/local-pr list --active true

# List comments in a specific file
npx hrtk91/local-pr list --file src/App.tsx

# Output as JSON
npx hrtk91/local-pr list --file src/App.tsx --format json
```

### Add a comment

```bash
npx hrtk91/local-pr add \
  --file src/App.tsx \
  --line 42 \
  --message "Add null check here" \
  --severity warning \
  --title "Null check missing"
```

Severity: `error` | `warning` | `info` (default: `info`)

### Resolve a comment

```bash
npx hrtk91/local-pr resolve --file src/App.tsx --id 3
```

### Reply to a comment

```bash
npx hrtk91/local-pr reply \
  --file src/App.tsx \
  --id 3 \
  --message "Fixed in commit abc123"
```

### Delete a comment

```bash
npx hrtk91/local-pr delete --file src/App.tsx --id 3
```

## Data Format

Comments are stored in `.review/files/*.jsonl.gz` (JSONL + gzip format).

See the [local-pr documentation](https://github.com/hirotaka-taminato/local-pr) for more details.
