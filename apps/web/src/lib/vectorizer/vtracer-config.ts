/**
 * VectorSettings → VTracer WASM 参数映射
 *
 * 必须与官方 webapp 一致：
 * https://github.com/visioncortex/vtracer/blob/master/webapp/app/index.js
 *
 * 关键：clustering_mode、filter_speckle 平方一次、color_precision = 8 - ui值
 */

import { VectorMode, VectorSettings } from '@/types';

export interface VTracerDomConfig {
  canvas_id: string;
  svg_id: string;
  clustering_mode: 'color' | 'binary';
  mode: 'none' | 'polygon' | 'spline';
  hierarchical: 'stacked' | 'cutout';
  corner_threshold: number;
  length_threshold: number;
  max_iterations: number;
  splice_threshold: number;
  filter_speckle: number;
  color_precision: number;
  layer_difference: number;
  path_precision: number;
}

function deg2rad(deg: number): number {
  return (deg / 180) * Math.PI;
}

/** 官方 UI 滑块 color_precision（6–8，越大色越少） */
function mapUiColorPrecision(settings: VectorSettings): number {
  const cc = Math.max(1, Math.min(64, settings.colorCount));
  const mode = settings.mode as VectorMode;
  if (mode === 'high_precision') return Math.max(5, Math.min(7, 9 - Math.floor(cc / 5)));
  if (mode === 'logo_color') return 8;
  if (mode === 'illustration_color') return Math.max(6, Math.min(8, 9 - Math.floor(cc / 10)));
  return 7;
}

function mapLayerDifference(mode: VectorMode, colorCount: number): number {
  if (mode === 'high_precision') return Math.min(64, 24 + Math.round(colorCount * 1.2));
  if (mode === 'illustration_color') return Math.min(48, 28 + Math.round(colorCount * 0.25));
  return Math.min(40, 16 + Math.round(colorCount * 0.5));
}

function mapFilterSpeckleLinear(settings: VectorSettings): number {
  const nf = settings.noiseReduction / 100;
  const base = Math.round(2 + nf * 12);
  const areaBoost = Math.round(settings.minArea * 0.2);
  return Math.max(0, Math.min(16, base + areaBoost));
}

/** Node @neplex/vectorizer — colorPrecision 越高保留越多色（与 WASM 相反） */
function mapNeplexColorPrecision(settings: VectorSettings): number {
  const cc = Math.max(1, Math.min(64, settings.colorCount));
  const t = cc / 64;
  const mode = settings.mode as VectorMode;
  if (mode === 'high_precision') return Math.min(8, Math.max(6, Math.round(6 + t * 2)));
  if (mode === 'logo_color') return Math.min(7, Math.max(5, Math.round(5 + t * 1.5)));
  return Math.min(8, Math.max(5, Math.round(5.5 + t * 2)));
}

export function mapSettingsToNeplexConfig(settings: VectorSettings) {
  const mode = settings.mode as VectorMode;
  const smooth = settings.smoothness / 100;
  const corner = settings.cornerPreservation / 100;
  const pathPrec = settings.pathPrecision / 100;
  const cornerDeg = Math.round(30 + (1 - corner) * 150);

  return {
    colorMode: 0,
    hierarchical: mode === 'high_precision' ? 1 : 0,
    filterSpeckle: mapFilterSpeckleLinear(settings),
    colorPrecision: mapNeplexColorPrecision(settings),
    layerDifference: mapLayerDifference(mode, settings.colorCount),
    mode: smooth > 0.35 ? 2 : 1,
    cornerThreshold: cornerDeg,
    lengthThreshold: Math.max(1.5, 6 - smooth * 4),
    maxIterations: 10,
    spliceThreshold: 45,
    pathPrecision: Math.max(1, Math.min(8, Math.round(2 + pathPrec * 6))),
  };
}

export function mapSettingsToVTracer(
  settings: VectorSettings,
  canvasId: string,
  svgId: string,
): VTracerDomConfig {
  const mode = settings.mode as VectorMode;
  const smooth = settings.smoothness / 100;
  const corner = settings.cornerPreservation / 100;
  const pathPrec = settings.pathPrecision / 100;
  const cornerDeg = Math.round(30 + (1 - corner) * 150);
  const lengthThreshold = Math.max(1.5, 6 - smooth * 4);
  const uiColor = mapUiColorPrecision(settings);
  const speckle = mapFilterSpeckleLinear(settings);

  return {
    canvas_id: canvasId,
    svg_id: svgId,
    clustering_mode: 'color',
    mode: smooth > 0.35 ? 'spline' : 'polygon',
    hierarchical: mode === 'high_precision' ? 'cutout' : 'stacked',
    corner_threshold: deg2rad(cornerDeg),
    length_threshold: lengthThreshold,
    max_iterations: 10,
    splice_threshold: deg2rad(45),
    filter_speckle: speckle * speckle,
    color_precision: 8 - uiColor,
    layer_difference: mapLayerDifference(mode, settings.colorCount),
    path_precision: Math.max(1, Math.min(8, Math.round(2 + pathPrec * 6))),
  };
}
