/**
 * Resolution of the sidecar paths for packaged and development launches.
 * @module @deepseek-ai/dsh-desktop/paths
 */

import { join } from 'node:path'

/** Environment keys `scripts/dev.mjs` sets for a development launch. */
export const DEV_NODE_ENV = 'DSH_DESKTOP_SIDECAR_NODE'
/** Environment key naming the dsh CLI entry for a development launch. */
export const DEV_BIN_ENV = 'DSH_DESKTOP_SIDECAR_BIN'

/** Inputs to sidecar path resolution: package state and environment. */
export interface SidecarPathInputs {
  /** Whether Electron runs from an electron-builder install. */
  readonly packaged: boolean
  /** The packaged resources directory (`process.resourcesPath`). */
  readonly resourcesPath: string
  /** The process environment, for development-launch overrides. */
  readonly env: Readonly<Record<string, string | undefined>>
}

/** Where the spawned sidecar finds the Node binary and the dsh CLI entry. */
export interface SidecarPaths {
  /** Absolute path of the standalone Node binary shipped in `resources/node`. */
  readonly nodeBin: string
  /** Absolute path of the dsh CLI entry (`lib/bin.js`) under `resources/app`. */
  readonly dshBin: string
}

/**
 * Resolve the sidecar paths. A packaged install reads the fixed
 * `extraResources` layout; a development launch requires the explicit
 * environment a developer cannot discover by accident, so a missing value
 * fails loud instead of guessing at an interpreter.
 * @param inputs - package state and environment.
 * @returns the Node binary and CLI entry to spawn.
 */
export function resolveSidecarPaths(inputs: SidecarPathInputs): SidecarPaths {
  if (inputs.packaged) {
    return {
      nodeBin: join(inputs.resourcesPath, 'node', process.platform === 'win32' ? 'node.exe' : 'bin/node'),
      dshBin: join(inputs.resourcesPath, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    }
  }
  const nodeBin = inputs.env[DEV_NODE_ENV]
  const dshBin = inputs.env[DEV_BIN_ENV]
  if (nodeBin === undefined || dshBin === undefined) {
    throw new Error(
      `development launch needs ${DEV_NODE_ENV} and ${DEV_BIN_ENV}; run apps/desktop through scripts/dev.mjs`,
    )
  }
  return { nodeBin, dshBin }
}
