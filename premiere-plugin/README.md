# Adobe Podcast Enhance — Panel para Premiere Pro (CEP)

Panel (HTML/CSS/JS + ExtendScript) que dentro de Premiere:
1. Te logueás en tu cuenta de Adobe (ventana de login propia, token automático).
2. **Revisa las secuencias** del proyecto y elegís cuáles procesar.
3. Exporta el audio de cada secuencia a **WAV 24-bit / mono / 48 kHz**.
4. Lo procesa con **Adobe Podcast Enhance** (mismo motor de la app).
5. Reimporta el resultado como **track nuevo desde el inicio** y (opcional) **mutea las otras pistas**.

Incluye el slider **Voz limpia %** (dry/wet local con ffmpeg bundleado).

## Login (ventana propia) y persistencia de la sesión

`window.open()` **no está soportado en CEP** — Adobe lo bloquea a propósito
(confirmado en la comunidad de developers de CEP; probamos usarlo en una
versión anterior y efectivamente tira "el navegador bloqueó la ventana"). La
vía que Adobe recomienda para logins de terceros/SSO es declarar una segunda
extensión de tipo `ModalDialog` en el manifest: CEP la abre como ventana
nativa propia, sin pasar por el bloqueador de popups de Chromium. El botón
**Conectar con Adobe** hace eso.

⚠️ Como es una extensión **nueva** en el manifest, CEP solo la detecta al
reiniciar Premiere — reiniciá la app una vez después de instalar una versión
que la agregue (no alcanza con recargar el panel). Además, CEP 11/12 endureció
la seguridad de iframes cross-origin (aislamiento de sitios); agregamos
`--disable-site-isolation-trials` al `CEFCommandLine` para mitigarlo, pero no
tenemos forma de probarlo fuera de Premiere real — **si la ventana de login
tampoco te deja clickear**, usá el desplegable **"pegar el token a mano"**
(⚙️): abre Adobe en tu navegador normal (sin restricciones de CEP), logueate,
copiás el token con una línea en la consola y lo pegás. Es más manual pero
100% confiable porque no depende de ninguna de las restricciones de CEP.

El **token** (lo que expira, típicamente en horas) y la **sesión de Adobe**
(la cookie de login, que dura mucho más) son cosas distintas. El panel:

- Guarda el token en `~/.adobe-podcast-premiere-token` y lo restaura al abrir.
- Al abrir el panel, y cada vez que el token vence a mitad de un lote,
  intenta refrescarlo **solo** con un iframe invisible (sin mostrar nada ni
  pedir clic) mientras la sesión de Adobe siga viva — el mismo mecanismo que
  usa la app de escritorio. Esto también depende del aislamiento de iframes
  cross-origin de CEP; si el log muestra siempre "sin sesión activa" incluso
  recién logueado, esa parte no está funcionando en tu versión de CEP y toca
  reconectar a mano cuando el token venza.

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

## Instalar en una máquina nueva

El plugin **no está firmado** con certificado de Adobe, así que CEP solo lo
carga si la máquina tiene activado el modo de desarrollo. Si la entrada
aparece en **Ventana → Extensiones** pero al clickearla no abre nada, es
casi seguro esto.

**1. Activar PlayerDebugMode** (una sola vez por máquina):

macOS — con Premiere cerrado, en Terminal:

```bash
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
killall cfprefsd
```

Windows — en `regedit`, crear el valor de cadena `PlayerDebugMode = 1` en
`HKEY_CURRENT_USER\Software\Adobe\CSXS.11` y `...\CSXS.12`.

(CSXS.11 cubre Premiere 2024, CSXS.12 cubre 2025+; poner ambos no molesta.)

**2. Copiar la extensión** (el contenido del ZXP descomprimido, sin carpeta
anidada de por medio) a:

- macOS: `~/Library/Application Support/Adobe/CEP/extensions/com.danielgutierrez.adobepodcastpremiere/`
- Windows: `%APPDATA%\Adobe\CEP\extensions\com.danielgutierrez.adobepodcastpremiere\`

Verificá que quede `.../com.danielgutierrez.adobepodcastpremiere/CSXS/manifest.xml`
(y no `.../podcast-enhance-x.y.z/CSXS/...` adentro).

**3. ffmpeg** (solo para el slider Voz limpia < 100%): el ZXP no incluye el
binario. Copiá un `ffmpeg` de tu plataforma a `<extensión>/bin/ffmpeg`
(`bin\ffmpeg.exe` en Windows). Con Voz limpia al 100% no hace falta.

**4.** Abrí Premiere → **Ventana → Extensiones → Adobe Podcast Enhance**.

Si sigue sin abrir, el log de CEP dice el motivo exacto: buscá el
`CEP*-PPRO.log` más reciente en `~/Library/Logs/CSXS/` (macOS) o
`%TEMP%` (Windows) y fijate qué dice sobre `com.danielgutierrez.adobepodcastpremiere`
("not signed" → paso 1; no aparece mencionada → paso 2).

## Estado

- ✅ Panel, login/token, motor de enhance, slider Voz limpia %, ffmpeg bundleado.
- Para depurar: Chrome → `localhost:8098` (panel).

## Notas

- El motor de Adobe Podcast vive en `js/phonos.js` y es el MISMO módulo que usa
  la app de escritorio (única fuente de verdad, sin copias).
- Empaquetar el ZXP: `npm run zxp` (desde la raíz del repo) → `dist/podcast-enhance-<versión>.zxp`.
- Proyecto no oficial, sin relación con Adobe. El token se maneja en memoria del panel.
