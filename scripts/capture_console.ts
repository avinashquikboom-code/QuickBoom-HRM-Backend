import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  const consoleLogs: string[] = [];

  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') {
      consoleErrors.push(`[ERROR] ${text}`);
    } else {
      consoleLogs.push(`[${msg.type().toUpperCase()}] ${text}`);
    }
  });

  page.on('pageerror', err => {
    consoleErrors.push(`[PAGE_ERROR] ${err.message}\nStack: ${err.stack}`);
  });

  try {
    console.log('Opening Login Page...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

    // Wait for the login portal to render
    console.log('Logging in...');
    await page.fill('input[name="hrm-login-email"]', 'admin@hr.com');
    await page.fill('input[name="hrm-login-password"]', '123456');
    await page.click('button[type="submit"]');

    // Wait for redirection
    console.log('Waiting for login redirect to dashboard...');
    await page.waitForURL('**/hr-management', { timeout: 10000 });
    console.log('Login successful! Navigating to /leave...');

    await page.goto('http://localhost:3000/leave', { waitUntil: 'networkidle' });
    console.log('On Leave page. Clicking Request Logs tab...');

    // Wait for the requests tab button and click it
    // From DOM: text content is "REQUEST LOGS"
    await page.click('text="REQUEST LOGS"');
    console.log('Clicked Request Logs. Waiting 3 seconds for content to load...');
    await page.waitForTimeout(3000);

    // Get table HTML or text
    const tableHTML = await page.evaluate(() => {
      const table = document.querySelector('table');
      return table ? table.outerHTML : 'Table not found';
    });

    console.log('Table HTML structure:');
    console.log(tableHTML);

    const bodyText = await page.evaluate(() => document.body.innerText);
    fs.writeFileSync('browser_text.txt', bodyText);
    console.log('Body text saved to browser_text.txt');

  } catch (err: any) {
    console.error('Headless navigation failed:', err.message);
  } finally {
    await browser.close();
    
    console.log('\n--- Console Logs ---');
    consoleLogs.forEach(log => console.log(log));

    console.log('\n--- Console Errors ---');
    consoleErrors.forEach(err => console.error(err));

    fs.writeFileSync('console_errors.json', JSON.stringify({ logs: consoleLogs, errors: consoleErrors }, null, 2));
    console.log('Logs and errors written to console_errors.json');
  }
}

run();
