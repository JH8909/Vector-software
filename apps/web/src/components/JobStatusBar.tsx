'use client';

import { useStore } from '@/store/useStore';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

export function JobStatusBar() {
  const jobStatus = useStore((s) => s.jobStatus);
  const qualityReport = useStore((s) => s.qualityReport);
  const imageInfo = useStore((s) => s.imageInfo);

  if (!imageInfo) return null;

  return (
    <div className="shrink-0 flex items-center justify-between px-4 py-1.5 bg-white border-t border-gray-200 text-xs text-gray-500">
      <div className="flex items-center gap-3">
        {jobStatus === 'processing' && (
          <span className="flex items-center gap-1.5 text-blue-600">
            <Loader2 className="w-3 h-3 animate-spin" />
            转换中...
          </span>
        )}
        {jobStatus === 'completed' && (
          <span className="flex items-center gap-1.5 text-green-600">
            <CheckCircle2 className="w-3 h-3" />
            转换完成
          </span>
        )}
        {jobStatus === 'failed' && (
          <span className="flex items-center gap-1.5 text-red-600">
            <XCircle className="w-3 h-3" />
            转换失败
          </span>
        )}
        {jobStatus === 'idle' && (
          <span className="text-gray-400">就绪</span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {qualityReport && (
          <>
            <span>路径 {qualityReport.pathCount}</span>
            <span>颜色 {qualityReport.colorCount}</span>
          </>
        )}
        <span className="text-gray-300">|</span>
        <span>{imageInfo.width} × {imageInfo.height}</span>
      </div>
    </div>
  );
}
