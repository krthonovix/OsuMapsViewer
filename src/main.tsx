import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parseReplay, type Replay } from './replay';
import { parseBeatmap, type Beatmap } from './beatmap';
import { Player } from './Player';
import './style.css';

type Status = 'idle' | 'reading' | 'searching' | 'loading' | 'ready' | 'error';
type Manifest = { osuUrl: string; audioUrl: string | null; backgroundUrl: string | null; title: string };

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [replay, setReplay] = useState<Replay | null>(null);
  const [beatmap, setBeatmap] = useState<Beatmap | null>(null);
  const [dragging, setDragging] = useState(false);

  async function load(file?: File) {
    if (!file) return;
    setReplay(null);
    setBeatmap(null);
    setError('');
    setStatus('reading');
    try {
      if (!file.name.toLowerCase().endsWith('.osr')) throw new Error('Select a file with the .osr extension.');
      const parsed = await parseReplay(new Uint8Array(await file.arrayBuffer()));
      setReplay(parsed);
      setStatus('searching');
      const response = await fetch(`/api/maps/${parsed.checksum}/manifest`);
      const data = await response.json() as Manifest & { message?: string };
      if (!response.ok) throw new Error(data.message || 'Could not retrieve the beatmap for this replay.');
      setStatus('loading');
      const mapResponse = await fetch(data.osuUrl);
      if (!mapResponse.ok) throw new Error('Could not read the beatmap difficulty.');
      const source = await mapResponse.text();
      const map = parseBeatmap(source, data.audioUrl, data.backgroundUrl);
      if (!map.objects.length) throw new Error('This difficulty has no playable objects.');
      setBeatmap(map);
      setStatus('ready');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'An unexpected error occurred.');
      setStatus('error');
    }
  }

  if (status === 'ready' && replay && beatmap) {
    return <Player replay={replay} map={beatmap} onReset={() => { setStatus('idle'); setReplay(null); setBeatmap(null); }} />;
  }
  return (
    <main className="landing">
      <nav><div className="brand"><span className="brand-icon">◉</span> osu! replay viewer</div><span className="nav-tag">osu!standard</span></nav>
      <div className="hero">
        <div className="intro"><p className="eyebrow">YOUR PLAYS, IN YOUR BROWSER</p><h1>Relive every<br /><em>move.</em></h1><p className="subtitle">Drop an osu! replay and watch it without opening the game. We find the matching beatmap for you.</p><div className="steps"><span><b>01</b> Upload your .osr</span><span><b>02</b> We find the beatmap</span><span><b>03</b> Press play</span></div></div>
        <div
          className={`upload-card ${dragging ? 'dragging' : ''}`}
          onDragOver={event => { event.preventDefault(); setDragging(true); }}
          onDragLeave={event => { event.preventDefault(); setDragging(false); }}
          onDrop={event => { event.preventDefault(); setDragging(false); void load(event.dataTransfer.files[0]); }}
        >
          <input ref={inputRef} type="file" accept=".osr" hidden onChange={event => void load(event.target.files?.[0])} />
          <div className="upload-icon">↗</div>
          <p className="eyebrow">LOAD A REPLAY</p>
          <h2>Your replay starts here.</h2>
          <p>Drop your .osr file here<br />or choose it from your device.</p>
          <button className="primary" onClick={() => inputRef.current?.click()} disabled={status === 'reading' || status === 'searching' || status === 'loading'}>Choose .osr file <span>→</span></button>
          {status === 'reading' && <p className="status">Reading replay…</p>}
          {status === 'searching' && <p className="status">Finding the exact beatmap…</p>}
          {status === 'loading' && <p className="status">Preparing the player…</p>}
          {status === 'error' && <div className="error" role="alert">{error}</div>}
          <small>osu!standard only · Your .osr is processed in your browser</small>
        </div>
      </div>
      <footer>Watch the cursor, hit objects, and key presses on one timeline.</footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
