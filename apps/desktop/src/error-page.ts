/**
 * The local failure page shown when the sidecar never reaches its ready line.
 * A `data:` URL keeps the page inside the sandboxed renderer with no file or
 * network access to grant.
 * @module @deepseek-ai/dsh-desktop/error-page
 */

/**
 * Escape the five HTML-significant characters.
 * @param text - untrusted text to embed in the page.
 * @returns text with `&`, `<`, `>`, `"`, `'` as character references.
 */
function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

/**
 * Build the failure page URL.
 * @param failure - one-line description of the failure.
 * @param logTail - the sidecar's retained output lines, oldest first.
 * @returns a `data:text/html` URL rendering the failure and the log tail.
 */
export function errorPageUrl(failure: string, logTail: readonly string[]): string {
  const log = logTail.length > 0 ? logTail.join('\n') : '(no sidecar output)'
  const html = `<!doctype html><meta charset="utf-8"><title>dsh failed to start</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:3rem;max-width:60rem}
h1{font-size:1.2rem}pre{background:#f4f4f4;padding:1rem;overflow:auto;white-space:pre-wrap}</style>
<h1>dsh failed to start</h1><p>${escapeHtml(failure)}</p><pre>${escapeHtml(log)}</pre>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}
