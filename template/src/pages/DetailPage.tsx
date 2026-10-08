import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { downloadContentFile, likeMemberComment, loadContentActions, loadContentComments, loadContentForm, recordContentView, submitContentComment, toggleContentLike, type ContentActions, type ContentComment, type ContentFormNode } from '../api';
import { AccountBar, toggleFavorite, useMemberStore } from '../account';
import { approvalBadge, approvalLabel, fileExt, formatBytes, formatDate, formatWhen, kindLabel, licenseLabel } from '../format';
import { externalUrl, frameOf, mediaAssetId, orientationOf, previewKind } from '../preview';
import type { Asset, Catalog } from '../types';
import { Page } from '../ui';
import { KnoxImage } from './KnoxImage';
import { PreviewPane } from './PreviewPane';

export function detailAddress(siteId: string, assetId: string) {
  const url = new URL(window.location.href);
  if (siteId) url.searchParams.set('siteId', siteId);
  url.hash = `detail/${encodeURIComponent(assetId)}`;
  return url.href;
}

export function DetailPage(props: {
  asset: Asset | null;
  catalog: Catalog;
  siteId: string;
  missing?: boolean;
  pending?: boolean;
  onBack: () => void;
  onAdopt: (id: string) => void;
  onToast: (message: string) => void;
}) {
  const [tab, setTab] = useState<'versions' | 'meta' | 'comments'>('versions');
  const [showDiff, setShowDiff] = useState(false);
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);
  const asset = props.asset;
  const [imageCodes, setImageCodes] = useState<string[]>([]);
  const [actions, setActions] = useState<ContentActions | null>(null);
  const [comments, setComments] = useState<ContentComment[]>([]);
  const [commentNote, setCommentNote] = useState('');
  const [commentTotal, setCommentTotal] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [nick, setNick] = useState('');
  const [sending, setSending] = useState(false);
  const [composeNote, setComposeNote] = useState<{ tone: 'ok' | 'warn' | 'danger'; text: string } | null>(null);
  const [replyFor, setReplyFor] = useState('');
  const [replyDraft, setReplyDraft] = useState('');
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});
  const [commentLikes, setCommentLikes] = useState<Record<string, boolean>>({});
  const [viewCount, setViewCount] = useState(asset?.viewCount ?? 0);
  const memberStore = useMemberStore();
  const favorited = memberStore.favorites.includes(asset?.id ?? '');
  const signedIn = memberStore.member.signedIn;
  const viewerName = memberStore.member.name;
  useEffect(() => {
    setMeasured(null);
    setShowDiff(false);
    setTab('versions');
    setActions(null);
    setComments([]);
    setCommentNote('');
    setCommentTotal(null);
    setDraft('');
    setNick('');
    setSending(false);
    setComposeNote(null);
    setReplyFor('');
    setReplyDraft('');
    setExpandedReplies({});
    setCommentLikes({});
    setViewCount(asset?.viewCount ?? 0);
  }, [asset?.id, asset?.viewCount]);
  useEffect(() => {
    if (!props.siteId || !asset?.id) return;
    let cancelled = false;
    void recordContentView(props.siteId, asset.id).then((count) => {
      if (!cancelled && count != null) setViewCount(count);
    });
    return () => {
      cancelled = true;
    };
  }, [props.siteId, asset?.id]);
  useEffect(() => {
    if (!props.siteId) return;
    let cancelled = false;
    loadContentForm(props.siteId, 'digital_asset')
      .then((form) => {
        if (!cancelled) setImageCodes(imageFieldCodes(form.nodes));
      })
      .catch(() => {
        if (!cancelled) setImageCodes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [props.siteId]);
  useEffect(() => {
    if (!props.siteId || !asset?.id) return;
    let cancelled = false;
    void loadContentActions(props.siteId, asset.id)
      .then((next) => {
        if (!cancelled) setActions(next);
      })
      .catch(() => {
        if (!cancelled) setActions(null);
      });
    void loadContentComments(props.siteId, asset.id)
      .then((next) => {
        if (cancelled) return;
        setComments(next.items);
        setCommentNote('');
        setCommentTotal(next.total);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setCommentNote(reason instanceof Error ? reason.message : '读取评论失败');
      });
    return () => {
      cancelled = true;
    };
  }, [props.siteId, asset?.id]);

  /** 拉一次评论并写回页面状态，返回最新列表，供提交后判断评论是否已公开。 */
  async function refreshComments(): Promise<ContentComment[]> {
    if (!props.siteId || !asset?.id) return [];
    try {
      const next = await loadContentComments(props.siteId, asset.id);
      setComments(next.items);
      setCommentTotal(next.total);
      setCommentNote('');
      // 评论数（含回复）以 /actions 汇总为准，提交后同步刷新
      void loadContentActions(props.siteId, asset.id)
        .then(setActions)
        .catch(() => undefined);
      return next.items;
    } catch (reason) {
      setCommentNote(reason instanceof Error ? reason.message : '读取评论失败');
      return [];
    }
  }

  async function sendComment() {
    const body = draft.trim();
    if (!props.siteId || !asset?.id || sending || !body) return;
    const nickname = nick.trim();
    if (!signedIn && (nickname.length < 2 || nickname.length > 50)) {
      setComposeNote({ tone: 'danger', text: '昵称需要 2 到 50 个字符' });
      return;
    }
    setSending(true);
    setComposeNote(null);
    try {
      const result = await submitContentComment(props.siteId, asset.id, body, {
        authorName: signedIn ? '' : nickname
      });
      setDraft('');
      const items = await refreshComments();
      setComposeNote(commentVisible(items, result.id)
        ? { tone: 'ok', text: '评论已发布' }
        : { tone: 'warn', text: '评论已提交，审核通过后会公开显示' });
    } catch (reason) {
      setComposeNote({ tone: 'danger', text: reason instanceof Error ? reason.message : '评论提交失败' });
    } finally {
      setSending(false);
    }
  }

  /**
   * 发表回复。targetId 存在且回复的是一条回复（楼中楼）时，parentId 指向被回复的那条回复
   * （其作者会收到“回复了我的评论”），并在正文前附带原回复 `// @回复用户: 评论内容`；回复第一楼则不附带。
   */
  async function sendReply(rootId: string, targetId?: string) {
    const text = replyDraft.trim();
    if (!props.siteId || !asset?.id || sending || !text) return;
    const nickname = nick.trim();
    if (!signedIn && (nickname.length < 2 || nickname.length > 50)) {
      setComposeNote({ tone: 'danger', text: '昵称需要 2 到 50 个字符' });
      return;
    }
    let body = text;
    if (targetId && targetId !== rootId) {
      const target = findComment(comments, targetId);
      if (target) body = `${quoteComment(target)}\n${text}`;
    }
    setSending(true);
    setComposeNote(null);
    try {
      const result = await submitContentComment(props.siteId, asset.id, body, {
        authorName: signedIn ? '' : nickname,
        parentId: targetId || rootId
      });
      setReplyDraft('');
      setReplyFor('');
      const items = await refreshComments();
      setComposeNote(commentVisible(items, result.id)
        ? { tone: 'ok', text: '回复已发布' }
        : { tone: 'warn', text: '回复已提交，审核通过后会公开显示' });
    } catch (reason) {
      setComposeNote({ tone: 'danger', text: reason instanceof Error ? reason.message : '回复提交失败' });
    } finally {
      setSending(false);
    }
  }

  async function likeComment(messageId: string) {
    if (!props.siteId) return;
    try {
      const result = await likeMemberComment(props.siteId, messageId);
      setCommentLikes((current) => ({ ...current, [result.id]: result.liked }));
      setComments((items) => withLikeCount(items, result.id, result.likeCount));
    } catch (reason) {
      props.onToast(reason instanceof Error ? reason.message : '点赞失败');
    }
  }

  const composeDisabled = sending || !draft.trim() || (!signedIn && nick.trim().length < 2);
  /** 回复表单：target 为 null 表示回复第一楼；否则回复该条回复（正文前附带原回复）。 */
  const replyForm = (root: ContentComment, target: ContentComment | null) => (
    <form
      className="comment-reply"
      onSubmit={(event) => {
        event.preventDefault();
        void sendReply(root.id, target ? target.id : undefined);
      }}
    >
      <textarea
        rows={2}
        value={replyDraft}
        maxLength={1000}
        autoFocus
        placeholder={`回复 ${target ? target.authorName : root.authorName}`}
        onChange={(event) => setReplyDraft(event.target.value)}
      />
      <div className="comment-actions">
        <span>{target ? '将附带 // @原用户: 原评论内容' : ''}</span>
        <button className="btn btn-primary btn-sm" type="submit" disabled={sending || !replyDraft.trim()}>
          {sending ? '提交中…' : '发布回复'}
        </button>
      </div>
    </form>
  );
  const imageAssetIds = useMemo(() => {
    const values = asset?.values ?? {};
    return Array.from(new Set(imageCodes.map((code) => mediaAssetId(values[code])).filter(Boolean)));
  }, [asset, imageCodes]);
  if (!asset) {
    return (
      <Page>
        <header className="topbar">
          <div className="topbar-left"><span className="crumb">资源库</span></div>
          <div className="topbar-right"><AccountBar /></div>
        </header>
        <div className="page-body">
          <div className="state-card">
            <span className="state-title">{props.pending ? '正在打开资源' : props.missing ? '无法打开这条资源' : '还没有打开资源'}</span>
            <span className="state-desc">
              {props.pending ? '正在读取资源目录。' : props.missing ? '它可能已删除，或当前账号不能查看。' : '从资源库选择一条已发布内容。'}
            </span>
            <button className="btn btn-primary" type="button" onClick={props.onBack}>返回资源库</button>
          </div>
        </div>
      </Page>
    );
  }

  const versions = props.catalog.versions
    .filter((item) => item.assetCode === asset.code)
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const previous = versions[1];
  const current = versions[0];
  const orientation = orientationOf(asset, measured ?? undefined);
  const portrait = orientation === 'portrait';
  const storedId = mediaAssetId(asset.storageUri);
  const stageId = storedId || (previewKind(asset.kind) === 'image' ? imageAssetIds[0] ?? '' : '');
  const extraImages = imageAssetIds.filter((id) => id !== stageId);
  const frame = measured
    ?? ((asset.width ?? 0) > 0 && (asset.height ?? 0) > 0 ? frameOf(asset) : null);
  const previewAsset = { ...asset, viewCount };
  const preview = (
    <PreviewPane
      asset={previewAsset}
      siteId={props.siteId}
      orientation={orientation}
      onMeasure={(width, height) => setMeasured({ w: width, h: height })}
      imageAssetIds={imageAssetIds}
      extra={(
        <DetailEngage
          siteId={props.siteId}
          assetId={asset.id}
          mediaId={stageId}
          external={externalUrl(asset.storageUri)}
          actions={actions}
          commentCount={actions?.commentCount ?? commentTotal ?? null}
          favorited={favorited || Boolean(actions?.favorited)}
          onCommented={() => {
            setTab('comments');
            document.getElementById('detail-history')?.scrollIntoView({ block: 'nearest' });
          }}
          onActions={setActions}
          onRecognize={() => props.onToast(asset.aiTags.length ? `AI 建议：${asset.aiTags.join('、')}` : '这条资源还没有 AI 标签')}
          onToast={props.onToast}
        />
      )}
    />
  );

  return (
    <Page>
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-btn sq" style={{ width: 32, height: 32 }} type="button" title="返回" onClick={props.onBack}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M14.5 5.5L9 11l5.5 5.5" stroke="#5F6368" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="crumb">资源库 / {asset.department || '未分部门'} / {asset.title}</span>
        </div>
        <div className="topbar-right">
          <AccountBar />
        </div>
      </header>
      <div className="page-body">
        <div className="head-row" style={{ alignItems: 'center' }}>
          <div className="grow" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 className="page-title" style={{ fontSize: 20 }}>{asset.title}</h1>
            <span className={`badge ${approvalBadge(asset.approval)}`}>
              <i className="dot" style={{ background: 'currentColor' }} />
              {approvalLabel(asset.approval)}
            </span>
            <span className="badge badge-primary">{licenseLabel(asset.license)}</span>
          </div>
        </div>

        <div className={portrait ? 'detail-port' : 'detail-land'}>
          <div className="preview-slot">{preview}</div>
          <div className="history-slot" id="detail-history">
            <div className="card">
              <div className="tabs">
                <button className={`tab ${tab === 'versions' ? 'active' : ''}`} type="button" onClick={() => setTab('versions')}>版本历史 ({versions.length || 1})</button>
                <button className={`tab ${tab === 'meta' ? 'active' : ''}`} type="button" onClick={() => setTab('meta')}>元数据</button>
                <button className={`tab ${tab === 'comments' ? 'active' : ''}`} type="button" onClick={() => setTab('comments')}>评论</button>
              </div>
              {tab === 'versions' ? (
                <>
                  <div className="timeline">
                    {(versions.length ? versions : [{ id: asset.id, label: asset.version || '当前', note: asset.summary, actor: asset.owner, updatedAt: asset.updatedAt, assetCode: asset.code, storageUri: asset.storageUri, bytes: asset.bytes }]).map((item, index) => (
                      <div className="tl-item" key={item.id}>
                        <i className={`tl-dot ${index === 0 ? 'now' : 'old'}`} />
                        <div className="tl-body">
                          <div className="tl-head">
                            <span className={`tl-ver ${index === 0 ? 'now' : ''}`}>{item.label}{index === 0 ? ' · 当前版本' : ''}</span>
                            <span className="tl-time">{formatDate(item.updatedAt)} · {item.actor || asset.owner}</span>
                          </div>
                          <span className="tl-desc">{item.note}</span>
                          {index === 0 && previous ? (
                            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                              <button className="btn btn-sm" style={{ background: 'var(--fill-neutral)', color: 'var(--primary)', fontWeight: 500 }} type="button" onClick={() => setShowDiff(true)}>
                                与上一版对比
                              </button>
                              <button className="btn btn-sm" style={{ background: 'var(--fill-neutral)', color: 'var(--text-2)', fontWeight: 500 }} type="button" onClick={() => props.onToast('版本回滚请在管理端按内容版本恢复')}>
                                恢复此版本
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                  {showDiff && current && previous ? (
                    <div className="diff-box">
                      <div className="diff-head">
                        <span className="diff-title">对比：{previous.label} → {current.label}</span>
                        <span className="badge badge-primary">字段变更</span>
                      </div>
                      <div className="diff-row">
                        <span className="diff-key">说明</span>
                        <span className="diff-val diff-old">{previous.note}</span>
                        <span className="diff-arrow">→</span>
                        <span className="diff-val diff-new">{current.note}</span>
                      </div>
                      <div className="diff-row">
                        <span className="diff-key">大小</span>
                        <span className="diff-val diff-old">{formatBytes(previous.bytes)}</span>
                        <span className="diff-arrow">→</span>
                        <span className="diff-val diff-new">{formatBytes(current.bytes)}</span>
                      </div>
                      <div className="diff-row">
                        <span className="diff-key">地址</span>
                        <span className="diff-val diff-old">{previous.storageUri || '—'}</span>
                        <span className="diff-arrow">→</span>
                        <span className="diff-val diff-new">{current.storageUri || '—'}</span>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
              {tab === 'meta' ? (
                <div className="card-pad">
                  <div className="kv"><span className="kv-k">资源编码</span><span className="kv-v num">{asset.code}</span></div>
                  <div className="kv"><span className="kv-k">摘要</span><span className="kv-v">{asset.summary}</span></div>
                  <div className="kv"><span className="kv-k">存储地址</span><span className="kv-v">{asset.storageUri || '—'}</span></div>
                  <div className="kv"><span className="kv-k">栏目</span><span className="kv-v">{asset.group || '—'}</span></div>
                  <div className="kv"><span className="kv-k">下载有效期</span><span className="kv-v num">{asset.downloadTtl || 300} 秒</span></div>
                  {asset.body ? <div className="kv"><span className="kv-k">正文</span><span className="kv-v">{asset.body}</span></div> : null}
                </div>
              ) : null}
              {tab === 'comments' ? (
                <div className="card-pad">
                  <form
                    className="comment-compose"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void sendComment();
                    }}
                  >
                    {signedIn ? (
                      <span className="comment-as">以 <strong>{viewerName || '当前账号'}</strong> 的身份发表评论</span>
                    ) : (
                      <input
                        className="comment-nick"
                        value={nick}
                        maxLength={50}
                        placeholder="昵称（2 到 50 个字符）"
                        onChange={(event) => setNick(event.target.value)}
                      />
                    )}
                    <textarea
                      rows={3}
                      value={draft}
                      maxLength={1000}
                      placeholder="写下你的评论，Enter 发布，Shift+Enter 换行"
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          void sendComment();
                        }
                      }}
                    />
                    <div className="comment-actions">
                      <span>评论在审核通过后公开显示</span>
                      <button className="btn btn-primary btn-sm" type="submit" disabled={composeDisabled}>
                        {sending ? '提交中…' : '发布评论'}
                      </button>
                    </div>
                  </form>

                  {composeNote ? <div className={`note-box note-${composeNote.tone}`}>{composeNote.text}</div> : null}
                  {commentNote ? <div className="note-box note-flat">{commentNote}</div> : null}
                  {comments.length === 0 && !commentNote ? (
                    <div className="note-box note-flat">还没有评论，来做第一个评论的人。</div>
                  ) : null}
                  <div className="feed">
                    {comments.map((item) => {
                      const expanded = Boolean(expandedReplies[item.id]);
                      const visibleReplies = expanded ? item.replies : item.replies.slice(0, 1);
                      const replyTotal = Math.max(item.replyCount, item.replies.length);
                      return (
                        <article className="feed-item" key={item.id}>
                          <div className="feed-main">
                            <div className="comment-head">
                              <span className="comment-avatar">{initialOf(item.authorName)}</span>
                              <span className="comment-nick-label"><strong>{item.authorName}</strong></span>
                              <button
                                type="button"
                                className={commentLikes[item.id] ? 'comment-like is-on' : 'comment-like'}
                                onClick={() => void likeComment(item.id)}
                              >
                                <span>{item.likeCount > 0 ? item.likeCount : '赞'}</span>
                                <ThumbIcon on={Boolean(commentLikes[item.id])} />
                              </button>
                            </div>
                            <p className="feed-body"><CommentBody body={item.body} /></p>
                            <div className="comment-meta">
                              <button
                                type="button"
                                className="comment-reply-btn"
                                onClick={() => {
                                  setReplyFor(replyFor === item.id ? '' : item.id);
                                  setReplyDraft('');
                                }}
                              >
                                回复
                              </button>
                              <span className="comment-dot">·</span>
                              <time className="feed-time">{formatWhen(item.createdAt)}</time>
                            </div>

                            {replyFor === item.id ? replyForm(item, null) : null}

                            {item.replies.length > 0 ? (
                              <div className="comment-replies">
                                {visibleReplies.map((reply) => (
                                  <div className="comment-reply-item" key={reply.id}>
                                    <div className="comment-head">
                                      <span className="comment-avatar is-small">{initialOf(reply.authorName)}</span>
                                      <span className="comment-nick-label"><strong>{reply.authorName}</strong></span>
                                      <button
                                        type="button"
                                        className={commentLikes[reply.id] ? 'comment-like is-on' : 'comment-like'}
                                        onClick={() => void likeComment(reply.id)}
                                      >
                                        <span>{reply.likeCount > 0 ? reply.likeCount : '赞'}</span>
                                        <ThumbIcon on={Boolean(commentLikes[reply.id])} />
                                      </button>
                                    </div>
                                    <p className="feed-body"><CommentBody body={reply.body} /></p>
                                    <div className="comment-meta">
                                      <button
                                        type="button"
                                        className="comment-reply-btn"
                                        onClick={() => {
                                          setReplyFor(replyFor === reply.id ? '' : reply.id);
                                          setReplyDraft('');
                                        }}
                                      >
                                        回复
                                      </button>
                                      <span className="comment-dot">·</span>
                                      <time className="feed-time">{formatWhen(reply.createdAt)}</time>
                                    </div>

                                    {replyFor === reply.id ? replyForm(item, reply) : null}
                                  </div>
                                ))}
                                {item.replies.length > 1 ? (
                                  <button
                                    type="button"
                                    className="comment-reply-toggle"
                                    onClick={() => setExpandedReplies((current) => ({ ...current, [item.id]: !expanded }))}
                                  >
                                    {expanded ? '收起回复' : `查看全部 ${replyTotal} 条回复`}
                                    <span className={expanded ? 'toggle-arrow is-open' : 'toggle-arrow'}>▾</span>
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="side-slot">
            <div className="card card-pad">
              <div className="card-head" style={{ padding: 0 }}>
                <span className="card-title">基本信息</span>
              </div>
              <div className="kv"><span className="kv-k">资源类型</span><span className="kv-v">{kindLabel(asset.kind)} · {fileExt(asset.mime, asset.kind)}</span></div>
              {frame && previewKind(asset.kind) !== 'audio' && previewKind(asset.kind) !== 'text' ? (
                <div className="kv"><span className="kv-k">画面</span><span className="kv-v num">{frame.w} × {frame.h}</span></div>
              ) : null}
              <div className="kv"><span className="kv-k">大小</span><span className="kv-v num">{formatBytes(asset.bytes)}</span></div>
              <div className="kv"><span className="kv-k">版权方</span><span className="kv-v">{asset.owner || '—'}（{asset.department || '未分部门'}）</span></div>
              <div className="kv"><span className="kv-k">更新时间</span><span className="kv-v num">{formatDate(asset.updatedAt)}</span></div>
              <div className="kv"><span className="kv-k">栏目</span><span className="kv-v">{asset.group || '—'}</span></div>
            </div>

            {extraImages.length > 0 ? (
              <div className="card card-pad">
                <div className="card-head" style={{ padding: 0 }}>
                  <span className="card-title">图片</span>
                </div>
                {extraImages.map((id) => (
                  <KnoxImage key={id} siteId={props.siteId} assetId={id} alt={asset.title} />
                ))}
              </div>
            ) : null}

            <div className="card card-pad">
              <div className="card-head" style={{ padding: 0 }}>
                <span className="card-title">版权信息</span>
                <span className={`badge ${asset.copyrightUntil && Date.parse(asset.copyrightUntil) < Date.now() ? 'badge-danger' : 'badge-success'}`}>
                  {asset.copyrightUntil && Date.parse(asset.copyrightUntil) < Date.now() ? '授权已到期' : '已登记'}
                </span>
              </div>
              <div className="kv"><span className="kv-k narrow">版权方</span><span className="kv-v">{asset.owner || '—'}</span></div>
              <div className="kv"><span className="kv-k narrow">许可</span><span className="kv-v">{licenseLabel(asset.license)}</span></div>
              <div className="kv"><span className="kv-k narrow">到期</span><span className="kv-v num">{asset.copyrightUntil ? formatDate(asset.copyrightUntil) : '未填写'}</span></div>
            </div>

            <div className="card card-pad">
              <div className="card-head" style={{ padding: 0 }}>
                <span className="card-title">标签（{asset.tags.length}）</span>
              </div>
              <div className="tag-wrap">
                {asset.tags.length === 0 ? <span className="chip chip-flat">还没有正式标签</span> : asset.tags.map((tag) => (
                  <span className="chip chip-primary" key={tag}>{tag}</span>
                ))}
              </div>
              {asset.aiTags.length > 0 ? (
                <div style={{ background: 'var(--warn-weak)', borderRadius: 'var(--r-btn)', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--warn-text)' }}>AI 自动打标建议，确认后转为正式标签</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {asset.aiTags.map((tag) => <span className="chip chip-warn" key={tag}>{tag}</span>)}
                    <span style={{ flex: 1 }} />
                    <button className="btn btn-primary btn-sm" type="button" onClick={() => props.onAdopt(asset.id)}>全部采纳</button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </Page>
  );
}

function DetailEngage(props: {
  siteId: string;
  assetId: string;
  mediaId: string;
  external?: string;
  actions: ContentActions | null;
  commentCount: number | null;
  favorited: boolean;
  onCommented: () => void;
  onActions: (actions: ContentActions) => void;
  onRecognize: () => void;
  onToast: (message: string) => void;
}) {
  const [more, setMore] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0, above: false });
  const moreRef = useRef<HTMLDivElement>(null);
  const shareRef = useRef<HTMLDivElement>(null);
  const liked = Boolean(props.actions?.liked);
  // 预览卡片是 overflow: hidden，菜单用 fixed 定位按按钮坐标显示，避免被卡片裁剪。
  function menuAnchor(event: ReactMouseEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    const above = below < 160 && rect.top > below;
    setMenuPos({
      top: above ? rect.top - 6 : rect.bottom + 6,
      right: Math.max(12, window.innerWidth - rect.right),
      above,
    });
  }
  useEffect(() => {
    if (!more && !shareOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (more && !moreRef.current?.contains(target)) setMore(false);
      if (shareOpen && !shareRef.current?.contains(target)) setShareOpen(false);
    };
    const dismiss = () => {
      setMore(false);
      setShareOpen(false);
    };
    document.addEventListener('pointerdown', close);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [more, shareOpen]);

  function fail(reason: unknown, fallback: string) {
    props.onToast(reason instanceof Error ? reason.message : fallback);
  }

  async function like() {
    if (!props.siteId) return;
    try {
      props.onActions(await toggleContentLike(props.siteId, props.assetId));
    } catch (reason) {
      fail(reason, '点赞失败');
    }
  }

  async function favorite() {
    if (!props.siteId) return;
    try {
      await toggleFavorite(props.siteId, props.assetId);
      const next = await loadContentActions(props.siteId, props.assetId);
      props.onActions(next);
    } catch (reason) {
      fail(reason, '收藏失败');
    }
  }

  async function download() {
    if (!props.mediaId && !props.external) {
      props.onToast('这条资源没有可下载的原件');
      return;
    }
    // 没有站内原件时，编辑器保存的外部地址就是可下载的文件本身。
    if (!props.mediaId && props.external) {
      window.open(props.external, '_blank', 'noopener');
      return;
    }
    try {
      await downloadContentFile(props.siteId, props.mediaId);
    } catch (reason) {
      fail(reason, '下载失败');
    }
  }

  function copyShareLink() {
    const address = detailAddress(props.siteId, props.assetId);
    const clip = navigator.clipboard;
    if (!clip || typeof clip.writeText !== 'function') {
      props.onToast('无法写入剪贴板，请手动复制地址栏链接');
      return;
    }
    void clip.writeText(address).then(
      () => props.onToast('链接已复制'),
      () => props.onToast('无法写入剪贴板，请手动复制地址栏链接')
    );
  }

  function openWeChat() {
    const address = detailAddress(props.siteId, props.assetId);
    const clip = navigator.clipboard;
    if (clip && typeof clip.writeText === 'function') {
      void clip.writeText(address).finally(() => props.onToast('链接已复制，可粘贴到微信分享'));
      return;
    }
    props.onToast('请手动复制地址栏链接后粘贴到微信');
  }

  function openWeibo() {
    const address = detailAddress(props.siteId, props.assetId);
    const url = `https://service.weibo.com/share/share.php?url=${encodeURIComponent(address)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="engage">
      <button className={`engage-btn ${liked ? 'is-on' : ''}`} type="button" title="点赞" aria-pressed={liked} onClick={() => void like()}>
        <ThumbIcon on={liked} />
        <span>点赞</span>
        <Count value={props.actions?.likeCount} />
      </button>
      <button className={`engage-btn ${props.favorited ? 'is-on' : ''}`} type="button" title="收藏" aria-pressed={props.favorited} onClick={() => void favorite()}>
        <StarIcon on={props.favorited} />
        <span>收藏</span>
        <Count value={props.actions?.favoriteCount} />
      </button>
      <button className="engage-btn" type="button" title="评论" onClick={props.onCommented}>
        <CommentIcon />
        <span>评论</span>
        <Count value={props.commentCount} />
      </button>
      <button className="engage-btn" type="button" title="下载" onClick={() => void download()}>
        <DownloadIcon />
        <span>下载</span>
      </button>
      <div className="engage-more" ref={shareRef}>
        <button
          className="engage-btn"
          type="button"
          title="分享"
          aria-expanded={shareOpen}
          onClick={(event) => {
            if (!shareOpen) menuAnchor(event);
            setShareOpen((open) => !open);
            setMore(false);
          }}
        >
          <ShareIcon />
          <span>分享</span>
        </button>
        {shareOpen ? (
          <div
            className={`engage-menu is-fixed ${menuPos.above ? 'is-above' : ''}`}
            role="menu"
            style={{ top: menuPos.top, right: menuPos.right }}
          >
            <button type="button" role="menuitem" onClick={() => { setShareOpen(false); copyShareLink(); }}>复制链接</button>
            <button type="button" role="menuitem" onClick={() => { setShareOpen(false); openWeChat(); }}>微信</button>
            <button type="button" role="menuitem" onClick={() => { setShareOpen(false); openWeibo(); }}>微博</button>
          </div>
        ) : null}
      </div>
      <button className="engage-btn" type="button" title="查看 AI 识别结果" onClick={props.onRecognize}>
        <AiIcon />
        <span>AI识别</span>
      </button>
      <div className="engage-more" ref={moreRef}>
        <button
          className="engage-btn"
          type="button"
          title="更多"
          aria-expanded={more}
          onClick={(event) => {
            if (!more) menuAnchor(event);
            setMore((open) => !open);
            setShareOpen(false);
          }}
        >
          <MoreIcon />
          <span>更多</span>
        </button>
        {more ? (
          <div
            className={`engage-menu is-fixed ${menuPos.above ? 'is-above' : ''}`}
            role="menu"
            style={{ top: menuPos.top, right: menuPos.right }}
          >
            <button type="button" role="menuitem" onClick={() => { setMore(false); props.onCommented(); }}>查看评论</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Count(props: { value: number | null | undefined }) {
  const value = props.value ?? 0;
  if (value <= 0) return null;
  const text = value > 9999 ? `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}万` : String(value);
  return <em>{text}</em>;
}

function ThumbIcon(props: { on: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={props.on ? 'currentColor' : 'none'} aria-hidden="true">
      <path d="M7.5 11.2V20H5.2A1.2 1.2 0 0 1 4 18.8v-6.4c0-.66.54-1.2 1.2-1.2H7.5Zm0 0 3.1-6.1c.3-.6.9-1 1.6-1 .9 0 1.6.7 1.6 1.6v3.5h4.7c.8 0 1.4.7 1.3 1.5l-.8 5.6a1.6 1.6 0 0 1-1.6 1.4H7.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function StarIcon(props: { on: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={props.on ? 'currentColor' : 'none'} aria-hidden="true">
      <path d="M12 3.8l2.2 4.6 5 .7-3.6 3.5.9 5.1L12 15.3 7.5 17.7l.9-5.1L4.8 9.1l5-.7L12 3.8Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 16.5 4.2 19.2A1 1 0 0 1 3 18.6V7.2A2.2 2.2 0 0 1 5.2 5h13.6A2.2 2.2 0 0 1 21 7.2v7.1a2.2 2.2 0 0 1-2.2 2.2H6Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4.5v10m0 0 3.5-3.5M12 14.5 8.5 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 16.5V19h14v-2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14 6.5 12 4.5 10 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 4.8v8.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8 9.5H6.2A1.7 1.7 0 0 0 4.5 11.2v7.1A1.7 1.7 0 0 0 6.2 20h11.6a1.7 1.7 0 0 0 1.7-1.7v-7.1a1.7 1.7 0 0 0-1.7-1.7H16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="6" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="18" cy="12" r="1.4" />
    </svg>
  );
}

function AiIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3.5l1.2 3.3L16.5 8 13.2 9.2 12 12.5 10.8 9.2 7.5 8l3.3-1.2L12 3.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M6 14.5l.7 1.8 1.8.7-1.8.7L6 19.5l-.7-1.8-1.8-.7 1.8-.7L6 14.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M17.5 13.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function commentVisible(items: ContentComment[], id: string): boolean {
  return items.some((item) => item.id === id || item.replies.some((reply) => reply.id === id));
}

/** 在评论树中按 id 查找一条评论（含回复）。 */
function findComment(items: ContentComment[], id: string): ContentComment | null {
  for (const item of items) {
    if (item.id === id) return item;
    const hit = findComment(item.replies, id);
    if (hit) return hit;
  }
  return null;
}

/** 楼中楼引用：`// @回复用户: 评论内容`，剥掉被引用内容里已有的引用行避免层层套娃。 */
function quoteComment(target: ContentComment): string {
  const source = target.body.split('\n').filter((line) => !line.startsWith('// @')).join(' ').trim()
    || target.body.trim();
  const short = source.length > 120 ? `${source.slice(0, 120)}…` : source;
  return `// @${target.authorName}: ${short}`;
}

function initialOf(name: string): string {
  return (name || '匿').trim().slice(0, 1) || '匿';
}

/** 渲染评论正文：首行为楼中楼引用时以弱色样式展示。 */
function CommentBody(props: { body: string }) {
  const body = props.body;
  const newline = body.indexOf('\n');
  if (body.startsWith('// @') && newline > 0) {
    return (
      <>
        <span className="comment-quote">{body.slice(0, newline)}</span>
        {'\n'}
        {body.slice(newline + 1)}
      </>
    );
  }
  return body;
}

function withLikeCount(items: ContentComment[], id: string, likeCount: number): ContentComment[] {
  return items.map((item) => (item.id === id
    ? { ...item, likeCount }
    : { ...item, replies: withLikeCount(item.replies, id, likeCount) }));
}

function imageFieldCodes(nodes: ContentFormNode[]): string[] {
  const codes: string[] = [];
  for (const node of nodes) {
    if (node.field?.fieldType === 'IMAGE' && node.field.code) codes.push(node.field.code);
    if (node.children?.length) codes.push(...imageFieldCodes(node.children));
  }
  return codes;
}
