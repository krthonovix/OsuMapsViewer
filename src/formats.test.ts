import { describe, expect, it } from 'vitest';
import { compress } from 'lzma-web';
import { parseReplay, accuracy } from './replay';
import { parseBeatmap } from './beatmap';
import { sliderPath, pointOnPath } from './slider';

function makeReplay(compressed: Uint8Array) {
  const parts: number[] = [];
  const u8 = (value: number) => parts.push(value & 255);
  const u16 = (value: number) => { u8(value); u8(value >> 8); };
  const u32 = (value: number) => { u16(value); u16(value >> 16); };
  const str = (value: string) => {
    const bytes = new TextEncoder().encode(value);
    u8(11); u8(bytes.length); parts.push(...bytes);
  };
  u8(0); u32(20240101);
  str('0123456789abcdef0123456789abcdef');
  str('player'); str('replay-hash');
  u16(2); u16(1); u16(0); u16(0); u16(0); u16(1);
  u32(123456); u16(3); u8(0); u32(16);
  str(''); parts.push(...Array(8).fill(0));
  u32(compressed.length); parts.push(...compressed);
  return new Uint8Array(parts);
}

describe('osu! formats', () => {
  it('reads a compressed standard replay and ignores its RNG seed frame', async () => {
    const compressed = await compress('0|256|192|0,16|260|193|5,-12345|0|0|123,16|270|200|0,');
    const replay = await parseReplay(makeReplay(compressed));
    expect(replay.player).toBe('player');
    expect(replay.frames).toHaveLength(3);
    expect(replay.frames[2]).toMatchObject({ time: 32, x: 270, keys: 0 });
    expect(accuracy(replay)).toBeCloseTo(58.3333, 3);
  });

  it('rejects other game modes', async () => {
    await expect(parseReplay(new Uint8Array([3, 0, 0, 0, 0]))).rejects.toThrow('osu!standard');
  });

  it('calculates slider duration from timing and inherited velocity', () => {
    const map = parseBeatmap(`osu file format v14
[Metadata]
Title:Test
Version:Hard
[Difficulty]
SliderMultiplier:1.4
ApproachRate:9
CircleSize:4
[TimingPoints]
0,500,4,2,0,100,1,0
1000,-50,4,2,0,100,0,0
[HitObjects]
256,192,1000,1,0,0:0:0:0:
100,100,1200,2,0,B|200:100,1,140
256,192,2000,8,0,3000
`, null);
    expect(map.objects).toHaveLength(3);
    expect(map.objects[1].endTime).toBe(1450);
    expect(map.objects[2].kind).toBe('spinner');
  });

  it('builds a curved slider with a stable endpoint and travel position', () => {
    const path = sliderPath('B', [{ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }], 100);
    expect(path.length).toBeGreaterThan(10);
    expect(path.at(-1)!.x).toBeGreaterThan(50);
    expect(pointOnPath(path, 0)).toEqual({ x: 0, y: 0 });
    expect(pointOnPath(path, 1)).toEqual(path.at(-1));
  });
});
