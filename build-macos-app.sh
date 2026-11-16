#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/Pi Desktop.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
PI_SOURCE_DIR="${PI_SOURCE_DIR:-$SCRIPT_DIR/../pi}"
NODE_BIN="${PI_NODE_BIN:-$(command -v node)}"
VERSION="$("$NODE_BIN" -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version' "$SCRIPT_DIR/package.json")"
ARCH="$("$NODE_BIN" -p 'process.arch')"

if [[ "$(uname -s)" != Darwin ]]; then
  printf '%s\n' 'The macOS app must be built on macOS.' >&2
  exit 1
fi
"$NODE_BIN" -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 19)) process.exit(1)'
# Validate the pinned engine before replacing any existing application output.
PI_SOURCE_DIR="$PI_SOURCE_DIR" "$NODE_BIN" "$SCRIPT_DIR/scripts/engine.mjs" verify

# Rebuild only generated output, never user data or the source checkout.
rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR/desktop" "$RESOURCES_DIR/licenses"
cp "$NODE_BIN" "$MACOS_DIR/node"
cp "$SCRIPT_DIR/server.mjs" "$SCRIPT_DIR/package.json" "$RESOURCES_DIR/desktop/"
cp -R "$SCRIPT_DIR/public" "$RESOURCES_DIR/desktop/public"
cp "$SCRIPT_DIR/LICENSE" "$RESOURCES_DIR/licenses/Pi-Desktop-LICENSE"
"$NODE_BIN" "$SCRIPT_DIR/scripts/package-runtime.mjs" "$RESOURCES_DIR" "$PI_SOURCE_DIR" "$NODE_BIN"
ICONSET_DIR="$(mktemp -d)/PiDesktop.iconset"
swift "$SCRIPT_DIR/scripts/generate-icon.swift" "$SCRIPT_DIR/assets/icon.png" "$ICONSET_DIR"
iconutil -c icns "$ICONSET_DIR" -o "$RESOURCES_DIR/PiDesktop.icns"
rm -r "${ICONSET_DIR%/PiDesktop.iconset}"

cat > "$CONTENTS_DIR/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>pi-desktop</string>
  <key>CFBundleIdentifier</key><string>dev.pi.desktop</string>
  <key>CFBundleName</key><string>Pi Desktop</string>
  <key>CFBundleIconFile</key><string>PiDesktop</string>
  <key>CFBundleDisplayName</key><string>Pi Desktop</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppleEventsUsageDescription</key><string>Open Terminal to configure your own model credentials with Pi.</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
EOF

printf '%s\n' 'Compiling native macOS launcher...'
if [[ "$ARCH" == arm64 ]]; then SWIFT_ARCH=arm64; else SWIFT_ARCH=x86_64; fi
swiftc "$SCRIPT_DIR/macos-app.swift" -framework Cocoa -framework WebKit -O \
  -target "$SWIFT_ARCH-apple-macosx13.0" -o "$MACOS_DIR/pi-desktop"
chmod +x "$MACOS_DIR/pi-desktop" "$MACOS_DIR/node"
# Ad-hoc signing makes bundle integrity verifiable; this is not Apple notarization.
codesign --force --sign - "$MACOS_DIR/node"
codesign --force --sign - "$APP_DIR"
codesign --verify --deep --strict "$APP_DIR"
printf 'Built application: %s\n' "$APP_DIR"

if [[ "${1:-}" == --release ]]; then
  RELEASE_DIR="$SCRIPT_DIR/release"
  ARCHIVE="Pi-Desktop-$VERSION-macOS-$ARCH.zip"
  mkdir -p "$RELEASE_DIR"
  ditto -c -k --sequesterRsrc --keepParent "$APP_DIR" "$RELEASE_DIR/$ARCHIVE"
  (cd "$RELEASE_DIR" && shasum -a 256 "$ARCHIVE" > "$ARCHIVE.sha256")
  printf 'Created release: %s\n' "$RELEASE_DIR/$ARCHIVE"
fi
