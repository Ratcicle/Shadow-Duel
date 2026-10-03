# Focused browser regressions

`zoneConsultation.test.ts` exercises the real Laboratory import, pointer hover,
wheel input, existing close controls, and a subsequent Normal Summon. It covers
GY/Extra at 1280×800, 390×844, and 844×390, direct opening and resizing, plus
portrait left/floating preview restoration. It writes screenshots and geometry
traces to `.cache/zone-consultation` by default.

Run Vite separately with Node 24.21.0 or later in the supported Node 24 line:

```bash
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
```

Supply Playwright from your tooling installation (or a local `playwright`
package) and an installed Chromium. No permanent browser dependency is added:

```bash
SHADOW_DUEL_BROWSER_TESTS=1 \
PLAYWRIGHT_MODULE=file:///absolute/path/to/playwright/index.mjs \
CHROMIUM_EXECUTABLE=/absolute/path/to/chromium \
node --import=tsx --import=./scripts/register_node_asset_loader.ts \
  --test --test-concurrency=1 test/browser/zoneConsultation.test.ts
```

Omit `PLAYWRIGHT_MODULE` to resolve `playwright` normally; omit
`CHROMIUM_EXECUTABLE` to use its installed Chromium. Override
`SHADOW_DUEL_URL` for another Vite URL and `BROWSER_ARTIFACTS` for another output
directory. Without `SHADOW_DUEL_BROWSER_TESTS=1`, the tests are explicitly skipped,
so ordinary Node test discovery does not require a browser or dev server.

The fixture uses the same ten Extra cards on both sides. Direct portrait Extra
opening uses the opponent control because the existing narrow board puts the
player's leftmost Extra control outside the scroll origin. Player Extra is
covered in the resize case. Whole-board mobile layout, touch, keyboard/focus,
translations, and other browser engines are outside this regression.
