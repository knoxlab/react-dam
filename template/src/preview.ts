import type { Asset, AssetKind } from './types';

export type Orientation = 'landscape' | 'portrait';
export type PreviewKind = 'image' | 'video' | 'document' | 'audio' | 'text';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function previewKind(kind: AssetKind): PreviewKind {
  if (kind === 'pdf' || kind === 'document') return 'document';
  if (kind === 'text') return 'text';
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

export function frameOf(asset: Asset): { w: number; h: number } {
  if ((asset.width ?? 0) > 0 && (asset.height ?? 0) > 0) return { w: asset.width ?? 0, h: asset.height ?? 0 };
  return { w: 16, h: 9 };
}

export function orientationOf(asset: Asset, measured?: { w: number; h: number }): Orientation {
  if (previewKind(asset.kind) === 'audio' || previewKind(asset.kind) === 'text') return 'landscape';
  const frame = measured && measured.w > 0 && measured.h > 0 ? measured : frameOf(asset);
  return frame.w >= frame.h ? 'landscape' : 'portrait';
}

export function layoutLabel(kind: PreviewKind, orientation: Orientation): string {
  if (kind === 'audio') return '横屏音频';
  if (kind === 'text') return '横屏文本';
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
