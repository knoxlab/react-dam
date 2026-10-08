export type AssetKind = 'image' | 'video' | 'audio' | 'document' | 'pdf' | 'text';
export type Approval = 'draft' | 'pending' | 'approved' | 'rejected';
export type License = 'all-rights' | 'internal' | 'cc-by' | 'cc-by-sa' | 'public-domain';

export interface Asset {
  id: string;
  title: string;
  code: string;
  kind: AssetKind;
  summary: string;
  body: string;
  mime: string;
  bytes: number;
  storageUri: string;
  thumbnail?: string;
  width?: number;
  height?: number;
  tags: string[];
  aiTags: string[];
  owner: string;
  license: License | '';
  copyrightUntil: string;
  department: string;
  group: string;
  folderId: string;
  version: string;
  approval: Approval;
  downloadTtl: number;
  updatedAt: string;
  viewCount?: number;
  /** 内容创建时间，详情页作为发布日期展示。 */
  publishedAt?: string;
  /** 内容字段原文，供图片等字段按类型取回 Knox 资产编号。 */
  values?: Record<string, string>;
}

export interface AssetVersion {
  id: string;
  assetCode: string;
  label: string;
  note: string;
  storageUri: string;
  bytes: number;
  actor: string;
  updatedAt: string;
}

export interface ShareLink {
  id: string;
  title: string;
  assetCode: string;
  tokenHint: string;
  expiresAt: string;
  maxDownloads: number;
  revoked: boolean;
  audience: string;
}

export interface MemberGrant {
  name: string;
  code: string;
  rights: string[];
}

export interface ResourceGroup {
  id: string;
  title: string;
  code: string;
  path: string;
  parentId?: string;
  department: string;
  description: string;
  grants: MemberGrant[];
  /** 有效授权里匿名角色具备「查看」。栏目打破继承后只反映栏目自己的授权。 */
  anonymousView?: boolean;
}

export interface Catalog {
  assets: Asset[];
  versions: AssetVersion[];
  links: ShareLink[];
  groups: ResourceGroup[];
}

export type DataSource = 'loading' | 'live' | 'seed';
