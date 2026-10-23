export type AssetKind = 'image' | 'video' | 'audio' | 'document' | 'other';
export type Approval = 'draft' | 'pending' | 'approved' | 'rejected';
export type License = 'all-rights' | 'internal' | 'cc-by' | 'cc-by-sa' | 'public-domain';

/**
 * 关联媒体：内容类型 `digital_asset.media_items` 重复组的一行，或历史单媒体字段
 * （storage_uri_s/mime_type_s/file_size_i/thumbnail_url_s）的归一化形态。
 * 预览、全屏查看与「媒体列表」页签都按列表下标切换。
 */
export interface MediaItem {
  /** 行内标题（media_title_s）；缺省时前台回退资源标题/文件名。 */
  title?: string;
  /** 媒体引用（media_storage_uri_s）：媒体资产 id、mediaRef JSON 或外部 http(s) 地址。 */
  storageUri: string;
  /** 媒体类型（media_kind_s）；缺省继承资源类型。 */
  kind?: AssetKind;
  mime?: string;
  bytes?: number;
  /** 媒体预览图（media_thumbnail_url_s，IMAGE：媒体资产编号或 URL）。 */
  thumbnail?: string;
}

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
  /**
   * 关联媒体列表（media_items 重复组归一化；老数据没有重复组时由单媒体字段推导）。
   * 至多一个媒体的老资源会得到长度 1 的列表 —— 详情页据此隐藏「媒体列表」页签。
   */
  mediaList: MediaItem[];
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
  /**
   * 当前登录用户在该栏目上的视角权利（服务端按会话计算，含站点/栏目上对个别用户的授权，
   * 与后台判定同口径）。匿名访客为空数组；未登录/老后端缺省。
   */
  viewerRights?: string[];
}

export interface Catalog {
  assets: Asset[];
  versions: AssetVersion[];
  links: ShareLink[];
  groups: ResourceGroup[];
}

export type DataSource = 'loading' | 'live' | 'seed';
