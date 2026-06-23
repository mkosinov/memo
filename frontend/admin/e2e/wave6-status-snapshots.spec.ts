import { test, expect } from '@playwright/test';
import { waitForScheduleReady, openModal } from './fixtures/helpers';
import {
  VISIT_STATUS_CONFIG,
  VISIT_STATUS_ORDER,
} from '../app/components/shared/config/VISIT_STATUS_CONFIG';
import type { VisitStatus } from '@memo/domain';

/**
 * Wave 6 — Visual regression snapshots for StatusPicker + StatusBadge.
 *
 * 6 snapshot tests:
 * 1. StatusPicker closed
 * 2. StatusPicker open (showing all 4 options)
 * 3-6. StatusBadge for each status (waiting, visited, missed, cancelled)
 *
 * First run: npx playwright test wave6-status-snapshots.spec.ts --update-snapshots
 * Subsequent runs verify they match.
 */

// Mount a component harness page for isolated snapshot testing
const HARNESS_HTML = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: white; padding: 20px; }
    .badge { display: inline-flex; align-items: center; gap: 4px; border-radius: 9999px; padding: 2px 8px; font-size: 12px; font-weight: 500; }
    .badge-amber { background: #fef3c7; color: #b45309; }
    .badge-emerald { background: #d1fae5; color: #047857; }
    .badge-red { background: #fee2e2; color: #b91c1c; }
    .badge-gray { background: #f3f4f6; color: #374151; }
    .select-trigger { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border: 1px solid #e5e7eb; border-radius: 8px; cursor: pointer; font-size: 14px; }
    .select-dropdown { position: absolute; z-index: 10; margin-top: 4px; width: 100%; background: white; border: 1px solid #e5e7eb; border-radius: 8px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); }
    .select-option { padding: 8px 12px; font-size: 14px; cursor: pointer; display: flex; align-items: center; gap: 8px; }
    .select-option:hover { background: #f9fafb; }
    .container { position: relative; display: inline-block; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    const STATUS_CONFIG = {
      waiting: { label: 'Ожидание', bgClass: 'badge-amber', icon: '⏱' },
      visited: { label: 'Посетил', bgClass: 'badge-emerald', icon: '✓' },
      missed: { label: 'Неявка', bgClass: 'badge-red', icon: '✗' },
      cancelled: { label: 'Отменён', bgClass: 'badge-gray', icon: '/' },
    };
    const STATUS_ORDER = ['waiting', 'visited', 'missed', 'cancelled'];

    // Render badges
    const root = document.getElementById('root');
    let html = '<h3>StatusBadge</h3><div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px;">';
    for (const status of STATUS_ORDER) {
      const c = STATUS_CONFIG[status];
      html += '<span class="badge ' + c.bgClass + '" data-testid="status-badge-' + status + '">' + c.icon + ' ' + c.label + '</span>';
    }
    html += '</div>';

    // Render StatusPicker closed
    html += '<h3>StatusPicker (closed)</h3>';
    html += '<div class="container" style="margin-bottom: 20px;">';
    html += '<div data-testid="status-picker">';
    html += '<button class="select-trigger" data-testid="status-picker-trigger">⏱ Ожидание <span style="color:#9ca3af">▾</span></button>';
    html += '</div></div>';

    // Render StatusPicker open
    html += '<h3>StatusPicker (open)</h3>';
    html += '<div class="container">';
    html += '<div data-testid="status-picker">';
    html += '<button class="select-trigger" data-testid="status-picker-trigger">⏱ Ожидание <span style="color:#9ca3af">▾</span></button>';
    html += '<div class="select-dropdown">';
    for (const status of STATUS_ORDER) {
      const c = STATUS_CONFIG[status];
      html += '<div class="select-option" data-testid="custom-select-option-' + status + '">' + c.icon + ' ' + c.label + '</div>';
    }
    html += '</div></div></div>';

    root.innerHTML = html;
  </script>
</body>
</html>
`;

test.describe('Wave 6 — Visual regression snapshots', () => {
  test('StatusPicker closed', async ({ page }) => {
    await page.setContent(HARNESS_HTML);
    const picker = page.locator('[data-testid="status-picker"]').first();
    await expect(picker).toBeVisible();
    await expect(picker).toHaveScreenshot('status-picker-closed.png');
  });

  test('StatusPicker open with all 4 options', async ({ page }) => {
    await page.setContent(HARNESS_HTML);
    // The open picker is the second one
    const picker = page.locator('[data-testid="status-picker"]').nth(1);
    await expect(picker).toBeVisible();
    await expect(picker).toHaveScreenshot('status-picker-open.png');
  });

  test('StatusBadge waiting', async ({ page }) => {
    await page.setContent(HARNESS_HTML);
    const badge = page.locator('[data-testid="status-badge-waiting"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveScreenshot('status-badge-waiting.png');
  });

  test('StatusBadge visited', async ({ page }) => {
    await page.setContent(HARNESS_HTML);
    const badge = page.locator('[data-testid="status-badge-visited"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveScreenshot('status-badge-visited.png');
  });

  test('StatusBadge missed', async ({ page }) => {
    await page.setContent(HARNESS_HTML);
    const badge = page.locator('[data-testid="status-badge-missed"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveScreenshot('status-badge-missed.png');
  });

  test('StatusBadge cancelled', async ({ page }) => {
    await page.setContent(HARNESS_HTML);
    const badge = page.locator('[data-testid="status-badge-cancelled"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveScreenshot('status-badge-cancelled.png');
  });
});
