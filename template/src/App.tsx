import { useEffect, useMemo, useState } from 'react';
import { loadCatalog, siteIdFromLocation } from './api';
import { SEED } from './seed';
import type { Approval, Asset, AssetKind, Catalog, DataSource, License } from './types';

type View = 'library' | 'groups' | 'approvals' | 'links' | 'api';
type KindFilter = 'all' | 'image' | 'av' | 'docs' | 'text';
type SortKey = 'updated' | 'title' | 'size' | 'kind';

const KIND_LABEL: Record<AssetKind, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  document: '文档',
  pdf: 'PDF',
  text: '文本片段'
};

const LICENSE_LABEL: Record<License, string> = {
  'all-rights': '保留所有权利',
  internal: '内部使用',
  'cc-by': 'CC BY',
  'cc-by-sa': 'CC BY-SA',
  'public-domain': '公有领域'
};

const APPROVAL_LABEL: Record<Approval, string> = {
  draft: '草稿',
  pending: '待审批',
  approved: '已通过',
  rejected: '已驳回'
};

const BACKUP_LABEL: Record<string, string> = {
  'encrypted-hourly': '每小时加密备份',
  'encrypted-daily': '每日加密备份',
  'encrypted-weekly': '每周加密备份'
};

const VIEWS: { id: View; label: string }[] = [
  { id: 'library', label: '资源库' },
  { id: 'groups', label: '资源组' },
  { id: 'approvals', label: '审批' },
  { id: 'links', label: '分发' },
  { id: 'api', label: '接口' }
];

const KINDS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'image', label: '图片' },
  { id: 'av', label: '音视频' },
  { id: 'docs', label: '文档' },
  { id: 'text', label: '文本' }
];

function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatWhen(value: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function copyrightState(until: string): 'none' | 'active' | 'expired' {
  if (!until) return 'none';
  const date = new Date(until);
  if (Number.isNaN(date.getTime())) return 'none';
  return date.getTime() < Date.now() ? 'expired' : 'active';
}

function linkState(revoked: boolean, expiresAt: string): 'revoked' | 'expired' | 'active' {
  if (revoked) return 'revoked';
  const date = new Date(expiresAt);
  if (!Number.isNaN(date.getTime()) && date.getTime() < Date.now()) return 'expired';
  return 'active';
}

function matchesKind(kind: AssetKind, filter: KindFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'image') return kind === 'image';
  if (filter === 'av') return kind === 'video' || kind === 'audio';
  if (filter === 'docs') return kind === 'document' || kind === 'pdf';
  return kind === 'text';
}

function downloadPath(siteId: string, assetId: string): string {
  const site = siteId || '{siteId}';
  const asset = assetId.startsWith('seed-') ? '{assetId}' : assetId;
  return `/api/v1/delivery/sites/${site}/media/${asset}/download?token={签名}`;
}

