#!/usr/bin/env bash
# Compile the four TypeScript entry points and assemble the deployment archive.
# The same archive is shared by all four functions; the handler field selects
# which entry point each FunctionGraph function serves.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FUNC_DIR="$ROOT/src/functions"
PKG_DIR="$ROOT/build/package"
ZIP_FILE="$ROOT/build/function.zip"

mkdir -p "$ROOT/build"
rm -rf "$PKG_DIR"
mkdir -p "$PKG_DIR"

echo "[1/4] Installing dependencies ..."
(cd "$FUNC_DIR" && npm install --no-audit --no-fund --loglevel=error)

echo "[2/4] Compiling TypeScript ..."
(cd "$FUNC_DIR" && ./node_modules/.bin/tsc -p tsconfig.json)

echo "[3/4] Pruning development dependencies ..."
(cd "$FUNC_DIR" && npm prune --omit=dev --no-audit --no-fund --loglevel=error)

echo "[4/4] Assembling deployment archive ..."
python - "$FUNC_DIR" "$PKG_DIR" "$ZIP_FILE" <<'PY'
import os
import shutil
import sys
import zipfile

func_dir, pkg_dir, zip_file = sys.argv[1:4]

dst = os.path.join(pkg_dir, 'node_modules')
src = os.path.join(func_dir, 'node_modules')
if not os.path.isdir(src):
    raise SystemExit('runtime dependencies are missing; run npm install first')
if os.path.exists(dst):
    shutil.rmtree(dst)
shutil.copytree(src, dst)
shutil.copy2(os.path.join(func_dir, 'package.json'),
             os.path.join(pkg_dir, 'package.json'))

count = 0
with zipfile.ZipFile(zip_file, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
    for base, dirs, files in os.walk(pkg_dir):
        dirs[:] = [d for d in dirs if d not in ('.bin', '.cache')]
        for name in files:
            full = os.path.join(base, name)
            rel = os.path.relpath(full, pkg_dir).replace(os.sep, '/')
            zf.write(full, rel)
            count += 1
print('archive=%s files=%d bytes=%d' % (zip_file, count, os.path.getsize(zip_file)))
PY

echo "Done: $ZIP_FILE"
