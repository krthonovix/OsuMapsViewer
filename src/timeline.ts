import type { Beatmap, HitObject } from './beatmap';
import type { Replay, ReplayFrame } from './replay';

export type Judgment = 300 | 100 | 50 | 0;
export type Counts = Replay['counts'];
export interface JudgmentEvent {
  time: number;
  x: number;
  y: number;
  value: Judgment;
  objectIndex: number;
}
export interface Progress {
  time: number;
  score: number;
  combo: number;
  accuracy: number;
  counts: Counts;
}
export interface Timeline {
  judgments: JudgmentEvent[];
  progress: Progress[];
}

/** K1 and K2 in an .osr also set the M1 and M2 bits. */
export function keyLanes(keys: number) {
  return (keys & 5 ? 1 : 0) | (keys & 10 ? 2 : 0);
}

function frameAt(frames: ReplayFrame[], time: number) {
  let low = 0, high = frames.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (frames[mid].time <= time) low = mid;
    else high = mid - 1;
  }
  return frames[low];
}

function radiusFor(map: Beatmap, replay: Replay) {
  const cs = Math.min(10, Math.max(0, replay.mods & 16 ? map.circleSize * 1.3 : replay.mods & 2 ? map.circleSize / 2 : map.circleSize));
  return 54.4 - 4.48 * cs;
}

function screenY(y: number, replay: Replay) { return replay.mods & 16 ? 384 - y : y; }

function sliderPosition(object: HitObject, fraction: number) {
  const path = object.path ?? [{ x: object.x, y: object.y }];
  const scaled = Math.max(0, Math.min(1, fraction)) * (path.length - 1);
  const index = Math.floor(scaled);
  const next = path[Math.min(path.length - 1, index + 1)];
  const current = path[index];
  return { x: current.x + (next.x - current.x) * (scaled - index), y: current.y + (next.y - current.y) * (scaled - index) };
}

function sliderParts(object: HitObject) {
  const parts: Array<{ time: number; x: number; y: number; weight: number }> = [];
  const repeats = Math.max(1, object.repeats ?? 1);
  const span = Math.max(1, (object.endTime - object.time) / repeats);
  const interval = object.tickIntervalMs ?? span + 1;
  for (let repeat = 0; repeat < repeats; repeat++) {
    for (let elapsed = interval; elapsed < span - 36 && parts.length < 200; elapsed += interval) {
      const position = sliderPosition(object, repeat % 2 ? 1 - elapsed / span : elapsed / span);
      parts.push({ time: object.time + repeat * span + elapsed, ...position, weight: 10 });
    }
    const position = sliderPosition(object, repeat % 2 ? 0 : 1);
    parts.push({ time: object.time + (repeat + 1) * span, ...position, weight: 30 });
  }
  return parts;
}

function nearHeld(replay: Replay, offset: number, time: number, x: number, y: number, distance: number) {
  const frame = frameAt(replay.frames, time + offset);
  return keyLanes(frame.keys) !== 0 && Math.hypot(frame.x - x, frame.y - screenY(y, replay)) <= distance;
}

function spinnerQuality(replay: Replay, offset: number, object: HitObject, od: number) {
  let turns = 0;
  let previous: number | null = null;
  for (const frame of replay.frames) {
    const time = frame.time - offset;
    if (time < object.time || time > object.endTime) continue;
    if (!keyLanes(frame.keys) || Math.hypot(frame.x - 256, frame.y - 192) < 24) { previous = null; continue; }
    const angle = Math.atan2(frame.y - 192, frame.x - 256);
    if (previous !== null) {
      let delta = angle - previous;
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      turns += Math.abs(delta) / (2 * Math.PI);
    }
    previous = angle;
  }
  const required = (object.endTime - object.time) / 1000 * (od < 5 ? 1.5 + .2 * od : 1.25 + .25 * od) + .5;
  return Math.min(1, turns / Math.max(.1, required));
}

interface Candidate {
  object: HitObject;
  index: number;
  quality: number;
  pressTime: number | null;
  parts: Array<{ time: number; x: number; y: number; weight: number; hit: boolean }>;
  value: Judgment;
}

