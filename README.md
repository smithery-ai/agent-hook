# agent-hook

Install and manage Claude Code hooks from GitHub.

```sh
npx agent-hook add owner/hook-name
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

`agent-hook add` clones the repo to `~/.agent-hook/<name>/`, resolves `$HOOK_DIR` to the install path, and merges the hook config into your settings.

## Commands

```sh
npx agent-hook add owner/repo
npx agent-hook add owner/repo@branch
npx agent-hook remove owner/repo
npx agent-hook info owner/repo
npx agent-hook list
```

## Settings targets

By default, hook config is written to `.claude/settings.local.json` (personal, gitignored). You can change the target:

| Flag | File | Scope |
|------|------|-------|
| _(default)_ | `.claude/settings.local.json` | Personal, gitignored |
| `--repo` / `-r` | `.claude/settings.json` | Shared with team |
| `--global` / `-g` | `~/.claude/settings.json` | All projects |

```sh
npx agent-hook add owner/repo              # personal
npx agent-hook add owner/repo --repo       # shared with team
npx agent-hook add owner/repo --global     # all projects
```

## Creating a hook

1. Create a GitHub repo
2. Add scripts to a `scripts/` directory
3. Add a `hook.json` with `$HOOK_DIR` placeholders
4. Anyone can install with `npx agent-hook add your-org/your-hook`

### hook.json

Claude Code hooks config with `$HOOK_DIR` as the install path placeholder:

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

## Contributing

PRs welcome. To develop locally:

```sh
git clone https://github.com/smithery-ai/agent-hook.git
cd agent-hook
npm install
bun run dev -- add owner/repo   # test locally
bun run build                    # build bin/cli.mjs
```

## License

MIT
