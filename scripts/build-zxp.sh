#!/usr/bin/env bash
# Empaqueta premiere-plugin/ como ZXP (zip sin firmar; el updater del panel lo
# descomprime directo sobre la extensión instalada y PlayerDebugMode permite
# instalarlo en modo desarrollo).
# Uso: scripts/build-zxp.sh [salida.zxp]   (default: dist/podcast-enhance-<version>.zxp)
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(sed -n 's/.*ExtensionBundleVersion="\([^"]*\)".*/\1/p' premiere-plugin/CSXS/manifest.xml | head -n 1)
OUT=${1:-"dist/podcast-enhance-${VERSION}.zxp"}
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"

# zip con el CONTENIDO del plugin en la raíz (el updater lo extrae sobre EXT).
# Se excluyen artefactos de dev; el binario de ffmpeg no viaja en el repo,
# el updater preserva el bin/ffmpeg ya instalado.
(
  cd premiere-plugin
  zip -r -X "$OLDPWD/$OUT" . -x ".debug"
)
echo "ZXP listo: $OUT (v$VERSION)"
