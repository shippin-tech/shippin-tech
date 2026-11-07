import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
const credentials = JSON.parse(await readFile('../deploy/local/.credentials.json', 'utf8'));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:28080/login');
  await page.locator('input[name="username"]').fill(credentials.username);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.locator('input[name="password"]').waitFor({ timeout: 15000 });
  await page.locator('input[name="password"]').fill(credentials.secret);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/portal', { timeout: 20000 });
  await page.goto('http://127.0.0.1:28080/mail');
  await page.getByRole('link', { name: /Docker delivery check/ }).first().waitFor({ timeout: 15000 });
  await page.getByRole('link', { name: /Docker delivery check/ }).first().click();
  await page.locator('.body').filter({ hasText: 'SMTP to persistent storage to JMAP' }).waitFor();
  await mkdir('../target/local-mail-proof', { recursive: true });
  await page.screenshot({ path: '../target/local-mail-proof/reader.png', fullPage: true });
  console.log('Browser sign-in, mailbox and message reader passed against Docker.');
} finally { await browser.close(); }
