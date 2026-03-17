#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs'
import { join } from 'path'

const HOOKS_DIR = '.claude/hooks'
const SETTINGS_FILE = '.claude/settings.local.json'
const DEFAULT_ORG = 'smithery-ai'
const DEFAULT_BRANCH = 'main'

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

function parseRepo(name: string): { repo: string; branch: string } {
  // "smart-approve" → "smithery-ai/smart-approve"
  // "user/repo" → "user/repo"
  // "user/repo@branch" → "user/repo" branch "branch"
  const [repopart, branch] = name.split('@')
  const repo = repopart.includes('/') ? repopart : `${DEFAULT_ORG}/${repopart}`
  return { repo, branch: branch || DEFAULT_BRANCH }
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
  mkdirSync('.claude', { recursive: true })
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n')
}

function mergeHooks(
  existing: Record<string, unknown[]>,
  incoming: Record<string, unknown[]>,
) {
  const merged = { ...existing }
  for (const [event, hooks] of Object.entries(incoming)) {
    const current = merged[event] || []
    // Dedupe by serialized value
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
  const { repo, branch } = parseRepo(name)
  console.log(`Fetching hook manifest from ${repo}@${branch}...`)

  // 1. Fetch hook.json
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

  // 2. Check requirements
  if (manifest.requires?.length) {
    for (const req of manifest.requires) {
      try {
        const { execSync } = await import('child_process')
        execSync(`which ${req}`, { stdio: 'ignore' })
      } catch {
        console.warn(`  Warning: '${req}' not found in PATH`)
      }
    }
  }

  // 3. Download files
  mkdirSync(HOOKS_DIR, { recursive: true })
  for (const file of manifest.files) {
    const url = rawURL(repo, branch, file)
    console.log(`  Downloading ${file}...`)
    const content = await fetchText(url)
    const dest = join(HOOKS_DIR, file)
    writeFileSync(dest, content)

    if (manifest.executable?.includes(file)) {
      chmodSync(dest, 0o755)
    }
  }

  // 4. Merge hooks into settings
  const settings = readSettings()
  const existingHooks = (settings.hooks || {}) as Record<string, unknown[]>
  settings.hooks = mergeHooks(existingHooks, manifest.hooks)
  writeSettings(settings)

  console.log(`\nInstalled ${manifest.name} to ${HOOKS_DIR}/`)
  console.log(`Updated ${SETTINGS_FILE} with hook configuration.`)
  console.log('\nRestart Claude Code for hooks to take effect.')
}

async function remove(name: string) {
  const { repo, branch } = parseRepo(name)

  // Fetch manifest to know which files and hooks to remove
  const manifestURL = rawURL(repo, branch, 'hook.json')
  const manifest = (await fetchJSON(manifestURL)) as {
    name: string
    files: string[]
    hooks: Record<string, unknown[]>
  }

  // Remove files
  const { unlinkSync } = await import('fs')
  for (const file of manifest.files) {
    const dest = join(HOOKS_DIR, file)
    if (existsSync(dest)) {
      unlinkSync(dest)
      console.log(`  Removed ${dest}`)
    }
  }

  // Remove hooks from settings
  const settings = readSettings()
  const existingHooks = (settings.hooks || {}) as Record<string, unknown[]>
  for (const [event, hooks] of Object.entries(manifest.hooks)) {
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

  console.log(`\nRemoved ${manifest.name}.`)
  console.log(`Updated ${SETTINGS_FILE}.`)
}

async function info(name: string) {
  const { repo, branch } = parseRepo(name)
  const manifestURL = rawURL(repo, branch, 'hook.json')
  const manifest = await fetchJSON(manifestURL)
  console.log(JSON.stringify(manifest, null, 2))
}

// ── Main ────────────────────────────────────────────────────────────────────

const [command, ...args] = process.argv.slice(2)

const USAGE = `Usage: agent-hook <command> <hook>

Commands:
  add <hook>       Install a hook (e.g. smart-approve, user/repo, user/repo@branch)
  remove <hook>    Uninstall a hook
  info <hook>      Show hook manifest

Examples:
  npx agent-hook add smart-approve
  npx agent-hook add smithery-ai/smart-approve@main
  npx agent-hook remove smart-approve`

if (!command || command === '--help' || command === '-h') {
  console.log(USAGE)
  process.exit(0)
}

const hookName = args[0]
if (!hookName) {
  console.error('Error: hook name required\n')
  console.log(USAGE)
  process.exit(1)
}

switch (command) {
  case 'add':
    await add(hookName)
    break
  case 'remove':
    await remove(hookName)
    break
  case 'info':
    await info(hookName)
    break
  default:
    console.error(`Unknown command: ${command}\n`)
    console.log(USAGE)
    process.exit(1)
}
