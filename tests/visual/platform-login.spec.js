'use strict';

const path = require('node:path');
const {
  test,
  expect,
} = require('../../third_party/folia-major/node_modules/@playwright/test');

const capabilityFixture = {
  schema: 1,
  providers: [
    {
      provider: 'netease',
      label: 'NetEase Cloud Music',
      authMethods: ['qr', 'cookie', 'external-window'],
      account: { loggedIn: false },
      capabilities: { playback: true },
      availability: { playback: true },
    },
    {
      provider: 'qq',
      label: 'QQ Music',
      authMethods: ['cookie', 'external-window'],
      account: { loggedIn: false },
      capabilities: { playback: true },
      availability: { playback: true },
    },
    {
      provider: 'kugou',
      label: 'Kugou Music',
      authMethods: ['cookie', 'external-window'],
      account: { loggedIn: true, accountId: 'fixture-kugou' },
      capabilities: { playback: false },
      availability: { playback: false },
    },
    {
      provider: 'qishui',
      label: 'Qishui Music',
      authMethods: ['token', 'cookie', 'external-window'],
      account: { loggedIn: false },
      capabilities: { playback: false },
      availability: { playback: false },
    },
    {
      provider: 'spotify',
      label: 'Spotify',
      authMethods: ['pkce', 'external-window'],
      account: { loggedIn: false },
      capabilities: { playback: false },
      availability: { playback: false },
    },
  ],
};

async function openFixture(page, viewport) {
  const pageErrors = [];
  page.on('pageerror', error => {
    pageErrors.push(String(error && error.message || error));
  });
  await page.route('**/api/platform/capabilities*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(capabilityFixture),
  }));
  await page.setViewportSize(viewport);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    window.MineradioPlatformLogin
    && window.MineradioPlatformLoginUI
    && typeof window.showLoginModal === 'function'
  ));
  await page.evaluate(() => {
    document.body.classList.remove('splash-active');
    const style = document.createElement('style');
    style.textContent = [
      '#splash,#empty-home,#search-area,#source-nav,#top-right,#bottom-bar,#bottom-handle,#fx-panel,#fx-fab,#visual-guide,#login-guide-canvas{display:none!important}',
      'body{background:#090b0f!important}',
    ].join('');
    document.head.appendChild(style);
    window.showLoginModal({ provider: 'netease' });
  });
  await expect(page.locator('#login-modal')).toHaveClass(/show/);
  await expect(page.locator('[data-login-provider]')).toHaveCount(5);
  return pageErrors;
}

for (const viewport of [
  { name: 'desktop', width: 1366, height: 768 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`platform login fixture is usable on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    const pageErrors = await openFixture(page, viewport);

    await page.locator('[data-login-provider="qishui"]').click();
    await expect(page.locator('[data-login-method="token"]')).toBeVisible();
    await expect(page.locator('[data-login-method="cookie"]')).toBeVisible();
    await expect(
      page.locator('[data-login-method="external-window"]'),
    ).toBeVisible();

    await page.locator('[data-login-provider="spotify"]').click();
    await page.locator('[data-login-method="pkce"]').click();
    await expect(page.locator('#spotify-client-id-input')).toBeVisible();

    const layout = await page.evaluate(() => {
      const modal = document.querySelector('#login-modal .modal');
      const modalRect = modal.getBoundingClientRect();
      const controls = Array.from(document.querySelectorAll(
        '[data-login-provider],[data-login-method],#spotify-client-id-input',
      ));
      return {
        modalLeft: modalRect.left,
        modalRight: modalRect.right,
        viewportWidth: window.innerWidth,
        horizontalOverflow: controls.some(control => {
          const rect = control.getBoundingClientRect();
          return rect.left < modalRect.left - 1 || rect.right > modalRect.right + 1;
        }),
      };
    });
    expect(layout.modalLeft).toBeGreaterThanOrEqual(0);
    expect(layout.modalRight).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.horizontalOverflow).toBe(false);
    expect(pageErrors).toEqual([]);

    const screenshotPath = testInfo.outputPath(
      `platform-login-${viewport.name}.png`,
    );
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach(`platform-login-${viewport.name}`, {
      path: screenshotPath,
      contentType: 'image/png',
    });
  });
}

test('platform login fixture source stays inside the visual test tree', () => {
  expect(path.basename(__filename)).toBe('platform-login.spec.js');
});
