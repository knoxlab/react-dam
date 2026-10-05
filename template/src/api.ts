import { SEED } from './seed';
import type {
  Approval,
  Asset,
  AssetKind,
  AssetVersion,
  Catalog,
  License,
  ResourceGroup,
  ShareLink
} from './types';

const KINDS: AssetKind[] = ['image', 'video', 'audio', 'document', 'pdf', 'text'];
const LICENSES: License[] = ['all-rights', 'internal', 'cc-by', 'cc-by-sa', 'public-domain'];
const APPROVALS: Approval[] = ['draft', 'pending', 'approved', 'rejected'];

export function siteIdFromLocation(): string {
  const fromQuery = new URLSearchParams(window.location.search).get('siteId');
  if (fromQuery && fromQuery.trim()) return fromQuery.trim();
  return window.__POWERCMS_SITE_ID__?.trim() || '';
}

interface ContentRow {
  id?: string;
  title?: string;
  updatedAt?: string;
  fields?: Record<string, unknown>;
  [key: string]: unknown;
}

function rowFields(row: ContentRow): Record<string, unknown> {
  const fields = row.fields && typeof row.fields === 'object' ? { ...row.fields } : {};
  for (const [key, value] of Object.entries(row)) {
    if (!(key in fields)) fields[key] = value;
  }
  return fields;
}

function text(fields: Record<string, unknown>, key: string): string {
  const value = fields[key];
  if (value == null) return '';
  return String(value);
}

function list(fields: Record<string, unknown>, key: string): string[] {
  const value = fields[key];
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function number(fields: Record<string, unknown>, key: string): number {
  const value = fields[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function bool(fields: Record<string, unknown>, key: string): boolean {
  const value = fields[key];
  return value === true || value === 'true' || value === 1 || value === '1';
}

function oneOf<T extends string>(value: string, allowed: T[], fallback: T): T {
  return (allowed as string[]).includes(value) ? (value as T) : fallback;
}

function toAsset(row: ContentRow): Asset {
  const fields = rowFields(row);
  return {
    id: text(fields, 'id') || text(row, 'id'),
    title: text(row, 'title') || text(fields, 'title') || text(fields, 'asset_code_s'),
    code: text(fields, 'asset_code_s'),
    kind: oneOf(text(fields, 'asset_kind_s'), KINDS, 'document'),
    summary: text(fields, 'summary_t'),
    body: text(fields, 'body_t'),
    mime: text(fields, 'mime_type_s'),
    bytes: number(fields, 'file_size_i'),
    storageUri: text(fields, 'storage_uri_s'),
    tags: list(fields, 'tags_ss'),
    aiTags: list(fields, 'ai_tags_ss'),
    owner: text(fields, 'copyright_owner_s'),
    license: oneOf(text(fields, 'license_s'), LICENSES, ''),
    copyrightUntil: text(fields, 'copyright_until_dt'),
    department: text(fields, 'department_s'),
    group: text(fields, 'resource_group_s'),
    version: text(fields, 'version_label_s'),
    approval: oneOf(text(fields, 'approval_status_s'), APPROVALS, 'draft'),
    downloadTtl: number(fields, 'download_ttl_i') || 300,
    updatedAt: text(row, 'updatedAt')
  };
}

function toVersion(row: ContentRow): AssetVersion {
  const fields = rowFields(row);
  return {
    id: text(row, 'id'),
    assetCode: text(fields, 'asset_code_s'),
    label: text(fields, 'version_label_s'),
    note: text(fields, 'change_note_t'),
    storageUri: text(fields, 'storage_uri_s'),
    bytes: number(fields, 'file_size_i'),
    actor: text(fields, 'actor_s'),
    updatedAt: text(row, 'updatedAt')
  };
}

function toLink(row: ContentRow): ShareLink {
  const fields = rowFields(row);
  return {
    id: text(row, 'id'),
    title: text(row, 'title'),
    assetCode: text(fields, 'asset_code_s'),
    tokenHint: text(fields, 'token_hint_s'),
    expiresAt: text(fields, 'expires_at_dt'),
    maxDownloads: number(fields, 'max_downloads_i'),
    revoked: bool(fields, 'revoked_b'),
    audience: text(fields, 'audience_s')
  };
}

function toGroup(row: ContentRow): ResourceGroup {
  const fields = rowFields(row);
  return {
    id: text(row, 'id'),
    title: text(row, 'title') || text(fields, 'group_code_s'),
    code: text(fields, 'group_code_s'),
    department: text(fields, 'department_s'),
    description: text(fields, 'description_t'),
    aclRole: text(fields, 'acl_role_s'),
    encryptionRequired: bool(fields, 'encryption_required_b'),
    backupPolicy: text(fields, 'backup_policy_s')
  };
}

async function query(siteId: string, contentType: string): Promise<ContentRow[] | null> {
  const url =
    `/api/v1/delivery/sites/${encodeURIComponent(siteId)}/contents/query` +
    `?contentType=${encodeURIComponent(contentType)}&limit=50&orderBy=updatedAt&status=PUBLISHED`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) return null;
  const data: unknown = await response.json();
  return Array.isArray(data) ? (data as ContentRow[]) : null;
}

export async function loadCatalog(siteId: string): Promise<{ source: 'live' | 'seed'; catalog: Catalog }> {
  if (!siteId) return { source: 'seed', catalog: SEED };
  try {
    const [assets, versions, links, groups] = await Promise.all([
      query(siteId, 'digital_asset'),
      query(siteId, 'asset_version'),
      query(siteId, 'share_link'),
      query(siteId, 'resource_group')
    ]);
    if (!assets || assets.length === 0) return { source: 'seed', catalog: SEED };
    return {
      source: 'live',
      catalog: {
        assets: assets.map(toAsset),
        versions: (versions ?? []).map(toVersion),
        links: (links ?? []).map(toLink),
        groups: (groups ?? []).map(toGroup)
      }
    };
  } catch {
    return { source: 'seed', catalog: SEED };
  }
}
