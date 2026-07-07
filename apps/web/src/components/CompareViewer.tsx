'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { useStore } from '@/store/useStore';
import { ZoomIn, ZoomOut, Maximize2, Columns2, Image, MousePointer2 } from 'lucide-react';

type ViewMode = 'side-by-side' | 'original' | 'vector';

export function CompareViewer() {
  const sourceDataUrl = useStore((s) => s.sourceDataUrl);
  const svgPreviewUrl = useStore((s) => s.svgPreviewUrl);
  const jobStatus = useStore((s) => s.jobStatus);

  const [viewMode, setViewMode] = useState<ViewMode>('side-by-side');
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [splitPos, setSplitPos] = useState(50);

  const containerRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef<'split' | 'pan' | null>(null);
  const baseRef = useRef({ x: 0, y: 0, split: 50 });

  // ── SVG preload ──
  const lastUrl = useRef<string | null>(null);
  const [visibleUrl, setVisibleUrl] = useState<string | null>(null);
  useEffect(() => {
    if (svgPreviewUrl) {
      const p = new window.Image();
      p.onload = () => { setVisibleUrl(svgPreviewUrl); lastUrl.current = svgPreviewUrl; };
      p.src = svgPreviewUrl;
    } else { setVisibleUrl(null); lastUrl.current = null; }
  }, [svgPreviewUrl]);
  const svg = visibleUrl || lastUrl.current;

  // ── zoom actions ──
  const fitView = useCallback(() => { setZoom(1); setPanX(0); setPanY(0); }, []);

  const zoomBy = useCallback((factor: number, cx: number, cy: number) => {
    setZoom(z => {
      const next = Math.min(16, Math.max(0.05, z * factor));
      if (next === z) return z;
      // zoom toward cursor: keep the point under (cx,cy) fixed in the viewport
      const ratio = next / z;
      setPanX(px => cx - (cx - px) * ratio);
      setPanY(py => cy - (cy - py) * ratio);
      return next;
    });
  }, []);


  // toolbar buttons zoom from container center
  const zoomIn = useCallback(() => {
    const r = containerRef.current?.getBoundingClientRect();
    zoomBy(1.5, r ? r.width / 2 : 0, r ? r.height / 2 : 0);
  }, [zoomBy]);
  const zoomOut = useCallback(() => {
    const r = containerRef.current?.getBoundingClientRect();
    zoomBy(1 / 1.5, r ? r.width / 2 : 0, r ? r.height / 2 : 0);
  }, [zoomBy]);

  // ── wheel: zoom centred on cursor ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      zoomBy(e.deltaY > 0 ? 0.9 : 1.1, cx, cy);
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, [zoomBy]);

  // ── pointer ──
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = e.target as HTMLElement;
    el.setPointerCapture(e.pointerId);

    if (el.closest('[data-handle]')) {
      // split drag — always works regardless of zoom
      actionRef.current = 'split';
      baseRef.current = { ...baseRef.current, split: splitPos };
    } else {
      // pan only when zoomed in; at 1× just do nothing
      actionRef.current = 'pan';
      baseRef.current = { x: e.clientX - panX, y: e.clientY - panY, split: 0 };
    }
  }, [panX, panY, splitPos]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const a = actionRef.current;
    if (!a) return;

    if (a === 'pan') {
      setPanX(e.clientX - baseRef.current.x);
      setPanY(e.clientY - baseRef.current.y);
    } else {
      const r = containerRef.current?.getBoundingClientRect();
      if (!r) return;
      const raw = ((e.clientX - r.left) / r.width) * 100;
      setSplitPos(Math.max(2, Math.min(98, raw)));
    }
  }, []);

  const onPointerUp = useCallback(() => { actionRef.current = null; }, []);

  const modes = [
    { key: 'side-by-side' as ViewMode, label: '对比', icon: Columns2 },
    { key: 'original' as ViewMode, label: '原图', icon: Image },
    { key: 'vector' as ViewMode, label: '矢量', icon: MousePointer2 },
  ];

  const busy = jobStatus === 'processing';
  const showEmpty = !svg && !busy && !sourceDataUrl;
  const canPan = zoom > 1.02;

  return (
    <div className="compact-card h-full flex flex-col select-none">
      {/* toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-1">
          {modes.map(m => (
            <button key={m.key} onClick={() => setViewMode(m.key)}
              className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded transition ${
                viewMode===m.key ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-500 hover:bg-gray-100'}`}>
              <m.icon className="w-3 h-3" />{m.label}
            </button>
          ))}
          {busy && <span className="text-[10px] text-blue-500 ml-1 animate-pulse">更新中</span>}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-gray-400 w-8 text-right tabular-nums">{Math.round(zoom*100)}%</span>
          <button onClick={zoomOut} className="p-1 hover:bg-gray-100 rounded"><ZoomOut className="w-3 h-3 text-gray-500"/></button>
          <button onClick={fitView} className="p-1 hover:bg-gray-100 rounded"><Maximize2 className="w-3 h-3 text-gray-500"/></button>
          <button onClick={zoomIn} className="p-1 hover:bg-gray-100 rounded"><ZoomIn className="w-3 h-3 text-gray-500"/></button>
        </div>
      </div>

      {/* canvas + slider overlay */}
      <div className="flex-1 relative min-h-0"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {/* ── canvas (transformed layer) ── */}
        <div ref={containerRef}
          className="absolute inset-0 overflow-hidden checkerboard-bg"
          style={{ cursor: actionRef.current === 'split' ? 'col-resize' : actionRef.current === 'pan' ? 'grabbing' : canPan ? 'grab' : 'default' }}
        >
          <div className="absolute w-full h-full"
            style={{ transform: `translate(${panX}px,${panY}px) scale(${zoom})`, transformOrigin: '0 0' }}>

            {/* side-by-side: images only, slider is outside the transform */}
            {viewMode === 'side-by-side' && sourceDataUrl && svg && (
              <div className="relative w-full h-full">
                <img src={sourceDataUrl} alt=""
                  className="absolute inset-0 w-full h-full"
                  style={{ objectFit: 'contain', clipPath: `inset(0 ${100-splitPos}% 0 0)` }}
                  draggable={false} />
                <img src={svg} alt=""
                  className="absolute inset-0 w-full h-full"
                  style={{ objectFit: 'contain', clipPath: `inset(0 0 0 ${splitPos}%)` }}
                  draggable={false} />
              </div>
            )}

            {viewMode === 'original' && sourceDataUrl && (
              <img src={sourceDataUrl} alt="" className="max-w-full max-h-full object-contain" draggable={false} />
            )}
            {viewMode === 'vector' && svg && (
              <img src={svg} alt="" className="max-w-full max-h-full object-contain" draggable={false} />
            )}
          </div>
        </div>

        {/* ── split slider — fixed on screen, outside canvas transform ── */}
        {viewMode === 'side-by-side' && svg && sourceDataUrl && (
          <div className="absolute inset-0 pointer-events-none z-10">
            <div data-handle className="absolute top-0 bottom-0 cursor-col-resize pointer-events-auto"
              style={{ left: `${splitPos}%`, width: 0 }}>
              <div data-handle className="absolute inset-y-0 -left-[1.5px] w-[3px] bg-blue-500" />
              <div data-handle className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-7 bg-blue-500 rounded-sm flex items-center justify-center shadow-sm">
                <div className="flex gap-px"><div className="w-[2px] h-3 bg-white rounded" /><div className="w-[2px] h-3 bg-white rounded" /></div>
              </div>
            </div>
          </div>
        )}

        {/* empty state */}
        {showEmpty && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
            上传图片开始转换
          </div>
        )}
      </div>
    </div>
  );
}
