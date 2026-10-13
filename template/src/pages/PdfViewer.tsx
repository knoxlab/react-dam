import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';

/**
 * pdf.js 统一用 <b>legacy</b> 构建（主包 + worker），并交给 Vite 托管 worker 路径，
 * 避免 worker 路径因 webapp 上下文不同而失效。
 *
 * <p><b>为什么不能用 modern 构建</b>：modern 构建只调用不 polyfill 两个 TC39 stage-3 方法，
 * 在缺原生实现的浏览器上是<b>必现</b>的硬错误（指纹与渲染各在一条必经路径上）：
 * <ul>
 *   <li>worker 侧 <code>hashOriginal.toHex()</code>（{@code Uint8Array.prototype.toHex}）
 *       —— 每次加载都算文档指纹（<code>pdfManager.ensureDoc("fingerprints")</code>），
 *       抛 <code>hashOriginal.toHex is not a function</code>，文档根本打不开；</li>
 *   <li>主包侧 <code>map.getOrInsertComputed(...)</code>（{@code Map.prototype.getOrInsertComputed}）
 *       —— <code>getOptionalContentConfig()</code> 是每次渲染的必经路径，共 11 处调用，
 *       抛 <code>this[#t].getOrInsertComputed is not a function</code>，页面画不出来。</li>
 * </ul>
 * legacy 构建内嵌 core-js，两处均有 polyfill；modern 主包与 legacy worker 混用虽协议兼容，
 * 但主包仍会踩第二处坑，故主包一并换掉。
 *
 * <p>另注：worker 是独立 realm，主包侧打补丁对它无效 —— 所以两处都必须各自解决。
 */
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/**
 * 适配留白（px）：页面四周的呼吸空间。
 *
 * <p><b>必须与 style.css 里 {@code .pdf-shell} 的 {@code --pad-x/--pad-y} 一致</b>：
 * JS 拿它算「页面正好放进显示区」的倍率，CSS 拿它兜底 clamp。两边不一致就会出现
 * JS 算出来放得下、CSS 又把某一边压掉 —— 而被压掉的正是宽高比变形的来源。
 */
const PAD_X = 32;
const PAD_Y = 24;
/** 全屏下显示区就是整个视口，留白放大一圈，免得页面贴死屏幕边缘。 */
const FS_PAD_X = 48;
const FS_PAD_Y = 32;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 1.25;

/** 取原件字节的重试次数：Knox 上游偶发超时不该让整份文档退化成只能看第 1 页的回退页。 */
const LOAD_ATTEMPTS = 3;
/** 重试间隔基数（毫秒），按次数线性放大。 */
const RETRY_DELAY = 400;

interface OutlineItem {
  title: string;
  page: number;
  depth: number;
}

/**
 * 把 pdf.js 的书签树拍平成 <code>{ title, page, depth }</code> 列表。
 *
 * <p><b>为什么不直接读 PDF 的 outline</b>：pdf.js 返回的 <code>dest</code> 要么是字符串，
 * 要么是 <code>[ref, ...]</code> 的间接引用，直接拿去 <code>getPage</code> 一定失败。
 * 必须先用 <code>getDestination(dest)</code> 解析出目标对象，再用 <code>getPageIndex</code>
 * 换成页码；书签页码解不出来只是这条点不了，不该让整棵树失败。
 */
async function flattenOutline(doc: pdfjsLib.PDFDocumentProxy): Promise<OutlineItem[]> {
  const raw = (await doc.getOutline().catch(() => null)) ?? [];
  const out: OutlineItem[] = [];
  const walk = async (nodes: { title?: string; dest?: unknown; items?: unknown[] }[], depth: number) => {
    for (const node of nodes) {
      let page = 0;
      try {
        const dest = typeof node.dest === 'string' ? await doc.getDestination(node.dest) : node.dest;
        if (Array.isArray(dest)) page = (await doc.getPageIndex(dest[0] as never)) + 1;
      } catch {
        // 解析不到页码只是这条书签点不了，不该让整个大纲失败
      }
      out.push({ title: node.title || '（无标题）', page, depth });
      if (Array.isArray(node.items) && node.items.length) {
        await walk(node.items as { title?: string; dest?: unknown; items?: unknown[] }[], depth + 1);
      }
    }
  };
  await walk(raw, 0);
  return out;
}

