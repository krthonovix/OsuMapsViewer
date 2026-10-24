import type { Beatmap } from './beatmap';
import type { Replay } from './replay';

export interface ReplaySync {
  offsetMs: number;
  matchedObjects: number;
  confidence: 'high' | 'low';
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
}

/**
 * Stable .osr frame times can include a gameplay lead-in that is absent from
 * the .osu audio/object timeline. Match input edges to hit-object heads in
 * both time and space instead of assuming a universal fixed offset.
 */
export function estimateReplaySync(replay: Replay, map: Beatmap): ReplaySync {
  const hr = Boolean(replay.mods & 16);
  const objects = map.objects.filter(object => object.kind !== 'spinner').slice(0, 500);
  const presses = replay.frames.filter((frame, index, frames) =>
    index > 0 && Boolean((frame.keys & 15) & ~(frames[index - 1].keys & 15))
  ).slice(0, 1000);
  if (objects.length < 3 || presses.length < 3) return { offsetMs: 0, matchedObjects: 0, confidence: 'low' };

  const binSize = 20;
  const bins = new Map<number, number>();
  const tolerance = Math.max(45, Math.min(80, 54.4 - 4.48 * map.circleSize + 18));
  for (const object of objects) {
    const screenY = hr ? 384 - object.y : object.y;
    for (const press of presses) {
      const difference = press.time - object.time;
      if (difference < -10_000 || difference > 20_000) continue;
      const distance = Math.hypot(press.x - object.x, press.y - screenY);
      if (distance > tolerance) continue;
      const bin = Math.round(difference / binSize);
      bins.set(bin, (bins.get(bin) ?? 0) + 1 - distance / (tolerance * 2));
    }
  }
  if (!bins.size) return { offsetMs: 0, matchedObjects: 0, confidence: 'low' };
  let peak = 0, peakWeight = -1;
  for (const bin of bins.keys()) {
    let weight = 0;
    for (let neighbor = -3; neighbor <= 3; neighbor++) {
      weight += (bins.get(bin + neighbor) ?? 0) * (4 - Math.abs(neighbor));
    }
    if (weight > peakWeight) { peakWeight = weight; peak = bin * binSize; }
  }
  const differences: number[] = [];
  for (const object of objects) {
    const screenY = hr ? 384 - object.y : object.y;
    let best: { diff: number; error: number } | null = null;
    for (const press of presses) {
      const diff = press.time - object.time;
      const error = Math.abs(diff - peak);
      if (error > 120) continue;
      if (Math.hypot(press.x - object.x, press.y - screenY) > tolerance) continue;
      if (!best || error < best.error) best = { diff, error };
    }
    if (best) differences.push(best.diff);
  }
  const minimum = Math.max(4, Math.ceil(objects.length * 0.08));
  if (differences.length < minimum) return { offsetMs: 0, matchedObjects: differences.length, confidence: 'low' };
  const offsetMs = Math.round(median(differences));
  return {
    offsetMs,
    matchedObjects: differences.length,
    confidence: differences.length >= Math.max(8, objects.length * 0.25) ? 'high' : 'low',
  };
}
