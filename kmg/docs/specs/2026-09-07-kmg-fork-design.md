# KMG — private SiYuan fork replacing Obsidian

Date: 2026-09-07
Status: approved design, awaiting user review of this document

> 2026-09-15: the separate workspace repository was folded into this one.
> What section 4 places in the workspace now lives under `kmg/` on the
> `kmg` branch, and the Arch package is built by this repository's CI.

## 1. Goal

Replace the Obsidian vault "Main" (`~/LocalDisk/.sync/Main`, ~650 notes) with
KMG, a personally rebranded build of SiYuan 3.8.3, on one Arch laptop and three
Android devices (Tablet, Nethunter Phone, main phone). KMG must:

- carry no SiYuan branding anywhere a user can see it;
- make no network requests to SiYuan servers, marketplace, or update hosts;
- sync between devices with SiYuan's own engine against a self-hosted S3 or
  WebDAV server, with no SiYuan account (server hosting is a later project);
- look as close to pixel-identical to the current Obsidian setup (Chiroptera
  theme + 5 CSS snippets) as SiYuan's DOM allows;
- keep document and folder icons, folder colours, coloured tags, vault logo
  banner and per-note looks;
- record audio into notes on desktop and mobile and auto-transcribe it;
- install on a fresh Arch machine with `paru -Syu kmg-chiroptera` from a
  pacman repository on the user's Proxmox server, and update the Android
  devices through Obtainium from the same server.

Private use only. The repository is reachable only on the home LAN and later
over WireGuard, so no AGPL distribution obligation is triggered. If the repo is
ever made public, the fork source must be published with it.

## 2. Facts established from the source (v3.8.3, commit 8641553)

- Product identity is separate from internal identifiers. User-visible
  "SiYuan"/"思源" strings: ~841 across 21 language files, ~50 in `app/src`,
  a handful in the Electron main process and kernel. Internal names
  (`window.siyuan`, `.sy` format, `siyuan-*` IPC constants, Go import paths)
  number ~18k and are never shown; they stay untouched.
- Every cloud hostname is defined once in `kernel/util/cloud.go`. Periodic
  outbound jobs are started in `kernel/job/cron.go` (three lines). The
  version/announcement/bazaar-hash fetch is `kernel/util/rhy.go`.
- `kernel/util/runtime.go` exports `DisableFeature(name)` with zero in-tree
  callers; the frontend already reads the resulting list on desktop and
  mobile (`isDisabledFeature`, `isBazaarAvailable`).
- The Account UI is a group registered by one call inside
  `app/src/config/tabs/syncTab.ts` (`registerAccountGroup`), shared by desktop
  and mobile.
- Third-party sync (S3/WebDAV/local) is gated by `IsPaidUser()` in
  `kernel/model/sync.go` and `needSubscribe.ts` on the frontend. The cloud
  config builder only reads the user object for the official provider.
- Themes: `theme.json` + `theme.css` (+ optional `theme.js`) under
  `conf/appearance/themes/<name>/`, cascading over the built-in `midnight`.
  167 `--b3-*` variables define the palette. `<html>` carries
  `data-frontend`, `data-theme-mode`. The editor root `.protyle` receives every
  `custom-*` document attribute and `data-notebook-id`. File tree rows are
  `li.b3-list-item[data-type="navigation-file"][data-name][data-node-id]`.
- Audio recording exists on desktop and mobile in the editor breadcrumb menu
  (`app/src/protyle/breadcrumb/index.ts`, `RecordMedia.ts`): PCM → MP3 →
  `/upload` → `NodeAudio` block `<audio src="assets/record<ts>.mp3">`.
- Plugins: `data/plugins/<name>/{plugin.json,index.js,index.css}`, enabled in
  `data/storage/petal/petals.json`. `addTopBar` renders on desktop toolbar and
  in the mobile More menu; `protyleSlash` covers both slash menus.
