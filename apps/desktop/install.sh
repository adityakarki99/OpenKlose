#!/bin/sh
# Installs the Klose desktop app on macOS:
#
#   curl -fsSL https://github.com/adityakarki99/OpenKlose/releases/latest/download/install.sh | sh
#
# Downloads the .dmg for this Mac from the latest GitHub release, checks it
# against the release's SHA256SUMS, copies Klose.app into /Applications (or
# ~/Applications when that isn't writable), and opens it — the first launch
# walks you through setup. Adapted from antiburn's install.sh.
#
#   KLOSE_VERSION=0.3.0   install that version instead of the latest
#   KLOSE_NO_LAUNCH=1     don't open the app afterwards
#   KLOSE_INSTALL_DIR=…   install into that folder instead of /Applications
#   KLOSE_DOWNLOAD_BASE=… fetch the release files from there (for testing a
#                         build before it is released; needs KLOSE_VERSION)
set -eu

REPO="adityakarki99/OpenKlose"

say() { printf '  %s\n' "$*"; }
fail() { printf 'klose install: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "this installer is for macOS. On Windows, run in PowerShell:
  irm https://github.com/$REPO/releases/latest/download/install.ps1 | iex"
for tool in curl shasum hdiutil ditto; do
  command -v "$tool" >/dev/null 2>&1 || fail "needs $tool"
done
major="$(sw_vers -productVersion | cut -d. -f1)"
[ "$major" -ge 11 ] || fail "Klose needs macOS 11 or later"

case "$(uname -m)" in
  arm64) arch=aarch64 ;;
  x86_64) arch=x64 ;;
  *) fail "unsupported CPU: $(uname -m)" ;;
esac

printf '\nKlose — a design canvas for your coding agent\n\n'

# The latest release is the one GitHub's /releases/latest redirects to.
if [ -n "${KLOSE_VERSION:-}" ]; then
  tag="klose-app-v${KLOSE_VERSION#v}"
else
  latest="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest")" ||
    fail "couldn't reach GitHub"
  tag="${latest##*/}"
fi
case "$tag" in klose-app-v*) ;; *) fail "the latest release ($tag) isn't a desktop app release" ;; esac
version="${tag#klose-app-v}"
say "Release      $tag"

work="$(mktemp -d)"
mount=""
cleanup() {
  [ -n "$mount" ] && hdiutil detach -quiet "$mount" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

asset="Klose_${version}_${arch}.dmg"
base="${KLOSE_DOWNLOAD_BASE:-https://github.com/$REPO/releases/download/$tag}"
curl -fsSL "$base/SHA256SUMS" -o "$work/SHA256SUMS" || fail "couldn't download SHA256SUMS"
curl -fL --progress-bar "$base/$asset" -o "$work/$asset" || fail "couldn't download $asset"
expected="$(awk -v f="$asset" '$2 == f || $2 == "*"f { print $1 }' "$work/SHA256SUMS")"
[ -n "$expected" ] || fail "$asset isn't listed in SHA256SUMS"
actual="$(shasum -a 256 "$work/$asset" | awk '{ print $1 }')"
[ "$expected" = "$actual" ] || fail "checksum mismatch for $asset (expected $expected, got $actual)"
say "Verified     SHA-256 of $asset"

mount="$work/mnt"
mkdir -p "$mount"
hdiutil attach -quiet -nobrowse -readonly -mountpoint "$mount" "$work/$asset" || fail "couldn't open $asset"
[ -d "$mount/Klose.app" ] || fail "Klose.app isn't in $asset"

dest="${KLOSE_INSTALL_DIR:-/Applications}"
[ -w "$dest" ] || [ -n "${KLOSE_INSTALL_DIR:-}" ] || { dest="$HOME/Applications"; mkdir -p "$dest"; }
mkdir -p "$dest"
# Quit a running copy so the new one can take its place.
osascript -e 'tell application id "dev.klose.desktop" to quit' >/dev/null 2>&1 || true
staging="$dest/.Klose.app.installing"
rm -rf "$staging"
ditto "$mount/Klose.app" "$staging" || fail "couldn't copy Klose.app into $dest"
rm -rf "$dest/Klose.app"
mv "$staging" "$dest/Klose.app"
say "Installed    $dest/Klose.app ($version)"

if [ -z "${KLOSE_NO_LAUNCH:-}" ]; then
  open "$dest/Klose.app"
  printf '\nKlose is in your menu bar, up by the clock. Setup opens on first launch.\n\n'
else
  printf '\nOpen Klose from %s when you are ready.\n\n' "$dest"
fi
