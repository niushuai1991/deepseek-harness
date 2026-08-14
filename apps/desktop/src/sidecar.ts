/**
 * The `dsh web` sidecar process: pure spawn plan, readiness handshake, a
 * bounded output tail for the failure page, and platform process-tree
 * teardown.
 * @module @deepseek-ai/dsh-desktop/sidecar
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createReadyLineScanner } from './handshake.ts'
import { posixTeardownSequence, windowsTreeKillCommand } from './process-tree.ts'
import type { SidecarPaths } from './paths.ts'

/** Pure description of the sidecar spawn, checkable without spawning. */
export interface SidecarSpawnPlan {
  /** The Node binary to execute. */
  readonly file: string
  /** The exact argv, ending in the web profile flags. */
  readonly args: readonly string[]
  /** POSIX runs the sidecar detached in its own process group so teardown can signal the whole tree. */
  readonly detached: boolean
  /** stdin ignored; both output pipes retained for the handshake and log tail. */
  readonly stdio: readonly ('ignore' | 'pipe')[]
}

/**
 * Plan the sidecar launch: `node <dsh> --profile web --port 0`. Port 0 lets
 * the OS pick a free port; the web app prints the chosen loopback URL on
 * stdout when ready, which {@link Sidecar.start} awaits.
 * @param paths - the resolved Node binary and CLI entry.
 * @returns the spawn arguments.
 */
export function planSidecarSpawn(paths: SidecarPaths): SidecarSpawnPlan {
  return {
    file: paths.nodeBin,
    args: [paths.dshBin, '--profile', 'web', '--port', '0'],
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  }
}

/** Sidecar construction inputs. */
export interface SidecarOptions {
  /** The resolved Node binary and CLI entry. */
  readonly paths: SidecarPaths
  /** Ready-line deadline in milliseconds. @default 30000 */
  readonly readyTimeoutMs?: number
  /** Retained output lines for the failure page. @default 40 */
  readonly logTailLines?: number
}

/**
 * The `dsh web` sidecar for one shell lifetime: at most one `start`, torn
 * down once at quit. Windows teardown runs synchronously because Electron
 * quit does not outlive it; POSIX teardown signals the process group and its
 * escalation timer stays unref'd so quit is never blocked.
 */
export class Sidecar {
  private readonly options: SidecarOptions
  private readonly tail: string[] = []
  private child: ChildProcess | undefined

  /**
   * @param options - paths and tuning; no default path resolution happens here.
   */
  constructor(options: SidecarOptions) {
    this.options = options
  }

  /**
   * Spawn the sidecar and await its ready line.
   * @returns the loopback origin the web app listens on.
   * @rejects when the ready line does not arrive within the deadline, the process cannot spawn, or it exits
   * before ready. The rejection message embeds the retained output tail.
   */
  async start(): Promise<URL> {
    if (this.child !== undefined) throw new Error('sidecar already started')
    const plan = planSidecarSpawn(this.options.paths)
    const child = spawn(plan.file, [...plan.args], { detached: plan.detached, stdio: [...plan.stdio] })
    if (child.stdout === null || child.stderr === null) {
      // stdio 'pipe' always yields both streams; the null band is for the
      // other stdio configurations this spawn never uses.
      throw new Error('sidecar spawned without piped stdout/stderr')
    }
    const { stdout, stderr } = child
    const pid = child.pid
    if (pid === undefined) {
      throw new Error('sidecar spawned without a pid')
    }
    this.child = child
    const readyTimeoutMs = this.options.readyTimeoutMs ?? 30000
    const logTailLines = this.options.logTailLines ?? 40
    const scanner = createReadyLineScanner()
    return await new Promise<URL>((resolve, reject) => {
      // Settlements only run asynchronously, after every handler below exists.
      let done = false
      const timeout = setTimeout(() => {
        finish(() => reject(new Error(`sidecar not ready after ${String(readyTimeoutMs)}ms\n${this.tail.join('\n')}`)))
      }, readyTimeoutMs)

      /** Run exactly one settlement and detach every listener. */
      function finish(action: () => void): void {
        if (done) return
        done = true
        clearTimeout(timeout)
        stdout.off('data', onStdout)
        stderr.off('data', onStderr)
        child.off('error', onError)
        child.off('exit', onExit)
        action()
      }

      const onStdout = (chunk: Buffer): void => {
        const text = chunk.toString('utf8')
        this.appendTail(text, logTailLines)
        const ready = scanner.push(text)
        if (ready !== undefined) finish(() => { resolve(ready) })
      }
      const onStderr = (chunk: Buffer): void => {
        this.appendTail(chunk.toString('utf8'), logTailLines)
      }
      const onError = (error: Error): void => {
        finish(() => reject(new Error(`sidecar spawn failed: ${error.message}`)))
      }
      const onExit = (code: number | null): void => {
        finish(() => reject(new Error(`sidecar exited before ready with code ${String(code)}\n${this.tail.join('\n')}`)))
      }

      stdout.on('data', onStdout)
      stderr.on('data', onStderr)
      child.on('error', onError)
      child.on('exit', onExit)
    })
  }

  /**
   * Tear down the sidecar process tree. Safe to call before `start` or twice.
   */
  stop(): void {
    const child = this.child
    this.child = undefined
    if (child === undefined || child.pid === undefined) return
    // Capture the pid: the escalation closures outlive the narrowing above.
    const pid = child.pid
    if (process.platform === 'win32') {
      const command = windowsTreeKillCommand(pid)
      spawnSync(command.file, [...command.args])
      return
    }
    let delay = 0
    for (const step of posixTeardownSequence()) {
      if (delay === 0) this.signalGroup(pid, step.signal)
      else setTimeout(() => this.signalGroup(pid, step.signal), delay).unref()
      delay += step.graceMs
    }
  }

  /**
   * The retained output lines, oldest first, for the failure page.
   * @returns a copy of the log tail.
   */
  recentLog(): string[] {
    return [...this.tail]
  }

  /**
   * Append output text lines to the bounded tail.
   * @param text - one decoded output chunk.
   * @param limit - the retained line count.
   */
  private appendTail(text: string, limit: number): void {
    for (const line of text.split('\n')) {
      if (line === '') continue
      this.tail.push(line)
    }
    if (this.tail.length > limit) this.tail.splice(0, this.tail.length - limit)
  }

  /**
   * Signal the sidecar's process group.
   * @param pid - the sidecar PID; negated to address the whole group.
   * @param signal - the teardown signal.
   */
  private signalGroup(pid: number, signal: NodeJS.Signals): void {
    try {
      process.kill(-pid, signal)
    } catch {
      // ESRCH only: the group already exited between teardown steps.
    }
  }
}
