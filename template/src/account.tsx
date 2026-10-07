import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { changeMemberPassword, frontendLogin, frontendLogout, issueMemberShare, loadCurrentMember, loadMemberFavorites, loadMemberHistory, loadMemberRegistration, loadMemberShares, loadMemberUploads, recordMemberView, revokeMemberShare, saveMemberFavorite, siteIdFromLocation, submitMemberRegistration, type MemberField, type MemberShare, type MemberUpload } from './api';
import type { Asset, Catalog, ResourceGroup } from './types';
import { formatBytes, formatWhen, kindLabel } from './format';
import { Page, UploadIcon } from './ui';

export type MemberNav = 'account' | 'password' | 'uploads' | 'shares' | 'favorites' | 'history' | 'login' | 'register';

type Notice = { id: string; title: string; time: string; read: boolean };
type Member = { name: string; username: string; groups: string[]; groupCodes: string[]; signedIn: boolean };
type HistoryItem = { id: string; at: string };

type Store = {
  member: Member;
  notices: Notice[];
  favorites: string[];
  history: HistoryItem[];
  libraryUnavailable: boolean;
};

const KEY = 'dam.member.space';

const DEFAULT_STORE: Store = {
  member: { name: '', username: '', groups: [], groupCodes: [], signedIn: false },
  notices: [
    { id: 'n1', title: '安装手册已通过审批', time: '2 小时前', read: false },
    { id: 'n2', title: '品牌影像库有新的下载授权', time: '昨天', read: false },
    { id: 'n3', title: '一条分发链接将在 3 天后失效', time: '3 天前', read: true }
  ],
  favorites: [],
  history: [],
  libraryUnavailable: false
};

let store: Store = load();
const listeners = new Set<() => void>();

function readMember(raw: Partial<Member> | undefined): Member {
  const record = raw ?? {};
  const groups = Array.isArray(record.groups)
    ? record.groups.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const groupCodes = Array.isArray(record.groupCodes)
    ? record.groupCodes.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const username = typeof record.username === 'string' ? record.username : '';
  let name = typeof record.name === 'string' ? record.name : '';
  if (name === '林可' && groups.length === 0 && !username) name = '';
  return { name, username, groups, groupCodes, signedIn: Boolean(record.signedIn) };
}

/** 栏目打破继承后只看栏目自己的「添加子项」；未打破时沿用站点会员组权利。 */
export function uploadFolders(groups: ResourceGroup[], codes: string[]): ResourceGroup[] {
  return foldersWithRight(groups, codes, 'add-children');
}

/** 会员组「查看」，或有效授权中的匿名「查看」。栏目打破继承后只看栏目自己的授权。 */
export function viewFolders(groups: ResourceGroup[], codes: string[]): ResourceGroup[] {
  const byMember = new Set(foldersWithRight(groups, codes, 'view').map((group) => group.id));
  return groups.filter((group) => byMember.has(group.id) || group.anonymousView === true);
}

function foldersWithRight(groups: ResourceGroup[], codes: string[], right: string): ResourceGroup[] {
  const owned = new Set(codes.map((code) => code.trim().toLowerCase()).filter(Boolean));
  return groups.filter((group) =>
    group.grants.some((grant) => owned.has(grant.code.trim().toLowerCase()) && grant.rights.includes(right))
  );
}

