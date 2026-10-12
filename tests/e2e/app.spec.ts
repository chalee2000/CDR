import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Runs against the built single-file app: `npm run build && npm run e2e`.
// SHOT_DIR=<dir> saves screenshots; CDR_REAL_FILES=a.xlsx:b.xlsx additionally
// loads real exports (local verification only — never commit those files).
const APP = 'file://' + resolve('dist/index.html');
const SHOT_DIR = process.env.SHOT_DIR;
const TABS = ['ภาพรวม', 'คู่ติดต่อ', 'ช่วงเวลา', 'พื้นที่และการเดินทาง', 'อุปกรณ์', 'ผังเครือข่าย', 'เชื่อมโยงข้ามเป้าหมาย', 'รายการข้อมูล'];

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // Map tiles are unreachable offline; that is expected, not an app error.
    if (m.type() === 'error' && !/ERR_|tile\.openstreetmap|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

async function shot(page: Page, name: string) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(SHOT_DIR, `${name}.png`), fullPage: true });
}

async function openTab(page: Page, name: string) {
  await page.getByRole('tab', { name, exact: true }).click();
  await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
}

test('sample data: every tab renders without errors', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP);
  await expect(page.getByRole('heading', { name: 'วิเคราะห์ CDR ในเบราว์เซอร์' })).toBeVisible();
  await shot(page, '00-welcome');
  await page.getByRole('button', { name: 'ลองด้วยข้อมูลตัวอย่าง (สมมติ)' }).click();

  const sidebar = page.getByRole('complementary', { name: 'ไฟล์และการตั้งค่า' });
  await expect(sidebar.locator('.ds-item')).toHaveCount(3);
  await expect(sidebar.getByText('0810000101', { exact: true })).toBeVisible();
  // Wall-clock times: the first sample record is 2026-07-01 even in a US time zone.
  await expect(sidebar.getByText('01/07/2026 – 31/08/2026').first()).toBeVisible();

  for (const [i, name] of TABS.entries()) {
    await openTab(page, name);
    await shot(page, `${String(i + 1).padStart(2, '0')}-${name}`);
  }

  await openTab(page, 'เชื่อมโยงข้ามเป้าหมาย');
  await expect(page.getByRole('table', { name: 'ผู้ติดต่อร่วม' }).getByRole('button', { name: '0860000111' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'ผู้ติดต่อร่วม' }).getByRole('button', { name: '0950000222' })).toBeVisible();

  await openTab(page, 'คู่ติดต่อ');
  await page.getByRole('table', { name: 'ตารางคู่ติดต่อ' }).getByRole('button', { name: '0860000111' }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText('ติดต่อกับเป้าหมาย 2 ราย')).toBeVisible();
  await shot(page, '09-drawer');
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);

  await page.getByRole('group', { name: 'ธีม' }).getByRole('button', { name: 'มืด' }).click();
  for (const name of ['ภาพรวม', 'ช่วงเวลา', 'ผังเครือข่าย', 'พื้นที่และการเดินทาง']) {
    await openTab(page, name);
    await shot(page, `dark-${name}`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, 'ภาพรวม');
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollW).toBeLessThanOrEqual(390);
  await shot(page, 'mobile-overview');

  expect(errors).toEqual([]);
});

test('excel export downloads a workbook', async ({ page }) => {
  await page.goto(APP);
  await page.getByRole('button', { name: 'ลองด้วยข้อมูลตัวอย่าง (สมมติ)' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ส่งออก Excel' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^CDR-analysis_.*\.xlsx$/);
});

// CDR_EXPECT_RECORDS=350,300,1262 checks each file's record count (same order).
test('real exports load and render every tab', async ({ page }) => {
  const files = process.env.CDR_REAL_FILES?.split(':').filter(Boolean) ?? [];
  test.skip(files.length === 0, 'set CDR_REAL_FILES to run');
  const errors = watchErrors(page);
  await page.goto(APP);
  await page.getByTestId('file-input').setInputFiles(files);
  const sidebar = page.getByRole('complementary', { name: 'ไฟล์และการตั้งค่า' });
  await expect(sidebar.locator('.ds-item')).toHaveCount(files.length, { timeout: 30_000 });
  const expected = process.env.CDR_EXPECT_RECORDS?.split(',').map(Number) ?? [];
  for (const [i, n] of expected.entries()) {
    await expect(sidebar.locator('.ds-item').nth(i)).toContainText(`${n.toLocaleString('en-US')} รายการ`);
  }
  for (const name of TABS) {
    await openTab(page, name);
    await shot(page, `real-${name}`);
  }
  expect(errors).toEqual([]);
});
