'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Download, RefreshCw } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { ImageInfoPanel } from '@/components/ImageInfoPanel';
import { CompareViewer } from '@/components/CompareViewer';
import { SettingsPanel } from '@/components/SettingsPanel';
import { LayerPanel } from '@/components/LayerPanel';
import { JobStatusBar } from '@/components/JobStatusBar';
import { QualityReportPanel } from '@/components/QualityReportPanel';

export default function WorkspacePage() {
  const router = useRouter();
  const sourceDataUrl = useStore((s) => s.sourceDataUrl);
  const sourceFile = useStore((s) => s.sourceFile);
  const svgResult = useStore((s) => s.svgResult);
  const layeredSvg = useStore((s) => s.layeredSvg);
  const exportLayered = useStore((s) => s.exportLayered);
  const svgPreviewUrl = useStore((s) => s.svgPreviewUrl);
  const jobStatus = useStore((s) => s.jobStatus);
  const errorMessage = useStore((s) => s.errorMessage);
  const imageInfo = useStore((s) => s.imageInfo);
  const reset = useStore((s) => s.reset);
  const startConversion = useStore((s) => s.startConversion);
  const prepareFile = useStore((s) => s.prepareFile);

  const uploadRef = useRef<HTMLInputElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const startedRef = useRef(false);
  const fileRef = useRef<File | null>(null);

  // 恢复
  useEffect(() => {
    if (!sourceDataUrl) {
      const stored = sessionStorage.getItem('vf_dataurl');
      if (stored) useStore.getState().restoreFromCache(stored);
    }
  }, [sourceDataUrl]);

  // 自动转换
  useEffect(() => {
    if (sourceDataUrl && sourceFile && !startedRef.current) {
      startedRef.current = true;
      fileRef.current = sourceFile;
      startConversion();
    }
  }, [sourceDataUrl, sourceFile, startConversion]);

  useEffect(() => {
    if (jobStatus === 'failed') startedRef.current = false;
  }, [jobStatus]);

  useEffect(() => {
    if (sourceFile && fileRef.current && sourceFile !== fileRef.current) {
      startedRef.current = false;
      fileRef.current = sourceFile;
    }
  }, [sourceFile]);

  // ── 上传 ──
  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type)) { alert('仅支持 PNG、JPG、WebP 格式'); return; }
    if (file.size > 20*1024*1024) { alert('文件大小不能超过 20MB'); return; }
    startedRef.current = false;
    await prepareFile(file);
    if (uploadRef.current) uploadRef.current.value = '';
  }, [prepareFile]);

  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); }, []);
  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type)) { alert('仅支持 PNG、JPG、WebP 格式'); return; }
    if (file.size > 20*1024*1024) { alert('文件大小不能超过 20MB'); return; }
    startedRef.current = false;
    await prepareFile(file);
  }, [prepareFile]);

  // ── 一键导出 SVG（按 exportLayered 选择分层或扁平） ──
  const exportSVG = useCallback(() => {
    const out = exportLayered ? layeredSvg : svgResult;
    if (!out) return;
    const base = (imageInfo?.name || 'vector').replace(/\.[^.]+$/,'') + (exportLayered ? '_layered' : '') + '.svg';
    const blob = new Blob([out], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = linkRef.current;
    if (a) { a.href = url; a.download = base; a.click(); }
    URL.revokeObjectURL(url);
  }, [svgResult, layeredSvg, exportLayered, imageInfo]);

  return (
    <div className="h-screen flex flex-col bg-gray-50" onDragOver={onDragOver} onDrop={onDrop}>
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 shrink-0 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => { reset(); router.push('/'); }} className="shrink-0 flex items-center gap-1.5 text-gray-500 hover:text-gray-700">
            <div className="w-6 h-6 bg-blue-600 rounded flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M3 3h18v18H3z" /><path d="M7 17l4-8 4 4 2-2 4 6" />
              </svg>
            </div>
          </button>
          <button onClick={() => uploadRef.current?.click()} className="compact-btn-secondary text-xs shrink-0">
            <Upload className="w-3 h-3" /><span className="hidden sm:inline">上传图片</span>
          </button>
          <input ref={uploadRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleUpload} />
          {imageInfo && (
            <span className="text-xs text-gray-400 truncate hidden sm:inline">
              {imageInfo.name} · {imageInfo.width}×{imageInfo.height}
            </span>
          )}
        </div>
        <button onClick={exportSVG} disabled={jobStatus !== 'completed' || !svgPreviewUrl}
          className="compact-btn-primary text-xs shrink-0">
          <Download className="w-3.5 h-3.5" />导出 SVG
        </button>
        <a ref={linkRef} className="hidden" />
      </header>

      {jobStatus === 'failed' && errorMessage && (
        <div className="mx-4 mt-2 px-3 py-2 bg-red-50 border border-red-200 rounded-md text-sm text-red-700 flex items-center justify-between">
          <span>{errorMessage}</span>
          <button onClick={() => { startedRef.current = false; startConversion(); }}
            className="flex items-center gap-1 text-red-600 hover:text-red-800 text-xs font-medium">
            <RefreshCw className="w-3 h-3" />重试
          </button>
        </div>
      )}

      <div className="flex-1 flex gap-3 p-3 min-h-0">
        {!sourceDataUrl ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-md">
              <div className="w-16 h-16 mx-auto mb-4 bg-blue-50 rounded-full flex items-center justify-center">
                <Upload className="w-7 h-7 text-blue-500" />
              </div>
              <h2 className="text-lg font-semibold text-gray-800 mb-2">开始转换</h2>
              <p className="text-sm text-gray-500 mb-4">上传图片，自动转换为可编辑矢量图形</p>
              <button onClick={() => uploadRef.current?.click()} className="compact-btn-primary text-sm px-4 py-2">
                <Upload className="w-4 h-4" />选择图片
              </button>
              <p className="text-xs text-gray-400 mt-3">或拖放图片到此处 · PNG / JPG / WebP</p>
            </div>
          </div>
        ) : (
          <>
            <div className="w-56 shrink-0 flex flex-col gap-3 overflow-y-auto custom-scrollbar">
              <ImageInfoPanel />
              <QualityReportPanel />
            </div>
            <div className="flex-1 min-w-0">
              <CompareViewer />
            </div>
            <div className="w-64 shrink-0 flex flex-col gap-3 overflow-y-auto custom-scrollbar">
              <LayerPanel />
              <SettingsPanel />
            </div>
          </>
        )}
      </div>

      {sourceDataUrl && <JobStatusBar />}
    </div>
  );
}
