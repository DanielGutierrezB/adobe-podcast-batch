# 🎙️ Adobe Podcast Batch

App de escritorio (macOS) para limpiar audio **por lote** con el modelo de
**Adobe Podcast — Enhance Speech (v2)**, sin depender de la interfaz web.

Pensada para equipos de edición de video/podcast: metés una carpeta con decenas
de audios y te devuelve todos limpios, cada uno junto al original.

![icon](build/icon-1024.png)

## Características

- 🔐 **Login embebido de Adobe** — te logueás dentro de la app y extrae el token
  solo. La sesión queda guardada; al reabrir se reconecta sin pedirte nada.
- 📁 **Lote real** — audios sueltos, carpeta entera o arrastrar y soltar.
- ⚡ **Procesa 5 a la vez** con cola y estado por archivo.
- ⏳ **Manejo de créditos** — si Adobe corta por límite, muestra una cuenta
  regresiva y **reanuda solo** cuando se libera.
- 🎚️ Sliders Speech / Music / Background (default 80 / 0 / 0), guardados.
- 💾 **Salida junto al original** con sufijo `_enhanced.wav`.

## Descargar

Bajá el DMG desde la sección [**Releases**](../../releases/latest).
Como la app no está firmada con Apple, la primera vez abrila con
**clic derecho → Abrir**.

## Desarrollo

```bash
npm install
npm start          # correr en dev
npm run icon       # regenerar el ícono (build/icon.icns)
npm run dist       # empaquetar DMG en dist/
```

## Cómo funciona

Usa el endpoint interno `phonos-server-flex.adobe.io` que alimenta la web de
Adobe Podcast: sube el audio, crea un track de *enhance speech*, espera el
procesamiento y descarga el resultado. El token de sesión de Adobe se obtiene
del login embebido (nunca se guarda en el repo).

## Privacidad / seguridad

- El token de Adobe se guarda **solo localmente** (en el `settings.json` de la
  app dentro de tu carpeta de usuario). No se sube a ningún lado.
- No hay claves ni secretos en el código.

## Aviso

Proyecto no oficial, sin relación con Adobe. Usa un endpoint interno que puede
cambiar sin aviso. MIT License.
