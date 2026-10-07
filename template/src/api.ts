import { SEED } from './seed';
import type {
  Approval,
  Asset,
  AssetKind,
  AssetVersion,
  Catalog,
  License,
  MemberGrant,
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
    thumbnail: text(fields, 'thumbnail_url_s'),
    width: number(fields, 'width_i'),
    height: number(fields, 'height_i'),
    tags: list(fields, 'tags_ss'),
    aiTags: list(fields, 'ai_tags_ss'),
    owner: text(fields, 'copyright_owner_s'),
    license: oneOf(text(fields, 'license_s'), LICENSES, ''),
    copyrightUntil: text(fields, 'copyright_until_dt'),
    department: text(fields, 'department_s'),
    group: text(fields, 'resource_group_s'),
    folderId: text(row, 'folderId'),
    version: text(fields, 'version_label_s'),
    approval: oneOf(text(fields, 'approval_status_s'), APPROVALS, 'draft'),
    downloadTtl: number(fields, 'download_ttl_i') || 300,
    updatedAt: text(row, 'updatedAt'),
    values: fieldValues(fields)
  };
}

function fieldValues(fields: Record<string, unknown>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') values[key] = String(value);
  }
  return values;
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

const RIGHTS = ['view', 'edit', 'publish', 'manage', 'add-children', 'download'];

function toGroup(row: ContentRow): ResourceGroup {
  const fields = rowFields(row);
  const description = text(fields, 'description_t');
  return {
    id: text(row, 'id'),
    title: text(row, 'title') || text(fields, 'group_code_s'),
    code: text(fields, 'group_code_s'),
    path: text(fields, 'group_code_s').startsWith('/') ? text(fields, 'group_code_s') : '',
    department: text(fields, 'department_s'),
    description: description.replace(/\n权利：[^\n]*/g, '').trim(),
    grants: grantsFromText(text(fields, 'acl_role_s'), description)
  };
}

function grantsFromText(memberName: string, description: string): MemberGrant[] {
  const matched = description.match(/权利：([a-z,-]+)/);
  if (!memberName || !matched) return [];
  const rights = matched[1].split(',').map((item) => item.trim()).filter((item) => RIGHTS.includes(item));
  return [{ name: memberName, code: memberName, rights }];
}

function toFolderGrant(row: {
  id?: string;
  title?: string;
  name?: string;
  path?: string;
  parentId?: string;
  grants?: { name?: string; code?: string; rights?: string[] }[];
  anonymousView?: boolean;
}): ResourceGroup {
  return {
    id: row.id ?? '',
    title: row.title ?? '',
    code: row.name ?? '',
    path: row.path ?? '',
    parentId: row.parentId ?? '',
    department: '',
    description: row.path ? `栏目 ${row.path}` : '',
    grants: (row.grants ?? []).map((grant) => ({
      name: grant.name ?? '',
      code: grant.code ?? '',
      rights: (grant.rights ?? []).filter((right) => RIGHTS.includes(right))
    })),
    anonymousView: row.anonymousView === true
  };
}

async function query(siteId: string, contentType: string): Promise<ContentRow[] | null> {
  const url =
    `/api/v1/delivery/sites/${encodeURIComponent(siteId)}/contents/query` +
    `?contentType=${encodeURIComponent(contentType)}&limit=50&orderBy=updatedAt&status=PUBLISHED&forViewer=true`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    credentials: 'include',
    cache: 'no-store'
  });
  if (!response.ok) return null;
  const data: unknown = await response.json();
  return Array.isArray(data) ? (data as ContentRow[]) : null;
}

