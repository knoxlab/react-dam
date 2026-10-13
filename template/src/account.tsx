import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { changeMemberPassword, deleteMemberUpload, frontendLogin, frontendLogout, issueMemberShare, likeMemberComment, loadCurrentMember, loadMemberFavorites, loadMemberHistory, loadMemberInbox, loadMemberRegistration, loadMemberShares, loadMemberUploads, markMemberInboxRead, recordMemberView, replyMemberComment, revokeMemberShare, saveMemberFavorite, siteIdFromLocation, submitMemberRegistration, type InboxNotice, type MemberField, type MemberShare, type MemberUpload } from './api';
import type { Asset, Catalog, ResourceGroup } from './types';
import { formatBytes, formatWhen, kindLabel } from './format';
import { Page, UploadIcon } from './ui';

export type MemberNav = 'account' | 'password' | 'uploads' | 'shares' | 'favorites' | 'history' | 'inbox' | 'login' | 'register';

export type NoticeKind = 'message' | 'comment' | 'fan' | 'like';

export const NOTICE_TABS: { id: NoticeKind; label: string; empty: string }[] = [
  { id: 'message', label: '消息私信', empty: '暂无消息' },
  { id: 'comment', label: '评论和@', empty: '暂无评论' },
  { id: 'fan', label: '粉丝', empty: '粉丝功能暂未开放' },
  { id: 'like', label: '点赞', empty: '暂无点赞' }
];

export function noticeKind(value: string | undefined): NoticeKind {
  if (value === 'comment' || value === 'fan' || value === 'like') return value;
  return 'message';
}

function unreadText(count: number) {
  if (count > 99) return '99+';
  return String(count);
}

type MailLine = { id: string; body: string; time: string; mine?: boolean };

type Notice = {
  id: string;
  kind: NoticeKind;
  title: string;
  time: string;
  read: boolean;
  actor: string;
  hue: string;
  action?: string;
  body?: string;
  quote?: string;
  official?: boolean;
  earlier?: boolean;
  mails?: MailLine[];
  messageId?: string;
};
type Member = { name: string; username: string; groups: string[]; groupCodes: string[]; signedIn: boolean };
type HistoryItem = { id: string; at: string };

type Store = {
  member: Member;
  notices: Notice[];
  favorites: string[];
  history: HistoryItem[];
  libraryUnavailable: boolean;
  inboxLive: boolean;
  inboxError: string;
};

const KEY = 'dam.member.space';

