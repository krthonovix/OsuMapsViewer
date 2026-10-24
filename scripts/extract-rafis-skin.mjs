import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';

const archive = process.argv[2];
if (!archive || !existsSync(archive)) {
  console.error('Usage: node scripts/extract-rafis-skin.mjs "Rafis +HDDT.osk"');
  process.exit(1);
}
const chosen = [
  'skin.ini', 'hitcircle.png', 'hitcircleoverlay.png', 'approachcircle.png',
  'sliderstartcircle.png', 'sliderb.png', 'sliderfollowcircle.png',
  'cursor.png', 'cursortrail.png', 'hit0.png', 'hit100.png', 'hit50.png',
  'hit300.png', 'inputoverlay-key.png',
  ...Array.from({ length: 10 }, (_, i) => `default-${i}.png`),
];
const selected = new Set(chosen);
const files = unzipSync(readFileSync(archive), { filter: entry => selected.has(entry.name) });
const missing = chosen.filter(name => !(name in files));
if (missing.length) throw new Error(`Missing sprites: ${missing.join(', ')}`);
const output = resolve('public/skins/rafis-hddt');
mkdirSync(output, { recursive: true });
for (const name of chosen) {
  const bytes = name === 'skin.ini'
    ? Buffer.from(Buffer.from(files[name]).toString('utf8').replace(/[ \t]+(?=\r?$)/gm, ''))
    : files[name];
  writeFileSync(resolve(output, name), bytes);
}
console.log(`Extracted ${chosen.length} files from ${archive} to ${output}`);
