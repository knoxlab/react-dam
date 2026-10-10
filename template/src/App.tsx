import { useEffect, useMemo, useRef, useState } from 'react';
import { isSignedIn, MemberPage, MemberShell, folderTree, noticeKind, rememberReturn, rememberView, uploadFolders, useMemberStore, viewFolders, type MemberNav, type NoticeKind } from './account';
import { analyticsRoute, trackPageView } from './analytics';
import { loadAnonymousLibrary, loadCatalog, siteIdFromLocation } from './api';
import { formatBytes } from './format';
import { AskPage } from './pages/AskPage';
import { DetailPage } from './pages/DetailPage';
import { LibraryPage } from './pages/LibraryPage';
import { UploadPage } from './pages/UploadPage';
import { SEED } from './seed';
import type { Catalog, DataSource } from './types';
import { BrandMark, NavGlyph } from './ui';

type NavId = 'library' | 'upload' | 'detail' | 'ask' | MemberNav;

const NAV: { group: string; items: { id: NavId; label: string }[] }[] = [
  {
    group: '资源管理',
    items: [
      { id: 'library', label: '资源库' },
      { id: 'upload', label: '上传中心' },
      { id: 'detail', label: '资源详情' }
    ]
  },
  {
    group: '知识库',
    items: [{ id: 'ask', label: '知识问答' }]
  }
];

const PAGES: NavId[] = ['library', 'upload', 'detail', 'ask', 'account', 'password', 'uploads', 'shares', 'favorites', 'history', 'inbox', 'login', 'register'];

function isPublicPage(id: string) {
  return id === 'login' || id === 'register';
}

function guestMayBrowse(page: string, anonymousLibrary: boolean) {
  return anonymousLibrary && (page === 'library' || page === 'detail');
}

