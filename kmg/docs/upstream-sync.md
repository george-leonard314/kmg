# Upstream sync ritual

This repository is a full-history fork of siyuan-note/siyuan with the KMG
transform committed on the `kmg` branch; everything KMG adds lives under
`kmg/`. Syncing means: apply the same transform to upstream's new tag on a
branch, then merge that with `-X theirs` and let `check-rename.sh` catch a lost
hunk. Do it when an upstream release is worth having, never automatically.

Upstream's tag has no `kmg/` directory, so the transform runs from a copy.

```sh
cd ~/git/kmg/siyuan                      # this repository, branch kmg
git fetch upstream --tags
git log --oneline "$(cut -d' ' -f2 kmg/UPSTREAM)..v<tag>"   # what changed
rebrand=$(mktemp -d) && cp -a kmg/rebrand/. "$rebrand"
git checkout -b sync v<tag>
"$rebrand/rename.sh" "$PWD"
git add -A && git commit -m "Apply KMG transform to upstream v<tag>"
git checkout kmg
git merge --no-commit -X theirs sync
echo "upstream $(git rev-parse v<tag>)" > kmg/UPSTREAM
kmg/rebrand/check-rename.sh
git commit -m "Merge upstream v<tag>"
git branch -D sync
```

Then set `pkgver=<tag>.kmg1` and `_tag=v<tag>-kmg1` in
`kmg/packaging/arch/PKGBUILD`, bump `_electron` if `app/package.json` moved to
a newer major, commit, and release:

```sh
git tag v<tag>-kmg1 && git push origin kmg v<tag>-kmg1
```

The tag starts `.github/workflows/kmg-package.yml`, which builds the package and
attaches it to the tag's GitHub release. ChiropteraOS downloads the latest
release on its next packages run (`gh workflow run packages.yml -R
george-leonard314/ChiropteraOS` to start one). To build locally instead:

```sh
cd kmg/packaging/arch
KMG_REPO=file://$HOME/git/kmg/siyuan makepkg -f   # drop KMG_REPO to build from GitHub
sudo pacman -U kmg-*.pkg.tar.zst
```

Rebuilds without an upstream change bump the `kmg<N>` suffix.
