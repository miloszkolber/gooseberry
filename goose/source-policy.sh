#!/bin/sh
set -eu

# Two arguments print the required provenance field. A source directory and
# prepare/check additionally enforce the build checkout's exact allowed state.
[ "$#" -eq 2 ] || [ "$#" -eq 4 ]
version=$1
commit=$2
printf '%s\n' "$version" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'
printf '%s\n' "$commit" | grep -Eq '^[0-9a-f]{40}$'
adjustment=none
if [ "$commit" = 25021517f12cab87c94bed0874fe7d28168dc264 ]; then
  [ "$version" = v1.48.0 ] || { echo 'approved Goose commit has an unexpected version' >&2; exit 1; }
  adjustment=goose-roaming-1.47.0-to-1.48.0
  before=abd7e083ec3331804b1962dacec786832194322c32f3d415db743e21beb3948a
  after=2ac64d357d220b4c17ad49ac8d0805ae29efbc29f0648ba3ea92760bbf2e6bfc
fi
if [ "$#" -eq 4 ]; then
  source=$3
  phase=$4
  [ "$phase" = prepare ] || [ "$phase" = check ]
  test "$(git -C "$source" rev-parse HEAD)" = "$commit"
  test "$(git -C "$source" rev-parse "${version}^{commit}")" = "$commit"
  if [ "$phase" = prepare ]; then
    test -z "$(git -C "$source" status --porcelain=v1 --untracked-files=all)" || { echo 'Goose source must be clean before preparation' >&2; exit 1; }
    if [ "$adjustment" != none ]; then
      printf '%s  Cargo.lock\n' "$before" | (cd "$source" && sha256sum -c -) >/dev/null
      root=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
      git -C "$source" apply --check "$root/cargo-lock-v1.48.0.patch"
      git -C "$source" apply "$root/cargo-lock-v1.48.0.patch"
    fi
  fi
  status=$(git -C "$source" status --porcelain=v1 --untracked-files=all)
  if [ "$adjustment" = none ]; then
    test -z "$status" || { echo 'unapproved Goose source changes' >&2; exit 1; }
  else
    test "$status" = ' M Cargo.lock' || { echo 'Goose source differs beyond the approved Cargo.lock correction' >&2; exit 1; }
    test -f "$source/Cargo.lock" && test ! -L "$source/Cargo.lock"
    test -z "$(git -C "$source" diff --summary -- Cargo.lock)"
    printf '%s  Cargo.lock\n' "$after" | (cd "$source" && sha256sum -c -) >/dev/null
  fi
fi
printf 'cargo-lock-adjustment=%s\n' "$adjustment"
