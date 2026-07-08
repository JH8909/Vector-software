'use client';

import { useStore } from '@/store/useStore';
import { Eye, EyeOff } from 'lucide-react';

export function LayerPanel() {
  const layers = useStore((s) => s.layers);
  const toggleLayer = useStore((s) => s.toggleLayer);
  const jobStatus = useStore((s) => s.jobStatus);
  const exportLayered = useStore((s) => s.exportLayered);
  const setExportLayered = useStore((s) => s.setExportLayered);

  if (!layers || layers.length === 0) return null;

  return (
    <div className="compact-card p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          图层 ({layers.length})
        </h3>
        <label className="flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={exportLayered}
            onChange={(e) => setExportLayered(e.target.checked)}
            className="accent-blue-600"
          />
          保留图层
        </label>
      </div>

      <div className="space-y-0.5 max-h-[320px] overflow-y-auto custom-scrollbar">
        {layers.map((layer, i) => (
          <div
            key={layer.id}
            className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs hover:bg-gray-50 transition-colors group"
          >
            {/* 颜色色块 */}
            <div
              className="w-4 h-4 rounded border border-gray-200 shrink-0"
              style={{ backgroundColor: layer.fill }}
            />
            {/* 图层名 */}
            <span className="flex-1 truncate text-gray-700 min-w-0">
              {layer.name}
            </span>
            {/* 类型标签 */}
            {layer.type === 'background' && (
              <span className="text-[10px] text-gray-400 bg-gray-100 px-1 rounded">背景</span>
            )}
            {/* 显隐开关 */}
            <button
              onClick={() => toggleLayer(layer.id)}
              className="shrink-0 text-gray-400 hover:text-gray-600 p-0.5"
              title={layer.visible ? '隐藏' : '显示'}
            >
              {layer.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3 text-gray-300" />}
            </button>
          </div>
        ))}
      </div>

      {jobStatus === 'completed' && (
        <p className="text-[10px] text-gray-400 mt-2 pt-2 border-t border-gray-100">
          {exportLayered
            ? '导出 SVG 保留 &lt;g&gt; 图层结构，Illustrator / Figma 可选中和编辑单层'
            : '导出 SVG 所有路径合并为扁平结构'}
        </p>
      )}
    </div>
  );
}
