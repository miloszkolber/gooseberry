#!/bin/sh
set -eu

VERSION=${GOOSE_VERSION:-$(cat "$(dirname "$0")/version")}
EXPECTED_VERSION=${VERSION#v}
SOURCE_COMMIT=$(tr -d '[:space:]' < "$(dirname "$0")/source-commit")
case "$VERSION" in
  v[0-9]*.[0-9]*.[0-9]*) ;;
  *) echo "invalid Goose version pin: $VERSION" >&2; exit 1 ;;
esac
printf '%s\n' "$VERSION" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || { echo "invalid Goose version pin: $VERSION" >&2; exit 1; }
printf '%s\n' "$SOURCE_COMMIT" | grep -Eq '^[0-9a-f]{40}$' || { echo "invalid Goose source commit pin" >&2; exit 1; }
# Keep the current distribution repository until its remote is renamed. Operators may override it
# with GOOSE_REPOSITORY after that cutover.
REPOSITORY=${GOOSE_REPOSITORY:-miloszkolber/pixie}
RELEASE_BASE=${GOOSE_RELEASE_BASE:-https://github.com/${REPOSITORY}/releases/download/${VERSION}}
PREFIX=${GOOSE_PREFIX:-/usr/local/bin}
TARGET=${GOOSE_TARGET:-${PREFIX}/goose}
TARGET_HOME=${GOOSE_HOME:-${HOME:-}}
CONFIG_OWNER=
CONFIG_GROUP=
if [ -z "${GOOSE_HOME:-}" ] && [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ] && command -v getent >/dev/null 2>&1; then
  sudo_record=$(getent passwd "$SUDO_USER" || true)
  TARGET_HOME=$(printf '%s\n' "$sudo_record" | cut -d: -f6)
  CONFIG_OWNER=$(printf '%s\n' "$sudo_record" | cut -d: -f3)
  CONFIG_GROUP=$(printf '%s\n' "$sudo_record" | cut -d: -f4)
fi
if [ "$(id -u)" -eq 0 ] && [ -n "${GOOSE_HOME:-}" ] && [ -d "$TARGET_HOME" ] && command -v stat >/dev/null 2>&1; then
  CONFIG_OWNER=$(stat -c '%u' "$TARGET_HOME")
  CONFIG_GROUP=$(stat -c '%g' "$TARGET_HOME")
fi

case "$(uname -m)" in
  x86_64|amd64) asset="gooseberry-goose-${VERSION}-linux-x86_64.tar.gz" ;;
  aarch64|arm64) asset="gooseberry-goose-${VERSION}-linux-aarch64.tar.gz" ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

sync_config() {
  if [ "$(id -u)" -ne 0 ] || [ -n "${GOOSE_HOME:-}" ] || [ -n "$CONFIG_OWNER" ]; then
    [ -n "$TARGET_HOME" ] || { echo "HOME is required for Goose configuration" >&2; exit 1; }
    mkdir -p "$TARGET_HOME/.config/goose/agents" "$TARGET_HOME/.config/goose/skills/gooseberry-browser"
    cp "$(dirname "$0")/config/agents/"*.md "$TARGET_HOME/.config/goose/agents/"
    cp "$(dirname "$0")/config/skills/gooseberry-browser/SKILL.md" "$TARGET_HOME/.config/goose/skills/gooseberry-browser/"
    if [ "$(id -u)" -eq 0 ] && [ -n "$CONFIG_OWNER" ] && [ -n "$CONFIG_GROUP" ]; then
      chown -R "$CONFIG_OWNER:$CONFIG_GROUP" "$TARGET_HOME/.config/goose"
    fi
  fi
}

legacy_skill="$TARGET_HOME/.config/goose/skills/pixie-browser"
if [ -n "$TARGET_HOME" ] && { [ -e "$legacy_skill" ] || [ -L "$legacy_skill" ]; }; then
  echo "refusing to install: legacy Goose skill exists at $legacy_skill; remove it manually" >&2
  exit 1
fi

if [ "${GOOSE_ALLOW_EXISTING:-0}" = 1 ] && [ -x "$TARGET" ] && "$TARGET" --version 2>/dev/null | grep -F "${EXPECTED_VERSION}" >/dev/null; then
  sync_config
  echo "goose ${VERSION} already installed at ${TARGET}"
  exit 0
fi

for command in curl tar sha256sum mktemp; do
  command -v "$command" >/dev/null 2>&1 || { echo "missing required command: $command" >&2; exit 1; }
done

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
curl --fail --location --silent --show-error --retry 3 -o "$tmp/$asset" "$RELEASE_BASE/$asset"
curl --fail --location --silent --show-error --retry 3 -o "$tmp/SHA256SUMS" "$RELEASE_BASE/SHA256SUMS"
grep -F "  $asset" "$tmp/SHA256SUMS" | (cd "$tmp" && sha256sum -c -) >/dev/null

target_dir=$(dirname "$TARGET")
mkdir -p "$target_dir" || { echo "cannot create target directory: $target_dir" >&2; exit 1; }
extract="$tmp/extract"
mkdir "$extract"
members=$(tar -tzf "$tmp/$asset")
[ "$members" = "goose" ] || { echo "archive contains unexpected paths" >&2; exit 1; }
tar -xzf "$tmp/$asset" -C "$extract" --no-same-owner --no-same-permissions
binary="$extract/goose"
[ -f "$binary" ] && [ ! -L "$binary" ] || { echo "archive does not contain a safe goose executable" >&2; exit 1; }
chmod 0755 "$binary"
install_tmp=$(mktemp "$target_dir/.goose.new.XXXXXX")
trap 'rm -rf "$tmp" "${install_tmp:-}"' EXIT HUP INT TERM
cp "$binary" "$install_tmp"
chmod 0755 "$install_tmp"
version_output=$("$install_tmp" --version)
printf '%s\n' "$version_output" | grep -F "$EXPECTED_VERSION" >/dev/null || { echo "installed goose version mismatch" >&2; exit 1; }
mv -f "$install_tmp" "$TARGET"
install_tmp=
sync_config
echo "installed goose ${VERSION} at ${TARGET}"
