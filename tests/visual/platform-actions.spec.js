'use strict';

const {
  test,
  expect,
} = require('../../third_party/folia-major/node_modules/@playwright/test');

const capabilityFixture = {
  schema: 1,
  generatedAt: 1,
  providers: [{
    provider: 'netease',
    label: '网易云音乐',
    authMethods: ['qr', 'cookie', 'external-window'],
    account: {
      loggedIn: true,
      accountId: 'fixture-user',
      nickname: '测试账号',
      membership: { vipLevel: 'none', isVip: false, isSvip: false, known: true },
    },
    capabilities: {
      search: true,
      playback: true,
      sourceMatch: true,
      albumDetail: true,
      albumCollect: true,
      playlistSubscribe: true,
      playlistWrite: true,
      commentsRead: true,
      commentsLike: true,
      commentsCreate: true,
      recentPlayReport: false,
      listenDurationReport: false,
    },
    availability: {
      search: true,
      playback: true,
      sourceMatch: true,
      albumDetail: true,
      albumCollect: true,
      playlistSubscribe: true,
      playlistWrite: true,
      commentsRead: true,
      commentsLike: true,
      commentsCreate: true,
      recentPlayReport: false,
      listenDurationReport: false,
    },
  }],
};

const songFixture = {
  provider: 'netease',
  source: 'netease',
  type: 'song',
  id: 61,
  name: '透明城市',
  artist: '测试歌手',
  artistId: 7,
  album: '玻璃唱片',
  albumId: 42,
  cover: '',
  duration: 188000,
};

async function prepare(page, viewport) {
  const pageErrors = [];
  const requests = {
    albumCollect: 0,
    commentCreate: 0,
    commentLike: 0,
  };
  page.on('pageerror', error => {
    pageErrors.push(String(error && error.message || error));
  });
  await page.route('**/api/platform/capabilities*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(capabilityFixture),
  }));
  await page.route('**/api/album/detail*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      provider: 'netease',
      album: {
        id: '42',
        name: '玻璃唱片',
        artist: '测试歌手',
        cover: '',
        collected: false,
      },
      songs: [
        { ...songFixture, id: 61, name: '透明城市' },
        { ...songFixture, id: 62, name: '雨后信号' },
      ],
      dynamic: { commentCount: 2, shareCount: 1, collectCount: 3 },
    }),
  }));
  await page.route('**/api/album/collect', async route => {
    requests.albumCollect += 1;
    const body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, id: body.id, collected: body.collected }),
    });
  });
  await page.route('**/api/song/comments**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/like')) {
      requests.commentLike += 1;
      const body = request.postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, liked: body.liked }),
      });
      return;
    }
    if (request.method() === 'POST') {
      requests.commentCreate += 1;
      const body = request.postDataJSON();
      await new Promise(resolve => setTimeout(resolve, 120));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          created: true,
          comment: {
            id: 'created-1',
            content: body.content,
            likedCount: 0,
            liked: false,
            time: Date.now(),
            user: { id: 'fixture-user', nickname: '测试账号', avatar: '' },
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: '61',
        total: 2,
        comments: [
          {
            id: '71',
            content: '第一条固定评论',
            likedCount: 2,
            liked: false,
            time: 1,
            user: { id: 'u1', nickname: '听众甲', avatar: '' },
          },
          {
            id: '72',
            content: '第二条固定评论',
            likedCount: 0,
            liked: false,
            time: 2,
            user: { id: 'u2', nickname: '听众乙', avatar: '' },
          },
        ],
      }),
    });
  });
  await page.setViewportSize(viewport);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    window.MineradioPlatformActions
    && window.platformLoginCapabilitySnapshot
    && typeof window.openTrackDetailModal === 'function'
  ));
  await page.evaluate(song => {
    document.body.classList.remove('splash-active');
    const style = document.createElement('style');
    style.textContent = [
      '#splash,#empty-home,#search-area,#source-nav,#top-right,#bottom-bar,#bottom-handle,#fx-panel,#fx-fab,#visual-guide{display:none!important}',
      'body{background:#090b0f!important}',
    ].join('');
    document.head.appendChild(style);
    window.openTrackDetailModal('song', song);
  }, songFixture);
  await expect(page.locator('#track-detail-modal')).toHaveClass(/show/);
  await expect(page.locator('#detail-comment-input')).toBeVisible();
  return { pageErrors, requests };
}

for (const viewport of [
  { name: 'desktop', width: 1366, height: 768 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`album and comment actions are usable on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    const fixture = await prepare(page, viewport);

    await page.locator('.detail-comment-like').first().click();
    await expect(page.locator('.detail-comment-like').first()).toHaveClass(/on/);
    expect(fixture.requests.commentLike).toBe(1);

    await page.locator('#detail-comment-input').fill('浏览器夹具评论');
    await page.evaluate(() => {
      window.submitDetailComment();
      window.submitDetailComment();
    });
    await expect(page.getByText('浏览器夹具评论')).toBeVisible();
    expect(fixture.requests.commentCreate).toBe(1);

    await page.getByRole('button', { name: '查看专辑' }).click();
    await expect(page.locator('#album-detail-title')).toHaveText('玻璃唱片');
    await expect(page.locator('#album-song-list .artist-song-item')).toHaveCount(2);
    await page.locator('#album-collection-toggle').click();
    await expect(page.locator('#album-collection-toggle')).toHaveClass(/on/);
    expect(fixture.requests.albumCollect).toBe(1);

    const layout = await page.evaluate(() => {
      const modal = document.querySelector('#track-detail-modal .track-detail-modal');
      const modalRect = modal.getBoundingClientRect();
      const controls = Array.from(modal.querySelectorAll('button,textarea'));
      return {
        modalLeft: modalRect.left,
        modalRight: modalRect.right,
        viewportWidth: window.innerWidth,
        overflow: controls.some(control => {
          const rect = control.getBoundingClientRect();
          return rect.left < modalRect.left - 1 || rect.right > modalRect.right + 1;
        }),
      };
    });
    expect(layout.modalLeft).toBeGreaterThanOrEqual(0);
    expect(layout.modalRight).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.overflow).toBe(false);
    expect(fixture.pageErrors).toEqual([]);

    const screenshotPath = testInfo.outputPath(`platform-actions-${viewport.name}.png`);
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach(`platform-actions-${viewport.name}`, {
      path: screenshotPath,
      contentType: 'image/png',
    });
  });
}
