import { useEffect, useMemo, useRef, useState } from 'react';
import { AccountBar } from '../account';
import {
  createMemberUpload,
  loadContentForm,
  loadCurrentMember,
  loadMediaLibrary,
  uploadMemberFile,
  type ContentForm,
  type ContentFormField,
  type ContentFormNode,
  type LibraryMediaRow
} from '../api';
import { formatBytes } from '../format';
import { externalUrl, mediaAssetId } from '../preview';
import type { AssetKind, ResourceGroup } from '../types';
import { Page, UploadIcon } from '../ui';
import { KnoxImage } from './KnoxImage';

interface QueueItem {
  id: string;
  name: string;
  size: number;
  mime: string;
  kind: AssetKind;
  folderId: string;
  status: 'uploading' | 'done' | 'failed' | 'aborted';
  progress: number;
  note: string;
  assetId: string;
}

/** 关联媒体行（表单态）：已上传文件与媒体库选择共用，提交时整体写入 media_items 重复组。 */
interface LinkedMedia {
  key: string;
  /** 资产 id（UUID）或外部 http(s) 地址 —— MEDIA_REF 接受的形态 */
  storageUri: string;
  title: string;
  kind: AssetKind;
  mime: string;
  bytes: number;
  /** 图片类：预览图资产编号（IMAGE 字段约定值）；其余类型留空由服务端按类型回退 */
  thumb: string;
  summary: string;
  tags: string;
  source: 'upload' | 'library';
}

const VIDEO_EXT = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'];
const MEDIA_KINDS: AssetKind[] = ['image', 'video', 'audio', 'document', 'other'];

/** 上传完成的队列项 → 关联媒体行（已传到 Knox-Media 的资产作为一条 media_items 行）。 */
function linkedFromUpload(item: QueueItem): LinkedMedia {
  return {
    key: `upload-${item.assetId}`,
    storageUri: item.assetId,
    title: item.name,
    kind: item.kind,
    mime: item.mime,
    bytes: item.size,
    thumb: item.kind === 'image' ? item.assetId : '',
    summary: '',
    tags: '',
    source: 'upload'
  };
}

