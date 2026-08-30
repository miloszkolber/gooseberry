#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
version=$(tr -d '[:space:]' < "$root/version")
commit=$(tr -d '[:space:]' < "$root/source-commit")
printf '%s\n' "$version" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'
printf '%s\n' "$commit" | grep -Eq '^[0-9a-f]{40}$'
export TEST_GOOSE_VERSION=${version#v}
asset="gooseberry-goose-${version}-linux-x86_64.tar.gz"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mode_of() {
  stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"
}
owner_of() {
  stat -c %u:%g "$1" 2>/dev/null || stat -f %u:%g "$1"
}
bin="$tmp/bin"; mkdir "$bin"
cat >"$bin/uname" <<'EOF'
#!/bin/sh
case "${1:-}" in
  -s) printf '%s\n' "${FAKE_OS:-Linux}" ;;
  -m) printf '%s\n' "${FAKE_ARCH:-x86_64}" ;;
  *) exit 2 ;;
esac
EOF
cat >"$bin/goose" <<'EOF'
#!/bin/sh
case "${TEST_GOOSE_FORMAT:-actual}" in
  actual) printf ' %s\n' "$TEST_GOOSE_VERSION" ;;
  labelled) printf 'goose %s\n' "$TEST_GOOSE_VERSION" ;;
  mismatch) printf '9.9.9\n' ;;
  malformed) printf 'goose %s unexpected\n' "$TEST_GOOSE_VERSION" ;;
  multiline) printf '%s\nextra\n' "$TEST_GOOSE_VERSION" ;;
  blank-line) printf '%s\n\n' "$TEST_GOOSE_VERSION" ;;
  failed) printf 'goose %s\n' "$TEST_GOOSE_VERSION"; exit 1 ;;
  *) exit 2 ;;
esac
EOF
chmod +x "$bin/uname" "$bin/goose"
mkdir -p "$tmp/release" "$tmp/prefix"
tar -czf "$tmp/release/$asset" -C "$bin" goose
(cd "$tmp/release" && sha256sum "$asset" > SHA256SUMS)
printf 'goose-version=%s\nupstream-repository=https://github.com/aaif-goose/goose.git\nupstream-commit=%s\n' "$version" "$commit" > "$tmp/release/GOOSE-PROVENANCE"
sh "$root/source-policy.sh" "$version" "$commit" >> "$tmp/release/GOOSE-PROVENANCE"
# Publishing requires both architectures and legal notices, not just the selected installer asset.
cp "$tmp/release/$asset" "$tmp/release/gooseberry-goose-${version}-linux-aarch64.tar.gz"
cp "$root/../LICENSE" "$root/../NOTICE.md" "$tmp/release/"
(cd "$tmp/release" && sha256sum gooseberry-goose-*.tar.gz LICENSE NOTICE.md > SHA256SUMS)
sh "$root/verify-release.sh" "$tmp/release" "$version" "$commit"
sh "$root/verify-release.sh" "$tmp/release" "$version" "$commit" metadata
cp "$tmp/release/SHA256SUMS" "$tmp/complete-checksums"
head -n 3 "$tmp/complete-checksums" > "$tmp/release/SHA256SUMS"
if sh "$root/verify-release.sh" "$tmp/release" "$version" "$commit" metadata; then
  echo 'release verifier accepted a partial checksum manifest' >&2
  exit 1
