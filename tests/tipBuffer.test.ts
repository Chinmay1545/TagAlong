import { describe, it, expect } from 'vitest';
import { TipBuffer } from '../src/core/tipBuffer';
import { TIP_BUFFER_MS } from '../src/core/config';

describe('TipBuffer', () => {
  it('defaults keepMs to TIP_BUFFER_MS', () => {
    const b = new TipBuffer();
    b.push({ t: 0, x: 0, y: 0 });
    b.push({ t: TIP_BUFFER_MS + 1, x: 0, y: 0 });
    expect(b.all().map((s) => s.t)).toEqual([TIP_BUFFER_MS + 1]);
  });

  it('drops samples older than newest t minus keepMs', () => {
    const b = new TipBuffer(3000);
    b.push({ t: 0, x: 0.1, y: 0.1 });
    b.push({ t: 1000, x: 0.2, y: 0.2 });
    b.push({ t: 2000, x: 0.3, y: 0.3 });
    b.push({ t: 3500, x: 0.4, y: 0.4 });
    expect(b.all().map((s) => s.t)).toEqual([1000, 2000, 3500]);
    expect(b.lastAt()).toBe(3500);
  });

  it('window is inclusive on both ends', () => {
    const b = new TipBuffer(3000);
    b.push({ t: 0, x: 0, y: 0 });
    b.push({ t: 1000, x: 0, y: 0 });
    b.push({ t: 2000, x: 0, y: 0 });
    b.push({ t: 3500, x: 0, y: 0 });
    expect(b.window(900, 2100).map((s) => s.t)).toEqual([1000, 2000]);
    expect(b.window(1000, 2000).map((s) => s.t)).toEqual([1000, 2000]);
  });

  it('lastAt is null when empty', () => {
    expect(new TipBuffer().lastAt()).toBeNull();
  });

  it('keeps the kind of each point and still accepts a plain fingertip sample', () => {
    const b = new TipBuffer();
    b.push({ t: 0, x: 0.1, y: 0.1 });
    b.push({ kind: 'laser', t: 10, x: 0.2, y: 0.2, confidence: 0.9 });
    expect(b.all()).toEqual([{ t: 0, x: 0.1, y: 0.1 }, { kind: 'laser', t: 10, x: 0.2, y: 0.2, confidence: 0.9 }]);
  });

  it('lead gives only the winning kind in the window', () => {
    const b = new TipBuffer();
    for (const t of [0, 30, 60, 90]) {
      b.push({ kind: 'finger', t, x: 0.1, y: 0.1, confidence: 1 });
      b.push({ kind: 'laser', t: t + 1, x: 0.8, y: 0.8, confidence: 1 });
    }
    expect(b.lead(0, 100).map((s) => s.x)).toEqual([0.8, 0.8, 0.8, 0.8]);
    expect(b.window(0, 100)).toHaveLength(8);
  });

  it('lastCoverAt: the last time a finger or stick was seen, ignoring laser and mouse', () => {
    const b = new TipBuffer();
    expect(b.lastCoverAt()).toBeNull();
    b.push({ kind: 'laser', t: 5, x: 0, y: 0, confidence: 1 });
    expect(b.lastCoverAt()).toBeNull();
    b.push({ t: 10, x: 0, y: 0 });
    b.push({ kind: 'stick', t: 20, x: 0, y: 0, confidence: 1 });
    b.push({ kind: 'laser', t: 30, x: 0, y: 0, confidence: 1 });
    b.push({ kind: 'mouse', t: 40, x: 0, y: 0, confidence: 1 });
    expect(b.lastCoverAt()).toBe(20);
    expect(b.lastAt()).toBe(40);
  });
});
