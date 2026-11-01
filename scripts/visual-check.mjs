import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const base = process.env.CHAMBER_QA_URL || 'http://localhost:5174';
const edge = process.env.CHAMBER_QA_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const outDir = path.resolve('storage/qa');
fs.mkdirSync(outDir, { recursive: true });

const errors = [];
const failed = [];

const browser = await chromium.launch({
  executablePath: edge,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

// The /api/auth/me probe answers 401 until the dev sign-in runs; that is the
// app's own unauthenticated path, not a page defect.
const isExpectedAuthProbe = (text) => text.includes('401 (Unauthorized)');

page.on('console', (message) => {
  if (message.type() === 'error' && !isExpectedAuthProbe(message.text())) errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(error.message));
page.on('requestfailed', (request) => {
  if (!request.url().includes('favicon')) failed.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText}`);
});

async function shot(name, fullPage = true) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage });
}

await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
await shot('01-login');

await page.getByRole('button', { name: 'Development sign-in' }).click();
await page.waitForURL('**/g/**', { timeout: 20000 });
await page.waitForLoadState('networkidle');
await shot('02-overview');

const pages = [
  ['general', 'general'],
  ['triggers', 'triggers'],
  ['categories', 'categories'],
  ['templates', 'templates'],
  ['room-types', 'room-types'],
  ['permissions', 'permissions'],
  ['privacy', 'privacy'],
  ['waiting-room', 'waiting-room'],
  ['queue', 'queue'],
  ['reservations', 'reservations'],
  ['automation', 'automation'],
  ['ai', 'ai'],
  ['active-rooms', 'active-rooms'],
  ['analytics', 'analytics'],
  ['logs', 'logs'],
  ['premium', 'premium'],
  ['advanced', 'advanced'],
];

let index = 3;
for (const [pathName, name] of pages) {
  await page.goto(`${base}/g/900000000000000001/${pathName}`, { waitUntil: 'networkidle' });
  await shot(`${String(index).padStart(2, '0')}-${name}`);
  index += 1;
}

// The room drawer is the only place identity (banner/description) and the
// per-member permission controls render, so it needs its own capture.
await page.goto(`${base}/g/900000000000000001/active-rooms`, { waitUntil: 'networkidle' });
const roomCard = page.getByText("Muslim's Lounge", { exact: true }).first();
if (await roomCard.count()) {
  await roomCard.click();
  await shot('24-room-drawer');
  await page.locator('aside[role="dialog"] .overflow-y-auto').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await shot('25-room-drawer-permissions');
}

await page.goto(`${base}/g/900000000000000001/templates`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'New template' }).click();
await shot('20-template-builder', false);
await page.keyboard.press('Escape');

await page.goto(`${base}/g/900000000000000001/reservations`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'New reservation' }).click();
await shot('21-reservation-modal', false);
await page.keyboard.press('Escape');

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${base}/g/900000000000000001`, { waitUntil: 'networkidle' });
await shot('22-mobile-overview');
await page.goto(`${base}/g/900000000000000001/templates`, { waitUntil: 'networkidle' });
await shot('23-mobile-templates');
await page.setViewportSize({ width: 1440, height: 1000 });

const snapshot = await page.evaluate(() => ({
  title: document.title,
  bodyText: document.body.innerText.slice(0, 500),
}));

await browser.close();

console.log(JSON.stringify({ errors, failed, snapshot, outDir }, null, 2));
if (errors.length > 0 || failed.length > 0) process.exitCode = 2;
