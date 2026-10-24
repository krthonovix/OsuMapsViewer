import { describe, expect, it } from 'vitest';
import type { Beatmap } from './beatmap';
import type { Replay } from './replay';
import { estimateReplaySync } from './sync';

function fixture(offset: number, hardRock: boolean): { map: Beatmap; replay: Replay } {
  const objects = Array.from({ length: 20 }, (_, i) => ({
    x: 64 + i % 5 * 90,
    y: 55 + Math.floor(i / 5) * 85,
    time: 1000 + i * 430,
    endTime: 1000 + i * 430,
    kind: 'circle' as const,
    combo: i + 1,
  }));
  const frames = objects.flatMap((object, i) => [
    { time: object.time + offset - 40, x: object.x, y: hardRock ? 384 - object.y : object.y, keys: 0 },
    { time: object.time + offset + (i % 3 - 1) * 8, x: object.x, y: hardRock ? 384 - object.y : object.y, keys: 1 },
  ]);
  return {
    map: { title: '', artist: '', creator: '', version: '', approachRate: 8, circleSize: 4, overallDifficulty: 8, sliderTickRate: 1,
      objects, maxObjectDuration: 0, audioUrl: null, backgroundUrl: null },
    replay: { checksum: '', player: '', version: 0, score: 0, maxCombo: 0, perfect: true,
      mods: hardRock ? 16 : 0, counts: { n300: 0, n100: 0, n50: 0, misses: 0 },
      frames, duration: frames.at(-1)!.time },
  };
}

describe('replay synchronization', () => {
  it('finds the gameplay lead-in from hit inputs', () => {
    const { map, replay } = fixture(1713, false);
    expect(estimateReplaySync(replay, map)).toEqual({ offsetMs: 1713, matchedObjects: 20, confidence: 'high' });
  });

  it('compares Hard Rock objects with replay screen coordinates', () => {
    const { map, replay } = fixture(1713, true);
    expect(estimateReplaySync(replay, map)).toEqual({ offsetMs: 1713, matchedObjects: 20, confidence: 'high' });
  });
});
