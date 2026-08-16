#!/usr/bin/env bash
# Local release-style builds for supported desktop targets.
#
# Usage:
#   ./scripts/build-local.sh              # host default
#   ./scripts/build-local.sh mac-arm
#   ./scripts/build-local.sh mac-intel
#   ./scripts/build-local.sh win          # native on Windows; cargo-xwin on macOS/Linux
#   ./scripts/build-local.sh linux        # native on Linux (AppImage/deb under bundle/)
#   ./scripts/build-local.sh all-mac      # both mac targets (Darwin only)
#   ./scripts/build-local.sh all          # mac-arm + mac-intel + win (Darwin)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGET_ALIAS="${1:-host}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: missing command: $1" >&2
    exit 1
  }
}

# Homebrew LLVM (clang-cl) for cargo-xwin RC / C toolchain on Apple Silicon.
prepend_homebrew_llvm() {
  if [[ -d /opt/homebrew/opt/llvm/bin ]]; then
    export PATH="/opt/homebrew/opt/llvm/bin:$PATH"
  elif [[ -d /usr/local/opt/llvm/bin ]]; then
    export PATH="/usr/local/opt/llvm/bin:$PATH"
  fi
}

need_cmd pnpm
need_cmd rustc
need_cmd cargo

OS="$(uname -s)"

# Tauri must compile the release binary with its production custom protocol.
# Without this explicit feature, a stale/mixed target directory can leave the
# executable using build.devUrl (localhost:1421) instead of embedding dist/.
TAURI_RELEASE_FEATURES="tauri/custom-protocol"

build_tauri_release() {
  local target_args=("$@")
  echo "Using Tauri release features: ${TAURI_RELEASE_FEATURES}"
  # Frontend is built via beforeBuildCommand in tauri.conf.json.
  pnpm exec tauri build --features "$TAURI_RELEASE_FEATURES" "${target_args[@]}"
}

assert_windows_release_artifact() {
  local triple="$1"
  local artifact_dir="src-tauri/target/${triple}/release"
  local exe=""

  for candidate in Grok.exe grok-app.exe; do
    if [[ -f "${artifact_dir}/${candidate}" ]]; then
      exe="${artifact_dir}/${candidate}"
      break
    fi
  done

  if [[ -z "$exe" ]]; then
    echo "error: release executable not found under ${artifact_dir}" >&2
    find "src-tauri/target/${triple}" -maxdepth 5 -type f -name '*.exe' -print 2>/dev/null || true
    exit 1
  fi

  if [[ ! -f dist/index.html ]]; then
    echo "error: frontend dist/index.html is missing; refusing release artifact" >&2
    exit 1
  fi

  if [[ ! -d "${artifact_dir}/bundle/nsis" ]]; then
    echo "error: NSIS bundle directory is missing under ${artifact_dir}/bundle" >&2
    exit 1
  fi

  echo "Verified release executable: ${exe}"
  echo "Verified frontend: dist/index.html"
  echo "Verified NSIS bundle: ${artifact_dir}/bundle/nsis"
}

build_target() {
  local triple="$1"
  echo ""
  echo "======== Building target: $triple ========"
  rustup target add "$triple" >/dev/null 2>&1 || true
  build_tauri_release --target "$triple"
  echo "Artifacts under: src-tauri/target/${triple}/release/bundle/"
}

# Windows: on Darwin/Linux use Tauri + cargo-xwin runner (NSIS installer).
# On Windows host, native MSVC toolchain (no runner).
build_windows() {
  local triple="x86_64-pc-windows-msvc"
  echo ""
  echo "======== Building target: $triple ========"
  rustup target add "$triple" >/dev/null 2>&1 || true

  if [[ "$OS" == "Darwin" ]] || [[ "$OS" == "Linux" ]]; then
    prepend_homebrew_llvm
    need_cmd cargo-xwin
    if ! command -v makensis >/dev/null 2>&1; then
      echo "error: makensis not found (NSIS installer)." >&2
      echo "       macOS: brew install makensis" >&2
      echo "       Then re-run: pnpm setup:cross && ./scripts/build-local.sh win" >&2
      exit 1
    fi
    if ! command -v clang-cl >/dev/null 2>&1; then
      echo "warn: clang-cl not on PATH — install brew llvm and ensure PATH includes it" >&2
      echo "      brew install llvm && export PATH=\"\$(brew --prefix llvm)/bin:\$PATH\"" >&2
    fi
    # Official Tauri path: https://v2.tauri.app/distribute/windows-installer/
    echo "Using runner: cargo-xwin (cross-compile from $OS)"
    pnpm exec tauri build --runner cargo-xwin --features "$TAURI_RELEASE_FEATURES" --target "$triple"
  else
    echo "Using native Windows MSVC toolchain"
    build_tauri_release --target "$triple"
  fi

  echo "Artifacts under: src-tauri/target/${triple}/release/bundle/"
  local nsis="src-tauri/target/${triple}/release/bundle/nsis"
  if [[ -d "$nsis" ]]; then
    echo "NSIS installers:"
    ls -lah "$nsis" || true
  fi
  assert_windows_release_artifact "$triple"
}

case "$TARGET_ALIAS" in
  host|"")
    echo "======== Building host default ========"
    build_tauri_release
    echo "Artifacts under: src-tauri/target/release/bundle/"
    ;;
  mac-arm|aarch64-apple-darwin)
    if [[ "$OS" != "Darwin" ]]; then
      echo "error: mac-arm builds require macOS" >&2
      exit 1
    fi
    build_target "aarch64-apple-darwin"
    ;;
  mac-intel|x86_64-apple-darwin)
    if [[ "$OS" != "Darwin" ]]; then
      echo "error: mac-intel builds require macOS" >&2
      exit 1
    fi
    build_target "x86_64-apple-darwin"
    ;;
  win|windows|x86_64-pc-windows-msvc)
    build_windows
    ;;
  linux|x86_64-unknown-linux-gnu)
    if [[ "$OS" != "Linux" ]]; then
      echo "error: linux builds require a Linux host (or CI ubuntu-latest)" >&2
      echo "       deps: libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf" >&2
      exit 1
    fi
    build_target "x86_64-unknown-linux-gnu"
    ;;
  all-mac)
    if [[ "$OS" != "Darwin" ]]; then
      echo "error: all-mac requires macOS" >&2
      exit 1
    fi
    build_target "aarch64-apple-darwin"
    build_target "x86_64-apple-darwin"
    ;;
  all)
    if [[ "$OS" != "Darwin" ]]; then
      echo "error: 'all' (mac + win cross) requires macOS currently" >&2
      exit 1
    fi
    build_target "aarch64-apple-darwin"
    build_target "x86_64-apple-darwin"
    build_windows
    ;;
  *)
    echo "usage: $0 [host|mac-arm|mac-intel|win|linux|all-mac|all]" >&2
    exit 1
    ;;
esac
