# Plan de implementación: visor web de repeticiones de osu!standard

> Estado al 24 de octubre de 2026: existe una implementación inicial en este repositorio. Una repetición pública real se leyó correctamente y su checksum resolvió por MD5 un mapa real con audio desde Hinamizawa. El lector de `.osr`, visor y servicio compilan y pasan pruebas locales. Falta validación visual en navegador contra osu! y pulido antes de publicar. Véase [README.md](./README.md).

## 1. Objetivo

Crear una página donde el usuario arrastre o seleccione **un archivo `.osr`** y pueda ver la repetición de osu!standard dentro del navegador. La aplicación debe identificar y obtener automáticamente el mapa correspondiente, sincronizar la reproducción con su audio y mostrar el cursor, las pulsaciones y los objetos del mapa.

La experiencia principal no debe pedir al usuario que suba un `.osu` o `.osz`.

### Resultado esperado

1. El usuario carga un `.osr`.
2. La página muestra el estado de búsqueda y preparación del mapa.
3. Se abre el reproductor con audio, controles y datos de la jugada.
4. Si no puede obtenerse la versión exacta del mapa, la página explica la causa.

## 2. Alcance

### Primera versión

- Repeticiones de **osu!standard** (`mode = 0`) exportadas en formato `.osr`.
- Una repetición a la vez.
- Identificación del mapa mediante el checksum incluido en el `.osr`.
- Obtención automática del archivo `.osu` exacto y del audio, cuando estén disponibles mediante una fuente autorizada.
- Reproducción de círculos, sliders, spinners, cursor y estado de los botones.
- Controles de reproducir, pausar, avanzar, retroceder, buscar un momento y ajustar volumen.
- Visualización de nombre del jugador, mapa, dificultad, mods, puntuación, precisión calculada a partir de los conteos del replay, combo y fallos.
- Mensajes claros para archivos inválidos, modos no admitidos, mapa no encontrado y fallos de descarga.
- Diseño adaptable a escritorio y móvil, priorizando una reproducción fluida en escritorio.

### Fuera de la primera versión

- Taiko, catch y mania.
- Reconstrucción exacta de cada juicio, combo y puntuación a lo largo de la partida.
- Editor de mapas, grabación de vídeo, comparación de dos replays y cuentas de usuario.
- Fidelidad completa del cliente osu!: storyboard, vídeos, skins personalizadas y todos los hitsounds.

Estas funciones pueden añadirse después sin cambiar el flujo de carga de un solo `.osr`.

## 3. Hecho técnico que define el diseño

El `.osr` contiene metadatos de la jugada, el checksum MD5 de la dificultad, los mods y una secuencia comprimida de tiempo, coordenadas del cursor y teclas. **No contiene los objetos del mapa ni su música**. El archivo `.osu` describe los objetos y tiempos; el paquete `.osz` suele incluir el `.osu`, el audio y otros recursos. Por ello, la aplicación debe conseguir la dificultad exacta desde otra fuente.

El checksum es la clave de unión. Encontrar un beatmap por su checksum no garantiza que una versión antigua del archivo o su audio sigan disponibles. Nunca debe sustituirse silenciosamente por la versión actual de una dificultad si su checksum es distinto.

## 4. Flujo funcional

```text
Usuario arrastra .osr
        │
        ▼
Navegador lee cabecera, checksum y frames del replay
        │
        ▼
Servidor consulta caché y API de osu! por checksum
        │
        ▼
Proveedor de mapas entrega archivos del beatmapset
        │
        ▼
Se extrae la dificultad .osu y se verifica su checksum
        │
        ▼
Navegador recibe mapa y audio; prepara la línea de tiempo
        │
        ▼
Reproductor sincroniza audio, objetos, cursor y teclas
```

Si el mapa está en caché, se evita la consulta y descarga repetida. Si la búsqueda o descarga falla, se conserva la información legible del `.osr` y se muestra el motivo sin simular una reproducción incorrecta.

## 5. Arquitectura propuesta

### Cliente web

- **TypeScript** para la aplicación y los lectores de archivos.
- **React** para carga, estados, controles y paneles; **Canvas 2D** para el campo de juego. Evaluar WebGL solo si las pruebas de rendimiento lo justifican.
- Un **Web Worker** para leer y descomprimir el `.osr` y, cuando convenga, analizar el `.osu` sin bloquear la interfaz.
- El `.osr` se procesa localmente por defecto. El cliente envía al servidor el checksum del mapa, no el archivo de la repetición.
- Reproducción controlada por una única línea de tiempo. Con audio disponible, el tiempo del audio será la referencia para el dibujo; al pausar o buscar, todos los elementos deberán actualizarse al mismo instante.

### Servicio de mapas

- API pequeña en **Node.js con TypeScript**. Puede vivir en el mismo repositorio que la web.
- Gestiona la autenticación de la API oficial en el servidor; ningún secreto se publica en el navegador.
- Consulta `GET /api/v2/beatmaps/lookup?checksum=...` para identificar la dificultad.
- Utiliza un adaptador `MapProvider` para obtener los recursos. El adaptador permite cambiar de fuente sin reescribir el reproductor.
- Descomprime el paquete cuando sea necesario, localiza el `.osu` cuyo MD5 coincida y entrega solo los recursos requeridos.
- Guarda en caché archivos verificados por checksum y metadatos de búsqueda. Añade límites de tamaño, tiempo y frecuencia de solicitudes.

