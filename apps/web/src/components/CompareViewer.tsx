'use client';

import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useStore } from '@/store/useStore';
import { ZoomIn, ZoomOut, Maximize2, Columns2, Image, MousePointer2, Loader2 } from 'lucide-react';

type ViewMode = 'side-by-side' | 'original' | 'vector';
type DragMode = 'split' | 'pan' | null;

interface FitBox {
  offX: number;
  offY: number;
  imgW: number;
  imgH: number;
  cw: number;
  ch: number;
}

interface ViewTransform {
  zoom: number;
  panX: number;
  panY: number;
}

function computeFitBox(cw: number, ch: number, iw: number, ih: number): FitBox {
  if (cw <= 0 || ch <= 0 || iw <= 0 || ih <= 0) {
    return { offX: 0, offY: 0, imgW: cw, imgH: ch, cw, ch };
  }
  const scale = Math.min(cw / iw, ch / ih);
  const imgW = iw * scale;
  const imgH = ih * scale;
  return {
    offX: (cw - imgW) / 2,
    offY: (ch - imgH) / 2,
    imgW,
    imgH,
    cw,
    ch,
  };
}

/** innerRef 局部坐标 → 容器坐标（transform-origin: center） */
function localToContainer(
  localX: number,
  cw: number,
  ch: number,
  t: ViewTransform,
): number {
  const cx = cw / 2;
  return t.panX + cx + (localX - cx) * t.zoom;
}

/** 容器坐标 → innerRef 局部坐标 */
function containerToLocal(
  containerX: number,
  cw: number,
  ch: number,
  t: ViewTransform,
): number {
  const cx = cw / 2;
  return cx + (containerX - t.panX - cx) / t.zoom;
}

function parseSvgDimensions(svg: string | null): { w: number; h: number } | null {
  if (!svg) return null;
  const vb = svg.match(/viewBox="\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)\s*"/i);
  if (vb) {
    const w = parseFloat(vb[1]);
    const h = parseFloat(vb[2]);
    if (w > 0 && h > 0) return { w, h };
  }
  return null;
}

function originalClip(splitPct: number): string {
  const right = Math.max(0, Math.min(100, 100 - splitPct));
  return `inset(0 ${right}% 0 0)`;
}

/** 仅渲染对比图层（在可缩放 innerRef 内） */
function CompareLayers({
  sourceDataUrl,
  svgPreviewUrl,
  splitPos,
  box,
}: {
  sourceDataUrl: string;
  svgPreviewUrl: string;
  splitPos: number;
  box: FitBox;
}) {
  const pct = Math.max(1, Math.min(99, splitPos));

  return (
    <div
      className="absolute overflow-hidden"
      style={{
        left: box.offX,
        top: box.offY,
        width: box.imgW,
        height: box.imgH,
      }}
    >
      <img
        src={svgPreviewUrl}
        alt="矢量"
        className="absolute inset-0 h-full w-full object-contain object-center pointer-events-none select-none"
        draggable={false}
      />
      <img
        src={sourceDataUrl}
        alt="原图"
        className="absolute inset-0 h-full w-full object-contain object-center pointer-events-none select-none"
        style={{ clipPath: originalClip(pct) }}
        draggable={false}
      />
    </div>
  );
}

/**
 * 滑块 UI：放在 container 层，不参与 zoom transform。
 * 竖线高度 = 整个显示窗口；位置随 splitPos 映射到屏幕坐标。
 */
function SplitOverlay({
  screenX,
  onPointerDown,
}: {
  screenX: number;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <div className="absolute inset-0 z-20 pointer-events-none">
      <div
        className="absolute top-0 bottom-0 cursor-col-resize pointer-events-auto"
        style={{ left: screenX, transform: 'translateX(-50%)', width: 28 }}
        onPointerDown={onPointerDown}
      >
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-blue-600 shadow-[0_0_0_1px_rgba(37,99,235,0.45)]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex h-7 w-5 items-center justify-center rounded-sm bg-blue-600 shadow-md">
          <svg width="8" height="12" viewBox="0 0 8 12" fill="none" aria-hidden>
            <path d="M2 2v8M6 2v8" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      </div>
      <div className="absolute top-2 left-2 text-[10px] font-medium text-white bg-black/50 px-1.5 py-0.5 rounded">
        原图
      </div>
      <div className="absolute top-2 right-2 text-[10px] font-medium text-white bg-black/50 px-1.5 py-0.5 rounded">
        矢量
      </div>
    </div>
  );
}

