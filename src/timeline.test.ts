import { describe, expect, it } from 'vitest';
import type { Beatmap } from './beatmap';
import type { Replay } from './replay';
import { buildTimeline, keyLanes, progressAt } from './timeline';

const map: Beatmap = {
  title: '', artist: '', creator: '', version: '', approachRate: 5, circleSize: 4,
  overallDifficulty: 5, sliderTickRate: 1, audioUrl: null, backgroundUrl: null, maxObjectDuration: 0,
  objects: [1000, 2000, 3000, 4000].map((time, index) => ({
    x: 100 + index * 90, y: 192, time, endTime: time, kind: 'circle', combo: index + 1,
  })),
};

const replay: Replay = {
  checksum: '', player: '', version: 0, score: 1200, maxCombo: 3, perfect: false,
  mods: 0, counts: { n300: 1, n100: 1, n50: 1, misses: 1 }, duration: 4300,
  frames: [
    { time: 950, x: 100, y: 192, keys: 0 }, { time: 1000, x: 100, y: 192, keys: 5 },
    { time: 1050, x: 100, y: 192, keys: 0 }, { time: 2060, x: 190, y: 192, keys: 10 },
    { time: 2100, x: 190, y: 192, keys: 0 }, { time: 3125, x: 280, y: 192, keys: 5 },
    { time: 3180, x: 280, y: 192, keys: 0 }, { time: 4300, x: 370, y: 192, keys: 0 },
  ],
};

describe('gameplay timeline', () => {
  it('merges the mouse aliases of keyboard presses', () => {
    expect(keyLanes(5)).toBe(1);
    expect(keyLanes(10)).toBe(2);
    expect(keyLanes(15)).toBe(3);
  });

  it('shows hit results and advances score, combo and accuracy when seeking', () => {
    const timeline = buildTimeline(replay, map, 0);
    expect(timeline.judgments.map(item => item.value)).toEqual([300, 100, 50, 0]);
    expect(progressAt(timeline, 500).score).toBe(0);
    expect(progressAt(timeline, 2500).counts).toMatchObject({ n300: 1, n100: 1, n50: 0, misses: 0 });
    expect(progressAt(timeline, 3500).combo).toBe(3);
    expect(progressAt(timeline, 4200)).toMatchObject({ score: 1200, combo: 0, counts: replay.counts });
  });
});
