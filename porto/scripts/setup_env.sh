#!/usr/bin/env bash
# One command between a fresh container and a green suite.
#
#     bash scripts/setup_env.sh
#
# Two installs, not one, because the browser suite needs playwright as a NODE
# module and requirements.txt can only speak for pip.  The Python package of
# the same name is a different thing and does not satisfy `require('playwright')`.
#
# It never runs `playwright install`.  Chromium is already on the image, and
# downloading another copy is both slow and, behind the proxy, unreliable —
# the suite launches the one that is here by absolute path, which is why the
# version of the node module barely matters.
set -euo pipefail

PORTO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PORTO"

# The path test_ui_menu.js hardcodes.  Checked rather than assumed: a missing
# browser otherwise surfaces 382 tests later as a launch timeout.
CHROME="${CHROME:-/opt/pw-browsers/chromium-1194/chrome-linux/chrome}"
PW_VERSION="${PW_VERSION:-1.49.1}"

echo "--> python"
pip install --quiet -r requirements.txt

echo "--> node: playwright ${PW_VERSION} (no browser download)"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-save --silent "playwright@${PW_VERSION}"

echo "--> checking what was installed"
python3 - <<'PY'
import importlib, sys
# The import name, not the package name: pyshp answers to `shapefile`.
for name in ("shapely", "pyproj", "shapefile", "openpyxl", "geographiclib", "numpy", "sqlite3"):
    try:
        importlib.import_module(name)
    except Exception as exc:
        sys.exit(f"    MISSING {name}: {exc}")
print("    python ok")
PY
node -e "require('playwright'); console.log('    node ok')"

if [ ! -x "$CHROME" ]; then
  echo "    NO CHROMIUM at $CHROME" >&2
  echo "    Do not run 'playwright install'; set CHROME= to the right path." >&2
  exit 1
fi
echo "    chromium ok"

cat <<'MSG'

Ready.  The whole suite, from docs/HANDOFF.md §13:

  python3 scripts/build.py && python3 scripts/checks.py \
    && python3 scripts/crosscheck_baseline.py \
    && node --check app.js && node scripts/test_exif.js \
    && python3 scripts/bundle_standalone.py

and then the browser pack, which needs a real origin rather than file://:

  python3 -m http.server 8234 &
  URL=http://127.0.0.1:8234/index.html node scripts/test_ui_menu.js
MSG