export function UploadPage(props: { folders: ResourceGroup[]; siteId: string; onToast: (message: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const jobs = useRef(new Map<string, AbortController>());
  const dropped = useRef(new Set<string>());
  const [items, setItems] = useState<QueueItem[]>([]);
  const [folderId, setFolderId] = useState('');
  const [form, setForm] = useState<ContentForm | null>(null);
  const [formError, setFormError] = useState('');
  // 聚合表单：多个上传文件与媒体库选择共用一份数字资源表单（多文件 → 一个资源的多个关联媒体）
  const [values, setValues] = useState<Record<string, string>>({});
  const [linked, setLinked] = useState<LinkedMedia[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [memberGroups, setMemberGroups] = useState<string[]>([]);
  const seeded = useRef(false);
  const allowed = props.folders.some((folder) => folder.id === folderId) ? folderId : '';
  const folder = props.folders.find((item) => item.id === allowed);
  const done = useMemo(() => items.filter((item) => item.status === 'done'), [items]);
  const fields = useMemo(() => (form ? collectFields(form.nodes) : []), [form]);

  useEffect(() => {
    if (props.folders.length === 1) setFolderId(props.folders[0].id);
  }, [props.folders]);

  useEffect(() => {
    const running = jobs.current;
    return () => {
      for (const job of running.values()) job.abort();
      running.clear();
    };
  }, []);

  useEffect(() => {
    if (done.length === 0) {
      setShowForm(false);
      setLinked([]);
      seeded.current = false;
    }
  }, [done.length]);

  useEffect(() => {
    if (!props.siteId || !showForm || done.length === 0) return;
    let cancelled = false;
    loadContentForm(props.siteId, 'digital_asset')
      .then((next) => {
        if (cancelled) return;
        setForm(next);
        setFormError('');
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setForm(null);
        setFormError(reason instanceof Error ? reason.message : '数字资源表单布局尚未就绪');
      });
    return () => {
      cancelled = true;
    };
  }, [props.siteId, done.length, showForm]);

  // 表单初始值：以第一个上传文件种一次（用户已输入的值优先）
  useEffect(() => {
    if (!form || seeded.current || done.length === 0) return;
    seeded.current = true;
    const first = done[0];
    setValues((current) => ({ ...initialValues(fields, first, folder?.title ?? ''), ...current }));
  }, [form, done, fields, folder?.title]);

  // 上传完成的文件自动成为关联媒体行（多文件 → 一个资源的多个关联媒体）
  useEffect(() => {
    if (done.length === 0) return;
    setLinked((current) => {
      const have = new Set(current.map((row) => row.storageUri));
      const added = done
        .filter((item) => item.assetId && !have.has(item.assetId))
        .map((item) => linkedFromUpload(item));
      return added.length ? [...current, ...added] : current;
    });
  }, [done]);

  useEffect(() => {
    if (!form) return;
    const folderTitle = folder?.title ?? '';
    if (folderTitle && !values.resource_group_s) {
      setValues((current) => (current.resource_group_s ? current : { ...current, resource_group_s: folderTitle }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, folder?.title]);

  // 当前会员组（如「市场部」）：所属部门的自动填写来源，仅取一次。
  // access-member / access-vip 是通用会员等级组、不表达部门，优先取部门类分组
  // （如站点上绑定的 dam-mkt「市场部」），全部为通用组时才回退首个组名。
  useEffect(() => {
    let cancelled = false;
    void loadCurrentMember()
      .then((me) => {
        if (cancelled || !me) return;
        const names = me.groups.map((name, index) => ({ name, code: me.groupCodes[index] ?? '' }));
        const departments = names.filter((entry) => entry.name && !entry.code.startsWith('access-'));
        setMemberGroups((departments.length > 0 ? departments : names)
          .map((entry) => entry.name.trim())
          .filter((name) => name.length > 0));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // 所属部门自动填写：表单打开后若仍为空，取当前会员的首个会员组（不覆盖用户输入）
  useEffect(() => {
    if (!form || !showForm || memberGroups.length === 0) return;
    const department = memberGroups[0];
    setValues((current) => (current.department_s?.trim() ? current : { ...current, department_s: department }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, showForm, memberGroups]);

  function patchItem(id: string, partial: Partial<QueueItem>) {
    if (dropped.current.has(id)) return;
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...partial } : item)));
  }

  function beginUpload(item: QueueItem, file: File) {
    if (!props.siteId) {
      patchItem(item.id, { status: 'failed', note: '缺少站点，无法上传' });
      return;
    }
    const job = new AbortController();
    jobs.current.set(item.id, job);
    void uploadMemberFile(props.siteId, item.folderId, file, (progress) => {
      patchItem(item.id, { progress, note: `正在上传 ${progress}%` });
    }, job.signal).then((stored) => {
      jobs.current.delete(item.id);
      patchItem(item.id, { status: 'done', progress: 100, note: '已完成', assetId: stored.assetId });
    }).catch((reason: unknown) => {
      jobs.current.delete(item.id);
      if (dropped.current.has(item.id)) return;
      const aborted = reason instanceof DOMException && reason.name === 'AbortError';
      patchItem(item.id, aborted
        ? { status: 'aborted', note: '已中止' }
        : { status: 'failed', note: reason instanceof Error ? reason.message : '上传失败' });
    });
  }

  function addFiles(files: FileList | null) {
    if (!folder) {
      props.onToast(props.folders.length === 0 ? '当前会员组没有可上传的栏目' : '请先选择有上传权限的栏目');
      return;
    }
    if (!files || files.length === 0) return;
    const next = Array.from(files).map((file) => {
      const tooLarge = file.size > 5 * 1024 * 1024 * 1024;
      const item: QueueItem = {
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        size: file.size,
        mime: file.type,
        kind: fileKind(file),
        folderId: folder.id,
        status: tooLarge ? 'failed' : 'uploading',
        progress: 0,
        note: tooLarge ? '超出单文件 5 GB 限制，请压缩后重试' : '正在上传 0%',
        assetId: ''
      };
      return { item, file };
    });
    setItems((current) => [...next.map((entry) => entry.item), ...current]);
    for (const entry of next) {
      if (entry.item.status === 'uploading') beginUpload(entry.item, entry.file);
    }
    props.onToast(next.some((entry) => entry.item.status === 'failed') ? '有文件超出大小限制' : `文件已加入「${folder.title}」的上传队列`);
  }

  function stopItem(id: string) {
    jobs.current.get(id)?.abort();
  }

  function removeItem(id: string) {
    dropped.current.add(id);
    jobs.current.get(id)?.abort();
    jobs.current.delete(id);
    const removed = items.find((item) => item.id === id);
    setItems((current) => current.filter((row) => row.id !== id));
    setValues((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    if (removed?.assetId) {
      const assetId = removed.assetId;
      setLinked((current) => current.filter((row) => row.source !== 'upload' || row.storageUri !== assetId));
    }
  }

  function clearFinished() {
    const removed = items.filter((item) => item.status === 'done');
    for (const item of removed) dropped.current.add(item.id);
    const removedAssets = new Set(removed.map((item) => item.assetId).filter(Boolean));
    setItems((current) => current.filter((item) => item.status !== 'done'));
    setValues((current) => {
      const next = { ...current };
      for (const item of removed) delete next[item.id];
      return next;
    });
    setLinked((current) => current.filter((row) => row.source !== 'upload' || !removedAssets.has(row.storageUri)));
  }

  function changeValue(code: string, value: string) {
    setValues((current) => ({ ...current, [code]: value }));
  }

  /** 媒体库选择：加一行关联媒体，并对仍为空的表单字段自动填写（标题/编码/类型/摘要等）。 */
  function pickFromLibrary(row: LibraryMediaRow) {
    const kind: AssetKind = MEDIA_KINDS.includes(row.kind as AssetKind) ? row.kind as AssetKind : 'other';
    const title = row.filename || row.title || '未命名媒体';
    setLinked((current) => current.some((item) => item.storageUri === row.id)
      ? current
      : [...current, {
        key: `library-${row.id}`,
        storageUri: row.id,
        title,
        kind,
        mime: row.mimeType,
        bytes: row.fileSize,
        thumb: kind === 'image' ? row.id : '',
        summary: row.summary || row.title || '',
        tags: row.tags || '',
        source: 'library'
      }]);
    autofillFromMedia({ title, kind, mime: row.mimeType, bytes: row.fileSize, summary: row.summary || row.title || '', tags: row.tags || '', thumb: kind === 'image' ? row.id : '' });
    props.onToast(`已添加关联媒体「${title}」，空白字段已自动填写`);
  }

  /** 仅填写仍为空的字段：不覆盖用户已输入的内容。 */
  function autofillFromMedia(media: { title: string; kind: string; mime: string; bytes: number; summary: string; tags: string; thumb: string }) {
    setValues((current) => {
      const next = { ...current };
      const base = media.title.replace(/\.[^.]+$/, '') || media.title;
      const fill = (code: string, value: string) => {
        if (value && !(next[code] ?? '').trim()) next[code] = value;
      };
      fill('asset_code_s', base);
      fill('asset_kind_s', media.kind);
      fill('summary_t', media.summary);
      fill('body_t', media.summary);
      fill('mime_type_s', media.mime);
      fill('file_size_i', media.bytes ? String(media.bytes) : '');
      fill('thumbnail_url_s', media.thumb);
      fill('ai_tags_ss', media.tags);
      return next;
    });
  }

  function cancelForm() {
    if (submitting) return;
    setShowForm(false);
    setSubmitError('');
  }

  function validateForm(): string {
    if (!form) return formError || '数字资源表单布局尚未就绪';
    for (const field of fields) {
      if (!field.required || field.fieldType === 'BOOLEAN') continue;
      if (!(values[field.code] ?? '').trim()) {
        return `请填写${field.name}`;
      }
    }
    return '';
  }

  async function submitForm() {
    if (submitting || !props.siteId) return;
    const problem = validateForm();
    if (problem) {
      setSubmitError(problem);
      props.onToast(problem);
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      const firstTitle = linked[0]?.title ?? '';
      const title = (values.asset_code_s || firstTitle.replace(/\.[^.]+$/, '') || firstTitle || '未命名资源').trim();
      const payload: Record<string, string> = { ...values };
      if (linked.length > 0) {
        // 关联媒体整体写入 media_items 重复组（后端把 JSON 数组字符串解析为行数组）
        payload.media_items = JSON.stringify(linked.map((row) => ({
          media_storage_uri_s: row.storageUri,
          media_title_s: row.title,
          media_kind_s: row.kind,
          ...(row.mime ? { media_mime_type_s: row.mime } : {}),
          ...(row.bytes ? { media_file_size_i: String(row.bytes) } : {}),
          ...(row.thumb ? { media_thumbnail_url_s: row.thumb } : {}),
          ...(row.summary ? { media_summary_t: row.summary } : {})
        })));
      }
      await createMemberUpload(props.siteId, allowed, title, payload);
      for (const item of done) dropped.current.add(item.id);
      setItems((current) => current.filter((item) => item.status !== 'done'));
      setValues({});
      setLinked([]);
      seeded.current = false;
      setShowForm(false);
      props.onToast('已提交审核，可在「我的上传」查看');
    } catch (reason: unknown) {
      setSubmitError(reason instanceof Error ? reason.message : '提交失败');
      props.onToast(reason instanceof Error ? reason.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  if (showForm && done.length > 0) {
    return (
      <Page>
        <header className="topbar">
          <div className="topbar-left"><span className="crumb">资源管理&nbsp;&nbsp;/&nbsp;&nbsp;上传中心&nbsp;&nbsp;/&nbsp;&nbsp;填写资料</span></div>
          <div className="topbar-right">
            <button className="btn btn-ghost" type="button" disabled={submitting} onClick={cancelForm}>取消</button>
            <button className="btn btn-primary" type="button" disabled={submitting || !form} onClick={() => void submitForm()}>
              {submitting ? '提交中…' : '提交'}
            </button>
            <AccountBar />
          </div>
        </header>
        <div className="page-body">
          <div className="page-head">
            <h1 className="page-title">{form?.name || '填写数字资源'}</h1>
            <p className="page-sub">
              共 {done.length} 个已上传文件 · {linked.length} 个关联媒体 · 提交后自动提交审核（可在「我的上传」查看进度）
              {folder ? ` · 栏目「${folder.title}」` : ''}
            </p>
          </div>
          <div className="card">
            {formError ? <div className="card-note">{formError}</div> : null}
            {submitError ? <div className="card-note" style={{ color: 'var(--danger-text)' }}>{submitError}</div> : null}
            {!form && !formError ? <div className="card-note">正在读取数字资源表单…</div> : null}
            {form ? (
              <FormNodes nodes={form.nodes} values={values} siteId={props.siteId} folderId={allowed} onChange={changeValue} />
            ) : null}
            {/* 关联媒体：本次上传的多个文件与从媒体库选择的已有媒体，整体写入 media_items 重复组 */}
            <section className="linked-media">
              <div className="linked-media-head">
                <h3>关联媒体（{linked.length}）</h3>
                <span className="linked-media-sub">多个媒体将作为同一资源的关联媒体；从媒体库选择媒体后，空白字段会自动填写</span>
                <span className="linked-media-actions">
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => setPickerOpen(true)}>从媒体库选择</button>
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => inputRef.current?.click()}>上传新媒体</button>
                </span>
              </div>
              <input
                ref={inputRef}
                type="file"
                multiple
                hidden
                onChange={(event) => {
                  addFiles(event.target.files);
                  event.target.value = '';
                }}
              />
              {linked.length === 0 ? (
                <div className="card-note">还没有关联媒体。本次上传的文件会自动加入；也可从媒体库选择已有媒体。</div>
              ) : (
                <div className="linked-media-list">
                  {linked.map((row, index) => (
                    <div className="linked-media-row" key={row.key}>
                      <span className="media-item-thumb">
                        {row.thumb
                          ? <KnoxImage siteId={props.siteId} assetId={row.thumb} alt="" />
                          : <span className="media-item-thumb-empty">{kindLabel(row.kind)}</span>}
                      </span>
                      <span className="media-item-body">
                        <span className="media-item-title">{row.title || `媒体 ${index + 1}`}</span>
                        <span className="media-item-sub">
                          {kindLabel(row.kind)}{row.mime ? ` · ${row.mime}` : ''}{row.bytes ? ` · ${formatBytes(row.bytes)}` : ''}{row.source === 'library' ? ' · 媒体库' : ' · 本次上传'}
                        </span>
                      </span>
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        onClick={() => setLinked((current) => current.filter((item) => item.key !== row.key))}
                      >
                        移除
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <div className="form-actions">
              <button className="btn btn-ghost" type="button" disabled={submitting} onClick={cancelForm}>取消</button>
              <button className="btn btn-primary" type="button" disabled={submitting || !form} onClick={() => void submitForm()}>
                {submitting ? '提交中…' : '提交'}
              </button>
            </div>
          </div>
          {pickerOpen ? (
            <MediaPickerModal siteId={props.siteId} onClose={() => setPickerOpen(false)} onPick={pickFromLibrary} />
          ) : null}
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <header className="topbar">
        <div className="topbar-left"><span className="crumb">资源管理&nbsp;&nbsp;/&nbsp;&nbsp;上传中心</span></div>
        <div className="topbar-right">
          <button className="btn btn-ghost" type="button" onClick={clearFinished}>
            清空已完成
          </button>
          {props.folders.length > 0 ? (
            <button className="btn btn-primary" type="button" onClick={() => {
              if (!allowed) {
                props.onToast('请先选择有上传权限的栏目');
                return;
              }
              inputRef.current?.click();
            }}>
              <UploadIcon />
              选择文件
            </button>
          ) : null}
          <AccountBar />
        </div>
      </header>
      <div className="page-body">
        <div className="page-head">
          <h1 className="page-title">上传中心</h1>
          <p className="page-sub">
            {props.folders.length === 0
              ? '上传由站点栏目上的会员组授权决定'
              : '只能上传到会员组拥有「添加子项」的栏目 · 单文件不超过 5 GB'}
          </p>
        </div>
        <div className="card card-pad">
          {props.folders.length === 0 ? (
            <div className="state-card" style={{ border: 'none', padding: 0 }}>
              <span className="state-title">当前不能上传</span>
              <span className="state-desc">
                你的会员组在可上传的栏目上没有「添加子项」。栏目打破继承后按栏目自己的授权判断；未打破时沿用站点上的会员组权利。
              </span>
            </div>
          ) : (
          <>
          <div className="field" style={{ marginBottom: 16 }}>
            <span className="field-label">上传栏目</span>
            <select className="select" value={allowed} onChange={(event) => setFolderId(event.target.value)}>
              <option value="">请选择有上传权限的栏目</option>
              {props.folders.map((item) => (
                <option key={item.id} value={item.id}>{item.title}</option>
              ))}
            </select>
          </div>
          <div
            className="dropzone"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              addFiles(event.dataTransfer.files);
            }}
          >
            <div className="drop-icon"><UploadIcon color="#1A73E8" /></div>
            <span className="drop-main">将文件拖拽到此处，或点击选择文件</span>
            <span className="drop-sub">单文件 ≤ 5 GB · 图片 / 音视频 / 文档 / PDF / 文本</span>
            <button className="btn btn-primary" type="button" onClick={() => {
              if (!allowed) {
                props.onToast('请先选择有上传权限的栏目');
                return;
              }
              inputRef.current?.click();
            }}>浏览文件</button>
            <input ref={inputRef} type="file" multiple hidden onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = '';
            }} />
          </div>
          <div className="format-row">
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)' }}>支持格式</span>
            <span className="format-chip">图片 JPG / PNG / WEBP / GIF</span>
            <span className="format-chip">音视频 MP3 / WAV · MP4 / MOV</span>
            <span className="format-chip">文档 PDF / DOCX / XLSX / PPTX / TXT</span>
          </div>
          </>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title">上传队列（{items.length}）</span>
            <button className="btn-text" type="button" onClick={() => {
              for (const id of items.map((item) => item.id)) {
                dropped.current.add(id);
                jobs.current.get(id)?.abort();
              }
              jobs.current.clear();
              setItems([]);
              setValues({});
              setLinked([]);
              seeded.current = false;
            }}>清空</button>
          </div>
          {items.length === 0 ? (
            <div className="card-note">队列为空。选择文件后会在这里上传，完成后点击下一步填写数字资源。</div>
          ) : items.map((item) => (
            <div className={`row ${item.status === 'failed' ? 'is-failed' : ''}`} key={item.id}>
              <div className={`file-icon ${item.status === 'failed' ? 'red' : item.status === 'done' ? 'green' : item.status === 'aborted' ? 'yellow' : 'blue'}`} />
              <div className="row-col">
                <span className="row-title">{item.name} · {formatBytes(item.size)}</span>
                {item.status === 'uploading' ? (
                  <span className="row-progress" aria-hidden="true"><i style={{ width: `${item.progress}%` }} /></span>
                ) : null}
                <span className="row-sub" style={{ color: item.status === 'failed' ? 'var(--danger-text)' : item.status === 'aborted' ? 'var(--warn-text)' : 'var(--text-2)' }}>{item.note}</span>
              </div>
              {item.status === 'uploading' ? (
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => stopItem(item.id)}>中止</button>
              ) : null}
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => removeItem(item.id)}>删除</button>
            </div>
          ))}
          {done.length > 0 ? (
            <div className="card-pad" style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" type="button" onClick={() => { setSubmitError(''); setShowForm(true); }}>下一步</button>
            </div>
          ) : null}
        </div>
      </div>
    </Page>
  );
}

function FormNodes(props: {
  nodes: ContentFormNode[];
  values: Record<string, string>;
  siteId: string;
  folderId: string;
  onChange: (code: string, value: string) => void;
}) {
  const [tabs, setTabs] = useState<Record<number, number>>({});
  return (
    <>
      {props.nodes.map((node, index) => {
        // 重复组（media_items）由「关联媒体」编辑器负责（行 = 上传文件/媒体库选择），
        // 表单平铺渲染其子字段没有意义 —— 整棵子树跳过。
        if (node.elementType === 'REPEAT_GROUP') return null;
        if (node.elementType === 'TAB') {
          const pages = node.children ?? [];
          const selected = tabs[index] ?? 0;
          const current = pages[Math.min(selected, Math.max(pages.length - 1, 0))];
          return (
            <div key={`tab-${index}`}>
              <div className="tabs" role="tablist">
                {pages.map((page, pageIndex) => (
                  <button
                    key={`${page.title}-${pageIndex}`}
                    className={`tab ${pageIndex === selected ? 'active' : ''}`}
                    type="button"
                    role="tab"
                    aria-selected={pageIndex === selected}
                    onClick={() => setTabs((currentTabs) => ({ ...currentTabs, [index]: pageIndex }))}
                  >
                    <span>{page.title || `页签 ${pageIndex + 1}`}</span>
                  </button>
                ))}
              </div>
              {current ? (
                <FormNodes nodes={current.children ?? []} values={props.values} siteId={props.siteId} folderId={props.folderId} onChange={props.onChange} />
              ) : null}
            </div>
          );
        }
        if (node.elementType === 'LINE_DIVIDER') return <hr key={`line-${index}`} />;
        if (node.elementType === 'FIELD' && node.field) {
          return (
            <FieldControl
              key={node.field.code}
              field={node.field}
              siteId={props.siteId}
              folderId={props.folderId}
              value={props.values[node.field.code] ?? ''}
              onChange={(value) => props.onChange(node.field!.code, value)}
            />
          );
        }
        const children = node.children ?? [];
        if (children.length === 0 && !node.title) return null;
        return (
          <section key={`section-${index}`}>
            {node.title ? <h3>{node.title}</h3> : null}
            <FormNodes nodes={children} values={props.values} siteId={props.siteId} folderId={props.folderId} onChange={props.onChange} />
          </section>
        );
      })}
    </>
  );
}

function FieldControl(props: {
  field: ContentFormField;
  siteId: string;
  folderId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { field, value, onChange } = props;
  return (
    <label>
      {field.name}{field.required ? ' *' : ''}
      <FieldInput field={field} siteId={props.siteId} folderId={props.folderId} value={value} onChange={onChange} />
      {field.helpText ? <span>{field.helpText}</span> : null}
    </label>
  );
}

function FieldInput(props: {
  field: ContentFormField;
  siteId: string;
  folderId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { field, value, onChange } = props;
  if (field.fieldType === 'MEDIA_REF') {
    return (
      <MediaRefInput
        siteId={props.siteId}
        folderId={props.folderId}
        value={value}
        readOnly={field.readOnly}
        onChange={onChange}
      />
    );
  }
  if (field.fieldType === 'IMAGE') {
    return (
      <ImageInput
        siteId={props.siteId}
        folderId={props.folderId}
        value={value}
        readOnly={field.readOnly}
        onChange={onChange}
      />
    );
  }
  if (field.fieldType === 'BOOLEAN') {
    return (
      <input
        type="checkbox"
        checked={value === 'true'}
        disabled={field.readOnly}
        onChange={(event) => onChange(event.target.checked ? 'true' : 'false')}
      />
    );
  }
  if (field.fieldType === 'LONG_TEXT' || field.fieldType === 'RICH_TEXT') {
    return <textarea rows={4} value={value} readOnly={field.readOnly} onChange={(event) => onChange(event.target.value)} />;
  }
  if (field.fieldType === 'ENUM') {
    return (
      <select value={value} disabled={field.readOnly} onChange={(event) => onChange(event.target.value)}>
        <option value="">请选择</option>
        {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    );
  }
  if (field.fieldType === 'MULTI_ENUM') {
    const selected = value ? value.split(',') : [];
    return (
      <select
        multiple
        value={selected}
        disabled={field.readOnly}
        onChange={(event) => onChange(Array.from(event.target.selectedOptions).map((option) => option.value).join(','))}
      >
        {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    );
  }
  const type = field.fieldType === 'INTEGER' || field.fieldType === 'DECIMAL'
    ? 'number'
    : field.fieldType === 'DATE'
      ? 'date'
      : field.fieldType === 'DATE_TIME'
        ? 'datetime-local'
        : 'text';
  return <input type={type} value={value} readOnly={field.readOnly} onChange={(event) => onChange(event.target.value)} />;
}

function ImageInput(props: {
  siteId: string;
  folderId: string;
  value: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
}) {
  const assetId = mediaAssetId(props.value);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <span className="image-field">
      {assetId && props.siteId ? <KnoxImage siteId={props.siteId} assetId={assetId} alt="" /> : null}
      {props.readOnly ? null : (
        <input
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            const image = file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name);
            if (!image) {
              setNote('请选择图片文件');
              return;
            }
            if (!props.siteId || !props.folderId) {
              setNote('缺少栏目，无法上传');
              return;
            }
            setBusy(true);
            setNote('正在上传到 Knox-Media');
            const job = new AbortController();
            void uploadMemberFile(props.siteId, props.folderId, file, (percent) => {
              setNote(`正在上传 ${percent}%`);
            }, job.signal).then((stored) => {
              props.onChange(stored.assetId);
              setNote('已上传到 Knox-Media');
            }).catch((reason: unknown) => {
              setNote(reason instanceof Error ? reason.message : '图片上传失败');
            }).finally(() => setBusy(false));
          }}
        />
      )}
      {note ? <span>{note}</span> : null}
    </span>
  );
}

/**
 * MEDIA_REF（原件引用）字段：会员把原件传到 Knox-Media 后写入资产 id。
 * 后端只接受「资产 id / mediaRef JSON / 外部 http(s) 地址」，media:// 之类的占位串保存会被拒，
 * 因此这里默认写入上传返回的 assetId，而不是文件名。
 */
function MediaRefInput(props: {
  siteId: string;
  folderId: string;
  value: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const assetId = mediaAssetId(props.value);
  const external = externalUrl(props.value);
  const bound = assetId || external;
  return (
    <span className="media-ref-field">
      <span className={bound ? 'chip chip-primary' : props.value ? 'chip chip-warn' : 'chip chip-flat'}>
        {assetId
          ? `已绑定原件 ${assetId.slice(0, 8)}…`
          : external
            ? `外部地址 ${props.value}`
            : props.value
              ? `引用无法识别：${props.value}`
              : '还没有绑定原件'}
      </span>
      {props.readOnly ? null : (
        <>
          <input
            ref={inputRef}
            type="file"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              if (!props.siteId || !props.folderId) {
                setNote('缺少栏目，无法上传');
                return;
              }
              setBusy(true);
              setNote('正在上传原件到 Knox-Media');
              const job = new AbortController();
              void uploadMemberFile(props.siteId, props.folderId, file, (percent) => {
                setNote(`正在上传 ${percent}%`);
              }, job.signal).then((stored) => {
                props.onChange(stored.assetId);
                setNote('已绑定原件；媒体处理就绪后即可预览与下载');
              }).catch((reason: unknown) => {
                setNote(reason instanceof Error ? reason.message : '上传失败');
              }).finally(() => setBusy(false));
            }}
          />
          <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? '上传中…' : bound ? '更换原件' : '上传原件'}
          </button>
        </>
      )}
      {note ? <span className="media-ref-note">{note}</span> : null}
    </span>
  );
}

function collectFields(nodes: ContentFormNode[]): ContentFormField[] {
  const fields: ContentFormField[] = [];
  for (const node of nodes) {
    // 重复组（media_items）的子字段按行存储（值挂在组编码的行数组里），上传表单是平铺
    // 单值录入，写不进行组 —— 整棵子树跳过，多媒体在管理端内容表单逐行维护。
    if (node.elementType === 'REPEAT_GROUP') continue;
    if (node.field) fields.push(node.field);
    if (node.children?.length) fields.push(...collectFields(node.children));
  }
  return fields;
}

function initialValues(fields: ContentFormField[], item: QueueItem, folderTitle: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    let value = field.defaultValue ?? '';
    if (field.code === 'mime_type_s' && item.mime) value = item.mime;
    if (field.code === 'file_size_i') value = String(item.size);
    if (field.code === 'asset_kind_s') value = item.kind;
    if (field.code === 'resource_group_s' && folderTitle) value = folderTitle;
    if (field.code === 'asset_code_s' && !value) value = item.name.replace(/\.[^.]+$/, '') || item.name;
    if (field.code === 'approval_status_s') value = 'pending';
    if (field.fieldType === 'MEDIA_REF' && !value) value = item.assetId;
    values[field.code] = value;
  }
  return values;
}

function fileKind(file: File): AssetKind {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (file.type.startsWith('video/') || VIDEO_EXT.includes(ext)) return 'video';
  if (file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image';
  if (file.type.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac'].includes(ext)) return 'audio';
  // PDF 归入文档（文档预览本就用 pdf.js 渲染整份 PDF）；纯文本没有独立类型，落「其他」。
  if (ext === 'pdf' || file.type === 'application/pdf') return 'document';
  if (['txt', 'md'].includes(ext) || file.type.startsWith('text/')) return 'other';
  return 'document';
}

const KIND_LABELS: Record<string, string> = { image: '图片', video: '视频', audio: '音频', document: '文档', other: '其他' };

function kindLabel(kind: string) {
  return KIND_LABELS[kind] ?? '媒体';
}

/**
 * 媒体库选择弹窗：列本站 ACTIVE 媒体资产（登录会员），点击「添加」即作为一条关联媒体行，
 * 上传中心随即将资产元数据（标题/编码/类型/摘要/MIME/大小/预览图/AI 标签）填入仍为空的表单字段。
 */
function MediaPickerModal(props: { siteId: string; onClose: () => void; onPick: (row: LibraryMediaRow) => void }) {
  const [rows, setRows] = useState<LibraryMediaRow[] | null>(null);
  const [error, setError] = useState('');
  const [kind, setKind] = useState('');
  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError('');
    loadMediaLibrary(props.siteId, kind || undefined)
      .then((next) => {
        if (!cancelled) setRows(next);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setRows([]);
          setError(reason instanceof Error ? reason.message : '媒体库加载失败');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.siteId, kind]);
  return (
    <div className="modal-mask" onClick={props.onClose} role="presentation">
      <div className="modal-card media-picker" role="dialog" aria-label="从媒体库选择" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">从媒体库选择</span>
          <select className="picker-kind" value={kind} onChange={(event) => setKind(event.target.value)} aria-label="按类型筛选">
            <option value="">全部类型</option>
            <option value="image">图片</option>
            <option value="video">视频</option>
            <option value="audio">音频</option>
            <option value="document">文档</option>
          </select>
          <button className="btn btn-ghost btn-sm" type="button" onClick={props.onClose}>关闭</button>
        </div>
        {error ? <div className="card-note" style={{ color: 'var(--danger-text)' }}>{error}</div> : null}
        {!rows ? (
          <div className="card-note">正在加载媒体库…</div>
        ) : rows.length === 0 ? (
          <div className="card-note">媒体库里还没有可用媒体。先在上传中心上传文件，或让管理员在媒体库登记。</div>
        ) : (
          <div className="picker-list">
            {rows.map((row) => (
              <button className="picker-row" key={row.id} type="button" onClick={() => props.onPick(row)}>
                <span className="media-item-thumb">
                  {row.kind === 'image'
                    ? <KnoxImage siteId={props.siteId} assetId={row.id} alt="" />
                    : <span className="media-item-thumb-empty">{kindLabel(row.kind)}</span>}
                </span>
                <span className="media-item-body">
                  <span className="media-item-title">{row.title || row.filename}</span>
                  <span className="media-item-sub">
                    {kindLabel(row.kind)}{row.mimeType ? ` · ${row.mimeType}` : ''}{row.fileSize ? ` · ${formatBytes(row.fileSize)}` : ''}{row.createdAt ? ` · ${row.createdAt.slice(0, 10)}` : ''}
                  </span>
                </span>
                <span className="picker-add">添加</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
