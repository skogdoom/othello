import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Mirrors render/theme.ts: an 800-unit board with a 24-unit margin. */
const BOARD = 800;
const MARGIN = 24;
const CELL = (BOARD - MARGIN * 2) / 8;

/** d3 — a legal opening move for Black, flipping d4. */
const D3 = 19;

/** Page errors and console errors, minus the 404s the empty /sounds/ folder causes on purpose. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const where = msg.location().url;
    if (where.includes('/sounds/') || /sounds\/\w+\.mp3/.test(msg.text())) return;
    if (/Failed to load resource.*404/.test(msg.text()) && where === '') return;
    errors.push(`console: ${msg.text()} (${where})`);
  });
  return errors;
}

async function boot(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.locator('#loading')).toHaveCount(0);
  await expect(page.locator('#stage canvas')).toBeVisible();
}

/** Taps the centre of a square, converting board units the way the renderer's fit does. */
async function tapSquare(page: Page, square: number): Promise<void> {
  const box = (await page.locator('#stage canvas').boundingBox())!;
  const size = Math.min(box.width, box.height);
  const scale = size / BOARD;
  const centre = (index: number) => (MARGIN + index * CELL + CELL / 2) * scale;
  const x = box.x + (box.width - size) / 2 + centre(square % 8);
  const y = box.y + (box.height - size) / 2 + centre(Math.floor(square / 8));
  if (test.info().project.use.hasTouch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

async function scores(page: Page): Promise<[number, number]> {
  const black = Number(await page.locator('#score-black b').textContent());
  const white = Number(await page.locator('#score-white b').textContent());
  return [black, white];
}

/** Plays d3 and waits for the AI's reply to land and the turn to come back. */
async function playOpeningExchange(page: Page): Promise<void> {
  await tapSquare(page, D3);
  await expect.poll(() => scores(page)).not.toEqual([2, 2]);
  await expect.poll(async () => (await scores(page)).reduce((a, b) => a + b)).toBe(6);
  await expect(page.locator('#status')).toHaveText('Your turn');
}

test.beforeEach(async ({ page }) => {
  // Every test starts from a fresh game, not the last test's save.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-started')) {
      localStorage.clear();
      sessionStorage.setItem('e2e-started', '1');
    }
  });
});