export async function askPublished(siteId: string, question: string, sessionId: string): Promise<{
  answer: string | null;
  citations: { contentId: string; title: string; snippet: string }[];
  blocked: boolean;
  noAnswer: boolean;
  noAnswerMessage: string | null;
} | null> {
  if (!siteId) return null;
  const response = await fetch(`/api/v1/public/sites/${encodeURIComponent(siteId)}/ai/ask`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Anonymous-Session': sessionId
    },
    body: JSON.stringify({ question })
  });
  if (!response.ok) return null;
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object') return null;
  const row = data as {
    answer?: string | null;
    citations?: { contentId?: string; title?: string; snippet?: string }[];
    blocked?: boolean;
    noAnswer?: boolean;
    noAnswerMessage?: string | null;
  };
  return {
    answer: row.answer ?? null,
    citations: (row.citations ?? []).map((item) => ({
      contentId: item.contentId ?? '',
      title: item.title ?? '',
      snippet: item.snippet ?? ''
    })),
    blocked: Boolean(row.blocked),
    noAnswer: Boolean(row.noAnswer),
    noAnswerMessage: row.noAnswerMessage ?? null
  };
}

async function loadFolderGrants(siteId: string): Promise<ResourceGroup[] | null> {
  const delivered = await fetch(`/api/v1/delivery/sites/${encodeURIComponent(siteId)}/folders`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  if (delivered.ok) {
    const data: unknown = await delivered.json();
    return Array.isArray(data) ? data.map((row) => toFolderGrant(row as Parameters<typeof toFolderGrant>[0])) : [];
  }
  const [folderResponse, roleResponse] = await Promise.all([
    fetch(`/api/v1/sites/${encodeURIComponent(siteId)}/folders`, {
      headers: { Accept: 'application/json' },
      credentials: 'include',
      cache: 'no-store'
    }),
    fetch('/api/v1/roles', { headers: { Accept: 'application/json' }, credentials: 'include', cache: 'no-store' })
  ]);
  if (!folderResponse.ok || !roleResponse.ok) return null;
  const folderData: unknown = await folderResponse.json();
  const roleData: unknown = await roleResponse.json();
  const memberIds = new Set(
    (Array.isArray(roleData) ? roleData : [])
      .filter((role) => role && typeof role === 'object' && (role as { tierLevel?: number | null }).tierLevel != null)
      .map((role) => String((role as { id: string }).id))
  );
  const roleName = new Map(
    (Array.isArray(roleData) ? roleData : []).map((role) => {
      const row = role as { id: string; code?: string; name?: string };
      return [String(row.id), { code: row.code ?? '', name: row.name ?? '' }] as const;
    })
  );
  const flat = flattenFolders(Array.isArray(folderData) ? folderData : []);
  const groups: ResourceGroup[] = [];
  for (const folder of flat) {
    const permission = await fetch(
      `/api/v1/permissions?objectType=FOLDER&objectId=${encodeURIComponent(folder.id)}`,
      { headers: { Accept: 'application/json' }, credentials: 'include', cache: 'no-store' }
    );
    if (!permission.ok) continue;
    const view = await permission.json() as {
      effectiveAcl?: { principalType?: string; principalId?: string; permissions?: string[] }[];
    };
    const grants: MemberGrant[] = [];
    for (const entry of view.effectiveAcl ?? []) {
      if (entry.principalType !== 'ROLE' || !entry.principalId || !memberIds.has(entry.principalId)) continue;
      const role = roleName.get(entry.principalId);
      grants.push({
        name: role?.name || entry.principalId,
        code: role?.code || '',
        rights: (entry.permissions ?? []).filter((right) => RIGHTS.includes(right))
      });
    }
    groups.push({
      id: folder.id,
      title: folder.title,
      code: folder.name,
      path: folder.path,
      department: '',
      description: folder.path ? `栏目 ${folder.path}` : '',
      grants
    });
  }
  return groups;
}

function flattenFolders(nodes: unknown[]): { id: string; title: string; name: string; path: string }[] {
  const out: { id: string; title: string; name: string; path: string }[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const row = node as { id?: string; title?: string; name?: string; path?: string; children?: unknown[] };
    if (row.id) {
      out.push({ id: String(row.id), title: row.title ?? '', name: row.name ?? '', path: row.path ?? '' });
    }
    if (Array.isArray(row.children)) out.push(...flattenFolders(row.children));
  }
  return out;
}

export type MemberField = {
  code: string;
  name: string;
  fieldType: string;
  required: boolean;
  helpText: string;
  options: string[];
};

export type MemberRegistrationForm = {
  siteKey: string;
  approval: 'AUTO' | 'REVIEW';
  fields: MemberField[];
};

export type MemberRegistrationResult = {
  username: string;
  displayName: string;
  status: string;
  autoLogin: boolean;
};

async function apiError(res: Response): Promise<string> {
  try {
    const body = await res.json() as { message?: string };
    if (body.message) return body.message;
  } catch {
    /* 非 JSON 错误页 */
  }
  return '请求失败';
}

export async function loadMemberRegistration(siteId: string): Promise<MemberRegistrationForm> {
  const res = await fetch(`/api/v1/delivery/sites/${encodeURIComponent(siteId)}/member-registration`, { cache: 'no-store' });
  if (res.status === 404) throw new Error('注册接口尚未加载，请重启 PowerCMS 后再试。');
  if (!res.ok) throw new Error(await apiError(res));
  return res.json() as Promise<MemberRegistrationForm>;
}

export async function submitMemberRegistration(siteId: string, username: string, password: string, fields: Record<string, unknown>): Promise<MemberRegistrationResult> {
  const res = await fetch(`/api/v1/delivery/sites/${encodeURIComponent(siteId)}/member-registration`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, fields })
  });
  if (!res.ok) throw new Error(await apiError(res));
  return res.json() as Promise<MemberRegistrationResult>;
}