const DEFAULT_STORE: Store = {
  member: { name: '', username: '', groups: [], groupCodes: [], signedIn: false },
  notices: [
    {
      id: 'n1', kind: 'message', actor: '资源云', hue: '#5b8ff9', official: true, earlier: false,
      title: '安装手册已通过审批，可以下载原件。', time: '10-05', read: false,
      mails: [
        { id: 'n1a', body: '安装手册已通过审批，可以下载原件。', time: '10-05 11:20' },
        { id: 'n1b', body: '品牌影像库已开放下载授权，有效期 7 天。', time: '10-05 16:08' }
      ]
    },
    {
      id: 'n2', kind: 'message', actor: '市场部', hue: '#61d2a0', earlier: false,
      title: '发布会主旨演讲的字幕时间轴需要再对一下。', time: '09-28', read: true,
      mails: [
        { id: 'n2a', body: '发布会主旨演讲的字幕时间轴需要再对一下。', time: '09-28 09:16' }
      ]
    },
    {
      id: 'n3', kind: 'message', actor: '品牌部', hue: '#f6bd16', earlier: true,
      title: '一条分发链接将在 3 天后失效。', time: '09-08', read: true,
      mails: [
        { id: 'n3a', body: '一条分发链接将在 3 天后失效，需要的话请重新签发。', time: '09-08 18:42' }
      ]
    },
    {
      id: 'c1', kind: 'comment', actor: '市场部', hue: '#61d2a0', action: '回复了我的评论',
      title: '这条片子的字幕时间轴需要再对一下。', time: '10-07 16:20', read: false,
      body: '这条片子的字幕时间轴需要再对一下。',
      quote: '发布会主旨演讲已挂到品牌影像库，字幕稍后补。'
    },
    {
      id: 'c2', kind: 'comment', actor: '品牌部', hue: '#f6bd16', action: '回复了我的评论',
      title: '安装手册里的授权说明可以沿用上一版。', time: '10-06 09:03', read: true,
      body: '安装手册里的授权说明可以沿用上一版。',
      quote: '新版本手册是否要重写下载授权那段？'
    },
    {
      id: 'f1', kind: 'fan', actor: '市场部', hue: '#61d2a0', title: '市场部', time: '2024-08-07 20:09', read: false
    },
    {
      id: 'f2', kind: 'fan', actor: '品牌部', hue: '#f6bd16', title: '品牌部', time: '2022-03-14 22:10', read: true
    },
    {
      id: 'f3', kind: 'fan', actor: '产品部', hue: '#7262fd', title: '产品部', time: '2021-11-07 07:01', read: true
    },
    {
      id: 'f4', kind: 'fan', actor: '研发部', hue: '#78d3f8', title: '研发部', time: '2021-11-05 19:21', read: true
    },
    {
      id: 'f5', kind: 'fan', actor: '平台组', hue: '#9661bc', title: '平台组', time: '2021-04-10 12:39', read: true
    },
    {
      id: 'l1', kind: 'like', actor: '品牌部', hue: '#f6bd16', action: '赞了我的评论',
      title: '安装手册已挂到品牌影像库。', time: '10-06 14:44', read: false,
      quote: '安装手册已挂到品牌影像库，下载授权沿用上一版。'
    },
    {
      id: 'l2', kind: 'like', actor: '市场部', hue: '#61d2a0', action: '赞了我的评论',
      title: '发布会主旨演讲的摘要已更新。', time: '10-05 10:31', read: false,
      quote: '发布会主旨演讲的摘要已更新，片花仍在审核。'
    }
  ],
  favorites: [],
  history: [],
  libraryUnavailable: false,
  inboxLive: false,
  inboxError: ''
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

/** 栏目打破继承后只看栏目自己的「添加子项」；未打破时沿用站点会员组权利。
 * 当前登录用户被个别授予的权利（viewerRights，服务端按会话计算）同样生效，与后台判定一致。 */
export function uploadFolders(groups: ResourceGroup[], codes: string[]): ResourceGroup[] {
  return foldersWithRight(groups, codes, 'add-children');
}

/** 会员组「查看」，或有效授权中的匿名「查看」，或当前登录用户自身的「查看」（viewerRights，服务端按会话沿有效授权链计算，与后台判定同口径）。 */
export function viewFolders(groups: ResourceGroup[], codes: string[]): ResourceGroup[] {
  const byMember = new Set(foldersWithRight(groups, codes, 'view').map((group) => group.id));
  return groups.filter((group) => byMember.has(group.id) || group.anonymousView === true);
}

function foldersWithRight(groups: ResourceGroup[], codes: string[], right: string): ResourceGroup[] {
  const owned = new Set(codes.map((code) => code.trim().toLowerCase()).filter(Boolean));
  return groups.filter((group) =>
    group.grants.some((grant) => owned.has(grant.code.trim().toLowerCase()) && grant.rights.includes(right)) ||
    (group.viewerRights ?? []).includes(right)
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

function readNotices(raw: Notice[] | undefined): Notice[] {
  const saved = new Map((raw ?? []).filter((item) => item?.id).map((item) => [item.id, item]));
  return DEFAULT_STORE.notices.map((item) => {
    const prev = saved.get(item.id);
    if (!prev) return item;
    const mails = Array.isArray(prev.mails) && prev.mails.length ? prev.mails : item.mails;
    return { ...item, read: Boolean(prev.read), mails };
  });
}

const SEEN_KEY = 'dam.member.inbox.seen';

function readSeen(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}

function rememberSeen(id: string) {
  const seen = readSeen();
  seen.add(id);
  localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-400)));
}

