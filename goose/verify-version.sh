#!/bin/sh
set -eu

[ "$#" -eq 2 ]
expected=${2#v}
printf '%s\n' "$expected" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'
# Preserve trailing newlines so blank extra lines cannot disappear in command substitution.
output=$("$1" --version && printf '.') || { echo 'Goose --version failed' >&2; exit 1; }
output=${output%.}
output=${output%"
"}
case "$output" in
  *'
'*) echo 'Goose version output must contain exactly one line' >&2; exit 1 ;;
esac
output=$(printf '%s' "$output" | LC_ALL=C sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
case "$output" in
  "$expected"|"goose $expected") ;;
  *) echo 'Goose version mismatch' >&2; exit 1 ;;
esac
