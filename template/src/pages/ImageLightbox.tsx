import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';

export interface LightboxSlide {
  /** 图片地址：/media-thumb 代理（图片回源的就是原件字节）或编辑者保存的外链。 */
  url: string;
  /**
   * 该张对应关联媒体列表（media_items）的下标。翻到带此值的张会通知父级切换媒体，
   * 实现「全屏查看时也能切换媒体」；纯图片字段（无媒体行）的张没有此值，翻过不带动预览。
   */
  mediaIndex?: number;
}

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 8;
const ZOOM_STEP = 1.25;
/** 指针位移超过这个像素才算「拖过」——否则一次按下抬起一律当点击（点空白处关闭要用）。 */
const CLICK_SLOP = 5;

/**
 * 图片大图查看层：铺满整个浏览器窗口的查看器。
 *
 * <p>缩放/旋转都走 `transform`，而**适配窗口靠 CSS 约束**而不是 JS 算尺寸：
 * `max-width/height:100%` 让图片在 scale=1 时永远完整落在窗口内，转 90° 后
 * 宽高对调，故 `.is-rot` 把两个约束也对调成 `100vh/100vw` —— 否则竖图转横后会横向溢出。
 * 这样窗口尺寸变化、图片尺寸未知时都不需要重新计算，比 JS 量取稳。
 */
export function ImageLightbox(props: {
  slides: LightboxSlide[];
  /** 起始张，默认第 1 张（详情页主图恒为首张）；外部切媒体时此值变化即跟随跳张。 */
  index?: number;
  /** 图片替代文本（资源标题）：读屏与可访问树都靠它，空 alt 会被当成装饰图隐藏。 */
  alt?: string;
  onClose: () => void;
  /** 张序变化（键盘/按钮翻页与受控跟随）：父级据此同步媒体列表下标。 */
  onIndexChange?: (index: number) => void;
}) {
  const total = props.slides.length;
  const [index, setIndex] = useState(() => Math.min(Math.max(props.index ?? 0, 0), Math.max(total - 1, 0)));
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);

  const downRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const movedRef = useRef(false);
  // 键盘回调只挂一次，用 ref 转发，免得父级每次渲染都重挂监听。
  const closeRef = useRef(props.onClose);
  closeRef.current = props.onClose;
  const changeRef = useRef(props.onIndexChange);
  changeRef.current = props.onIndexChange;

  const slide = props.slides[index] ?? props.slides[0];

  // 翻到哪张就通知父级切媒体；挂载时以起始张初始化，不重复播报初始值
  // （父级回调自带「与当前媒体相同则跳过」的判断，回灌也不会形成环）。
  const lastNotified = useRef(index);
  useEffect(() => {
    if (lastNotified.current === index) return;
    lastNotified.current = index;
    changeRef.current?.(index);
  }, [index]);

  // 受控跟随：详情页切媒体（切换条 / 媒体列表页签）时大图跳到该媒体对应张。
  useEffect(() => {
    if (props.index == null) return;
    setIndex(Math.min(Math.max(props.index, 0), Math.max(total - 1, 0)));
  }, [props.index, total]);

  // 换一张就回到初始姿态：上一张 300% 的放大会原样带过来，用户会以为「下一张图是糊的」。
  // 只重置**图片的姿态**（缩放/旋转/平移），不动「拖拽」这个工具开关 ——
  // 它是用户的操作模式，翻页后又被关掉的话，连着看多张图每次都要重新点一次。
  useEffect(() => {
    setZoom(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
    setNatural(null);
    setFailed(false);
  }, [index]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      else if (event.key === 'ArrowLeft') setIndex((current) => Math.max(0, current - 1));
      else if (event.key === 'ArrowRight') setIndex((current) => Math.min(total - 1, current + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [total]);

  const fit = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    downRef.current = { x: event.clientX, y: event.clientY };
    movedRef.current = false;
    if (!pan || event.button !== 0) return;
    dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
    setDragging(true);
    // 合成事件或指针已失效时 setPointerCapture 会抛 NotFoundError，捕获只是加分项
    // （视口铺满窗口，丢不了事件），不能因为它把整条拖拽链路打断。
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* 忽略：按无捕获继续 */
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const down = downRef.current;
    if (down && (Math.abs(event.clientX - down.x) > CLICK_SLOP || Math.abs(event.clientY - down.y) > CLICK_SLOP)) {
      movedRef.current = true;
    }
    const drag = dragRef.current;
    if (!drag) return;
    setOffset({ x: drag.ox + event.clientX - drag.x, y: drag.oy + event.clientY - drag.y });
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    downRef.current = null;
    dragRef.current = null;
    setDragging(false);
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      /* 同上：捕获本就可能没建立成功 */
    }
  };

  const onViewportClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // 点在图片上（冒泡上来）不关；拖过也不关 —— 否则拖拽平移松手就退出查看层。
    if (movedRef.current || event.target !== event.currentTarget) return;
    closeRef.current();
  };

  const rotated = rotation % 180 !== 0;
  const altText = props.alt
    ? (total > 1 ? `${props.alt}（第 ${index + 1} 张，共 ${total} 张）` : props.alt)
    : '';
  const transform: CSSProperties = {
    transform: `translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg) scale(${zoom})`
  };

  return createPortal(
    <div className="lb-backdrop" role="dialog" aria-modal="true" aria-label="图片查看">
      <div
        className={[
          'lb-viewport',
          pan ? 'is-pan' : '',
          dragging ? 'is-dragging' : ''
        ].filter(Boolean).join(' ')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={onViewportClick}
      >
        {slide && !failed ? (
          <img
            className={`lb-img${rotated ? ' is-rot' : ''}`}
            src={slide.url}
            alt={altText}
            draggable={false}
            style={transform}
            onLoad={(event) => setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="lb-fail">图片暂时无法加载</span>
        )}
      </div>

      <div className="lb-toolbar" role="toolbar" aria-label="图片工具栏">
        <button type="button" className="tb-btn" aria-label="缩小" title="缩小" disabled={zoom <= ZOOM_MIN} onClick={() => setZoom((value) => Math.max(ZOOM_MIN, value / ZOOM_STEP))}>
          <IconZoomOut />
        </button>
        <button type="button" className="tb-btn" aria-label="放大" title="放大" disabled={zoom >= ZOOM_MAX} onClick={() => setZoom((value) => Math.min(ZOOM_MAX, value * ZOOM_STEP))}>
          <IconZoomIn />
        </button>
        <span className="tb-zoom">{Math.round(zoom * 100)}%</span>
        <span className="tb-sep" aria-hidden="true" />
        <button
          type="button"
          className="tb-btn"
          aria-label="适应窗口"
          title="适应窗口"
          disabled={zoom === 1 && offset.x === 0 && offset.y === 0}
          onClick={fit}
        >
          <IconFit />
        </button>
        <button type="button" className="tb-btn" aria-label="左旋转" title="左旋转" onClick={() => setRotation((value) => value - 90)}>
          <IconRotateLeft />
        </button>
        <button type="button" className="tb-btn" aria-label="右旋转" title="右旋转" onClick={() => setRotation((value) => value + 90)}>
          <IconRotateRight />
        </button>
        <span className="tb-sep" aria-hidden="true" />
        <button
          type="button"
          className={`tb-btn${pan ? ' is-on' : ''}`}
          aria-label="拖拽"
          aria-pressed={pan}
          title="拖拽平移"
          onClick={() => setPan((value) => !value)}
        >
          <IconHand />
        </button>
        <span className="tb-sep" aria-hidden="true" />
        <button type="button" className="tb-btn tb-close" aria-label="关闭" title="关闭" onClick={props.onClose}>
          <IconClose />
        </button>
      </div>

      {total > 1 ? (
        <>
          <button
            type="button"
            className="lb-nav prev"
            aria-label="上一张"
            title="上一张"
            disabled={index <= 0}
            onClick={() => setIndex((current) => Math.max(0, current - 1))}
          >
            <IconChevronLeft />
          </button>
          <button
            type="button"
            className="lb-nav next"
            aria-label="下一张"
            title="下一张"
            disabled={index >= total - 1}
            onClick={() => setIndex((current) => Math.min(total - 1, current + 1))}
          >
            <IconChevronRight />
          </button>
        </>
      ) : null}

      <div className="lb-info">
        <span className="lb-size">{natural ? `${natural.w} × ${natural.h}` : failed ? '—' : '读取中'}</span>
        {total > 1 ? <span className="lb-count">{index + 1} / {total}</span> : null}
        {!failed ? <span className="lb-zoom">{Math.round(zoom * 100)}%</span> : null}
      </div>
    </div>,
    document.body
  );
}

/** 与 PdfViewer 工具条同一套规格：20px / 1.9 描边，折算约 1.6px，30px 按钮里最清楚。 */
const S = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
};

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
 * 适应窗口：沿对角线相向而行的两支箭头 —— 「收回到窗口里」。
 *
 * <p>四角括号是「全屏」的语汇（见 PdfViewer 的 IconFull 注释），而本按钮在放大态下的
 * 实际动作恰恰是**缩回**，用外扩箭头会与按钮行为相反。
 */
