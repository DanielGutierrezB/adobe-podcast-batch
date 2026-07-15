# Adobe Podcast Enhance — Panel para Premiere Pro (CEP)

Panel (HTML/CSS/JS + ExtendScript) que dentro de Premiere:
1. Te logueás en tu cuenta de Adobe (ventana de login propia, token automático).
2. **Revisa las secuencias** del proyecto y elegís cuáles procesar.
3. Exporta el audio de cada secuencia a **WAV 24-bit / mono / 48 kHz**.
4. Lo procesa con **Adobe Podcast Enhance** (mismo motor de la app).
5. Reimporta el resultado como **track nuevo desde el inicio** y (opcional) **mutea las otras pistas**.

Incluye el slider **Voz limpia %** (dry/wet local con ffmpeg bundleado).

## Login (ventana propia) y persistencia de la sesión

El botón **Conectar con Adobe** abre la página de login con `window.open()`:
una ventana real del sistema (no un iframe embebido en el panel), así que los
clics y el teclado funcionan normal — Premiere solo intercepta atajos dentro
del panel embebido, no en ventanas separadas. No requiere declarar nada en el
manifest, así que **una actualización de esto no exige reiniciar Premiere**
(alcanza con recargar el panel, botón ⟳). Cuando el login termina, el token se
guarda solo y la ventana se cierra; mientras está abierta, el mismo botón la
cancela. Como plan B sigue estando la opción de pegar el token a mano (⚙️).

El **token** (lo que expira, típicamente en horas) y la **sesión de Adobe**
(la cookie de login, que dura mucho más) son cosas distintas. El panel:

- Guarda el token en `~/.adobe-podcast-premiere-token` y lo restaura al abrir.
- Al abrir el panel, y cada vez que el token vence a mitad de un lote,
  intenta refrescarlo **solo** con un iframe invisible (sin mostrar nada ni
  pedir clic) mientras la sesión de Adobe siga viva — el mismo mecanismo que
  usa la app de escritorio. Si la sesión también venció, ahí sí pide
  reconectar manualmente.

## Preset de export (opcional pero recomendado)

El panel exporta cada secuencia a WAV. Busca el preset en este orden:

1. `<extensión>/presets/wav-24-mono-48.epr` — tu preset exacto (48 kHz / 24 bit / mono).
2. Un preset cacheado o uno WAV de los systempresets de Media Encoder.
3. Último recurso: genera uno abriendo Media Encoder (una sola vez, se cachea).

Para crear el tuyo: **Archivo → Exportar → Medios** → formato **Waveform Audio
(WAV)**, Audio **48000 Hz / 24 bit / Mono** → **Guardar preajuste**, y copiá el
`.epr` a `<extensión>/presets/wav-24-mono-48.epr`.

(Si el panel dice "sin preset WAV", es esto.)

El paso 2 (buscar un preset del sistema en Media Encoder) mira rutas distintas
en Mac (`/Applications/...`) y Windows (`C:/Program Files/Adobe/...`); si tu
instalación está en otro lado, el paso 1 (tu propio `.epr`) siempre funciona
igual en ambos sistemas.

## Instalar (modo desarrollo)

Ya tenés `PlayerDebugMode = 1`. La extensión se copia a:
`~/Library/Application Support/Adobe/CEP/extensions/com.danielgutierrez.adobepodcastpremiere/`

Reiniciá Premiere y abrila en **Ventana → Extensiones → Adobe Podcast Enhance**.

## Estado

- ✅ Panel, login/token, motor de enhance, slider Voz limpia %, ffmpeg bundleado.
- Para depurar: Chrome → `localhost:8098` (panel).

## Notas

- El motor de Adobe Podcast vive en `js/phonos.js` y es el MISMO módulo que usa
  la app de escritorio (única fuente de verdad, sin copias).
- Empaquetar el ZXP: `npm run zxp` (desde la raíz del repo) → `dist/podcast-enhance-<versión>.zxp`.
- Proyecto no oficial, sin relación con Adobe. El token se maneja en memoria del panel.
