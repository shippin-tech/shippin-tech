import { chromium, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
const credentials = JSON.parse(await readFile('../deploy/local/.credentials.json', 'utf8'));
const browser = await chromium.launch();
const page = await browser.newPage();
page.setDefaultTimeout(15000);
const domain = `portal-port-${Date.now()}.test`;
try {
  await page.goto('http://127.0.0.1:28080/login');
  await page.getByRole('textbox').fill(credentials.username);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.locator('input[name="password"]').fill(credentials.secret);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/portal');
  await expect(page.getByRole('heading', { name: 'Enterprise control plan' })).toHaveCount(0);
  await page.goto('http://127.0.0.1:28080/portal/x:Domain');
  await page.getByRole('button', { name: 'Create Domain', exact: true }).click();
  await page.getByRole('textbox', { name: 'Domain Name', exact: true }).fill(domain);
  await page.getByRole('button', { name: 'Add Aliases', exact: true }).click();
  await page.getByRole('textbox', { name: 'Aliases 1', exact: true }).fill(`alias-${domain}`);
  await page.getByRole('checkbox', { name: 'Set Description', exact: true }).check();
  await page.getByRole('combobox', { name: 'DKIM Management', exact: true }).selectOption('Manual');
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Original portal CRUD proof');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved successfully', { timeout: 15000 });
  await page.reload();
  await page.getByRole('button', { name: domain, exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue('Original portal CRUD proof');
  await expect(page.getByRole('textbox', { name: 'Aliases 1', exact: true })).toHaveValue(`alias-${domain}`);
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Updated through the ported record editor');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved successfully');
  await page.reload();
  await page.getByRole('button', { name: domain, exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue('Updated through the ported record editor');
  await mkdir('../target/portal-port-proof', { recursive: true });
  await page.screenshot({ path: '../target/portal-port-proof/domain-editor.png', fullPage: true });
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Deleted successfully');
  await page.reload();
  await expect(page.getByRole('button', { name: domain, exact: true })).toHaveCount(0);
  console.log('Domain create, reload, edit, reload, confirmed delete and reload passed.');

  // A view resolves the underlying singleton and its original subset of fields.
  await page.goto('http://127.0.0.1:28080/portal/x:Email/EmailLimits');
  const limit = page.getByRole('spinbutton', { name: 'Name Length', exact: true });
  const original = await limit.inputValue();
  const changed = String(Number(original) + 1);
  try {
    await limit.fill(changed);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Saved successfully');
    await page.reload();
    await expect(limit).toHaveValue(changed);
  } finally {
    await limit.fill(original);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Saved successfully');
    await page.reload();
    await expect(limit).toHaveValue(original);
  }
  console.log('Singleton settings view saved, persisted, and restored.');

  // Account lists share one object but use distinct filters and variant forms.
  const group = `port-group-${Date.now()}`;
  await page.goto('http://127.0.0.1:28080/portal/x:Account/Group');
  await page.getByRole('button', { name: 'Create Account', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Record type', exact: true })).toHaveValue('Group');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(group);
  await page.getByRole('combobox', { name: 'Domain', exact: true }).selectOption({ label: 'local.test' });
  await page.getByRole('textbox', { name: 'New Quotas key', exact: true }).fill('maxEmails');
  await page.getByRole('textbox', { name: 'New Quotas key', exact: true }).press('Enter');
  await page.getByRole('spinbutton', { name: 'maxEmails', exact: true }).fill('37');
  await page.getByRole('button', { name: 'Add Email Aliases', exact: true }).click();
  const alias = page.getByRole('group', { name: 'Email Aliases 1', exact: true });
  await alias.getByRole('textbox', { name: 'Local Part', exact: true }).fill(`alias-${group}`);
  await alias.getByRole('combobox', { name: 'Domain', exact: true }).selectOption({ label: 'local.test' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved successfully');
  await page.reload();
  await page.getByRole('button', { name: `${group}@local.test`, exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'maxEmails', exact: true })).toHaveValue('37');
  await expect(alias.getByRole('textbox', { name: 'Local Part', exact: true })).toHaveValue(`alias-${group}`);
  await page.screenshot({ path: '../target/portal-port-proof/group-editor.png', fullPage: true });
  await page.goto('http://127.0.0.1:28080/portal/x:Account/User');
  await expect(page.getByRole('button', { name: `${group}@local.test`, exact: true })).toHaveCount(0);
  await page.goto('http://127.0.0.1:28080/portal/x:Account/Group');
  await page.getByRole('button', { name: `${group}@local.test`, exact: true }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Deleted successfully');
  console.log('Account variant, domain references, numeric quota map, list filtering and deletion passed.');

  await page.goto('http://127.0.0.1:28080/portal/x:Action');
  await page.getByRole('button', { name: 'Spam Filter: Classify a message', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('From: admin@local.test\r\nTo: admin@local.test\r\nSubject: Original action form proof\r\n\r\nLocal schema action proof.');
  await page.getByRole('textbox', { name: 'Remote IP', exact: true }).fill('127.0.0.1');
  await page.getByRole('textbox', { name: 'EHLO Domain', exact: true }).fill('local.test');
  await page.getByRole('textbox', { name: 'MAIL FROM', exact: true }).fill('admin@local.test');
  await page.getByRole('button', { name: 'Add RCPT TO', exact: true }).click();
  await page.getByRole('textbox', { name: 'RCPT TO 1', exact: true }).fill('admin@local.test');
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('status').or(page.getByRole('alert'))).toHaveText('Action executed successfully.', { timeout: 30000 });
  await expect(page.getByRole('spinbutton', { name: 'Score', exact: true }).first()).toBeVisible();
  await page.screenshot({ path: '../target/portal-port-proof/action-result.png', fullPage: true });
  console.log('Parameterized spam-classification action returned real result fields.');

  await page.goto('http://127.0.0.1:28080/portal/CustomComponent/LiveDelivery');
  await page.getByRole('textbox', { name: 'Target address or domain', exact: true }).fill('no-mail-port-proof.invalid');
  await page.getByRole('button', { name: 'Start trace', exact: true }).click();
  await expect(page.getByRole('status').or(page.getByRole('alert'))).toContainText('Trace completed.', { timeout: 30000 });
  await expect(page.locator('.runner ol li').first()).toBeVisible();
  await page.screenshot({ path: '../target/portal-port-proof/delivery-trace.png', fullPage: true });
  console.log('Real delivery token and event stream completed for a reserved invalid domain, preserving stage details.');
} catch (error) {
  console.log('Portal page state:', await page.locator('main').innerText().catch(() => 'unavailable'));
  throw error;
} finally { await browser.close(); }
