import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Asset } from '../types';
import {
  frameOf,
  knoxPlayerUrl,
  loadKnoxPlayUrl,
  mediaAssetId,
  pdfFrame,
  previewKind,
  previewTarget,
  type Orientation,
  type PreviewKind
} from '../preview';

type Playback = 'loading' | 'playing' | 'muted' | 'blocked' | 'ready' | 'paused' | 'ended';

export function PreviewPane(props: {
  asset: Asset;
  siteId: string;
  orientation: Orientation;
  imageAssetIds?: string[];
  onMeasure: (width: number, height: number) => void;
  extra?: ReactNode;
}) {
  const kind = previewKind(props.asset.kind);
  const [src, setSrc] = useState(() => initialSrc(props.asset));
  const [loadError, setLoadError] = useState('');
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);
  const onMeasureRef = useRef(props.onMeasure);
  onMeasureRef.current = props.onMeasure;
  const known = frameOf(props.asset);
  const frame = box ?? ((props.asset.width ?? 0) > 0 && (props.asset.height ?? 0) > 0 ? known : null);
  const [playback, setPlayback] = useState<Playback>(src ? 'loading' : 'ready');

  useEffect(() => {
    setBox(null);
    setPlayback(src ? 'loading' : 'ready');
  }, [props.asset.id, src]);

  useEffect(() => {
    const target = previewTarget(props.asset);
    const assetId = target.assetId
      || (kind === 'image' ? (props.imageAssetIds?.[0] || mediaAssetId(props.asset.thumbnail)) : '');
    if (target.url) {
      setLoadError('');
      setSrc(target.url);
      return;
    }
    if (!assetId || !props.siteId) {
      setLoadError('');
      setSrc('');
      return;
    }
    let cancelled = false;
    setSrc('');
    setLoadError('');
    setPlayback('loading');
    loadKnoxPlayUrl(props.siteId, assetId)
      .then((data) => {
        if (cancelled) return;
        // 视频改嵌 Knox-Media 播放代理页（/media-play）：播放器与播放链接都来自 Knox-Media，
        // 与后端媒体库预览一致，HLS 也由 PowerPlayer 解码；其余类型仍用短时可播地址取字节。
        setSrc(kind === 'video' ? knoxPlayerUrl(props.siteId, assetId) : data.playUrl);
        if (data.width > 0 && data.height > 0) {
          setBox({ w: data.width, h: data.height });
          onMeasureRef.current(data.width, data.height);
        }
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setSrc('');
        setLoadError(reason instanceof Error ? reason.message : '原件暂时无法播放');
        setPlayback('ready');
      });
    return () => {
      cancelled = true;
    };
  }, [props.asset.id, props.asset.storageUri, props.asset.thumbnail, props.siteId, props.imageAssetIds, kind]);

  useEffect(() => {
    if (kind !== 'document' || !src) return;
    let cancelled = false;
    fetch(src)
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .then((buffer) => {
        if (cancelled || !buffer) return;
        const page = pdfFrame(new Uint8Array(buffer));
        if (!page) return;
        setBox(page);
        onMeasureRef.current(page.w, page.h);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [kind, src]);

  useEffect(() => {
    if (kind !== 'video' && kind !== 'audio') return;
    const media = mediaRef.current;
    if (!media || !src) return;
    let cancelled = false;
    const start = async () => {
      if (cancelled) return;
      media.muted = false;
      try {
        await media.play();
      } catch {
        if (cancelled) return;
        if (kind === 'video') {
          media.muted = true;
          try {
            await media.play();
            return;
          } catch {
            /* 浏览器拒绝自动播放 */
          }
        }
        if (!cancelled) setPlayback('blocked');
      }
    };
    const kick = () => { void start(); };
    if (media.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) kick();
    else media.addEventListener('canplay', kick, { once: true });
    return () => {
      cancelled = true;
      media.removeEventListener('canplay', kick);
      media.pause();
    };
  }, [props.asset.id, src, kind]);

  const stageClass = [
    'preview-stage',
    kind === 'audio' ? 'stage-audio' : props.orientation === 'portrait' ? 'stage-port' : 'stage-land',
    kind === 'document' || kind === 'text' ? 'stage-doc' : ''
  ].filter(Boolean).join(' ');

  return (
    <div className="card">
      <div className={stageClass}>
        {playback === 'loading' ? <span className="preview-loading">正在加载预览</span> : null}
        <PreviewBody
          kind={kind}
          src={src}
          embed={kind === 'video' && src.startsWith('/media-play/')}
          loadError={loadError}
          asset={props.asset}
          playing={playback === 'playing' || playback === 'muted'}
          mediaRef={mediaRef}
          onReady={() => setPlayback((current) => (current === 'loading' ? 'ready' : current))}
          onPlay={(muted) => setPlayback(muted ? 'muted' : 'playing')}
          onPause={() => setPlayback((current) => (current === 'playing' || current === 'muted' ? 'paused' : current))}
          onEnded={() => setPlayback('ended')}
          onMeasure={(width, height) => {
            if (width > 0 && height > 0) setBox({ w: width, h: height });
            props.onMeasure(width, height);
          }}
        />
      </div>
      <div className="preview-bar">
        <span className="preview-facts">
          {kind !== 'audio' && kind !== 'text' && frame ? <span>{frame.w} × {frame.h}</span> : null}
          <span>{kind === 'video' ? '播放' : '浏览'} {factCount(props.asset.viewCount)}</span>
          <span>发布于 {publishDay(props.asset.publishedAt || props.asset.updatedAt)}</span>
        </span>
        <span className="grow" />
        {props.extra}
      </div>
    </div>
  );
}

function PreviewBody(props: {
  kind: PreviewKind;
  src: string;
  embed?: boolean;
  loadError?: string;
  asset: Asset;
  playing: boolean;
  mediaRef: RefObject<HTMLVideoElement | HTMLAudioElement | null>;
  onReady: () => void;
  onPlay: (muted: boolean) => void;
  onPause: () => void;
  onEnded: () => void;
  onMeasure: (width: number, height: number) => void;
}) {
  if (!props.src && props.kind !== 'text') {
    const hasRef = Boolean(mediaAssetId(props.asset.storageUri) || props.asset.storageUri.trim());
    const message = props.loadError
      || (hasRef ? '原件暂时无法播放，请稍后刷新重试' : (props.asset.summary || '这条资源还没有可播放的原件'));
    return <div className="preview-paper"><p>{message}</p></div>;
  }
  if (props.kind === 'image') {
    return (
      <img
        className="fit"
        src={props.src}
        alt={props.asset.title}
        onLoad={(event) => {
          props.onMeasure(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
          props.onReady();
        }}
      />
    );
  }
  if (props.kind === 'video') {
    // 内嵌 Knox-Media 播放代理页：播放器（PowerPlayer）与可播地址都由 Knox-Media 侧提供，
    // 与后端媒体库预览同源同款，HLS 由 PowerPlayer 解码，不再由 <video> 直接取流。
    if (props.embed) {
      return (
        <iframe
          key={props.asset.id}
          className="fit"
          title={props.asset.title}
          src={props.src}
          allow="autoplay; fullscreen"
          allowFullScreen
          onLoad={props.onReady}
        />
      );
    }
    return (
      <video
        key={props.asset.id}
        ref={props.mediaRef as RefObject<HTMLVideoElement>}
        className="fit"
        src={props.src}
        controls
        playsInline
        preload="auto"
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          props.onMeasure(video.videoWidth, video.videoHeight);
          props.onReady();
        }}
        onPlay={(event) => props.onPlay(event.currentTarget.muted)}
        onPause={props.onPause}
        onEnded={props.onEnded}
      />
    );
  }
  if (props.kind === 'audio') {
    return (
      <>
        <div className={`wave-row ${props.playing ? 'is-on' : ''}`} aria-hidden="true">
          {Array.from({ length: 48 }, (_, index) => (
            <i key={index} style={{ height: `${28 + ((index * 37) % 70)}%`, animationDelay: `${(index % 8) * 0.08}s` }} />
          ))}
        </div>
        <audio
          key={props.asset.id}
          ref={props.mediaRef as RefObject<HTMLAudioElement>}
          src={props.src}
          controls
          preload="auto"
          style={{ position: 'absolute', left: 16, right: 16, bottom: 12, width: 'calc(100% - 32px)' }}
          onLoadedData={props.onReady}
          onPlay={(event) => props.onPlay(event.currentTarget.muted)}
          onPause={props.onPause}
          onEnded={props.onEnded}
        />
      </>
    );
  }
  if (props.kind === 'document') {
    return (
      <iframe
        className="fit"
        title={props.asset.title}
        src={props.src}
        onLoad={props.onReady}
      />
    );
  }
  return (
    <div className="preview-paper">
      <strong>{props.asset.title}</strong>
      <p style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{props.asset.body || props.asset.summary}</p>
    </div>
  );
}

function initialSrc(asset: Asset): string {
  return previewTarget(asset).url;
}

function factCount(value: number | undefined): string {
  const count = Number.isFinite(value) ? Math.max(0, Math.floor(value as number)) : 0;
  if (count >= 10000) {
    const wan = count / 10000;
    return `${wan.toFixed(wan >= 10 ? 0 : 1)}万`;
  }
  return String(count);
}

function publishDay(iso: string | undefined): string {
  if (!iso) return '—';
  const text = iso.trim();
  if (text.length >= 16) return text.slice(0, 16).replace('T', ' ');
  if (text.length >= 10) return text.slice(0, 10);
  return text;
}
