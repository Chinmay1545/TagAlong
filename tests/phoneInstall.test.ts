import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

describe('home-screen install', () => {
  it('index.html installs as a full-screen home-screen app', () => {
    const html = read('index.html')
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"')
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/icon-180.png"')
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/icons/icon.svg"')
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes"')
    expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"')
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="TagAlong"')
    expect(html).toContain('<meta name="theme-color" content="#09090b"')
    expect(html).toMatch(/name="viewport"[^>]*viewport-fit=cover/)
  })

  it('the manifest opens the saved-classes screen in our colours', () => {
    const m = JSON.parse(read('public/manifest.webmanifest'))
    expect(m).toMatchObject({ name: 'TagAlong', short_name: 'TagAlong', display: 'standalone', background_color: '#09090b', theme_color: '#09090b', scope: '/', start_url: '/?classes' })
    const sizes = m.icons.map((i: { sizes: string }) => i.sizes)
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']))
    for (const i of m.icons) expect(() => read(`public${i.src}`)).not.toThrow()
    expect(() => read('public/icons/icon-180.png')).not.toThrow()
    expect(() => read('public/icons/icon.svg')).not.toThrow()
  })
})
