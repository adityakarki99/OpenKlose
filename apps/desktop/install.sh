#!/bin/sh
# Installs the Klose desktop app on macOS:
#
#   curl -fsSL https://github.com/adityakarki99/OpenKlose/releases/latest/download/install.sh | sh
#
# Downloads the .dmg for this Mac from the latest GitHub release, checks it
# against the release's SHA256SUMS, copies Klose.app into /Applications (or
# ~/Applications when that isn't writable), and opens it — the first launch
# walks you through setup. Run again, it updates an older copy and leaves a
# current one alone. Adapted from antiburn's install.sh.
#
#   KLOSE_VERSION=0.3.0   install that version instead of the latest
#   KLOSE_FORCE=1         reinstall even when this version is already installed
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

# A terminal running under Rosetta reports x86_64 on an Apple Silicon Mac;
# the kernel knows better.
machine="$(uname -m)"
if [ "$machine" = "x86_64" ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then
  machine=arm64
fi
case "$machine" in
  arm64) arch=aarch64; chip="Apple Silicon" ;;
  x86_64) arch=x64; chip="Intel" ;;
  *) fail "unsupported CPU: $machine" ;;
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
say "Release      $tag ($chip Mac)"

dest="${KLOSE_INSTALL_DIR:-/Applications}"
[ -w "$dest" ] || [ -n "${KLOSE_INSTALL_DIR:-}" ] || dest="$HOME/Applications"

# Already this version? Just open it.
for app in "$dest/Klose.app" /Applications/Klose.app "$HOME/Applications/Klose.app"; do
  [ -d "$app" ] || continue
  installed="$(defaults read "$app/Contents/Info" CFBundleShortVersionString 2>/dev/null || true)"
  if [ -z "${KLOSE_FORCE:-}" ] && [ "$installed" = "$version" ]; then
    say "Installed    $app ($version) is already the latest"
    if [ -z "${KLOSE_NO_LAUNCH:-}" ]; then
      open "$app"
      printf '\nKlose is in your menu bar, up by the clock.\n\n'
    fi
    exit 0
  fi
  [ -n "$installed" ] && say "Found        $app ($installed), will be replaced"
  break
done

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

mkdir -p "$dest"
# Quit a running copy so the new one can take its place.
osascript -e 'tell application id "dev.klose.desktop" to quit' >/dev/null 2>&1 || true
staging="$dest/.Klose.app.installing"
rm -rf "$staging"
ditto "$mount/Klose.app" "$staging" || fail "couldn't copy Klose.app into $dest"
rm -rf "$dest/Klose.app"
mv "$staging" "$dest/Klose.app"
# The download was checked against the release's checksums above, so Gatekeeper's
# "downloaded from the internet" prompt has nothing to add (curl sets no
# quarantine flag anyway; this covers a dmg that was opened in Finder first).
xattr -rd com.apple.quarantine "$dest/Klose.app" >/dev/null 2>&1 || true
say "Installed    $dest/Klose.app ($version)"

if [ -z "${KLOSE_NO_LAUNCH:-}" ]; then
  open "$dest/Klose.app"
  printf '\nKlose is in your menu bar, up by the clock. Setup opens on first launch;\n'
  printf 'then, in Claude Code: /klose audit every page against our design system\n\n'
else
  printf '\nOpen Klose from %s when you are ready.\n\n' "$dest"
fi
