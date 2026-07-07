'use client';

import { useStore } from '@/store/useStore';
import { AlertTriangle, CheckCircle, Info, Shield } from 'lucide-react';

export function QualityReportPanel() {
  const qualityReport = useStore((s) => s.qualityReport);
  const jobStatus = useStore((s) => s.jobStatus);

  if (!qualityReport || jobStatus !== 'completed') return null;

  const iconMap = {
    error: AlertTriangle,
    warning: AlertTriangle,
    info: Info,
  };

  const colorMap = {
    error: 'text-red-600 bg-red-50 border-red-200',
    warning: 'text-amber-600 bg-amber-50 border-amber-200',
    info: 'text-blue-600 bg-blue-50 border-blue-200',
  };

  return (
    <div className="compact-card p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Shield className="w-3.5 h-3.5 text-gray-400" />
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">质量检查</h3>
      </div>

      {/* Print ready status */}
      <div className={`flex items-center gap-1.5 text-xs mb-2 px-2 py-1 rounded ${qualityReport.isPrintReady ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
        {qualityReport.isPrintReady ? (
          <><CheckCircle className="w-3 h-3" /> 适合印刷</>
        ) : (
          <><AlertTriangle className="w-3 h-3" /> 有优化空间</>
        )}
      </div>

      {/* Warnings */}
      {qualityReport.warnings.length > 0 && (
        <div className="space-y-1 mb-2">
          {qualityReport.warnings.map((w, i) => {
            const Icon = iconMap[w.severity];
            const colors = colorMap[w.severity];
            return (
              <div key={i} className={`flex items-start gap-1.5 text-xs px-2 py-1 rounded border ${colors}`}>
                <Icon className="w-3 h-3 mt-0.5 shrink-0" />
                <span>{w.message}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Stats */}
      <div className="flex gap-3 text-xs text-gray-500 pt-1 border-t border-gray-100">
        <span>路径 <strong className="text-gray-800">{qualityReport.pathCount}</strong></span>
        <span>颜色 <strong className="text-gray-800">{qualityReport.colorCount}</strong></span>
        <span>大小 <strong className="text-gray-800">{(qualityReport.estimatedFileSize / 1024).toFixed(0)}KB</strong></span>
      </div>
    </div>
  );
}
