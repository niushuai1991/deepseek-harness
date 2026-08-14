# @deepseek-ai/dsh-desktop

The desktop shell for the dsh web app: an Electron window over a loopback `dsh web` sidecar. The shell adds no product surface of its own — the renderer is the ordinary web SPA.

## How it runs

`src/main.ts` holds the single-instance lock, spawns the bundled production dsh CLI (`--profile web --port 0`) under the bundled standalone Node binary, awaits the `dsh web: http://127.0.0.1:<port>` ready line on stdout, and loads that origin. The window keeps the Electron sandbox on (`contextIsolation`, `nodeIntegration: false`, `sandbox: true`) and hands every off-origin navigation to the OS browser; the web app's loopback trust fence is untouched. Teardown kills the sidecar process tree — a POSIX process group (`SIGTERM`, then `SIGKILL`) or Windows `taskkill /T /F` — so no harness subprocess survives the window.

| Path | Role |
| --- | --- |
| `src/handshake.ts` | Ready-line extraction from chunked stdout. |
| `src/sidecar.ts` | Spawn plan, readiness handshake, log tail, teardown. |
| `src/process-tree.ts` | Platform teardown planning. |
| `src/paths.ts` | Packaged `extraResources` layout vs. development env overrides. |
| `src/error-page.ts` | Local `data:` failure page. |
| `scripts/assemble-staging.mjs` | Staging assembly: the dsh production closure plus the standalone Node binary. |
| `scripts/dev.mjs` | Development launch against the source-built CLI and SPA dist. |

## Development

```sh
pnpm run build                      # repo root: packages + apps/web dist
pnpm --dir apps/desktop run dev     # Electron over the source-built sidecar
```

Unit tests live in `tests/` and run through the repo root `pnpm run test`.

## Packaging

```sh
pnpm --dir apps/desktop run package
```

Assembles `staging/` and runs electron-builder. Staging holds a plain-Node production install of the sidecar closure (`pnpm deploy` of the generated [`deploy-root`](deploy-root/package.json) manifest — rerun `scripts/generate-deploy-root.mjs` after changing the booted profiles; the SPA dist arrives through `@deepseek-ai/dsh-web-frontend`) and the standalone Node binary of the repository's engines line, downloaded from a mirror. `scripts/smoke-sidecar.sh` boots the staged sidecar headlessly (ready line, index fetch, `/api` route mount, teardown); `scripts/verify-shell.sh` launches the packaged shell and asserts the sidecar's lifecycle. CI builds the installers per platform (Windows NSIS, Linux AppImage and deb) from the same staging script.
