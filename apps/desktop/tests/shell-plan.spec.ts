import { describe, expect, it } from 'vitest'
import { errorPageUrl } from '../src/error-page.ts'
import { DEV_BIN_ENV, DEV_NODE_ENV, resolveSidecarPaths } from '../src/paths.ts'
import { planSidecarSpawn } from '../src/sidecar.ts'

describe('resolveSidecarPaths', () => {
  it('reads the fixed extraResources layout when packaged', () => {
    expect(resolveSidecarPaths({ packaged: true, resourcesPath: '/r', env: {} })).toEqual({
      nodeBin: '/r/node/bin/node',
      dshBin: '/r/app/node_modules/@deepseek-ai/dsh/lib/bin.js',
    })
  })

  it('fails loud without the development environment', () => {
    expect(() => resolveSidecarPaths({ packaged: false, resourcesPath: '/r', env: {} }))
      .toThrow(new RegExp(`${DEV_NODE_ENV} and ${DEV_BIN_ENV}`))
  })

  it('takes the development launch from the environment', () => {
    expect(resolveSidecarPaths({
      packaged: false,
      resourcesPath: '/r',
      env: { [DEV_NODE_ENV]: '/usr/bin/node', [DEV_BIN_ENV]: '/repo/apps/cli/lib/bin.js' },
    })).toEqual({ nodeBin: '/usr/bin/node', dshBin: '/repo/apps/cli/lib/bin.js' })
  })
})

describe('planSidecarSpawn', () => {
  it('launches the CLI entry with the web profile and an OS-picked port', () => {
    expect(planSidecarSpawn({ nodeBin: '/n', dshBin: '/b.js' })).toEqual({
      file: '/n',
      args: ['/b.js', '--profile', 'web', '--port', '0'],
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  })
})

describe('errorPageUrl', () => {
  it('embeds the failure and the log tail with markup escaped', () => {
    const url = errorPageUrl('<boom> & gone', ['log <b>line</b>'])
    expect(url.startsWith('data:text/html;charset=utf-8,')).toBe(true)
    const html = decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length))
    expect(html).toContain('&lt;boom&gt; &amp; gone')
    expect(html).toContain('log &lt;b&gt;line&lt;/b&gt;')
  })

  it('notes the absence of output', () => {
    const html = decodeURIComponent(errorPageUrl('x', []).slice('data:text/html;charset=utf-8,'.length))
    expect(html).toContain('(no sidecar output)')
  })
})