const IconFit = () => (
  <svg {...S} aria-hidden="true">
    <path d="M4.5 4.5 10 10" />
    <path d="M6.8 10H10V6.8" />
    <path d="M19.5 19.5 14 14" />
    <path d="M14 17.2V14h3.2" />
  </svg>
);

/** 旋转：Feather 的 rotate-ccw / rotate-cw，弧线末端带回头箭头。 */
const IconRotateLeft = () => (
  <svg {...S} aria-hidden="true">
    <path d="M3 3v6h6" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L3 9" />
  </svg>
);

const IconRotateRight = () => (
  <svg {...S} aria-hidden="true">
    <path d="M21 3v6h-6" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L21 9" />
  </svg>
);

/** 拖拽：张开的手。三根手指各是一段「上圆弧 + 两竖」，掌部由一段大弧兜住。 */
const IconHand = () => (
  <svg {...S} aria-hidden="true">
    <path d="M7.5 13.5V6.6a1.5 1.5 0 0 1 3 0V12" />
    <path d="M10.5 12V5.6a1.5 1.5 0 0 1 3 0V12" />
    <path d="M13.5 12.4V7.4a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6 5 5 0 0 1-4.5-2.8L5 16.6a1.5 1.5 0 0 1 2.5-1.6l1.4 1.7" />
  </svg>
);

const IconClose = () => (
  <svg {...S} aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

const IconChevronLeft = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </svg>
);

const IconChevronRight = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9.5 5.5 16 12l-6.5 6.5" />
  </svg>
);
