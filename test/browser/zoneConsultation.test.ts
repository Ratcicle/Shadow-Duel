import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Only the browser capabilities used by this opt-in test. Playwright is supplied
// by the caller, so the normal Node suite needs no browser dependency or types.
interface Viewport { width: number; height: number }
interface Locator {
  click(): Promise<void>;
  first(): Locator;
  filter(options: { hasText: string }): Locator;
  locator(selector: string): Locator;
  waitFor(options?: { state: "visible" | "hidden" }): Promise<void>;
  count(): Promise<number>;
  setInputFiles(file: { name: string; mimeType: string; buffer: Buffer }): Promise<void>;
  evaluate<Result, Arg = undefined>(fn: (element: HTMLElement, arg: Arg) => Result, arg?: Arg): Promise<Result>;
}
interface Page {
  setDefaultTimeout(timeout: number): void;
  on(event: "pageerror", callback: (error: Error) => void): void;
  on(event: "dialog", callback: (dialog: { accept(): Promise<void> }) => Promise<void>): void;
  on(event: "console", callback: (message: { type(): string; text(): string }) => void): void;
  on(event: "requestfailed", callback: (request: { url(): string; failure(): { errorText: string } | null }) => void): void;
  waitForEvent(event: "dialog"): Promise<unknown>;
  addInitScript(options: { content: string }): Promise<void>;
  goto(url: string): Promise<unknown>;
  locator(selector: string): Locator;
  evaluate<Result>(fn: () => Result): Promise<Result>;
  waitForFunction<Result, Arg = undefined>(fn: (arg: Arg) => Result, arg?: Arg): Promise<unknown>;
  waitForTimeout(timeout: number): Promise<void>;
  setViewportSize(viewport: Viewport): Promise<void>;
  screenshot(options: { path: string }): Promise<unknown>;
  mouse: {
    move(x: number, y: number, options?: { steps: number }): Promise<void>;
    wheel(x: number, y: number): Promise<void>;
    click(x: number, y: number): Promise<void>;
    down(): Promise<void>;
    up(): Promise<void>;
  };
}
interface Browser {
  newPage(options: { viewport: Viewport }): Promise<Page>;
  version(): string;
  close(): Promise<void>;
}
interface BrowserModule {
  chromium: { launch(options: { headless: boolean; executablePath?: string }): Promise<Browser> };
}

// Opt-in browser regression: start Vite, set SHADOW_DUEL_BROWSER_TESTS=1, then run
// this file with Node --import=tsx --test. See README.md for the complete command.
// Use a locally installed `playwright`, or pass its module URL via PLAYWRIGHT_MODULE.
// No dependency on a machine-specific runtime path or a running game's internals.
const enabled = process.env.SHADOW_DUEL_BROWSER_TESTS === "1";
const browserModule: BrowserModule | null = enabled
  ? await import(process.env.PLAYWRIGHT_MODULE || "playwright") : null;
const baseURL = process.env.SHADOW_DUEL_URL || "http://127.0.0.1:5173/Shadow-Duel/";
const output = resolve(process.env.BROWSER_ARTIFACTS || ".cache/zone-consultation");
const fixture = await readFile(new URL("./fixtures/zone-consultation.json", import.meta.url));
await mkdir(output, { recursive: true });

const viewports = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
];

