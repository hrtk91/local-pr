# local-pr-cli

CLI tool for [local-pr](https://github.com/hirotaka-taminato/local-pr) code review comments.

## Installation

```bash
# Run directly with npx (always uses latest version)
npx local-pr-cli list

# Or install globally
npm install -g local-pr-cli
```

## Claude Code/Cursor Skill

Install the reviewing-locally skill for Claude Code or Cursor:

```bash
npx local-pr-cli install-skill
```

This will:
1. Detect your skill directory (`.claude`, `.cursor`, or `.codex`)
2. Download the latest skill from GitHub
3. Install to `~/.claude/skills/reviewing-locally/`

Usage in Claude Code/Cursor:
```
/reviewing-locally
```

## Usage

### List comments

```bash
# List all active comments
npx local-pr-cli list --active true

# List comments in a specific file
npx local-pr-cli list --file src/App.tsx

# Output as JSON
npx local-pr-cli list --file src/App.tsx --format json
```

### Add a comment

```bash
npx local-pr-cli add \
  --file src/App.tsx \
  --line 42 \
  --message "Add null check here" \
  --severity warning \
  --title "Null check missing"
```

Severity: `error` | `warning` | `info` (default: `info`)

### Resolve a comment

```bash
npx local-pr-cli resolve --file src/App.tsx --id 3
```

### Reply to a comment

```bash
npx local-pr-cli reply \
  --file src/App.tsx \
  --id 3 \
  --message "Fixed in commit abc123"
```

### Delete a comment

```bash
npx local-pr-cli delete --file src/App.tsx --id 3
```

## Data Format

Comments are stored in `.review/files/*.jsonl.gz` (JSONL + gzip format).

See the [local-pr documentation](https://github.com/hirotaka-taminato/local-pr) for more details.