export function App() {
  const siteId = siteIdFromLocation();
  const [catalog, setCatalog] = useState<Catalog>(SEED);
  const [source, setSource] = useState<DataSource>('loading');
  const [view, setView] = useState<View>('library');
  const [kind, setKind] = useState<KindFilter>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('updated');
  const [department, setDepartment] = useState('all');
  const [license, setLicense] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    let cancelled = false;
    loadCatalog(siteId).then((result) => {
      if (cancelled) return;
      setCatalog(result.catalog);
      setSource(result.source);
    });
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  const departments = useMemo(
    () => Array.from(new Set(catalog.assets.map((asset) => asset.department).filter(Boolean))).sort(),
    [catalog.assets]
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = catalog.assets.filter((asset) => {
      if (!matchesKind(asset.kind, kind)) return false;
      if (department !== 'all' && asset.department !== department) return false;
      if (license !== 'all' && asset.license !== license) return false;
      if (!needle) return true;
      const haystack = [
        asset.title,
        asset.code,
        asset.summary,
        asset.body,
        asset.owner,
        asset.department,
        asset.group,
        ...asset.tags,
        ...asset.aiTags
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
    rows.sort((left, right) => {
      if (sort === 'title') return left.title.localeCompare(right.title, 'zh');
      if (sort === 'size') return right.bytes - left.bytes;
      if (sort === 'kind') return KIND_LABEL[left.kind].localeCompare(KIND_LABEL[right.kind], 'zh');
      return right.updatedAt.localeCompare(left.updatedAt);
    });
    return rows;
  }, [catalog.assets, kind, department, license, query, sort]);

  const selected = catalog.assets.find((asset) => asset.id === selectedId) ?? null;
  const pendingCount = catalog.assets.filter((asset) => asset.approval === 'pending' || asset.approval === 'rejected').length;

  function copy(text: string, key: string) {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(key);
        window.setTimeout(() => setCopied(''), 1600);
      },
      () => setCopied('')
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true">库</span>
          <div>
            <p className="eyebrow">PowerCMS 数字资源</p>
            <h1>数字资源库</h1>
          </div>
        </div>
        <label className="search">
          <span>搜索</span>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setView('library');
            }}
            placeholder="标题、编码、标签、版权方"
            aria-label="搜索资源"
          />
        </label>
        <p className={`source source-${source}`}>
          {source === 'loading' ? '正在读取交付接口' : source === 'live' ? '已发布内容' : '示例数据'}
        </p>
      </header>

      <div className="body">
        <nav className="nav" aria-label="栏目">
          {VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={view === item.id ? 'active' : ''}
              onClick={() => setView(item.id)}
            >
              {item.label}
              {item.id === 'approvals' && pendingCount > 0 ? <em>{pendingCount}</em> : null}
            </button>
          ))}
        </nav>

        <main>
          {source === 'seed' ? (
            <p className="notice">
              当前是站点包自带的示例。导入站点并发布 <code>digital_asset</code> 后，用
              <code>?siteId=</code> 打开即可改为读取交付接口。
            </p>
          ) : null}

          {view === 'library' ? (
            <Library
              assets={visible}
              total={catalog.assets.length}
              kind={kind}
              sort={sort}
              department={department}
              departments={departments}
              license={license}
              onKind={setKind}
              onSort={setSort}
              onDepartment={setDepartment}
              onLicense={setLicense}
              onOpen={setSelectedId}
            />
          ) : null}
          {view === 'groups' ? <Groups catalog={catalog} onOpen={setSelectedId} /> : null}
          {view === 'approvals' ? <Approvals assets={catalog.assets} onOpen={setSelectedId} /> : null}
          {view === 'links' ? <Links catalog={catalog} siteId={siteId} /> : null}
          {view === 'api' ? <ApiPanel siteId={siteId} copied={copied} onCopy={copy} /> : null}
        </main>
      </div>

      {selected ? (
        <Detail
          asset={selected}
          catalog={catalog}
          siteId={siteId}
          copied={copied}
          onCopy={copy}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </div>
  );
}

