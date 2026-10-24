import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zipSync } from 'fflate';

const source = `osu file format v14
[General]
AudioFilename: test.wav
Mode: 0
[Events]
0,0,"bg.png",0,0
[Metadata]
Title:Smoke Test
Artist:Local
Creator:Viewer
Version:Normal
[Difficulty]
ApproachRate:5
CircleSize:4
[TimingPoints]
0,500,4,2,0,100,1,0
[HitObjects]
256,192,1000,1,0,0:0:0:0:
`;
const osu = new TextEncoder().encode(source);
const checksum = createHash('md5').update(osu).digest('hex');
const folder = resolve('maps');
const createdFolder = !existsSync(folder);
if (createdFolder) mkdirSync(folder);
const target = resolve(folder, `${checksum}.osz`);
// Empty WAV header is enough to exercise resource delivery; it is not playable audio.
const wav = new Uint8Array(44);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlLDVMAAAAASUVORK5CYII=', 'base64');
const archive = zipSync({ 'Normal.osu': osu, 'test.wav': wav, 'bg.png': png });
writeFileSync(target, archive);
try {
  const response = await fetch(`http://127.0.0.1:3001/api/maps/${checksum}/manifest`);
  assert.equal(response.status, 200);
  const manifest = await response.json();
  assert.equal(manifest.title, 'Smoke Test');
  assert.ok(manifest.audioUrl);
  assert.ok(manifest.backgroundUrl);
  const map = await fetch(`http://127.0.0.1:3001${manifest.osuUrl}`);
  assert.equal(map.status, 200);
  assert.equal(await map.text(), source);
  const audio = await fetch(`http://127.0.0.1:3001${manifest.audioUrl}`);
  assert.equal(audio.status, 200);
  const range = await fetch(`http://127.0.0.1:3001${manifest.audioUrl}`, { headers: { range: 'bytes=0-15' } });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 16);
  const background = await fetch(`http://127.0.0.1:3001${manifest.backgroundUrl}`);
  assert.equal(background.status, 200);
  assert.equal(background.headers.get('content-type'), 'image/png');
  console.log('Smoke local: manifest, checksum, .osu, audio, fondo y rango correctos');
} finally {
  unlinkSync(target);
  if (createdFolder) rmdirSync(folder);
}
