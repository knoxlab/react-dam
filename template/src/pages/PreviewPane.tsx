import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Asset } from '../types';
import {
  frameOf,
  knoxPlayerUrl,
  loadKnoxPlayUrl,
  mediaAssetId,
  mediaPdfUrl,
  mediaPreviewUrl,
  mediaThumbUrl,
  pdfFrame,
  previewKind,
  previewTarget,
  type Orientation,
  type PreviewKind
} from '../preview';
import { ImageLightbox, type LightboxSlide } from './ImageLightbox';
import { PdfViewer } from './PdfViewer';

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
  // 大图查看层（图片专属）：铺满窗口，带缩放/旋转/拖拽/前后翻图。
  const [lightbox, setLightbox] = useState(false);
  // 预览顶部工具条状态：这里只管图片。文档的翻页/缩放/大纲/全屏工具条
  // 收在 PdfViewer 自己的壳内（顶部居中），因为全屏元素是壳，工具条必须在里面才会跟着全屏。
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    setBox(null);
    setPlayback(src ? 'loading' : 'ready');
    // 换资源时缩放必须归位，否则上一条 200% 放大会留在新资源上。
    setZoom(1);
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
    // 图片走预览代理取图片字节，不经过 play-token：Knox-Media 对图片也可能回
    // `playerMode=hls` 的 DRM 加密播放列表（m3u8），`<img>` 拿到无法渲染。
    // /media-thumb 按类型回源（图片缩略/音视频海报截帧/文档封面），且是 permitAll，
    // 未登录访客同样可用，与列表卡片的 `assetPreviewSrc` 同源同款。
    if (kind === 'image') {
      setSrc(mediaThumbUrl(props.siteId, assetId));
      return () => {
        cancelled = true;
      };
    }
    // 文档一律先取 /media-pdf 的**整份原件**，由浏览器端 pdf.js 渲染（对齐 Knox 自己的
    // DocumentReader）。服务端栅格化那条路（/media-preview 的页图）要求 Knox 装有
    // mutool/pdftoppm/Ghostscript/ImageMagick 之一；缺失时只有第 1 页能出图
    // （LibreOffice 只会导出第 1 页），第 2 页起一律 404 ——「点下一页看不到」即此因。
    // 非 PDF 文档会被 /media-pdf 拒绝，由 PdfViewer 回退到媒体预览页，故这里**不再按 MIME
    // 分流**：交付接口本就不回 MIME（content 的 fields 里没有该字段），靠它判断会永远走错分支。
    if (kind === 'document') {
      setSrc(mediaPdfUrl(props.siteId, assetId));
      return () => {
        cancelled = true;
      };
    }
    loadKnoxPlayUrl(props.siteId, assetId)
      .then((data) => {
        if (cancelled) return;
        // 音视频都嵌 Knox-Media 播放代理页（/media-play）：播放器与可播地址都来自
        // Knox-Media，HLS 由 PowerPlayer 解码。此前 audio 用 `data.playUrl` 直接喂
        // `<audio src>`，而 Knox 对音频同样可能回 `playerMode=hls` 的 m3u8 ——
        // 浏览器除 Safari 外不解码 HLS，音频无声。
        // 其余类型仍用短时可播地址取字节。
        const embedPlayer = kind === 'video' || kind === 'audio';
        setSrc(embedPlayer ? knoxPlayerUrl(props.siteId, assetId) : data.playUrl);
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
    // 仅当 src 指向真实 PDF 字节时才探测页幅。文档预览改走 /media-preview 后 src 是一页
    // HTML，抓回来给 pdfFrame 解析只会得到 null（它要找 PDF 页头），纯属白跑一次请求。
    // /media-pdf 是整份原件字节，虽然 pdfFrame 能解析，但那等于把 PDF 下两遍 ——
    // 交给 PdfViewer 渲染后自行回报尺寸。
    if (kind !== 'document' || !src || src.startsWith('/media-preview/') || src.startsWith('/media-pdf/')) return;
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

  // 缩放态只作用于图片：文档的翻页/缩放/大纲/全屏已收进显示区顶部（PdfViewer 自己的壳内）。
  const isZoomed = zoom !== 1 && kind === 'image';
  // --zoom 供 style.css 计算 .fit 的放大尺寸（不能用 transform，那样裁掉了滚不到）。
  const stageZoomStyle = { '--zoom': String(zoom) } as Record<string, string> as React.CSSProperties;

  const stageClass = [
    'preview-stage',
    kind === 'audio' ? 'stage-audio' : props.orientation === 'portrait' ? 'stage-port' : 'stage-land',
    kind === 'document' || kind === 'text' ? 'stage-doc' : '',
    // 放大后舞台要能滚动平移，否则超出部分被裁掉且看不到
    isZoomed ? 'is-zoomed' : ''
  ].filter(Boolean).join(' ');

  // 只有图片还有独立工具条：文档的翻页/缩放/大纲/全屏已收进显示区顶部（PdfViewer 内），
  // 视频/音频用播放器原生控件，再造一套会重复。
  const hasToolbar = kind === 'image';

  // 回退预览页要的是**媒体资产 id**（从 storage_uri_s 解析），不是内容项 id —— 两者是
  // 不同的 UUID：/media-preview 按 media_asset 主键查，传内容项 id 会回「媒体资产不存在」。
  const mediaId = previewTarget(props.asset).assetId;
  const docFallbackSrc = mediaId ? mediaPreviewUrl(props.siteId, mediaId) : '';

  // 大图查看层的可切集合：当前主图在首位，其后是内容模型里的其余图片 ——
  // 顺序与详情页侧栏「图片」卡片一致，前后翻图时才不会与页面上看到的顺序对不上。
  const lightboxSlides = kind === 'image' ? imageSlides(props.asset, props.siteId, props.imageAssetIds) : [];
  const canEnlarge = Boolean(src) && !loadError && lightboxSlides.length > 0;

  return (
    <div className="card">
      {hasToolbar ? (
        <div className="preview-toolbar">
          <span className="tb-label">缩放</span>
          <button type="button" aria-label="缩小" disabled={zoom <= 0.5} onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))}>−</button>
          <span className="tb-label">{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="放大" disabled={zoom >= 3} onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100))}>＋</button>
          <button type="button" disabled={zoom === 1} onClick={() => setZoom(1)}>还原</button>
        </div>
      ) : null}
      <div className={stageClass} style={isZoomed ? stageZoomStyle : undefined}>
        {playback === 'loading' ? <span className="preview-loading">正在加载预览</span> : null}
        <PreviewBody
          kind={kind}
          src={src}
          docFallbackSrc={docFallbackSrc}
          embed={(kind === 'video' || kind === 'audio') && src.startsWith('/media-play/')}
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
        {canEnlarge ? (
          <button type="button" className="view-large" title="点击查看大图" onClick={() => setLightbox(true)}>
            <IconSearch />
            查看大图
          </button>
        ) : null}
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
      {lightbox && canEnlarge ? (
        <ImageLightbox
          slides={lightboxSlides}
          alt={props.asset.title}
          onClose={() => setLightbox(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * 大图查看层的图片集合。
 *
 * <p>主图取法与上方 `src` 的解析**完全一致**（原件引用 → 内容模型首图 → 预览图字段），
 * 否则「看到的」与「打开后第一张」会是两张不同的图；外链原件没有媒体资产 id，
 * 只能作为单独一项放进列表，其后仍接内容模型里的图片。
 */
function imageSlides(asset: Asset, siteId: string, imageAssetIds?: string[]): LightboxSlide[] {
  const target = previewTarget(asset);
  const mainId = target.assetId || imageAssetIds?.[0] || mediaAssetId(asset.thumbnail) || '';
  const seen = new Set<string>();
  const slides: LightboxSlide[] = [];
  if (target.url) {
    slides.push({ url: target.url });
  } else if (mainId && siteId) {
    slides.push({ url: mediaThumbUrl(siteId, mainId) });
    seen.add(mainId);
  }
  for (const id of imageAssetIds ?? []) {
    if (!id || !siteId || seen.has(id)) continue;
    seen.add(id);
    slides.push({ url: mediaThumbUrl(siteId, id) });
  }
  return slides;
}

/** 「查看大图」按钮上的放大镜 —— 放在 .preview-stage 内，注意那里有 `.preview-stage svg` 全宽规则，需在 CSS 里覆写尺寸。 */
function IconSearch() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.25" />
      <path d="M7.6 10.5h5.8M10.5 7.6v5.8" />
      <path d="M15 15l4.5 4.5" />
    </svg>
  );
}

function PreviewBody(props: {
  kind: PreviewKind;
  src: string;
  /** 文档的非 PDF 回退预览页（PdfViewer 内部在取不到 PDF 时使用）。 */
  docFallbackSrc: string;
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
        // 放大走 CSS 的 width/height × --zoom（见 style.css），不改布局语义，
        // 也不触发 onMeasure 重算外层尺寸 —— 否则缩放会让下方信息区跟着跳动。
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
    // 嵌 Knox-Media 播放代理页：HLS 由 PowerPlayer 解码，`<audio>` 无法直接取流。
    // 此时不叠波形条——代理页自带播放器，两套控件会打架；且波形依赖 <audio> 的
    // onPlay/onPause，跨 iframe 取不到事件，动画只会永远停着。
    if (props.embed) {
      return (
        <iframe
          key={props.asset.id}
          className="fit"
          title={props.asset.title}
          src={props.src}
          allow="autoplay"
          onLoad={props.onReady}
        />
      );
    }
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
    // 走浏览器端 pdf.js（对齐 Knox 的 DocumentReader）：任意页可渲染，
    // 总页数由 pdf.js 给出，因此末页能真正禁用「下一页」。
    // 非 PDF 文档取不到原件时由 PdfViewer 内部回退到服务端预览页。
    return (
      <PdfViewer
        src={props.src}
        fallbackSrc={props.docFallbackSrc}
        title={props.asset.title}
        onReady={props.onReady}
        onMeasure={props.onMeasure}
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