function applySeen(rows: InboxNotice[]): Notice[] {
  const seen = readSeen();
  return rows.map((item) => ({
    id: item.id,
    kind: item.kind,
    actor: item.actor,
    hue: item.hue,
    title: item.title,
    time: item.time,
    read: Boolean(item.read) || seen.has(item.id),
    action: item.action || undefined,
    body: item.body || undefined,
    quote: item.quote || undefined,
    official: Boolean(item.official),
    earlier: Boolean(item.earlier),
    mails: item.mails?.length ? item.mails : undefined,
    messageId: item.messageId || undefined
  }));
}

function unreadCount(notices: Notice[], kind?: NoticeKind) {
  return notices.filter((item) => item.kind !== 'fan' && !item.read && (!kind || item.kind === kind)).length;
}

function load(): Store {
  const live = Boolean(siteIdFromLocation());
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_STORE, notices: live ? [] : DEFAULT_STORE.notices, inboxLive: live };
    const parsed = JSON.parse(raw) as Partial<Store>;
    return {
      member: readMember(parsed.member),
      notices: live ? [] : readNotices(parsed.notices),
      favorites: [],
      history: [],
      libraryUnavailable: false,
      inboxLive: live,
      inboxError: ''
    };
  } catch {
    return { ...DEFAULT_STORE, notices: live ? [] : DEFAULT_STORE.notices, inboxLive: live };
  }
}

