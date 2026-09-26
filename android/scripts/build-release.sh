#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -z "${ANDROID_HOME:-}" ]; then
    if [ -d "$HOME/Android/Sdk" ]; then
        ANDROID_HOME="$HOME/Android/Sdk"
    elif [ -n "${ANDROID_SDK_ROOT:-}" ]; then
        ANDROID_HOME="$ANDROID_SDK_ROOT"
    else
        echo "error: ANDROID_HOME not set and $HOME/Android/Sdk not found" >&2
        exit 1
    fi
fi
export ANDROID_HOME

PROPS_PATH="${BRAINCORE_ANDROID_SIGNING_PROPS:-$HOME/.config/braincore/android-signing.properties}"
if [ ! -f "$PROPS_PATH" ]; then
    echo "error: signing properties file not found: $PROPS_PATH" >&2
    echo "hint: create it (see docs/operations/android-release.md) or export BRAINCORE_ANDROID_SIGNING_PROPS" >&2
    exit 1
fi

STORE_FILE="$(sed -n 's/^storeFile=//p' "$PROPS_PATH")"
if [ -z "$STORE_FILE" ] || [ ! -f "$STORE_FILE" ]; then
    echo "error: storeFile from $PROPS_PATH does not exist: ${STORE_FILE:-<empty>}" >&2
    exit 1
fi

cd "$ANDROID_DIR"
./gradlew :app:testDebugUnitTest :app:assembleRelease --console=plain

APK="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
OUT_DIR="$(dirname "$APK")"
if [ ! -f "$APK" ]; then
    echo "error: expected APK not found: $APK" >&2
    exit 1
fi

BUILD_TOOLS_DIR="$(ls -1d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)"
APKSIGNER="$BUILD_TOOLS_DIR/apksigner"
AAPT2="$BUILD_TOOLS_DIR/aapt2"

BADGING="$("$AAPT2" dump badging "$APK")"
printf '%s\n' "$BADGING" | head -3

if ! printf '%s\n' "$BADGING" | grep -q "^package: name='com.example.braincore'"; then
    echo "error: unexpected application id in release APK (expected com.example.braincore)" >&2
    exit 1
fi
if printf '%s\n' "$BADGING" | grep -q "application-debuggable"; then
    echo "error: APK is debuggable; refusing to treat it as a release candidate" >&2
    exit 1
fi

echo "--- signing verification ---"
"$APKSIGNER" verify --print-certs "$APK" | tee "$OUT_DIR/apksigner-verify.txt"

echo "--- SHA-256 ---"
cd "$OUT_DIR"
sha256sum app-release.apk | tee app-release.apk.SHA256

echo "--- artifact ---"
ls -l "$APK" app-release.apk.SHA256 apksigner-verify.txt
echo "release candidate ready: $APK"