/** 按父栏目排成树。父栏目不在可见范围时，子栏目升为顶层。 */
export function folderTree(groups: ResourceGroup[]): { group: ResourceGroup; depth: number }[] {
  const ids = new Set(groups.map((group) => group.id));
  const children = new Map<string, ResourceGroup[]>();
  const roots: ResourceGroup[] = [];
  for (const group of groups) {
    const parent = group.parentId && ids.has(group.parentId) ? group.parentId : '';
    if (!parent) roots.push(group);
    else children.set(parent, [...(children.get(parent) ?? []), group]);
  }
  const ordered = (nodes: ResourceGroup[]) => nodes.slice().sort((a, b) => a.title.localeCompare(b.title, 'zh'));
  const out: { group: ResourceGroup; depth: number }[] = [];
  const walk = (nodes: ResourceGroup[], depth: number) => {
    for (const node of ordered(nodes)) {
      out.push({ group: node, depth });
      walk(children.get(node.id) ?? [], depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}

function groupLabel(member: Member) {
  return member.groups.length ? member.groups.join('、') : '未加入会员组';
}

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_STORE;
    const parsed = JSON.parse(raw) as Partial<Store>;
    return {
      member: readMember(parsed.member),
      notices: parsed.notices?.length ? parsed.notices : DEFAULT_STORE.notices,
      favorites: [],
      history: [],
      libraryUnavailable: false
    };
  } catch {
    return DEFAULT_STORE;
  }
}

function update(patch: Partial<Store>) {
  store = { ...store, ...patch };
  localStorage.setItem(KEY, JSON.stringify(store));
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMemberStore() {
  return useSyncExternalStore(subscribe, () => store);
}

export function isSignedIn() {
  return store.member.signedIn;
}

const RETURN_KEY = 'dam.member.return';

export function rememberReturn(id: string) {
  if (!id || id === 'login' || id === 'register') return;
  sessionStorage.setItem(RETURN_KEY, id);
}

export function consumeReturn() {
  const id = sessionStorage.getItem(RETURN_KEY) || 'library';
  sessionStorage.removeItem(RETURN_KEY);
  return id === 'login' ? 'library' : id;
}

export async function toggleFavorite(siteId: string, id: string) {
  const saved = !store.favorites.includes(id);
  await saveMemberFavorite(siteId, id, saved);
  const favorites = saved
    ? [id, ...store.favorites.filter((item) => item !== id)]
    : store.favorites.filter((item) => item !== id);
  update({ favorites });
}

export function rememberView(siteId: string, id: string) {
  const history = [{ id, at: new Date().toISOString() }, ...store.history.filter((item) => item.id !== id)].slice(0, 20);
  update({ history });
  if (siteId && store.member.signedIn) {
    void recordMemberView(siteId, id).catch(() => undefined);
  }
}

export async function syncLibrary(siteId: string) {
  if (!siteId || !store.member.signedIn) return;
  try {
    const [favorites, history] = await Promise.all([loadMemberFavorites(siteId), loadMemberHistory(siteId)]);
    update({
      favorites: favorites.map((item) => item.contentId),
      history: history.map((item) => ({ id: item.contentId, at: item.at })),
      libraryUnavailable: false
    });
  } catch (reason) {
    const missing = reason instanceof Error && reason.message.includes('尚未加载');
    update({ favorites: [], history: [], libraryUnavailable: missing });
  }
}

export function markNotice(id: string) {
  update({
    notices: store.notices.map((item) => (item.id === id ? { ...item, read: true } : item))
  });
}

export function signOut() {
  sessionStorage.removeItem(RETURN_KEY);
  update({
    member: { name: '', username: '', groups: [], groupCodes: [], signedIn: false },
    favorites: [],
    history: [],
    libraryUnavailable: false
  });
  frontendLogout();
}

export function signIn(name?: string) {
  const nextName = name?.trim() || '';
  update({
    member: {
      name: nextName,
      username: nextName,
      groups: [],
      groupCodes: [],
      signedIn: true
    }
  });
}

/** 用当前会话覆盖本地会员名和会员组。未登录时清掉本地登录态。 */
export async function refreshMember(): Promise<boolean> {
  try {
    const profile = await loadCurrentMember();
    if (!profile) {
      if (store.member.signedIn) {
        update({
          member: { name: '', username: '', groups: [], groupCodes: [], signedIn: false },
          favorites: [],
          history: [],
          libraryUnavailable: false
        });
      }
      return false;
    }
    const next: Member = {
      signedIn: true,
      name: profile.displayName || profile.username,
      username: profile.username,
      groups: profile.groups,
      groupCodes: profile.groupCodes
    };
    const current = store.member;
    const sameList = (left: string[], right: string[]) => left.length === right.length && left.every((item, index) => item === right[index]);
    if (current.signedIn && current.name === next.name && current.username === next.username && sameList(current.groups, next.groups) && sameList(current.groupCodes, next.groupCodes)) return true;
    update({ member: next });
    return true;
  } catch {
    return store.member.signedIn;
  }
}

const ShellContext = createContext<{ go: (id: string) => void; toast: (message: string) => void }>({
  go: () => undefined,
  toast: () => undefined
});

export function MemberShell(props: { go: (id: string) => void; toast: (message: string) => void; children: ReactNode }) {
  const goRef = useRef(props.go);
  goRef.current = props.go;
  useEffect(() => {
    void refreshMember().then(async (ok) => {
      if (!ok) {
        const page = location.hash.replace(/^#/, '').split('/')[0];
        if (page && page !== 'login' && page !== 'register' && page !== 'library' && page !== 'detail') {
          goRef.current('login');
        }
        return;
      }
      await syncLibrary(siteIdFromLocation());
    });
  }, []);
  return <ShellContext.Provider value={{ go: props.go, toast: props.toast }}>{props.children}</ShellContext.Provider>;
}

export function AccountBar() {
  const shell = useContext(ShellContext);
  const { member, notices } = useMemberStore();
  const [open, setOpen] = useState<'menu' | 'notes' | null>(null);
  const unread = notices.filter((item) => !item.read).length;

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && document.querySelector('.account-bar')?.contains(target)) return;
      setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function choose(id: MemberNav | 'library') {
    setOpen(null);
    if (id === 'library') {
      signOut();
      shell.toast('已退出');
      shell.go('login');
      return;
    }
    shell.go(id);
  }

  function openLogin() {
    setOpen(null);
    const current = location.hash.replace(/^#/, '');
    if (current && current !== 'login') rememberReturn(current);
    shell.go('login');
  }

  const initial = (member.name || member.username).slice(0, 1) || '会';

  if (!member.signedIn) {
    return (
      <div className="account-bar">
        <button className="icon-btn note-btn" type="button" title="消息通知" aria-label="消息通知" onClick={openLogin}>
          <BellIcon />
          {unread > 0 ? <span className="note-badge">{unread}</span> : null}
        </button>
        <button className="btn btn-primary btn-sm" type="button" onClick={openLogin}>登录</button>
      </div>
    );
  }

  return (
    <div className="account-bar">
      <button
        className="icon-btn note-btn"
        type="button"
        title="消息通知"
        aria-label="消息通知"
        aria-expanded={open === 'notes'}
        onClick={() => setOpen((current) => (current === 'notes' ? null : 'notes'))}
      >
        <BellIcon />
        {unread > 0 ? <span className="note-badge">{unread}</span> : null}
      </button>
      <button
        className="avatar avatar-btn"
        type="button"
        title={member.name || member.username}
        aria-label="会员菜单"
        aria-expanded={open === 'menu'}
        onClick={() => setOpen((current) => (current === 'menu' ? null : 'menu'))}
      >
        {initial}
      </button>
      {open === 'notes' ? (
        <div className="menu-pop note-pop" role="menu" aria-label="消息通知">
          <div className="menu-user">消息通知</div>
          {notices.map((item) => (
            <button key={item.id} type="button" className={item.read ? '' : 'is-unread'} onClick={() => markNotice(item.id)}>
              <strong>{item.title}</strong>
              <span>{item.time}</span>
            </button>
          ))}
        </div>
      ) : null}
      {open === 'menu' ? (
        <div className="menu-pop" role="menu" aria-label="会员菜单">
          <div className="menu-user">
            <strong>{member.name || member.username}</strong>
            <span>会员组：{groupLabel(member)}</span>
          </div>
          <button type="button" onClick={() => choose('account')}>个人中心</button>
          <button type="button" onClick={() => choose('password')}>修改密码</button>
          <button type="button" onClick={() => choose('uploads')}>我的上传</button>
          <button type="button" onClick={() => choose('shares')}>我的分享</button>
          <button type="button" onClick={() => choose('favorites')}>我的收藏</button>
          <button type="button" onClick={() => choose('history')}>浏览历史</button>
          <button type="button" className="is-exit" onClick={() => choose('library')}>退出</button>
        </div>
      ) : null}
    </div>
  );
}

export function MemberPage(props: { mode: MemberNav; catalog: Catalog; siteId: string; onOpen: (id: string) => void }) {
  const shell = useContext(ShellContext);
  const { member, favorites, history, libraryUnavailable } = useMemberStore();
  const [shareLogs, setShareLogs] = useState(false);
  useEffect(() => {
    if (props.mode !== 'shares') setShareLogs(false);
  }, [props.mode]);
  const title = {
    account: '个人中心',
    password: '修改密码',
    uploads: '我的上传',
    shares: '我的分享',
    favorites: '我的收藏',
    history: '浏览历史',
    login: '登录',
    register: '注册'
  }[props.mode];

  if (props.mode === 'password') {
    return (
      <Page>
        <header className="topbar">
          <div className="topbar-left"><span className="crumb">会员&nbsp;&nbsp;/&nbsp;&nbsp;修改密码</span></div>
          <div className="topbar-right"><AccountBar /></div>
        </header>
        <div className="page-body login-stage">
          <div className="login-panel">
            <div className="page-head">
              <h1 className="page-title">修改密码</h1>
              <p className="page-sub">{member.signedIn ? `${member.name || member.username} · ${groupLabel(member)}` : '当前未登录'}</p>
            </div>
            <PasswordForm siteId={props.siteId} onSaved={() => shell.toast('密码已更新')} signedIn={member.signedIn} />
          </div>
        </div>
      </Page>
    );
  }

  if (props.mode === 'login' || props.mode === 'register') {
    const title = props.mode === 'register' ? '注册' : '登录';
    return (
      <Page>
        <header className="topbar">
          <div className="topbar-left"><span className="crumb">会员&nbsp;&nbsp;/&nbsp;&nbsp;{title}</span></div>
          <div className="topbar-right"><AccountBar /></div>
        </header>
        <div className="page-body login-stage">
          <div className="login-panel">
            <div className="page-head">
              <h1 className="page-title">{title}</h1>
              <p className="page-sub">
                {props.mode === 'register'
                  ? '填写会员资料。是否立即登录由后台的注册设置决定'
                  : '登录后可查看消息、上传、收藏和浏览历史'}
              </p>
            </div>
            {props.mode === 'register' ? <RegisterForm siteId={props.siteId} /> : <LoginForm siteId={props.siteId} />}
          </div>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <header className="topbar">
        <div className="topbar-left"><span className="crumb">会员&nbsp;&nbsp;/&nbsp;&nbsp;{title}</span></div>
        <div className="topbar-right">
          {props.mode === 'uploads' ? (
            <button className="btn btn-primary" type="button" onClick={() => shell.go('upload')}>
              <UploadIcon />
              上传资源
            </button>
          ) : null}
          {props.mode === 'shares' && !shareLogs ? (
            <button className="btn btn-ghost" type="button" onClick={() => setShareLogs(true)}>访问日志</button>
          ) : null}
          {props.mode === 'shares' && shareLogs ? (
            <button className="btn btn-ghost" type="button" onClick={() => setShareLogs(false)}>返回分享</button>
          ) : null}
          <AccountBar />
        </div>
      </header>
      <div className="page-body">
        <div className="page-head">
          <h1 className="page-title">{shareLogs && props.mode === 'shares' ? '访问日志' : title}</h1>
          <p className="page-sub">{member.signedIn ? `${member.name || member.username} · ${groupLabel(member)}` : '当前未登录'}</p>
        </div>
        {props.mode === 'account' ? <Profile member={member} onEnter={() => shell.go('login')} /> : null}
        {props.mode === 'uploads' ? (
          <UploadList siteId={props.siteId} catalog={props.catalog} signedIn={member.signedIn} onOpen={props.onOpen} />
        ) : null}
        {props.mode === 'shares' && shareLogs ? <AccessLog /> : null}
        {props.mode === 'shares' && !shareLogs ? (
          <ShareList siteId={props.siteId} signedIn={member.signedIn} />
        ) : null}
        {props.mode === 'favorites' ? (
          libraryUnavailable ? <LibraryMissing /> : (
            <AssetList
              assets={favorites.map((id) => props.catalog.assets.find((asset) => asset.id === id)).filter((asset): asset is Asset => Boolean(asset))}
              empty="还没有收藏。在资源库卡片上点星标即可加入。"
              onOpen={props.onOpen}
            />
          )
        ) : null}
        {props.mode === 'history' ? (
          libraryUnavailable ? <LibraryMissing /> : (
            <AssetList
              assets={history.map((item) => props.catalog.assets.find((asset) => asset.id === item.id)).filter((asset): asset is Asset => Boolean(asset))}
              empty="还没有浏览记录。打开一条资源后会出现在这里。"
              onOpen={props.onOpen}
              when={new Map(history.map((item) => [item.id, item.at]))}
            />
          )
        ) : null}
      </div>
    </Page>
  );
}

function Profile(props: { member: Member; onEnter: () => void }) {
  if (!props.member.signedIn) {
    return (
      <div className="card card-pad">
        <p>当前未登录。登录后可以查看上传、收藏和浏览历史。</p>
        <button className="btn btn-primary" type="button" onClick={props.onEnter}>登录</button>
      </div>
    );
  }
  return (
    <div className="card card-pad member-card">
      <div className="avatar avatar-lg">{(props.member.name || props.member.username).slice(0, 1) || '会'}</div>
      <div>
        <strong>{props.member.name || props.member.username}</strong>
        <span>会员组：{groupLabel(props.member)}</span>
        {props.member.username && props.member.username !== props.member.name ? <span>账号：{props.member.username}</span> : null}
      </div>
    </div>
  );
}

const UPLOAD_STATUS: Record<string, string> = {
  DRAFT: '草稿',
  IN_REVIEW: '审核中',
  APPROVED: '已通过',
  PUBLISHED: '已发布',
  WITHDRAWN: '已撤回',
  ARCHIVED: '已归档'
};

function LibraryMissing() {
  return <div className="state-card"><span className="state-title">暂时无法读取</span><span className="state-desc">会员空间接口尚未加载，请重启 PowerCMS 后再试。</span></div>;
}

function UploadList(props: { siteId: string; catalog: Catalog; signedIn: boolean; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<MemberUpload[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState<{ id: string; title: string } | null>(null);

  useEffect(() => {
    if (!props.signedIn || !props.siteId) {
      setLoading(false);
      setRows([]);
      return;
    }
    let active = true;
    setLoading(true);
    void loadMemberUploads(props.siteId)
      .then((list) => {
        if (active) {
          setRows(list);
          setError('');
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '读取上传记录失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [props.siteId, props.signedIn]);

  if (!props.signedIn) return <div className="card card-pad"><p>登录后可以查看自己创建的资源。</p></div>;
  if (loading) return <div className="card card-pad"><p>正在读取上传记录…</p></div>;
  if (error) return <div className="state-card"><span className="state-title">暂时无法读取</span><span className="state-desc">{error}</span></div>;
  const assets = rows.map((row) => props.catalog.assets.find((asset) => asset.id === row.id)).filter((asset): asset is Asset => Boolean(asset));
  const missing = rows.filter((row) => !props.catalog.assets.some((asset) => asset.id === row.id));
  if (assets.length === 0 && missing.length === 0) {
    return <div className="state-card"><span className="state-title">这里还是空的</span><span className="state-desc">还没有以这个账号创建的数字资源。</span></div>;
  }
  return (
    <div>
      {sharing ? <ShareForm siteId={props.siteId} contentId={sharing.id} title={sharing.title} onClose={() => setSharing(null)} /> : null}
      <div className="card">
        {assets.map((asset) => (
          <div key={asset.id} className="row">
            <button className="row-col" type="button" onClick={() => props.onOpen(asset.id)} style={{ textAlign: 'left', background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>
              <span className="row-title">{asset.title}</span>
              <span className="row-sub">{kindLabel(asset.kind)} · {formatBytes(asset.bytes)} · {formatWhen(asset.updatedAt)}</span>
            </button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setSharing({ id: asset.id, title: asset.title })}>分享</button>
          </div>
        ))}
        {missing.map((row) => (
          <div key={row.id} className="row">
            <div className="row-col">
              <span className="row-title">{row.title || '未命名资源'}</span>
              <span className="row-sub">{UPLOAD_STATUS[row.status] || row.status || '未发布'} · {formatWhen(row.updatedAt)} · 尚未出现在已发布目录</span>
            </div>
            {row.status === 'PUBLISHED' ? (
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => setSharing({ id: row.id, title: row.title || '未命名资源' })}>分享</button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

const SHARE_STATUS: Record<string, string> = {
  ACTIVE: '生效中',
  REVOKED: '已吊销',
  EXPIRED: '已过期',
  EXHAUSTED: '已用完',
  UNAVAILABLE: '资源未发布'
};

function ShareForm(props: { siteId: string; contentId: string; title: string; onClose: () => void }) {
  const [audience, setAudience] = useState('');
  const [days, setDays] = useState('7');
  const [cap, setCap] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function issue() {
    setSaving(true);
    setError('');
    try {
      const max = cap.trim() ? Number(cap) : null;
      const issued = await issueMemberShare(props.siteId, props.contentId, audience.trim(), Number(days), Number.isFinite(max) ? max : null);
      setUrl(`${location.origin}${issued.url}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '签发失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <div className="card-head" style={{ padding: 0 }}>
        <span className="card-title">分享「{props.title}」</span>
        <button className="btn-text" type="button" onClick={props.onClose}>关闭</button>
      </div>
      <p className="page-sub">只有已发布、并且是你创建的数字资源可以分享。完整链接只出现这一次。</p>
      <div className="field" style={{ marginBottom: 12 }}>
        <span className="field-label">使用方</span>
        <input className="select" style={{ flex: 1 }} value={audience} maxLength={200} onChange={(event) => setAudience(event.target.value)} placeholder="部门、外部应用或渠道" />
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <span className="field-label">有效期</span>
        <select className="select" value={days} onChange={(event) => setDays(event.target.value)}>
          <option value="1">1 天</option>
          <option value="7">7 天</option>
          <option value="30">30 天</option>
        </select>
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <span className="field-label">次数上限</span>
        <input className="select" style={{ width: 120 }} value={cap} inputMode="numeric" placeholder="不限" onChange={(event) => setCap(event.target.value)} />
      </div>
      <button className="btn btn-primary" type="button" disabled={saving || !audience.trim()} onClick={() => void issue()}>
        {saving ? '签发中…' : '签发'}
      </button>
      {error ? <div className="note-box note-warn" style={{ marginTop: 12 }}>{error}</div> : null}
      {url ? (
        <div className="note-box note-warn" style={{ marginTop: 12 }}>
          <div>请立即复制。关闭后只能在「我的分享」看到令牌尾号。</div>
          <div style={{ wordBreak: 'break-all', margin: '8px 0' }}>{url}</div>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => void navigator.clipboard.writeText(url).catch(() => undefined)}>复制链接</button>
        </div>
      ) : null}
    </div>
  );
}

function AccessLog() {
  return (
    <div className="card" id="access-log">
      <div className="card-head">
        <span className="card-title">访问日志</span>
      </div>
      <div className="card-pad">
        <div className="note-box note-flat">分享下载由服务端按令牌尾号记录。下载成功和被拒绝的记录写在服务端审计里，这里不展示可还原资源的失败明细。</div>
      </div>
    </div>
  );
}

function ShareList(props: { siteId: string; signedIn: boolean }) {
  const [rows, setRows] = useState<MemberShare[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  function reload() {
    if (!props.signedIn || !props.siteId) {
      setLoading(false);
      setRows([]);
      return;
    }
    setLoading(true);
    void loadMemberShares(props.siteId)
      .then((list) => {
        setRows(list);
        setError('');
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '读取分享失败'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
  }, [props.siteId, props.signedIn]);

  async function revoke(id: string) {
    try {
      await revokeMemberShare(props.siteId, id);
      reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '吊销失败');
    }
  }

  if (!props.signedIn) return <div className="card card-pad"><p>登录后可以查看自己签发的分享。</p></div>;
  if (loading) return <div className="card card-pad"><p>正在读取分享…</p></div>;
  if (error && rows.length === 0) return <div className="state-card"><span className="state-title">暂时无法读取</span><span className="state-desc">{error}</span></div>;
  if (rows.length === 0) {
    return <div className="state-card"><span className="state-title">还没有分享</span><span className="state-desc">在「我的上传」里对已发布的资源签发。这里只显示你自己发出的链接。</span></div>;
  }
  return (
    <div className="card">
      {error ? <div className="card-note">{error}</div> : null}
      {rows.map((row) => (
        <div className="row" key={row.id}>
          <div className="row-col">
            <span className="row-title">{row.contentTitle || '未命名资源'}</span>
            <span className="row-sub">
              {row.audience} · {SHARE_STATUS[row.availability] || row.availability} · 尾号 {row.tokenHint}
              {row.maxDownloads ? ` · ${row.downloadCount}/${row.maxDownloads} 次` : ` · 已下载 ${row.downloadCount} 次`}
            </span>
          </div>
          {row.availability === 'ACTIVE' ? (
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => void revoke(row.id)}>吊销</button>
          ) : (
            <span className="badge badge-neutral">{SHARE_STATUS[row.availability] || row.availability}</span>
          )}
        </div>
      ))}
      <div className="card-note">完整链接只在签发时出现一次。资源撤回或过期后，原链接不再返回文件。</div>
    </div>
  );
}

function PasswordForm(props: { siteId: string; signedIn: boolean; onSaved: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!props.signedIn) {
    return <div className="card card-pad"><p>未登录不能修改密码。请先登录。</p></div>;
  }

  return (
    <form
      className="card card-pad password-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!current) {
          setError('请填写当前密码。');
          return;
        }
        if (next.length < 8) {
          setError('新密码至少 8 位。');
          return;
        }
        if (next !== again) {
          setError('两次输入的新密码不一致。');
          return;
        }
        if (!props.siteId) {
          setError('缺少站点，无法修改密码。');
          return;
        }
        setError('');
        setBusy(true);
        void changeMemberPassword(props.siteId, current, next)
          .then(() => {
            setCurrent('');
            setNext('');
            setAgain('');
            props.onSaved();
          })
          .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '修改密码失败'))
          .finally(() => setBusy(false));
      }}
    >
      <label>当前密码<input type="password" value={current} onChange={(event) => setCurrent(event.target.value)} autoComplete="current-password" /></label>
      <label>新密码<input type="password" value={next} onChange={(event) => setNext(event.target.value)} autoComplete="new-password" /></label>
      <label>确认新密码<input type="password" value={again} onChange={(event) => setAgain(event.target.value)} autoComplete="new-password" /></label>
      {error ? <p className="form-error">{error}</p> : null}
      <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? '保存中…' : '保存'}</button>
    </form>
  );
}

function LoginForm(props: { siteId: string }) {
  const shell = useContext(ShellContext);
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="card card-pad password-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!account.trim()) {
          setError('请填写账号。');
          return;
        }
        if (!password.trim()) {
          setError('请填写密码。');
          return;
        }
        if (!props.siteId) {
          setError('缺少站点，无法登录。');
          return;
        }
        setError('');
        setBusy(true);
        void frontendLogin(props.siteId, account.trim(), password)
          .then(async () => {
            const synced = await refreshMember();
            if (!synced) signIn(account.trim());
            await syncLibrary(props.siteId);
            shell.toast('已登录');
            shell.go(consumeReturn());
          })
          .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '登录失败'))
          .finally(() => setBusy(false));
      }}
    >
      <label>账号<input value={account} onChange={(event) => setAccount(event.target.value)} autoComplete="username" /></label>
      <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>
      {error ? <p className="form-error">{error}</p> : null}
      <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? '登录中…' : '登录'}</button>
      <p className="login-alt">没有账号？<button type="button" onClick={() => shell.go('register')}>注册</button></p>
    </form>
  );
}

function RegisterForm(props: { siteId: string }) {
  const shell = useContext(ShellContext);
  const [fields, setFields] = useState<MemberField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!props.siteId) {
      setLoading(false);
      setError('缺少站点，无法注册。');
      return;
    }
    let active = true;
    setLoading(true);
    loadMemberRegistration(props.siteId)
      .then((form) => {
        if (!active) return;
        setFields(form.fields);
        setError('');
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '无法读取会员资料字段');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [props.siteId]);

  if (pending) {
    return (
      <div className="card card-pad">
        <p>注册已提交，请等待管理员审核。通过后可使用该账号登录。</p>
        <button className="btn btn-primary" type="button" onClick={() => shell.go('login')}>返回登录</button>
      </div>
    );
  }

  return (
    <form
      className="card card-pad password-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!username.trim()) {
          setError('请填写用户名。');
          return;
        }
        if (password.length < 8) {
          setError('密码至少 8 位。');
          return;
        }
        if (password !== again) {
          setError('两次输入的密码不一致。');
          return;
        }
        for (const field of fields) {
          if (field.required && field.fieldType !== 'BOOLEAN' && !values[field.code]?.trim()) {
            setError(`请填写${field.name}。`);
            return;
          }
        }
        const payload: Record<string, unknown> = {};
        for (const field of fields) {
          const value = values[field.code] ?? '';
          if (field.fieldType === 'BOOLEAN') payload[field.code] = value === 'true';
          else if (value.trim()) payload[field.code] = value.trim();
        }
        setError('');
        setBusy(true);
        void submitMemberRegistration(props.siteId, username.trim(), password, payload)
          .then(async (result) => {
            if (result.autoLogin) {
              await frontendLogin(props.siteId, username.trim(), password);
              const synced = await refreshMember();
              if (!synced) signIn(result.displayName || username.trim());
              await syncLibrary(props.siteId);
              shell.toast('已登录');
              shell.go(consumeReturn());
              return;
            }
            setPending(true);
          })
          .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '注册失败'))
          .finally(() => setBusy(false));
      }}
    >
      <label>用户名<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></label>
      <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></label>
      <label>确认密码<input type="password" value={again} onChange={(event) => setAgain(event.target.value)} autoComplete="new-password" /></label>
      {loading ? <p>正在读取会员资料字段…</p> : fields.map((field) => (
        <label key={field.code}>
          {field.name}{field.required ? ' *' : ''}
          <FieldInput field={field} value={values[field.code] ?? ''} onChange={(value) => setValues((current) => ({ ...current, [field.code]: value }))} />
          {field.helpText ? <span>{field.helpText}</span> : null}
        </label>
      ))}
      {error ? <p className="form-error">{error}</p> : null}
      <button className="btn btn-primary" type="submit" disabled={busy || loading}>{busy ? '提交中…' : '注册'}</button>
      <p className="login-alt">已有账号？<button type="button" onClick={() => shell.go('login')}>登录</button></p>
    </form>
  );
}

function FieldInput(props: { field: MemberField; value: string; onChange: (value: string) => void }) {
  const { field, value, onChange } = props;
  if (field.fieldType === 'BOOLEAN') {
    return <input type="checkbox" checked={value === 'true'} onChange={(event) => onChange(event.target.checked ? 'true' : 'false')} />;
  }
  if (field.fieldType === 'LONG_TEXT' || field.fieldType === 'RICH_TEXT') {
    return <textarea rows={4} value={value} onChange={(event) => onChange(event.target.value)} />;
  }
  if (field.fieldType === 'ENUM') {
    return (
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">请选择</option>
        {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  if (field.fieldType === 'MULTI_ENUM') {
    return (
      <select multiple value={value ? value.split(',') : []} onChange={(event) => {
        const selected = Array.from(event.target.selectedOptions).map((option) => option.value);
        onChange(selected.join(','));
      }}>
        {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  const type = field.fieldType === 'INTEGER' || field.fieldType === 'DECIMAL' ? 'number' : field.fieldType === 'DATE' ? 'date' : 'text';
  return <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />;
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M6 16.5V11a6 6 0 1112 0v5.5l1.2 1.8H4.8L6 16.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M10 19a2 2 0 004 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function AssetList(props: { assets: Asset[]; empty: string; onOpen: (id: string) => void; when?: Map<string, string> }) {
  if (props.assets.length === 0) {
    return <div className="state-card"><span className="state-title">这里还是空的</span><span className="state-desc">{props.empty}</span></div>;
  }
  return (
    <div className="card">
      {props.assets.map((asset) => (
        <button key={asset.id} className="row" type="button" onClick={() => props.onOpen(asset.id)} style={{ width: '100%', textAlign: 'left' }}>
          <div className="row-col">
            <span className="row-title">{asset.title}</span>
            <span className="row-sub">
              {kindLabel(asset.kind)} · {formatBytes(asset.bytes)}
              {props.when?.get(asset.id) ? ` · ${formatWhen(props.when.get(asset.id) || '')}` : ''}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