/**
 * PDF 客户端渲染器（对齐 Knox-Media 的 DocumentReader）。
 *
 * <p><b>为什么不复用 /media-preview 的页图</b>：那条链路要求 Knox 服务端把每一页栅格化成
 * JPEG，依赖 mutool/pdftoppm/Ghostscript/ImageMagick 之一 —— 缺失时只有第 1 页能出图
 * （LibreOffice 只会导出第 1 页），第 2 页起一律 404。客户端渲染不依赖任何服务端栅格化：
 * 整份 PDF 字节交给 pdf.js，任意页都能出图，总页数也来自 pdf.js 本身（无需上游告知）。
 *
 * <p>因此资源侧必须新开 /media-pdf 交付原件字节；本组件不碰 Knox access_token。
 */
export function PdfViewer(props: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [failed, setFailed] = useState(false);
  /** 缩放/页码要在 pdf.js 的渲染回调里读到最新值，闭包捕获的永远是首帧值。 */
  const pageRef = useRef(1);
  const zoomRef = useRef(1);
  /**
   * 显示区（工具条下方那一整块）与全屏标记。
   *
   * <p>倍率必须在渲染时量这里，而不是只看壳宽：全屏后可用<b>高度</b>由视口钉死，
   * 只按宽度适配会让页面高度冲出屏幕，再被 CSS 的 max-height 单边压扁。
   */
  const areaRef = useRef<HTMLDivElement>(null);
  const fullscreenRef = useRef(false);
  const titleRef = useRef(props.title);
  const onAuthErrorRef = useRef(props.onAuthError);
  const onReadyRef = useRef(props.onReady);
  const onMeasureRef = useRef(props.onMeasure);

  useEffect(() => { titleRef.current = props.title; }, [props.title]);
  useEffect(() => { onAuthErrorRef.current = props.onAuthError; }, [props.onAuthError]);
  useEffect(() => { onReadyRef.current = props.onReady; }, [props.onReady]);
  useEffect(() => { onMeasureRef.current = props.onMeasure; }, [props.onMeasure]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    docRef.current?.destroy().catch(() => undefined);
    docRef.current = null;
    setPage(1);
    setPages(0);
    setOutline([]);
    setOutlineOpen(false);
    setZoom(1);
    setFailed(false);

    /**
     * 取原件字节 + 解析。
     *
     * <p>此前这里一次失败就 {@code setFailed(true)} 且把错误吞掉：Knox 上游偶发超时会让
     * **本可正常渲染的 PDF** 永久切到回退 iframe，而回退页依赖服务端栅格化，只有第 1 页
     * 能出图 —— 用户看到的「文档预览不了」正是这么来的。故：确定性失败（未授权 / 后端判定
     * 不是 PDF）直接走对应分支不重试，其余瞬时故障重试数次再降级，且每次失败都打日志。
     */
    const load = async (): Promise<void> => {
      for (let attempt = 1; attempt <= LOAD_ATTEMPTS; attempt += 1) {
        try {
          const response = await fetch(props.src, { credentials: 'include' });
          if (!response.ok) {
            // 401 不是「取不到」，交给父级重新签发会话后重来
            if (response.status === 401) throw new Error('unauthorized');
            throw new Error(`HTTP ${response.status}`);
          }
          const buffer = await response.arrayBuffer();
          if (cancelled) return;
          const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
          if (cancelled) {
            doc.destroy().catch(() => undefined);
            return;
          }
          docRef.current = doc;
          setPages(doc.numPages);
          // 大纲可有可无：没有书签的 PDF 大纲按钮保持空态，不影响阅读
          flattenOutline(doc)
            .then((items) => { if (!cancelled) setOutline(items); })
            .catch(() => undefined);
          await renderPage(doc);
          return;
        } catch (error: unknown) {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : String(error);
          // access_token 失效：有父级处理就交给它重新签发；没人接则按取不到处理，
          // 否则会停在既不渲染也不回退的空白态。
          if (message === 'unauthorized') {
            if (onAuthErrorRef.current) {
              onAuthErrorRef.current();
              return;
            }
            console.error(`[PdfViewer] 未授权且无父级接管，改用回退预览页 src=${props.src}`);
            if (!cancelled) setFailed(true);
            return;
          }
          // 404 = 后端判定该资源不是 PDF（docx/xlsx/ppt…），回退预览页本就是设计路径；
          // 403 = 无权，重试同样只会 403。两者都不该再耗两轮。
          const permanent = message === 'HTTP 404' || message === 'HTTP 403';
          console.warn(`[PdfViewer] 加载失败 ${attempt}/${LOAD_ATTEMPTS} src=${props.src}: ${message}`, error);
          if (permanent || attempt === LOAD_ATTEMPTS) {
            console.error(`[PdfViewer] 放弃原件渲染，改用回退预览页 src=${props.src}: ${message}`);
            if (!cancelled) setFailed(true);
            return;
          }
          await new Promise<void>((resolve) => { retryTimer = setTimeout(resolve, RETRY_DELAY * attempt); });
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      docRef.current?.destroy().catch(() => undefined);
      docRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.src]);

  /**
   * 按预览区实际像素渲染当前页，让页面宽度刚好等于容器宽度（再按设备像素比放大）。
   *
   * <p>为什么不用 <code>getViewport({ scale: 1 })</code> 的默认值：它的默认单位是"CSS 像素"
   * 的 1 倍，跟容器实际宽度无关，一旦容器宽度大于页面原始宽度（大屏 / 宽预览区），
   * 画布反而小于容器宽度，四周就露出灰底；只有先量出容器宽度再反推缩放比例，页面才能正好铺满。
   *
   * <p><b>为什么要排队</b>：pdf.js 不允许同一画布并发渲染，而 ResizeObserver 的首帧回调常与
   * 「加载完成后的首帧渲染」撞车 —— 后到的那次先写 <code>canvas.width</code> 把画布清空，让
   * 在途的那次只画出一小部分就失败（错误又被吞掉），表现就是首页偶尔半截/发白且控制台安静。
   * 故渲染串行执行，且排到队尾的旧请求主动让位给更新的请求。
   */
  const renderTokenRef = useRef(0);
  const renderChainRef = useRef<Promise<void>>(Promise.resolve());

  const renderPage = useCallback((doc: pdfjsLib.PDFDocumentProxy) => {
    const token = ++renderTokenRef.current;
    const draw = async (): Promise<void> => {
      // 文档已换/已卸载：这帧画的是旧文档，直接放弃
      if (docRef.current !== doc) return;
      // 已有更新的渲染排在后面：这次让位，避免白画一遍又立刻被覆盖
      if (token !== renderTokenRef.current) return;
      let pageNo = 1;
      let cssWidth = 0;
      let cssHeight = 0;
      try {
      const canvas = canvasRef.current;
      const area = areaRef.current;
      if (!canvas || !area) return;
      pageNo = Math.min(Math.max(pageRef.current, 1), doc.numPages);
      const pdfPage = await doc.getPage(pageNo);
      const natural = pdfPage.getViewport({ scale: 1 });

      /**
       * 「适配」倍率：把页面按显示区实际可用宽高做 contain，长边正好贴进可用框。
       *
       * <p><b>为什么不能只按宽度算</b>：非全屏下显示区高度由页面自己撑开（百分比高度
       * 无参照，等同 none），只按宽度算是对的，页面把高度撑开即「高度自适应」；但
       * <b>全屏后高度由视口钉死</b>，此时仍只按宽度算，竖版页会算出远超屏幕的高度，
       * 再被 max-height 单边夹住 —— 宽度不跟着收，文档就被压扁（宽高比失调）。
       * 故全屏必须同时受高约束，从源头就不让溢出发生。
       */
      const fs = fullscreenRef.current;
      const padX = fs ? FS_PAD_X : PAD_X;
      const padY = fs ? FS_PAD_Y : PAD_Y;
      const availW = area.clientWidth - padX;
      let fit = availW > 0 ? availW / natural.width : 1;
      if (fs) {
        const availH = area.clientHeight - padY;
        if (availH > 0) fit = Math.min(fit, availH / natural.height);
      }
      fit = Math.max(fit, 0.05);

      // 有效缩放 = 适配倍率 × 用户缩放比例。放大时同步提高渲染分辨率，
      // 否则页面只是被 CSS 拉大的低分辨率位图，字体会发虚。
      const effectiveScale = fit * zoomRef.current;
      const viewport = pdfPage.getViewport({ scale: effectiveScale });
      const dpr = window.devicePixelRatio || 1;
      cssWidth = Math.floor(natural.width * effectiveScale);
      cssHeight = Math.floor(natural.height * effectiveScale);
      canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
      canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
      /**
       * 只钉宽度，高度一律交给 CSS 按画布固有宽高比反推（{@code height: auto}）。
       *
       * <p>之前 width/height 都写死成固定像素：可用高度不足时 CSS 只能压 height、
       * 压不到 width（明确指定的 width 不参与宽高比反推），显示比例于是与位图比例脱钩
       * —— 这正是「全屏后文档变扁」的直接成因。height 留空后，浏览器在
       * max-width/max-height 两道约束之间按固有比例重算另一边，比例恒等。
       */
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = '';
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        await pdfPage.render({ canvas, canvasContext: ctx, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] })
          .promise;
        // 组件已卸载、换了文档，或已有更晚的渲染接管：这次的结果不该再回调外层
        if (docRef.current !== doc || token !== renderTokenRef.current) return;
        onReadyRef.current?.();
        // 只在第 1 页且未缩放时回报尺寸：外层据此推导版式，翻页/缩放时不该让信息区跟着跳。
        if (pageNo === 1 && zoomRef.current === 1) onMeasureRef.current?.(cssWidth, cssHeight);
      } catch (error: unknown) {
        // 不再静默吞掉：否则「首页半截且无报错」这类问题无从查起
        console.warn(`[PdfViewer] 渲染第 ${pageNo} 页失败`, error);
      }
    };
    // 排在上一次之后执行，保证同一时刻只有一个渲染在动同一块画布
    renderChainRef.current = renderChainRef.current.then(draw, draw);
    return renderChainRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 显示区尺寸变化时重绘。
   *
   * <p>不再在这里算缩放比例：倍率现在是渲染时按页面真实尺寸量出来的（见 renderPage），
   * 这里只负责「尺寸变了就重画」，否则同一套比例会被别处复用而算错。
   */
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const observer = new ResizeObserver(() => {
      const doc = docRef.current;
      if (doc) void renderPage(doc);
    });
    observer.observe(shell);
    return () => observer.disconnect();
  }, [renderPage]);

  /**
   * 进出全屏后按新显示区立刻重绘。
   *
   * <p>全屏元素的尺寸变化 ResizeObserver 也会报，但那个回调是异步排在布局之后的，
   * 而全屏首帧若仍按窗口宽度作画，竖版页会直接溢出屏幕 —— 这里同步补一帧更稳。
   */
  useEffect(() => {
    fullscreenRef.current = fullscreen;
    const doc = docRef.current;
    if (doc) void renderPage(doc);
  }, [fullscreen, renderPage]);

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener('fullscreenchange', sync);
    window.addEventListener('resize', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = shellRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else el.requestFullscreen?.().catch(() => undefined);
  }, []);

  const go = useCallback(async (next: number) => {
    const doc = docRef.current;
    if (!doc) return;
    const pageNo = Math.min(Math.max(next, 1), doc.numPages);
    pageRef.current = pageNo;
    setPage(pageNo);
    // 翻页回到 100%：换页后按适配宽度重新铺满，避免带着旧比例读新页
    zoomRef.current = 1;
    setZoom(1);
    await renderPage(doc);
  }, [renderPage]);

  const changeZoom = useCallback(async (factor: number) => {
    const doc = docRef.current;
    if (!doc) return;
    const next = Math.min(Math.max(zoomRef.current * factor, MIN_ZOOM), MAX_ZOOM);
    zoomRef.current = next;
    setZoom(next);
    await renderPage(doc);
  }, [renderPage]);

  const resetZoom = useCallback(async () => {
    const doc = docRef.current;
    if (!doc) return;
    zoomRef.current = 1;
    setZoom(1);
    await renderPage(doc);
  }, [renderPage]);

  const hasOutline = outline.length > 0;
  const canPrev = page > 1;
  const canNext = pages > 0 && page < pages;
  const currentDepth = outline.find((item) => item.page > 0 && item.page <= page)?.depth ?? 0;

  return (
    <div
      ref={shellRef}
      className={`pdf-shell${fullscreen ? ' is-fullscreen' : ''}${zoom !== 1 ? ' is-zoomed' : ''}`}
      style={{ '--zoom': String(zoom) } as React.CSSProperties}
    >
      {/* 工具条收在显示区顶部居中，且处于全屏元素内部 —— 全屏后它照样贴顶显示 */}
      <div className="pdf-toolbar" role="toolbar" aria-label="文档工具栏">
        <button type="button" className="tb-btn" aria-label="上一页" title="上一页" disabled={!canPrev} onClick={() => void go(page - 1)}>
          <IconPrev />
        </button>
        <span className="tb-page" aria-live="polite">{pages ? `${page} / ${pages}` : '—'}</span>
        <button type="button" className="tb-btn" aria-label="下一页" title="下一页" disabled={!canNext} onClick={() => void go(page + 1)}>
          <IconNext />
        </button>
        <span className="tb-sep" aria-hidden="true" />
        <button
          type="button"
          className={`tb-btn${outlineOpen ? ' is-on' : ''}`}
          aria-label="文档大纲"
          aria-pressed={outlineOpen}
          title={hasOutline ? '文档大纲' : '此文档没有大纲'}
          disabled={!hasOutline}
          onClick={() => setOutlineOpen((open) => !open)}
        >
          <IconOutline />
        </button>
        <span className="tb-sep" aria-hidden="true" />
        <button type="button" className="tb-btn" aria-label="缩小" title="缩小" disabled={zoom <= MIN_ZOOM} onClick={() => void changeZoom(1 / ZOOM_STEP)}>
          <IconZoomOut />
        </button>
        <span className="tb-zoom">{Math.round(zoom * 100)}%</span>
        <button type="button" className="tb-btn" aria-label="放大" title="放大" disabled={zoom >= MAX_ZOOM} onClick={() => void changeZoom(ZOOM_STEP)}>
          <IconZoomIn />
        </button>
        <button type="button" className="tb-btn" aria-label="还原" title="还原" disabled={zoom === 1} onClick={() => void resetZoom()}>
          <IconReset />
        </button>
        <span className="tb-sep" aria-hidden="true" />
        <button type="button" className="tb-btn" aria-label={fullscreen ? '退出全屏' : '全屏'} title={fullscreen ? '退出全屏' : '全屏'} onClick={toggleFullscreen}>
          {fullscreen ? <IconExitFull /> : <IconFull />}
        </button>
      </div>

      <div className="pdf-pagearea" ref={areaRef}>
        {outlineOpen && (
          <nav className="pdf-outline" aria-label="文档大纲">
            <div className="ol-title">大纲</div>
            {hasOutline ? outline.map((item, index) => (
              <button
                key={`${item.title}-${index}`}
                type="button"
                className={item.page > 0 && item.page <= page && item.depth === currentDepth ? 'is-current' : ''}
                style={{ paddingLeft: 12 + item.depth * 12 }}
                disabled={item.page < 1}
                onClick={() => void go(item.page)}
                title={item.page > 0 ? `跳到第 ${item.page} 页` : '该书签未指向具体页'}
              >
                {item.title}
              </button>
            )) : <div className="ol-empty">此文档没有大纲</div>}
          </nav>
        )}

        {failed ? (
          // 非 PDF 文档（docx/xlsx/ppt…）或取不到原件字节时，退回服务端预览页。
          // 这里用 iframe 而不是「文档预览不可用」空态：/media-preview 能把它们转成可读页面。
          props.fallbackSrc ? (
            <iframe className="fit" title={props.title || '文档预览'} src={props.fallbackSrc} onLoad={() => onReadyRef.current?.()} />
          ) : (
            <div className="pdf-empty">
              <IconDoc />
              <strong>文档预览不可用</strong>
              <span>{props.title || '该文件'}暂时无法在浏览器中渲染</span>
            </div>
          )
        ) : (
          <canvas ref={canvasRef} className="pdf-canvas" />
        )}
      </div>
    </div>
  );
}