export function CompareViewer() {
  const sourceDataUrl = useStore((s) => s.sourceDataUrl);
  const svgPreviewUrl = useStore((s) => s.svgPreviewUrl);
  const layeredSvg = useStore((s) => s.layeredSvg);
  const jobStatus = useStore((s) => s.jobStatus);
  const imageInfo = useStore((s) => s.imageInfo);

  const [viewMode, setViewMode] = useState<ViewMode>('side-by-side');
  const [splitPos, setSplitPos] = useState(50);
  const [fitBox, setFitBox] = useState<FitBox>({ offX: 0, offY: 0, imgW: 0, imgH: 0, cw: 0, ch: 0 });
  const [view, setView] = useState<ViewTransform>({ zoom: 1, panX: 0, panY: 0 });
  const [dragging, setDragging] = useState<DragMode>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const dragModeRef = useRef<DragMode>(null);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const viewRef = useRef<ViewTransform>(view);

  viewRef.current = view;

  const compareSize = useMemo(() => {
    const svgDim = parseSvgDimensions(layeredSvg);
    if (svgDim) return svgDim;
    if (imageInfo) return { w: imageInfo.width, h: imageInfo.height };
    return { w: 1, h: 1 };
  }, [layeredSvg, imageInfo]);

  const applyView = useCallback((next: ViewTransform) => {
    viewRef.current = next;
    setView(next);
    if (innerRef.current) {
      innerRef.current.style.transform =
        `translate(${next.panX}px,${next.panY}px) scale(${next.zoom})`;
    }
  }, []);

  const syncFitBox = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setFitBox(computeFitBox(el.clientWidth, el.clientHeight, compareSize.w, compareSize.h));
  }, [compareSize.w, compareSize.h]);

  const fitView = useCallback(() => {
    applyView({ zoom: 1, panX: 0, panY: 0 });
  }, [applyView]);

  useEffect(() => {
    fitView();
    setSplitPos(50);
  }, [sourceDataUrl, svgPreviewUrl, fitView]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    syncFitBox();
    const ro = new ResizeObserver(syncFitBox);
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncFitBox, viewMode]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const cur = viewRef.current;
      const oldZ = cur.zoom;
      const newZ = Math.min(16, Math.max(0.05, oldZ * (e.deltaY > 0 ? 0.9 : 1.1)));
      if (newZ === oldZ) return;
      applyView({
        zoom: newZ,
        panX: cx - (cx - cur.panX) * (newZ / oldZ),
        panY: cy - (cy - cur.panY) * (newZ / oldZ),
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyView]);

  const splitLocalX = fitBox.offX + fitBox.imgW * (splitPos / 100);
  const sliderScreenX = localToContainer(splitLocalX, fitBox.cw, fitBox.ch, view);

  const clientToSplitPos = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el || fitBox.imgW <= 0) return splitPos;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const box = computeFitBox(cw, ch, compareSize.w, compareSize.h);
    const containerX = clientX - el.getBoundingClientRect().left;
    const localX = containerToLocal(containerX, cw, ch, viewRef.current);
    return Math.max(1, Math.min(99, ((localX - box.offX) / box.imgW) * 100));
  }, [compareSize.w, compareSize.h, fitBox.imgW, splitPos]);

  const isCompareMode = viewMode === 'side-by-side' && Boolean(sourceDataUrl && svgPreviewUrl);
  const showCompare = isCompareMode && fitBox.imgW > 0;

  const onSplitPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragModeRef.current = 'split';
    setDragging('split');
    setSplitPos(clientToSplitPos(e.clientX));
  }, [clientToSplitPos]);

  const onCanvasPointerDown = useCallback((e: React.PointerEvent) => {
    if (!isCompareMode) {
      if (viewRef.current.zoom > 1.02) {
        dragModeRef.current = 'pan';
        setDragging('pan');
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          panX: viewRef.current.panX,
          panY: viewRef.current.panY,
        };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }
      return;
    }

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    if (viewRef.current.zoom > 1.02) {
      dragModeRef.current = 'pan';
      setDragging('pan');
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: viewRef.current.panX,
        panY: viewRef.current.panY,
      };
    } else {
      dragModeRef.current = 'split';
      setDragging('split');
      setSplitPos(clientToSplitPos(e.clientX));
    }
  }, [isCompareMode, clientToSplitPos]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const mode = dragModeRef.current;
    if (mode === 'split' && isCompareMode) {
      setSplitPos(clientToSplitPos(e.clientX));
      return;
    }
    if (mode === 'pan') {
      const start = panStartRef.current;
      applyView({
        ...viewRef.current,
        panX: start.panX + (e.clientX - start.x),
        panY: start.panY + (e.clientY - start.y),
      });
    }
  }, [isCompareMode, clientToSplitPos, applyView]);

  const onPointerUp = useCallback(() => {
    dragModeRef.current = null;
    setDragging(null);
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const el = containerRef.current;
    if (!el) return;
    const cx = el.clientWidth / 2;
    const cy = el.clientHeight / 2;
    const cur = viewRef.current;
    const newZ = Math.min(16, Math.max(0.05, cur.zoom * factor));
    applyView({
      zoom: newZ,
      panX: cx - (cx - cur.panX) * (newZ / cur.zoom),
      panY: cy - (cy - cur.panY) * (newZ / cur.zoom),
    });
  }, [applyView]);

  const busy = jobStatus === 'processing';
  const hasVector = Boolean(svgPreviewUrl);

  const cursor =
    dragging === 'pan' ? 'grabbing'
      : isCompareMode && view.zoom <= 1.02 ? 'col-resize'
      : view.zoom > 1.02 ? 'grab'
      : 'default';

  return (
    <div className="compact-card h-full flex flex-col select-none">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-1">
          {[
            { key: 'side-by-side' as ViewMode, label: '对比', icon: Columns2 },
            { key: 'original' as ViewMode, label: '原图', icon: Image },
            { key: 'vector' as ViewMode, label: '矢量', icon: MousePointer2 },
          ].map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setViewMode(m.key)}
              className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded transition ${
                viewMode === m.key ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              <m.icon className="w-3 h-3" />
              {m.label}
            </button>
          ))}
          {busy && <span className="text-[10px] text-blue-500 ml-1 animate-pulse">转换中</span>}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-gray-400 w-8 text-right tabular-nums">
            {Math.round(view.zoom * 100)}%
          </span>
          <button type="button" onClick={() => zoomBy(1 / 1.5)} className="p-1 hover:bg-gray-100 rounded">
            <ZoomOut className="w-3 h-3 text-gray-500" />
          </button>
          <button type="button" onClick={fitView} className="p-1 hover:bg-gray-100 rounded">
            <Maximize2 className="w-3 h-3 text-gray-500" />
          </button>
          <button type="button" onClick={() => zoomBy(1.5)} className="p-1 hover:bg-gray-100 rounded">
            <ZoomIn className="w-3 h-3 text-gray-500" />
          </button>
        </div>
      </div>

      <div className="flex-1 relative min-h-0">
        <div
          ref={containerRef}
          className="absolute inset-0 overflow-hidden checkerboard-bg"
          style={{ cursor }}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          {/* 可缩放层：仅图片 */}
          <div
            ref={innerRef}
            className="absolute inset-0"
            style={{
              transform: `translate(${view.panX}px,${view.panY}px) scale(${view.zoom})`,
              transformOrigin: 'center center',
            }}
          >
            {showCompare && (
              <CompareLayers
                sourceDataUrl={sourceDataUrl!}
                svgPreviewUrl={svgPreviewUrl!}
                splitPos={splitPos}
                box={fitBox}
              />
            )}

            {viewMode === 'side-by-side' && sourceDataUrl && !hasVector && (
              <img src={sourceDataUrl} alt="原图" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
            )}

            {viewMode === 'original' && sourceDataUrl && (
              <img src={sourceDataUrl} alt="原图" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
            )}

            {viewMode === 'vector' && hasVector && (
              <img src={svgPreviewUrl!} alt="矢量" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
            )}

            {viewMode === 'vector' && !hasVector && !busy && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">
                矢量结果尚未生成
              </div>
            )}
          </div>

          {/* 固定 UI 层：滑块不参与缩放 */}
          {showCompare && (
            <SplitOverlay screenX={sliderScreenX} onPointerDown={onSplitPointerDown} />
          )}
        </div>

        {busy && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/75 pointer-events-none">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            <p className="text-sm text-blue-700 mt-2 font-medium">正在转换为矢量图…</p>
          </div>
        )}

        {!sourceDataUrl && !busy && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">
            上传图片开始转换
          </div>
        )}
      </div>
    </div>
  );
}
