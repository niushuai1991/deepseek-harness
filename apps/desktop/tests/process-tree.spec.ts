import { describe, expect, it } from 'vitest'
import { posixTeardownSequence, windowsTreeKillCommand } from '../src/process-tree.ts'

describe('posixTeardownSequence', () => {
  it('escalates from SIGTERM to SIGKILL with a grace period', () => {
    expect(posixTeardownSequence()).toEqual([
      { signal: 'SIGTERM', graceMs: 3000 },
      { signal: 'SIGKILL', graceMs: 0 },
    ])
  })
})

describe('windowsTreeKillCommand', () => {
  it('targets the whole tree of the PID and forces termination', () => {
    expect(windowsTreeKillCommand(4242)).toEqual({ file: 'taskkill', args: ['/PID', '4242', '/T', '/F'] })
  })
})
