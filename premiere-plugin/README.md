# Adobe Podcast Enhance — Panel para Premiere Pro (CEP)

Panel (HTML/CSS/JS + ExtendScript) que dentro de Premiere:
1. Te logueás en tu cuenta de Adobe (login embebido, token automático).
2. **Revisa las secuencias** del proyecto y elegís cuáles procesar.
3. Exporta el audio de cada secuencia a **WAV 24-bit / mono / 48 kHz**.
4. Lo procesa con **Adobe Podcast Enhance** (mismo motor de la app).
5. Reimporta el resultado como **track nuevo desde el inicio** y (opcional) **mutea las otras pistas**.

Incluye el slider **Voz limpia %** (dry/wet local con ffmpeg bundleado).

## ⚠️ Paso único: crear el preset de export

Premiere necesita un preset `.epr` para exportar el audio con tu spec exacta.
Hay que crearlo **una vez**:

1. En Premiere: **Archivo → Exportar → Medios** (con una secuencia activa).
2. Formato **Waveform Audio (WAV)** → Audio: **48000 Hz**, **24 bit**, **Mono**.
3. Al lado de "Ajuste preestablecido" → **Guardar preajuste** → nombre libre.
4. Ese `.epr` se guarda en tu carpeta de presets de Adobe. Copialo a:
   `<extensión>/presets/wav-24-mono-48.epr`

(Si el panel dice "falta preset", es esto.)

## Instalar (modo desarrollo)

Ya tenés `PlayerDebugMode = 1`. La extensión se copia a:
`~/Library/Application Support/Adobe/CEP/extensions/com.danielgutierrez.adobepodcastpremiere/`

Reiniciá Premiere y abrila en **Ventana → Extensiones → Adobe Podcast Enhance**.

## Estado

- ✅ Panel, login/token, motor de enhance, slider Voz limpia %, ffmpeg bundleado.
- ⏳ **Sin probar dentro de Premiere** — la parte ExtendScript (export/import/mute) se
  ajusta con la primera corrida real. Para depurar: Chrome → `localhost:8098`.

## Notas

- Proyecto no oficial, sin relación con Adobe. El token se maneja en memoria del panel.
