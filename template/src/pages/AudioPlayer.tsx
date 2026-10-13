import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Asset } from '../types';

/**
 * 音频预览播放器（{@code FR-KNX-023} 前台侧），样式取自 {@code docs/music-player.html}。
 *
 * <p><b>为什么不能像图片那样直接嵌 Knox 的播放代理页</b>：Knox 对音频也只出 HLS
 * （{@code playerMode: "hls"}），清单里的分片挂在 JIT 打包会话上 —— 经本站代理回源时
 * Knox 始终不响应（客户端 15s 超时，稳定复现），连 Knox 自己的 PowerPlayer 都播不动，
 * 而播放代理页里那句裸 {@code <audio src=m3u8>} 除 Safari 外一律解不了 HLS。
 * 这正是「音频格式无法播放」的根因。
 *
 * <p>这里改为直接取**上传时的原件**（{@code /media-original}）：那是浏览器原生可解码的
 * 格式，不依赖 Knox 的转码链，播放器界面也因此可以完全自绘。
 *
 * <p><b>默认不自动播放</b>：加载完元数据后停在就绪态，等用户点播放。
 * 浏览器本就普遍拦截带声自动播放，与其撞一次再回退，不如一开始就交出控制权。
 */
export default function AudioPlayer({ siteId, asset, mediaAssetId, poster }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const seekRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [dragRatio, setDragRatio] = useState(0);
  const [coverFailed, setCoverFailed] = useState(false);

  /* ---------- 音源装载 ---------- */
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audioRef.current = audio;
    let cancelled = false;

    const fail = (message: string) => {
      if (cancelled) return;
      setLoading(false);
      setReady(false);
      setPlaying(false);
      setError(message);
    };

    const renderBuffered = () => {
      const total = Number.isFinite(audio.duration) ? audio.duration : 0;
      if (!total || !audio.buffered || !audio.buffered.length) {
        setBuffered(0);
        return;
      }
      setBuffered(audio.buffered.end(audio.buffered.length - 1) / total);
    };

    const onMeta = () => {
      if (cancelled) return;
      const value = Number.isFinite(audio.duration) ? audio.duration : 0;
      setDuration(value);
      setReady(value > 0);
      setLoading(false);
      setCurrent(audio.currentTime);
      renderBuffered();
    };
    const onTime = () => {
      if (cancelled || draggingRef.current) return;
      setCurrent(audio.currentTime);
      renderBuffered();
    };
    const onPlay = () => !cancelled && setPlaying(true);
    const onPause = () => !cancelled && setPlaying(false);
    const onWaiting = () => !cancelled && setLoading(true);
    const onCanPlay = () => !cancelled && setLoading(false);
    const onEnded = () => {
      if (cancelled) return;
      setPlaying(false);
      setCurrent(0);
    };
    const onSourceError = () => fail('音频加载失败，请稍后重试');

    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('durationchange', onMeta);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('progress', renderBuffered);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('stalled', onWaiting);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('playing', onCanPlay);
    audio.addEventListener('seeked', onCanPlay);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onSourceError);

    // 直接取**上传时的原件**字节：Knox 对音频只出 HLS，其 JIT 分片在本站代理回源时恒定超时
    // （连 Knox 自己的 PowerPlayer 都播不动），而原件是浏览器原生可解码的格式，也不依赖 Knox 的转码链。
    if (!mediaAssetId) {
      fail('该资源没有可播放的媒体原件');
    } else {
      audio.src = mediaOriginalUrl(siteId, mediaAssetId, asset.version);
      audio.load();
    }

    return () => {
      cancelled = true;
      audio.pause();
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('durationchange', onMeta);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('progress', renderBuffered);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('stalled', onWaiting);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('playing', onCanPlay);
      audio.removeEventListener('seeked', onCanPlay);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onSourceError);
      audio.removeAttribute('src');
      try {
        audio.load();
      } catch {
        /* 组件卸载时 audio 已被丢弃，忽略 */
      }
    };
  }, [siteId, mediaAssetId, asset.version]);

  /* ---------- 播放控制 ---------- */
  const seekTo = useCallback((sec: number) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const clamped = Math.min(Math.max(sec, 0), duration);
    try {
      audio.currentTime = clamped;
    } catch {
      /* 部分浏览器在未就绪时禁止赋值 */
    }
    setCurrent(clamped);
  }, [duration]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !ready) return;
    if (audio.paused) {
      setError('');
      void audio.play().catch(() => setError('浏览器阻止了播放，请再点一次'));
    } else {
      audio.pause();
    }
  }, [ready]);

  /* ---------- 进度条拖动 ---------- */
  const ratioFromClientX = (clientX: number) => {
    const el = seekRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (!rect.width) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const onSeekDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!ready || !duration) return;
    event.preventDefault();
    draggingRef.current = true;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* 捕获失败时仍可依靠 move/up 事件 */
    }
    setDragRatio(ratioFromClientX(event.clientX));
  };

  const onSeekMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    setDragRatio(ratioFromClientX(event.clientX));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>, commit: boolean) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* 忽略 */
    }
    if (commit) {
      seekTo(ratioFromClientX(event.clientX) * duration);
    } else {
      setCurrent(audioRef.current?.currentTime ?? 0);
    }
  };

  /* ---------- 键盘 ---------- */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!ready) return;
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      toggle();
      return;
    }
    const target = event.target as HTMLElement | null;
    // 进度条自身已处理方向键（±5s）与 Home/End，避免双触发
    if (target && target.getAttribute('role') === 'slider') return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      seekTo(current - 5);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      seekTo(current + 5);
    }
  };

  const onSeekKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!ready || !duration) return;
    const step = event.shiftKey ? 15 : 5;
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = current - step;
    else if (event.key === 'ArrowRight') next = current + step;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = duration;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    seekTo(next);
  };

  /* ---------- 渲染 ---------- */
  const shownRatio = draggingRef.current ? dragRatio : duration ? current / duration : 0;
  const bufferRatio = Math.min(1, Math.max(buffered, 0));
  const pct = `${Math.min(100, Math.max(0, shownRatio * 100))}%`;
  const classes = ['ap'];
  if (playing) classes.push('is-playing');
  if (!ready) classes.push('is-booting');
  if (loading) classes.push('is-loading');

  return (
    <div
      className={classes.join(' ')}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label={`音频播放器：${asset.title || '未命名音频'}`}
    >
      <div className="ap-stage">
        <div className="ap-halo" aria-hidden="true" />
        <div className="ap-ring" aria-hidden="true" />
        <div className="ap-disc" aria-hidden="true">
          {poster && !coverFailed ? (
            <img className="ap-cover" src={poster} alt="" onError={() => setCoverFailed(true)} />
          ) : (
            <DiscArtwork />
          )}
        </div>
        <div className="ap-controls">
          <button className="ap-play" type="button" disabled={!ready} onClick={toggle} aria-label={playing ? '暂停' : '播放'}>
            <svg className="ic-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5.14v13.72a1 1 0 0 0 1.5.87l11.14-6.86a1 1 0 0 0 0-1.74L9.5 4.27A1 1 0 0 0 8 5.14z" />
            </svg>
            <svg className="ic-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M7 4h3.2v16H7zM13.8 4H17v16h-3.2z" />
            </svg>
            <span className="ap-spinner" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="ap-meta">
        <div className="ap-meta-text">
          <div className="ap-title">{asset.title || '未命名音频'}</div>
          <div className="ap-artist">{audioSubtitle(asset)}</div>
        </div>
        <div className="ap-viz" aria-hidden="true">
          {BAR_ANIM.map((bar, index) => (
            <i
              key={index}
              style={
                {
                  '--ap-dur': `${bar.duration}s`,
                  '--ap-delay': `${bar.delay}s`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      </div>

      <div
        ref={seekRef}
        className={`ap-seek${ready && duration ? '' : ' is-disabled'}`}
        role="slider"
        tabIndex={0}
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(shownRatio * 100)}
        aria-valuetext={`${fmtTime(current)} / ${fmtTime(duration)}`}
        onPointerDown={onSeekDown}
        onPointerMove={onSeekMove}
        onPointerUp={(event) => endDrag(event, true)}
        onPointerCancel={(event) => endDrag(event, false)}
        onKeyDown={onSeekKeyDown}
      >
        <div className="ap-bubble" style={{ left: pct }}>{duration ? fmtTime(shownRatio * duration) : '--:--'}</div>
        <div className="ap-track">
          <div className="ap-buffer" style={{ width: `${bufferRatio * 100}%` }} />
          <div className="ap-fill" style={{ width: pct }} />
          <div className="ap-thumb" style={{ left: pct }} />
        </div>
      </div>

      <div className="ap-times">
        <span className="ap-t-cur">{fmtTime(current)}</span>
        <span className="ap-t-dur">
          {fmtTime(duration)}
          {loading && <span className="ap-dot" aria-hidden="true" />}
        </span>
      </div>

      <div className={`ap-toast${error ? ' show' : ''}`} role="status" aria-live="polite">
        {error}
      </div>
    </div>
  );
}

export interface AudioPlayerProps {
  siteId: string;
  asset: Asset;
  /**
   * **媒体资产 id**（从 storage_uri_s 解析），不是内容项 id —— 播放凭证接口
   * `/media/{mediaAssetId}/play-token` 按 media_asset 主键查，传内容项 id 会 404。
   */
  mediaAssetId: string;
  /** 有封面时作为旋转唱盘的盘面，缺省用星云唱片占位图 */
  poster?: string;
}

/**
 * 原件地址。带版本号可让浏览器按 immutable 长缓存（服务端 {@code fileCacheControl}
 * 同样按 {@code v} 判定），资产换版本时地址即变，不会被旧缓存钉住。
 */
const mediaOriginalUrl = (siteId: string, assetId: string, version?: string) => {
  const base = `/media-original/${encodeURIComponent(siteId)}/${encodeURIComponent(assetId)}`;
  return version ? `${base}?v=${encodeURIComponent(version)}` : base;
};

const BAR_COUNT = 22;

/** 每根律动条一个固定节奏（同一根条每次刷新一致），避免整排同频抽搐。 */
const BAR_ANIM = Array.from({ length: BAR_COUNT }, (_, index) => {
  const seed = Math.sin((index + 1) * 12.9898) * 43758.5453;
  const rand = seed - Math.floor(seed);
  return {
    duration: (0.9 + rand * 1.6).toFixed(2),
    delay: (rand * 1.4).toFixed(2),
    height: (0.45 + (1 - rand) * 0.55).toFixed(3),
  };
});

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '--:--';
  const minutes = Math.floor(sec / 60);
  const seconds = Math.floor(sec % 60);
  return `${String(Math.min(minutes, 99)).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** 曲目名下面那行（原设计是「艺人」）：资源没有艺人概念，用格式 + 体积占位。 */
function audioSubtitle(asset: Asset): string {
  const parts = [asset.mime, formatBytes(asset.bytes)].filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}

function formatBytes(value: number | undefined): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** 无封面时的星云唱片盘面（取自 docs/music-player.html 的静态矢量图形）。 */
function DiscArtwork() {
  return (
    <svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg" role="presentation">
      <defs>
        <radialGradient id="ap-g1" cx="30%" cy="26%" r="80%">
          <stop offset="0%" stopColor="#2b1b6b" />
          <stop offset="45%" stopColor="#16143a" />
          <stop offset="100%" stopColor="#070a16" />
        </radialGradient>
        <linearGradient id="ap-g2" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#7c5cff" stopOpacity=".95" />
          <stop offset="55%" stopColor="#22d3ee" stopOpacity=".75" />
          <stop offset="100%" stopColor="#f472b6" stopOpacity=".85" />
        </linearGradient>
        <linearGradient id="ap-g3" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f9a8d4" stopOpacity=".9" />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity=".2" />
        </linearGradient>
        <filter id="ap-blur1">
          <feGaussianBlur stdDeviation="14" />
        </filter>
      </defs>
      <rect width="400" height="400" fill="url(#ap-g1)" />
      <circle cx="128" cy="112" r="96" fill="url(#ap-g2)" opacity=".55" filter="url(#ap-blur1)" />
      <circle cx="292" cy="286" r="110" fill="url(#ap-g3)" opacity=".38" filter="url(#ap-blur1)" />
      <g fill="none" stroke="url(#ap-g2)" strokeLinecap="round">
        <path d="M60 300 C 110 220, 150 380, 200 300 S 300 220, 344 286" strokeWidth="7" opacity=".85" />
        <path d="M52 262 C 108 176, 152 344, 202 262 S 304 178, 350 248" strokeWidth="4" opacity=".55" />
        <path d="M68 336 C 112 264, 154 404, 204 336 S 302 262, 340 322" strokeWidth="3" opacity=".35" />
      </g>
      <g stroke="rgba(255,255,255,.10)" fill="none">
        <circle cx="200" cy="200" r="188" />
        <circle cx="200" cy="200" r="176" />
        <circle cx="200" cy="200" r="164" />
        <circle cx="200" cy="200" r="152" />
      </g>
      <g fill="#fff" opacity=".5">
        <circle cx="86" cy="72" r="1.7" />
        <circle cx="330" cy="118" r="1.3" />
        <circle cx="252" cy="60" r="1.1" />
        <circle cx="60" cy="196" r="1.4" />
        <circle cx="352" cy="352" r="1.6" />
        <circle cx="140" cy="356" r="1.2" />
      </g>
    </svg>
  );
}
