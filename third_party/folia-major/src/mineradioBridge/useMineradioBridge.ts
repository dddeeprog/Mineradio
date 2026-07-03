import { useEffect, useMemo, useState } from 'react';
import type { Line, LyricData, SongResult } from '../types';
import { normalizeMineradioFoliaFx } from './foliaFx';
import type {
  MineradioBridgeLyricLine,
  MineradioBridgeSnapshot,
  MineradioFoliaFx,
} from './types';

export const MINERADIO_FOLIA_MESSAGE_TYPE = 'mineradio:folia-playback-state';
export const MINERADIO_FOLIA_READY_MESSAGE_TYPE = 'mineradio:folia-ready';

const text = (value: unknown, fallback = '') => String(value ?? fallback).replace(/\s+/g, ' ').trim();

const numberOr = (value: unknown, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const isBridgeSnapshot = (value: unknown): value is MineradioBridgeSnapshot => (
  Boolean(value)
  && typeof value === 'object'
  && (value as MineradioBridgeSnapshot).bridge === 'mineradio-folia'
);

const isMineradioBridgeMode = () => {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('mineradioBridge') === '1') return true;
  try {
    return window.parent !== window;
  } catch (_err) {
    return false;
  }
};

const stableNumericId = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) || 1;
};

const lineEndTime = (line: MineradioBridgeLyricLine, nextLine?: MineradioBridgeLyricLine) => {
  const start = Math.max(0, numberOr(line.time, 0));
  const duration = Math.max(0, numberOr(line.duration, 0));
  if (duration > 0) return start + duration;
  const nextStart = numberOr(nextLine?.time, 0);
  if (nextStart > start) return nextStart;
  return start + 4;
};

const convertLyricLine = (line: MineradioBridgeLyricLine, nextLine?: MineradioBridgeLyricLine): Line | null => {
  const fullText = text(line.text);
  const startTime = Math.max(0, numberOr(line.time, 0));
  const endTime = lineEndTime(line, nextLine);
  if (!fullText && (!Array.isArray(line.words) || line.words.length === 0)) return null;

  const words = Array.isArray(line.words) && line.words.length > 0
    ? line.words
      .map((word) => {
        const wordText = text(word.text);
        if (!wordText) return null;
        const wordStart = Math.max(startTime, numberOr(word.time, startTime));
        const wordEnd = Math.max(wordStart + 0.05, wordStart + Math.max(0, numberOr(word.duration, 0)));
        return {
          text: wordText,
          startTime: wordStart,
          endTime: Math.min(Math.max(wordEnd, wordStart + 0.05), endTime),
        };
      })
      .filter(Boolean) as Line['words']
    : [{
      text: fullText,
      startTime,
      endTime,
    }];

  return {
    id: `mineradio-${line.index}`,
    words,
    startTime,
    endTime,
    fullText: fullText || words.map(word => word.text).join(''),
    translation: text(line.translation) || undefined,
  };
};

export function mineradioBridgeSnapshotToSong(snapshot: MineradioBridgeSnapshot | null): SongResult | null {
  if (!snapshot?.song) return null;
  const song = snapshot.song;
  const title = text(song.title || 'Mineradio');
  const artistNames = Array.isArray(song.artists) && song.artists.length > 0
    ? song.artists.map(name => text(name)).filter(Boolean)
    : text(song.artist).split(/\s*\/\s*|\s*,\s*|、/).filter(Boolean);
  const artists = (artistNames.length > 0 ? artistNames : ['Mineradio']).map((name, index) => ({
    id: index + 1,
    name,
  }));
  const rawId = text(song.id || song.mid || `${song.provider}:${title}:${artistNames.join('/')}`);
  const albumName = text(song.album || 'Mineradio');
  const durationSeconds = Math.max(0, numberOr(snapshot.playback?.duration || song.duration, 0));
  const durationMs = Math.round(durationSeconds * 1000);
  const coverUrl = text(song.coverUrl);
  return {
    id: stableNumericId(rawId),
    name: title,
    artists,
    album: {
      id: stableNumericId(`${rawId}:album`),
      name: albumName,
      picUrl: coverUrl,
    },
    duration: durationMs,
    sourceType: 'cloud',
    al: {
      id: stableNumericId(`${rawId}:al`),
      name: albumName,
      picUrl: coverUrl,
    },
    ar: artists,
    dt: durationMs,
  };
}

