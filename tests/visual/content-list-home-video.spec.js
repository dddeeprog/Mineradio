'use strict';

const fs = require('node:fs');
const {
  test,
  expect,
} = require('../../third_party/folia-major/node_modules/@playwright/test');

const homeVideoBase64 = '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';

async function prepare(page, viewport) {
  const pageErrors = [];
  page.on('pageerror', error => {
    pageErrors.push(String(error && error.message || error));
  });
  await page.setViewportSize(viewport);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    window.MineradioContentListController
    && typeof window.renderSongSearchResults === 'function'
    && typeof window.renderUserPlaylistsList === 'function'
    && typeof window.updateHomeVisualPower === 'function'
  ));
  await page.evaluate(() => {
    document.body.classList.remove('splash-active');
    const splash = document.getElementById('splash');
    if (splash) splash.style.display = 'none';
  });
  return pageErrors;
}

test('search, playlist, album, comment, and recommendation surfaces keep bounded DOM', async ({ page }, testInfo) => {
  const pageErrors = await prepare(page, { width: 1366, height: 768 });
  const first = await page.evaluate(() => {
    const fixtureStyle = document.createElement('style');
    fixtureStyle.textContent = [
      '#search-area{display:block!important;opacity:1!important;transform:none!important;pointer-events:auto!important;left:24px!important;top:72px!important;width:540px!important}',
      '#search-stack{opacity:1!important;transform:none!important}',
      '#playlist-panel{display:block!important;opacity:1!important;transform:none!important;pointer-events:auto!important;left:auto!important;right:24px!important;top:72px!important;width:390px!important;height:620px!important}',
      '#top-right,#source-nav,#bottom-bar,#bottom-handle,#empty-home,#fx-panel,#fx-fab{display:none!important}',
    ].join('');
    document.head.appendChild(fixtureStyle);
    const songs = Array.from({ length: 500 }, (_, index) => ({
      provider: 'spotify',
      source: 'spotify',
      id: 'search-' + index,
      sourceId: 'search-' + index,
      name: '搜索歌曲 ' + index,
      artist: '测试歌手',
      playable: false,
      _platformAccess: { capabilities: {}, availability: {} },
    }));
    const results = document.getElementById('search-results');
    results.style.cssText = 'display:block;position:fixed;left:24px;top:110px;width:520px;height:360px;max-height:360px;z-index:1000';
    renderSongSearchResults(songs, { preserveLimit: true });

    userPlaylists = Array.from({ length: 500 }, (_, index) => ({
      provider: index < 250 ? 'netease' : 'qq',
      id: 'playlist-' + index,
      name: '长歌单 ' + index,
      creator: '测试用户',
      trackCount: index + 1,
      cover: '',
    }));
    queueViewTab = 'playlists';
    const panel = document.getElementById('playlist-panel');
    panel.style.cssText = 'display:block;position:fixed;right:24px;top:80px;width:380px;height:600px;overflow-y:auto;z-index:1000';
    renderUserPlaylistsList();
    bindPlaylistPanelLazyRender();
    document.getElementById('queue-pane').style.display = 'none';
    document.getElementById('pl-pane').style.display = '';
    document.getElementById('tab-queue').classList.remove('active');
    document.getElementById('tab-pl').classList.add('active');

    const body = document.getElementById('track-detail-body');
    body.innerHTML = '<div id="album-song-list"></div><div id="song-comments"></div>';
    const albumSongs = Array.from({ length: 500 }, (_, index) => ({
      provider: 'netease',
      source: 'netease',
      id: 'album-' + index,
      name: '专辑曲目 ' + index,
      artist: '测试歌手',
      playable: true,
    }));
    document.getElementById('album-song-list').innerHTML = renderAlbumSongList(albumSongs);
    detailCommentSong = { provider: 'netease', source: 'netease', id: 'song-1' };
    detailRenderedComments = Array.from({ length: 500 }, (_, index) => ({
      id: String(index + 1),
      content: '评论内容 ' + index,
      likedCount: index,
      user: { nickname: '听众 ' + index, avatar: '' },
    }));
    renderDetailCommentSection();
    bindTrackDetailScrollers();

    const recommendation = boundedContentWindow('recommendation', Array.from({ length: 500 }, (_, index) => ({
      key: 'recommendation-' + index,
    })), {
      instanceKey: 'recommendation-fixture',
      scrollOffset: 176 * 220,
      viewportSize: 176 * 5,
    });

    return {
      album: document.querySelectorAll('#album-song-list .artist-song-item').length,
      comments: document.querySelectorAll('#song-comments .comment-item').length,
      playlist: document.querySelectorAll('#pl-list .pl-card').length,
      recommendation: recommendation.count,
      search: document.querySelectorAll('#search-results .search-result').length,
      searchFirst: document.querySelector('#search-results .search-result')?.getAttribute('data-content-key') || '',
    };
  });

  expect(first.search).toBeLessThanOrEqual(18);
  expect(first.playlist).toBeLessThanOrEqual(18);
  expect(first.album).toBeLessThanOrEqual(18);
  expect(first.comments).toBeLessThanOrEqual(16);
  expect(first.recommendation).toBeLessThanOrEqual(12);

  await page.evaluate(() => {
    const search = document.getElementById('search-results');
    search.scrollTop = 61 * 300;
    search.dispatchEvent(new Event('scroll'));
    const playlist = document.getElementById('playlist-panel');
    playlist.scrollTop = 66 * 300;
    playlist.dispatchEvent(new Event('scroll'));
    const album = document.querySelector('[data-bounded-list="album-songs"]');
    album.scrollTop = 62 * 300;
    album.dispatchEvent(new Event('scroll'));
    const comments = document.querySelector('[data-bounded-list="detail-comments"]');
    comments.scrollTop = 86 * 300;
    comments.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(160);

  const after = await page.evaluate(() => ({
    album: document.querySelectorAll('#album-song-list .artist-song-item').length,
    comments: document.querySelectorAll('#song-comments .comment-item').length,
    playlist: document.querySelectorAll('#pl-list .pl-card').length,
    search: document.querySelectorAll('#search-results .search-result').length,
    searchFirst: document.querySelector('#search-results .search-result')?.getAttribute('data-content-key') || '',
    snapshots: Object.fromEntries(Object.entries(boundedContentControllers).map(([key, controller]) => [key, controller.snapshot()])),
  }));

  expect(after.search).toBeLessThanOrEqual(18);
  expect(after.playlist).toBeLessThanOrEqual(18);
  expect(after.album).toBeLessThanOrEqual(18);
  expect(after.comments).toBeLessThanOrEqual(16);
  expect(after.searchFirst).not.toBe(first.searchFirst);
  for (const snapshot of Object.values(after.snapshots)) {
    expect(snapshot.mountedCount).toBeLessThanOrEqual(18);
  }
  expect(pageErrors).toEqual([]);

  const screenshotPath = testInfo.outputPath('bounded-content-lists.png');
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach('bounded-content-lists', {
    path: screenshotPath,
    contentType: 'image/png',
  });
});

test('home video persists, releases in background, and restores with a fresh object URL', async ({ page }, testInfo) => {
  const pageErrors = await prepare(page, { width: 1366, height: 768 });
  const videoPath = testInfo.outputPath('home-visual.mp4');
  fs.writeFileSync(videoPath, Buffer.from(homeVideoBase64, 'base64'));

  await page.evaluate(() => {
    emptyHomeActive = true;
    document.body.classList.add('empty-home-active');
  });
  await page.locator('#home-visual-input').setInputFiles({
    name: 'home-visual.mp4',
    mimeType: 'video/mp4',
    buffer: fs.readFileSync(videoPath),
  });
  await expect(page.locator('.home-stage-hero')).toHaveClass(/has-home-visual-video/);
  await expect.poll(() => page.evaluate(() => {
    const video = document.getElementById('home-visual-video');
    return video.readyState;
  })).toBeGreaterThanOrEqual(2);

  const attached = await page.evaluate(async () => {
    const record = await getCustomBackgroundRecord('home-visual-v1');
    return {
      objectUrl: document.getElementById('home-visual-video').src,
      recordName: record && record.meta && record.meta.name,
      snapshot: homeVisualRuntime.snapshot(),
    };
  });
  expect(attached.recordName).toBe('home-visual.mp4');
  expect(attached.objectUrl).toMatch(/^blob:/);
  expect(attached.snapshot.attached).toBe(true);

  const released = await page.evaluate(async () => {
    emptyHomeActive = false;
    document.body.classList.remove('empty-home-active');
    await updateHomeVisualPower();
    return {
      src: document.getElementById('home-visual-video').getAttribute('src') || '',
      snapshot: homeVisualRuntime.snapshot(),
    };
  });
  expect(released.src).toBe('');
  expect(released.snapshot.released).toBe(true);
  expect(released.snapshot.attached).toBe(false);

  const resumed = await page.evaluate(async () => {
    emptyHomeActive = true;
    document.body.classList.add('empty-home-active');
    await updateHomeVisualPower();
    return {
      objectUrl: document.getElementById('home-visual-video').src,
      snapshot: homeVisualRuntime.snapshot(),
    };
  });
  expect(resumed.objectUrl).toMatch(/^blob:/);
  expect(resumed.objectUrl).not.toBe(attached.objectUrl);
  expect(resumed.snapshot.attached).toBe(true);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.updateHomeVisualPower === 'function');
  await page.evaluate(async () => {
    document.body.classList.remove('splash-active');
    const splash = document.getElementById('splash');
    if (splash) splash.style.display = 'none';
    emptyHomeActive = true;
    document.body.classList.add('empty-home-active');
    await updateHomeVisualPower();
  });
  await expect(page.locator('.home-stage-hero')).toHaveClass(/has-home-visual-video/);
  expect(pageErrors).toEqual([]);

  const screenshotPath = testInfo.outputPath('home-video-restored.png');
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach('home-video-restored', {
    path: screenshotPath,
    contentType: 'image/png',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.home-stage-hero')).toBeVisible();
  const mobileLayout = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    hero: document.querySelector('.home-stage-hero').getBoundingClientRect().toJSON(),
  }));
  expect(mobileLayout.documentWidth).toBeLessThanOrEqual(mobileLayout.viewportWidth + 1);
  expect(mobileLayout.hero.left).toBeGreaterThanOrEqual(0);
  expect(mobileLayout.hero.right).toBeLessThanOrEqual(391);
  const mobileScreenshotPath = testInfo.outputPath('home-video-restored-mobile.png');
  await page.screenshot({ path: mobileScreenshotPath });
  await testInfo.attach('home-video-restored-mobile', {
    path: mobileScreenshotPath,
    contentType: 'image/png',
  });
  await page.evaluate(() => clearHomeVisual());
});
