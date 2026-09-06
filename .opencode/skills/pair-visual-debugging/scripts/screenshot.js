/**
 * Pair Visual Debugging — Screenshot + DOM dump script.
 *
 * Usage:
 *   node screenshot.js [port]
 *
 * Default port: 3001 (admin)
 * Port 3000: web (public site)
 *
 * Connects to partner's running dev.sh, takes screenshot,
 * dumps key DOM elements to stdout.
 */

const { chromium } = require('/root/workspace/memo/node_modules/playwright');

const PORT = process.argv[2] || '3001';
const URL = `http://localhost:${PORT}/`;
const SCREENSHOT_PATH = '/tmp/pair-debug-screenshot.png';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  page.on('pageerror', err => console.log('PAGE_ERROR:', err.message));

  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000); // allow client-side rendering

    // Dump first 3 activity cards if on admin page
    const activityCards = await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-testid^="activity-"]');
      if (cards.length === 0) return null;
      return Array.from(cards).slice(0, 3).map(c => c.outerHTML.substring(0, 1000));
    });

    if (activityCards) {
      console.log('=== ACTIVITY CARDS (first 3) ===');
      activityCards.forEach((html, i) => {
        console.log(`--- Card ${i + 1} ---`);
        console.log(html);
      });
      console.log('=== END ===');
    } else {
      // Generic page dump
      const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 1000));
      console.log('=== PAGE TEXT (no activity cards found) ===');
      console.log(bodyText);
      console.log('=== END ===');
    }

    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
    console.log(`\nScreenshot saved to ${SCREENSHOT_PATH}`);

  } catch (err) {
    console.error(`ERROR: Could not connect to ${URL}`);
    console.error(`Make sure dev.sh is running on port ${PORT}`);
    console.error(err.message);
    process.exit(1);
  }

  await browser.close();
})();
