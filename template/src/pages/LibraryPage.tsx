import { useEffect, useMemo, useRef, useState } from 'react';
import { AccountBar, folderTree, toggleFavorite, uploadFolders, useMemberStore, viewFolders } from '../account';
import { approvalLabel, fileExt, formatBytes, formatWhen, kindLabel } from '../format';
import type { Asset, AssetKind, Catalog, DataSource, ResourceGroup } from '../types';
import { Page, SearchIcon, Star, Thumb, UploadIcon } from '../ui';

const KINDS: { id: 'all' | AssetKind; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'image', label: '图片' },
  { id: 'audio', label: '音频' },
  { id: 'video', label: '视频' },
  { id: 'document', label: '文档' },
  { id: 'pdf', label: 'PDF' },
  { id: 'text', label: '文本片段' }
];

const PAGE_SIZE = 8;

export function LibraryPage(props: {
  catalog: Catalog;
  source: DataSource;
  siteId: string;
  folders: string[];
  onFolders: (ids: string[]) => void;
  onOpen: (id: string) => void;
  onUpload: () => void;
  onToast: (message: string) => void;
}) {
  const [kind, setKind] = useState<'all' | AssetKind>('all');
  const [query, setQuery] = useState('');
  const [department, setDepartment] = useState('all');
  const [owner, setOwner] = useState('all');
  const [sort, setSort] = useState<'updated' | 'title' | 'size'>('updated');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [page, setPage] = useState(1);
  const memberCodes = useMemberStore().member.groupCodes;
  const visibleFolders = useMemo(
    () => viewFolders(props.catalog.groups, memberCodes),
    [props.catalog.groups, memberCodes]
  );
  const selectedFolders = useMemo(
    () => props.folders.filter((id) => visibleFolders.some((group) => group.id === id)),
    [props.folders, visibleFolders]
  );
  const canUpload = uploadFolders(props.catalog.groups, memberCodes).length > 0;
  useEffect(() => { setPage(1); }, [props.folders]);

  const departments = useMemo(
    () => Array.from(new Set(props.catalog.assets.map((asset) => asset.department).filter(Boolean))).sort(),
    [props.catalog.assets]
  );
  const owners = useMemo(
    () => Array.from(new Set(props.catalog.assets.map((asset) => asset.owner).filter(Boolean))).sort(),
    [props.catalog.assets]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = props.catalog.assets.filter((asset) => {
      if (kind !== 'all' && asset.kind !== kind) return false;
      if (selectedFolders.length > 0) {
        const columns = selectedFolders
          .map((id) => props.catalog.groups.find((group) => group.id === id))
          .filter((group): group is ResourceGroup => Boolean(group));
        if (!columns.some((column) => assetInFolder(asset, column))) return false;
      }
      if (department !== 'all' && asset.department !== department) return false;
      if (owner !== 'all' && asset.owner !== owner) return false;
      if (!needle) return true;
      const hay = [asset.title, asset.code, asset.summary, asset.owner, ...asset.tags, ...asset.aiTags]
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
    rows.sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, 'zh');
      if (sort === 'size') return b.bytes - a.bytes;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
    return rows;
  }, [props.catalog.assets, props.catalog.groups, kind, query, selectedFolders, department, owner, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const slice = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const bytes = props.catalog.assets.reduce((sum, asset) => sum + asset.bytes, 0);
  const pendingTags = props.catalog.assets.reduce((sum, asset) => sum + asset.aiTags.length, 0);
  const chips = [
    ...selectedFolders.map((id) => ({
      key: `folder:${id}`,
      label: props.catalog.groups.find((group) => group.id === id)?.title || '栏目'
    })),
    department !== 'all' ? { key: 'department', label: department } : null,
    owner !== 'all' ? { key: 'owner', label: owner } : null,
    kind !== 'all' ? { key: 'kind', label: kindLabel(kind) } : null
  ].filter(Boolean) as { key: string; label: string }[];

  function resetPage() {
    setPage(1);
  }

  return (
    <Page>
      <header className="topbar">
        <div className="topbar-left">
          <span className="crumb">资源管理&nbsp;&nbsp;/&nbsp;&nbsp;资源库</span>
        </div>
        <div className="search">
          <SearchIcon />
          <input
            value={query}
            placeholder="搜索资源名称、标签、描述、AI 识别内容…"
            onChange={(event) => {
              setQuery(event.target.value);
              resetPage();
            }}
          />
        </div>
        <div className="topbar-right">
          {canUpload ? (
            <button className="btn btn-primary" type="button" onClick={props.onUpload}>
              <UploadIcon />
              上传资源
            </button>
          ) : null}
          <AccountBar />
        </div>
      </header>
      <div className="page-body">
        <div className="head-row">
          <div className="grow">
            <h1 className="page-title">资源库</h1>
            <p className="page-sub">
              共 {props.catalog.assets.length} 个资源 · 覆盖图片 / 音频 / 视频 / 文档 / PDF / 文本片段
              <span className={`badge source-pill ${props.source === 'live' ? 'badge-success' : 'badge-neutral'}`}>
                {props.source === 'loading' ? '正在读取' : props.source === 'live' ? '已发布内容' : '示例数据'}
              </span>
            </p>
          </div>
          <div className="head-actions">
            <button className="btn btn-ghost" type="button" onClick={() => props.onToast('请在管理端对选中资源执行批量发布或归档')}>
              批量操作
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => props.onToast(`当前列表 ${filtered.length} 条，可从交付接口导出`)}
            >
              导出清单
            </button>
            <div className="seg">
              <button className={`seg-btn ${view === 'grid' ? 'is-on' : ''}`} type="button" title="网格视图" onClick={() => setView('grid')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" fill={view === 'grid' ? '#1A73E8' : '#9AA0A6'} />
                  <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" fill={view === 'grid' ? '#1A73E8' : '#9AA0A6'} />
                  <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" fill={view === 'grid' ? '#1A73E8' : '#9AA0A6'} />
                  <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" fill={view === 'grid' ? '#1A73E8' : '#9AA0A6'} />
                </svg>
              </button>
              <button className={`seg-btn ${view === 'list' ? 'is-on' : ''}`} type="button" title="列表视图" onClick={() => setView('list')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M4 8h16M4 12h16M4 16h16" stroke={view === 'list' ? '#1A73E8' : '#9AA0A6'} strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="stat-grid">
          <div className="stat">
            <span className="stat-label">资源总量</span>
            <span className="stat-value num">{props.catalog.assets.length}</span>
            <span className="stat-delta" style={{ color: 'var(--success-text)' }}>
              {props.source === 'live' ? '来自已发布内容' : '站点包示例'}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">占用存储</span>
            <span className="stat-value num">{formatBytes(bytes)}</span>
            <span className="stat-delta" style={{ color: 'var(--text-2)' }}>按资源目录中的文件大小合计</span>
          </div>
          <div className="stat">
            <span className="stat-label">AI 待审标签</span>
            <span className="stat-value num">{pendingTags}</span>
            <span className="stat-delta" style={{ color: 'var(--primary)' }}>确认前不计入正式标签</span>
          </div>
          <div className="stat">
            <span className="stat-label">栏目</span>
            <span className="stat-value num">{props.catalog.groups.length}</span>
            <span className="stat-delta" style={{ color: 'var(--text-2)' }}>分享在「我的分享」里查看</span>
          </div>
        </div>

        <div className="card filter">
          <div className="filter-row">
            <span className="filter-label">类型</span>
            {KINDS.map((item) => (
              <button
                key={item.id}
                className={`type-pill ${kind === item.id ? 'active' : ''}`}
                type="button"
                onClick={() => {
                  setKind(item.id);
                  resetPage();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="filter-row">
            <FolderPicker
              folders={visibleFolders}
              selected={selectedFolders}
              onChange={(ids) => { props.onFolders(ids); resetPage(); }}
            />
            <select className="select" value={department} onChange={(event) => { setDepartment(event.target.value); resetPage(); }}>
              <option value="all">全部部门</option>
              {departments.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <select className="select" value={owner} onChange={(event) => { setOwner(event.target.value); resetPage(); }}>
              <option value="all">全部成员</option>
              {owners.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <select className="select wide is-sort" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
              <option value="updated">最近更新</option>
              <option value="title">标题</option>
              <option value="size">文件大小</option>
            </select>
            <button
              className="btn-text"
              type="button"
              onClick={() => {
                setKind('all');
                props.onFolders([]);
                setDepartment('all');
                setOwner('all');
                setQuery('');
                setSort('updated');
                resetPage();
              }}
            >
              重置筛选
            </button>
          </div>
          {chips.length > 0 ? (
            <div className="filter-row">
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>已选条件</span>
              {chips.map((chip) => (
                <span className="chip" key={chip.key}>
                  {chip.label}
                  <button
                    type="button"
                    aria-label={`移除 ${chip.label}`}
                    onClick={() => {
                      if (chip.key.startsWith('folder:')) props.onFolders(selectedFolders.filter((id) => `folder:${id}` !== chip.key));
                      if (chip.key === 'department') setDepartment('all');
                      if (chip.key === 'owner') setOwner('all');
                      if (chip.key === 'kind') setKind('all');
                      resetPage();
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                      <path d="M6 6l12 12M18 6L6 18" stroke="#5F6368" strokeWidth="2.4" strokeLinecap="round" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {props.source === 'loading' ? (
          <div className="card card-pad">
            <div className="skeleton-row"><i className="skeleton-block" /><i className="skeleton-line" /></div>
            <div className="skeleton-row"><i className="skeleton-block" /><i className="skeleton-line" /></div>
            <div className="skeleton-row"><i className="skeleton-block" /><i className="skeleton-line" /></div>
          </div>
        ) : slice.length === 0 ? (
          <div className="state-card">
            <span className="state-title">{props.catalog.assets.length === 0 ? '空状态' : '筛选无结果'}</span>
            <span className="state-desc">
              {props.catalog.assets.length === 0
                ? '当前没有可以查看的资源。没有查看权的栏目和内容不会出现在这里。'
                : '没有符合当前条件的资源，可重置筛选后再看。'}
            </span>
            {props.catalog.assets.length === 0 && canUpload ? (
              <button className="btn btn-primary" type="button" onClick={props.onUpload}>
                <UploadIcon />
                上传资源
              </button>
            ) : props.catalog.assets.length === 0 ? null : (
              <button className="btn btn-outline" type="button" onClick={() => { setKind('all'); props.onFolders([]); setDepartment('all'); setOwner('all'); setQuery(''); }}>
                重置筛选
              </button>
            )}
          </div>
        ) : (
          <div className={`asset-grid ${view === 'list' ? 'is-list' : ''}`}>
            {slice.map((asset) => (
              <AssetCard key={asset.id} asset={asset} siteId={props.siteId} onOpen={props.onOpen} onToast={props.onToast} />
            ))}
          </div>
        )}

        <div className="pager">
          <span>
            显示第 {filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}–{(safePage - 1) * PAGE_SIZE + slice.length} 条，共 {filtered.length} 条
          </span>
          <div className="pager-pages">
            <button className="page-btn" type="button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>‹</button>
            {Array.from({ length: pageCount }, (_, index) => index + 1).slice(0, 6).map((number) => (
              <button key={number} className={`page-btn num ${number === safePage ? 'active' : ''}`} type="button" onClick={() => setPage(number)}>
                {number}
              </button>
            ))}
            <button className="page-btn" type="button" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>›</button>
          </div>
        </div>
      </div>
    </Page>
  );
}

function AssetCard(props: { asset: Asset; siteId: string; onOpen: (id: string) => void; onToast: (message: string) => void }) {
  const asset = props.asset;
  const pending = asset.aiTags.length > 0 && asset.approval === 'pending';
  const saved = useMemberStore().favorites.includes(asset.id);
  return (
    <article
      className="asset-card"
      role="button"
      tabIndex={0}
      onClick={() => props.onOpen(asset.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          props.onOpen(asset.id);
        }
      }}
    >
      <Thumb kind={asset.kind} ext={fileExt(asset.mime, asset.kind)} flag={pending ? 'AI 待审' : undefined} />
      <div className="asset-info">
        {pending ? <div className="note-box note-warn">AI 建议 {asset.aiTags.length} 个标签待确认</div> : null}
        <span className="asset-name">{asset.title}</span>
        <span className="asset-meta">
          {formatBytes(asset.bytes)} · {asset.department || '未分部门'} · {formatWhen(asset.updatedAt)}
        </span>
        <div className="asset-foot">
          <button
            className={`asset-star ${saved ? '' : 'is-off'}`}
            type="button"
            title={saved ? '取消收藏' : '收藏'}
            aria-label={saved ? '取消收藏' : '收藏'}
            onClick={(event) => {
              event.stopPropagation();
              void toggleFavorite(props.siteId, asset.id).catch((reason: unknown) => {
                props.onToast(reason instanceof Error ? reason.message : '收藏失败');
              });
            }}
          >
            <Star />
          </button>
          <span className="asset-score">
            {asset.version || 'v1'} · {approvalLabel(asset.approval)} · {asset.tags.length} 个标签
          </span>
        </div>
      </div>
    </article>
  );
}

function FolderPicker(props: { folders: ResourceGroup[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const nodes = useMemo(() => folderTree(props.folders), [props.folders]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const label = props.selected.length === 0
    ? '全部栏目'
    : props.selected.length === 1
      ? (props.folders.find((group) => group.id === props.selected[0])?.title || '栏目')
      : `已选 ${props.selected.length} 个栏目`;

  function toggle(id: string) {
    props.onChange(props.selected.includes(id)
      ? props.selected.filter((item) => item !== id)
      : [...props.selected, id]);
  }

  return (
    <div className={`folder-picker ${open ? 'is-open' : ''}`} ref={root}>
      <button
        className="select folder-picker-btn"
        type="button"
        aria-label="栏目"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((value) => !value)}
      >
        <span>{label}</span>
      </button>
      {open ? (
        <div className="folder-picker-menu" role="listbox" aria-multiselectable="true">
          <label className="folder-picker-item">
            <input
              type="checkbox"
              checked={props.selected.length === 0}
              onChange={() => { if (props.selected.length > 0) props.onChange([]); }}
            />
            <span>全部栏目</span>
          </label>
          {nodes.length === 0 ? (
            <span className="folder-empty">当前没有可查看的栏目</span>
          ) : nodes.map((node) => (
            <label key={node.group.id} className="folder-picker-item" style={{ paddingLeft: 10 + node.depth * 16 }}>
              <input
                type="checkbox"
                checked={props.selected.includes(node.group.id)}
                onChange={() => toggle(node.group.id)}
              />
              <span>{node.group.title}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function assetInFolder(asset: Asset, column: ResourceGroup): boolean {
  if (asset.folderId && asset.folderId === column.id) return true;
  return asset.group === column.title || asset.group === column.code || asset.group === column.path;
}