- Android: `siyuan-android` is a Gradle `:app` module wrapping a gomobile
  `kernel.aar` (`gomobile bind -target android/arm64 -androidapi 26`) and an
  `app.zip` of the built frontend. Needs NDK 28.2.13676358, JDK 21, compileSdk
  36, minSdk 26, Gradle 9.7.1. App label is set per flavor in
  `flavors.gradle`; identity in `applicationId`, FileProvider authority,
  `shortcuts.xml`, notification channels, `Theme.SiYuan` styles, WebView UA.
- This laptop: Go 1.27, Node 26, pnpm 11, JDK 21, Android SDK at
  `/opt/android-sdk` (NDK and platforms not yet installed), NVIDIA GTX 1660 Ti
  6 GB, 16 cores, 30 GB RAM.

## 3. Vault facts that size the migration

| Feature | Present in vault |
|---|---|
| Notes / images / PDFs | 650 / 171 / 24 |
| Dataview | 1 file (heatmap sample under `99 - Meta`) |
| Excalidraw | 1 drawing (+1 in trash) |
| Templater | 3 templates in `99 - Meta/Templates` |
| Daily notes | folder `06 - Daily` empty; template + settings exist |
| `cssclasses` | 49 notes, all empty |
| File Color | 11 top-level folders, one colour each |
| Iconize | 50 folder/note icon assignments |
| Colored Tags | automatic palette by tag name |
| Banners (simple-banner) | 10 notes |
| Fonts actually rendered | Noto Sans Mono (Hack Nerd Font not installed), JetBrainsMono Nerd Font Mono for code |

## 4. Workspace layout

```
~/git/kmg/                      git repo (this spec lives here)
  siyuan/                       fork of siyuan-note/siyuan, branch kmg from v3.8.3
  siyuan-android/               fork of siyuan-note/siyuan-android, branch kmg
  kmg/
    rebrand/                    rename script + KMG icon sources
    theme/kmg-chiroptera/       theme.json, theme.css, theme.js
    plugins/kmg-transcribe/     bundled plugin (TypeScript → index.js)
    whisper/                    kmg-whisper service (Python, uv)
    migrate/                    Obsidian → KMG import scripts
    packaging/arch/             PKGBUILD, repo publish script
    packaging/android/          keystore handling, Obtainium feed script
    scripts/                    build-desktop.sh, build-android.sh, test-*.sh
  docs/superpowers/specs/
```

The two forks are separate git repositories inside the workspace (not
submodules), each with an `upstream` remote. The workspace repo ignores them
and records their pinned commit in `kmg/UPSTREAM` for reproducibility.

## 5. Components

### 5.1 Rebrand (`kmg/rebrand/`)

A script `rename.sh` applied on the `kmg` branch after every upstream merge,
never hand-edited into the tree. It rewrites user-visible strings only:

- `app/appearance/langs/*.json`: `SiYuan` → `KMG`, `思源笔记`/`思源` → `KMG`.
- `app/package.json` name/description/homepage; all six
  `app/electron-builder*.yml` (`productName`, `appId: org.kmg.notes`,
  `executableName: kmg`, desktop entry `Name=KMG`, artifact names).
- `app/electron/main.js`: config dir `~/.config/kmg`, app user model id,
  protocol client `kmg`, window title, user agent, product name, help menu
  removed, error dialogs.
- `app/electron/window.js`, `init.html`, `workspace.html`, `boot.html`,
  `error.html` titles and URLs.
- `app/src/assets/template/*/index.tpl` titles; `app/stage/manifest.webmanifest`;
  `app/stage/service-worker.js` cache name.
- `app/src`: `siyuan://` and `web+siyuan://` → `kmg://`, `web+kmg://`
  (`util/uri.ts`, `util/pathName.ts`, `editor/openLink.ts`,
  `protyle/util/compatibility.ts`); About tab; export/import menu labels.
- Kernel: `kernel/util/working.go` conf dir `.config/kmg`, default workspace
  `~/KMG`, boot banner, flag help; `kernel/util/working_mobile.go` same;
  `kernel/util/path.go` user agent; `kernel/treenode/node.go` and
  `kernel/model/template_doc_tree_render.go` link scheme.
- Icons: a KMG monogram SVG rendered to every required size
  (`app/src/assets/icon*`, `app/stage/icon*`, `app/electron/icon.png`,
  Android adaptive icon foreground/monochrome, notification icon).
