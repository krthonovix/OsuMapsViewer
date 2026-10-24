# osu! replay viewer

Visor web de repeticiones `.osr` de osu!standard. El usuario carga solo el replay; el navegador lee sus movimientos y el servidor intenta obtener el mapa exacto por checksum.

## Estado actual

- Implementados: lectura de `.osr` con LZMA, metadatos y frames; búsqueda de mapas por checksum; verificación MD5 del `.osu`; extracción de audio y fondo; render de objetos, cursor y resultados de golpes con la skin `Rafis +HDDT.osk` proporcionada para el proyecto; marcador, precisión, combo, juicios y barra de vida durante la jugada; sincronización automática y controles de reproducción.
- Verificados: compilación, pruebas de formatos y sincronización, prueba HTTP local con un `.osz` de ejemplo y lectura de un `.osr` público real. Su checksum resolvió automáticamente «Gravity Falls Theme Song», con `.osu` verificado, audio y fondo. Las 153 pulsaciones analizadas coincidieron espacial y temporalmente con objetos de ese mapa tras aplicar el desfase detectado.
- Fuente inicial integrada: [Hinamizawa](https://mirror.hinamizawa.ai/docs/beatmap-download), que documenta búsqueda por MD5 y descarga de `.osz` sin API key. La disponibilidad futura de esta fuente depende de su servicio.
- Los sprites incluidos se extrajeron del archivo `Rafis +HDDT.osk` aportado al proyecto. Su `skin.ini` identifica la skin como «Prawilosc vJP without followpoints», de DDK RPK. El script `scripts/extract-rafis-skin.mjs` permite repetir la extracción. Antes de redistribuir públicamente estos recursos, revisa los permisos de sus autores.

## Requisitos

- Node.js 24 o posterior.
- npm.
- Acceso a Internet desde el servidor para consultar el mirror inicial.
- Opcionalmente, una aplicación OAuth de osu! y un proveedor alternativo.

## Ejecutar en desarrollo

En PowerShell, usar `npm.cmd` si la política de ejecución bloquea `npm.ps1`.

```powershell
npm.cmd install
Copy-Item .env.example .env
npm.cmd run dev
```

Abrir `http://127.0.0.1:5173`. La API escucha en `http://127.0.0.1:3001`.

### Búsqueda y descarga automática

Sin `.env`, el servidor consulta el [índice público de Hinamizawa por MD5](https://mirror.hinamizawa.ai/docs/beatmap-info) y descarga el paquete desde su [endpoint de archivos](https://mirror.hinamizawa.ai/docs/beatmap-download). Esto permite que el usuario cargue solo un `.osr`. La aplicación comprueba el checksum del `.osu` descargado antes de mostrarlo.

Para un despliegue público, configurar `APP_CONTACT_URL` con una página de contacto o repositorio: el proveedor pide un User-Agent descriptivo para identificar el tráfico.

### Proveedor alternativo

Editar `.env`:

```text
OSU_CLIENT_ID=...
OSU_CLIENT_SECRET=...
OSZ_URL_TEMPLATE=https://proveedor-autorizado.example/maps/{beatmapsetId}.osz
OSZ_AUTH_TOKEN=...
APP_CONTACT_URL=https://tu-sitio.example/contacto
```

`OSZ_AUTH_TOKEN` es opcional; si existe, se envía como bearer al proveedor. El proveedor debe entregar un ZIP `.osz` por HTTPS. La plantilla la define quien opera el servidor: la aplicación **no acepta URLs arbitrarias del navegador**. La API de osu! se usa para pasar del checksum al beatmapset ID; después se descarga el paquete y se confirma que uno de sus `.osu` tiene exactamente ese checksum. Si el paquete solo contiene una revisión nueva, se rechaza.

El [endpoint oficial de descarga de beatmapsets](https://osu.ppy.sh/docs/#get-api-v2-beatmapsets-beatmapset-download) está documentado con acceso `OAuth lazer` y no se usa aquí. Si se configuran `OSU_CLIENT_ID` y `OSU_CLIENT_SECRET`, la búsqueda por checksum pasa a la [API oficial](https://osu.ppy.sh/docs/#lookup-beatmap); la descarga sigue usando Hinamizawa salvo que se configure `OSZ_URL_TEMPLATE`.

### Probar con un mapa local

El servidor también busca `maps/<checksum-del-osr>.osz` antes de consultar la red. El checksum es el MD5 de los bytes del archivo `.osu` exacto. Esta opción permite pruebas sin proveedor externo, manteniendo para el usuario el flujo de cargar solo un `.osr`.

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run smoke:local
```

`smoke:local` requiere el servidor de desarrollo en ejecución; crea un paquete temporal de prueba, verifica los endpoints y lo elimina. Los `.osz` locales quedan excluidos de Git.

En el reproductor, Espacio pausa o reanuda; las flechas izquierda y derecha avanzan o retroceden 5 segundos. Al arrastrar la barra, la imagen queda en el tiempo elegido y el audio se reanuda cuando termina de buscar esa posición. El control **Sincronización** muestra el desfase calculado a partir de las pulsaciones y permite ajustarlo manualmente cuando el replay no aporta datos suficientes. **Revisar golpes** salta al anterior o siguiente resultado inferior a 300, dejando 450 ms de anticipación para verlo.

Para inspeccionar un replay desde la terminal: `npm.cmd run inspect:replay -- ruta/al/replay.osr`.

## API

- `GET /api/health`: estado de configuración.
- `GET /api/maps/:checksum/manifest`: identifica y prepara el mapa. Devuelve enlaces internos al `.osu`, al audio y al fondo cuando existen.
- `GET /api/maps/:checksum/osu`: dificultad verificada.
- `GET /api/maps/:checksum/audio`: audio, si está presente.
- `GET /api/maps/:checksum/background`: imagen de fondo, si está presente.

## Límites actuales

- Solo osu!standard. Otros modos se rechazan al abrir el `.osr`.
- El servidor limita la descarga a 80 MB, los archivos extraídos relevantes a 250 MB en conjunto y cada archivo extraído a 80 MB.
- Algunos mapas privados, eliminados o revisiones antiguas pueden no estar disponibles en la fuente configurada.
- El `.osr` solo contiene los totales finales de puntuación, combo y juicios. La secuencia intermedia se **reconstruye de forma aproximada** a partir de las pulsaciones, tiempos, posiciones y partes de los sliders; se ajusta para respetar los totales y el combo máximo registrados. Por eso un 100, 50 o fallo puntual puede aparecer en una posición distinta a la de osu!stable. El resultado final mostrado sí coincide con el archivo.
- El dibujo de sliders y spinners sigue siendo una aproximación visual; no reproduce todas las animaciones ni efectos de osu!stable. Algunos replays muy cortos pueden necesitar ajuste manual de sincronización.
- El visor muestra los approach circles también en repeticiones con Hidden para facilitar la lectura del mapa.
- No se almacenan repeticiones en el servidor. Los mapas obtenidos se mantienen en una pequeña caché en memoria mientras el proceso está activo.

## Validación adicional antes de publicarlo

Probar más replays reales de mapas antiguos y actualizados, con distintos mods y sliders, y comparar el resultado con osu!stable. También se verificó `SAVE (Encore)` con HD/DT: 306 objetos, desfase de 1307 ms, 295 juicios de 300 y 11 de 100; el marcador reconstruido llega a la puntuación, precisión y combo máximo del `.osr`.

El plan general está en [PLAN_IMPLEMENTACION.md](./PLAN_IMPLEMENTACION.md).
