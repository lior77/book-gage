#!/usr/bin/env bash
# get.sh <out-path> <url> [extra curl args...]
# Fetches a URL, saves the response body unchanged, and appends the exact
# command plus its result line to commands.log.  Raw files are never
# overwritten: a second fetch of the same name gets a .N suffix.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="$ROOT/commands.log"

out="$1"; url="$2"; shift 2
[ "${out:0:1}" = "/" ] || out="$ROOT/$out"
mkdir -p "$(dirname "$out")"
if [ -e "$out" ]; then n=1; while [ -e "$out.$n" ]; do n=$((n+1)); done; out="$out.$n"; fi

res=$(curl -sS -m 90 --compressed -D "$out.headers" -o "$out" \
        -w 'http=%{http_code} ct=%{content_type} bytes=%{size_download}' \
        "$@" "$url" 2>&1)

{
  printf '\n# %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'curl -sS -m 90 --compressed'
  for a in "$@"; do printf ' %q' "$a"; done
  printf ' %q\n' "$url"
  printf '# -> %s  saved: %s\n' "$res" "${out#$ROOT/}"
} >> "$LOG"

printf '%s\nsaved: %s\n' "$res" "${out#$ROOT/}"