test('boots into the human turn with no errors and no sound files', async ({ page }) => {
  const errors = collectErrors(page);
  await boot(page);

  expect(await scores(page)).toEqual([2, 2]);
  await expect(page.locator('#status')).toHaveText('Your turn');
  await expect(page.locator('#undo')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('plays a move, gets a reply, and undoes both', async ({ page }) => {
  const errors = collectErrors(page);
  await boot(page);

  await playOpeningExchange(page);
  await expect(page.locator('#undo')).toBeEnabled();

  await page.locator('#undo').click();
  expect(await scores(page)).toEqual([2, 2]);
  await expect(page.locator('#undo')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('resumes the game and the difficulty after a reload', async ({ page }) => {
  const errors = collectErrors(page);
  await boot(page);
  await playOpeningExchange(page);
  await page.locator('#difficulty').selectOption('hard');
  const before = await scores(page);

  await page.reload();
  await expect(page.locator('#loading')).toHaveCount(0);
  expect(await scores(page)).toEqual(before);
  await expect(page.locator('#status')).toHaveText('Your turn');
  await expect(page.locator('#undo')).toBeEnabled();
  await expect(page.locator('#difficulty')).toHaveValue('hard');
  expect(errors).toEqual([]);
});

/**
 * The 390 px portrait baseline, the same phone in landscape, and an iPhone 13
 * mini in landscape with Safari's toolbar and tab bar showing, which leaves
 * only 265 px of height.
 */
const LAYOUTS = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 812, height: 265 },
];

/**
 * Everything the layout test checks, in one round trip. The page is busy
 * drawing WebGL in software on a CI runner, and each separate query waits its
 * turn; a query per control added up to most of the test's time budget.
 */
function measureLayout(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const root = document.documentElement;
    const hud = document.querySelector('#hud')!;
    return {
      pageFits: root.scrollWidth <= innerWidth && root.scrollHeight <= innerHeight,
      stage: box(document.querySelector('#stage')!),
      hud: box(hud),
      // Nothing in the HUD is pushed out of it, or hidden behind a scroll.
      hudFits: hud.scrollWidth <= hud.clientWidth + 1 && hud.scrollHeight <= hud.clientHeight + 1,
      controls: [...hud.querySelectorAll('button, select')].map(box),
    };
  });
}

test('fits the viewport in both layouts with full-size tap targets', async ({ page }) => {
  await boot(page);

  for (const viewport of LAYOUTS) {
    const at = `at ${viewport.width}x${viewport.height}`;
    await page.setViewportSize(viewport);
    // The ResizeObserver settles within a frame or two; wait for it.
    await expect.poll(async () => (await measureLayout(page)).pageFits, at).toBe(true);
    const { stage, hud, hudFits, controls } = await measureLayout(page);

    // A sidebar in landscape, a bottom bar in portrait.
    if (viewport.width > viewport.height) {
      expect(hud.x, at).toBeGreaterThanOrEqual(stage.x + stage.width - 1);
      // The sidebar costs the height-constrained board nothing.
      expect(stage.width, at).toBeGreaterThanOrEqual(stage.height);
    } else {
      expect(hud.y, at).toBeGreaterThanOrEqual(stage.y + stage.height - 1);
    }
    expect(hudFits, `HUD overflows ${at}`).toBe(true);

    expect(controls.length).toBe(4);
    for (const control of controls) {
      expect(control.height, at).toBeGreaterThanOrEqual(44);
      expect(control.x, at).toBeGreaterThanOrEqual(0);
      expect(control.x + control.width, at).toBeLessThanOrEqual(viewport.width + 0.5);
      expect(control.y + control.height, at).toBeLessThanOrEqual(viewport.height + 0.5);
    }
  }
});

test('rotating during a search and a flip changes nothing but the layout', async ({ page }) => {
  const errors = collectErrors(page);
  await boot(page);
  await page.locator('#difficulty').selectOption('hard');
  await page.setViewportSize({ width: 390, height: 844 });

  await tapSquare(page, D3);
  for (let i = 0; i < 4; i++) {
    const landscape = i % 2 === 0;
    await page.setViewportSize({ width: landscape ? 844 : 390, height: landscape ? 390 : 844 });
  }
  await expect.poll(async () => (await scores(page)).reduce((a, b) => a + b)).toBe(6);
  await expect(page.locator('#status')).toHaveText('Your turn');
  expect(errors).toEqual([]);
});

test('survives a lost and restored WebGL context', async ({ page }) => {
  const errors = collectErrors(page);
  await boot(page);

  const lost = await page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>('#stage canvas')!;
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    const ext = gl?.getExtension('WEBGL_lose_context');
    if (!ext) return false;
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    ext.loseContext();
    await wait(200);
    ext.restoreContext();
    await wait(200);
    return true;
  });
  test.skip(!lost, 'this browser cannot simulate a context loss');

  await playOpeningExchange(page);
  expect(errors).toEqual([]);
});

test('falls back to a 2D canvas when WebGL is unavailable', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext as (...args: unknown[]) => unknown;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      id: string,
      ...rest: unknown[]
    ) {
      if (id.includes('webgl') || id === 'webgpu') return null;
      return original.call(this, id, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined });
  });
  await boot(page);
  // Pixi took the 2D context, so this is the canvas renderer drawing.
  const has2d = await page.evaluate(() => !!document.querySelector('canvas')!.getContext('2d'));
  expect(has2d).toBe(true);

  await playOpeningExchange(page);
  expect(errors).toEqual([]);
});

test('keeps playing on the main thread when the AI worker cannot load', async ({ page }) => {
  const errors = collectErrors(page);
  const warnings: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'warning') warnings.push(msg.text());
  });
  await page.route('**/worker-*.js', (route) => route.fulfill({ status: 404, body: 'missing' }));
  await boot(page);

  await playOpeningExchange(page);
  expect(warnings.some((w) => w.includes('searching on the main thread'))).toBe(true);
  // The browser's own report of the 404 is the only error expected here.
  expect(errors.filter((e) => !/worker|404/i.test(e))).toEqual([]);
});

test('says why instead of hanging when nothing can draw', async ({ page }) => {
  await page.addInitScript(() => {
    type GetContext = typeof HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (() => null) as GetContext;
    Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined });
  });
  await page.goto('./');
  await expect(page.locator('#loading.failed')).toContainText('could not draw the board');
});
