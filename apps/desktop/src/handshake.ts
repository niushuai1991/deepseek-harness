/**
 * Sidecar readiness handshake over the dsh web app's stdout ready line.
 *
 * `dsh --profile web --port 0` lets the OS pick the listening port and prints
 * `dsh web: http://127.0.0.1:<port>` (optionally followed by ` (LAN: …)`)
 * once the server accepts connections, after every module and plugin face has
 * settled. That line is the shell's only readiness signal: the chosen port
 * exists nowhere else. The line can arrive split across stdout chunks, so the
 * scanner buffers the unterminated tail; the app prints the URL only after
 * listening, so matching complete lines cannot miss it.
 * @module @deepseek-ai/dsh-desktop/handshake
 */

/** The prefix the dsh web app prints immediately before the listening URL. */
export const READY_LINE_PREFIX = 'dsh web: '

const READY_LINE_PATTERN = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)(?: \(.*\))?$/

/**
 * Extract the loopback origin from one complete stdout line, when the line is
 * the web app's ready line.
 * @param line - one complete stdout line, without its newline.
 * @returns the parsed loopback origin, or `undefined` when the line is not a ready line or names a non-loopback host.
 */
export function parseReadyLine(line: string): URL | undefined {
  const match = READY_LINE_PATTERN.exec(line)
  if (match === null) return undefined
  return new URL(match[1] ?? '')
}

/** Incremental scanner fed raw stdout chunks; completes at most once. */
export interface ReadyLineScanner {
  /**
   * Feed one stdout chunk.
   * @param chunk - decoded stdout text, at any line boundary.
   * @returns the ready origin on the chunk that completes the ready line, then `undefined` forever after.
   */
  push(chunk: string): URL | undefined
}

/**
 * Create a ready-line scanner over a stdout stream.
 * @param maxBufferChars - cap on the retained unterminated-line tail, so a runaway pre-ready line cannot grow memory without bound.
 * @default 4096
 * @returns the scanner.
 */
export function createReadyLineScanner(maxBufferChars = 4096): ReadyLineScanner {
  let buffer = ''
  let settled = false
  return {
    push(chunk: string): URL | undefined {
      if (settled) return undefined
      buffer += chunk
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        const ready = parseReadyLine(line)
        if (ready !== undefined) {
          settled = true
          return ready
        }
        newline = buffer.indexOf('\n')
      }
      if (buffer.length > maxBufferChars) buffer = buffer.slice(-maxBufferChars)
      return undefined
    },
  }
}
