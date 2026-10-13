import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Runs against the built single-file app: `npm run build && npm run e2e`.
// SHOT_DIR=<dir> saves screenshots; CDR_REAL_FILES=a.xlsx:b.xlsx additionally
// loads real exports (local verification only — never commit those files).
const APP = 'file://' + resolve('dist/index.html');
const SHOT_DIR = process.env.SHOT_DIR;
const TABS = ['ภาพรวม', 'คู่ติดต่อ', 'ช่วงเวลา', 'Call burst', 'พื้นที่และการเดินทาง', 'อุปกรณ์', 'ผังเครือข่าย', 'เชื่อมโยงข้ามเป้าหมาย', 'รายการข้อมูล'];

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

test('link chart: search, details and a person profile saved to and opened from a file', async ({ page }, testInfo) => {
  const errors = watchErrors(page);
  await page.goto(APP);
  await page.getByRole('button', { name: 'ลองด้วยข้อมูลตัวอย่าง (สมมติ)' }).click();
  await openTab(page, 'ผังเครือข่าย');
  const toolbar = page.getByRole('toolbar', { name: 'เครื่องมือผัง' });
  await expect(toolbar).toBeVisible();

  await page.getByLabel('ค้นหาเลขหมายหรือชื่อในผัง').fill('0860000111');
  await toolbar.getByRole('button', { name: 'ค้นหา', exact: true }).click();
  const panel = page.getByRole('region', { name: 'รายละเอียดเลขหมาย' });
  await expect(panel).toContainText('ผู้ติดต่อร่วม 2 เป้าหมาย');

  // A made-up picture drawn in the browser (no real person).
  const painter = await page.context().newPage();
  await painter.setContent('<div id="a" style="width:240px;height:240px;background:linear-gradient(135deg,#6aa0d8,#2a4f7a)"></div>');
  const picture = await painter.locator('#a').screenshot();
  await painter.close();

  await panel.getByRole('button', { name: 'เพิ่มชื่อ ที่อยู่ ประวัติคดี และรูป' }).click();
  const dialog = page.getByRole('dialog', { name: /ข้อมูลบุคคลของเลข/ });
  await dialog.getByLabel('ชื่อ (รวมคำนำหน้า)').fill('นายทดสอบ');
  await dialog.getByLabel('นามสกุล').fill('ตัวอย่าง');
  await dialog.getByLabel('ที่อยู่').fill('ที่อยู่สมมติ');
  await dialog.getByLabel('ประวัติคดีอาญา (บรรทัดละ 1 คดี)').fill('คดีสมมติ');
  await page.getByTestId('photo-input').setInputFiles({ name: 'picture.png', mimeType: 'image/png', buffer: picture });
  await expect(dialog.locator('img.person-photo')).toBeVisible();
  await dialog.getByRole('button', { name: 'บันทึก', exact: true }).click();
  await expect(panel).toContainText('นายทดสอบ ตัวอย่าง');
  await expect(panel).toContainText('ประวัติคดีอาญา 1 รายการ');
  await expect(page.getByRole('table', { name: 'ตัวชี้วัดเครือข่าย' })).toContainText('นายทดสอบ ตัวอย่าง');
  await shot(page, '10-link-profile');

  // The chart (with the photo drawn in it) still exports as an image.
  const image = page.waitForEvent('download');
  await toolbar.getByRole('button', { name: 'บันทึกภาพ PNG' }).click();
  expect((await image).suggestedFilename()).toBe('cdr-network.png');

  const sidebar = page.getByRole('complementary', { name: 'ไฟล์และการตั้งค่า' });
  await expect(sidebar).toContainText('ยังไม่ได้บันทึก');
  const saved = page.waitForEvent('download');
  await sidebar.getByRole('button', { name: 'บันทึกเป็นไฟล์' }).click();
  const file = await saved;
  expect(file.suggestedFilename()).toMatch(/^CDR-profiles_\d{8}-\d{4}\.json$/);
  const path = testInfo.outputPath('profiles.json');
  await file.saveAs(path);
  const json = JSON.parse(readFileSync(path, 'utf8'));
  expect(json.profiles.map((p: { number: string }) => p.number)).toEqual(['0860000111']);
  expect(json.profiles[0].photo).toMatch(/^data:image\/jpeg;base64,/);
  await expect(sidebar).not.toContainText('ยังไม่ได้บันทึก');

  // Nothing is kept by the browser: a new page starts empty until the file is opened.
  await page.reload();
  await page.getByRole('button', { name: 'ลองด้วยข้อมูลตัวอย่าง (สมมติ)' }).click();
  await expect(sidebar).not.toContainText('ข้อมูลบุคคล (1)');
  await page.getByTestId('profiles-input').setInputFiles(path);
  await expect(sidebar).toContainText('ข้อมูลบุคคล (1)');

  await openTab(page, 'คู่ติดต่อ');
  const contacts = page.getByRole('table', { name: 'ตารางคู่ติดต่อ' });
  await expect(contacts).toContainText('นายทดสอบ ตัวอย่าง');
  await contacts.getByRole('button', { name: '0860000111' }).first().click();
  const drawer = page.getByRole('dialog', { name: /0860000111/ });
  await expect(drawer.getByRole('img', { name: 'ผังความเชื่อมโยงของ 0860000111' })).toBeVisible();
  await expect(drawer).toContainText('คดีสมมติ');
  await page.keyboard.press('Escape');

  await openTab(page, 'เชื่อมโยงข้ามเป้าหมาย');
  await expect(page.getByRole('img', { name: /^ผังผู้ติดต่อร่วม/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('call burst tab: bursts, burst details and bursts of several targets at once', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(APP);
  await page.getByRole('button', { name: 'ลองด้วยข้อมูลตัวอย่าง (สมมติ)' }).click();
  await openTab(page, 'Call burst');
  const table = page.getByRole('table', { name: 'รายการช่วงติดต่อถี่' });
  await expect(table).toBeVisible();
  await expect(page.getByRole('img', { name: /^กราฟเวลาที่เกิดการติดต่อถี่/ })).toBeVisible();

  // B's late-night burst on 2026-08-05: six calls in eight minutes.
  const row = table.getByRole('row').filter({ hasText: '05/08/2026' }).filter({ hasText: '0820000202' });
  await row.getByRole('button', { name: 'ดูรายละเอียด' }).click();
  const detail = page.getByRole('region', { name: 'รายละเอียดช่วงติดต่อถี่' });
  await expect(detail.getByRole('img', { name: /^ผังการติดต่อในช่วง/ })).toBeVisible();
  expect(await detail.getByRole('table', { name: 'รายการในช่วงติดต่อถี่' }).getByRole('row').count()).toBeGreaterThanOrEqual(7);

  // A bursts the same night: listed as a candidate of simultaneous activity.
  const together = page.getByRole('table', { name: 'ติดต่อถี่พร้อมกัน' });
  await expect(together).toContainText('0810000101');
  await expect(together).toContainText('0820000202');
  await shot(page, '11-call-burst');

  await page.getByRole('group', { name: 'สิ่งที่นับ' }).getByRole('button', { name: 'เฉพาะการโทร' }).click();
  await expect(table).toBeVisible();
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