fi
cp "$tmp/complete-checksums" "$tmp/release/SHA256SUMS"
PATH="$bin:$PATH" GOOSE_HOME="$tmp/home" XDG_CONFIG_HOME="$tmp/non-default-config" GOOSE_RELEASE_BASE="file://$tmp/release" GOOSE_PREFIX="$tmp/prefix" "$root/install-goose.sh"
test -f "$tmp/prefix/goose"; test "$(mode_of "$tmp/prefix/goose")" = 755
for agent in "$root"/config/agents/*.md; do
  name=$(basename "$agent")
  test -f "$tmp/home/.config/goose/agents/$name"
  test "$(owner_of "$tmp/home/.config/goose/agents/$name")" = "$(owner_of "$tmp/home")"
done
test -f "$tmp/home/.config/goose/skills/gooseberry-browser/SKILL.md"
test "$(owner_of "$tmp/home/.config/goose/skills/gooseberry-browser/SKILL.md")" = "$(owner_of "$tmp/home")"
[ ! -e "$tmp/non-default-config/goose/agents/scout.md" ]
rm -f "$tmp/home/.config/goose/agents/scout.md" "$tmp/home/.config/goose/skills/gooseberry-browser/SKILL.md"
cat >"$bin/curl" <<'EOF'
#!/bin/sh
exit 99
EOF
chmod +x "$bin/curl"
GOOSE_ALLOW_EXISTING=1 GOOSE_HOME="$tmp/home" PATH="$bin:$PATH" GOOSE_RELEASE_BASE="file://$tmp/missing-release" GOOSE_PREFIX="$tmp/prefix" "$root/install-goose.sh"
TEST_GOOSE_FORMAT=labelled GOOSE_ALLOW_EXISTING=1 GOOSE_HOME="$tmp/home" PATH="$bin:$PATH" GOOSE_RELEASE_BASE="file://$tmp/missing-release" GOOSE_PREFIX="$tmp/prefix" "$root/install-goose.sh"
for format in mismatch malformed multiline blank-line failed; do
  if TEST_GOOSE_FORMAT="$format" GOOSE_ALLOW_EXISTING=1 GOOSE_HOME="$tmp/home" PATH="$bin:$PATH" GOOSE_RELEASE_BASE="file://$tmp/missing-release" GOOSE_PREFIX="$tmp/prefix" "$root/install-goose.sh"; then
    echo "installer trusted invalid existing version output: $format" >&2
    exit 1
  fi
done
for agent in "$root"/config/agents/*.md; do
  name=$(basename "$agent")
  test -f "$tmp/home/.config/goose/agents/$name"
  test "$(owner_of "$tmp/home/.config/goose/agents/$name")" = "$(owner_of "$tmp/home")"
done
test -f "$tmp/home/.config/goose/skills/gooseberry-browser/SKILL.md"
test "$(owner_of "$tmp/home/.config/goose/skills/gooseberry-browser/SKILL.md")" = "$(owner_of "$tmp/home")"
rm -f "$bin/curl"
cp "$tmp/prefix/goose" "$tmp/old-goose"
TEST_GOOSE_FORMAT=labelled PATH="$bin:$PATH" GOOSE_HOME="$tmp/home" GOOSE_RELEASE_BASE="file://$tmp/release" GOOSE_PREFIX="$tmp/prefix" "$root/install-goose.sh"
for format in mismatch malformed multiline blank-line failed; do
  if TEST_GOOSE_FORMAT="$format" PATH="$bin:$PATH" GOOSE_HOME="$tmp/home" GOOSE_RELEASE_BASE="file://$tmp/release" GOOSE_PREFIX="$tmp/prefix" "$root/install-goose.sh"; then
    echo "installer replaced executable with invalid version output: $format" >&2
    exit 1
  fi
  cmp "$tmp/old-goose" "$tmp/prefix/goose"
done
if GOOSE_VERSION=v9999.0.0 GOOSE_ALLOW_EXISTING=1 PATH="$bin:$PATH" GOOSE_HOME="$tmp/home" GOOSE_PREFIX="$tmp/prefix" "$root/install-goose.sh"; then
  echo 'installer accepted a version without a matching checkout pin' >&2
  exit 1
fi
cmp "$tmp/old-goose" "$tmp/prefix/goose"
printf '%s\n' bad > "$tmp/release/SHA256SUMS"
PATH="$bin:$PATH" GOOSE_HOME="$tmp/home" GOOSE_RELEASE_BASE="file://$tmp/release" GOOSE_PREFIX="$tmp/prefix" "$root/install-goose.sh" && exit 1 || :
cmp "$tmp/old-goose" "$tmp/prefix/goose"
(cd "$tmp/release" && sha256sum "$asset" > SHA256SUMS)
cp "$tmp/release/GOOSE-PROVENANCE" "$tmp/valid-provenance"
sed 's/cargo-lock-adjustment=.*/cargo-lock-adjustment=unapproved/' "$tmp/valid-provenance" > "$tmp/release/GOOSE-PROVENANCE"
if sh "$root/verify-release.sh" "$tmp/release" "$version" "$commit" "$asset"; then
  echo 'release verifier accepted an unapproved lockfile adjustment' >&2
  exit 1
fi
sed 's/upstream-commit=./upstream-commit=g/' "$tmp/valid-provenance" > "$tmp/release/GOOSE-PROVENANCE"
PATH="$bin:$PATH" GOOSE_HOME="$tmp/home" GOOSE_RELEASE_BASE="file://$tmp/release" GOOSE_PREFIX="$tmp/prefix" "$root/install-goose.sh" && exit 1 || :
cmp "$tmp/old-goose" "$tmp/prefix/goose"
cp "$tmp/valid-provenance" "$tmp/release/GOOSE-PROVENANCE"
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
  tar -czf "$tmp/release/$asset" -C "$bin" goose
  (cd "$tmp/release" && sha256sum "$asset" > SHA256SUMS)
  cross="/dev/shm/goose-test.$$"; mkdir "$cross"; cp "$tmp/release/"* "$cross/"
  PATH="$bin:$PATH" GOOSE_HOME="$tmp/home" GOOSE_RELEASE_BASE="file://$cross" GOOSE_PREFIX="$tmp/prefix" "$root/install-goose.sh" >/dev/null
  rm -rf "$cross"
fi
FAKE_ARCH=bad PATH="$bin:$PATH" GOOSE_HOME="$tmp/home" GOOSE_RELEASE_BASE="file://$tmp/release" GOOSE_PREFIX="$tmp/prefix/bad" "$root/install-goose.sh" && exit 1 || :
FAKE_OS=Darwin PATH="$bin:$PATH" GOOSE_HOME="$tmp/home" GOOSE_RELEASE_BASE="file://$tmp/release" GOOSE_PREFIX="$tmp/prefix/darwin" "$root/install-goose.sh" && exit 1 || :
printf '%s\n' 'installer tests passed'
