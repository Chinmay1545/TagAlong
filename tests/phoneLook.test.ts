import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

describe('phone look', () => {
  it('index.html installs as a full-screen home-screen app', () => {
    const html = read('index.html')
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"')
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/icon-180.png"')
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes"')
    expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"')
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="This &amp; That"')
    expect(html).toContain('<meta name="theme-color" content="#09090b"')
    expect(html).toMatch(/name="viewport"[^>]*viewport-fit=cover/)
  })

  it('the manifest opens full screen on the page it was added from, in our colours', () => {
    const m = JSON.parse(read('public/manifest.webmanifest'))
    expect(m).toMatchObject({ name: 'THIS & THAT', short_name: 'This & That', display: 'standalone', background_color: '#09090b', theme_color: '#09090b', scope: '/' })
    // no start_url: the icon opens the page it was added from, so a class link opens that class
    expect(m.start_url).toBeUndefined()
    const sizes = m.icons.map((i: { sizes: string }) => i.sizes)
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']))
    for (const i of m.icons) expect(() => read(`public${i.src}`)).not.toThrow()
    expect(() => read('public/icons/icon-180.png')).not.toThrow()
  })

  it('phone.css turns motion off, avoids pure black, keeps buttons big', () => {
    const css = read('src/phone/phone.css')
    expect(css).toContain('prefers-reduced-motion: reduce')
    for (const f of [css, read('src/ui/judge.css')]) expect(f.toLowerCase()).not.toMatch(/#000000|#000\b/)
    const btn = css.match(/\.p-btn\s*\{[^}]*min-height:\s*(\d+)px/)
    expect(btn).toBeTruthy()
    expect(Number(btn![1])).toBeGreaterThanOrEqual(56)
  })
})
