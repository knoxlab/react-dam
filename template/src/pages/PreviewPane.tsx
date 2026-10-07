import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Asset } from '../types';
import {
  addressLabel,
  frameOf,
  layoutLabel,
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
      setSrc(target.url);
      return;
    }
    if (!assetId || !props.siteId) {
      setSrc('');
      return;
    }
    let cancelled = false;
    setSrc('');
    loadKnoxPlayUrl(props.siteId, assetId)
      .then((data) => {
        if (cancelled) return;
        setSrc(data.playUrl);
        if (data.width > 0 && data.height > 0) {
          setBox({ w: data.width, h: data.height });
          onMeasureRef.current(data.width, data.height);
        }
      })
      .catch(() => undefined);
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
        <span className="badge badge-primary">{layoutLabel(kind, props.orientation)}</span>
        {kind === 'audio' || kind === 'text' || !frame ? null : (
          <span className="num" style={{ fontSize: 13, fontWeight: 500 }}>
            {frame.w} × {frame.h}
          </span>
        )}
        <span className="num" style={{ fontSize: 12, fontWeight: 500 }} title={props.asset.storageUri || src}>
          {props.asset.storageUri ? storageLabel(props.asset.storageUri) : (addressLabel(src) || '没有媒体引用')}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{playbackText(playback, kind)}</span>
        <span className="grow" />
        {props.extra}
      </div>
    </div>
  );
}

function PreviewBody(props: {
  kind: PreviewKind;
  src: string;
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
    return <div className="preview-paper"><p>{props.asset.storageUri ? `原件通过媒体引用保存，不在前台直接打开：${props.asset.storageUri}` : (props.asset.summary || '这条资源还没有媒体引用')}</p></div>;
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

function storageLabel(raw: string): string {
  const text = raw.trim();
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as { assetId?: string; kind?: string };
      if (parsed.assetId) return `媒体引用 ${parsed.kind ? parsed.kind + ' ' : ''}${parsed.assetId.slice(0, 8)}`;
    } catch {
      /* 原样展示 */
    }
  }
  return text;
}

function playbackText(playback: Playback, kind: PreviewKind): string {
  if (kind !== 'video' && kind !== 'audio') {
    return playback === 'loading' ? '正在加载预览' : '预览已加载';
  }
  if (playback === 'playing') return '正在播放';
  if (playback === 'muted') return '浏览器限制有声自动播放，已静音播放';
  if (playback === 'blocked') return '浏览器未允许自动播放，可点击控件开始';
  if (playback === 'paused') return '已暂停';
  if (playback === 'ended') return '播放结束';
  return '正在加载预览';
}
