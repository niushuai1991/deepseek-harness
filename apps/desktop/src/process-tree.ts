/**
 * Process-tree teardown planning for the dsh sidecar.
 *
 * The sidecar is spawned detached on POSIX, so it leads its own process group
 * and signaling the negated PID reaches every descendant. Windows has no
 * process groups, so teardown runs `taskkill /T /F` once, synchronously —
 * Electron quit blocks on it for the few hundred milliseconds it takes.
 * @module @deepseek-ai/dsh-desktop/process-tree
 */

/** One teardown step: a signal and the grace period before escalating to the next. */
export interface TeardownStep {
  /** The signal this step sends to the process group. */
  readonly signal: NodeJS.Signals
  /** How long to wait after this step before running the next one. */
  readonly graceMs: number
}

/**
 * The POSIX escalation sequence: terminate, wait, then kill the survivors.
 * @returns the teardown steps in execution order.
 */
export function posixTeardownSequence(): readonly TeardownStep[] {
  return [
    { signal: 'SIGTERM', graceMs: 3000 },
    { signal: 'SIGKILL', graceMs: 0 },
  ]
}

/** A command to run synchronously at quit. */
export interface SyncKillCommand {
  readonly file: string
  readonly args: readonly string[]
}

/**
 * The Windows process-tree kill command for a sidecar PID; `/T` walks the
 * child tree, `/F` forces termination.
 * @param pid - the sidecar PID.
 * @returns the `taskkill` invocation.
 */
export function windowsTreeKillCommand(pid: number): SyncKillCommand {
  return { file: 'taskkill', args: ['/PID', String(pid), '/T', '/F'] }
}
