#!/bin/bash
# Build the phone benchmark APK around the game's current dist/ (run `npm run build` first).
# Needs the Android SDK (build-tools, a platform) and a JDK; no Gradle.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SDK="${ANDROID_HOME:-$HOME/Android/Sdk}"
BT="$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)"
AJ="$(ls -d "$SDK"/platforms/android-*/android.jar | sort -V | tail -1)"
command -v javac >/dev/null || export PATH="$(ls -d "$HOME"/.local/share/mise/installs/java/*/bin 2>/dev/null | tail -1):$PATH"
cd "$HERE"
[ -f "$ROOT/dist/index.html" ] || { echo "Build the game first: npm run build"; exit 1; }
rm -rf assets/www build && mkdir -p assets/www build/classes build/dex
cp -r "$ROOT/dist/." assets/www/
"$BT/aapt2" link -o build/unsigned.apk --manifest AndroidManifest.xml -I "$AJ" -A assets
javac --release 17 -cp "$AJ" -d build/classes src/fun/nanded/gta/bench/MainActivity.java
"$BT/d8" --lib "$AJ" --min-api 26 --output build/dex build/classes/fun/nanded/gta/bench/*.class
cp build/unsigned.apk build/with-dex.apk
(cd build/dex && zip -q ../with-dex.apk classes.dex)
"$BT/zipalign" -f -p 4 build/with-dex.apk build/aligned.apk
# A throwaway signing key: Test Lab only needs the APK to be signed.
[ -f bench.jks ] || keytool -genkeypair -keystore bench.jks -alias bench -keyalg RSA -keysize 2048 -validity 3650 \
  -storepass android -keypass android -dname "CN=GTA Nanded bench" >/dev/null 2>&1
"$BT/apksigner" sign --ks bench.jks --ks-pass pass:android --key-pass pass:android --out build/gta-nanded-bench.apk build/aligned.apk
echo "$HERE/build/gta-nanded-bench.apk"
