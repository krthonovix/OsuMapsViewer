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
      if (!file.name.toLowerCase().endsWith('.osr')) throw new Error('Selecciona un archivo con extensión .osr.');
      const parsed = await parseReplay(new Uint8Array(await file.arrayBuffer()));
      setReplay(parsed);
      setStatus('searching');
      const response = await fetch(`/api/maps/${parsed.checksum}/manifest`);
      const data = await response.json() as Manifest & { message?: string };
      if (!response.ok) throw new Error(data.message || 'No se pudo obtener el mapa de este replay.');
      setStatus('loading');
      const mapResponse = await fetch(data.osuUrl);
      if (!mapResponse.ok) throw new Error('No se pudo leer la dificultad del mapa.');
      const source = await mapResponse.text();
      const map = parseBeatmap(source, data.audioUrl, data.backgroundUrl);
      if (!map.objects.length) throw new Error('La dificultad no contiene objetos reproducibles.');
      setBeatmap(map);
      setStatus('ready');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ocurrió un error inesperado.');
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
        <div className="intro"><p className="eyebrow">TUS JUGADAS, EN EL NAVEGADOR</p><h1>Revive cada<br /><em>movimiento.</em></h1><p className="subtitle">Arrastra un replay de osu! y mira la jugada sin abrir el juego. Buscamos el mapa automáticamente para ti.</p><div className="steps"><span><b>01</b> Sube tu .osr</span><span><b>02</b> Encontramos el mapa</span><span><b>03</b> Dale play</span></div></div>
        <div
          className={`upload-card ${dragging ? 'dragging' : ''}`}
          onDragOver={event => { event.preventDefault(); setDragging(true); }}
          onDragLeave={event => { event.preventDefault(); setDragging(false); }}
          onDrop={event => { event.preventDefault(); setDragging(false); void load(event.dataTransfer.files[0]); }}
        >
          <input ref={inputRef} type="file" accept=".osr" hidden onChange={event => void load(event.target.files?.[0])} />
          <div className="upload-icon">↗</div>
          <p className="eyebrow">CARGAR REPETICIÓN</p>
          <h2>Tu replay empieza aquí.</h2>
          <p>Arrastra tu archivo .osr a esta zona<br />o selecciónalo desde tu equipo.</p>
          <button className="primary" onClick={() => inputRef.current?.click()} disabled={status === 'reading' || status === 'searching' || status === 'loading'}>Seleccionar archivo .osr <span>→</span></button>
          {status === 'reading' && <p className="status">Leyendo la repetición…</p>}
          {status === 'searching' && <p className="status">Buscando el mapa exacto…</p>}
          {status === 'loading' && <p className="status">Preparando el reproductor…</p>}
          {status === 'error' && <div className="error" role="alert">{error}</div>}
          <small>Solo osu!standard · El .osr se procesa en tu navegador</small>
        </div>
      </div>
      <footer>Visualiza el cursor, los objetos y las pulsaciones en una sola línea de tiempo.</footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
