#!/bin/bash
# KMG launcher: run the packaged app on the system Electron.
set -e
_APPDIR=/usr/lib/kmg
_ELECTRON=electron43

export ELECTRON_IS_DEV=0
export ELECTRON_FORCE_IS_PACKAGED=true
export NODE_ENV=production
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
# Native Wayland when available; lets the compositor match the window to kmg.desktop.
export ELECTRON_OZONE_PLATFORM_HINT="${ELECTRON_OZONE_PLATFORM_HINT:-auto}"
export CHROME_DESKTOP=kmg.desktop

# Extra Chromium/Electron flags, one per line, comments allowed.
flags=()
for f in "$XDG_CONFIG_HOME/electron-flags.conf" "$XDG_CONFIG_HOME/kmg-flags.conf"; do
  [[ -f $f ]] || continue
  while read -r line || [[ -n $line ]]; do
    [[ $line =~ ^[[:space:]]*# || -z $line ]] && continue
    read -ra words <<< "$line"
    flags+=("${words[@]}")
  done < "$f"
done

cd "$_APPDIR"
exec "$_ELECTRON" "${flags[@]}" "$_APPDIR/app" "$@"
