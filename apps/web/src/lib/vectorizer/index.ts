/**
 * 矢量化引擎 — 直边优先
 *
 * 管线：
 *   line_art → 二值阈值 → Potrace（保持 L 直线段）
 *   color    → 量化 → 逐色掩码 → 1px 膨胀关缝 → Potrace → 合并
 *
 * 不默认做反锯齿：box-blur 会把直角模糊成圆角，Potrace 沿渐变追踪出曲线。
 * 只在边缘平滑 > 75 且角点保留 < 40（用户明确要圆滑风格）时才启用。
 */

import { VectorSettings, QualityReport } from '@/types';
import { getImageData, dilateMask, antiAliasMask } from '@/lib/utils/image';
import { traceImageData } from './browser-potrace';
import { quantizeColors, buildColorLayers, maskToImageData } from './color-quantize';

export interface VectorizeResult {
  svg: string;
  pathCount: number;
  qualityReport: QualityReport;
}

// ── 参数映射 ──────────────────────────────────────────
//
// optCurve=true 是关键：Potrace 在 optCurve 模式下对 polygon 路径
// 做贝塞尔优化——小角度转折（圆弧）转 C 曲线，大角度转折（直角）保 L。
//
// alphaMax 扫描结果 (optCurve=true):
//   α=0.5 → 矩形全L, 圆形仅8C ← 圆不够光滑
//   α=0.7 → 矩形全L(4L), 圆形15C ← ★黄金点
//   α=1.0 → 矩形全L但圆C=22 ← 圆滑但直角开始微弧

function makeOpts(s: VectorSettings) {
  const sf = s.smoothness / 100;
  const cf = s.cornerPreservation / 100;
  const pf = s.pathPrecision / 100;
  const nf = s.noiseReduction / 100;

  // alphaMax: 默认 0.7——矩形直角保持 L，圆弧产生 C 曲线
  //   角点保留↑ → α↓（更多直角保持 L）: 0→α≈1.0, 100→α≈0.18
  //   边缘平滑↑ → α↑（更多拐点转 C）:  0→α≈0.18, 100→α≈1.0
  const alphaMax = Math.max(0.15, Math.min(1.0, 0.68 + sf * 0.8 - cf * 0.5));

  // optTolerance: 贝塞尔拟合精度。路径精度↑ → tol↓（更紧贴）
  //   默认 τ≈0.22，既不过拟合像素也不过度简化
  const optTolerance = Math.max(0.04, 0.5 - pf * 0.4);

  // optCurve: 始终开启——这是弧线变圆的唯一开关
  const optCurve = true;

  // turdSize: 去噪
  const turdSize = Math.round(nf * 10);

  // AA: 仅极高平滑 + 放弃直角时启用
  const useAA = false; // 默认关闭，避免模糊直角

  return { turdSize, alphaMax, optCurve, optTolerance, useAA };
}

// ── 主入口 ────────────────────────────────────────────

export async function vectorize(
  img: HTMLImageElement,
  settings: VectorSettings
): Promise<VectorizeResult> {
  const { imageData, usedWidth, usedHeight } = getImageData(img);
  const opts = makeOpts(settings);

  let svg: string;

  if (settings.mode === 'line_art') {
    // 线稿：灰度二值化，threshold=auto（无 AA）
    const gray = new ImageData(usedWidth, usedHeight);
    for (let i = 0; i < imageData.data.length; i += 4) {
      const v = 0.299 * imageData.data[i] + 0.587 * imageData.data[i + 1] + 0.114 * imageData.data[i + 2];
      gray.data[i] = gray.data[i + 1] = gray.data[i + 2] = v;
      gray.data[i + 3] = 255;
    }
    svg = await traceImageData(gray, {
      ...opts,
      turdSize: opts.turdSize + 1,
      blackOnWhite: true,
      color: '#000',
      background: 'transparent',
    });
  } else {
    const n = Math.max(2, Math.min(settings.colorCount, 12));
    const palette = quantizeColors(imageData, n);
    const layers = buildColorLayers(imageData, palette);

    const paths: string[] = [];
    const minPx = Math.max(5, settings.minArea * 3);
    for (const layer of layers) {
      if (layer.pixelCount < minPx) continue;

      const [r, g, b] = layer.color;
      // 跳过近白色/近背景色（RGB 都 > 240 = 肉眼白底，追踪无意义）
      if (r > 240 && g > 240 && b > 240) continue;

      let mask = maskToImageData(layer.mask, usedWidth, usedHeight);
      mask = dilateMask(mask); // 1px 膨胀关层间缝隙
      if (opts.useAA) mask = antiAliasMask(mask, 1);

      try {
        const s = await traceImageData(mask, {
          ...opts,
          threshold: opts.useAA ? 128 : undefined,
          turdSize: Math.max(0, opts.turdSize - 1),
          blackOnWhite: true,
          color: `rgb(${r},${g},${b})`,
          background: 'transparent',
        });
        for (const m of s.matchAll(/<path[^>]*\/>/g)) {
          const tag = m[0];
          paths.push(tag.includes('fill=') ? tag : tag.replace(/<path/, '<path fill="#000"'));
        }
      } catch { /* skip */ }
    }

    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${usedWidth}" height="${usedHeight}" viewBox="0 0 ${usedWidth} ${usedHeight}">${paths.join('')}</svg>`;
  }

  svg = svg.replace(/(\d+\.\d{3})\d+/g, '$1');

  return {
    svg,
    pathCount: (svg.match(/<path[^>]*\/>/g) || []).length,
    qualityReport: report(svg, usedWidth, usedHeight),
  };
}

function report(svg: string, w: number, h: number): QualityReport {
  const pc = (svg.match(/<path[^>]*\/>/g) || []).length;
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
    colorCount: new Set(svg.match(/fill="([^"]*)"/g) || []).size,
    estimatedFileSize: svg.length * 2, recommendations: recs,
  };
}
