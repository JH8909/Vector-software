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
  const innerRef = useRef<HTMLDivElement>(null);
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

  // ── Zoom: mutate transform directly, skip React render cycle ──
  const zoomRef = useRef(1);
  const panXRef = useRef(0);
  const panYRef = useRef(0);

  // Sync refs → React state only on final position (for toolbar % display)
  const syncState = useCallback(() => {
    setZoom(zoomRef.current);
    setPanX(panXRef.current);
    setPanY(panYRef.current);
  }, []);

  // Apply transform to inner div
  const applyTransform = useCallback(() => {
    if (innerRef.current) {
      innerRef.current.style.transform = `translate(${panXRef.current}px,${panYRef.current}px) scale(${zoomRef.current})`;
    }
  }, []);

  const fitView = useCallback(() => {
    zoomRef.current = 1; panXRef.current = 0; panYRef.current = 0;
    applyTransform(); syncState();
  }, [applyTransform, syncState]);

  // Mouse-wheel zoom: direct DOM mutation, no React state
  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const h = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const oldZ = zoomRef.current;
      const newZ = Math.min(16, Math.max(0.05, oldZ * (e.deltaY > 0 ? 0.9 : 1.1)));
      if (newZ === oldZ) return;
      zoomRef.current = newZ;
      // keep cursor point fixed
      panXRef.current = cx - (cx - panXRef.current) * (newZ / oldZ);
      panYRef.current = cy - (cy - panYRef.current) * (newZ / oldZ);
      applyTransform();
      // Debounce React state sync
      if (!(el as any)._zoomTimer) {
        (el as any)._zoomTimer = setTimeout(() => {
          (el as any)._zoomTimer = null;
          syncState();
        }, 60);
      }
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, [applyTransform, syncState]);

  // ── pointer ──
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = e.target as HTMLElement; el.setPointerCapture(e.pointerId);
    if (el.closest('[data-handle]')) {
      actionRef.current = 'split';
      baseRef.current = { ...baseRef.current, split: splitPos };
    } else if (zoomRef.current > 1.02) {
      actionRef.current = 'pan';
      baseRef.current = { x: e.clientX - panXRef.current, y: e.clientY - panYRef.current, split: 0 };
    }
  }, [splitPos]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (actionRef.current === 'pan') {
      panXRef.current = e.clientX - baseRef.current.x;
      panYRef.current = e.clientY - baseRef.current.y;
      applyTransform();
    } else if (actionRef.current === 'split') {
      const r = containerRef.current?.getBoundingClientRect(); if (!r) return;
      setSplitPos(Math.max(2, Math.min(98, ((e.clientX - r.left) / r.width) * 100)));
    }
  }, [applyTransform]);

  const onPointerUp = useCallback(() => {
    if (actionRef.current === 'pan') syncState();
    actionRef.current = null;
  }, [syncState]);

  // Button zoom: from center of container
  const zoomIn = useCallback(() => {
    const r = containerRef.current?.getBoundingClientRect();
    const cx = r ? r.width / 2 : 0, cy = r ? r.height / 2 : 0;
    const oldZ = zoomRef.current; const newZ = Math.min(16, oldZ * 1.5);
    zoomRef.current = newZ;
    panXRef.current = cx - (cx - panXRef.current) * (newZ / oldZ);
    panYRef.current = cy - (cy - panYRef.current) * (newZ / oldZ);
    applyTransform(); syncState();
  }, [applyTransform, syncState]);

  const zoomOut = useCallback(() => {
    const r = containerRef.current?.getBoundingClientRect();
    const cx = r ? r.width / 2 : 0, cy = r ? r.height / 2 : 0;
    const oldZ = zoomRef.current; const newZ = Math.max(0.05, oldZ / 1.5);
    zoomRef.current = newZ;
    panXRef.current = cx - (cx - panXRef.current) * (newZ / oldZ);
    panYRef.current = cy - (cy - panYRef.current) * (newZ / oldZ);
    applyTransform(); syncState();
  }, [applyTransform, syncState]);

  const modes = [
    { key: 'side-by-side' as ViewMode, label: '对比', icon: Columns2 },
    { key: 'original' as ViewMode, label: '原图', icon: Image },
    { key: 'vector' as ViewMode, label: '矢量', icon: MousePointer2 },
  ];

  const busy = jobStatus === 'processing';
  const showEmpty = !svg && !busy && !sourceDataUrl;

  return (
    <div className="compact-card h-full flex flex-col select-none">
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

      <div className="flex-1 relative min-h-0"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
        <div ref={containerRef}
          className="absolute inset-0 overflow-hidden checkerboard-bg"
          style={{ cursor: actionRef.current==='split' ? 'col-resize' : actionRef.current==='pan' ? 'grabbing' : zoom > 1.02 ? 'grab' : 'default' }}>
          <div ref={innerRef} className="absolute w-full h-full" style={{ transformOrigin: '0 0' }}>
            {viewMode === 'side-by-side' && sourceDataUrl && svg && (
              <div className="relative w-full h-full">
                <img src={sourceDataUrl} alt="" className="absolute inset-0 w-full h-full"
                  style={{ objectFit: 'contain', clipPath: `inset(0 ${100-splitPos}% 0 0)` }} draggable={false} />
                <img src={svg} alt="" className="absolute inset-0 w-full h-full"
                  style={{ objectFit: 'contain', clipPath: `inset(0 0 0 ${splitPos}%)` }} draggable={false} />
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

        {showEmpty && <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">上传图片开始转换</div>}
      </div>
    </div>
  );
}