export interface Props {
  /** /media-pdf 原件字节流，带 Knox access_token。 */
  src: string;
  /** 取不到 PDF 原件时的服务端预览页（非 PDF 文档走这条）。 */
  fallbackSrc?: string;
  /** 文件名，用于标题与不可用时的文案。 */
  title?: string;
  /** 401 时由父级重新签发会话再重来；不传则本组件直接走回退预览页。 */
  onAuthError?: () => void;
  /** 首页渲染完成（预览层可撤掉「正在加载」）。 */
  onReady?: () => void;
  /** 首页渲染完成后回报画布尺寸，供外层推导版式。 */
  onMeasure?: (width: number, height: number) => void;
}

/**
 * 工具条图标共用样式：<b>24 网格、20px 显示、1.9 描边</b>。
 *
 * <p>折算到屏幕上描边约 {@code 1.9 × 20/24 ≈ 1.6px}，与主流图标库 20px 图标的观感一致；
 * 之前是 18px / 1.7 描边，折算只有约 1.3px，又细又小 —— 这也是工具条看着「不够清楚」的主因。
 * 按钮同步由 28px 放大到 30px，点击热区更宽裕。
 */
const S = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/**
 * 上一页 / 下一页：竖线 + 实心三角的「跳页」造型。
 *
 * <p>刻意不用裸箭头 {@code ‹ ›}：裸箭头在工具条里更像「折叠/后退一步」，翻页该用
 * 阅读器的通用语汇 {@code |◀ ▶|}。实心三角保证小尺寸下不糊成一团，封口竖线
 * 强调「跳到上/下一页」而不是「往前一点」。
 */
