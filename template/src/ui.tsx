import { useState, type ReactNode } from 'react';
import type { AssetKind } from './types';

export function BrandMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.8" stroke="#fff" strokeWidth="1.6" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.8" stroke="#fff" strokeWidth="1.6" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.8" stroke="#fff" strokeWidth="1.6" />
      <path d="M17.25 13.5v7.5M13.5 17.25h7.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function NavGlyph({ name }: { name: string }) {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none' } as const;
  if (name === 'library') {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
        <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
        <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
        <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  if (name === 'upload') {
    return (
      <svg {...common}>
        <path d="M12 16V4M12 4L7.5 8.5M12 4l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'links' || name === 'detail') {
    return name === 'links' ? (
      <svg {...common}>
        <path d="M10.5 13.5a3.5 3.5 0 005 0l3-3a3.54 3.54 0 00-5-5l-1 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M13.5 10.5a3.5 3.5 0 00-5 0l-3 3a3.54 3.54 0 005 5l1-1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ) : (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M3 15l4.5-4.5 3.5 3.5 3-3 7 7" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" />
      </svg>
    );
  }
  if (name === 'ask') {
    return (
      <svg {...common}>
        <path d="M5 6.5A2.5 2.5 0 017.5 4h9A2.5 2.5 0 0119 6.5v6A2.5 2.5 0 0116.5 15H12l-3.5 3.5V15H7.5A2.5 2.5 0 015 12.5v-6Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M8.5 8.5h7M8.5 11.5h4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'logs') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <ellipse cx="12" cy="6" rx="7.5" ry="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="6.5" stroke="#9AA0A6" strokeWidth="1.8" />
      <path d="M16 16l4 4" stroke="#9AA0A6" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function UploadIcon({ color = '#fff' }: { color?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M12 16V5M12 5L7.5 9.5M12 5l4.5 4.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 15.5v3a2 2 0 002 2h12a2 2 0 002-2v-3" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Star() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.6 9.7l5.8-.8L12 3.6Z" fill="#FBBC04" />
    </svg>
  );
}

export function Mark({ kind }: { kind: 'ok' | 'no' | 'warn' }) {
  const fill = kind === 'ok' ? '#E6F4EA' : kind === 'warn' ? '#FEF7E0' : '#F1F3F4';
  const stroke = kind === 'ok' ? '#137333' : kind === 'warn' ? '#B06000' : '#9AA0A6';
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" fill={fill} />
      {kind === 'no' ? (
        <path d="M8 12h8" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
      ) : (
        <path d="M7.5 12.5l3 3 6-6.5" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

/**
 * 卡片预览图层：资源有预览图（图片缩略 / 视频海报 / 文档封面，上传时从 knox-media 同步）
 * 时直接展示预览图；没有预览或预览加载失败时回退类型图标占位。
 */
export function Thumb({ kind, ext, flag, src }: { kind: AssetKind; ext: string; flag?: string; src?: string }) {
  const [broken, setBroken] = useState(false);
  const preview = (src ?? '').trim();
  const showPreview = Boolean(preview) && !broken;
  return (
    <div className={`asset-thumb ${showPreview ? 'has-preview' : flag ? 'thumb-ai' : thumbName(kind)}`}>
      {showPreview ? (
        <img className="thumb-img" src={preview} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <ThumbArt kind={flag ? 'image' : kind} />
      )}
      <span className="thumb-tag">{ext}</span>
      {flag ? <span className="thumb-flag">{flag}</span> : null}
    </div>
  );
}

function thumbName(kind: AssetKind): string {
  if (kind === 'image') return 'thumb-image';
  if (kind === 'video') return 'thumb-video';
  if (kind === 'audio') return 'thumb-audio';
  if (kind === 'pdf') return 'thumb-pdf';
  if (kind === 'text') return 'thumb-txt';
  return 'thumb-doc';
}

function ThumbArt({ kind }: { kind: AssetKind }) {
  if (kind === 'video') {
    return (
      <svg viewBox="0 0 272 160" preserveAspectRatio="none" fill="none">
        <circle cx="136" cy="70" r="22" fill="#fff" fillOpacity=".22" />
        <path d="M130 60l16 10-16 10V60Z" fill="#fff" />
      </svg>
    );
  }
  if (kind === 'audio') {
    return (
      <svg viewBox="0 0 272 160" preserveAspectRatio="none" fill="none">
        <path d="M40 70v20M56 58v44M72 44v72M88 62v36M104 52v56M120 70v20M136 40v80M152 56v48M168 66v28M184 48v64M200 60v40M216 68v24M232 76v8" stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity=".92" />
      </svg>
    );
  }
  if (kind === 'text') {
    return (
      <svg viewBox="0 0 272 160" preserveAspectRatio="none" fill="none">
        <rect x="86" y="42" width="100" height="76" rx="6" fill="#fff" fillOpacity=".92" />
        <path d="M100 60h72M100 74h72M100 88h72M100 102h44" stroke="#8E9AAF" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'pdf' || kind === 'document') {
    const stroke = kind === 'pdf' ? '#D97A31' : '#4A7FC1';
    return (
      <svg viewBox="0 0 272 160" preserveAspectRatio="none" fill="none">
        <rect x="112" y="44" width="48" height="62" rx="6" fill="#fff" fillOpacity=".9" />
        <path d="M124 58h24M124 70h24M124 82h16" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 272 160" preserveAspectRatio="none" fill="none">
      <circle cx="136" cy="70" r="20" stroke="#fff" strokeWidth="2" opacity=".92" />
      <path d="M128 80l9 7 14-12" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return <section className="page is-active">{children}</section>;
}
