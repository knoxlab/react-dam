import type { Approval, AssetKind, License } from './types';

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const digits = value >= 100 || index === 0 ? 0 : value >= 10 ? 1 : 1;
  return `${value.toFixed(digits)} ${units[index]}`;
}

export function formatWhen(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return iso || '—';
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天前`;
  return iso.slice(0, 16).replace('T', ' ');
}

export function formatDate(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return iso || '—';
  return iso.slice(0, 16).replace('T', ' ');
}

const EXT: Record<string, string> = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
  'image/gif': 'GIF',
  'video/mp4': 'MP4',
  'video/quicktime': 'MOV',
  'audio/mpeg': 'MP3',
  'audio/wav': 'WAV',
  'audio/flac': 'FLAC',
  'application/pdf': 'PDF',
  'text/plain': 'TXT',
  'text/markdown': 'MD',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX'
};

export function fileExt(mime: string, kind: AssetKind): string {
  if (EXT[mime]) return EXT[mime];
  if (kind === 'pdf') return 'PDF';
  if (kind === 'text') return 'TXT';
  const tail = mime.split('/').pop() || kind;
  return tail.replace('vnd.', '').slice(0, 8).toUpperCase();
}

export function kindLabel(kind: AssetKind): string {
  return {
    image: '图片',
    audio: '音频',
    video: '视频',
    document: '文档',
    pdf: 'PDF',
    text: '文本片段'
  }[kind];
}

export function thumbClass(kind: AssetKind): string {
  if (kind === 'image') return 'thumb-image';
  if (kind === 'video') return 'thumb-video';
  if (kind === 'audio') return 'thumb-audio';
  if (kind === 'pdf') return 'thumb-pdf';
  if (kind === 'text') return 'thumb-txt';
  return 'thumb-doc';
}

export function licenseLabel(license: License | ''): string {
  return {
    'all-rights': '保留所有权利',
    internal: '内部使用',
    'cc-by': 'CC BY · 可商用',
    'cc-by-sa': 'CC BY-SA · 可商用',
    'public-domain': '公有领域',
    '': '未标注许可'
  }[license];
}

export function approvalLabel(approval: Approval): string {
  return { draft: '草稿', pending: '待审批', approved: '已发布', rejected: '已驳回' }[approval];
}

export function approvalBadge(approval: Approval): string {
  if (approval === 'approved') return 'badge-success';
  if (approval === 'pending') return 'badge-warn';
  if (approval === 'rejected') return 'badge-danger';
  return 'badge-neutral';
}

export function linkStatus(revoked: boolean, expiresAt: string): { label: string; badge: string } {
  if (revoked) return { label: '已撤销 REVOKED', badge: 'badge-danger' };
  const time = Date.parse(expiresAt);
  if (Number.isFinite(time) && time < Date.now()) return { label: '已过期 EXPIRED', badge: 'badge-neutral' };
  return { label: '生效中', badge: 'badge-success' };
}
