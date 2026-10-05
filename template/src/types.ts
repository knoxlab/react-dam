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
  tags: string[];
  aiTags: string[];
  owner: string;
  license: License | '';
  copyrightUntil: string;
  department: string;
  group: string;
  version: string;
  approval: Approval;
  downloadTtl: number;
  updatedAt: string;
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

export interface ResourceGroup {
  id: string;
  title: string;
  code: string;
  department: string;
  description: string;
  aclRole: string;
  encryptionRequired: boolean;
  backupPolicy: string;
}

export interface Catalog {
  assets: Asset[];
  versions: AssetVersion[];
  links: ShareLink[];
  groups: ResourceGroup[];
}

export type DataSource = 'loading' | 'live' | 'seed';
