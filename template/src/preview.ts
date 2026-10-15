import type { Asset, AssetKind } from './types';

export type Orientation = 'landscape' | 'portrait';
export type PreviewKind = 'image' | 'video' | 'document' | 'audio' | 'other';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function previewKind(kind: AssetKind): PreviewKind {
  if (kind === 'document') return 'document';
  if (kind === 'other') return 'other';
  return kind;
}

/** 编辑器明确保存的外部地址。站内路径和对象存储键都不是可直接打开的原件。 */
export function externalUrl(raw: string | undefined): string {
  const text = (raw ?? '').trim();
  if (/^https?:\/\//i.test(text)) return text;
  return '';
}

export function mediaAssetId(raw: string | undefined): string {
  const text = (raw ?? '').trim();
  if (UUID.test(text)) return text;
  if (!text.startsWith('{')) return '';
  try {
    const parsed = JSON.parse(text) as { assetId?: string };
    return parsed.assetId && UUID.test(parsed.assetId) ? parsed.assetId : '';
  } catch {
    return '';
  }
}

/**
 * 预览只接受媒体引用或编辑器保存的外部地址。
 * 对象存储键、站内路径都不作为无鉴权原件交给浏览器。
 */
export function previewTarget(asset: Asset): { url: string; assetId: string; storageKey: string } {
  const raw = asset.storageUri.trim();
  const external = externalUrl(raw) || jsonExternal(raw);
  if (external) return { url: external, assetId: '', storageKey: '' };
  const assetId = mediaAssetId(raw);
  if (assetId) return { url: '', assetId, storageKey: '' };
  return { url: '', assetId: '', storageKey: raw };
}

function jsonExternal(raw: string): string {
  const text = raw.trim();
  if (!text.startsWith('{')) return '';
  try {
    const parsed = JSON.parse(text) as { url?: string };
    return externalUrl(parsed.url);
  } catch {
    return '';
  }
}

/**
 * 预览代理地址：`/media-thumb/{siteId}/{assetId}`。服务端按类型回源（图片缩略 / 音视频
 * 海报截帧 / 文档封面），对 Knox 侧异步产物实时探测，且走 permitAll 允许匿名访问。
 *
 * 图片预览**不能**用 play-token 返回的 `playUrl`：Knox-Media 对图片也可能返回
 * `playerMode=hls` 的 DRM 加密播放列表（`application/vnd.apple.mpegurl`），
 * `<img src>` 拿到 m3u8 无法渲染。
 */
export function mediaThumbUrl(siteId: string, assetId: string): string {
  return `/media-thumb/${encodeURIComponent(siteId)}/${assetId}`;
}

/**
 * 文档预览页：`/media-preview/{siteId}/{assetId}?page=N`（原生 HTML5 预览，含上/下页导航）。
 *
 * 文档**不能**用 play-token 的 `playUrl`（同图片，Knox 也可能回 `playerMode=hls` 的 m3u8，
 * 塞进 `<iframe>` 无法渲染），也不该用 `/media-file`——后端刻意把它排除在白名单外，
 * 避免文档正文变成匿名可下载（`PlayDeliveryController#file` 的 kind 白名单只放 font/image）。
 *
 * **必须显式带 `page`**：不带时该端点只输出「文件名 + 大小」占位卡（`documentPage`），
 * 带 `page` 才走 `documentPageWithImage` 出真实页图。
 */
export function mediaPreviewUrl(siteId: string, assetId: string, page = 1): string {
  return `/media-preview/${encodeURIComponent(siteId)}/${assetId}?page=${page}`;
}

/**
 * 文档原件字节（PDF），供浏览器端 pdf.js 客户端渲染。
 *
 * 与 {@link mediaPreviewUrl} 的分工：
 * - `/media-preview` 出的是**服务端栅格化的单页 HTML**，依赖 Knox 侧有 mutool/pdftoppm/
 *   Ghostscript/ImageMagick 之一；缺失时只有第 1 页能出图（LibreOffice 只会导出第 1 页），
 *   第 2 页起一律 404 —— 「点下一页看不到」正是这个原因。
 * - `/media-pdf` 出**整份 PDF**，由 pdf.js 在客户端渲染，不依赖任何服务端栅格化，
 *   任意页可看、总页数也由 pdf.js 给出（对齐 Knox 自己的 DocumentReader 实现）。
 *
 * 它与 `/media-file` 的区别在于**刻意只为文档开**：`file()` 的白名单只放 font/image，
 * 避免文档正文变成匿名可下载。这里显式放行 document(PDF)，访问控制与 `/media-preview`
 * 同口径（同一个 `deliverable()` ACL）—— 即「能看到预览页的人就能拿到原件字节」。
 */
export function mediaPdfUrl(siteId: string, assetId: string): string {
  return `/media-pdf/${encodeURIComponent(siteId)}/${assetId}`;
}

/**
 * 资源列表卡片的预览图源：优先取内容模型记录的预览图 `thumbnail_url_s`（IMAGE 字段，
 * 编辑时可本地重新上传）——
 * 1. 服务端同步/本地上传存的是**预览资产编号**（裸 UUID 或 mediaRef JSON）→ 经
 *    `/media-thumb/{siteId}/{assetId}` 代理按类型回源（图片缩略 / 音视频海报截帧 /
 *    文档封面，代理对 Knox 侧异步产物实时探测，就绪前后同一地址生效）；
 * 2. 编辑者保存的站内代理地址或外部 http(s) 地址 → 原样使用；
 * 3. 空值 → 由媒体原件引用推导代理地址；其他类型与无原件的资源返回空串，
 *    卡片回退类型图标。
 */
export function assetPreviewSrc(siteId: string, asset: Asset): string {
  const recorded = (asset.thumbnail ?? '').trim();
  if (recorded) {
    // 形态 2：编辑者显式保存的 URL 原样展示
    if (recorded.startsWith('/') || /^https?:\/\//i.test(recorded)) return recorded;
    // 形态 1：资产编号 → 预览代理
    const recordedAssetId = mediaAssetId(recorded);
    if (recordedAssetId && siteId) return `/media-thumb/${encodeURIComponent(siteId)}/${recordedAssetId}`;
    return '';
  }
  const kind = previewKind(asset.kind);
  if (kind === 'other') return '';
  const target = previewTarget(asset);
  if (target.url) return kind === 'image' ? target.url : '';
  if (!target.assetId || !siteId) return '';
  return `/media-thumb/${encodeURIComponent(siteId)}/${target.assetId}`;
}

export function frameOf(asset: Asset): { w: number; h: number } {
  if ((asset.width ?? 0) > 0 && (asset.height ?? 0) > 0) return { w: asset.width ?? 0, h: asset.height ?? 0 };
  return { w: 16, h: 9 };
}

export function orientationOf(asset: Asset, measured?: { w: number; h: number }): Orientation {
  if (previewKind(asset.kind) === 'audio' || previewKind(asset.kind) === 'other') return 'landscape';
  const frame = measured && measured.w > 0 && measured.h > 0 ? measured : frameOf(asset);
  return frame.w >= frame.h ? 'landscape' : 'portrait';
}

export function layoutLabel(kind: PreviewKind, orientation: Orientation): string {
  if (kind === 'audio') return '横屏音频';
  if (kind === 'other') return '横屏其他';
  const face = orientation === 'portrait' ? '竖屏' : '横屏';
  const name = kind === 'image' ? '图片' : kind === 'video' ? '视频' : '文档';
  return `${face}${name}`;
}

/** 向交付接口换取 Knox-Media 播放地址，供前台直接加载图片。 */
export async function loadKnoxPlayUrl(siteId: string, assetId: string): Promise<{ playUrl: string; width: number; height: number }> {
  const response = await fetch(
    `/api/v1/delivery/sites/${encodeURIComponent(siteId)}/media/${encodeURIComponent(assetId)}/play-token`,
    { method: 'POST', headers: { Accept: 'application/json' }, credentials: 'include' }
  );
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json() as { message?: string };
      detail = body.message?.trim() || '';
    } catch {
      /* 非 JSON 错误页 */
    }
    throw new Error(detail || (response.status === 404 ? '原件不存在或尚未就绪' : '原件暂时无法从 Knox-Media 加载'));
  }
  const data = await response.json() as { playUrl?: string; width?: number; height?: number };
  if (!data.playUrl) throw new Error('原件暂时无法从 Knox-Media 加载');
  return { playUrl: data.playUrl, width: data.width ?? 0, height: data.height ?? 0 };
}

/**
 * Knox-Media 播放代理页地址（GET /media-play/{siteId}/{assetId}）。
 * 该页由服务端渲染，内嵌 Knox PowerPlayer，加载时自行向 play-token 换取可播地址，
 * 与后端媒体库「播放代码」的 iframe 形态一致；HLS 也由 PowerPlayer 解码。
 */
export function knoxPlayerUrl(siteId: string, assetId: string): string {
  return `/media-play/${encodeURIComponent(siteId)}/${encodeURIComponent(assetId)}`;
}

export function addressLabel(src: string): string {
  if (!src) return '';
  const path = src.split('?')[0];
  const name = path.slice(path.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(name) || src;
  } catch {
    return name || src;
  }
}

/** 从 PDF 头里读页面宽高，文档没有像素元数据时用它决定横竖屏。 */
export function pdfFrame(bytes: Uint8Array): { w: number; h: number } | null {
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 8192)));
  const match = text.match(/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/);
  if (!match) return null;
  const w = Number(match[3]) - Number(match[1]);
  const h = Number(match[4]) - Number(match[2]);
  if (!(w > 0) || !(h > 0)) return null;
  return { w: Math.round(w), h: Math.round(h) };
}
