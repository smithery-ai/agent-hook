#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const AGENT_HOOK_HOME = join(homedir(), '.agent-hook')
const PROJECT_SETTINGS = '.claude/settings.local.json'
const GLOBAL_SETTINGS = join(homedir(), '.claude', 'settings.json')
const DEFAULT_BRANCH = 'main'

// Parse --global flag from args
const rawArgs = process.argv.slice(2)
const isGlobal = rawArgs.includes('--global') || rawArgs.includes('-g')
const filteredArgs = rawArgs.filter((a) => a !== '--global' && a !== '-g')
const SETTINGS_FILE = isGlobal ? GLOBAL_SETTINGS : PROJECT_SETTINGS

// ── Helpers ─────────────────────────────────────────────────────────────────

async function fetchJSON(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
  return res.json()
}

async function fetchText(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
  return res.text()
}

function rawURL(repo: string, branch: string, file: string) {
  return `https://raw.githubusercontent.com/${repo}/${branch}/${file}`
}

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

// Rewrite hook commands to point to ~/.agent-hook/<name>/
function rewriteCommands(
  hooks: Record<string, unknown[]>,
  hookName: string,
): Record<string, unknown[]> {
  const dir = hookDir(hookName)
  const rewritten: Record<string, unknown[]> = {}

  for (const [event, entries] of Object.entries(hooks)) {
    rewritten[event] = entries.map((entry) => {
      const str = JSON.stringify(entry)
      const replaced = str
        .replace(/"\$CLAUDE_PROJECT_DIR"\/.claude\/hooks\//g, `${dir}/`)
        .replace(/\$CLAUDE_PROJECT_DIR\/.claude\/hooks\//g, `${dir}/`)
      return JSON.parse(replaced)
    })
  }

  return rewritten
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
  console.log(`Fetching hook manifest from ${repo}@${branch}...`)

  const manifestURL = rawURL(repo, branch, 'hook.json')
  const manifest = (await fetchJSON(manifestURL)) as {
    name: string
    description: string
    files: string[]
    executable?: string[]
    hooks: Record<string, unknown[]>
    requires?: string[]
  }

  console.log(`  ${manifest.name}: ${manifest.description}`)

  // Check requirements
  if (manifest.requires?.length) {
    const { execSync } = await import('child_process')
    for (const req of manifest.requires) {
      try {
        execSync(`which ${req}`, { stdio: 'ignore' })
      } catch {
        console.warn(`  Warning: '${req}' not found in PATH`)
      }
    }
  }

  // Download files to ~/.agent-hook/<hook-name>/
  const dir = hookDir(hookName)
  mkdirSync(dir, { recursive: true })

  for (const file of manifest.files) {
    const url = rawURL(repo, branch, file)
    console.log(`  Downloading ${file}...`)
    const content = await fetchText(url)
    const filePath = join(dir, file)
    writeFileSync(filePath, content)

    if (manifest.executable?.includes(file)) {
      chmodSync(filePath, 0o755)
    }
  }

  // Save manifest locally for remove/info
  writeFileSync(join(dir, 'hook.json'), JSON.stringify(manifest, null, 2))

  // Rewrite hook commands to point to install dir, then merge into settings
  const rewritten = rewriteCommands(manifest.hooks, hookName)
  const settings = readSettings()
  const existingHooks = (settings.hooks || {}) as Record<string, unknown[]>
  settings.hooks = mergeHooks(existingHooks, rewritten)
  writeSettings(settings)

  console.log(`\nInstalled ${manifest.name} to ${dir}/`)
  console.log(`Updated ${SETTINGS_FILE} with hook configuration.`)
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
    name: string
    hooks: Record<string, unknown[]>
  }

  // Remove hooks from settings (using rewritten paths)
  const rewritten = rewriteCommands(manifest.hooks, hookName)
  const settings = readSettings()
  const existingHooks = (settings.hooks || {}) as Record<string, unknown[]>
  for (const [event, hooks] of Object.entries(rewritten)) {
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

  // Remove hook directory
  rmSync(dir, { recursive: true, force: true })

  console.log(`Removed ${manifest.name}.`)
  console.log(`Updated ${SETTINGS_FILE}.`)
}

async function info(name: string) {
  const { hookName } = parseRepo(name)
  const dir = hookDir(hookName)

  if (existsSync(join(dir, 'hook.json'))) {
    const manifest = JSON.parse(readFileSync(join(dir, 'hook.json'), 'utf-8'))
    console.log(JSON.stringify(manifest, null, 2))
    console.log(`\nInstalled at: ${dir}`)
  } else {
    const { repo, branch } = parseRepo(name)
    const manifestURL = rawURL(repo, branch, 'hook.json')
    const manifest = await fetchJSON(manifestURL)
    console.log(JSON.stringify(manifest, null, 2))
    console.log('\n(not installed)')
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
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      console.log(`  ${manifest.name} — ${manifest.description}`)
    } else {
      console.log(`  ${entry.name} — (no manifest)`)
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
  npx agent-hook add smithery-ai/smart-approve@main
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
