import { readFileSync } from 'node:fs';
import { parseReplay, accuracy, modNames } from '../src/replay';

const path = process.argv[2];
if (!path) {
  console.error('Usage: npm run inspect:replay -- path/to/replay.osr');
  process.exit(1);
}
const replay = await parseReplay(readFileSync(path));
console.log(JSON.stringify({
  player: replay.player,
  checksum: replay.checksum,
  frames: replay.frames.length,
  durationMs: replay.duration,
  mods: modNames(replay.mods),
  score: replay.score,
  accuracy: accuracy(replay),
  counts: replay.counts,
  maxCombo: replay.maxCombo,
}, null, 2));
