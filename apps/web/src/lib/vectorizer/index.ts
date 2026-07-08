/**
 * 矢量化引擎 — 分层 SVG 输出
 *
 * 管线：
 *   采样量化 → 全像素重算真实色 → 掩码+去噪 → 连通去碎片 → 同色合并
 *   → 逐层 Potrace → SVG <g> 组装（每色一个图层组）
 */

import { VectorSettings, QualityReport, LayerInfo } from '@/types';
import { getImageData, dilateMask } from '@/lib/utils/image';
import { traceImageData } from './browser-potrace';
import { quantizeColors, buildColorLayers, splitAndMergeByColor } from './color-quantize';
import { buildLayeredSVG, flattenSVG, LayerRecord } from './svg-assembler';

export interface VectorizeResult {
  layeredSvg: string;
  flatSvg: string;
  pathCount: number;
  layers: LayerInfo[];
  qualityReport: QualityReport;
}

function makeOpts(s: VectorSettings) {
  const sf = s.smoothness / 100;
  const cf = s.cornerPreservation / 100;
  const pf = s.pathPrecision / 100;
  const nf = s.noiseReduction / 100;
  return {
    turdSize: Math.round(nf * 10),
    alphaMax: Math.max(0.15, Math.min(1.0, 0.68 + sf * 0.8 - cf * 0.5)),
    optCurve: true,
    optTolerance: Math.max(0.04, 0.5 - pf * 0.4),
  };
}

const yieldToBrowser = () => new Promise(r => setTimeout(r, 0));

export async function vectorize(
  img: HTMLImageElement,
  settings: VectorSettings
): Promise<VectorizeResult> {
  const { imageData, usedWidth, usedHeight } = getImageData(img);
  const opts = makeOpts(settings);
  const totalPx = usedWidth * usedHeight;

  let layerRecords: LayerRecord[] = [];
  let layers: LayerInfo[] = [];

  if (settings.mode === 'line_art') {
    const gray = new ImageData(usedWidth, usedHeight);
    for (let i = 0; i < imageData.data.length; i += 4) {
      const v = 0.299 * imageData.data[i] + 0.587 * imageData.data[i + 1] + 0.114 * imageData.data[i + 2];
      gray.data[i] = gray.data[i + 1] = gray.data[i + 2] = v;
      gray.data[i + 3] = 255;
    }
    const result = await traceImageData(gray, {
      ...opts, turdSize: opts.turdSize + 1,
      blackOnWhite: true, color: '#000', background: 'transparent',
    });
    const paths: string[] = [];
    for (const m of result.matchAll(/<path[^>]*\/>/g)) paths.push(m[0]);
    layerRecords = [{ id: 'layer_001', name: 'line_art', fill: '#000', visible: true, paths, pixelCount: totalPx, type: 'subject' }];
    layers = [{ id: 'layer_001', name: 'line_art', fill: '#000', visible: true, type: 'subject' }];
  } else {
    const n = Math.max(2, Math.min(settings.colorCount, 16));
    const samplePalette = quantizeColors(imageData, n);
    const colorLayers = buildColorLayers(imageData, samplePalette);

    const minPx = Math.max(20, settings.minArea * 5, totalPx * 0.0001);
    const comps = splitAndMergeByColor(colorLayers, usedWidth, usedHeight, Math.round(minPx));

    const records: LayerRecord[] = [];
    for (let idx = 0; idx < comps.length; idx++) {
      const comp = comps[idx];
      let mask = maskToImageData(comp.mask, usedWidth, usedHeight);
      mask = dilateMask(mask);

      try {
        const s = await traceImageData(mask, {
          ...opts,
          turdSize: Math.max(0, opts.turdSize - 1),
          blackOnWhite: true, color: comp.fill, background: 'transparent',
        });
        const paths = extractPaths(s, comp.fill);
        if (paths.length === 0) continue;

        records.push({
          id: `layer_${String(records.length + 1).padStart(3, '0')}`,
          name: comp.name, fill: comp.fill,
          visible: true, paths, pixelCount: comp.pixelCount,
          type: comp.pixelCount > totalPx * 0.4 ? 'background' : 'subject',
        });

        if (idx % 4 === 3) await yieldToBrowser();
      } catch { /* skip */ }
    }
    layerRecords = records;
    layers = records.map(r => ({ id: r.id, name: r.name, fill: r.fill, visible: r.visible, type: r.type }));
  }

  const layeredSvg = buildLayeredSVG(layerRecords, usedWidth, usedHeight);
  const flatSvg = flattenSVG(layeredSvg).replace(/(\d+\.\d{3})\d+/g, '$1');

  return {
    layeredSvg, flatSvg,
    pathCount: (flatSvg.match(/<path[^>]*\/>/g) || []).length,
    layers,
    qualityReport: report(layers.length, flatSvg, usedWidth, usedHeight),
  };
}

function extractPaths(svgSnippet: string, fill: string): string[] {
  const ps: string[] = [];
  for (const m of svgSnippet.matchAll(/<path[^>]*\/>/g)) {
    const tag = m[0];
    ps.push(tag.includes('fill=') ? tag : tag.replace(/<path/, `<path fill="${fill}"`));
  }
  return ps;
}

function maskToImageData(mask: Uint8Array, w: number, h: number): ImageData {
  const d = new ImageData(w, h);
  for (let i = 0; i < mask.length; i++) {
    const oi = i << 2;
    const v = mask[i] === 1 ? 0 : 255;
    d.data[oi] = d.data[oi + 1] = d.data[oi + 2] = v;
    d.data[oi + 3] = 255;
  }
  return d;
}

function report(layerCount: number, flatSvg: string, w: number, h: number): QualityReport {
  const pc = (flatSvg.match(/<path[^>]*\/>/g) || []).length;
  const warns: QualityReport['warnings'] = [];
  const recs: string[] = [];
  if (w < 400 || h < 400) {
    warns.push({ type: 'low_resolution', message: `原图较小 (${w}×${h})`, severity: 'warning' });
    recs.push('≥500px 原图效果更好');
  }
  if (pc > 500) {
    warns.push({ type: 'too_many_paths', message: `路径较多 (${pc} 条)`, severity: 'warning' });
    recs.push('增大去噪或减少颜色数量');
  }
  return {
    isPrintReady: warns.filter(w => w.severity === 'warning').length === 0,
    warnings: warns, pathCount: pc,
    colorCount: new Set(flatSvg.match(/fill="([^"]*)"/g) || []).size,
    estimatedFileSize: flatSvg.length * 2, recommendations: recs,
  };
}