### Contrato inicial entre cliente y servidor

```text
GET /api/maps/{checksum}/status
  → estado, metadatos y disponibilidad

GET /api/maps/{checksum}/manifest
  → dificultad, URL temporal del .osu y URL temporal del audio
```

El contrato puede simplificarse durante la implementación. Las URL de recursos deben corresponder al mismo mapa verificado. Los errores tendrán códigos distinguibles: `NOT_FOUND`, `VERSION_UNAVAILABLE`, `PROVIDER_UNAVAILABLE` y `AUDIO_UNAVAILABLE`.

## 6. Fase 0: prueba de viabilidad de la descarga automática

**Esta fase se realiza antes de construir el reproductor completo.** Su objetivo es demostrar que el flujo de un solo archivo funciona con una fuente real de mapas.

### Tareas

1. Reunir una pequeña colección de `.osr` de prueba: mapas ranked y loved, un replay antiguo, un mapa actualizado y un archivo inválido.
2. Extraer el checksum de cada `.osr` y consultar la API oficial de osu!.
3. Evaluar el acceso permitido al paquete con audio. La documentación del endpoint `GET /api/v2/beatmapsets/{beatmapset}/download` lo marca como `OAuth lazer`; no se asumirá que una aplicación web externa puede utilizarlo.
4. Si esa vía no es viable, evaluar un proveedor alternativo o un repositorio propio alimentado mediante una fuente autorizada. Verificar disponibilidad, límites, condiciones de uso y política de caché antes de adoptarlo.
5. Descargar un paquete de prueba, extraer sus dificultades y comprobar el MD5 del `.osu` frente al checksum del `.osr`.
6. Documentar la tasa de éxito y los casos imposibles, especialmente versiones antiguas que ya no estén disponibles.

### Criterio de salida

- Existe al menos una fuente operable para obtener mapa y audio automáticamente en los casos de prueba comunes.
- Se conoce qué tipos de replay no se podrán resolver y cómo detectarlos.
- La fuente elegida permite la forma de uso prevista para el sitio.

**Si no se cumple este criterio, no se debe prometer reproducción universal con un solo `.osr`.** Se decidirá si lanzar una versión que muestre trayectoria sin audio cuando exista el `.osu`, cambiar de fuente o posponer la publicación.

## 7. Fases de implementación

### Fase 1: base del proyecto y lector `.osr`

**Trabajo**

- Configurar la aplicación web, el servicio y comandos de desarrollo en un mismo repositorio.
- Implementar lectura binaria con control estricto de límites y errores.
- Leer modo, versión, checksum del mapa, jugador, conteos de juicios, score, combo, mods y fecha.
- Descomprimir LZMA y convertir los frames a tiempo absoluto, coordenadas y estado de teclas.
- Ignorar el frame especial de semilla RNG cuando aparezca.
- Rechazar modos distintos de osu!standard con un mensaje específico.
- Crear la pantalla de carga y una vista provisional de datos del replay.

**Criterio de aceptación:** varios `.osr` reales muestran metadatos y trayectoria correctos, y los archivos truncados o inválidos producen errores controlados.

### Fase 2: búsqueda, descarga y verificación del mapa

**Trabajo**

- Integrar la búsqueda oficial por checksum.
- Implementar el `MapProvider` validado en la fase 0.
- Añadir caché por checksum, deduplicación de descargas simultáneas y caducidad de búsquedas fallidas.
- Extraer `.osu` y audio de forma segura, con límites para tamaño comprimido y descomprimido.
- Comprobar el checksum exacto del `.osu` antes de declararlo disponible.
- Informar al cliente de progreso y errores recuperables.

**Criterio de aceptación:** cargar únicamente un `.osr` resuelve automáticamente un mapa de prueba y entrega el `.osu` correcto y su audio. Un paquete con checksum diferente se rechaza.

### Fase 3: lector `.osu` y dibujo del campo

**Trabajo**

- Leer metadatos, dificultad, eventos relevantes, timing points y hit objects.
- Calcular duración de sliders usando timing points, slider multiplier y velocidad heredada.
- Dibujar círculos, sliders y spinners en coordenadas de osu!standard (campo de 512 × 384), escaladas al espacio disponible.
- Mostrar aproximación visual básica: combo colours, círculos de aproximación y aparición/desaparición según AR.
- Aplicar los cambios espaciales y de dificultad necesarios de los mods admitidos, empezando por HR, EZ y HD.

**Criterio de aceptación:** los objetos aparecen en posiciones y momentos correctos en mapas de prueba con distintos tipos de slider y cambios de timing.

### Fase 4: reproducción sincronizada

**Trabajo**

