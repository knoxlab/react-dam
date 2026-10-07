import { useEffect, useMemo, useRef, useState } from 'react';
import { AccountBar } from '../account';
import { askPublished } from '../api';
import { fileExt, kindLabel } from '../format';
import type { Asset, Catalog } from '../types';
import { Page } from '../ui';

type Turn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  files: { id: string; title: string }[];
  citations: { title: string; snippet: string }[];
};

function sessionId(): string {
  const key = 'dam.ask.session';
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const next = crypto.randomUUID();
  sessionStorage.setItem(key, next);
  return next;
}

function catalogReply(question: string, files: Asset[], notice: string | null | undefined): string {
  const note = notice?.trim()
    ? `${notice.trim()}\n\n以下摘自已选定资源的已发布说明，不是模型生成的回答。`
    : '以下摘自已选定资源的已发布说明，不是模型生成的回答。';
  return `${note}\n\n${catalogAnswer(question, files)}`;
}

function catalogAnswer(question: string, files: Asset[]): string {
  if (files.length === 0) {
    return '没有选定资源，目录里也没有和这句话对应的已发布内容。在输入框里输入资源名称，从列表里选定后再提问。';
  }
  const lines = files.map((asset) => {
    const body = asset.body.trim() || asset.summary.trim() || '这条资源没有可引用的说明。';
    return `《${asset.title}》（${kindLabel(asset.kind)} · ${fileExt(asset.mime, asset.kind)}）\n${body}`;
  });
  const lead = question.trim()
    ? `按已选定的 ${files.length} 个资源整理如下。`
    : `已选定 ${files.length} 个资源，内容如下。`;
  return `${lead}\n\n${lines.join('\n\n')}`;
}

export function AskPage(props: { catalog: Catalog; siteId: string }) {
  const [draft, setDraft] = useState('');
  const [picked, setPicked] = useState<Asset[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const suggestions = useMemo(() => {
    const query = draft.trim().toLowerCase();
    const chosen = new Set(picked.map((asset) => asset.id));
    return props.catalog.assets
      .filter((asset) => !chosen.has(asset.id))
      .filter((asset) => {
        if (!query) return true;
        const title = asset.title.toLowerCase();
        const code = asset.code.toLowerCase();
        return title.includes(query) || code.includes(query) || query.includes(title);
      })
      .slice(0, 6);
  }, [draft, picked, props.catalog.assets]);

  useEffect(() => {
    const node = threadRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [turns, busy]);

  function choose(asset: Asset) {
    setPicked((current) => current.some((item) => item.id === asset.id) ? current : [...current, asset]);
    setDraft((current) => {
      const title = asset.title.trim();
      if (!title) return current;
      if (current.trim() === title || title.includes(current.trim())) return '';
      return current.replace(title, '').replace(/\s{2,}/g, ' ');
    });
    setOpen(true);
    inputRef.current?.focus();
  }

  async function send() {
    const question = draft.trim();
    if (busy || (!question && picked.length === 0)) return;
    const files = picked.slice();
    const asked = question || '请根据已选定的资源说明内容。';
    const scoped = files.length
      ? `请只根据这些资源回答：${files.map((asset) => `${asset.title}（${asset.code}）`).join('、')}。\n${asked}`
      : asked;
    const userTurn: Turn = {
      id: crypto.randomUUID(),
      role: 'user',
      text: asked,
      files: files.map((asset) => ({ id: asset.id, title: asset.title })),
      citations: []
    };
    setTurns((current) => [...current, userTurn]);
    setDraft('');
    setPicked([]);
    setOpen(false);
    setBusy(true);
    try {
      const remote = await askPublished(props.siteId, scoped, sessionId());
      const modelAnswer = remote && !remote.blocked && !remote.noAnswer && remote.answer?.trim();
      const citations = modelAnswer
        ? remote.citations.filter((item) => item.title || item.snippet).map((item) => ({
          title: item.title || '引用',
          snippet: item.snippet
        }))
        : [];
      const text = modelAnswer
        ? modelAnswer
        : files.length
          ? catalogReply(asked, files, remote?.noAnswerMessage)
          : remote?.noAnswerMessage?.trim()
            || catalogAnswer(asked, matchAssets(asked, props.catalog.assets));
      setTurns((current) => [...current, {
        id: crypto.randomUUID(),
        role: 'assistant',
        text,
        files: [],
        citations
      }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <header className="topbar">
        <div className="topbar-left">
          <span className="crumb">知识库&nbsp;&nbsp;/&nbsp;&nbsp;知识问答</span>
        </div>
        <div className="topbar-right"><AccountBar /></div>
      </header>
      <div className="page-body ask-page">
        <div className="ask-thread" ref={threadRef}>
          {turns.length === 0 ? (
            <div className="ask-empty">
              <strong>直接输入问题，或在输入框里选定资源后再问</strong>
              <span>输入资源名称会列出可选项。选定后，问题只针对这些文件。</span>
            </div>
          ) : null}
          {turns.map((turn) => (
            <article className={`ask-turn is-${turn.role}`} key={turn.id}>
              <span className="ask-who">{turn.role === 'user' ? '我' : '知识库'}</span>
              {turn.files.length > 0 ? (
                <div className="ask-files">
                  {turn.files.map((file) => <span className="chip chip-primary" key={file.id}>{file.title}</span>)}
                </div>
              ) : null}
              <p>{turn.text}</p>
              {turn.citations.length > 0 ? (
                <ul className="ask-cites">
                  {turn.citations.map((item, index) => (
                    <li key={`${item.title}-${index}`}>
                      <strong>{item.title}</strong>
                      {item.snippet ? <span>{item.snippet}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
          {busy ? <article className="ask-turn is-assistant"><span className="ask-who">知识库</span><p>正在查找已发布资源…</p></article> : null}
        </div>

        <form
          className="ask-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          {open && suggestions.length > 0 ? (
            <ul className="ask-suggest" role="listbox" aria-label="按资源名称选定文件">
              {suggestions.map((asset) => (
                <li key={asset.id}>
                  <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => choose(asset)}>
                    <strong>{asset.title}</strong>
                    <span>{kindLabel(asset.kind)} · {asset.code}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="ask-box">
            {picked.map((asset) => (
              <button
                key={asset.id}
                className="chip chip-primary ask-chip"
                type="button"
                title="取消选定"
                onClick={() => setPicked((current) => current.filter((item) => item.id !== asset.id))}
              >
                {asset.title}
                <span aria-hidden="true">×</span>
              </button>
            ))}
            <textarea
              ref={inputRef}
              rows={2}
              value={draft}
              placeholder="输入问题，或输入资源名称并选定文件"
              onFocus={() => setOpen(true)}
              onBlur={() => window.setTimeout(() => setOpen(false), 120)}
              onChange={(event) => {
                setDraft(event.target.value);
                setOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
          </div>
          <div className="ask-actions">
            <span>选定 {picked.length} 个资源 · Enter 发送</span>
            <button className="btn btn-primary" type="submit" disabled={busy || (!draft.trim() && picked.length === 0)}>
              发送
            </button>
          </div>
        </form>
      </div>
    </Page>
  );
}

function matchAssets(question: string, assets: Asset[]): Asset[] {
  const query = question.trim().toLowerCase();
  if (!query) return [];
  return assets.filter((asset) => {
    const haystack = `${asset.title} ${asset.summary} ${asset.body} ${asset.tags.join(' ')}`.toLowerCase();
    return haystack.includes(query) || query.includes(asset.title.toLowerCase());
  }).slice(0, 3);
}
