#!/usr/bin/env node
// Development launch: build the main process, then run Electron against the
// source-built dsh CLI and apps/web dist. The sidecar runs under the same
// Node as this script, so `pnpm run build` (and the apps/web vite build) are
// the only prerequisites.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(appDir, '../..')

for (const built of [resolve(root, 'apps/cli/lib/bin.js'), resolve(root, 'apps/web/dist/index.html')]) {
  if (!existsSync(built)) {
    console.error(`dev: missing ${built}; run pnpm run build first`)
    process.exit(1)
  }
}

// Windows resolves bare `pnpm` only through its .cmd shim, and Node refuses
// to spawn .cmd shims without a shell.
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const pnpmShell = process.platform === 'win32'
const build = spawnSync(pnpm, ['exec', 'tsc', '-p', appDir], { stdio: 'inherit', shell: pnpmShell })
if (build.status !== 0) process.exit(build.status ?? 1)

const electron = spawnSync(pnpm, ['exec', 'electron', '.'], {
  cwd: appDir,
  stdio: 'inherit',
  shell: pnpmShell,
  env: {
    ...process.env,
    DSH_DESKTOP_SIDECAR_NODE: process.execPath,
    DSH_DESKTOP_SIDECAR_BIN: resolve(root, 'apps/cli/lib/bin.js'),
  },
})
process.exit(electron.status ?? 1)