- Dibujar la posición interpolada del cursor y su rastro.
- Mostrar M1, M2, K1 y K2 a lo largo de la reproducción.
- Integrar audio, pausa, búsqueda por tiempo, volumen y reinicio.
- Ajustar la escala temporal para mods de velocidad como DT, NC y HT.
- Tratar cambios de foco, carga lenta de audio y saltos de tiempo sin desincronización acumulada.
- Añadir panel de jugador, mapa, mods y estadísticas finales.

**Criterio de aceptación:** al reproducir, pausar o saltar a cualquier punto, audio, cursor y objetos muestran el mismo instante; el comportamiento se verifica con replays normales y con mods de velocidad.

### Fase 5: calidad y publicación

**Trabajo**

- Mejorar rendimiento de mapas largos y limitar trabajo de dibujo fuera de la ventana visible.
- Añadir estados claros de carga, mapa no localizado, versión no disponible, audio ausente y servicio temporalmente caído.
- Validar uso por teclado y adaptación a pantallas pequeñas.
- Configurar registros de errores sin almacenar el `.osr` del usuario.
- Desplegar web y servicio, configurar secretos, dominio, límites y métricas básicas.

**Criterio de aceptación:** el flujo completo funciona en un entorno publicado con archivos reales y los errores más comunes se entienden desde la interfaz.

## 8. Pruebas esenciales

- **Formato `.osr`:** uno normal, uno con DT/NC, uno con HR/HD, uno antiguo, uno de otro modo y uno dañado.
- **Formato `.osu`:** círculos, sliders de varias curvas, spinners y cambios de timing/slider velocity.
- **Correspondencia:** mapa correcto, mapa de otra versión con el mismo ID y paquete sin la dificultad esperada.
- **Sincronización:** inicio, pausa, saltos al principio/medio/final y reproducción completa con mods de velocidad.
- **Servicio:** caché, descarga simultánea, proveedor caído, archivo demasiado grande y descompresión fallida.

Las pruebas de formato deben usar archivos reales autorizados para el proyecto, además de casos pequeños preparados para errores concretos. Una revisión visual contra la repetición en osu! servirá para detectar diferencias que los tests automáticos no revelen.

## 9. Riesgos y respuestas previstas

| Riesgo | Respuesta |
| --- | --- |
| La descarga oficial no está disponible para una web externa. | Resolverlo en la fase 0; usar solo una fuente alternativa con acceso y condiciones adecuados. |
| El checksum de un replay antiguo ya no corresponde a la versión publicada. | Buscar una copia exacta en la fuente/caché; si no existe, mostrar `VERSION_UNAVAILABLE`. |
| El mapa es privado, eliminado o nunca fue publicado. | Mostrar datos del replay y un mensaje de mapa no disponible; no dibujar un mapa aproximado. |
| La fuente entrega un paquete incorrecto o modificado. | Verificar MD5 del `.osu` contra el `.osr` antes de reproducir. |
| Descargas grandes o muchos usuarios elevan coste y latencia. | Caché, límites de tamaño, deduplicación y métricas de aciertos de caché. |
| Audio o recursos sujetos a condiciones de distribución. | Revisar las condiciones de la fuente antes de almacenar, servir o publicar esos recursos. |
| Diferencias entre versiones del juego y mods. | Delimitar formatos y mods soportados, mantener casos de prueba y avisar de los no soportados. |

## 10. Orden de entregas y estimación

| Entrega | Contenido | Estimación orientativa |
| --- | --- | --- |
| Viabilidad | Identificación y descarga automática comprobadas con replays reales. | 2–4 días |
| Visor técnico | Lector `.osr`, resolución del mapa y dibujo básico sin pulido. | 1–2 semanas |
| MVP reproducible | Audio, controles, cursor, teclas y mods principales. | 2–3 semanas adicionales |
| Publicación inicial | Errores, rendimiento, despliegue y revisión final. | 3–5 días adicionales |

La estimación supone una persona trabajando de forma continua y **depende de resolver la fuente de mapas en la fase 0**. Si se necesita negociar acceso o construir un catálogo propio, el calendario deberá revisarse.

## 11. Definición de terminado del MVP

El MVP está terminado cuando una persona puede abrir la web, cargar **solo un `.osr` de osu!standard**, esperar la búsqueda automática y ver la repetición con mapa y audio sincronizados, sin pasos manuales adicionales, para los mapas cubiertos por la fuente elegida. La página debe identificar con claridad los casos no cubiertos y nunca reproducir la jugada sobre una versión de mapa que no coincida.

## 12. Referencias

- [Formato `.osr` — osu! wiki](https://osu.ppy.sh/wiki/en/Client/File_formats/osr_%28file_format%29)
- [Formato `.osu` — osu! wiki](https://osu.ppy.sh/wiki/en/Client/File_formats/osu_%28file_format%29)
- [Beatmaps y contenido de los paquetes `.osz` — osu! wiki](https://osu.ppy.sh/wiki/en/Beatmap)
- [osu!api v2: búsqueda de beatmap por checksum](https://osu.ppy.sh/docs/#lookup-beatmap)
- [osu!api v2: descarga de beatmapset](https://osu.ppy.sh/docs/#get-api-v2-beatmapsets-beatmapset-download)
