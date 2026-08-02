'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  NeteaseLibraryError,
  createNeteaseLibraryAdapter,
} = require('../server/platform/providers/netease-library');

function createAdapter(overrides = {}) {
  const calls = [];
  const api = {
    album(input) {
      calls.push(['album', input]);
      return Promise.resolve({
        body: {
          code: 200,
          album: {
            id: 42,
            name: '透明',
            picUrl: 'https://img.example/album.jpg',
            description: 'album description',
            publishTime: 123456,
            company: 'Mineradio Records',
            size: 2,
            artist: { id: 7, name: '歌手' },
          },
          songs: [
            {
              id: 1,
              name: '第一首',
              ar: [{ id: 7, name: '歌手' }],
              al: { id: 42, name: '透明', picUrl: 'https://img.example/album.jpg' },
              dt: 180000,
            },
          ],
          privateCredential: 'must-not-leak',
        },
      });
    },
    albumDetailDynamic(input) {
      calls.push(['albumDetailDynamic', input]);
      return Promise.resolve({
        body: {
          code: 200,
          isSub: true,
          commentCount: 12,
          shareCount: 3,
          subCount: 9,
          privateCredential: 'must-not-leak',
        },
      });
    },
    albumSub(input) {
      calls.push(['albumSub', input]);
      return Promise.resolve({ body: { code: 200, cookie: 'must-not-leak' } });
    },
    playlistSubscribe(input) {
      calls.push(['playlistSubscribe', input]);
      return Promise.resolve({ body: { code: 200 } });
    },
    commentLike(input) {
      calls.push(['commentLike', input]);
      return Promise.resolve({ body: { code: 200 } });
    },
    commentCreate(input) {
      calls.push(['commentCreate', input]);
      return Promise.resolve({
        body: {
          code: 200,
          comment: {
            commentId: 88,
            content: input.content,
            likedCount: 0,
            time: 222,
            user: {
              userId: 9,
              nickname: '我',
              avatarUrl: 'https://img.example/avatar.jpg',
            },
          },
          cookie: 'must-not-leak',
        },
      });
    },
    mapSongRecord(song) {
      return {
        provider: 'netease',
        id: song.id,
        name: song.name,
        albumId: song.al && song.al.id,
      };
    },
    now() {
      return 1000;
    },
    ...overrides,
  };
  return {
    adapter: createNeteaseLibraryAdapter(api),
    calls,
  };
}

test('netease album detail is public, normalized, bounded, and value-safe', async () => {
  const { adapter, calls } = createAdapter();
  const result = await adapter.getAlbumDetail({
    id: '42',
    limit: 999,
    cookie: 'MUSIC_U=secret',
  });

  assert.deepEqual(result, {
    provider: 'netease',
    album: {
      id: '42',
      name: '透明',
      cover: 'https://img.example/album.jpg',
      artist: '歌手',
      artistId: '7',
      description: 'album description',
      publishTime: 123456,
      company: 'Mineradio Records',
      size: 2,
      collected: true,
    },
    songs: [{
      provider: 'netease',
      id: 1,
      name: '第一首',
      albumId: 42,
    }],
    dynamic: {
      commentCount: 12,
      shareCount: 3,
      collectCount: 9,
    },
  });
  assert.equal(calls[0][1].id, '42');
  assert.equal(calls[0][1].cookie, 'MUSIC_U=secret');
  assert.equal(JSON.stringify(result).includes('privateCredential'), false);
  assert.equal(JSON.stringify(result).includes('MUSIC_U'), false);
});

test('netease writes map booleans to upstream operations without returning bodies', async () => {
  const { adapter, calls } = createAdapter();

  assert.deepEqual(
    await adapter.setAlbumCollected({ id: '42', collected: false, cookie: 'c' }),
    {
      provider: 'netease',
      resource: 'album',
      id: '42',
      collected: false,
      success: true,
      code: 200,
    },
  );
  assert.deepEqual(
    await adapter.setPlaylistSubscribed({ id: '51', subscribed: true, cookie: 'c' }),
    {
      provider: 'netease',
      resource: 'playlist',
      id: '51',
      subscribed: true,
      success: true,
      code: 200,
    },
  );
  assert.deepEqual(
    await adapter.setCommentLiked({
      id: '61',
      commentId: '71',
      liked: false,
      cookie: 'c',
    }),
    {
      provider: 'netease',
      resource: 'comment',
      id: '61',
      commentId: '71',
      liked: false,
      success: true,
      code: 200,
    },
  );

  assert.equal(calls.find(call => call[0] === 'albumSub')[1].t, 0);
  assert.equal(calls.find(call => call[0] === 'playlistSubscribe')[1].t, 1);
  assert.equal(calls.find(call => call[0] === 'commentLike')[1].t, 0);
});

test('netease comment creation bounds content and returns only a normalized comment', async () => {
  const { adapter, calls } = createAdapter();
  const result = await adapter.createComment({
    id: '61',
    content: '  新评论  ',
    cookie: 'c',
  });

  assert.deepEqual(result, {
    provider: 'netease',
    resource: 'comment',
    id: '61',
    created: true,
    success: true,
    code: 200,
    comment: {
      id: '88',
      content: '新评论',
      likedCount: 0,
      liked: false,
      time: 222,
      user: {
        id: '9',
        nickname: '我',
        avatar: 'https://img.example/avatar.jpg',
      },
    },
  });
  assert.equal(calls.find(call => call[0] === 'commentCreate')[1].t, 1);
  assert.equal(calls.find(call => call[0] === 'commentCreate')[1].type, 0);
  assert.equal(JSON.stringify(result).includes('cookie'), false);

  await assert.rejects(
    adapter.createComment({ id: '61', content: ' '.repeat(12) }),
    error => (
      error instanceof NeteaseLibraryError
      && error.code === 'NETEASE_COMMENT_CONTENT_INVALID'
      && error.status === 400
    ),
  );
  await assert.rejects(
    adapter.createComment({ id: '61', content: 'x'.repeat(501) }),
    error => (
      error.code === 'NETEASE_COMMENT_CONTENT_INVALID'
      && error.status === 400
    ),
  );
});

test('netease adapter converts invalid inputs and upstream failures to typed errors', async () => {
  const { adapter } = createAdapter({
    albumSub() {
      return Promise.resolve({
        body: {
          code: 401,
          message: 'cookie=MUSIC_U=secret',
        },
      });
    },
  });

  await assert.rejects(
    adapter.getAlbumDetail({ id: '../etc/passwd' }),
    error => (
      error.code === 'NETEASE_LIBRARY_INVALID_ID'
      && error.status === 400
    ),
  );
  await assert.rejects(
    adapter.setAlbumCollected({ id: '42', collected: true, cookie: 'secret' }),
    error => (
      error.code === 'NETEASE_ALBUM_COLLECT_FAILED'
      && error.status === 401
      && !error.message.includes('secret')
    ),
  );
});
