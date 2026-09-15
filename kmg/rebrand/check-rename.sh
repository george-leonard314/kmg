#!/usr/bin/env bash
# Fails if the upstream name still shows anywhere a user would see it.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
tree=${1:-$here/../..}
cd "$tree"
status=0

# Files whose text is shown to the user.
visible=$(find app/appearance/langs app/electron app/src/assets/template -type f; ls app/electron-builder.yml app/electron-builder-linux*.yml app/stage/manifest.webmanifest)
left=$(echo "$visible" | xargs grep -HnP '\bSiYuan\b(?!-Kernel)|思源(?!黑体|宋体|黑體|宋體|等宽)' 2>/dev/null || true)
if [ -n "$left" ]; then echo "check-rename: leftover names:" >&2; echo "$left" >&2; status=1; fi

if grep -Hn '"\.config", "siyuan"' kernel/util/working.go kernel/util/working_mobile.go app/electron/main.js; then
  echo "check-rename: config dir still .config/siyuan" >&2; status=1
fi
upstream_ci=$(find .github -type f ! -path '.github/workflows/kmg-*.yml' 2>/dev/null || true)
[ -n "$upstream_ci" ] && { echo "check-rename: upstream CI left in .github:" >&2; echo "$upstream_ci" >&2; status=1; }
grep -q '"desktopName": "kmg.desktop"' app/package.json || { echo "check-rename: desktopName is not kmg.desktop" >&2; status=1; }
grep -q 'GNU AFFERO GENERAL PUBLIC LICENSE' LICENSE || { echo "check-rename: LICENSE damaged" >&2; status=1; }
grep -q 'kmg-banner' README.md || { echo "check-rename: README banner missing" >&2; status=1; }

[ "$status" -eq 0 ] && echo "check-rename: ok"
exit "$status"
