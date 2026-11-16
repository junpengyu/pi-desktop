#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="Pi Desktop.app"
APP_DIR="$SCRIPT_DIR/$APP_NAME"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"

rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"

cat > "$CONTENTS_DIR/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>pi-desktop</string>
  <key>CFBundleIdentifier</key>
  <string>dev.pi.desktop</string>
  <key>CFBundleName</key>
  <string>Pi Desktop</string>
  <key>CFBundleDisplayName</key>
  <string>Pi Desktop</string>
  <key>CFBundleVersion</key>
  <string>1.0.0</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
  </dict>
</dict>
</plist>
EOF

echo "Compiling native macOS window shell..."
swiftc "$SCRIPT_DIR/macos-app.swift" \
  -framework Cocoa \
  -framework WebKit \
  -O \
  -o "$MACOS_DIR/pi-desktop"

chmod +x "$MACOS_DIR/pi-desktop" "$SCRIPT_DIR/server.mjs"
echo "Built macOS app bundle: $APP_DIR"