export async function frontendLogin(siteId: string, username: string, password: string): Promise<void> {
  const res = await fetch('/api/v1/auth/frontend/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, siteKey: siteId })
  });
  if (!res.ok) throw new Error(await apiError(res));
}

export function frontendLogout() {
  void fetch('/api/v1/auth/frontend/logout', { method: 'POST', credentials: 'include' }).catch(() => undefined);
}

export const MEMBER_LIBRARY_MISSING = '会员空间接口尚未加载，请重启 PowerCMS 后再试。';

export type MemberUpload = { id: string; title: string; status: string; updatedAt: string };
export type MemberMark = { contentId: string; at: string };

async function memberLibrary(siteId: string, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has('X-Language')) headers.set('X-Language', 'zh-CN');
  return fetch(`/api/v1/delivery/sites/${encodeURIComponent(siteId)}/me${path}`, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers
  });
}

async function requireMemberOk(res: Response) {
  if (res.status === 404 || res.status === 405) throw new Error(MEMBER_LIBRARY_MISSING);
  if (!res.ok) throw new Error(await apiError(res));
}

export async function changeMemberPassword(siteId: string, currentPassword: string, newPassword: string) {
  const res = await memberLibrary(siteId, '/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword })
  });
  await requireMemberOk(res);
}

export type MemberFileUpload = { assetId: string; status: string; filename: string };

/** 把文件传到指定栏目。进度按已发送字节计算，调用方可用 signal 中止。 */
export function uploadMemberFile(
  siteId: string,
  folderId: string,
  file: File,
  onProgress: (percent: number) => void,
  signal: AbortSignal
): Promise<MemberFileUpload> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fail = (error: Error) => {
      xhr.upload.onprogress = null;
      xhr.onload = null;
      xhr.onerror = null;
      xhr.onabort = null;
      reject(error);
    };
    const stop = () => xhr.abort();
    if (signal.aborted) {
      fail(new DOMException('已中止', 'AbortError'));
      return;
    }
    signal.addEventListener('abort', stop, { once: true });
    xhr.open('POST', `/api/v1/delivery/sites/${encodeURIComponent(siteId)}/me/uploads/files`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-Language', 'zh-CN');
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onerror = () => fail(new Error('网络异常，上传没有完成'));
    xhr.onabort = () => fail(new DOMException('已中止', 'AbortError'));
    xhr.onload = () => {
      signal.removeEventListener('abort', stop);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText) as { assetId?: string; status?: string; filename?: string };
          resolve({
            assetId: body.assetId ?? '',
            status: body.status ?? '',
            filename: body.filename ?? file.name
          });
        } catch {
          fail(new Error('上传结果无法读取'));
        }
        return;
      }
      let message = xhr.status === 404 || xhr.status === 405 ? MEMBER_LIBRARY_MISSING : '上传失败';
      try {
        const body = JSON.parse(xhr.responseText) as { message?: string };
        if (body.message) message = body.message;
      } catch {
        /* 保留上面的默认说明 */
      }
      fail(new Error(message));
    };
    const body = new FormData();
    body.append('file', file, file.name);
    body.append('folderId', folderId);
    xhr.send(body);
  });
}