function hashPage(token: string): { page: NavId; assetId: string; inbox: NoticeKind } {
  const raw = token.replace(/^#/, '');
  if (raw === 'logs') return { page: 'shares', assetId: '', inbox: 'message' };
  const slash = raw.indexOf('/');
  const head = slash < 0 ? raw : raw.slice(0, slash);
  let tail = slash < 0 ? '' : raw.slice(slash + 1);
  try {
    tail = decodeURIComponent(tail);
  } catch {
    /* 地址里的资源编号保持原样 */
  }
  const page = PAGES.includes(head as NavId) ? (head as NavId) : 'library';
  return { page, assetId: page === 'detail' ? tail : '', inbox: page === 'inbox' ? noticeKind(tail) : 'message' };
}

function returnToken(page: NavId, assetId: string, inbox: NoticeKind = 'message') {
  if (page === 'detail' && assetId) return `detail/${encodeURIComponent(assetId)}`;
  if (page === 'inbox') return `inbox/${inbox}`;
  return page;
}

/** 导航外页面（成员页/登录注册）的统计标题；不在表里的用路由名兜底。 */
const EXTRA_LABELS: Partial<Record<NavId, string>> = {
  account: '个人中心',
  password: '修改密码',
  uploads: '我的上传',
  shares: '分享链接',
  favorites: '收藏夹',
  history: '浏览历史',
  inbox: '消息通知',
  login: '登录',
  register: '注册'
};

/** 导航项中文名，用作统计事件的页面标题；成员页等不在导航里的用路由名兜底。 */
function navLabel(id: NavId) {
  for (const group of NAV) {
    const item = group.items.find((entry) => entry.id === id);
    if (item) return item.label;
  }
  return EXTRA_LABELS[id] ?? id;
}

function applyAddress(siteId: string, hash: string) {
  const url = new URL(window.location.href);
  if (siteId && !url.searchParams.get('siteId')) url.searchParams.set('siteId', siteId);
  url.hash = hash.replace(/^#/, '');
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current !== next) history.replaceState(null, '', next);
}

function startNav(): NavId {
  const next = hashPage(location.hash);
  if (!isSignedIn() && !isPublicPage(next.page) && next.page !== 'library' && next.page !== 'detail') {
    rememberReturn(returnToken(next.page, next.assetId, next.inbox));
    return 'login';
  }
  return next.page;
}

export function App() {
  const siteId = siteIdFromLocation();
  const opened = hashPage(location.hash);
  const [nav, setNav] = useState<NavId>(startNav);
  const [catalog, setCatalog] = useState<Catalog>(SEED);
  const [source, setSource] = useState<DataSource>('loading');
  const [selectedId, setSelectedId] = useState<string | null>(opened.assetId || null);
  const [inbox, setInbox] = useState<NoticeKind>(opened.inbox);
  const [libraryFolders, setLibraryFolders] = useState<string[]>([]);
  const [anonymousLibrary, setAnonymousLibrary] = useState(false);
  const [accessReady, setAccessReady] = useState(!siteId);
  const [drawer, setDrawer] = useState(false);
  const [toast, setToast] = useState('');
  const member = useMemberStore().member;

  useEffect(() => {
    let cancelled = false;
    loadCatalog(siteId).then((result) => {
      if (cancelled) return;
      setCatalog(result.catalog);
      setSource(result.source);
      setSelectedId((current) => current || result.catalog.assets[0]?.id || null);
    });
    return () => {
      cancelled = true;
    };
  }, [siteId, member.signedIn]);

  useEffect(() => {
    if (!siteId) {
      setAnonymousLibrary(false);
      setAccessReady(true);
      return;
    }
    let cancelled = false;
    setAccessReady(false);
    loadAnonymousLibrary(siteId).then((allowed) => {
      if (cancelled) return;
      setAnonymousLibrary(allowed);
      setAccessReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  useEffect(() => {
    if (location.hash.replace(/^#/, '') === 'logs' && isSignedIn()) applyAddress(siteId, '#shares');
  }, [siteId]);

  useEffect(() => {
    const next = hashPage(location.hash);
    if (next.page === 'detail' && next.assetId) applyAddress(siteId, `#detail/${encodeURIComponent(next.assetId)}`);
  }, [siteId]);

  useEffect(() => {
    if (!accessReady || isSignedIn()) return;
    if (isPublicPage(nav) || guestMayBrowse(nav, anonymousLibrary)) return;
    const located = hashPage(location.hash);
    rememberReturn(returnToken(located.page === 'library' || located.page === 'detail' ? located.page : nav, located.assetId || selectedId || '', located.page === 'inbox' ? located.inbox : inbox));
    setNav('login');
    applyAddress(siteId, '#login');
  }, [accessReady, anonymousLibrary, nav, selectedId, siteId]);

  useEffect(() => {
    const onHash = () => {
      const next = hashPage(location.hash);
      if (next.assetId) setSelectedId(next.assetId);
      if (next.page === 'inbox') setInbox(next.inbox);
      if (!isSignedIn() && !isPublicPage(next.page) && !(accessReady && guestMayBrowse(next.page, anonymousLibrary))) {
        if (next.page !== 'library' && next.page !== 'detail') {
          rememberReturn(returnToken(next.page, next.assetId, next.inbox));
          setNav('login');
          applyAddress(siteId, '#login');
          return;
        }
        if (accessReady) {
          rememberReturn(returnToken(next.page, next.assetId, next.inbox));
          setNav('login');
          applyAddress(siteId, '#login');
          return;
        }
      }
      setNav(next.page);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [accessReady, anonymousLibrary, siteId]);

  // 统计采集：hash 脚本只能按 pathname 去重，SPA 内页浏览在这里按路由上报
  // （进入后台统计分析的 PV/UV、urls/rank、时段分布等）。资源详情页由 DetailPage
  // 在资源真正渲染时按资源维度上报（携带 contentId/mediaAssetId），这里跳过避免重复计数；
  // 同一路由重复生效（如目录加载回填选中项）用 ref 去重，避免首屏重复计数。
  const lastTrackedRoute = useRef<string | null>(null);
  useEffect(() => {
    if (!siteId || nav === 'detail') return;
    const route = analyticsRoute(returnToken(nav, selectedId || ''));
    if (lastTrackedRoute.current === route) return;
    lastTrackedRoute.current = route;
    trackPageView(route, `数字资产中心 · ${navLabel(nav)}`);
  }, [siteId, nav, selectedId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function go(id: string) {
    const requested = hashPage(id);
    const assetId = requested.page === 'detail' ? (requested.assetId || selectedId || '') : '';
    const guestOk = isPublicPage(requested.page) || guestMayBrowse(requested.page, anonymousLibrary);
    const target: NavId = !isSignedIn() && !guestOk ? 'login' : requested.page;
    if (target === 'login' && !isPublicPage(requested.page)) rememberReturn(returnToken(requested.page, assetId, requested.inbox));
    if (requested.page === 'detail' && assetId) setSelectedId(assetId);
    if (requested.page === 'inbox') setInbox(requested.inbox);
    setNav(target);
    const hash = target === 'detail' && assetId
      ? `#detail/${encodeURIComponent(assetId)}`
      : target === 'inbox'
        ? `#inbox/${requested.inbox}`
        : `#${target}`;
    applyAddress(siteId, hash);
    setDrawer(false);
    const main = document.querySelector('.main');
    if (main) main.scrollTop = 0;
  }

  function openAsset(id: string) {
    rememberView(siteId, id);
    setSelectedId(id);
    go(`detail/${encodeURIComponent(id)}`);
  }

  function adopt(id: string) {
    setCatalog((current) => ({
      ...current,
      assets: current.assets.map((asset) => (
        asset.id === id
          ? { ...asset, tags: Array.from(new Set([...asset.tags, ...asset.aiTags])), aiTags: [] }
          : asset
      ))
    }));
  }

  const allowedUpload = useMemo(
    () => uploadFolders(catalog.groups, member.groupCodes),
    [catalog.groups, member.groupCodes]
  );
  const folderNodes = useMemo(
    () => folderTree(viewFolders(catalog.groups, member.groupCodes)),
    [catalog.groups, member.groupCodes]
  );
  const guestHold = Boolean(siteId) && !member.signedIn && !accessReady && !isPublicPage(nav);
  const guestBlocked = !member.signedIn && accessReady && !isPublicPage(nav) && !guestMayBrowse(nav, anonymousLibrary);
  const shown: NavId | 'hold' = guestHold ? 'hold' : guestBlocked ? 'login' : nav;
  const selected = catalog.assets.find((asset) => asset.id === selectedId) || null;
  const used = useMemo(() => catalog.assets.reduce((sum, asset) => sum + asset.bytes, 0), [catalog.assets]);
  const quota = used > 2 * 1024 ** 3 ? 2 * 1024 ** 4 : 2 * 1024 ** 3;
  const percent = used <= 0 ? 0 : Math.min(100, Math.max(6, Math.round((used / quota) * 100)));

  return (
    <MemberShell go={go} toast={setToast}>
    <div className="app">
      <aside className={`sidebar ${drawer ? 'is-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><BrandMark /></div>
          <div className="brand-text">
            <span className="brand-name">数字资产中心</span>
            <span className="brand-sub">PowerCMS 资源云</span>
          </div>
        </div>
        {NAV.map((group) => (
          <div key={group.group} style={{ display: 'contents' }}>
            <div className="nav-group">{group.group}</div>
            {group.items.filter((item) => item.id !== 'upload' || allowedUpload.length > 0).map((item) => (
              <div key={item.id} style={{ display: 'contents' }}>
                <button
                  className={`nav-item ${nav === item.id ? 'active' : ''}`}
                  type="button"
                  onClick={() => {
                    if (item.id === 'library') setLibraryFolders([]);
                    go(item.id);
                  }}
                >
                  <NavGlyph name={item.id} />
                  <span>{item.label}</span>
                </button>
                {item.id === 'library' && nav === 'library' ? (
                  <div className="folder-tree">
                    <button
                      className={libraryFolders.length === 0 ? 'is-on' : ''}
                      type="button"
                      onClick={() => { setLibraryFolders([]); go('library'); }}
                    >
                      全部栏目
                    </button>
                    {folderNodes.length === 0 ? (
                      <span className="folder-empty">当前没有可查看的栏目</span>
                    ) : folderNodes.map((node) => (
                      <button
                        key={node.group.id}
                        className={libraryFolders.includes(node.group.id) ? 'is-on' : ''}
                        type="button"
                        style={{ paddingLeft: 12 + node.depth * 14 }}
                        onClick={() => {
                          setLibraryFolders((current) => (
                            current.includes(node.group.id)
                              ? current.filter((id) => id !== node.group.id)
                              : [...current, node.group.id]
                          ));
                          go('library');
                        }}
                      >
                        {node.group.title}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ))}
        <div className="nav-spacer" />
        <div className="storage-card">
          <span className="storage-label">目录存储用量</span>
          <span className="storage-value num">{formatBytes(used)} / {formatBytes(quota)}</span>
          <div className="storage-bar"><div className="storage-fill" style={{ width: `${percent}%` }} /></div>
          <span className="storage-hint">{catalog.assets.length} 个资源 · 用量来自目录文件大小</span>
        </div>
      </aside>

      <main className="main">
        {shown === 'hold' ? (
          <div className="card card-pad"><p>正在确认访问权限…</p></div>
        ) : null}
        {shown === 'library' ? (
          <LibraryPage catalog={catalog} source={source} siteId={siteId} folders={libraryFolders} onFolders={setLibraryFolders} onOpen={openAsset} onUpload={() => go('upload')} onToast={setToast} />
        ) : null}
        {shown === 'upload' ? <UploadPage folders={allowedUpload} siteId={siteId} onToast={setToast} /> : null}
        {shown === 'detail' ? (
          <DetailPage
            asset={selected}
            catalog={catalog}
            siteId={siteId}
            missing={Boolean(selectedId) && source !== 'loading' && !selected}
            pending={source === 'loading' && Boolean(selectedId) && !selected}
            onBack={() => go('library')}
            onAdopt={(id) => {
              adopt(id);
              setToast('AI 建议标签已转为正式标签');
            }}
            onToast={setToast}
          />
        ) : null}
        {shown === 'ask' ? <AskPage catalog={catalog} siteId={siteId} /> : null}
        {shown === 'account' || shown === 'password' || shown === 'uploads' || shown === 'shares' || shown === 'favorites' || shown === 'history' || shown === 'inbox' || shown === 'login' || shown === 'register' ? (
          <MemberPage mode={shown} catalog={catalog} siteId={siteId} inbox={inbox} onOpen={openAsset} />
        ) : null}
      </main>

      <button className="mnav-btn" type="button" title="打开导航" onClick={() => setDrawer((open) => !open)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M4 7h16M4 12h16M4 17h16" stroke="#5F6368" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
      <div className={`mnav-mask ${drawer ? 'is-open' : ''}`} onClick={() => setDrawer(false)} />
      <div className={`toast ${toast ? 'is-show' : ''}`} role="status">{toast}</div>
    </div>
    </MemberShell>
  );
}
