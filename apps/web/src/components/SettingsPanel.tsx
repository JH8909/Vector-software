'use client';

import { useCallback } from 'react';
import { useStore } from '@/store/useStore';
import { VectorMode } from '@/types';

type ModeOrder = readonly { key: VectorMode; label: string; desc: string; bestFor: string }[];

const MODES: ModeOrder = [
  { key: 'logo_color', label: 'Logo 色块', desc: 'Logo、图标、简约图形', bestFor: '适合 3-12 色的平面 Logo 和图标' },
  { key: 'line_art', label: '黑白线稿', desc: '线稿、文字、扫描稿', bestFor: '适合黑白线稿和书法文字' },
  { key: 'illustration_color', label: '插画色块', desc: '插画、贴纸、包装', bestFor: '适合 6-16 色的扁平插画和贴纸' },
  { key: 'high_precision', label: '高精度轮廓', desc: '细节丰富、照片风格', bestFor: '适合复杂渐变和写实风格' },
];

/** 与 makeOpts 一致：α = clamp(0.55 + sf - cf*0.45, 0.15, 1.35) */
function tipAlpha(smoothness: number, corner: number) {
  return Math.max(0.15, Math.min(1.35, 0.55 + (smoothness / 100) * 1.0 - (corner / 100) * 0.45));
}

export function SettingsPanel() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const converting = useStore((s) => s.jobStatus) === 'processing';

  const onSlider = useCallback((key: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setSettings({ [key]: Number(e.target.value) });
  }, [setSettings]);

  const sliderTips: Record<string, (v: number) => string> = {
    colorCount: (v) =>
      `追踪 ${Math.min(v, 16)} 种颜色${v <= 1 ? ' — 单色无描边' : v <= 4 ? ' — 干净色块' : v <= 8 ? ' — 标准' : ' — 丰富层次'}`,
    noiseReduction: (v) => {
      const turd = Math.round((v / 100) * 12);
      const nb = v <= 0 ? 0 : v < 20 ? 1 : v < 40 ? 2 : v < 60 ? 3 : v < 80 ? 4 : 5;
      return `掩码邻域≥${nb} + turdSize=${turd}${v < 20 ? ' — 保留细节' : v < 50 ? ' — 标准去噪' : ' — 激进去噪'}`;
    },
    pathPrecision: (v) => {
      const tol = Math.max(0.06, 0.55 - (v / 100) * 0.42);
      return `拟合容差 ${tol.toFixed(2)}px${v < 40 ? ' — 宽松简化' : v < 70 ? ' — 均衡' : ' — 精准拟合'}`;
    },
    smoothness: (v) => {
      const a = tipAlpha(v, settings.cornerPreservation);
      return `α=${a.toFixed(2)} ${v < 30 ? '— 直角优先' : v < 60 ? '— 均衡' : v < 85 ? '— 圆弧平滑' : '— 高度曲线'}`;
    },
    cornerPreservation: (v) => {
      const a = tipAlpha(settings.smoothness, v);
      return `α=${a.toFixed(2)} ${v < 30 ? '— 全曲线' : v < 60 ? '— 均衡' : v < 85 ? '— 保持直角' : '— 严格直角'}`;
    },
    minArea: (v) =>
      `丢弃 <${Math.max(30, v * 8)} 像素色块${v < 5 ? ' — 保留较多' : v < 15 ? ' — 轻量过滤' : v < 30 ? ' — 标准' : ' — 仅大色块'}`,
  };

  const SLIDERS = [
    { key: 'colorCount' as const, label: '颜色数量', min: 1, max: 16, step: 1 },
    { key: 'noiseReduction' as const, label: '去噪强度', min: 0, max: 100, step: 1 },
    { key: 'pathPrecision' as const, label: '路径精度', min: 10, max: 100, step: 1 },
    { key: 'smoothness' as const, label: '边缘平滑', min: 0, max: 100, step: 1 },
    { key: 'cornerPreservation' as const, label: '角点保留', min: 0, max: 100, step: 1 },
    { key: 'minArea' as const, label: '碎片过滤', min: 0, max: 50, step: 1 },
  ];

  return (
    <div className="compact-card p-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">转换参数</h3>
        {converting && <span className="text-[10px] text-blue-500 animate-pulse">更新中</span>}
      </div>

      {/* Mode selector */}
      <div className="mb-3 space-y-1">
        <label className="text-xs text-gray-400 mb-1.5 block">预设模式</label>
        {MODES.map(m => (
          <button key={m.key} onClick={() => setSettings({ mode: m.key })}
            className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-colors ${
              settings.mode === m.key
                ? 'bg-blue-50 border border-blue-200 text-blue-700'
                : 'hover:bg-gray-50 border border-transparent text-gray-600'
            }`}>
            <div className="font-medium">{m.label}</div>
            <div className="text-[11px] opacity-60">{m.bestFor}</div>
          </button>
        ))}
      </div>

      {/* Sliders */}
      <div className="border-t border-gray-100 pt-2.5 space-y-3">
        {SLIDERS.map(s => {
          const val = settings[s.key];
          return (
            <div key={s.key}>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-gray-500">{s.label}</label>
                <span className="text-xs font-mono font-semibold text-gray-800 bg-gray-100 px-1.5 py-0.5 rounded tabular-nums">
                  {val}
                </span>
              </div>
              <input type="range" min={s.min} max={s.max} step={s.step}
                value={val} onChange={onSlider(s.key)} className="compact-slider" />
              <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{sliderTips[s.key](val)}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