- `app/guide/` (onboarding notebook) removed from `extraResources`.
- Android: `applicationId`/`namespace` `org.kmg.notes`, `app_name` KMG in all
  flavors, `shortcuts.xml` targets, `Theme.KMG` styles, notification channel
  strings, UA, `siyuan` scheme → `kmg`, archive names `kmg-<ver>`.

Unchanged: Java package `org.b3log.siyuan` for source files, `.sy` format,
`window.siyuan`, IPC constants, Go module paths, port 6806.

### 5.2 De-cloud

Build-time, on the `kmg` branch, as ordinary commits:

- `kernel/job/cron.go`: remove `RefreshRhyResultJob`, `RefreshCheckJob2H`,
  `RefreshCheckJob6H` scheduling.
- `kernel/util/rhy.go` `getRhyResult0()`: return empty map immediately.
- `kernel/model/sync.go`: drop the `nil == Conf.GetUser()` early return and
  the `!IsPaidUser()` branch for WebDAV/S3/local. `IsPaidUser()` and
  `IsSubscriber()` in `kernel/model/conf.go` return true.
  `kernel/api/system.go` no longer masks sync conf.
- `kernel/conf/sync.go`: default provider S3 instead of official.
- `kernel/model/conf.go` init: `util.DisableFeature("bazaar")`,
  `util.DisableFeature("account")`.
- `kernel/api/router.go`: unregister `/api/account/*`, `/api/cloud/*`,
  `/api/bazaar/*`, `/api/system/checkUpdate`, cloud-user routes.
- `kernel/bazaar/stage.go`: `isBazaarOnline` false, listing returns empty.
- Frontend (webpack `ifdef-loader` flag `CLOUD=false`): `registerAccountGroup`
  call removed; official provider removed from `SYNC_PROVIDER_DEFS`;
  `needSubscribe()` false / `isPaidUser()` true; About tab update button
  removed; `isBazaarAvailableForFrontend` honours the disabled feature on
  desktop too; feedback/community/download URLs blanked in
  `app/electron/window.js`; `app/electron/appleSilicon.js` nag removed.
- AI: untouched. Ships with no provider configured; makes no requests unless
  the user configures one. Agent web search likewise requires a user key.

Acceptance: `scripts/test-network-silence.sh` runs the built desktop app for
10 minutes under `tcpdump` on all interfaces, filtering out loopback, and
fails on any packet. Also greps the kernel binary and frontend bundle for
`b3log`, `liuyun`, `ld246`, `siyuan-sync`, `bazaar.` and fails on a hit.

### 5.3 Theme `kmg-chiroptera` (`kmg/theme/`)

Shipped built-in at `app/appearance/themes/kmg-chiroptera/` and set as the
default dark theme and default mode in `kernel/conf/appearance.go`.

`theme.css` redefines the 167 variables from Chiroptera's palette (AMOLED
black base `#000/#080808/#111`, text `#e0e0e0`, accent = Chiroptera's red
family) and restyles: document tree rows and hover, tab bar and active tab,
toolbar, dock, headings h1–h6 sizes/colours, blockquote and callouts (five
subtypes), code blocks (Dracula-derived hljs theme selected as
`codeBlockThemeDark`), inline code, tables, task list checkboxes, tags, links
and block refs, horizontal rule, images (6px radius), search highlights,
menus, dialogs, settings. Fonts: UI and editor `Noto Sans Mono`, code
`JetBrainsMono Nerd Font Mono`, defined in one `:root` block so a switch to
Hack Nerd Font is a one-line change. Mobile branches use
`html[data-frontend="mobile"]`.

`theme.js` (with `window.destroyTheme`) provides:

- Folder colours: for each of the 11 folder names, sets `data-kmg-color` on
  the row and on every descendant row (cascade on, as in File Color); CSS
  colours text and chevron. Mapping table lives in `theme.js`, editable.
- Vault logo banner: hides the row of document `00 - VaultLogo` and renders
  the embedded PNG (from `vault-logo.css`) as a banner above the tree.
