/**
 * 矢量化共享工具（legacy + 主引擎共用）
 */

import { VectorMode, VectorSettings } from '@/types';

export function resolveModeSettings(s: VectorSettings): VectorSettings & {
  maxColors: number;
  useSoftFringe: boolean;
} {
  switch (s.mode as VectorMode) {
    case 'line_art':
      return { ...s, maxColors: 1, useSoftFringe: true };
    case 'logo_color':
      return { ...s, maxColors: Math.min(Math.max(1, s.colorCount), 12), useSoftFringe: true };
    case 'illustration_color':
      return { ...s, maxColors: Math.min(Math.max(1, s.colorCount), 16), useSoftFringe: false };
    case 'high_precision':
      return { ...s, maxColors: Math.min(Math.max(1, s.colorCount), 16), useSoftFringe: false };
    default:
      return { ...s, maxColors: Math.min(Math.max(1, s.colorCount), 16), useSoftFringe: true };
  }
}

export function makeOpts(s: VectorSettings) {
  const sf = s.smoothness / 100;
  const cf = s.cornerPreservation / 100;
  const pf = s.pathPrecision / 100;
  const nf = s.noiseReduction / 100;
  return {
    turdSize: Math.round(nf * 10),
    alphaMax: Math.max(0.2, Math.min(1.2, 0.6 + sf * 0.85 - cf * 0.4)),
    optCurve: true,
    optTolerance: Math.max(0.08, 0.52 - pf * 0.38),
  };
}

export function computeMinPx(settings: VectorSettings, totalPx: number): number {
  const areaFloor = Math.max(8, settings.minArea * 3);
  const noiseBoost = Math.round((settings.noiseReduction / 100) * 12);
  const relative = totalPx * 0.00005;
  return Math.round(Math.max(areaFloor + noiseBoost, relative, 8));
}