export async function loadMemberUploads(siteId: string): Promise<MemberUpload[]> {
  const res = await memberLibrary(siteId, '/uploads');
  await requireMemberOk(res);
  const rows = await res.json() as { id?: string; title?: string; status?: string; updatedAt?: string }[];
  return rows.map((row) => ({
    id: row.id ?? '',
    title: row.title ?? '',
    status: row.status ?? '',
    updatedAt: row.updatedAt ?? ''
  }));
}

export async function loadMemberFavorites(siteId: string): Promise<MemberMark[]> {
  const res = await memberLibrary(siteId, '/favorites');
  await requireMemberOk(res);
  return readMarks(await res.json());
}

export async function saveMemberFavorite(siteId: string, contentId: string, saved: boolean) {
  const res = await memberLibrary(siteId, `/favorites/${encodeURIComponent(contentId)}`, {
    method: saved ? 'PUT' : 'DELETE'
  });
  await requireMemberOk(res);
}

export async function loadMemberHistory(siteId: string): Promise<MemberMark[]> {
  const res = await memberLibrary(siteId, '/history');
  await requireMemberOk(res);
  return readMarks(await res.json());
}

export async function recordMemberView(siteId: string, contentId: string) {
  const res = await memberLibrary(siteId, `/history/${encodeURIComponent(contentId)}`, { method: 'POST' });
  await requireMemberOk(res);
}

export type MemberShare = {
  id: string;
  contentId: string;
  contentTitle: string;
  audience: string;
  expiresAt: string;
  maxDownloads: number | null;
  downloadCount: number;
  revoked: boolean;
  tokenHint: string;
  availability: string;
};

export type IssuedMemberShare = { share: MemberShare; token: string; url: string };

export async function loadMemberShares(siteId: string): Promise<MemberShare[]> {
  const res = await memberLibrary(siteId, '/shares');
  await requireMemberOk(res);
  return res.json() as Promise<MemberShare[]>;
}

export async function issueMemberShare(siteId: string, contentId: string, audience: string, days: number, maxDownloads: number | null) {
  const res = await memberLibrary(siteId, '/shares', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contentId,
      audience,
      expiresAt: new Date(Date.now() + days * 86400000).toISOString(),
      maxDownloads
    })
  });
  await requireMemberOk(res);
  return res.json() as Promise<IssuedMemberShare>;
}

export async function revokeMemberShare(siteId: string, shareId: string) {
  const res = await memberLibrary(siteId, `/shares/${encodeURIComponent(shareId)}/revoke`, { method: 'POST' });
  await requireMemberOk(res);
}

function readMarks(body: unknown): MemberMark[] {
  if (!Array.isArray(body)) return [];
  return body.map((row) => {
    const item = row as { contentId?: string; at?: string };
    return { contentId: item.contentId ?? '', at: item.at ?? '' };
  }).filter((item) => item.contentId);
}

export type CurrentMember = {
  username: string;
  displayName: string;
  groups: string[];
  groupCodes: string[];
};

/** 当前会话的会员显示名与已绑定会员组。未登录返回 null。 */
export async function loadCurrentMember(): Promise<CurrentMember | null> {
  const res = await fetch('/api/v1/me', { credentials: 'include', cache: 'no-store' });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(await apiError(res));
  const body = await res.json() as {
    username?: string;
    displayName?: string;
    profile?: { displayName_s?: string };
    memberGroups?: { code?: string; name?: string }[];
    sites?: { roles?: string[] }[];
  };
  const profileName = body.profile?.displayName_s?.trim() ?? '';
  const username = body.username?.trim() ?? '';
  const bound = Array.isArray(body.memberGroups)
    ? body.memberGroups
        .map((group) => ({ code: (group.code || '').trim(), name: (group.name || group.code || '').trim() }))
        .filter((group) => group.name)
    : await groupNamesForCodes((body.sites ?? []).flatMap((site) => site.roles ?? []));
  return {
    username,
    displayName: profileName || body.displayName?.trim() || username,
    groups: bound.map((group) => group.name),
    groupCodes: bound.map((group) => group.code).filter((code) => code.length > 0)
  };
}