/** Reconstructs likely per-object results. The .osr stores final counts, not each judgement. */
export function buildTimeline(replay: Replay, map: Beatmap, offset: number): Timeline {
  const targetTotal = replay.counts.n300 + replay.counts.n100 + replay.counts.n50 + replay.counts.misses;
  const objects = map.objects.slice(0, targetTotal || map.objects.length);
  const radius = radiusFor(map, replay);
  const od = Math.min(10, Math.max(0, replay.mods & 16 ? map.overallDifficulty * 1.4 : replay.mods & 2 ? map.overallDifficulty / 2 : map.overallDifficulty));
  const window300 = 80 - 6 * od;
  const window100 = 140 - 8 * od;
  const window50 = 200 - 10 * od;
  const presses: Array<{ time: number; x: number; y: number; used: boolean }> = [];
  let previous = 0;
  for (const frame of replay.frames) {
    const lanes = keyLanes(frame.keys);
    for (const lane of [1, 2]) {
      if (lanes & lane && !(previous & lane)) presses.push({ time: frame.time - offset, x: frame.x, y: frame.y, used: false });
    }
    previous = lanes;
  }

  const candidates: Candidate[] = objects.map((object, index) => {
    if (object.kind === 'spinner') {
      return { object, index, quality: spinnerQuality(replay, offset, object, od), pressTime: null, parts: [], value: 300 };
    }
    let best: typeof presses[number] | null = null;
    let bestCost = Infinity;
    let low = 0, high = presses.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (presses[mid].time < object.time - window50) low = mid + 1;
      else high = mid;
    }
    for (let pressIndex = low; pressIndex < presses.length && presses[pressIndex].time <= object.time + window50; pressIndex++) {
      const press = presses[pressIndex];
      if (press.used) continue;
      const distance = Math.hypot(press.x - object.x, press.y - screenY(object.y, replay));
      if (distance > radius * 1.2) continue;
      const cost = Math.abs(press.time - object.time) + distance * .15;
      if (cost < bestCost) { best = press; bestCost = cost; }
    }
    if (best) best.used = true;
    const timing = best ? Math.abs(best.time - object.time) : window50 + 1;
    if (object.kind === 'circle') {
      const quality = !best ? 0 : timing <= window300 ? 1 - timing / (window300 * 10)
        : .45 - (timing - window300) / (window50 - window300) * .25;
      return { object, index, quality, pressTime: best?.time ?? null, parts: [], value: 300 };
    }
    const parts = sliderParts(object).map(part => ({
      ...part, hit: nearHeld(replay, offset, part.time, part.x, part.y, radius * 2.4),
    }));
    const hitParts = (best ? 1 : 0) + parts.filter(part => part.hit).length;
    const quality = best ? .65 + .35 * hitParts / (parts.length + 1) : .15 * hitParts / (parts.length + 1);
    return { object, index, quality, pressTime: best?.time ?? null, parts, value: 300 };
  });

  // Preserve the exact result totals stored in the replay. Place lower judgements
  // on the objects whose reconstructed timing and slider tracking fit them best.
  const ranked = [...candidates].sort((a, b) => a.quality - b.quality || a.index - b.index);
  let position = 0;
  for (const [count, value] of [
    [replay.counts.misses, 0], [replay.counts.n50, 50], [replay.counts.n100, 100],
  ] as Array<[number, Judgment]>) {
    for (let i = 0; i < count && position < ranked.length; i++) ranked[position++].value = value;
  }

  type Step = { time: number; order: number; combo: 'hit' | 'break' | null; judgment?: JudgmentEvent; weight: number; suspect?: number; sliderPart?: boolean };
  const steps: Step[] = [];
  const judgments: JudgmentEvent[] = [];
  for (const candidate of candidates) {
    const { object, index, value, pressTime, parts } = candidate;
    const resultTime = object.kind === 'circle' ? pressTime ?? object.time + window50 : object.endTime;
    const point = object.kind === 'spinner' ? { x: 256, y: 192 } : object.kind === 'slider'
      ? sliderPosition(object, (object.repeats ?? 1) % 2 ? 1 : 0) : object;
    const judgment = { time: resultTime, x: point.x, y: screenY(point.y, replay), value, objectIndex: index };
    judgments.push(judgment);
    if (object.kind === 'slider') {
      const complete = value === 300;
      const headHit = complete || pressTime !== null;
      steps.push({ time: pressTime ?? object.time + window50, order: 0, combo: headHit ? 'hit' : 'break', weight: headHit ? 30 : 0,
        suspect: pressTime === null ? 2 : 0, sliderPart: true });
      for (const part of parts) {
        const hit = complete || part.hit;
        steps.push({ time: part.time, order: 1, combo: hit ? 'hit' : 'break', weight: hit ? part.weight : 0,
          suspect: part.hit ? 0 : 1, sliderPart: true });
      }
      steps.push({ time: resultTime, order: 3, combo: null, judgment, weight: value });
    } else {
      steps.push({ time: resultTime, order: 2, combo: value ? 'hit' : 'break', judgment, weight: value });
    }
  }
  steps.sort((a, b) => a.time - b.time || a.order - b.order);
  judgments.sort((a, b) => a.time - b.time);
  // The replay stores the maximum combo, but no per-part combo history. If
  // uncertain slider tracking would otherwise exceed that known maximum,
  // place a likely slider break near a compatible point in the run.
  if (replay.maxCombo > 0) {
    for (let attempt = 0; attempt < 8; attempt++) {
      let run: number[] = [];
      let longest: number[] = [];
      for (let i = 0; i <= steps.length; i++) {
        if (i < steps.length && steps[i].combo === 'hit') run.push(i);
        else if (i === steps.length || steps[i].combo === 'break') {
          if (run.length > longest.length) longest = run;
          run = [];
        }
      }
      if (longest.length <= replay.maxCombo) break;
      const target = replay.maxCombo;
      const anchors = [longest.length - target - 1, target].filter(value => value >= 0 && value < longest.length);
      const options = longest.map((stepIndex, position) => ({ stepIndex, position, step: steps[stepIndex] }))
        .filter(item => item.step.sliderPart);
      if (!options.length) break;
      options.sort((a, b) => {
        const cost = (item: typeof a) => Math.min(...anchors.map(anchor => Math.abs(item.position - anchor))) * 2 - (item.step.suspect ?? 0) * 3;
        return cost(a) - cost(b);
      });
      steps[options[0].stepIndex].combo = 'break';
      steps[options[0].stepIndex].weight = 0;
    }
  }
  const totalWeight = steps.reduce((sum, step) => sum + step.weight, 0);
  const progress: Progress[] = [];
  const counts: Counts = { n300: 0, n100: 0, n50: 0, misses: 0 };
  let combo = 0, weighted = 0;
  for (const step of steps) {
    if (step.combo === 'break') combo = 0;
    if (step.combo === 'hit') combo++;
    if (step.judgment) {
      if (step.judgment.value === 300) counts.n300++;
      else if (step.judgment.value === 100) counts.n100++;
      else if (step.judgment.value === 50) counts.n50++;
      else counts.misses++;
    }
    weighted += step.weight;
    const total = counts.n300 + counts.n100 + counts.n50 + counts.misses;
    progress.push({ time: step.time, combo, score: totalWeight ? Math.round(replay.score * weighted / totalWeight) : 0,
      accuracy: total ? (counts.n300 * 300 + counts.n100 * 100 + counts.n50 * 50) / (total * 3) : 100,
      counts: { ...counts } });
  }
  return { judgments, progress };
}

export function progressAt(timeline: Timeline, time: number): Progress {
  const events = timeline.progress;
  if (!events.length || time < events[0].time) return { time, score: 0, combo: 0, accuracy: 100, counts: { n300: 0, n100: 0, n50: 0, misses: 0 } };
  let low = 0, high = events.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (events[mid].time <= time) low = mid;
    else high = mid - 1;
  }
  return events[low];
}
