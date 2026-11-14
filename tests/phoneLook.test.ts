import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

describe('phone look', () => {
  it('index.html installs as a home-screen app', () => {
    const html = read('index.html')
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes"')
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="This &amp; That"')
    expect(html).toContain('<meta name="theme-color" content="#09090b"')
    expect(html).toMatch(/name="viewport"[^>]*viewport-fit=cover/)
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