for (const viewport of viewports) for (const opening of ["direct", "resize"]) {
  test(`zone consultation ${viewport.width}x${viewport.height} ${opening}`, { skip: !enabled }, async () => {
    assert.ok(browserModule);
    const desktop = viewports[0];
    assert.ok(desktop);
    const browser = await browserModule.chromium.launch({
      headless: true,
      ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
    });
    const page = await browser.newPage({ viewport: desktop });
    page.setDefaultTimeout(7000);
    await page.addInitScript({ content: "window.__name = (fn) => fn;" });
    const prefix = `${viewport.width}x${viewport.height}-${opening}`;
    const errors: string[] = [], trace: unknown[] = [], diagnostics: unknown[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") diagnostics.push({ kind: "console", text: message.text() }); });
    page.on("requestfailed", request => diagnostics.push({ kind: "network", url: request.url(), error: request.failure() }));
    page.on("dialog", dialog => dialog.accept());
    const board = () => page.evaluate(() => ({
      phase: document.querySelector("#phase-track .active")?.getAttribute("data-phase"),
      turn: document.querySelector("#turn-indicator")?.textContent,
      lp: document.querySelector("#player-lp")?.textContent,
      botLP: document.querySelector("#bot-lp")?.textContent,
      hand: [...document.querySelectorAll("#player-hand .card")].map(e => e.getAttribute("data-card-key")),
      field: [...document.querySelectorAll("#player-field .card")].map(e => e.getAttribute("data-card-key")),
      gy: document.querySelector("#player-graveyard")?.textContent,
      extra: document.querySelector("#player-extradeck")?.textContent,
    }));
    const panel = () => page.locator("#sidebar").evaluate(element => ({
      mode: element.dataset.previewMode,
      style: element.getAttribute("style"),
      preference: localStorage.getItem("shadow_duel_preview_layout_v1"),
    }));

    try {
      await page.goto(baseURL);
      await page.locator("#btn-open-laboratory").click();
      const imported = page.waitForEvent("dialog");
      await page.locator("#laboratory-import-file").setInputFiles({
        name: "zone-consultation.json", mimeType: "application/json", buffer: fixture,
      });
      await imported;
      await page.locator("#laboratory-start").click();
      await page.locator("#player-hand .card").first().waitFor();
      const initial = await board();
      assert.equal(initial.hand.length, 2);
      assert.equal(initial.phase, "main1");
      assert.equal(initial.lp, "8000");

      for (const zone of ["gy", "extra"]) {
        await page.setViewportSize(opening === "direct" ? viewport : desktop);
        const before = await panel();
        const modal = page.locator(zone === "gy" ? "#gy-modal" : "#extradeck-modal");
        // The portrait board's leftmost player Extra control is outside its
        // scroll origin. The opponent's visible Extra opens the same consultation.
        const opener = zone === "gy" ? "#player-graveyard"
          : opening === "direct" && viewport.width === 390 ? "#bot-extradeck" : "#player-extradeck";
        await page.locator(opener).click();
        await modal.waitFor({ state: "visible" });
        if (opening === "resize") await page.setViewportSize(viewport);
        const openPanel = await panel();
        assert.equal(openPanel.mode, before.mode);
        assert.equal(await modal.locator(".card").count(), zone === "gy" ? 25 : 10);

        const snapshot = async (stage: string) => {
          const result = await modal.evaluate((element, stage) => {
            const content = element.querySelector<HTMLElement>(".modal-content")!;
            const rect = content.getBoundingClientRect();
            const cards = [...element.querySelectorAll(".card")].map((card, index) => {
              const r = card.getBoundingClientRect();
              const left = Math.max(r.left, rect.left, 0), right = Math.min(r.right, rect.right, innerWidth);
              const top = Math.max(r.top, rect.top, 0), bottom = Math.min(r.bottom, rect.bottom, innerHeight);
              const x = (left + right) / 2, y = (top + bottom) / 2;
              const visible = right - left > 8 && bottom - top > 8;
              return { index, name: card.querySelector(".card-name")?.textContent, x, y, visible,
                reachable: !visible || card.contains(document.elementFromPoint(x, y)) };
            });
            return { stage, cards, x: rect.x, y: rect.y, width: rect.width, height: rect.height,
              scrollTop: content.scrollTop, scrollHeight: content.scrollHeight, clientHeight: content.clientHeight,
              scrollWidth: content.scrollWidth, clientWidth: content.clientWidth };
          }, stage);
          trace.push({ zone, ...result });
          return result;
        };

        let state = await snapshot("top");
        await page.screenshot({ path: `${output}/${prefix}-${zone}-top.png` });
        assert.equal(state.scrollWidth, state.clientWidth, "zone content has no horizontal overflow");
        assert.ok(state.x >= 0 && state.y >= 0 && state.x + state.width <= viewport.width + 1
          && state.y + state.height <= viewport.height + 1, "zone content stays inside the viewport");
        const seen = new Set();
        for (let step = 0; step < 40; step++) {
          for (const card of state.cards.filter(card => card.visible)) {
            assert.ok(card.reachable, `D10C3-01: visible ${card.name} must receive pointer input without moving the preview`);
            if (seen.has(card.index)) continue;
            await page.mouse.move(state.x + 3, state.y + 3);
            await page.mouse.move(card.x, card.y);
            try {
              await page.waitForFunction(name => document.querySelector("#preview-name")?.textContent === name, card.name);
            } catch (error) {
              trace.push({ zone, stage: "failed-hover", card,
                actual: await page.evaluate(() => document.querySelector("#preview-name")?.textContent) });
              await page.screenshot({ path: `${output}/${prefix}-${zone}-failed-hover.png` });
              throw error;
            }
            seen.add(card.index);
          }
          if (state.scrollTop + state.clientHeight >= state.scrollHeight - 1) break;
          await page.mouse.move(state.x + state.width / 2, state.y + state.height / 2);
          await page.mouse.wheel(0, Math.max(80, state.clientHeight / 2));
          await page.waitForTimeout(100);
          state = await snapshot(`wheel-${step}`);
        }
        assert.equal(seen.size, zone === "gy" ? 25 : 10, "all cards reached through real wheel and hover input");
        assert.ok(state.scrollTop + state.clientHeight >= state.scrollHeight - 1, "wheel reaches the end of long content");

        const reading = await page.locator("#preview-desc").evaluate(element => {
          const r = element.getBoundingClientRect();
          return { width: r.width, height: r.height, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
            reachable: element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
        });
        trace.push({ zone, stage: "preview", reading });
        assert.ok(reading.width >= 120 && reading.height >= 40 && reading.reachable, "inspection text remains readable and reachable");
        assert.equal(reading.scrollWidth, reading.clientWidth, "preview text wraps without horizontal overflow");
        const description = page.locator("#preview-desc");
        const readingPoint = await description.evaluate(element => {
          const r = element.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        await page.mouse.move(readingPoint.x, readingPoint.y);
        await page.mouse.wheel(0, 3000);
        await page.waitForTimeout(100);
        assert.ok(await description.evaluate(element => element.scrollTop + element.clientHeight >= element.scrollHeight - 1),
          "long inspection text can be read to the end with wheel input");
        await page.screenshot({ path: `${output}/${prefix}-${zone}-bottom.png` });

        // Scroll back with wheel so the existing GY close control is exposed.
        for (let step = 0; step < 40 && state.scrollTop > 0; step++) {
          await page.mouse.move(state.x + state.width / 2, state.y + state.height / 2);
          await page.mouse.wheel(0, -state.clientHeight);
          await page.waitForTimeout(80);
          state = await snapshot(`up-${step}`);
        }
        if (zone === "gy") await modal.locator(".close-modal").click();
        else {
          // Existing Extra closure: real click on the uncovered modal backdrop.
          const point = await modal.evaluate(element => {
            const r = element.getBoundingClientRect();
            return { x: r.left + 4, y: r.top + 4 };
          });
          await page.mouse.click(point.x, point.y);
        }
        await modal.waitFor({ state: "hidden" });
        assert.deepEqual(await panel(), openPanel, "consultation never changes preview mode, geometry or stored preference");
        assert.deepEqual(await board(), initial, "consultation preserves the presented duel");
        assert.equal(await page.locator(".modal:not(.hidden)").count(), 0);
      }

      // Continuation is deliberately desktop: whole-board mobile layout is outside this regression.
      await page.setViewportSize(desktop);
      await page.locator("#player-hand .card").first().click();
      await page.locator(".summon-choice-modal button").filter({ hasText: "Normal Summon" }).click();
      await page.waitForFunction(() => document.querySelectorAll("#player-field .card").length === 1
        && !document.querySelector(".summon-choice-modal"));
      const final = await board();
      assert.equal(final.hand.length, 1);
      assert.equal(final.field.length, 1);
      assert.equal(final.lp, "8000");
      await page.screenshot({ path: `${output}/${prefix}-continued.png` });
      assert.deepEqual(errors, [], "no uncaught browser errors");
    } finally {
      await writeFile(`${output}/${prefix}-trace.json`, JSON.stringify({ viewport, opening, browser: browser.version(), errors, diagnostics, trace }, null, 2));
      await browser.close();
    }
  });
}

for (const mode of ["docked-left", "floating"] as const) {
  test(`portrait consultation restores ${mode} preview`, { skip: !enabled }, async () => {
    assert.ok(browserModule);
    const browser = await browserModule.chromium.launch({
      headless: true,
      ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(7000);
    await page.addInitScript({ content: "window.__name = (fn) => fn;" });
    page.on("dialog", dialog => dialog.accept());
    try {
      await page.goto(baseURL);
      await page.locator("#btn-open-laboratory").click();
      const imported = page.waitForEvent("dialog");
      await page.locator("#laboratory-import-file").setInputFiles({
        name: "zone-consultation.json", mimeType: "application/json", buffer: fixture,
      });
      await imported;
      await page.locator("#laboratory-start").click();
      await page.locator("#player-hand .card").first().waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      const handle = await page.locator(".card-preview-drag-handle").evaluate(element => {
        const r = element.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width };
      });
      await page.mouse.move(handle.x, handle.y);
      await page.mouse.down();
      await page.mouse.move(mode === "docked-left" ? handle.width / 2 + 8 : 156, handle.y, { steps: 15 });
      await page.mouse.up();
      await page.waitForFunction(expected => document.querySelector<HTMLElement>("#sidebar")?.dataset.previewMode === expected, mode);
      // Establish the controller's ordinary orientation clamping, then repeat
      // the same resize with a consultation open. CSS must not change its limits.
      await page.setViewportSize({ width: 844, height: 390 });
      await page.setViewportSize({ width: 390, height: 844 });
      const snapshotPanel = () => page.locator("#sidebar").evaluate(element => {
        const r = element.getBoundingClientRect();
        return { mode: element.dataset.previewMode, style: element.getAttribute("style"),
          preference: localStorage.getItem("shadow_duel_preview_layout_v1"),
          rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
      });
      const before = await snapshotPanel();
      await page.locator("#player-graveyard").click();
      const modal = page.locator("#gy-modal");
      await modal.waitFor({ state: "visible" });
      await page.setViewportSize({ width: 844, height: 390 });
      await page.setViewportSize({ width: 390, height: 844 });
      await modal.locator(".card").first().evaluate(element => {
        const r = element.getBoundingClientRect();
        if (!element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))) {
          throw new Error("First consultation card is covered by preview");
        }
      });
      const firstCard = await modal.locator(".card").first().evaluate(element => {
        const r = element.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, name: element.querySelector(".card-name")?.textContent };
      });
      await page.mouse.move(firstCard.x, firstCard.y);
      await page.waitForFunction(name => document.querySelector("#preview-name")?.textContent === name, firstCard.name);
      await page.screenshot({ path: `${output}/390x844-${mode}-open.png` });
      await modal.locator(".close-modal").click();
      await modal.waitFor({ state: "hidden" });
      const after = await snapshotPanel();
      assert.deepEqual(after, before, "closing restores preview geometry and preference exactly");
      await page.screenshot({ path: `${output}/390x844-${mode}-closed.png` });
      await writeFile(`${output}/390x844-${mode}-trace.json`, JSON.stringify({ before, after }, null, 2));
    } finally {
      await browser.close();
    }
  });
}
