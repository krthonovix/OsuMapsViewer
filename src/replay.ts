import { createWorkerLZMA } from 'lzma-web/worker';
import { decompress } from 'lzma-web';

export interface ReplayFrame {
  time: number;
  x: number;
  y: number;
  keys: number;
}

export interface Replay {
  checksum: string;
  player: string;
  version: number;
  score: number;
  maxCombo: number;
  perfect: boolean;
  mods: number;
  counts: { n300: number; n100: number; n50: number; misses: number };
  frames: ReplayFrame[];
  duration: number;
  life?: Array<{ time: number; value: number }>;
}

class Reader {
  private pos = 0;
  private view: DataView;
  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  private need(length: number) {
    if (this.pos + length > this.bytes.length) throw new Error('El archivo .osr está incompleto o dañado.');
  }
  u8() { this.need(1); return this.view.getUint8(this.pos++); }
  u16() { this.need(2); const n = this.view.getUint16(this.pos, true); this.pos += 2; return n; }
  u32() { this.need(4); const n = this.view.getUint32(this.pos, true); this.pos += 4; return n; }
  skip(length: number) { this.need(length); this.pos += length; }
  string() {
    const marker = this.u8();
    if (marker === 0) return '';
    if (marker !== 11) throw new Error('El archivo .osr contiene una cadena inválida.');
    let length = 0;
    let shift = 0;
    for (let i = 0; i < 5; i++) {
      const byte = this.u8();
      length += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) {
        if (length > 1_000_000) throw new Error('El archivo .osr supera el tamaño permitido.');
        this.need(length);
        const result = new TextDecoder().decode(this.bytes.subarray(this.pos, this.pos + length));
        this.pos += length;
        return result;
      }
      shift += 7;
    }
    throw new Error('El archivo .osr contiene una longitud inválida.');
  }
  blob(length: number) {
    this.need(length);
    const result = this.bytes.slice(this.pos, this.pos + length);
    this.pos += length;
    return result;
  }
}

export async function parseReplay(bytes: Uint8Array): Promise<Replay> {
  if (bytes.length > 25_000_000) throw new Error('El archivo .osr supera el límite de 25 MB.');
  const reader = new Reader(bytes);
  const mode = reader.u8();
  if (mode !== 0) throw new Error('Por ahora solo se admiten repeticiones de osu!standard.');
  const version = reader.u32();
  const checksum = reader.string().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(checksum)) throw new Error('El .osr no contiene un checksum de mapa válido.');
  const player = reader.string();
  reader.string(); // replay checksum
  const n300 = reader.u16();
  const n100 = reader.u16();
  const n50 = reader.u16();
  reader.u16(); // gekis
  reader.u16(); // katus
  const misses = reader.u16();
  const score = reader.u32();
  const maxCombo = reader.u16();
  const perfect = reader.u8() === 1;
  const mods = reader.u32();
  const life = reader.string().split(',').slice(0, 10_000).flatMap(entry => {
    const [time, value] = entry.split('|').map(Number);
    return Number.isFinite(time) && Number.isFinite(value) ? [{ time, value: Math.max(0, Math.min(1, value)) }] : [];
  });
  reader.skip(8); // timestamp, Windows ticks
  const compressedLength = reader.u32();
  if (compressedLength > 25_000_000) throw new Error('Los datos del replay son demasiado grandes.');
  const compressed = reader.blob(compressedLength);
  let decoded: string | Uint8Array;
  try {
    if (typeof Worker === 'undefined') {
      decoded = await decompress(compressed);
    } else {
      const worker = createWorkerLZMA();
      try { decoded = await worker.decompress(compressed); }
      finally { worker.terminate(); }
    }
  } catch {
    throw new Error('No se pudieron descomprimir los movimientos del replay.');
  }
  const raw = typeof decoded === 'string' ? decoded : new TextDecoder().decode(decoded);
  if (raw.length > 50_000_000) throw new Error('El replay descomprimido supera el límite permitido.');
  const frames: ReplayFrame[] = [];
  let time = 0;
  for (const entry of raw.split(',')) {
    if (!entry) continue;
    const parts = entry.split('|');
    if (parts.length !== 4) continue;
    const delta = Number(parts[0]);
    if (delta === -12345) continue; // RNG seed frame
    const x = Number(parts[1]);
    const y = Number(parts[2]);
    const keys = Number(parts[3]);
    if (!Number.isFinite(delta) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isInteger(keys) || delta < 0) continue;
    time += delta;
    frames.push({ time, x, y, keys });
    if (frames.length > 2_000_000) throw new Error('El replay contiene demasiados movimientos.');
  }
  if (!frames.length) throw new Error('El .osr no contiene movimientos reproducibles.');
  return { checksum, player, version, score, maxCombo, perfect, mods, counts: { n300, n100, n50, misses }, frames, duration: time, life };
}

export function accuracy(replay: Replay) {
  const { n300, n100, n50, misses } = replay.counts;
  const total = n300 + n100 + n50 + misses;
  return total ? ((300 * n300 + 100 * n100 + 50 * n50) / (300 * total)) * 100 : 0;
}

export function modNames(value: number) {
  const flags: Array<[number, string]> = [
    [1, 'NF'], [2, 'EZ'], [8, 'HD'], [16, 'HR'], [32, 'SD'],
    [64, 'DT'], [128, 'RX'], [256, 'HT'], [512, 'NC'], [1024, 'FL'],
    [4096, 'SO'], [8192, 'AP'], [16384, 'PF'],
  ];
  const names = flags.filter(([flag]) => value & flag).map(([, name]) => name);
  return names.filter(name => !(name === 'DT' && names.includes('NC')));
}
