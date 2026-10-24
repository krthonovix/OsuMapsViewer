import { sliderPath } from './slider';

export interface HitObject {
  x: number;
  y: number;
  time: number;
  endTime: number;
  kind: 'circle' | 'slider' | 'spinner';
  path?: Array<{ x: number; y: number }>;
  repeats?: number;
  tickIntervalMs?: number;
  combo: number;
}

export interface Beatmap {
  title: string;
  artist: string;
  creator: string;
  version: string;
  approachRate: number;
  circleSize: number;
  overallDifficulty: number;
  sliderTickRate: number;
  objects: HitObject[];
  maxObjectDuration: number;
  audioUrl: string | null;
  backgroundUrl: string | null;
}

interface TimingPoint { time: number; beatLength: number; sv: number }

export function parseBeatmap(source: string, audioUrl: string | null, backgroundUrl: string | null = null): Beatmap {
  const sections = new Map<string, string[]>();
  let section = '';
  for (const raw of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1);
      sections.set(section, []);
    } else if (section) {
      sections.get(section)?.push(line);
    }
  }
  const values = (name: string) => Object.fromEntries((sections.get(name) ?? []).map(line => {
    const colon = line.indexOf(':');
    return colon === -1 ? [line, ''] : [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
  }));
  const metadata = values('Metadata');
  const difficulty = values('Difficulty');
  const timing: TimingPoint[] = [];
  let currentBeatLength = 500;
  let currentSv = 1;
  for (const line of sections.get('TimingPoints') ?? []) {
    const fields = line.split(',');
    const time = Number(fields[0]);
    const beatLength = Number(fields[1]);
    if (!Number.isFinite(time) || !Number.isFinite(beatLength)) continue;
    if (fields[6] !== '0') {
      currentBeatLength = beatLength;
      currentSv = 1;
    } else if (beatLength < 0) {
      currentSv = Math.max(0.1, Math.min(10, -100 / beatLength));
    }
    timing.push({ time, beatLength: currentBeatLength, sv: currentSv });
  }
  const sliderMultiplier = Number(difficulty.SliderMultiplier) || 1.4;
  const objects: HitObject[] = [];
  let combo = 0;
  for (const line of sections.get('HitObjects') ?? []) {
    const fields = line.split(',');
    const [x, y, time, type] = fields.slice(0, 4).map(Number);
    if (![x, y, time, type].every(Number.isFinite)) continue;
    if (type & 4 || type & 8) combo = 0;
    combo++;
    if (type & 1) {
      objects.push({ x, y, time, endTime: time, kind: 'circle', combo });
    } else if (type & 2) {
      const repeats = Math.max(1, Number(fields[6]) || 1);
      const pixelLength = Number(fields[7]) || 0;
      const point = [...timing].reverse().find(item => item.time <= time) ?? { beatLength: 500, sv: 1 };
      const duration = Math.max(0, pixelLength * repeats * point.beatLength / (sliderMultiplier * 100 * point.sv));
      const parts = (fields[5] ?? '').split('|');
      const anchors = [{ x, y }, ...parts.slice(1).map(part => {
        const [px, py] = part.split(':').map(Number);
        return { x: px, y: py };
      }).filter(part => Number.isFinite(part.x) && Number.isFinite(part.y))];
      const path = sliderPath(parts[0], anchors, pixelLength);
      objects.push({ x, y, time, endTime: time + duration, kind: 'slider', path, repeats,
        tickIntervalMs: point.beatLength / ((Number(difficulty.SliderTickRate) || 1) * point.sv), combo });
    } else if (type & 8) {
      objects.push({ x: 256, y: 192, time, endTime: Number(fields[5]) || time, kind: 'spinner', combo });
    }
  }
  return {
    title: metadata.TitleUnicode || metadata.Title || 'Unknown beatmap',
    artist: metadata.ArtistUnicode || metadata.Artist || '',
    creator: metadata.Creator || '',
    version: metadata.Version || '',
    approachRate: Number(difficulty.ApproachRate ?? difficulty.OverallDifficulty) || 5,
    circleSize: Number(difficulty.CircleSize) || 4,
    overallDifficulty: Number(difficulty.OverallDifficulty ?? 5),
    sliderTickRate: Number(difficulty.SliderTickRate ?? 1) || 1,
    objects,
    maxObjectDuration: objects.reduce((max, object) => Math.max(max, object.endTime - object.time), 0),
    audioUrl,
    backgroundUrl,
  };
}
