#!/usr/bin/env bash
# Собрать шумодав в ui/audio/denoise.wasm
set -euo pipefail
cd "$(dirname "$0")"
cargo build --release --target wasm32-unknown-unknown
mkdir -p ../../ui/audio
cp target/wasm32-unknown-unknown/release/hunty_denoise.wasm ../../ui/audio/denoise.wasm
ls -l ../../ui/audio/denoise.wasm
