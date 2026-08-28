#!/bin/sh
set -eu

source_node_modules=${1:?source node_modules directory is required}
runtime_root=${2:?runtime root is required}
runtime_node_modules="$runtime_root/node_modules"
runtime_licenses="$runtime_root/licenses"

rm -rf "$source_node_modules/@gooseberry"
mkdir -p "$runtime_node_modules" "$runtime_licenses"
cp -aL "$source_node_modules/." "$runtime_node_modules/"
rm -rf "$runtime_node_modules/.bin"

rm -rf "$runtime_node_modules/@gooseberry"

find "$runtime_node_modules" -type f \
  \( -name '*.test.js' -o -name '*.test.mjs' -o -name '*.test.ts' \) \
  -delete

find "$runtime_node_modules" -type d \
  \( \
    -iname test -o -iname tests -o -iname __tests__ -o -iname fixture -o -iname fixtures -o \
    -iname __fixtures__ -o -iname example -o -iname examples -o -iname doc -o -iname docs -o \
    -iname documentation -o -iname benchmark -o -iname benchmarks -o -iname coverage -o \
    -iname .cache -o -iname cache -o -iname __pycache__ -o -iname .pytest_cache \
  \) \
  -exec find '{}' -type f \
    ! -iname 'license' ! -iname 'license.*' ! -iname 'license-*' \
    ! -iname 'notice' ! -iname 'notice.*' ! -iname 'notice-*' \
    -delete ';'

find "$runtime_node_modules" -type f \
  ! \( \
    -iname 'license' -o -iname 'license.*' -o -iname 'license-*' -o \
    -iname 'notice' -o -iname 'notice.*' -o -iname 'notice-*' \
  \) \
  \( \
    -iname 'readme*' -o -iname 'changelog*' -o -iname 'history*' -o \
    -iname 'contributing*' -o -iname 'security*' -o -iname 'code_of_conduct*' -o \
    -iname '*.md' -o -iname '*.markdown' -o -iname '*.rst' -o -iname '*.adoc' -o \
    -iname '*.map' -o -iname '*.d.ts' -o -iname '*.ts' -o -iname '*.tsx' -o \
    -iname '*.mts' -o -iname '*.cts' -o -iname '*.test.*' -o -iname '*.spec.*' -o \
    -iname '*.log' -o -iname '.npmrc' -o -iname '.yarnrc*' -o -iname '.pnp.*' -o \
    -iname '.yarn-integrity' -o -iname '.package-lock.json' -o -iname 'package-lock.json' -o \
    -iname 'npm-shrinkwrap.json' -o -iname 'yarn.lock' -o -iname 'pnpm-lock.yaml' -o \
    -iname 'bun.lockb' \
  \) \
  -delete

find "$runtime_node_modules" -mindepth 1 -depth -type d -empty -delete