export function mineradioBridgeSnapshotToLyrics(snapshot: MineradioBridgeSnapshot | null): LyricData | null {
  if (!snapshot?.lyrics?.lines) return null;
  const lines = snapshot.lyrics.lines
    .map((line, index, all) => convertLyricLine(line, all[index + 1]))
    .filter(Boolean) as Line[];
  if (lines.length === 0) return null;
  return {
    lines,
    title: text(snapshot.song?.title) || undefined,
    artist: text(snapshot.song?.artist) || undefined,
    isWordByWord: snapshot.lyrics.hasNativeKaraoke,
  };
}

export function findMineradioBridgeLineIndex(lyrics: LyricData | null, time: number) {
  if (!lyrics?.lines?.length) return -1;
  const safeTime = Math.max(0, numberOr(time, 0));
  const exact = lyrics.lines.findIndex(line => safeTime >= line.startTime && safeTime < line.endTime);
  if (exact >= 0) return exact;
  for (let index = lyrics.lines.length - 1; index >= 0; index -= 1) {
    if (safeTime >= lyrics.lines[index].startTime) return index;
  }
  return 0;
}

export function mineradioBridgeSnapshotSongKey(snapshot: MineradioBridgeSnapshot | null) {
  if (!snapshot?.song) return '';
  const song = snapshot.song;
  return [
    song.provider,
    song.id,
    song.mid,
    song.title,
    song.artist,
    song.coverUrl,
    Math.round(numberOr(song.duration, 0) * 10),
  ].join('|');
}

export function mineradioBridgeSnapshotLyricsKey(snapshot: MineradioBridgeSnapshot | null) {
  if (!snapshot?.lyrics?.lines) return '';
  const lines = snapshot.lyrics.lines;
  const first = lines[0];
  const last = lines[lines.length - 1];
  return [
    snapshot.lyrics.timingSource,
    snapshot.lyrics.hasNativeKaraoke ? 1 : 0,
    lines.length,
    first ? `${first.time}:${first.text}` : '',
    last ? `${last.time}:${last.text}` : '',
  ].join('|');
}

export function useMineradioBridge() {
  const [bridgeMode] = useState(isMineradioBridgeMode);
  const [snapshot, setSnapshot] = useState<MineradioBridgeSnapshot | null>(null);
  const [foliaFx, setFoliaFx] = useState<MineradioFoliaFx>(() => normalizeMineradioFoliaFx({}));

  useEffect(() => {
    if (!bridgeMode || typeof window === 'undefined') return;

    const sendReady = () => {
      window.parent?.postMessage({
        type: MINERADIO_FOLIA_READY_MESSAGE_TYPE,
        bridge: 'mineradio-folia',
      }, '*');
    };

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!message || typeof message !== 'object') return;
      if (message.type !== MINERADIO_FOLIA_MESSAGE_TYPE) return;
      const payload = message.payload;
      if (!isBridgeSnapshot(payload)) return;
      setSnapshot(payload);
      setFoliaFx(normalizeMineradioFoliaFx(payload.foliaFx || {}));
    };

    window.addEventListener('message', handleMessage);
    sendReady();
    const readyTimer = window.setInterval(sendReady, 1500);

    return () => {
      window.removeEventListener('message', handleMessage);
      window.clearInterval(readyTimer);
    };
  }, [bridgeMode]);

  return useMemo(() => ({
    bridgeMode,
    snapshot,
    foliaFx,
  }), [bridgeMode, snapshot, foliaFx]);
}
