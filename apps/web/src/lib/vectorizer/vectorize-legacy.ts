/**
 * 彩色矢量化（背景掩码 + Oklab k-means + 堆叠式逐层 Potrace）
 *
 * 堆叠式掩码（stacked masks）：第 i 层描摹的是「自己 + 所有画在它上面的层」
 * 的像素并集。SVG 按面积从大到小的顺序绘制，上层天然盖住下层多出的部分，
 * 相邻色块之间不可能出现白缝 —— 这替代了旧版的 dilate/吸边补丁。
 */

import { VectorSettings } from '@/types';
import { traceImageData } from './browser-potrace';
import {
  quantizeColors,
  buildColorLayers,
  splitAndMergeByColor,
  computeBackgroundMask,
} from './color-quantize';
import { LayerRecord } from './svg-assembler';
import { makeOpts, computeMinPx } from './index-shared';
import { upscaleBinaryMask, scaleSvgPathCoords } from '@/lib/utils/image';

/** 超采样上限：放大后总像素不超过此值（控制 Potrace 耗时） */
const SUPERSAMPLE_MAX_PX = 5_500_000;

const yieldToBrowser = () => new Promise(r => setTimeout(r, 0));

function extractPaths(svgSnippet: string, fill: string): string[] {
  const ps: string[] = [];
  for (const m of svgSnippet.matchAll(/<path[^>]*\/>/g)) {
    let tag = m[0];
    if (!tag.includes('fill=')) tag = tag.replace(/<path/, `<path fill="${fill}"`);
    if (!tag.includes('fill-rule=')) tag = tag.replace(/<path/, '<path fill-rule="evenodd"');
    tag = tag.replace(/fill="rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)"/gi, (_, r, g, b) => {
      const h = (n: string) => Number(n).toString(16).padStart(2, '0');
      return `fill="#${h(r)}${h(g)}${h(b)}"`;
    });
    ps.push(tag);
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

/**
 * 掩码平滑：清除颜色分配在抗锯齿过渡带产生的锯齿/孤点，填补边缘小缺口。
 * 保守阈值（保留 ≥3 邻居，填补 ≥6 邻居）不会吃掉 2px 以上的细线。
 */
function smoothMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    const rowUp = (y - 1) * width, row = y * width, rowDn = (y + 1) * width;
    for (let x = 0; x < width; x++) {
      let nbs = 0;
      const x0 = x > 0 ? x - 1 : x, x1 = x < width - 1 ? x + 1 : x;
      if (y > 0) {
        for (let nx = x0; nx <= x1; nx++) if (mask[rowUp + nx] === 1) nbs++;
      }
      for (let nx = x0; nx <= x1; nx++) if (nx !== x && mask[row + nx] === 1) nbs++;
      if (y < height - 1) {
        for (let nx = x0; nx <= x1; nx++) if (mask[rowDn + nx] === 1) nbs++;
      }
      const i = row + x;
      out[i] = mask[i] === 1 ? (nbs >= 3 ? 1 : 0) : (nbs >= 6 ? 1 : 0);
    }
  }
  return out;
}

/** 图片是否有实际使用的透明区域（≥2% 像素） */
function hasMeaningfulAlpha(imageData: ImageData): boolean {
  const { data } = imageData;
  const totalPx = data.length / 4;
  let transparent = 0;
  const threshold = totalPx * 0.02;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 10 && ++transparent >= threshold) return true;
  }
  return false;
}

export async function vectorizeColorLegacy(
  imageData: ImageData,
  resolved: VectorSettings & { maxColors: number },
  usedWidth: number,
  usedHeight: number,
): Promise<LayerRecord[]> {
  const opts = makeOpts(resolved);
  const totalPx = usedWidth * usedHeight;
  const n = Math.max(1, resolved.maxColors);

  // 背景 = 从边界 flood 出的连通区域；主体内部的白色/浅色是内容，保留
  const bgMask = computeBackgroundMask(imageData);
  const keepWhite = bgMask !== null || hasMeaningfulAlpha(imageData);

  const samplePalette = quantizeColors(imageData, n, bgMask ?? undefined);
  const mergeThreshold =
    resolved.mode === 'high_precision' ? 20 :
    resolved.mode === 'illustration_color' ? 28 : 32;
  let colorLayers = buildColorLayers(
    imageData, samplePalette, resolved.noiseReduction, mergeThreshold, bgMask
  );

  if (n <= 1 && colorLayers.length > 1) {
    colorLayers = [colorLayers.reduce((a, b) => (a.pixelCount >= b.pixelCount ? a : b))];
  }

  const minPx = computeMinPx(resolved, totalPx);
  let comps = splitAndMergeByColor(colorLayers, usedWidth, usedHeight, minPx, keepWhite);

  if (n <= 1 && comps.length > 1) {
    comps = [comps.reduce((a, b) => (a.pixelCount >= b.pixelCount ? a : b))];
  }

  // 堆叠式掩码：从最上层（最小）往下累积并集
  const traceMasks: Uint8Array[] = new Array(comps.length);
  let acc: Uint8Array | null = null;
  for (let i = comps.length - 1; i >= 0; i--) {
    const united = new Uint8Array(comps[i].mask);
    if (acc) {
      for (let p = 0; p < united.length; p++) if (acc[p] === 1) united[p] = 1;
    }
    traceMasks[i] = united;
    acc = united;
  }

  // 小图 2× 超采样描摹：Potrace 在更细的网格上拟合，边缘曲线更顺滑
  const scale = totalPx * 4 <= SUPERSAMPLE_MAX_PX ? 2 : 1;

  const records: LayerRecord[] = [];
  for (let idx = 0; idx < comps.length; idx++) {
    const comp = comps[idx];
    let smoothed = smoothMask(traceMasks[idx], usedWidth, usedHeight);
    let tw = usedWidth, th = usedHeight;
    if (scale > 1) {
      const up = upscaleBinaryMask(smoothed, usedWidth, usedHeight, scale);
      // 放大后再平滑一次，把方块阶梯磨圆
      smoothed = smoothMask(up.mask, up.width, up.height);
      tw = up.width; th = up.height;
    }
    const mask = maskToImageData(smoothed, tw, th);

    try {
      let s = await traceImageData(mask, {
        ...opts,
        // turdSize 是面积单位，超采样后按 scale² 换算
        turdSize: Math.max(0, opts.turdSize - 1) * scale * scale,
        blackOnWhite: true,
        color: comp.fill,
        background: 'transparent',
      });
      if (scale > 1) s = scaleSvgPathCoords(s, scale);
      const paths = extractPaths(s, comp.fill);
      if (paths.length === 0) continue;

      records.push({
        id: `layer_${String(records.length + 1).padStart(3, '0')}`,
        name: comp.name,
        fill: comp.fill,
        visible: true,
        paths,
        pixelCount: comp.pixelCount,
        type: comp.pixelCount > totalPx * 0.4 ? 'background' : 'subject',
      });
      if (idx % 4 === 3) await yieldToBrowser();
    } catch { /* skip */ }
  }

  return records;
}
