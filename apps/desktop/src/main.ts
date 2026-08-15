/**
 * Electron main entry for the dsh desktop shell: single-instance lock, the
 * `dsh web` sidecar, the loopback window, and teardown on quit.
 *
 * The renderer is the ordinary web SPA served by the sidecar — the shell adds
 * no page of its own beyond the failure page. The window keeps
 * `contextIsolation` and the sandbox on, refuses every navigation off the
 * sidecar's loopback origin, and hands such URLs to the OS browser instead.
 * Every sidecar output chunk is mirrored to `sidecar.log` under the user data
 * directory so a machine that never reaches the ready line is diagnosable
 * from that file alone.
 * @module @deepseek-ai/dsh-desktop/main
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, shell } from 'electron'
import { errorPageUrl } from './error-page.ts'
import { resolveSidecarPaths } from './paths.ts'
import { Sidecar } from './sidecar.ts'

const userDataDir = app.getPath('userData')
mkdirSync(userDataDir, { recursive: true })
/** Mirrored sidecar output for diagnosing launches that never reach ready. */
const sidecarLogPath = join(userDataDir, 'sidecar.log')

const sidecar = new Sidecar({
  paths: resolveSidecarPaths({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, env: process.env }),
  onOutput: (chunk) => {
    try {
      appendFileSync(sidecarLogPath, chunk)
    } catch {
      // The user data dir vanished mid-session; the in-memory tail still
      // carries the most recent output for the failure dialog.
    }
  },
})

let mainWindow: BrowserWindow | undefined

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === undefined) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  void app.whenReady().then(boot)
  app.on('window-all-closed', () => {
    app.quit()
  })
  app.on('will-quit', () => {
    sidecar.stop()
  })
}

/** Start the sidecar, then open the window on its loopback origin. */
async function boot(): Promise<void> {
  try {
    appendFileSync(sidecarLogPath, '\n--- launch ---\n')
    const origin = await sidecar.start()
    mainWindow = createWindow(origin.toString())
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error)
    const choice = await dialog.showMessageBox({
      type: 'error',
      title: 'dsh failed to start',
      message: 'dsh failed to start',
      detail: `${failure}\n\nFull sidecar log: ${sidecarLogPath}\n\nThe first launch can be slow while antivirus scans the freshly installed files; retry once it settles.`,
      buttons: ['Retry', 'Quit'],
      defaultId: 0,
      cancelId: 1,
    })
    if (choice.response === 0) await boot()
    else app.quit()
  }
}

/**
 * Create the shell window bound to one allowed origin.
 * @param origin - the sidecar's loopback origin, or the failure page's `data:` URL.
 * @returns the shown window.
 */
function createWindow(origin: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 600,
    autoHideMenuBar: true,
    title: 'DeepSeek Harness',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.once('ready-to-show', () => {
    window.show()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin === new URL(origin).origin) return
    event.preventDefault()
    void shell.openExternal(url)
  })
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return
    window.loadURL(errorPageUrl(`the page failed to load: ${errorDescription} (${String(errorCode)}) for ${validatedURL}`, sidecar.recentLog())).catch(
      () => {
        // data: URL loads cannot fail; Electron rejected the URL itself.
      },
    )
  })
  void window.loadURL(origin)
  return window
}