async function groupNamesForCodes(codes: string[]): Promise<{ code: string; name: string }[]> {
  const siteId = new URLSearchParams(location.search).get('siteId') ?? '';
  if (!siteId || codes.length === 0) return [];
  const res = await fetch(`/api/v1/delivery/sites/${encodeURIComponent(siteId)}/folders`, { cache: 'no-store' });
  if (!res.ok) return [];
  const folders = await res.json() as { grants?: { code?: string; name?: string }[] }[];
  const byCode = new Map<string, string>();
  for (const folder of folders) {
    for (const grant of folder.grants ?? []) {
      const code = grant.code?.trim();
      const name = grant.name?.trim();
      if (code && name) byCode.set(code, name);
    }
  }
  const bound: { code: string; name: string }[] = [];
  for (const code of codes) {
    const name = byCode.get(code);
    if (name && !bound.some((item) => item.code === code)) bound.push({ code, name });
  }
  return bound;
}

/** 站点有效授权是否明确授予匿名角色「查看」。未配置或接口未就绪时视为不允许。 */
export async function loadAnonymousLibrary(siteId: string): Promise<boolean> {
  if (!siteId) return false;
  try {
    const response = await fetch(`/api/v1/delivery/sites/${encodeURIComponent(siteId)}/viewer`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return Boolean(body && typeof body === 'object' && (body as { anonymousView?: boolean }).anonymousView);
  } catch {
    return false;
  }
}

export interface ContentFormOption {
  value: string;
  label: string;
}

export interface ContentFormField {
  code: string;
  name: string;
  fieldType: string;
  required: boolean;
  helpText: string;
  defaultValue: string;
  readOnly: boolean;
  options: ContentFormOption[];
}

export interface ContentFormNode {
  elementType: string;
  title: string;
  field: ContentFormField | null;
  children: ContentFormNode[];
}

export interface ContentForm {
  code: string;
  name: string;
  nodes: ContentFormNode[];
}

/** 已发布内容模型的表单布局。分区、页签和字段都以后端返回为准。 */
export async function loadContentForm(siteId: string, code: string): Promise<ContentForm> {
  const response = await fetch(
    `/api/v1/delivery/sites/${encodeURIComponent(siteId)}/content-forms/${encodeURIComponent(code)}`,
    { headers: { Accept: 'application/json' }, credentials: 'include', cache: 'no-store' }
  );
  if (!response.ok) throw new Error('数字资源表单布局尚未就绪');
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object') throw new Error('数字资源表单布局尚未就绪');
  const row = body as { code?: string; name?: string; nodes?: ContentFormNode[] };
  return {
    code: row.code ?? code,
    name: row.name ?? '',
    nodes: Array.isArray(row.nodes) ? row.nodes : []
  };
}

export async function loadCatalog(siteId: string): Promise<{ source: 'live' | 'seed'; catalog: Catalog }> {
  if (!siteId) return { source: 'seed', catalog: SEED };
  try {
    const [assets, versions, links, folders, legacy] = await Promise.all([
      query(siteId, 'digital_asset'),
      query(siteId, 'asset_version'),
      query(siteId, 'share_link'),
      loadFolderGrants(siteId),
      query(siteId, 'resource_group')
    ]);
    if (!assets) return { source: 'seed', catalog: SEED };
    return {
      source: 'live',
      catalog: {
        assets: assets.map(toAsset),
        versions: (versions ?? []).map(toVersion),
        links: (links ?? []).map(toLink),
        groups: folders ?? (legacy ?? []).map(toGroup)
      }
    };
  } catch {
    return { source: 'seed', catalog: SEED };
  }
}