- Coloured tags: assigns a hue per tag text with the Colored Tags
  "adaptive-soft" algorithm and writes a `--kmg-tag-h` variable on each tag
  span; CSS derives background and text colours.
- Per-note looks: `.protyle[custom-css~="page-manila"]` etc. are pure CSS,
  ported from `Notebook Backgrounds.css` (page-white/manila/blueprint/grid,
  pen-* colours, embed variants) and `Daily Note Themes.css` (standard +
  seven weekday palettes). `theme.js` sets `custom-css` to the weekday name
  on daily-note documents (detected by the `daily` tag or the `YYYYMMDD`
  title) when missing.
- General tweaks from `CyanVoxel's General Tweaks.css`: link decoration,
  heading margin, hr spacing, image border/radius, callout radius, centred
  images/titles via `custom-css` classes `center-images`, `center-titles`,
  `image-borders`, `no-embed-border`.

Fidelity process: `scripts/screenshot-compare.sh` captures the same note in
Obsidian and KMG (Hyprland `grim`) for a fixed checklist of views (tree,
mixed-content note, tabs, settings, search, mobile via tablet screenshot) and
stores pairs under `kmg/theme/compare/`. Iterate until the user signs off
each view.

### 5.4 Icons and covers

Migration step (§5.7) reads `.obsidian/plugins/obsidian-icon-folder/data.json`
(50 entries), locates each icon's SVG in `.obsidian/icons/<pack>/`, renders
it to PNG at 64px with the theme's text colour, stores it under
`data/emojis/kmg/<name>.png`, and sets the document icon through
`/api/attr/setBlockAttrs`. Documents with a `banner:` field get the image as
a native document cover. Folders in SiYuan are documents with children, so
folder icons work the same way.

### 5.5 Recording and transcription

Recording: the existing breadcrumb-menu recorder is kept. The bundled plugin
adds a top-bar Record/Stop button (desktop toolbar, mobile More menu) that
calls the same code path, so behaviour is identical.

Plugin `kmg-transcribe` (`kmg/plugins/kmg-transcribe/`, TypeScript, esbuild →
`index.js`, `siyuan` external):

- Watches open editors (`loaded-protyle-static` + MutationObserver on
  `.protyle-wysiwyg`) for new `NodeAudio` blocks whose `src` matches
  `assets/record*.mp3` and lacks `custom-kmg-transcribed`.
- Fetches the asset, POSTs it to the Whisper service, inserts the returned
  text as a paragraph block after the audio block via
  `/api/block/insertBlock` (`previousID` = audio block), and sets
  `custom-kmg-transcribed=<model>` on the audio block.
- On failure sets `custom-kmg-transcribe=pending`; retries pending blocks
  when a document loads and on a 5-minute timer while the app is open.
- Block menu entry "Transcribe" (`click-blockicon`) for manual runs and
  re-runs. Settings: service URL, token, language (auto default).
- Bundled: the kernel copies `<WorkingDir>/appearance/bundled-plugins/*` into
  `data/plugins/` on boot when missing or older (new small function in
  `kernel/model/plugin.go`) and enables them in `petals.json`. Works on
  desktop and Android identically because both ship `appearance/`.

Service `kmg-whisper` (`kmg/whisper/`, Python 3.12 managed with uv,
faster-whisper, CUDA):

- `POST /transcribe` multipart `file`, optional `language`; returns
  `{text, language, duration, segments[]}`. Bearer token required.
- Default model `large-v3-turbo` int8_float16 on the GTX 1660 Ti, falling back
  to `small` on CPU if CUDA is unavailable. Model choice is a config value.
- systemd user unit on the laptop, bound to `0.0.0.0:8790`, so the Android
  devices reach it on home WiFi. Moves to the Proxmox box later without plugin
  changes (URL setting).

### 5.6 Packaging and distribution

Arch: `kmg/packaging/arch/PKGBUILD` for package `kmg-chiroptera` builds the
frontend and kernel and installs to `/opt/kmg` with `/usr/bin/kmg`, a desktop
entry and icons (no AppImage). `scripts/publish.sh` runs `makepkg`, signs
with the user's GPG key, `repo-add`s into `kmg.db.tar.zst`, and rsyncs the
repo directory to the Proxmox host. The Proxmox side is a static HTTP
directory (nginx in a small container); its address is filled in when the
user provides it. Client config on a fresh Arch install:

