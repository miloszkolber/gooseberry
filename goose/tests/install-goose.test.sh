#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
test "$(tr -d '[:space:]' < "$root/version")" = v1.48.0
test "$(tr -d '[:space:]' < "$root/source-commit")" = 25021517f12cab87c94bed0874fe7d28168dc264
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
bin="$tmp/bin"; mkdir "$bin"
cat >"$bin/uname" <<'EOF'
#!/bin/sh
printf '%s\n' "${FAKE_ARCH:-x86_64}"
EOF
cat >"$bin/goose" <<'EOF'
#!/bin/sh
printf '%s\n' 'goose 1.48.0'
EOF
chmod +x "$bin/uname" "$bin/goose"
mkdir -p "$tmp/release" "$tmp/prefix"
tar -czf "$tmp/release/gooseberry-goose-v1.48.0-linux-x86_64.tar.gz" -C "$bin" goose
(cd "$tmp/release" && sha256sum gooseberry-goose-v1.48.0-linux-x86_64.tar.gz > SHA256SUMS)
PATH="$bin:$PATH" GOOSE_HOME="$tmp/home" XDG_CONFIG_HOME="$tmp/non-default-config" GOOSE_RELEASE_BASE="file://$tmp/release" GOOSE_PREFIX="$tmp/prefix" "$root/install-goose.sh"
test -f "$tmp/prefix/goose"; test "$(stat -c %a "$tmp/prefix/goose")" = 755
for agent in "$root"/config/agents/*.md; do
  name=$(basename "$agent")
  test -f "$tmp/home/.config/goose/agents/$name"
  test "$(stat -c %u:%g "$tmp/home/.config/goose/agents/$name")" = "$(stat -c %u:%g "$tmp/home")"
done
test -f "$tmp/home/.config/goose/skills/gooseberry-browser/SKILL.md"
test "$(stat -c %u:%g "$tmp/home/.config/goose/skills/gooseberry-browser/SKILL.md")" = "$(stat -c %u:%g "$tmp/home")"
[ ! -e "$tmp/non-default-config/goose/agents/scout.md" ]
rm -f "$tmp/home/.config/goose/agents/scout.md" "$tmp/home/.config/goose/skills/gooseberry-browser/SKILL.md"
cat >"$bin/curl" <<'EOF'
#!/bin/sh
exit 99
EOF
chmod +x "$bin/curl"
GOOSE_ALLOW_EXISTING=1 GOOSE_HOME="$tmp/home" PATH="$bin:$PATH" GOOSE_RELEASE_BASE="file://$tmp/missing-release" GOOSE_PREFIX="$tmp/prefix" "$root/install-goose.sh"
for agent in "$root"/config/agents/*.md; do
  name=$(basename "$agent")
  test -f "$tmp/home/.config/goose/agents/$name"
  test "$(stat -c %u:%g "$tmp/home/.config/goose/agents/$name")" = "$(stat -c %u:%g "$tmp/home")"
done
test -f "$tmp/home/.config/goose/skills/gooseberry-browser/SKILL.md"
test "$(stat -c %u:%g "$tmp/home/.config/goose/skills/gooseberry-browser/SKILL.md")" = "$(stat -c %u:%g "$tmp/home")"
rm -f "$bin/curl"
cp "$tmp/prefix/goose" "$tmp/old-goose"
printf '%s\n' bad > "$tmp/release/SHA256SUMS"
PATH="$bin:$PATH" GOOSE_HOME="$tmp/home" GOOSE_RELEASE_BASE="file://$tmp/release" GOOSE_PREFIX="$tmp/prefix" "$root/install-goose.sh" && exit 1 || :
cmp "$tmp/old-goose" "$tmp/prefix/goose"
badbin="$tmp/bad-bin"; mkdir "$badbin"
printf '%s\n' '#!/bin/sh' "printf '%s\\n' 'goose 9.9.9'" > "$badbin/goose"; chmod 755 "$badbin/goose"
tar -czf "$tmp/release/gooseberry-goose-v1.48.0-linux-x86_64.tar.gz" -C "$badbin" goose
(cd "$tmp/release" && sha256sum gooseberry-goose-v1.48.0-linux-x86_64.tar.gz > SHA256SUMS)
PATH="$bin:$PATH" GOOSE_HOME="$tmp/home" GOOSE_RELEASE_BASE="file://$tmp/release" GOOSE_PREFIX="$tmp/prefix" "$root/install-goose.sh" && exit 1 || :
cmp "$tmp/old-goose" "$tmp/prefix/goose"
for legacy_type in file dir symlink; do
  legacy="$tmp/home/.config/goose/skills/pixie-browser"
  rm -rf "$legacy"
  case "$legacy_type" in
    file) : > "$legacy" ;;
    dir) mkdir "$legacy" ;;
    symlink) ln -s "$tmp/home" "$legacy" ;;
  esac
  if GOOSE_ALLOW_EXISTING=1 GOOSE_HOME="$tmp/home" PATH="$bin:$PATH" GOOSE_RELEASE_BASE="file://$tmp/missing-release" GOOSE_PREFIX="$tmp/prefix" "$root/install-goose.sh" 2>"$tmp/legacy-error"; then
    exit 1
  fi
  grep -F "legacy Goose skill exists" "$tmp/legacy-error" >/dev/null
  [ -e "$legacy" ] || [ -L "$legacy" ]
done
rm -rf "$tmp/home/.config/goose/skills/pixie-browser"
if [ -d /dev/shm ] && [ -w /dev/shm ]; then
  tar -czf "$tmp/release/gooseberry-goose-v1.48.0-linux-x86_64.tar.gz" -C "$bin" goose
  (cd "$tmp/release" && sha256sum gooseberry-goose-v1.48.0-linux-x86_64.tar.gz > SHA256SUMS)
  cross="/dev/shm/goose-test.$$"; mkdir "$cross"; cp "$tmp/release/"* "$cross/"
  PATH="$bin:$PATH" GOOSE_HOME="$tmp/home" GOOSE_RELEASE_BASE="file://$cross" GOOSE_PREFIX="$tmp/prefix" "$root/install-goose.sh" >/dev/null
  rm -rf "$cross"
fi
FAKE_ARCH=bad PATH="$bin:$PATH" GOOSE_HOME="$tmp/home" GOOSE_RELEASE_BASE="file://$tmp/release" GOOSE_PREFIX="$tmp/prefix/bad" "$root/install-goose.sh" && exit 1 || :
printf '%s\n' 'installer tests passed'
