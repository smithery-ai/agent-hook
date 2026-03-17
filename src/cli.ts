#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execSync } from 'child_process'

const AGENT_HOOK_HOME = join(homedir(), '.agent-hook')
const PROJECT_SETTINGS = '.claude/settings.local.json'
const GLOBAL_SETTINGS = join(homedir(), '.claude', 'settings.json')
const DEFAULT_BRANCH = 'main'

// Parse --global flag
const rawArgs = process.argv.slice(2)
const isGlobal = rawArgs.includes('--global') || rawArgs.includes('-g')
const filteredArgs = rawArgs.filter((a) => a !== '--global' && a !== '-g')
const SETTINGS_FILE = isGlobal ? GLOBAL_SETTINGS : PROJECT_SETTINGS

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseRepo(name: string): { repo: string; branch: string; hookName: string } {
  const [repopart, branch] = name.split('@')
  if (!repopart.includes('/')) {
    console.error(`Error: hook name must be in 'owner/repo' format (e.g. smithery-ai/smart-approve)`)
    process.exit(1)
  }
  const hookName = repopart.split('/').pop()!
  return { repo: repopart, branch: branch || DEFAULT_BRANCH, hookName }
}

function hookDir(hookName: string) {
  return join(AGENT_HOOK_HOME, hookName)
}

function readSettings(): Record<string, unknown> {
  if (!existsSync(SETTINGS_FILE)) return {}
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

function writeSettings(settings: Record<string, unknown>) {
  const dir = isGlobal ? join(homedir(), '.claude') : '.claude'
  mkdirSync(dir, { recursive: true })
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n')
}

function resolveHooks(
  hooks: Record<string, unknown[]>,
  hookName: string,
): Record<string, unknown[]> {
  const dir = hookDir(hookName)
  const resolved: Record<string, unknown[]> = {}

  for (const [event, entries] of Object.entries(hooks)) {
    resolved[event] = entries.map((entry) => {
      const str = JSON.stringify(entry)
      return JSON.parse(str.replace(/\$HOOK_DIR/g, dir))
    })
  }

  return resolved
}

function mergeHooks(
  existing: Record<string, unknown[]>,
  incoming: Record<string, unknown[]>,
) {
  const merged = { ...existing }
  for (const [event, hooks] of Object.entries(incoming)) {
    const current = merged[event] || []
    const seen = new Set(current.map((h) => JSON.stringify(h)))
    for (const hook of hooks) {
      const key = JSON.stringify(hook)
      if (!seen.has(key)) {
        current.push(hook)
        seen.add(key)
      }
    }
    merged[event] = current
  }
  return merged
}

// ── Commands ────────────────────────────────────────────────────────────────

async function add(name: string) {
  const { repo, branch, hookName } = parseRepo(name)
  const dir = hookDir(hookName)

  console.log(`Installing ${repo}@${branch}...`)

  // Clone repo to ~/.agent-hook/<hook-name>/
  mkdirSync(AGENT_HOOK_HOME, { recursive: true })
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }

  try {
    execSync(
      `git clone --depth 1 --branch ${branch} https://github.com/${repo}.git ${dir}`,
      { stdio: 'pipe' },
    )
  } catch {
    console.error(`Error: failed to clone ${repo}. Check the repo exists and is accessible.`)
    process.exit(1)
  }

  // Read hook.json
  const manifestPath = join(dir, 'hook.json')
  if (!existsSync(manifestPath)) {
    console.error(`Error: ${repo} has no hook.json`)
    rmSync(dir, { recursive: true, force: true })
    process.exit(1)
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
    hooks: Record<string, unknown[]>
  }

  // chmod +x all .sh files in scripts/
  const scriptsDir = join(dir, 'scripts')
  if (existsSync(scriptsDir)) {
    execSync(`chmod +x ${scriptsDir}/*.sh 2>/dev/null || true`, { stdio: 'pipe' })
  }

  // Resolve $HOOK_DIR and merge into settings
  const resolved = resolveHooks(manifest.hooks, hookName)
  const settings = readSettings()
  const existingHooks = (settings.hooks || {}) as Record<string, unknown[]>
  settings.hooks = mergeHooks(existingHooks, resolved)
  writeSettings(settings)

  console.log(`Installed to ${dir}/`)
  console.log(`Updated ${SETTINGS_FILE}`)
  console.log('\nRestart Claude Code for hooks to take effect.')
}

