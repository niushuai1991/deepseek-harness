#!/usr/bin/env node
// Assembles the sidecar payload under apps/desktop/staging before
// electron-builder packs it:
//   staging/app   production install of the dsh CLI closure, plain-Node runnable
//   staging/node  standalone Node binary for this build platform
//
// Prerequisites (fail loud below when missing): `pnpm run build` and the
// apps/web vite build, because pnpm deploy packs workspace packages as-is
// with their built lib/ and dist/.
//
// The Node binary downloads from the npmmirror mirror (override with
// DSH_DESKTOP_NODE_MIRROR) and caches under staging-cache/.

import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(appDir, '../..')
const staging = join(appDir, 'staging')
const cache = join(appDir, 'staging-cache')
// Normalize the trailing slash: the listing and download URLs concatenate below.
const MIRROR = (process.env.DSH_DESKTOP_NODE_MIRROR ?? 'https://npmmirror.com/mirrors/node/').replace(/\/?$/, '/')
// Windows resolves bare `pnpm` only through its .cmd shim, and Node refuses to
// spawn .cmd shims without a shell.
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const pnpmShell = process.platform === 'win32'

/** Run one command, exiting loudly on failure. */
function run(label, file, args, options = {}) {
  console.log(`assemble-staging: ${label}: ${file} ${args.join(' ')}`)
  const result = spawnSync(file, args, { stdio: 'inherit', ...options })
  if (result.status !== 0) {
    console.error(`assemble-staging: ${label} failed with status ${String(result.status)}`)
    process.exit(result.status ?? 1)
  }
}

/** Fetch a URL as text, exiting on transport failure. */
function fetchText(url) {
  const curl = spawnSync('curl', ['-fsSL', url], { encoding: 'utf8' })
  if (curl.status !== 0) {
    console.error(`assemble-staging: fetching ${url} failed (exit ${String(curl.status)})`)
    process.exit(1)
  }
  return curl.stdout
}

for (const built of [join(root, 'apps/cli/lib/bin.js'), join(root, 'apps/web/dist/index.html')]) {
  if (!existsSync(built)) {
    console.error(`assemble-staging: missing ${built}; run pnpm run build and the apps/web vite build first`)
    process.exit(1)
  }
}

rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })
mkdirSync(cache, { recursive: true })

// The sidecar closure: apps/desktop/deploy-root is a dependency-only manifest
// unioning the dsh CLI's dependencies with the runtime peers its bundles
// consume (the CLI's devDependencies supply those at the repository root, so
// a plain --prod deploy of the CLI itself would drop them). The hoisted
// linker produces a flat npm-style node_modules: every package is stored
// once at the top level, so installer packaging dereferences no .pnpm
// symlinks into duplicate copies. Workspace packages are injected from their
// built outputs; the deploy target runs under plain Node with no pnpm state
// at install time. The root workspace's allowBuilds keys cannot match inside
// the deployed lockfile (file: refs rebase to the staging dir), and the whole
// closure is already script-reviewed at the root install, so this one deploy
// drops the gate.
const dshBin = join(staging, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
run('deploy dsh closure', pnpm, [
  '--filter', '@deepseek-ai/dsh-desktop-deploy',
  'deploy',
  '--prod',
  '--config.inject-workspace-packages=true',
  '--config.node-linker=hoisted',
  '--config.strict-dep-builds=false',
  join(staging, 'app'),
], { cwd: root, shell: pnpmShell })

if (!existsSync(dshBin)) {
  console.error(`assemble-staging: deploy did not produce ${dshBin}`)
  process.exit(1)
}

// The SPA dist is a transitive dependency (@deepseek-ai/dsh-web-frontend under
// the web-app bundle), so under pnpm's isolated linker it resolves from the
// web-app's own module context, not from the closure's top-level node_modules.
// Resolve it exactly the way the web app does at runtime.
const distResolve = spawnSync(process.execPath, ['-e', [
  "const { createRequire } = require('node:module');",
  "const webApp = require.resolve('@deepseek-ai/dsh-web-app');",
  "console.log(createRequire(webApp).resolve('@deepseek-ai/dsh-web-frontend/dist/index.html'));",
].join(' ')], { cwd: join(staging, 'app'), encoding: 'utf8' })
if (distResolve.status !== 0) {
  console.error(`assemble-staging: the deployed closure does not resolve the SPA dist:\n${distResolve.stderr}`)
  process.exit(1)
}
console.log(`assemble-staging: SPA dist at ${distResolve.stdout.trim()}`)

// The standalone Node binary: the newest release of the repository's engines
// line for this build platform. npmmirror renders its directory pages
// client-side, so its JSON API answers when the HTML listing has no matches;
// the download itself always uses the release's plain version directory.
const platform = process.platform === 'win32' ? 'win-x64' : 'linux-x64'
const archiveSuffix = process.platform === 'win32' ? 'zip' : 'tar.xz'
const line = process.version.startsWith('v22.') ? 'latest-v22.x' : 'latest-v24.x'
const archivePattern = new RegExp(`node-v(\\d+)\\.(\\d+)\\.(\\d+)-${platform}\\.${archiveSuffix}`, 'g')

/** Pick the highest-version archive match in a listing text. */
function pickLatest(listing) {
  let best
  for (const match of listing.matchAll(archivePattern)) {
    const order = best === undefined
      ? 1
      : (Number(match[1]) - Number(best[1])) || (Number(match[2]) - Number(best[2])) || (Number(match[3]) - Number(best[3]))
    if (order > 0) best = match
  }
  return best
}

let entry = pickLatest(fetchText(`${MIRROR}${line}/`))
if (entry === undefined && MIRROR.includes('npmmirror')) {
  entry = pickLatest(fetchText(`https://registry.npmmirror.com/-/binary/node/${line}/`))
}
if (entry === undefined) {
  console.error(`assemble-staging: no ${platform} archive listed for the ${line} line`)
  process.exit(1)
}
const archiveName = entry[0]
const version = `v${entry[1]}.${entry[2]}.${entry[3]}`
const archivePath = join(cache, archiveName)
if (!existsSync(archivePath)) {
  run(`download ${archiveName}`, 'curl', ['-fL', '-o', archivePath, `${MIRROR}${version}/${archiveName}`])
}
const extractDir = join(cache, `extract-${platform}`)
rmSync(extractDir, { recursive: true, force: true })
mkdirSync(extractDir, { recursive: true })
if (process.platform === 'win32') {
  // Windows ships bsdtar, which reads zip archives.
  run('extract node archive', 'tar', ['-xf', archivePath, '-C', extractDir])
  mkdirSync(join(staging, 'node'), { recursive: true })
  copyFileSync(join(extractDir, archiveName.replace(/\.zip$/, ''), 'node.exe'), join(staging, 'node', 'node.exe'))
} else {
  run('extract node archive', 'tar', ['-xJf', archivePath, '-C', extractDir])
  mkdirSync(join(staging, 'node', 'bin'), { recursive: true })
  const nodeBin = join(extractDir, archiveName.replace(/\.tar\.xz$/, ''), 'bin', 'node')
  copyFileSync(nodeBin, join(staging, 'node', 'bin', 'node'))
  chmodSync(join(staging, 'node', 'bin', 'node'), 0o755)
}

// Sanity: the staged closure reports a version through the staged binary.
run('staged dsh version', join(staging, 'node', process.platform === 'win32' ? 'node.exe' : 'bin/node'), [
  dshBin, '--version',
])

console.log('assemble-staging: done')
