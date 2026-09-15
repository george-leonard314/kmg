#!/usr/bin/env bash
# Idempotent transform: turn an upstream SiYuan tree into KMG. Run on the
# `kmg` branch after every upstream merge; safe to re-run. For an upstream tag,
# which has no kmg/ directory, run a copy and pass the tree:
# see kmg/docs/upstream-sync.md.
#
# Only what a user sees is rewritten: product name, app id, config directory,
# default workspace, user agent, icons. Internal identifiers stay as upstream
# has them so data, plugins and merges keep working: window.siyuan, the .sy
# format, siyuan-* IPC names, Go import paths, SiYuan-Kernel, the
# siyuan:// link scheme (it is stored inside documents), and every AGPL
# header and notice.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
tree=${1:-$here/../..}
cd "$tree"
[[ -d app && -d kernel ]] || { echo "rename: $tree is not a SiYuan tree" >&2; exit 1; }

# 思源黑体 / 思源宋体 are font names (Source Han Sans/Serif), not the product.
cjk='s/思源筆記|思源笔记/KMG/g; s/思源(?!黑体|宋体|黑體|宋體|等宽)/KMG/g'
name='s/\bSiYuan\b(?!-Kernel)/KMG/g'

# 1. Upstream CI; it would run on our pushes. KMG's own workflows are kmg-*.yml.
if [[ -d .github ]]; then
  find .github -type f ! -path '.github/workflows/kmg-*.yml' -delete
  find .github -depth -type d -empty -delete
fi

# 2. Translations: every user-visible string.
perl -pi -e "$name; $cjk" app/appearance/langs/*.json

# 3. Electron main process, windows and error pages: identity, config dir.
perl -pi -e '
  s/"\.config", "siyuan"/".config", "kmg"/g;
  s/org\.b3log\.siyuan/org.kmg.notes/g;
  '"$name; $cjk"'
' app/electron/*.js app/electron/*.html

# 4. Packaging metadata.
perl -pi -e '
  s/^productName: .*/productName: "KMG"/;
  s/^appId: .*/appId: "org.kmg.notes"/;
  s/^artifactName: "siyuan-/artifactName: "kmg-/;
  s/executableName: "siyuan"/executableName: "kmg"/;
  s/Name: "SiYuan"/Name: "KMG"/;
' app/electron-builder*.yml
perl -pi -e '
  s/"name": "SiYuan"/"name": "KMG"/;
  s|"homepage": "https://b3log\.org/siyuan"|"homepage": "https://github.com/george-leonard314/kmg"|;
  s/"desktopName": "[^"]*"/"desktopName": "kmg.desktop"/;
' app/package.json

# 5. Frontend: titles, About, export labels, default dynamic icon text.
#    Tests and type declarations keep upstream wording; nothing there is shown.
find app/src -type f \( -name '*.ts' -o -name '*.tpl' -o -name '*.html' -o -name '*.scss' \) \
  ! -name '*.test.ts' ! -name '*.d.ts' -print0 \
  | xargs -0 perl -pi -e "$name; $cjk"

# 6. Web app manifest and service worker cache.
perl -pi -e "$name; $cjk; s/\"short_name\": \"siyuan\"/\"short_name\": \"kmg\"/; s/org\.b3log\.siyuan/org.kmg.notes/g" app/stage/manifest.webmanifest
perl -pi -e 's/\x60siyuan-\x24/\x60kmg-\x24/' app/stage/service-worker.js

# 7. Kernel: config dir, default workspace, boot banner, user agent.
perl -pi -e '
  s/"\.config", "siyuan"/".config", "kmg"/g;
  s|home/\.config/siyuan/|home/.config/kmg/|g;
  s/"SiYuan"/"KMG"/g;
' kernel/util/working.go kernel/util/working_mobile.go
perl -pi -e 's|"SiYuan/"|"KMG/"|' kernel/util/path.go

# 8. Icons from the monogram.
for s in 16 32 48 64 128 256 512; do
  rsvg-convert -w "$s" -h "$s" "$here/icon.svg" -o "app/src/assets/icon/${s}x${s}.png"
done
rsvg-convert -w 512 -h 512 "$here/icon.svg" -o app/stage/icon.png
cp app/stage/icon.png app/stage/icon-large.png
cp app/stage/icon.png app/electron/icon.png
cp "$here/icon.svg" app/stage/icon.svg

# 9. README banner crediting upstream, inserted once.
if ! grep -q '<!-- kmg-banner -->' README.md; then
  {
    cat <<'BANNER'
<!-- kmg-banner -->
# KMG

A personal rebrand of SiYuan by the SiYuan team and contributors, AGPL-3.0:
https://github.com/siyuan-note/siyuan

Upstream is tracked as the `upstream` git remote. Everything KMG adds lives under
`kmg/`: `kmg/rebrand/rename.sh` is the transform applied after each upstream
merge and `kmg/rebrand/check-rename.sh` verifies it, `kmg/docs/upstream-sync.md`
is the merge procedure, and `kmg/packaging/arch` builds the Arch package, which
CI attaches to each `v*-kmg*` release. Internal identifiers, the `.sy` format
and the `siyuan://` link scheme are unchanged, so upstream plugins and data work.
The rest of this README is the upstream documentation.

---

BANNER
    cat README.md
  } > README.md.new
  mv README.md.new README.md
fi

echo "rename: done"
