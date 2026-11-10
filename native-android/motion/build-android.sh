#!/usr/bin/env bash
set -euo pipefail

ndk="$1"
output="$2"
target_dir="$3"
api=26
cd "$(dirname "$0")"
compilers=("$ndk"/toolchains/llvm/prebuilt/*/bin)
if [[ ${#compilers[@]} != 1 || ! -d "${compilers[0]}" ]]; then
    echo "Toolchain LLVM du NDK introuvable." >&2
    exit 1
fi

for entry in "aarch64-linux-android:arm64-v8a" "x86_64-linux-android:x86_64"; do
    target=${entry%:*}
    abi=${entry#*:}
    linker="${compilers[0]}/${target}${api}-clang"
    linker_key=${target^^}
    env "CARGO_TARGET_${linker_key//-/_}_LINKER=$linker" \
        RUSTFLAGS="-C link-arg=-Wl,-z,max-page-size=16384" \
        cargo build --locked --release --target "$target" --target-dir "$target_dir"
    mkdir -p "$output/$abi"
    install -m644 "$target_dir/$target/release/libkumm_motion.so" "$output/$abi/libkumm_motion.so"
done
