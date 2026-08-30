#!/bin/sh
set -eu

# Full release, metadata-only scheduled check, or one installer-selected archive.
directory=$1
version=$2
commit=$3
mode=${4:-full}
printf '%s\n' "$version" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'
printf '%s\n' "$commit" | grep -Eq '^[0-9a-f]{40}$'
provenance="$directory/GOOSE-PROVENANCE"
grep -Fx "goose-version=$version" "$provenance" >/dev/null || { echo "Goose provenance version mismatch" >&2; exit 1; }
grep -Fx 'upstream-repository=https://github.com/aaif-goose/goose.git' "$provenance" >/dev/null || { echo "Goose provenance repository mismatch" >&2; exit 1; }
grep -Fx "upstream-commit=$commit" "$provenance" >/dev/null || { echo "Goose provenance commit mismatch" >&2; exit 1; }
adjustment=$(sh "$(dirname "$0")/source-policy.sh" "$version" "$commit")
grep -Fx "$adjustment" "$provenance" >/dev/null || { echo "Goose provenance lockfile adjustment mismatch" >&2; exit 1; }
[ "$(wc -l < "$provenance" | tr -d '[:space:]')" = 4 ] || { echo "Goose provenance has unexpected fields" >&2; exit 1; }

case "$mode" in
  full|metadata)
    set -- "gooseberry-goose-${version}-linux-x86_64.tar.gz" "gooseberry-goose-${version}-linux-aarch64.tar.gz" LICENSE NOTICE.md
    [ "$(wc -l < "$directory/SHA256SUMS" | tr -d '[:space:]')" = 4 ] || { echo "Goose checksum manifest must name both archives and legal files exactly once" >&2; exit 1; }
    ;;
  "gooseberry-goose-${version}-linux-x86_64.tar.gz"|"gooseberry-goose-${version}-linux-aarch64.tar.gz") set -- "$mode" ;;
  *) echo "invalid Goose verification mode" >&2; exit 1 ;;
esac
for asset in "$@"; do
  line=$(grep -F "  $asset" "$directory/SHA256SUMS" || true)
  checksum=${line%% *}
  printf '%s\n' "$checksum" | grep -Eq '^[0-9a-f]{64}$' || { echo "missing or invalid Goose archive checksum: $asset" >&2; exit 1; }
  [ "$line" = "$checksum  $asset" ] || { echo "ambiguous Goose archive checksum: $asset" >&2; exit 1; }
  if [ "$mode" != metadata ]; then
    test -s "$directory/$asset"
    printf '%s\n' "$line" | (cd "$directory" && sha256sum -c -) >/dev/null
  fi
done
