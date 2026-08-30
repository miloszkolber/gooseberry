#!/bin/sh
set -eu

# Integration fixture: use a local copy of the real candidate, never its build checkout.
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
source=$(CDPATH= cd -- "$1" && pwd)
version=$2
commit=$3
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
fixture="$tmp/source"
cp -R "$source" "$fixture"
reject() {
  if "$@"; then
    echo 'source policy accepted an unapproved checkout state' >&2
    exit 1
  fi
}
expected=$(sh "$root/source-policy.sh" "$version" "$commit")
test "$(sh "$root/source-policy.sh" v1.48.0 25021517f12cab87c94bed0874fe7d28168dc264)" = cargo-lock-adjustment=goose-roaming-1.47.0-to-1.48.0
test "$(sh "$root/source-policy.sh" v1.49.0 1111111111111111111111111111111111111111)" = cargo-lock-adjustment=none
reject sh "$root/source-policy.sh" v1.49.0 25021517f12cab87c94bed0874fe7d28168dc264
reject sh "$root/source-policy.sh" "$version" 1111111111111111111111111111111111111111 "$fixture" prepare

printf 'untracked\n' > "$fixture/unapproved-source.txt"
reject sh "$root/source-policy.sh" "$version" "$commit" "$fixture" prepare
rm "$fixture/unapproved-source.txt"
test "$(sh "$root/source-policy.sh" "$version" "$commit" "$fixture" prepare)" = "$expected"
test "$(sh "$root/source-policy.sh" "$version" "$commit" "$fixture" check)" = "$expected"
cp "$fixture/Cargo.lock" "$tmp/approved.lock"
cp "$fixture/Cargo.toml" "$tmp/original.toml"

printf '\n' >> "$fixture/Cargo.lock"
reject sh "$root/source-policy.sh" "$version" "$commit" "$fixture" check
cp "$tmp/approved.lock" "$fixture/Cargo.lock"
printf '\n' >> "$fixture/Cargo.toml"
reject sh "$root/source-policy.sh" "$version" "$commit" "$fixture" check
cp "$tmp/original.toml" "$fixture/Cargo.toml"
printf 'untracked\n' > "$fixture/unapproved-source.txt"
reject sh "$root/source-policy.sh" "$version" "$commit" "$fixture" check
rm "$fixture/unapproved-source.txt"

# An ignored build product is permitted, unlike an untracked source file.
mkdir -p "$fixture/target"
printf 'ignored build output\n' > "$fixture/target/source-policy-fixture"
git -C "$fixture" check-ignore --quiet target/source-policy-fixture
test "$(sh "$root/source-policy.sh" "$version" "$commit" "$fixture" check)" = "$expected"
printf '%s\n' 'source policy tests passed'
