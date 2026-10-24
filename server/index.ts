import express from 'express';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';

if (existsSync('.env')) process.loadEnvFile('.env');

type ResolvedMap = {
  osu: Buffer;
  audio: Buffer | null;
  audioType: string | null;
  background: Buffer | null;
  backgroundType: string | null;
  title: string;
  beatmapsetId: number | null;
};

class MapError extends Error {
  constructor(public code: string, message: string, public status = 502) { super(message); }
}

const app = express();
const port = Number(process.env.PORT) || 3001;
const cache = new Map<string, ResolvedMap>();
const inFlight = new Map<string, Promise<ResolvedMap>>();
const requests = new Map<string, { count: number; until: number }>();
let accessToken: { value: string; expires: number } | null = null;
const userAgent = `osu-replay-viewer/0.1${process.env.APP_CONTACT_URL ? ` (+${process.env.APP_CONTACT_URL})` : ''}`;

async function token() {
  if (accessToken && accessToken.expires > Date.now() + 60_000) return accessToken.value;
  const id = process.env.OSU_CLIENT_ID;
  const secret = process.env.OSU_CLIENT_SECRET;
  if (!id || !secret) {
    throw new MapError('NOT_CONFIGURED', 'The server is missing osu! API credentials.', 503);
  }
  const response = await fetch('https://osu.ppy.sh/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_id: Number(id), client_secret: secret, grant_type: 'client_credentials', scope: 'public' }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new MapError('OSU_API_UNAVAILABLE', 'Could not authenticate with the osu! API.');
  const data = await response.json() as { access_token: string; expires_in: number };
  accessToken = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return accessToken.value;
}

async function lookup(checksum: string) {
  if (!process.env.OSU_CLIENT_ID || !process.env.OSU_CLIENT_SECRET) {
    const response = await fetch(`https://mirror.hinamizawa.ai/api/md5/${checksum}/set`, {
      headers: { 'user-agent': userAgent, accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
    if (response.status === 404) throw new MapError('NOT_FOUND', 'The exact beatmap for this replay was not found.', 404);
    if (!response.ok) throw new MapError('PROVIDER_UNAVAILABLE', 'Beatmap lookup is unavailable right now.');
    const data = await response.json() as { SetID?: number };
    if (!Number.isInteger(data.SetID) || !data.SetID) throw new MapError('NOT_FOUND', 'Beatmap lookup returned no beatmapset.', 404);
    return { beatmapset_id: data.SetID };
  }
  const response = await fetch(`https://osu.ppy.sh/api/v2/beatmaps/lookup?checksum=${checksum}`, {
    headers: { authorization: `Bearer ${await token()}`, accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 404) throw new MapError('NOT_FOUND', 'osu! found no beatmap with this replay checksum.', 404);
  if (!response.ok) throw new MapError('OSU_API_UNAVAILABLE', 'Beatmap lookup is unavailable right now.');
  const data = await response.json() as { id: number; beatmapset_id: number; checksum?: string };
  if (!data.beatmapset_id) throw new MapError('NOT_FOUND', 'Beatmap lookup returned no beatmapset.', 404);
  return data;
}

async function download(url: URL, bearer?: string) {
  const response = await fetch(url, {
    headers: { 'user-agent': userAgent, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    redirect: 'follow',
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok || !response.body) {
    throw new MapError('PROVIDER_UNAVAILABLE', `The beatmap provider returned HTTP ${response.status}.`);
  }
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 80_000_000) throw new MapError('MAP_TOO_LARGE', 'The beatmap package exceeds the 80 MB limit.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 80_000_000) {
      await reader.cancel();
      throw new MapError('MAP_TOO_LARGE', 'The beatmap package exceeds the 80 MB limit.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function extract(bytes: Uint8Array, checksum: string, beatmapsetId: number | null): ResolvedMap {
  let files: Record<string, Uint8Array>;
  let totalSize = 0;
  let count = 0;
  try {
    files = unzipSync(bytes, { filter: file => {
      count++;
      if (count > 500) throw new MapError('MAP_TOO_LARGE', 'The beatmap package contains too many files.');
      const lower = file.name.toLowerCase();
      if (!/\.(osu|mp3|ogg|wav|jpg|jpeg|png|webp|gif)$/.test(lower)) return false;
      totalSize += file.originalSize;
      if (file.originalSize > 80_000_000 || totalSize > 250_000_000) {
        throw new MapError('MAP_TOO_LARGE', 'The extracted package exceeds the allowed size.');
      }
      return true;
    } });
  } catch (error) {
    if (error instanceof MapError) throw error;
    throw new MapError('INVALID_PACKAGE', 'The provider returned an invalid .osz package.');
  }
  const entries = Object.entries(files);
  const matched = entries.find(([name, content]) =>
    name.toLowerCase().endsWith('.osu') &&
    createHash('md5').update(content).digest('hex') === checksum
  );
  if (!matched) {
    throw new MapError('VERSION_UNAVAILABLE', 'The provider does not have the exact beatmap version for this replay.', 404);
  }
  const osu = Buffer.from(matched[1]);
  const text = new TextDecoder().decode(osu);
  const audioName = text.match(/^AudioFilename\s*:\s*(.+)$/mi)?.[1]?.trim().replaceAll('\\', '/');
  const folder = matched[0].replaceAll('\\', '/').replace(/[^/]*$/, '');
  const events = text.match(/\[Events\]([\s\S]*?)(?:\r?\n\[|$)/i)?.[1] ?? '';
  const backgroundName = events.split(/\r?\n/).map(line => {
    const match = line.match(/^\s*0\s*,\s*\d+\s*,\s*(?:"([^"]+)"|([^,]+))/);
    return match?.[1] ?? match?.[2];
  }).find(Boolean)?.trim().replaceAll('\\', '/');
  const audio = audioName
    ? entries.find(([name]) => name.replaceAll('\\', '/').toLowerCase() === (folder + audioName).toLowerCase())
    : undefined;
  const background = backgroundName
    ? entries.find(([name]) => name.replaceAll('\\', '/').toLowerCase() === (folder + backgroundName).toLowerCase())
    : undefined;
  const ext = audio?.[0].split('.').pop()?.toLowerCase();
  const audioType = ext === 'mp3' ? 'audio/mpeg' : ext === 'ogg' ? 'audio/ogg' : ext === 'wav' ? 'audio/wav' : null;
  const bgExt = background?.[0].split('.').pop()?.toLowerCase();
  const backgroundType = bgExt === 'jpg' || bgExt === 'jpeg' ? 'image/jpeg'
    : bgExt === 'png' ? 'image/png' : bgExt === 'webp' ? 'image/webp' : bgExt === 'gif' ? 'image/gif' : null;
  const title = text.match(/^TitleUnicode\s*:\s*(.+)$/mi)?.[1] ?? text.match(/^Title\s*:\s*(.+)$/mi)?.[1] ?? 'Beatmap';
  return {
    osu, audio: audio ? Buffer.from(audio[1]) : null, audioType,
    background: background ? Buffer.from(background[1]) : null, backgroundType,
    title, beatmapsetId,
  };
}

async function resolveMap(checksum: string): Promise<ResolvedMap> {
  const hit = cache.get(checksum);
  if (hit) return hit;
  const pending = inFlight.get(checksum);
  if (pending) return pending;
  const task = (async () => {
    // An operator may place verified packages here for private/offline development.
    const local = resolve('maps', `${checksum}.osz`);
    let bytes: Uint8Array;
    let beatmapsetId: number | null = null;
    if (existsSync(local)) {
      bytes = readFileSync(local);
    } else {
      const template = process.env.OSZ_URL_TEMPLATE || 'https://mirror.hinamizawa.ai/api/v1/hinai/d/{beatmapsetId}n';
      const found = await lookup(checksum);
      beatmapsetId = found.beatmapset_id;
      const url = new URL(template.replaceAll('{beatmapsetId}', String(beatmapsetId)));
      if (url.protocol !== 'https:') throw new MapError('INVALID_CONFIG', 'The provider URL must use HTTPS.', 503);
      bytes = await download(url, process.env.OSZ_AUTH_TOKEN);
    }
    const result = extract(bytes, checksum, beatmapsetId);
    cache.set(checksum, result);
    if (cache.size > 8) cache.delete(cache.keys().next().value!);
    return result;
  })().finally(() => inFlight.delete(checksum));
  inFlight.set(checksum, task);
  return task;
}

function validChecksum(value: string) { return /^[a-f0-9]{32}$/.test(value); }
function withinLimit(ip: string, limit: number) {
  const now = Date.now();
  const item = requests.get(ip);
  if (!item || item.until < now) {
    requests.set(ip, { count: 1, until: now + 60_000 });
    if (requests.size > 10_000) for (const [key, value] of requests) if (value.until < now) requests.delete(key);
    return true;
  }
  item.count++;
  return item.count <= limit;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, provider: process.env.OSZ_URL_TEMPLATE ? 'custom' : 'hinamizawa', lookup: process.env.OSU_CLIENT_ID && process.env.OSU_CLIENT_SECRET ? 'osu' : 'hinamizawa' });
});

app.get('/api/maps/:checksum/manifest', async (req, res) => {
  if (!withinLimit(`manifest:${req.ip}`, 30)) return res.status(429).json({ code: 'RATE_LIMITED', message: 'Too many lookups. Wait a minute and try again.' });
  const checksum = String(req.params.checksum).toLowerCase();
  if (!validChecksum(checksum)) return res.status(400).json({ code: 'INVALID_CHECKSUM', message: 'Invalid checksum.' });
  try {
    const map = await resolveMap(checksum);
    res.json({
      title: map.title,
      beatmapsetId: map.beatmapsetId,
      osuUrl: `/api/maps/${checksum}/osu`,
      audioUrl: map.audio ? `/api/maps/${checksum}/audio` : null,
      backgroundUrl: map.background ? `/api/maps/${checksum}/background` : null,
    });
  } catch (error) {
    const known = error instanceof MapError ? error : new MapError('PROVIDER_UNAVAILABLE', 'Could not retrieve the beatmap.');
    res.status(known.status).json({ code: known.code, message: known.message });
  }
});

app.get('/api/maps/:checksum/:resource', async (req, res) => {
  if (!withinLimit(`resource:${req.ip}`, 120)) return res.sendStatus(429);
  const checksum = String(req.params.checksum).toLowerCase();
  if (!validChecksum(checksum)) return res.sendStatus(400);
  if (!['osu', 'audio', 'background'].includes(String(req.params.resource))) return res.sendStatus(404);
  try {
    const map = await resolveMap(checksum);
    if (req.params.resource === 'audio') {
      if (!map.audio) return res.sendStatus(404);
      const audio = map.audio;
      const contentType = map.audioType || 'application/octet-stream';
      res.set('Accept-Ranges', 'bytes');
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Number(range[2]) : audio.length - 1;
        if (start >= audio.length || end >= audio.length || end < start) {
          return res.status(416).set('Content-Range', `bytes */${audio.length}`).end();
        }
        return res.status(206)
          .set('Content-Range', `bytes ${start}-${end}/${audio.length}`)
          .set('Content-Length', String(end - start + 1))
          .type(contentType)
          .end(audio.subarray(start, end + 1));
      }
      res.type(contentType).send(audio);
    } else if (req.params.resource === 'background') {
      if (!map.background) return res.sendStatus(404);
      res.type(map.backgroundType || 'application/octet-stream').send(map.background);
    } else {
      res.type('text/plain; charset=utf-8').send(map.osu);
    }
  } catch {
    res.sendStatus(404);
  }
});

const dist = resolve('dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile(join(dist, 'index.html')));
}

const host = process.env.HOST || '127.0.0.1';
app.listen(port, host, () => console.log(`API ready at http://${host}:${port}`));
