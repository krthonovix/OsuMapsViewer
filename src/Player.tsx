import { useEffect, useMemo, useRef, useState } from 'react';
import type { Beatmap, HitObject } from './beatmap';
import type { Replay, ReplayFrame } from './replay';
import { modNames } from './replay';
import { loadRafisSkin, type SkinSprites } from './skin';
import { pointOnPath } from './slider';
import { estimateReplaySync } from './sync';
import { buildTimeline, keyLanes, progressAt, type Timeline } from './timeline';

function frameIndex(frames: ReplayFrame[], time: number) {
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (frames[mid].time <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function frameAt(frames: ReplayFrame[], time: number) {
  const index = frameIndex(frames, time);
  const before = frames[index];
  const after = frames[Math.min(index + 1, frames.length - 1)];
  if (!after || after.time <= before.time || time <= before.time) return before;
  const ratio = Math.min(1, (time - before.time) / (after.time - before.time));
  return {
    ...before,
    x: before.x + (after.x - before.x) * ratio,
    y: before.y + (after.y - before.y) * ratio,
  };
}

function imageAt(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, size: number) {
  ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
}

function drawNumber(ctx: CanvasRenderingContext2D, skin: SkinSprites, value: number, x: number, y: number, radius: number) {
  const digits = String(value).split('').map(digit => skin.digits[Number(digit)]);
  const height = radius * 1.15;
  const widths = digits.map(digit => height * digit.naturalWidth / digit.naturalHeight);
  const overlap = radius * 0.11;
  const total = widths.reduce((sum, width) => sum + width, 0) - overlap * (digits.length - 1);
  let left = x - total / 2;
  for (let i = 0; i < digits.length; i++) {
    ctx.drawImage(digits[i], left, y - height / 2, widths[i], height);
    left += widths[i] - overlap;
  }
}

function preempt(ar: number) {
  return ar < 5 ? 1800 - 120 * ar : 1200 - 150 * (ar - 5);
}

function drawObject(
  ctx: CanvasRenderingContext2D,
  object: HitObject,
  time: number,
  radius: number,
  lead: number,
  hidden: boolean,
  hardRock: boolean,
  skin: SkinSprites | null,
) {
  if (object.time > time + lead || time > object.endTime + 190) return;
  const y = hardRock ? 384 - object.y : object.y;
  const until = object.time - time;
  const appear = Math.min(1, Math.max(0, (lead - until) / Math.min(380, lead / 2)));
  const hide = hidden && until < lead * 0.45 ? Math.max(0, until / (lead * 0.45)) : 1;
  const depart = time > object.endTime ? Math.max(0, 1 - (time - object.endTime) / 100) : 1;
  ctx.globalAlpha = appear * hide * depart;
  if (appear <= 0 || depart <= 0) return;

  if (object.kind === 'spinner') {
    const rotation = (time - object.time) / 450;
    ctx.beginPath();
    ctx.arc(256, 192, 112, rotation, rotation + Math.PI * 1.6);
    ctx.strokeStyle = '#f4f4f4';
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(256, 192, 90, 0, Math.PI * 2);
    ctx.strokeStyle = '#52f7c8';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = '700 19px system-ui';
    ctx.fillText('SPINNER', 256, 200);
    return;
  }

  if (object.kind === 'slider' && object.path?.length) {
    const path = object.path;
    ctx.beginPath();
    ctx.moveTo(path[0].x, hardRock ? 384 - path[0].y : path[0].y);
    for (const point of path.slice(1)) ctx.lineTo(point.x, hardRock ? 384 - point.y : point.y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#f2f2f2';
    ctx.lineWidth = radius * 2 + 5;
    ctx.stroke();
    ctx.strokeStyle = '#101013';
    ctx.lineWidth = radius * 2 - 3;
    ctx.stroke();
    if (time >= object.time && time <= object.endTime) {
      const repeats = object.repeats ?? 1;
      const travel = Math.min(repeats - 0.00001, (time - object.time) / Math.max(1, object.endTime - object.time) * repeats);
      const section = Math.floor(travel);
      const point = pointOnPath(path, section % 2 ? 1 - travel % 1 : travel % 1);
      const ballY = hardRock ? 384 - point.y : point.y;
      if (skin) {
        imageAt(ctx, skin.sliderfollowcircle, point.x, ballY, radius * 2.8);
        imageAt(ctx, skin.sliderball, point.x, ballY, radius * 1.5);
      } else {
        ctx.fillStyle = '#ddd';
        ctx.beginPath();
        ctx.arc(point.x, ballY, radius * 0.62, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  if (skin) {
    imageAt(ctx, object.kind === 'slider' ? skin.sliderstartcircle : skin.hitcircle, object.x, y, radius * 2);
    imageAt(ctx, skin.hitcircleoverlay, object.x, y, radius * 2);
    drawNumber(ctx, skin, object.combo, object.x, y, radius);
  } else {
    ctx.beginPath();
    ctx.arc(object.x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#101014';
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 20px system-ui';
    ctx.fillText(String(object.combo), object.x, y);
  }
  if (until > 0) {
    // Keep the approach ring legible with HD, whose object fade would otherwise
    // hide the ring along with the hit circle before the hit time.
    ctx.globalAlpha = appear * Math.min(1, until / 70);
    const approachRadius = radius * (1 + 2.2 * until / lead);
    if (skin) imageAt(ctx, skin.approachcircle, object.x, y, approachRadius * 2);
    else {
      ctx.beginPath();
      ctx.arc(object.x, y, approachRadius, 0, Math.PI * 2);
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  map: Beatmap,
  replay: Replay,
  mapTime: number,
  replayOffset: number,
  skin: SkinSprites | null,
  timeline: Timeline,
) {
  ctx.clearRect(0, 0, width, height);
  const scale = Math.min(width / 640, height / 480);
  ctx.save();
  ctx.translate((width - 512 * scale) / 2, (height - 384 * scale) / 2);
  ctx.scale(scale, scale);
  const hardRock = Boolean(replay.mods & 16);
  const hidden = Boolean(replay.mods & 8);
  const ar = Math.min(10, Math.max(0, hardRock ? map.approachRate * 1.4 : replay.mods & 2 ? map.approachRate / 2 : map.approachRate));
  const cs = Math.min(10, Math.max(0, hardRock ? map.circleSize * 1.3 : replay.mods & 2 ? map.circleSize / 2 : map.circleSize));
  const radius = 54.4 - 4.48 * cs;
  const lead = preempt(ar);

  let lo = 0, hi = map.objects.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (map.objects[mid].time < mapTime - map.maxObjectDuration - 190) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < map.objects.length; i++) {
    const object = map.objects[i];
    if (object.time > mapTime + lead) break;
    drawObject(ctx, object, mapTime, radius, lead, hidden, hardRock, skin);
  }
  ctx.globalAlpha = 1;

  for (let i = timeline.judgments.length - 1; i >= 0; i--) {
    const result = timeline.judgments[i];
    const age = mapTime - result.time;
    if (age < 0) continue;
    if (age > 650) break;
    if (skin && result.value > 0 && age < 140) {
      ctx.globalAlpha = .65 * (1 - age / 140);
      imageAt(ctx, skin.hitcircle, result.x, result.y, radius * 2 * (1 + age / 500));
    }
    const sprite = result.value === 100 ? skin?.hit100 : result.value === 50 ? skin?.hit50
      : result.value === 0 ? skin?.hit0 : skin?.hit300;
    if (!sprite) continue;
    ctx.globalAlpha = Math.min(1, age / 80 + .35) * (1 - age / 650);
    imageAt(ctx, sprite, result.x, result.y - age * .025, result.value === 0 ? 90 : 82);
  }
  ctx.globalAlpha = 1;

  const replayTime = mapTime + replayOffset;
  const index = frameIndex(replay.frames, replayTime);
  if (skin) {
    for (let i = Math.max(0, index - 18); i <= index; i++) {
      const frame = replay.frames[i];
      if (replayTime - frame.time > 85 || frame.y < 0 || frame.y > 384) continue;
      const life = 1 - (replayTime - frame.time) / 85;
      ctx.globalAlpha = Math.max(0, life) * 0.5;
      imageAt(ctx, skin.cursortrail, frame.x, frame.y, 18 + life * 7);
    }
    ctx.globalAlpha = 1;
  }
  const frame = frameAt(replay.frames, replayTime);
  if (frame.y >= -20 && frame.y <= 404) {
    if (skin) imageAt(ctx, skin.cursor, frame.x, frame.y, 48);
    else {
      ctx.shadowBlur = 18;
      ctx.shadowColor = '#4ff7d0';
      ctx.fillStyle = '#52fbd0';
      ctx.beginPath();
      ctx.arc(frame.x, frame.y, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
  ctx.restore();
}

const format = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

function lifeAt(replay: Replay, time: number) {
  const values = replay.life;
  if (!values?.length) return 1;
  let low = 0, high = values.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (values[mid].time <= time) low = mid;
    else high = mid - 1;
  }
  const before = values[low], after = values[Math.min(low + 1, high)];
  if (time <= before.time || after.time <= before.time) return before.value;
  const ratio = Math.min(1, (time - before.time) / (after.time - before.time));
  return before.value + (after.value - before.value) * ratio;
}

export function Player({ replay, map, onReset }: { replay: Replay; map: Beatmap; onReset: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const clock = useRef({ time: 0, at: 0 });
  const timeRef = useRef(0);
  const scrubbingRef = useRef(false);
  const resumeAfterScrubRef = useRef(false);
  const seekSequenceRef = useRef(0);
  const pendingSeekRef = useRef<{ target: number; resume: boolean; sequence: number; finishing: boolean } | null>(null);
  const lastReviewRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [time, setTime] = useState(0);
  const [volume, setVolume] = useState(0.75);
  const [dim, setDim] = useState(0.72);
  const [playbackFactor, setPlaybackFactor] = useState(1);
  const [manualOffset, setManualOffset] = useState(0);
  const [skin, setSkin] = useState<SkinSprites | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const sync = useMemo(() => estimateReplaySync(replay, map), [replay, map]);
  const replayOffset = sync.offsetMs + manualOffset;
  const timeline = useMemo(() => buildTimeline(replay, map, replayOffset), [replay, map, replayOffset]);
  const reviewJudgments = useMemo(() => timeline.judgments.filter(item => item.value < 300), [timeline]);
  const progress = progressAt(timeline, time);
  const duration = Math.max(replay.duration - sync.offsetMs, map.objects.at(-1)?.endTime ?? 0) + 700;
  const modSpeed = replay.mods & 64 ? 1.5 : replay.mods & 256 ? 0.75 : 1;
  const effectiveSpeed = modSpeed * playbackFactor;
  const keys = keyLanes(frameAt(replay.frames, time + replayOffset).keys);
  const mods = modNames(replay.mods);

  useEffect(() => {
    let active = true;
    loadRafisSkin().then(images => { if (active) setSkin(images); }).catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = effectiveSpeed;
  }, [effectiveSpeed]);
  useEffect(() => {
    const handler = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let id = 0, lastUpdate = 0;
    const tick = (now: number) => {
      const bounds = canvas.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const width = Math.round(bounds.width * dpr), height = Math.round(bounds.height * dpr);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      const audio = audioRef.current;
      const current = scrubbingRef.current || pendingSeekRef.current ? timeRef.current : playing
        ? audio && map.audioUrl && !audio.paused && !audio.ended
          ? audio.currentTime * 1000
          : clock.current.time + (now - clock.current.at) * effectiveSpeed
        : clock.current.time;
      const bounded = Math.max(0, Math.min(duration, current));
      if (playing && !scrubbingRef.current && !pendingSeekRef.current) clock.current = { time: bounded, at: now };
      timeRef.current = bounded;
      if (bounded >= duration && playing && !scrubbingRef.current && !pendingSeekRef.current) {
        clock.current = { time: duration, at: now };
        setPlaying(false);
      }
      draw(ctx, width, height, map, replay, bounded, replayOffset, skin, timeline);
      if (now - lastUpdate > 40 || !playing) { setTime(bounded); lastUpdate = now; }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [map, replay, playing, duration, effectiveSpeed, replayOffset, skin, timeline]);

  function previewSeek(next: number) {
    const target = Math.max(0, Math.min(duration, next));
    clock.current = { time: target, at: performance.now() };
    timeRef.current = target;
    setTime(target);
    return target;
  }
  function seekAudio() {
    const pending = pendingSeekRef.current;
    const audio = audioRef.current;
    if (!pending || !audio || audio.readyState === 0) return;
    const requested = Math.min(pending.target / 1000, Number.isFinite(audio.duration) ? audio.duration : pending.target / 1000);
    try {
      audio.currentTime = requested;
      if (!audio.seeking && Math.abs(audio.currentTime - requested) < .08) void finishSeek();
    } catch { /* wait for metadata or report an audio error */ }
  }
  async function finishSeek() {
    const pending = pendingSeekRef.current;
    const audio = audioRef.current;
    if (!pending || !audio || pending.finishing) return;
    const requested = Math.min(pending.target / 1000, Number.isFinite(audio.duration) ? audio.duration : pending.target / 1000);
    if (Math.abs(audio.currentTime - requested) > .08) return;
    pending.finishing = true;
    if (pending.resume && requested < audio.duration - .05) {
      try { await audio.play(); } catch { /* continue with the fallback clock */ }
    }
    if (pendingSeekRef.current?.sequence !== pending.sequence) return;
    pendingSeekRef.current = null;
    clock.current = { time: pending.target, at: performance.now() };
    setLoadingAudio(false);
    setPlaying(pending.resume);
  }
  function seek(next: number, resume = playing) {
    const target = previewSeek(next);
    scrubbingRef.current = false;
    seekSequenceRef.current++;
    const audio = audioRef.current;
    if (!audio || !map.audioUrl || audio.error) {
      pendingSeekRef.current = null;
      setLoadingAudio(false);
      setPlaying(resume);
      return;
    }
    audio.pause();
    pendingSeekRef.current = { target, resume, sequence: seekSequenceRef.current, finishing: false };
    setLoadingAudio(true);
    seekAudio();
  }
  function toggle() {
    const audio = audioRef.current;
    if (playing) {
      seekSequenceRef.current++;
      pendingSeekRef.current = null;
      scrubbingRef.current = false;
      setLoadingAudio(false);
      audio?.pause();
      clock.current = { time: timeRef.current, at: performance.now() };
      setPlaying(false);
      return;
    }
    const start = timeRef.current >= duration ? 0 : timeRef.current;
    if (audio) audio.playbackRate = effectiveSpeed;
    seek(start, true);
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen();
  }
  function jumpToJudgment(direction: -1 | 1) {
    const current = timeRef.current;
    const previous = lastReviewRef.current;
    const continuing = previous !== null && Math.abs(current - Math.max(0, reviewJudgments[previous]?.time - 450)) < 100;
    let index = continuing ? previous + direction : direction === 1
      ? reviewJudgments.findIndex(result => result.time > current + 150)
      : reviewJudgments.length - 1;
    if (!continuing && direction === -1) {
      while (index >= 0 && reviewJudgments[index].time >= current - 150) index--;
    }
    if (index >= 0 && index < reviewJudgments.length) {
      lastReviewRef.current = index;
      seek(Math.max(0, reviewJudgments[index].time - 450));
    }
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement) return;
      if (event.code === 'Space') { event.preventDefault(); void toggle(); }
      if (event.code === 'ArrowLeft') { event.preventDefault(); seek(timeRef.current - 5000); }
      if (event.code === 'ArrowRight') { event.preventDefault(); seek(timeRef.current + 5000); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <main className="player-page">
      <div className="player-topbar">
        <button className="back" onClick={onReset}>← <span>Another replay</span></button>
        <div className="player-brand"><span className="brand-icon">◉</span> osu! replay viewer</div>
        <span className="topbar-skin">SKIN · RAFIS +HDDT</span>
      </div>
      <div className="player-layout">
        <section className="game-column">
          <div className="song-heading">
            <div><span className="song-kicker">REPLAY MODE / OSU!STANDARD</span><h1>{map.artist} <span>—</span> {map.title}</h1><p>[{map.version}] <span>·</span> mapped by {map.creator}</p></div>
            <div className="map-mods">{mods.length ? mods.map(mod => <span key={mod}>{mod}</span>) : <span>NM</span>}</div>
          </div>
          <div className="game-stage" ref={stageRef}>
            {map.backgroundUrl && <img className="map-background" src={map.backgroundUrl} alt="" />}
            <div className="background-dim" style={{ opacity: dim }} />
            <canvas ref={canvasRef} className="game-canvas" aria-label="osu!standard replay" />
            <div className="in-game-top">
              <div className="replay-status"><div className="replay-badge"><span className="live-dot" /> REPLAY MODE <small>{replay.player}</small></div><div className="life-bar"><span style={{ width: `${lifeAt(replay, time) * 100}%` }} /></div></div>
              <div className="game-score"><small>SCORE</small><strong>{String(progress.score).padStart(8, '0')}</strong><span>{progress.accuracy.toFixed(2)}%</span></div>
            </div>
            <div className="stage-progress"><span style={{ width: `${time / duration * 100}%` }} /></div>
            <div className="in-game-bottom">
              <span className="combo-hud"><strong>{progress.combo}<small>x</small></strong><small>COMBO</small></span>
              <div className="key-overlay">{['K1', 'K2'].map((name, i) => <span key={name} className={keys & (1 << i) ? 'pressed' : ''}>{name}</span>)}</div>
            </div>
            {!playing && <button className="stage-play" onClick={() => void toggle()} aria-label="Play replay">▶</button>}
            {fullscreen && <button className="leave-fullscreen" onClick={toggleFullscreen}>Exit fullscreen</button>}
          </div>
          {map.audioUrl && <audio ref={audioRef} src={map.audioUrl} preload="metadata"
            onLoadedMetadata={() => { if (pendingSeekRef.current) seekAudio(); else if (!scrubbingRef.current && timeRef.current > 0) seek(timeRef.current, playing); }}
            onSeeked={() => { void finishSeek(); }}
            onCanPlay={() => { if (pendingSeekRef.current && !audioRef.current?.seeking) void finishSeek(); }}
            onError={() => { const pending = pendingSeekRef.current; pendingSeekRef.current = null; setLoadingAudio(false); if (pending) { clock.current = { time: pending.target, at: performance.now() }; setPlaying(pending.resume); } }} />}
          <div className="player-controls">
            <button className="control-play" onClick={() => void toggle()} aria-label={playing ? 'Pause' : 'Play'}>{playing ? 'Ⅱ' : '▶'}</button>
            <span className="control-time">{format(time)}</span>
            <input className="seekbar" aria-label="Replay position" type="range" min="0" max={duration} value={time}
              onPointerDown={() => { scrubbingRef.current = true; resumeAfterScrubRef.current = playing; seekSequenceRef.current++; pendingSeekRef.current = null; audioRef.current?.pause(); setLoadingAudio(false); }}
              onPointerUp={event => { if (scrubbingRef.current) seek(Number(event.currentTarget.value), resumeAfterScrubRef.current); }}
              onPointerCancel={event => { if (scrubbingRef.current) seek(Number(event.currentTarget.value), resumeAfterScrubRef.current); }}
              onChange={event => { const target = Number(event.target.value); if (scrubbingRef.current) previewSeek(target); else seek(target); }} />
            <span className="control-time end">{format(duration)}</span>
            {loadingAudio && <span className="loading-audio">Loading audio…</span>}
            <select className="speed-select" aria-label="Playback speed" value={playbackFactor} onChange={event => setPlaybackFactor(Number(event.target.value))}>
              <option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option>
            </select>
            <button className="fullscreen-button" onClick={toggleFullscreen} aria-label="Fullscreen">⛶</button>
          </div>
          <div className="player-settings">
            <label>Background dim <input type="range" min="0.25" max="0.95" step="0.01" value={dim} onChange={event => setDim(Number(event.target.value))} /></label>
            <label>Volume <input type="range" min="0" max="1" step="0.01" value={volume} onChange={event => setVolume(Number(event.target.value))} /></label>
            <details className="sync-details">
              <summary>Sync {sync.confidence === 'low' ? '· check' : '· automatic'}</summary>
              <div><p>Detected offset: {sync.offsetMs} ms · {sync.matchedObjects} matched objects</p><label>Manual adjustment <input type="range" min="-3000" max="3000" step="5" value={manualOffset} onChange={event => setManualOffset(Number(event.target.value))} /> <span>{manualOffset > 0 ? '+' : ''}{manualOffset} ms</span></label><button onClick={() => setManualOffset(0)}>Reset</button></div>
            </details>
          </div>
        </section>
        <aside className="replay-sidebar">
          <div className="sidebar-title"><span className="live-dot" /> PLAY SUMMARY</div>
          <div className="player-identity"><div className="avatar">{replay.player.slice(0, 1).toUpperCase()}</div><div><small>REPLAY BY</small><strong>{replay.player}</strong></div></div>
          <div className="big-stat"><small>CURRENT SCORE</small><strong>{progress.score.toLocaleString('en-US')}</strong></div>
          <div className="sidebar-stat-grid"><div><small>ACCURACY</small><strong>{progress.accuracy.toFixed(2)}%</strong></div><div><small>COMBO</small><strong>{progress.combo}×</strong></div></div>
          <div className="judgment-card"><small>JUDGMENTS SO FAR</small><div><span className="j300">300 <b>{progress.counts.n300}</b></span><span className="j100">100 <b>{progress.counts.n100}</b></span><span className="j50">50 <b>{progress.counts.n50}</b></span><span className="jmiss">MISS <b>{progress.counts.misses}</b></span></div></div>
          <div className="review-card"><small>REVIEW HITS</small><p>{reviewJudgments.length} results below 300</p><div><button onClick={() => jumpToJudgment(-1)} disabled={!reviewJudgments.length}>← Previous</button><button onClick={() => jumpToJudgment(1)} disabled={!reviewJudgments.length}>Next →</button></div></div>
          <div className="sidebar-skin"><span>ACTIVE SKIN</span><strong>Rafis +HDDT</strong><small>Skin supplied for this project · best combo: {replay.maxCombo}×</small></div>
          <p className="sidebar-estimate">Intermediate values are estimates · final result is exact</p>
          {!map.audioUrl && <div className="sidebar-note">This beatmap has no compatible audio. The replay plays silently.</div>}
        </aside>
      </div>
    </main>
  );
}
