import { useEffect, useMemo, useRef, useState } from 'react';
import { AccountBar } from '../account';
import {
  loadContentForm,
  uploadMemberFile,
  type ContentForm,
  type ContentFormField,
  type ContentFormNode
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

const VIDEO_EXT = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'];

export function UploadPage(props: { folders: ResourceGroup[]; siteId: string; onToast: (message: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const jobs = useRef(new Map<string, AbortController>());
  const dropped = useRef(new Set<string>());
  const [items, setItems] = useState<QueueItem[]>([]);
  const [folderId, setFolderId] = useState('');
  const [form, setForm] = useState<ContentForm | null>(null);
  const [formError, setFormError] = useState('');
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const [activeVideo, setActiveVideo] = useState('');
  const [showForm, setShowForm] = useState(false);
  const allowed = props.folders.some((folder) => folder.id === folderId) ? folderId : '';
  const folder = props.folders.find((item) => item.id === allowed);
  const done = useMemo(() => items.filter((item) => item.status === 'done'), [items]);
  const videos = useMemo(() => done.filter((item) => item.kind === 'video'), [done]);
  const others = useMemo(() => done.filter((item) => item.kind !== 'video'), [done]);
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
    if (done.length === 0) setShowForm(false);
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

  useEffect(() => {
    if (!form) return;
    const folderTitle = folder?.title ?? '';
    setValues((current) => {
      let changed = false;
      const next = { ...current };
      for (const item of done) {
        if (next[item.id]) continue;
        next[item.id] = initialValues(fields, item, folderTitle);
        changed = true;
      }
      return changed ? next : current;
    });
  }, [form, done, fields, folder?.title]);

  useEffect(() => {
    if (videos.length < 2) return;
    if (!videos.some((item) => item.id === activeVideo)) setActiveVideo(videos[0].id);
  }, [videos, activeVideo]);

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
    setItems((current) => current.filter((row) => row.id !== id));
    setValues((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function clearFinished() {
    const removed = items.filter((item) => item.status === 'done').map((item) => item.id);
    for (const id of removed) dropped.current.add(id);
    setItems((current) => current.filter((item) => item.status !== 'done'));
    setValues((current) => {
      const next = { ...current };
      for (const id of removed) delete next[id];
      return next;
    });
  }

  function changeValue(itemId: string, code: string, value: string) {
    setValues((current) => ({
      ...current,
      [itemId]: { ...(current[itemId] ?? {}), [code]: value }
    }));
  }

  const active = videos.find((item) => item.id === activeVideo) ?? videos[0];

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
          {done.length > 0 && !showForm ? (
            <div className="card-pad" style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" type="button" onClick={() => setShowForm(true)}>下一步</button>
            </div>
          ) : null}
        </div>

        {showForm && done.length > 0 ? (
          <div className="card">
            <div className="card-head">
              <span className="card-title">{form?.name || '数字资源'}</span>
            </div>
            {videos.length > 1 ? (
              <div className="tabs file-tabs" role="tablist" aria-label="视频">
                {videos.map((item) => (
                  <button
                    key={item.id}
                    className={`tab ${item.id === active?.id ? 'active' : ''}`}
                    type="button"
                    role="tab"
                    aria-selected={item.id === active?.id}
                    title={item.name}
                    onClick={() => setActiveVideo(item.id)}
                  >
                    <span>{item.name}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {formError ? <div className="card-note">{formError}</div> : null}
            {!form && !formError ? <div className="card-note">正在读取数字资源表单…</div> : null}
            {form && videos.length > 1 && active ? (
              <AssetForm
                item={active}
                siteId={props.siteId}
                nodes={form.nodes}
                values={values[active.id] ?? {}}
                onChange={(code, value) => changeValue(active.id, code, value)}
              />
            ) : null}
            {form && videos.length <= 1 ? done.map((item) => (
              <AssetForm
                key={item.id}
                item={item}
                siteId={props.siteId}
                nodes={form.nodes}
                values={values[item.id] ?? {}}
                showName={done.length > 1}
                onChange={(code, value) => changeValue(item.id, code, value)}
              />
            )) : null}
            {form && videos.length > 1 ? others.map((item) => (
              <AssetForm
                key={item.id}
                item={item}
                siteId={props.siteId}
                nodes={form.nodes}
                values={values[item.id] ?? {}}
                showName
                onChange={(code, value) => changeValue(item.id, code, value)}
              />
            )) : null}
          </div>
        ) : null}
      </div>
    </Page>
  );
}

function AssetForm(props: {
  item: QueueItem;
  siteId: string;
  nodes: ContentFormNode[];
  values: Record<string, string>;
  showName?: boolean;
  onChange: (code: string, value: string) => void;
}) {
  return (
    <div className="asset-form">
      {props.showName ? <h3>{props.item.name}</h3> : null}
      <FormNodes
        nodes={props.nodes}
        values={props.values}
        siteId={props.siteId}
        folderId={props.item.folderId}
        onChange={props.onChange}
      />
    </div>
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
  if (ext === 'pdf' || file.type === 'application/pdf') return 'pdf';
  if (['txt', 'md'].includes(ext) || file.type.startsWith('text/')) return 'text';
  return 'document';
}
