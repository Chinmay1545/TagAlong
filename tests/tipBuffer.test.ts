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
});
