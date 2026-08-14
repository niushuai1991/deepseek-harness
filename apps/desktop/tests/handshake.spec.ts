import { describe, expect, it } from 'vitest'
import { createReadyLineScanner, parseReadyLine, READY_LINE_PREFIX } from '../src/handshake.ts'

describe('parseReadyLine', () => {
  it('parses the plain loopback ready line', () => {
    expect(parseReadyLine('dsh web: http://127.0.0.1:41234')?.href).toBe('http://127.0.0.1:41234/')
  })

  it('parses the ready line with the LAN suffix', () => {
    expect(parseReadyLine('dsh web: http://127.0.0.1:8080 (LAN: http://192.168.1.4:8080)')?.href).toBe('http://127.0.0.1:8080/')
  })

  it('rejects other lines', () => {
    expect(parseReadyLine('some other log line')).toBeUndefined()
    expect(parseReadyLine('dsh web: http://0.0.0.0:8080')).toBeUndefined()
    expect(parseReadyLine('xdsh web: http://127.0.0.1:8080')).toBeUndefined()
    expect(parseReadyLine('')).toBeUndefined()
  })
})

describe('createReadyLineScanner', () => {
  it('completes on a whole ready line in one chunk', () => {
    const scanner = createReadyLineScanner()
    expect(scanner.push(`noise\n${READY_LINE_PREFIX}http://127.0.0.1:51\n`)?.href).toBe('http://127.0.0.1:51/')
    expect(scanner.push(`${READY_LINE_PREFIX}http://127.0.0.1:52\n`)).toBeUndefined()
  })

  it('completes across a line split mid-URL', () => {
    const scanner = createReadyLineScanner()
    expect(scanner.push('dsh web: http://127.')).toBeUndefined()
    expect(scanner.push('0.0.1:9999\n')?.href).toBe('http://127.0.0.1:9999/')
  })

  it('tolerates CRLF line endings', () => {
    const scanner = createReadyLineScanner()
    expect(scanner.push('dsh web: http://127.0.0.1:7\r\n')?.href).toBe('http://127.0.0.1:7/')
  })

  it('drops the front of an unterminated runaway line beyond the buffer cap', () => {
    const scanner = createReadyLineScanner(16)
    expect(scanner.push('x'.repeat(64))).toBeUndefined()
    expect(scanner.push(`\n${READY_LINE_PREFIX}http://127.0.0.1:9\n`)?.href).toBe('http://127.0.0.1:9/')
  })
})