function Library(props: {
  assets: Asset[];
  total: number;
  kind: KindFilter;
  sort: SortKey;
  department: string;
  departments: string[];
  license: string;
  onKind: (kind: KindFilter) => void;
  onSort: (sort: SortKey) => void;
  onDepartment: (value: string) => void;
  onLicense: (value: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <section>
      <div className="toolbar">
        <div className="chips" role="group" aria-label="资源类型">
          {KINDS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={props.kind === item.id ? 'chip on' : 'chip'}
              onClick={() => props.onKind(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label>
          部门
          <select value={props.department} onChange={(event) => props.onDepartment(event.target.value)} aria-label="按部门筛选">
            <option value="all">全部部门</option>
            {props.departments.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          许可
          <select value={props.license} onChange={(event) => props.onLicense(event.target.value)} aria-label="按许可筛选">
            <option value="all">全部许可</option>
            {Object.entries(LICENSE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          排序
          <select value={props.sort} onChange={(event) => props.onSort(event.target.value as SortKey)} aria-label="排序">
            <option value="updated">最近更新</option>
            <option value="title">标题</option>
            <option value="size">文件大小</option>
            <option value="kind">类型</option>
          </select>
        </label>
      </div>
      <p className="count">显示 {props.assets.length} / {props.total}</p>
      {props.assets.length === 0 ? <p className="empty">没有符合条件的资源。</p> : null}
      <ul className="grid">
        {props.assets.map((asset) => {
          const rights = copyrightState(asset.copyrightUntil);
          return (
            <li key={asset.id}>
              <button type="button" className="card" onClick={() => props.onOpen(asset.id)}>
                <span className={`glyph kind-${asset.kind}`}>{KIND_LABEL[asset.kind]}</span>
                <strong>{asset.title}</strong>
                <small>{asset.code} · {asset.version || '未标版本'} · {formatBytes(asset.bytes)}</small>
                <p>{asset.summary}</p>
                <span className="meta">
                  {asset.department} / {asset.group}
                  <i className={`state state-${asset.approval}`}>{APPROVAL_LABEL[asset.approval]}</i>
                  {rights === 'expired' ? <i className="state state-rejected">版权已到期</i> : null}
                </span>
                <span className="tags">
                  {asset.aiTags.slice(0, 2).map((tag) => <em key={tag}>AI {tag}</em>)}
                  {asset.tags.slice(0, 2).map((tag) => <em key={tag} className="manual">{tag}</em>)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Groups(props: { catalog: Catalog; onOpen: (id: string) => void }) {
  return (
    <section>
      <h2>部门资源组</h2>
      <p className="lead">每个资源组对应一个部门角色。读取和下载由服务端对象级授权判定，前台不代替这层隔离。</p>
      <ul className="groups">
        {props.catalog.groups.map((group) => {
          const assets = props.catalog.assets.filter((asset) => asset.group === group.code || asset.group === group.title);
          return (
            <li key={group.id} className="group">
              <header>
                <h3>{group.title}</h3>
                <span>{group.department}</span>
              </header>
              <p>{group.description}</p>
              <dl>
                <div><dt>授权角色</dt><dd>{group.aclRole}</dd></div>
                <div><dt>备份</dt><dd>{BACKUP_LABEL[group.backupPolicy] || group.backupPolicy || '未设置'}</dd></div>
                <div><dt>加密</dt><dd>{group.encryptionRequired ? '要求加密备份' : '未要求加密'}</dd></div>
              </dl>
              <ul>
                {assets.map((asset) => (
                  <li key={asset.id}>
                    <button type="button" onClick={() => props.onOpen(asset.id)}>{asset.title}</button>
                  </li>
                ))}
                {assets.length === 0 ? <li>本组还没有资源。</li> : null}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Approvals(props: { assets: Asset[]; onOpen: (id: string) => void }) {
  const rows = props.assets.filter((asset) => asset.approval !== 'approved');
  return (
    <section>
      <h2>审批</h2>
      <p className="lead">状态与站点包中的审批流一致：草稿、待审批、已通过、已驳回。通过与驳回在管理端办理。</p>
      {rows.length === 0 ? <p className="empty">没有待处理的资源。</p> : null}
      <table>
        <thead>
          <tr><th>资源</th><th>部门</th><th>版本</th><th>状态</th></tr>
        </thead>
        <tbody>
          {rows.map((asset) => (
            <tr key={asset.id}>
              <td><button type="button" className="linkish" onClick={() => props.onOpen(asset.id)}>{asset.title}</button></td>
              <td>{asset.department}</td>
              <td>{asset.version || '—'}</td>
              <td><i className={`state state-${asset.approval}`}>{APPROVAL_LABEL[asset.approval]}</i></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Links(props: { catalog: Catalog; siteId: string }) {
  return (
    <section>
      <h2>分发链接</h2>
      <p className="lead">
        链接记录受众、失效时间和吊销状态。下载地址由服务端签发短期签名，默认有效期取资源上的下载秒数。完整令牌不会出现在目录里。
      </p>
      <table>
        <thead>
          <tr><th>名称</th><th>资源</th><th>使用方</th><th>失效</th><th>状态</th><th>尾号</th></tr>
        </thead>
        <tbody>
          {props.catalog.links.map((link) => {
            const state = linkState(link.revoked, link.expiresAt);
            const asset = props.catalog.assets.find((item) => item.code === link.assetCode);
            const label = state === 'revoked' ? '已吊销' : state === 'expired' ? '已失效' : '有效';
            return (
              <tr key={link.id}>
                <td>{link.title}</td>
                <td>{asset?.title || link.assetCode}</td>
                <td>{link.audience}</td>
                <td>{formatWhen(link.expiresAt)}{link.maxDownloads ? ` · 最多 ${link.maxDownloads} 次` : ''}</td>
                <td><i className={`state state-${state === 'active' ? 'approved' : 'rejected'}`}>{label}</i></td>
                <td>{link.tokenHint || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="lead">签名下载：<code>{downloadPath(props.siteId, '{assetId}')}</code></p>
    </section>
  );
}

function ApiPanel(props: {
  siteId: string;
  copied: string;
  onCopy: (text: string, key: string) => void;
}) {
  const site = props.siteId || '{siteId}';
  const query =
    `GET /api/v1/delivery/sites/${site}/contents/query?contentType=digital_asset&limit=50&orderBy=updatedAt&status=PUBLISHED`;
  const download = `GET ${downloadPath(props.siteId, '{assetId}')}`;
  const tags = `POST /api/v1/ai/suggest/tags?siteId=${site}`;
  return (
    <section>
      <h2>接口复用</h2>
      <p className="lead">官网、经销商门户和其他应用读取同一批已发布资源。单次查询最多 50 条。</p>
      <Snippet label="查询已发布资源" value={query} copied={props.copied === 'query'} onCopy={() => props.onCopy(query, 'query')} />
      <Snippet label="签名下载" value={download} copied={props.copied === 'download'} onCopy={() => props.onCopy(download, 'download')} />
      <Snippet label="AI 打标" value={tags} copied={props.copied === 'tags'} onCopy={() => props.onCopy(tags, 'tags')} />
      <p className="lead">AI 打标在管理端调用，候选写入 <code>ai_tags_ss</code>，与人工标签 <code>tags_ss</code> 分开。</p>
    </section>
  );
}

function Snippet(props: { label: string; value: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="snippet">
      <div>
        <strong>{props.label}</strong>
        <button type="button" onClick={props.onCopy}>{props.copied ? '已复制' : '复制'}</button>
      </div>
      <code>{props.value}</code>
    </div>
  );
}

function Detail(props: {
  asset: Asset;
  catalog: Catalog;
  siteId: string;
  copied: string;
  onCopy: (text: string, key: string) => void;
  onClose: () => void;
}) {
  const versions = props.catalog.versions
    .filter((item) => item.assetCode === props.asset.code)
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const rights = copyrightState(props.asset.copyrightUntil);
  const path = downloadPath(props.siteId, props.asset.id);
  return (
    <aside className="drawer" role="dialog" aria-label={props.asset.title}>
      <header>
        <p className={`glyph kind-${props.asset.kind}`}>{KIND_LABEL[props.asset.kind]}</p>
        <h2>{props.asset.title}</h2>
        <button type="button" onClick={props.onClose}>关闭</button>
      </header>
      <p>{props.asset.summary}</p>
      {props.asset.body ? <pre className="excerpt">{props.asset.body}</pre> : null}
      <dl>
        <div><dt>编码</dt><dd>{props.asset.code}</dd></div>
        <div><dt>MIME</dt><dd>{props.asset.mime || '—'}</dd></div>
        <div><dt>大小</dt><dd>{formatBytes(props.asset.bytes)}</dd></div>
        <div><dt>部门</dt><dd>{props.asset.department}</dd></div>
        <div><dt>资源组</dt><dd>{props.asset.group}</dd></div>
        <div><dt>审批</dt><dd>{APPROVAL_LABEL[props.asset.approval]}</dd></div>
        <div><dt>版权方</dt><dd>{props.asset.owner || '—'}</dd></div>
        <div><dt>许可</dt><dd>{props.asset.license ? LICENSE_LABEL[props.asset.license] : '—'}</dd></div>
        <div>
          <dt>版权到期</dt>
          <dd>
            {props.asset.copyrightUntil ? formatWhen(props.asset.copyrightUntil) : '未登记'}
            {rights === 'expired' ? '（已到期）' : ''}
          </dd>
        </div>
        <div><dt>下载有效期</dt><dd>{props.asset.downloadTtl} 秒</dd></div>
        <div><dt>更新</dt><dd>{formatWhen(props.asset.updatedAt)}</dd></div>
      </dl>
      <h3>标签</h3>
      <p className="tags">
        {props.asset.aiTags.map((tag) => <em key={tag}>AI {tag}</em>)}
        {props.asset.tags.map((tag) => <em key={tag} className="manual">{tag}</em>)}
        {props.asset.tags.length + props.asset.aiTags.length === 0 ? '没有标签' : null}
      </p>
      <h3>版本回溯</h3>
      {versions.length === 0 ? <p>还没有业务版本记录。条目级历史可在管理端按内容版本恢复。</p> : (
        <ol className="versions">
          {versions.map((item) => (
            <li key={item.id}>
              <strong>{item.label}</strong>
              <span>{item.note}</span>
              <small>{item.actor || '未知提交人'} · {formatWhen(item.updatedAt)} · {formatBytes(item.bytes)}</small>
            </li>
          ))}
        </ol>
      )}
      <h3>下载</h3>
      <Snippet
        label="签名地址"
        value={path}
        copied={props.copied === props.asset.id}
        onCopy={() => props.onCopy(path, props.asset.id)}
      />
    </aside>
  );
}