const IconPrev = () => (
  <svg {...S} aria-hidden="true">
    <path d="M6 5.5v13" />
    <path fill="currentColor" stroke="none" d="M18 6 10 12l8 6z" />
  </svg>
);
const IconNext = () => (
  <svg {...S} aria-hidden="true">
    <path d="M18 5.5v13" />
    <path fill="currentColor" stroke="none" d="M6 6l8 6-8 6z" />
  </svg>
);

/**
 * 文档大纲：左侧短标记 + 右侧长短不一的横线，即目录（TOC）的通用画法。
 *
 * <p>原来是三根等长横线（汉堡菜单），读起来是「菜单」而不是「目录」；
 * 末行特意收短，一眼能看出这是层级条目而非导航按钮。
 */
const IconOutline = () => (
  <svg {...S} aria-hidden="true">
    <path d="M4 6.5h2M10 6.5h10" />
    <path d="M4 12h2M10 12h10" />
    <path d="M4 17.5h2M10 17.5h6" />
  </svg>
);

/** 缩小 / 放大：放大镜 + ∓。镜筒略放大、手柄缩短，20px 下镜内符号才够清楚。 */
const IconZoomOut = () => (
  <svg {...S} aria-hidden="true">
    <circle cx="10.5" cy="10.5" r="6.25" />
    <path d="M7.6 10.5h5.8" />
    <path d="M15 15l4.5 4.5" />
  </svg>
);
const IconZoomIn = () => (
  <svg {...S} aria-hidden="true">
    <circle cx="10.5" cy="10.5" r="6.25" />
    <path d="M7.6 10.5h5.8M10.5 7.6v5.8" />
    <path d="M15 15l4.5 4.5" />
  </svg>
);

