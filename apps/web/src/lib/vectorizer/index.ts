/**
 * 矢量化引擎 — Potrace 线稿 + Legacy 彩色
 *
 * 彩色管线：背景 flood 掩码 → Oklab k-means 量化 → 堆叠式逐层 Potrace → SVG 后处理。
 * VTracer WASM 代码保留在 vtracer-* 中，待参数稳定后可切回对比。
 */

import { VectorSettings, QualityReport, LayerInfo, VectorMode } from '@/types';
import { getImageData, flattenFringeSoft } from '@/lib/utils/image';
import { optimizeSVGOutput } from '@/lib/utils/svg-simplify';
import { traceImageData } from './browser-potrace';
import { buildLayeredSVG, flattenSVG, LayerRecord } from './svg-assembler';
import { vectorizeColorLegacy } from './vectorize-legacy';
import { makeOpts, resolveModeSettings } from './index-shared';

export { makeOpts, computeMinPx, resolveModeSettings } from './index-shared';
export { vectorizeColorLegacy } from './vectorize-legacy';

export interface VectorizeResult {
  layeredSvg: string;
  flatSvg: string;
  pathCount: number;
  layers: LayerInfo[];
  qualityReport: QualityReport;
}

export async function vectorize(
  img: HTMLImageElement,
  settings: VectorSettings
): Promise<VectorizeResult> {
  const resolved = resolveModeSettings(settings);
  const { imageData: raw, usedWidth, usedHeight } = getImageData(img);
  const imageData = resolved.useSoftFringe ? flattenFringeSoft(raw) : raw;
  const opts = makeOpts(resolved);
  const totalPx = usedWidth * usedHeight;

  let layerRecords: LayerRecord[] = [];
  let layers: LayerInfo[] = [];

  if (resolved.mode === 'line_art') {
    const gray = new ImageData(usedWidth, usedHeight);
    for (let i = 0; i < imageData.data.length; i += 4) {
      const a = imageData.data[i + 3];
      if (a < 12) {
        gray.data[i] = gray.data[i + 1] = gray.data[i + 2] = 255;
      } else {
        const v = 0.299 * imageData.data[i] + 0.587 * imageData.data[i + 1] + 0.114 * imageData.data[i + 2];
        gray.data[i] = gray.data[i + 1] = gray.data[i + 2] = v;
      }
      gray.data[i + 3] = 255;
    }
    const result = await traceImageData(gray, {
      ...opts,
      turdSize: opts.turdSize + 1,
      blackOnWhite: true,
      color: '#000000',
      background: 'transparent',
    });
    const paths = extractPaths(result, '#000000');
    layerRecords = [{
      id: 'layer_001', name: 'line_art', fill: '#000000',
      visible: true, paths, pixelCount: totalPx, type: 'subject',
    }];
    layers = [{ id: 'layer_001', name: 'line_art', fill: '#000000', visible: true, type: 'subject' }];
  } else {
    layerRecords = await vectorizeColorLegacy(imageData, resolved, usedWidth, usedHeight);
    layers = layerRecords.map(r => ({
      id: r.id, name: r.name, fill: r.fill, visible: r.visible, type: r.type,
    }));
  }

  if (layerRecords.length === 0 || layerRecords.every(r => r.paths.length === 0)) {
    throw new Error('未生成矢量路径，请换一张图或调整参数后重试');
  }

  let layeredSvg = buildLayeredSVG(layerRecords, usedWidth, usedHeight);
  let flatSvg = flattenSVG(layeredSvg);

  const pf = resolved.pathPrecision / 100;
  const nf = resolved.noiseReduction / 100;
  // 轻量后处理：保留形状，只清极小碎片
  const simplifyTolerance = Math.max(0.12, 0.55 - pf * 0.4);
  const minPathLength = Math.max(8, Math.round(resolved.minArea * 0.6));
  const detailFactor = resolved.mode === 'high_precision' ? 0.35 : 0.7;
  const minSubpathArea =
    resolved.mode === 'line_art'
      ? 0
      : Math.max(
          4,
          resolved.minArea * 0.8,
          totalPx * 0.000012 * (0.4 + nf) * detailFactor
        );

  layeredSvg = optimizeSVGOutput(layeredSvg, {
    simplifyTolerance,
    minPathLength,
    minSubpathArea,
    minify: false,
  }).replace(/(\d+\.\d{3})\d+/g, '$1');

  flatSvg = optimizeSVGOutput(flatSvg, {
    simplifyTolerance,
    minPathLength,
    minSubpathArea,
    minify: true,
  }).replace(/(\d+\.\d{3})\d+/g, '$1');

  syncLayerPaths(layerRecords, layeredSvg);

  const pathCount = (flatSvg.match(/<path[^>]*\/>/g) || []).length;
  const colorCount = new Set(
    (flatSvg.match(/fill="(#[0-9a-fA-F]{3,8}|rgb\([^)]+\))"/gi) || []).map(x => x.toLowerCase())
  ).size;

  return {
    layeredSvg,
    flatSvg,
    pathCount,
    layers,
    qualityReport: buildReport({
      pathCount,
      colorCount,
      flatSvg,
      w: usedWidth,
      h: usedHeight,
      sourceW: img.naturalWidth || img.width,
      sourceH: img.naturalHeight || img.height,
      mode: resolved.mode,
    }),
  };
}