async function remove(name: string) {
  const { hookName } = parseRepo(name)
  const dir = hookDir(hookName)

  if (!existsSync(join(dir, 'hook.json'))) {
    console.error(`Hook '${hookName}' is not installed.`)
    process.exit(1)
  }

  const manifest = JSON.parse(readFileSync(join(dir, 'hook.json'), 'utf-8')) as {
    hooks: Record<string, unknown[]>
  }

  // Remove hooks from settings
  const resolved = resolveHooks(manifest.hooks, hookName)
  const settings = readSettings()
  const existingHooks = (settings.hooks || {}) as Record<string, unknown[]>
  for (const [event, hooks] of Object.entries(resolved)) {
    const current = existingHooks[event] || []
    const removals = new Set(hooks.map((h) => JSON.stringify(h)))
    existingHooks[event] = current.filter(
      (h) => !removals.has(JSON.stringify(h)),
    )
    if (existingHooks[event].length === 0) {
      delete existingHooks[event]
    }
  }
  settings.hooks = existingHooks
  if (Object.keys(settings.hooks as object).length === 0) {
    delete settings.hooks
  }
  writeSettings(settings)

  rmSync(dir, { recursive: true, force: true })

  console.log(`Removed ${hookName}.`)
  console.log(`Updated ${SETTINGS_FILE}.`)
}

async function info(name: string) {
  const { hookName, repo, branch } = parseRepo(name)
  const dir = hookDir(hookName)

  if (existsSync(join(dir, 'hook.json'))) {
    const manifest = JSON.parse(readFileSync(join(dir, 'hook.json'), 'utf-8'))
    console.log(JSON.stringify(manifest, null, 2))
    console.log(`\nInstalled at: ${dir}`)
  } else {
    console.log(`Hook '${hookName}' is not installed.`)
    console.log(`Install with: npx agent-hook add ${repo}@${branch}`)
  }
}

async function list() {
  if (!existsSync(AGENT_HOOK_HOME)) {
    console.log('No hooks installed.')
    return
  }

  const entries = readdirSync(AGENT_HOOK_HOME, { withFileTypes: true })
    .filter((e) => e.isDirectory())

  if (entries.length === 0) {
    console.log('No hooks installed.')
    return
  }

  for (const entry of entries) {
    const manifestPath = join(AGENT_HOOK_HOME, entry.name, 'hook.json')
    if (existsSync(manifestPath)) {
      console.log(`  ${entry.name}`)
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

const [command, ...args] = filteredArgs

const USAGE = `Usage: agent-hook <command> [hook] [--global]

Commands:
  add <hook>       Install a hook (e.g. owner/repo, owner/repo@branch)
  remove <hook>    Uninstall a hook and remove settings
  info <hook>      Show hook manifest
  list             List installed hooks

Flags:
  --global, -g     Write hook config to ~/.claude/settings.json (default: .claude/settings.local.json)

Examples:
  npx agent-hook add smithery-ai/smart-approve
  npx agent-hook add smithery-ai/smart-approve --global
  npx agent-hook remove smithery-ai/smart-approve
  npx agent-hook list`

if (!command || command === '--help' || command === '-h') {
  console.log(USAGE)
  process.exit(0)
}

switch (command) {
  case 'list':
    await list()
    break
  case 'add':
  case 'remove':
  case 'info': {
    const hookName = args[0]
    if (!hookName) {
      console.error('Error: hook name required\n')
      console.log(USAGE)
      process.exit(1)
    }
    if (command === 'add') await add(hookName)
    else if (command === 'remove') await remove(hookName)
    else await info(hookName)
    break
  }
  default:
    console.error(`Unknown command: ${command}\n`)
    console.log(USAGE)
    process.exit(1)
}
