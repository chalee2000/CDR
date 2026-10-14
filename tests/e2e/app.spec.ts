import { mkdirSync, readFileSync, statSync } from 'node:fs';
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

  // The other party's positions are squares, the target's circles.
  await openTab(page, 'พื้นที่และการเดินทาง');
  // AIS files have no cell coordinates: sites sit at their subdistrict's point.
  await expect(page.getByText(/วางไว้ที่จุดกลางของตำบลตามชื่อพื้นที่ในไฟล์/)).toBeVisible();
  await expect(page.getByRole('cell', { name: '≈ ตำบล' }).first()).toBeVisible();
  await page.getByRole('group', { name: 'ขอบเขตแผนที่' }).getByRole('button', { name: 'ทุกเป้าหมาย' }).click();
  await expect(page.locator('.peer-square').first()).toBeVisible();
  // A name typed in for the other party shows next to its number.
  await page.locator('.peer-square').first().click({ force: true });
  const popup = page.locator('.leaflet-popup-content');
  const peerNo = /คู่สาย: (\S+) \(/.exec(await popup.innerText())![1];
  await page.getByTestId('profiles-input').setInputFiles({
    name: 'profiles.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'cdr-analyzer/profiles', version: 1, profiles: [{ number: peerNo, firstName: 'นายสมมติ', lastName: 'คู่สายทดสอบ' }] })),
  });
  await page.locator('.peer-square').first().click({ force: true });
  // The popup of the redrawn square replaces the old one, which fades out.
  await expect(popup).toHaveCount(1);
  await expect(popup).toContainText(`${peerNo} (`);
  await expect(popup).toContainText('นายสมมติ คู่สายทดสอบ');
  await page.keyboard.press('Escape');
  await page.getByLabel(/ตำแหน่งของคู่สาย/).uncheck();
  await expect(page.locator('.peer-square')).toHaveCount(0);

  // True/DTAC: which SIM wrote each row, and whose positions they are.
  await openTab(page, 'ภาพรวม');
  const sims = page.getByRole('table', { name: 'ตรวจเจ้าของพิกัดจาก IMSI' });
  await expect(sims).toContainText('520050000000303');
  await expect(sims.getByRole('row').filter({ hasText: '520050000000303' })).toContainText('ตำแหน่งของเป้าหมาย');
  await expect(sims).toContainText('(ไม่นับเป็นของเป้าหมาย)');
  // The investigator can settle a SIM's owner; everything is recomputed.
  const peerRow = sims.getByRole('row').filter({ hasText: 'อัตโนมัติ (คู่สาย)' }).first();
  const imsi = (await peerRow.getByRole('combobox').getAttribute('aria-label'))!.replace('เจ้าของ IMSI ', '');
  await sims.getByRole('combobox', { name: `เจ้าของ IMSI ${imsi}` }).selectOption('target');
  const row = sims.getByRole('row').filter({ has: page.getByRole('combobox', { name: `เจ้าของ IMSI ${imsi}` }) });
  await expect(row).toContainText('เป้าหมาย (กำหนดเอง)');
  await expect(row).toContainText('ระบบตัดสินว่าเป็นของคู่สาย');
  await expect(page.getByText('ผู้ใช้กำหนดเจ้าของ IMSI เอง 1 ค่า')).toBeVisible();
  await shot(page, 'imsi-manual');
  await sims.getByRole('combobox', { name: `เจ้าของ IMSI ${imsi}` }).selectOption('auto');
  await expect(row).not.toContainText('(กำหนดเอง)');
  await expect(page.getByText('ผู้ใช้กำหนดเจ้าของ IMSI เอง 1 ค่า')).toHaveCount(0);

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

  await page.getByLabel('ค้นหาเลขหมาย ชื่อ หรือเลขบัตรในผัง').fill('0860000111');
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
  // A fictitious ID: a wrong check digit is flagged, the right one is not.
  const nid = dialog.getByLabel('เลขบัตรประชาชน');
  await nid.fill('1111111111111');
  await expect(dialog).toContainText('หลักสุดท้ายไม่ตรงกับเลขตรวจสอบ');
  await nid.fill('1-1111-11111-11-9');
  await expect(dialog).not.toContainText('หลักสุดท้ายไม่ตรงกับเลขตรวจสอบ');
  await dialog.getByLabel('ที่อยู่').fill('ที่อยู่สมมติ');
  await dialog.getByLabel('ประวัติคดีอาญา (บรรทัดละ 1 คดี)').fill('คดีสมมติ');
  await page.getByTestId('photo-input').setInputFiles({ name: 'picture.png', mimeType: 'image/png', buffer: picture });
  await expect(dialog.locator('img.person-photo')).toBeVisible();
  await dialog.getByRole('button', { name: 'บันทึก', exact: true }).click();
  await expect(panel).toContainText('นายทดสอบ ตัวอย่าง');
  await expect(panel).toContainText('ประวัติคดีอาญา 1 รายการ');
  await expect(panel).toContainText('เลขบัตรประชาชน: 1-1111-11111-11-9');
  // The chart can be searched by the ID too.
  const search = page.getByLabel('ค้นหาเลขหมาย ชื่อ หรือเลขบัตรในผัง');
  await search.fill('0810000101');
  await toolbar.getByRole('button', { name: 'ค้นหา', exact: true }).click();
  await expect(panel).not.toContainText('เลขบัตรประชาชน');
  await search.fill('1111111111119');
  await toolbar.getByRole('button', { name: 'ค้นหา', exact: true }).click();
  await expect(panel).toContainText('เลขบัตรประชาชน: 1-1111-11111-11-9');
  await expect(page.getByRole('table', { name: 'ตัวชี้วัดเครือข่าย' })).toContainText('นายทดสอบ ตัวอย่าง');
  await shot(page, '10-link-profile');

  // Double click on the chart works like the full-screen button, and back.
  const mainChart = page.getByRole('img', { name: /^ผังความเชื่อมโยง \d/ });
  await mainChart.dblclick({ position: { x: 20, y: 20 } });
  await expect(toolbar.getByRole('button', { name: 'ออกจากเต็มจอ' })).toBeVisible();
  await mainChart.dblclick({ position: { x: 20, y: 20 } });
  await expect(toolbar.getByRole('button', { name: 'เต็มจอ', exact: true })).toBeVisible();

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
  expect(json.profiles[0].nationalId).toBe('1111111111119');
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
  const egoChart = drawer.getByRole('img', { name: 'ผังความเชื่อมโยงของ 0860000111' });
  await expect(egoChart).toBeVisible();
  await expect(drawer).toContainText('คดีสมมติ');
  await expect(drawer).toContainText('1-1111-11111-11-9');
  // Double click shows the chart full screen; double click again goes back.
  const exitFull = page.getByRole('button', { name: 'ออกจากเต็มจอ' });
  await egoChart.dblclick({ position: { x: 20, y: 20 } });
  await expect(exitFull).toBeVisible();
  await expect.poll(async () => (await egoChart.boundingBox())!.height).toBeGreaterThan(600);
  await egoChart.dblclick({ position: { x: 20, y: 20 } });
  await expect(exitFull).toHaveCount(0);
  await expect.poll(async () => (await egoChart.boundingBox())!.height).toBe(280);
  // Esc leaves full screen only: the number's details stay open.
  await egoChart.dblclick({ position: { x: 20, y: 20 } });
  await expect(exitFull).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(exitFull).toHaveCount(0);
  await expect(drawer).toBeVisible();
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

test('backup menu: the whole session to a password-protected file and back', async ({ page }, testInfo) => {
  const errors = watchErrors(page);
  await page.goto(APP);
  const menuButton = page.getByRole('button', { name: 'สำรอง/กู้ไฟล์' });
  const menu = page.getByRole('menu', { name: 'สำรองและกู้ไฟล์งาน' });
  // Nothing to back up on an empty page, but a backup can always be restored.
  await menuButton.click();
  await expect(menu.getByRole('menuitem', { name: /สำรองไฟล์/ })).toBeDisabled();
  await expect(menu.getByRole('menuitem', { name: /กู้ไฟล์/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(menuButton).toBeFocused();

  await page.getByRole('button', { name: 'ลองด้วยข้อมูลตัวอย่าง (สมมติ)' }).click();
  const sidebar = page.getByRole('complementary', { name: 'ไฟล์และการตั้งค่า' });
  await expect(sidebar.locator('.ds-item')).toHaveCount(3);

  // An alias, a person and a changed setting: all part of the session.
  await sidebar.getByRole('button', { name: 'ตั้งชื่อเรียก 0810000101' }).click();
  await sidebar.getByLabel('ชื่อเรียกของเป้าหมาย').fill('นาย ก. (สมมติ)');
  await sidebar.getByLabel('ชื่อเรียกของเป้าหมาย').press('Enter');
  await sidebar.getByRole('button', { name: 'ข้อมูลบุคคลของ 0820000202' }).click();
  const profile = page.getByRole('dialog', { name: /ข้อมูลบุคคลของเลข/ });
  await profile.getByLabel('ชื่อ (รวมคำนำหน้า)').fill('นายสำรอง');
  await profile.getByLabel('นามสกุล').fill('ทดสอบ');
  await profile.getByRole('button', { name: 'บันทึก', exact: true }).click();
  await expect(sidebar).toContainText('ยังไม่ได้บันทึก');
  await openTab(page, 'Call burst');
  await page.getByLabel('จำนวนครั้งขั้นต่ำ').fill('4');

  await menuButton.click();
  await menu.getByRole('menuitem', { name: /สำรองไฟล์/ }).click();
  const dialog = page.getByRole('dialog', { name: 'สำรองไฟล์งาน' });
  await expect(dialog).toContainText('3 เป้าหมาย (ตั้งชื่อเรียก 1)');
  const save = dialog.getByRole('button', { name: 'บันทึกไฟล์สำรอง' });
  await dialog.getByLabel('รหัสผ่าน', { exact: true }).fill('ทดสอบ-1234');
  await expect(save).toBeDisabled();
  await dialog.getByLabel('ยืนยันรหัสผ่าน').fill('ทดสอบ-1234');
  await shot(page, '12-backup');
  const download = page.waitForEvent('download');
  await save.click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^CDR-backup_\d{8}-\d{4}\.cdrbak$/);
  const path = testInfo.outputPath('session.cdrbak');
  await file.saveAs(path);
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 6).toString('latin1')).toBe('CDRBAK');
  expect(bytes.includes(Buffer.from('0810000101'))).toBe(false);
  await expect(dialog).toHaveCount(0);
  await expect(sidebar).not.toContainText('ยังไม่ได้บันทึก');

  // A fresh page holds nothing until the backup is opened. Settings are a
  // browser preference, so put them back first to see the backup restore them.
  await page.reload();
  await sidebar.getByText('การตั้งค่าการวิเคราะห์').click();
  await sidebar.getByRole('button', { name: 'คืนค่าเริ่มต้น' }).click();
  await expect(sidebar.getByLabel('โทรถี่ ≥ ครั้ง')).toHaveValue('5');
  // Escape still reaches other parts of the page while no dialog is open.
  await sidebar.getByText('การตั้งค่าการวิเคราะห์').click();

  const chooser = page.waitForEvent('filechooser');
  await menuButton.click();
  await menu.getByRole('menuitem', { name: /กู้ไฟล์/ }).click();
  await (await chooser).setFiles(path);
  const restore = page.getByRole('dialog', { name: 'กู้ไฟล์จากไฟล์สำรอง' });
  await expect(restore).toContainText('มีรหัสผ่าน');
  await restore.getByLabel('รหัสผ่านของไฟล์สำรอง').fill('wrong password');
  await restore.getByRole('button', { name: 'เปิดไฟล์' }).click();
  await expect(restore.getByRole('alert')).toContainText('รหัสผ่านไม่ถูกต้อง');
  await restore.getByLabel('รหัสผ่านของไฟล์สำรอง').fill('ทดสอบ-1234');
  await restore.getByLabel('รหัสผ่านของไฟล์สำรอง').press('Enter');
  await expect(restore).toContainText('3 ราย จาก 3 ไฟล์');
  await expect(restore).toContainText('นาย ก. (สมมติ)');
  await shot(page, '13-restore');
  await restore.getByRole('button', { name: 'กู้ไฟล์', exact: true }).click();
  await expect(restore).toHaveCount(0);

  await expect(sidebar.locator('.ds-item')).toHaveCount(3);
  await expect(sidebar).toContainText('นาย ก. (สมมติ)');
  await expect(sidebar).toContainText('นายสำรอง ทดสอบ');
  await expect(sidebar).toContainText('ข้อมูลบุคคล (1)');
  await expect(sidebar).not.toContainText('ยังไม่ได้บันทึก');
  await expect(sidebar.getByLabel('โทรถี่ ≥ ครั้ง')).toHaveValue('4');
  for (const name of TABS) await openTab(page, name);

  // A backup dropped on the CDR import area is restored, not read as a table.
  await page.getByTestId('file-input').setInputFiles(path);
  await expect(restore).toBeVisible();
  await restore.getByLabel('รหัสผ่านของไฟล์สำรอง').fill('ทดสอบ-1234');
  await restore.getByRole('button', { name: 'เปิดไฟล์' }).click();
  await expect(restore).toContainText('งานที่เปิดอยู่ตอนนี้ (เป้าหมาย 3 ราย');
  await page.keyboard.press('Escape');
  await expect(restore).toHaveCount(0);
  await expect(sidebar.locator('.ds-item')).toHaveCount(3);

  await page.setViewportSize({ width: 390, height: 844 });
  await menuButton.click();
  const box = await menu.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
  await menu.getByRole('menuitem', { name: /สำรองไฟล์/ }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(page, 'mobile-backup');
  await dialog.getByRole('button', { name: 'ยกเลิก' }).click();
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

  // A backup of the real session restores the same records. The file stays
  // in Playwright's temporary download folder and goes with the browser.
  const password = 'local-check-only';
  await page.getByRole('button', { name: 'สำรอง/กู้ไฟล์' }).click();
  await page.getByRole('menuitem', { name: /สำรองไฟล์/ }).click();
  const dialog = page.getByRole('dialog', { name: 'สำรองไฟล์งาน' });
  await dialog.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await dialog.getByLabel('ยืนยันรหัสผ่าน').fill(password);
  let started = Date.now();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'บันทึกไฟล์สำรอง' }).click();
  const backup = await (await download).path();
  console.log(`backup: ${statSync(backup).size.toLocaleString('en-US')} bytes, ${Date.now() - started} ms`);
  await page.reload();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'สำรอง/กู้ไฟล์' }).click();
  await page.getByRole('menuitem', { name: /กู้ไฟล์/ }).click();
  await (await chooser).setFiles(backup);
  const restore = page.getByRole('dialog', { name: 'กู้ไฟล์จากไฟล์สำรอง' });
  await restore.getByLabel('รหัสผ่านของไฟล์สำรอง').fill(password);
  started = Date.now();
  await restore.getByRole('button', { name: 'เปิดไฟล์' }).click();
  await restore.getByRole('button', { name: 'กู้ไฟล์', exact: true }).click({ timeout: 60_000 });
  await expect(sidebar.locator('.ds-item')).toHaveCount(files.length, { timeout: 30_000 });
  console.log(`restore: ${Date.now() - started} ms`);
  for (const [i, n] of expected.entries()) {
    await expect(sidebar.locator('.ds-item').nth(i)).toContainText(`${n.toLocaleString('en-US')} รายการ`);
  }
  expect(errors).toEqual([]);
});
