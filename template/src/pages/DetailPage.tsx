import { useEffect, useMemo, useState } from 'react';
import { loadContentForm, type ContentFormNode } from '../api';
import { AccountBar } from '../account';
import { approvalBadge, approvalLabel, fileExt, formatBytes, formatDate, kindLabel, licenseLabel } from '../format';
import { frameOf, layoutLabel, mediaAssetId, orientationOf, previewKind } from '../preview';
import type { Asset, Catalog } from '../types';
import { Page } from '../ui';
import { KnoxImage } from './KnoxImage';
import { PreviewPane } from './PreviewPane';

function DetailAddress(props: { siteId: string; assetId: string; onToast: (message: string) => void }) {
  const address = detailAddress(props.siteId, props.assetId);
  return (
    <div className="detail-address">
      <span className="detail-address-label">详情地址</span>
      <input
        id="detail-address"
        className="detail-address-input"
        readOnly
        value={address}
        aria-label="详情地址"
        onFocus={(event) => event.currentTarget.select()}
      />
      <button
        className="btn btn-ghost btn-sm"
        type="button"
        onClick={() => {
          const done = (ok: boolean) => props.onToast(ok ? '详情地址已复制，可在其他浏览器打开' : '无法写入剪贴板，请选中地址后复制');
          let settled = false;
          const finish = (ok: boolean) => {
            if (settled) return;
            settled = true;
            done(ok);
          };
          const fallback = () => {
            const field = document.getElementById('detail-address');
            if (field instanceof HTMLInputElement) {
              field.focus();
              field.select();
              try {
                finish(document.execCommand('copy'));
                return;
              } catch {
                /* 选中地址，交给用户复制 */
              }
            }
            finish(false);
          };
          const clip = navigator.clipboard;
          if (!clip || typeof clip.writeText !== 'function') {
            fallback();
            return;
          }
          void clip.writeText(address).then(() => finish(true), fallback);
          window.setTimeout(() => {
            if (!settled) fallback();
          }, 400);
        }}
      >
        复制地址
      </button>
    </div>
  );
}

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
  useEffect(() => {
    setMeasured(null);
    setShowDiff(false);
    setTab('versions');
  }, [asset?.id]);
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
  const preview = (
    <PreviewPane
      asset={asset}
      siteId={props.siteId}
      orientation={orientation}
      onMeasure={(width, height) => setMeasured({ w: width, h: height })}
      imageAssetIds={imageAssetIds}
      extra={(
        <button className="btn btn-sm" style={{ background: 'var(--primary-weak)', color: 'var(--primary)', fontWeight: 500 }} type="button" onClick={() => props.onToast(asset.aiTags.length ? `AI 建议：${asset.aiTags.join('、')}` : '这条资源还没有 AI 标签')}>
          查看 AI 识别结果
        </button>
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
            <span className="badge badge-neutral">{layoutLabel(previewKind(asset.kind), orientation)}</span>
          </div>
        </div>
        <DetailAddress siteId={props.siteId} assetId={asset.id} onToast={props.onToast} />

        <div className={portrait ? 'detail-port' : 'detail-land'}>
          <div className="preview-slot">{preview}</div>
          <div className="history-slot">
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
                  <div className="note-box note-flat">评论保存在管理端互动模块。这里只展示资源目录，不代替审核。</div>
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

function imageFieldCodes(nodes: ContentFormNode[]): string[] {
  const codes: string[] = [];
  for (const node of nodes) {
    if (node.field?.fieldType === 'IMAGE' && node.field.code) codes.push(node.field.code);
    if (node.children?.length) codes.push(...imageFieldCodes(node.children));
  }
  return codes;
}