function syncLayerPaths(records: LayerRecord[], layeredSvg: string) {
  for (const rec of records) {
    const re = new RegExp(`<g[^>]*id="${rec.id}"[^>]*>([\\s\\S]*?)</g>`, 'i');
    const m = layeredSvg.match(re);
    if (!m) continue;
    const paths: string[] = [];
    for (const pm of m[1].matchAll(/<path[^>]*\/>/g)) paths.push(pm[0]);
    if (paths.length > 0) rec.paths = paths;
  }
}

function extractPaths(svgSnippet: string, fill: string): string[] {
  const ps: string[] = [];
  for (const m of svgSnippet.matchAll(/<path[^>]*\/>/g)) {
    let tag = m[0];
    if (!tag.includes('fill=')) tag = tag.replace(/<path/, `<path fill="${fill}"`);
    if (!tag.includes('fill-rule=')) tag = tag.replace(/<path/, '<path fill-rule="evenodd"');
    tag = tag.replace(/fill="rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)"/i, (_, r, g, b) => {
      const h = (n: string) => Number(n).toString(16).padStart(2, '0');
      return `fill="#${h(r)}${h(g)}${h(b)}"`;
    });
    ps.push(tag);
  }
  return ps;
}

function buildReport(args: {
  pathCount: number;
  colorCount: number;
  flatSvg: string;
  w: number;
  h: number;
  sourceW: number;
  sourceH: number;
  mode: VectorMode;
}): QualityReport {
  const { pathCount, colorCount, flatSvg, sourceW, sourceH, mode } = args;
  const warns: QualityReport['warnings'] = [];
  const recs: string[] = [];

  if (sourceW < 400 || sourceH < 400) {
    warns.push({
      type: 'low_resolution',
      message: `源图较小 (${sourceW}×${sourceH})`,
      severity: 'warning',
    });
    recs.push('建议使用 ≥500px 清晰原图');
  }
  if (pathCount > 500) {
    warns.push({
      type: 'too_many_paths',
      message: `路径较多 (${pathCount} 条)`,
      severity: 'warning',
    });
    recs.push('增大去噪或减少颜色数量');
  }
  if (mode === 'logo_color' && colorCount > 12) {
    warns.push({
      type: 'too_many_colors',
      message: `颜色偏多 (${colorCount})`,
      severity: 'info',
    });
    recs.push('Logo 建议控制在 8 色以内');
  }
  if (flatSvg.length > 900_000) {
    warns.push({
      type: 'large_file',
      message: `SVG 体积偏大 (~${Math.round(flatSvg.length / 1024)}KB)`,
      severity: 'warning',
    });
  }

  return {
    isPrintReady: warns.filter(w => w.severity === 'warning').length === 0,
    warnings: warns,
    pathCount,
    colorCount,
    estimatedFileSize: flatSvg.length,
    recommendations: recs,
  };
}
