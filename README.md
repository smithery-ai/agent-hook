# agent-hook

Install and manage Claude Code hooks from GitHub.

```sh
npx agent-hook add smart-approve
```

## How it works

Each hook is a GitHub repo with a `hook.json` manifest:

```json
{
  "name": "my-hook",
  "description": "What it does",
  "files": ["hook.sh", "server.ts"],
  "executable": ["hook.sh"],
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/hook.sh"
          }
        ]
      }
    ]
  },
  "requires": ["bun"]
}
```

`agent-hook add` fetches the manifest, downloads the files to `.claude/hooks/`, and merges the hook configuration into `.claude/settings.local.json`.

## Commands

```sh
# Install a hook (defaults to smithery-ai org)
npx agent-hook add smart-approve

# Install from any GitHub repo
npx agent-hook add user/repo

# Install from a specific branch
npx agent-hook add user/repo@branch

# Uninstall a hook (removes files + settings)
npx agent-hook remove smart-approve

# View a hook's manifest
npx agent-hook info smart-approve
```

## Creating a hook

1. Create a GitHub repo
2. Add a `hook.json` manifest (see schema above)
3. Add your hook scripts
4. Anyone can install it with `npx agent-hook add your-org/your-hook`

### hook.json schema

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Hook name |
| `description` | string | One-line description |
| `files` | string[] | Files to download to `.claude/hooks/` |
| `executable` | string[] | Files to `chmod +x` |
| `hooks` | object | Claude Code hook config (merged into settings) |
| `requires` | string[] | CLI tools that must be in PATH |