function update(patch: Partial<Store>) {
  store = { ...store, ...patch };
  const saved = store.inboxLive ? { ...store, notices: [] } : store;
  localStorage.setItem(KEY, JSON.stringify(saved));
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

export async function syncInbox(siteId: string) {
  if (!siteId) {
    update({ inboxLive: false, inboxError: '', notices: DEFAULT_STORE.notices });
    return;
  }
  if (!store.member.signedIn) {
    update({ inboxLive: true, inboxError: '', notices: [] });
    return;
  }
  try {
    const notices = applySeen(await loadMemberInbox(siteId));
    update({ inboxLive: true, inboxError: '', notices });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : '读取消息失败';
    update({ inboxLive: true, inboxError: message, notices: [] });
  }
}

export function markNotice(id: string) {
  rememberSeen(id);
  const item = store.notices.find((notice) => notice.id === id);
  update({
    notices: store.notices.map((notice) => (notice.id === id ? { ...notice, read: true } : notice))
  });
  if (!store.inboxLive || item?.kind !== 'message') return;
  const ids = (item.mails ?? []).map((line) => line.id).filter((lineId) => /^[0-9a-f-]{36}$/i.test(lineId));
  const siteId = siteIdFromLocation();
  if (siteId && ids.length) void markMemberInboxRead(siteId, ids).catch(() => undefined);
}

function appendMail(id: string, body: string) {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const time = `${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  update({
    notices: store.notices.map((item) => (
      item.id === id
        ? { ...item, read: true, title: body, mails: [...(item.mails ?? []), { id: `m-${now.getTime()}`, body, time, mine: true }] }
        : item
    ))
  });
}

export function signOut() {
  sessionStorage.removeItem(RETURN_KEY);
  const live = Boolean(siteIdFromLocation());
  update({
    member: { name: '', username: '', groups: [], groupCodes: [], signedIn: false },
    favorites: [],
    history: [],
    libraryUnavailable: false,
    notices: live ? [] : DEFAULT_STORE.notices,
    inboxLive: live,
    inboxError: ''
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
          libraryUnavailable: false,
          notices: siteIdFromLocation() ? [] : DEFAULT_STORE.notices,
          inboxLive: Boolean(siteIdFromLocation()),
          inboxError: ''
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
      await syncInbox(siteIdFromLocation());
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

function NoteBell(props: { notices: Notice[]; unread: number; onOpen: (kind: NoticeKind) => void }) {
  return (
    <div className="note-wrap">
      <button className="icon-btn note-btn" type="button" title="消息通知" aria-label="消息通知" aria-haspopup="menu" onClick={() => props.onOpen('message')}>
        <BellIcon />
        {props.unread > 0 ? <span className="note-badge">{unreadText(props.unread)}</span> : null}
      </button>
      <div className="note-pop" role="menu" aria-label="消息通知">
        <div className="note-pop-panel">
          {NOTICE_TABS.map((tab) => {
            const count = unreadCount(props.notices, tab.id);
            return (
              <button key={tab.id} type="button" role="menuitem" onClick={() => props.onOpen(tab.id)}>
                <span>{tab.label}</span>
                {count > 0 ? <em className="note-pill">{unreadText(count)}</em> : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function AccountBar() {
  const shell = useContext(ShellContext);
  const { member, notices } = useMemberStore();
  const [open, setOpen] = useState(false);
  const unread = unreadCount(notices);

  function openInbox(kind: NoticeKind) {
    setOpen(false);
    shell.go(`inbox/${kind}`);
  }

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && document.querySelector('.account-bar')?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function choose(id: MemberNav | 'library') {
    setOpen(false);
    if (id === 'library') {
      signOut();
      shell.toast('已退出');
      shell.go('login');
      return;
    }
    shell.go(id);
  }

  function openLogin() {
    setOpen(false);
    const current = location.hash.replace(/^#/, '');
    if (current && current !== 'login') rememberReturn(current);
    shell.go('login');
  }

  const initial = (member.name || member.username).slice(0, 1) || '会';

  if (!member.signedIn) {
    return (
      <div className="account-bar">
        <NoteBell notices={notices} unread={unread} onOpen={openInbox} />
        <button className="btn btn-primary btn-sm" type="button" onClick={openLogin}>登录</button>
      </div>
    );
  }

  return (
    <div className="account-bar">
      <NoteBell notices={notices} unread={unread} onOpen={openInbox} />
      <button
        className="avatar avatar-btn"
        type="button"
        title={member.name || member.username}
        aria-label="会员菜单"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {initial}
      </button>
      {open ? (
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

export function MemberPage(props: { mode: MemberNav; catalog: Catalog; siteId: string; inbox?: NoticeKind; onOpen: (id: string) => void }) {
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
    inbox: '消息中心',
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
              removeLabel="取消收藏"
              onRemove={(id) => {
                void toggleFavorite(props.siteId, id)
                  .then(() => shell.toast('已取消收藏'))
                  .catch((reason: unknown) => shell.toast(reason instanceof Error ? reason.message : '取消收藏失败'));
              }}
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
        {props.mode === 'inbox' ? (
          <Inbox kind={props.inbox || 'message'} onKind={(kind) => shell.go(`inbox/${kind}`)} />
        ) : null}
      </div>
    </Page>
  );
}

function PersonFace(props: { name: string; hue: string }) {
  return <span className="person-face" style={{ background: props.hue }}>{props.name.slice(0, 1) || '会'}</span>;
}

function Inbox(props: { kind: NoticeKind; onKind: (kind: NoticeKind) => void }) {
  const { notices, inboxError, inboxLive } = useMemberStore();
  const rows = notices.filter((item) => item.kind === props.kind);
  const current = NOTICE_TABS.find((tab) => tab.id === props.kind) || NOTICE_TABS[0];
  return (
    <div className="card inbox">
      <div className="tabs" role="tablist" aria-label="消息中心">
        {NOTICE_TABS.map((tab) => {
          const count = unreadCount(notices, tab.id);
          return (
            <button
              key={tab.id}
              className={`tab ${tab.id === props.kind ? 'active' : ''}`}
              type="button"
              role="tab"
              aria-selected={tab.id === props.kind}
              onClick={() => props.onKind(tab.id)}
            >
              {tab.label}
              {count > 0 ? <span className="tab-count">{unreadText(count)}</span> : null}
            </button>
          );
        })}
      </div>
      {props.kind === 'fan' ? <p className="inbox-empty">粉丝功能暂未开放</p> : null}
      {props.kind !== 'fan' && rows.length === 0 ? <p className="inbox-empty">{inboxError || current.empty}</p> : null}
      {props.kind === 'comment' && rows.length > 0 ? <CommentFeed rows={rows} live={inboxLive} /> : null}
      {props.kind === 'like' && rows.length > 0 ? <LikeFeed rows={rows} /> : null}
      {props.kind === 'message' && rows.length > 0 ? <MailDesk rows={rows} live={inboxLive} /> : null}
    </div>
  );
}

function CommentFeed(props: { rows: Notice[]; live: boolean }) {
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sent, setSent] = useState<Record<string, string>>({});
  const [replyError, setReplyError] = useState('');
  return (
    <div className="feed">
      {props.rows.map((item) => (
        <article key={item.id} className={`feed-item ${item.read ? '' : 'is-unread'}`}>
          <PersonFace name={item.actor} hue={item.hue} />
          <div className="feed-main">
            <p className="feed-title"><strong>{item.actor}</strong> {item.action}</p>
            {item.body ? <p className="feed-body">{item.body}</p> : null}
            {item.quote ? <blockquote className="feed-quote">{item.quote}</blockquote> : null}
            {sent[item.id] ? <p className="feed-sent">我：{sent[item.id]}</p> : null}
            {replyError && replyFor === item.id ? <p className="feed-sent">{replyError}</p> : null}
            {replyFor === item.id ? (
              <form
                className="feed-reply"
                onSubmit={(event) => {
                  event.preventDefault();
                  const text = draft.trim();
                  if (!text) return;
                  const siteId = siteIdFromLocation();
                  if (props.live && item.messageId && siteId) {
                    void replyMemberComment(siteId, item.messageId, text)
                      .then(() => {
                        setSent((current) => ({ ...current, [item.id]: text }));
                        setDraft('');
                        setReplyFor(null);
                        setReplyError('');
                        markNotice(item.id);
                      })
                      .catch((reason: unknown) => setReplyError(reason instanceof Error ? reason.message : '回复失败'));
                    return;
                  }
                  setSent((current) => ({ ...current, [item.id]: text }));
                  setDraft('');
                  setReplyFor(null);
                  markNotice(item.id);
                }}
              >
                <input value={draft} placeholder="回复这条评论" onChange={(event) => setDraft(event.target.value)} />
                <button className="btn btn-primary btn-sm" type="submit">发送</button>
              </form>
            ) : null}
            <div className="feed-meta">
              <time>{item.time}</time>
              <div className="feed-actions">
                <button type="button" onClick={() => { setReplyFor(item.id); setDraft(''); }}>回复</button>
                <button
                  type="button"
                  className={liked[item.id] ? 'is-on' : ''}
                  onClick={() => {
                    const siteId = siteIdFromLocation();
                    if (props.live && item.messageId && siteId && !liked[item.id]) {
                      void likeMemberComment(siteId, item.messageId)
                        .then(() => {
                          setLiked((current) => ({ ...current, [item.id]: true }));
                          markNotice(item.id);
                        })
                        .catch((reason: unknown) => setReplyError(reason instanceof Error ? reason.message : '点赞失败'));
                      return;
                    }
                    setLiked((current) => ({ ...current, [item.id]: !current[item.id] }));
                    markNotice(item.id);
                  }}
                >
                  {liked[item.id] ? '已赞' : '赞'}
                </button>
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function LikeFeed(props: { rows: Notice[] }) {
  return (
    <div className="feed">
      {props.rows.map((item) => (
        <article key={item.id} className={`feed-item ${item.read ? '' : 'is-unread'}`} onClick={() => markNotice(item.id)}>
          <PersonFace name={item.actor} hue={item.hue} />
          <div className="feed-main">
            <p className="feed-title"><strong>{item.actor}</strong> {item.action}</p>
            {item.quote ? <blockquote className="feed-quote">{item.quote}</blockquote> : null}
            <time className="feed-time">{item.time}</time>
          </div>
        </article>
      ))}
    </div>
  );
}

function FanGrid(props: { rows: Notice[] }) {
  return (
    <div className="fan-wrap">
      <div className="fan-grid">
        {props.rows.map((item) => (
          <button key={item.id} type="button" className={`fan-card ${item.read ? '' : 'is-unread'}`} onClick={() => markNotice(item.id)}>
            <PersonFace name={item.actor} hue={item.hue} />
            <span>
              <strong>{item.actor}</strong>
              <time>{item.time}</time>
            </span>
          </button>
        ))}
      </div>
      <p className="inbox-end">没有更多了</p>
    </div>
  );
}

function MailDesk(props: { rows: Notice[]; live: boolean }) {
  const [peerId, setPeerId] = useState(props.rows[0]?.id ?? '');
  const [draft, setDraft] = useState('');
  const active = props.rows.find((item) => item.id === peerId) ?? props.rows[0];
  const earlierAt = props.rows.findIndex((item) => item.earlier);
  return (
    <div className="mail-desk">
      <div className="mail-peers" role="listbox" aria-label="发信人">
        {props.rows.map((item, index) => (
          <div key={item.id}>
            {earlierAt === index ? <p className="mail-split">更早的消息</p> : null}
            <button
              type="button"
              role="option"
              aria-selected={item.id === active?.id}
              className={`mail-peer ${item.id === active?.id ? 'is-on' : ''} ${item.read ? '' : 'is-unread'}`}
              onClick={() => {
                setPeerId(item.id);
                setDraft('');
                markNotice(item.id);
              }}
            >
              <PersonFace name={item.actor} hue={item.hue} />
              <span className="mail-peer-main">
                <span className="mail-peer-top">
                  <strong>{item.actor}</strong>
                  {item.official ? <em>官方</em> : null}
                  <time>{item.time}</time>
                </span>
                <span className="mail-peer-preview">{item.title}</span>
              </span>
            </button>
          </div>
        ))}
      </div>
      {active ? (
        <section className="mail-thread" aria-label={active.actor}>
          <header className="mail-thread-head">
            <strong>{active.actor}</strong>
            {active.official ? <em>官方</em> : null}
          </header>
          <div className="mail-thread-body">
            {(active.mails ?? []).map((line) => (
              <div key={line.id} className={`mail-bubble ${line.mine ? 'is-mine' : ''}`}>
                <p>{line.body}</p>
                <time>{line.time}</time>
              </div>
            ))}
          </div>
          {props.live ? null : (
            <form
              className="mail-compose"
              onSubmit={(event) => {
                event.preventDefault();
                const text = draft.trim();
                if (!text) return;
                appendMail(active.id, text);
                setDraft('');
              }}
            >
              <input value={draft} placeholder={`回复 ${active.actor}`} onChange={(event) => setDraft(event.target.value)} />
              <button className="btn btn-primary btn-sm" type="submit">发送</button>
            </form>
          )}
        </section>
      ) : null}
    </div>
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
  const shell = useContext(ShellContext);
  const [rows, setRows] = useState<MemberUpload[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState('');

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

  function remove(id: string, title: string) {
    if (deleting) return;
    if (!window.confirm(`确定删除「${title || '未命名资源'}」？删除后不可恢复。`)) return;
    setDeleting(id);
    void deleteMemberUpload(props.siteId, id)
      .then(() => {
        setRows((current) => current.filter((row) => row.id !== id));
        shell.toast('已删除');
      })
      .catch((reason: unknown) => shell.toast(reason instanceof Error ? reason.message : '删除失败'))
      .finally(() => setDeleting(''));
  }

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
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              disabled={deleting === asset.id}
              onClick={() => remove(asset.id, asset.title)}
            >
              {deleting === asset.id ? '删除中…' : '删除'}
            </button>
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
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              disabled={deleting === row.id}
              onClick={() => remove(row.id, row.title)}
            >
              {deleting === row.id ? '删除中…' : '删除'}
            </button>
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
            await syncInbox(props.siteId);
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
              await syncInbox(props.siteId);
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

function AssetList(props: { assets: Asset[]; empty: string; onOpen: (id: string) => void; when?: Map<string, string>; onRemove?: (id: string) => void; removeLabel?: string }) {
  if (props.assets.length === 0) {
    return <div className="state-card"><span className="state-title">这里还是空的</span><span className="state-desc">{props.empty}</span></div>;
  }
  return (
    <div className="card">
      {props.assets.map((asset) => (
        <div key={asset.id} className="row">
          <button className="row-col" type="button" onClick={() => props.onOpen(asset.id)} style={{ textAlign: 'left', background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>
            <span className="row-title">{asset.title}</span>
            <span className="row-sub">
              {kindLabel(asset.kind)} · {formatBytes(asset.bytes)}
              {props.when?.get(asset.id) ? ` · ${formatWhen(props.when.get(asset.id) || '')}` : ''}
            </span>
          </button>
          {props.onRemove ? (
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => props.onRemove?.(asset.id)}>
              {props.removeLabel || '移除'}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