/**
 * 还原：逆时针回退箭头（撤销造型）。
 *
 * <p>原来是缺箭头尖的断圆弧，看着像「刷新/加载」；还原的语义是「撤销刚才的缩放」，
 * 必须有明确的回头箭头才不会被误读成转圈加载。
 */
const IconReset = () => (
  <svg {...S} aria-hidden="true">
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </svg>
);

/**
 * 最大化 / 还原窗口：沿主对角线的一对箭头（{@code ⤢ ⤡}）。
 *
 * <p>四角括号（原图标）是「全屏」的语汇，与用户口中的「最大化」不是一回事；
 * 对角双箭头才是桌面端最大化/还原的通用画法，且与「还原缩放」按钮拉开距离 ——
 * 否则工具条上会有两个含义相近的「缩回」图形。
 */
const IconFull = () => (
  <svg {...S} aria-hidden="true">
    <path d="M10 14 20 4" />
    <path d="M15 4h5v5" />
    <path d="M14 10 4 20" />
    <path d="M9 20H4v-5" />
  </svg>
);
const IconExitFull = () => (
  <svg {...S} aria-hidden="true">
    <path d="M20 4 14 10" />
    <path d="M14 10h5M14 10v-5" />
    <path d="M4 20 10 14" />
    <path d="M10 14h-5M10 14v5" />
  </svg>
);
const IconDoc = () => (
  <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </svg>
);
