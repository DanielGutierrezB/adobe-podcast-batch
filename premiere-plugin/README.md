# Adobe Podcast Enhance — Panel para Premiere Pro (CEP)

Panel (HTML/CSS/JS + ExtendScript) que dentro de Premiere:
1. Te logueás en tu cuenta de Adobe (ventana de login propia, token automático).
2. **Revisa las secuencias** del proyecto y elegís cuáles procesar.
3. Exporta el audio de cada secuencia a **WAV 24-bit / mono / 48 kHz**.
4. Lo procesa con **Adobe Podcast Enhance** (mismo motor de la app).
5. Reimporta el resultado como **track nuevo desde el inicio** y (opcional) **mutea las otras pistas**.

Incluye el slider **Voz limpia %** (dry/wet local con ffmpeg bundleado).

## Login (ventana propia)

El botón **Conectar con Adobe** abre una ventana modal del propio bundle CEP con
la página de login de Adobe. Al ser una ventana top-level (no un iframe dentro
del panel), los clics y el teclado funcionan normal y Premiere no intercepta
los atajos. Cuando el login termina, el token se guarda solo y la ventana se
cierra. Como plan B sigue estando la opción de pegar el token a mano (⚙️).

## Preset de export (opcional pero recomendado)

El panel exporta cada secuencia a WAV. Busca el preset en este orden:

1. `<extensión>/presets/wav-24-mono-48.epr` — tu preset exacto (48 kHz / 24 bit / mono).
2. Un preset cacheado o uno WAV de los systempresets de Media Encoder.
3. Último recurso: genera uno abriendo Media Encoder (una sola vez, se cachea).

Para crear el tuyo: **Archivo → Exportar → Medios** → formato **Waveform Audio
(WAV)**, Audio **48000 Hz / 24 bit / Mono** → **Guardar preajuste**, y copiá el
`.epr` a `<extensión>/presets/wav-24-mono-48.epr`.

(Si el panel dice "sin preset WAV", es esto.)

## Instalar (modo desarrollo)

Ya tenés `PlayerDebugMode = 1`. La extensión se copia a:
`~/Library/Application Support/Adobe/CEP/extensions/com.danielgutierrez.adobepodcastpremiere/`

Reiniciá Premiere y abrila en **Ventana → Extensiones → Adobe Podcast Enhance**.

## Estado

- ✅ Panel, login/token, motor de enhance, slider Voz limpia %, ffmpeg bundleado.
- Para depurar: Chrome → `localhost:8098` (panel) y `localhost:8099` (ventana de login).

## Notas

- El motor de Adobe Podcast vive en `js/phonos.js` y es el MISMO módulo que usa
  la app de escritorio (única fuente de verdad, sin copias).
- Empaquetar el ZXP: `npm run zxp` (desde la raíz del repo) → `dist/podcast-enhance-<versión>.zxp`.
- Proyecto no oficial, sin relación con Adobe. El token se maneja en memoria del panel.
