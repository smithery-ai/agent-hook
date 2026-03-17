# agent-hook

Install and manage Claude Code hooks from GitHub.

```sh
npx agent-hook add smithery-ai/smart-approve
```

## How it works

Each hook is a GitHub repo with a `hook.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$HOOK_DIR/scripts/my-hook.sh"
          }
        ]
      }
    ]
  }
}
```

`agent-hook add` clones the repo to `~/.agent-hook/<name>/`, resolves `$HOOK_DIR` to the install path, and merges the hook config into `.claude/settings.local.json`.

## Commands

```sh
npx agent-hook add owner/repo
npx agent-hook add owner/repo@branch
npx agent-hook add owner/repo --global    # write to ~/.claude/settings.json
npx agent-hook remove owner/repo
npx agent-hook info owner/repo
npx agent-hook list
```

## Creating a hook

1. Create a GitHub repo
2. Add scripts to a `scripts/` directory
3. Add a `hook.json` with `$HOOK_DIR` placeholders
4. Anyone can install with `npx agent-hook add your-org/your-hook`

### hook.json

Just the Claude Code hooks config with `$HOOK_DIR` as the install path placeholder:

```json
{
  "hooks": {
    "SessionStart": [
      {"hooks": [{"type": "command", "command": "$HOOK_DIR/scripts/setup.sh"}]}
    ],
    "PreToolUse": [
      {"hooks": [{"type": "command", "command": "$HOOK_DIR/scripts/gate.sh"}]}
    ]
  }
}
```

All `.sh` files in `scripts/` are automatically made executable on install.