```
[kmg]
SigLevel = Required
Server = http://<proxmox-host>/kmg/$arch
```

Android: `scripts/build-android.sh` installs NDK 28.2.13676358 and platform
36 through `sdkmanager` if absent, builds the frontend, zips `app.zip`, runs
`gomobile bind`, copies `kernel.aar`, and runs `./gradlew
assembleOfficialRelease` signed with a personal keystore kept outside git.
`publish.sh` also uploads the APK and a small JSON index to the same server;
Obtainium on each device points at that index.

Version scheme: `<upstream>.kmg<n>` (e.g. `3.8.3.kmg1`) so pacman ordering
follows upstream and rebuilds bump `n`.

### 5.7 Migration (`kmg/migrate/`)

Runs once into a fresh workspace `~/KMG/Main` (reruns are allowed until the
user switches; the Obsidian vault is never modified):

1. Prepare Markdown: flatten attachments into `assets/`, rewrite
   `![[embed]]` to `![](assets/...)`, convert `banner:` front matter to a
   cover marker, drop empty `cssclasses`, keep tags.
2. Import through `/api/import/importStdMd` (script exists at
   `~/git/claude-misc/obsidian2siyuan.sh`; is moved into this repo and
   extended).
3. Fix asset-name suffixes as previously discovered.
4. Apply icons and covers (§5.4).
5. Rewrite the 3 Templater templates into SiYuan template syntax under
   `data/templates/`; configure daily notes (notebook `06 - Daily`, path
   `/{{now | date "20060102"}}`, template Daily) and the `daily` tag.
6. Excalidraw and the Dataview heatmap sample: evaluate the available SiYuan
   community plugins at migration time (sideloaded, since the marketplace is
   off) and report which work; convert the one drawing if a plugin fits,
   otherwise keep its PNG export. Not a blocking item.
7. Verification report: counts of docs, assets, unresolved links, icons and
   covers applied, listed per top-level folder.

### 5.8 Upstream update procedure

On request only. `scripts/update-upstream.sh <tag>`: snapshot the workspace,
`git fetch upstream` in both forks, `git merge <tag>` on `kmg`, rerun
`rename.sh`, rebuild, run the network-silence test and the screenshot
checklist, bump the PKGBUILD, publish. Conflicts are reported to the user
before resolution when they touch the de-cloud patches.

## 6. Order of work

1. Workspace, forks, rebrand script, de-cloud, desktop build, PKGBUILD,
   local `pacman -U` install. Deliverable: KMG on the laptop.
2. Theme, iterated with screenshots. Deliverable: signed-off desktop look.
3. Android build, keystore, install on the Tablet first, then both phones.
4. Whisper service and transcription plugin.
5. Migration into `~/KMG/Main`, verification report.
6. Publish pipeline to the Proxmox host and Obtainium feed (needs the host
   address; until then packages install locally).

Sync server hosting is a separate later project.

## 7. Testing

- Go: unit tests for the paid-gate patch (sync enabled with nil user for S3
  and WebDAV), the bundled-plugin copy, and `rhy` returning empty.
- Frontend: existing `pnpm test` suite must stay green after the rename.
- Rename: `rename.sh --check` fails if any user-visible `SiYuan`/`思源`
  remains in langs, electron, stage or Android resources.
- Network silence: §5.2 acceptance test, run on every build.
- Plugin: tests against a scratch workspace kernel with a mocked Whisper
  endpoint (insert, pending, retry, manual transcribe).
- Whisper service: request test with a bundled 5-second sample.
- Theme: screenshot checklist, user sign-off per view.
- Android: install and boot on the Tablet, open the migrated workspace,
  record and transcribe one note over WiFi.

## 8. Out of scope

Sync server hosting and WireGuard; the other Obsidian plugins not listed in
§3; iOS, macOS, Windows builds; making the repository public.
