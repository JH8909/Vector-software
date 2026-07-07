/**
 * Potrace 浏览器封装 — Jimp 兼容层
 *
 * 只做单层二值追踪。Posterizer 在浏览器端 Otsu 多层阈值计算极慢，
 * 走 JS 层 median-cut 量化 + 逐层单次 Potrace 的路线（每层 O(n)，快）。
 */

import { Potrace } from 'potrace';

type ScanFn = (x: number, y: number, idx: number) => void;

interface JimpLike {
  bitmap: { width: number; height: number; data: Uint8Array };
  scan(x0: number, y0: number, w: number, h: number, f: ScanFn): void;
}

function imageDataToJimp(d: ImageData): JimpLike {
  const data = new Uint8Array(d.data.buffer, d.data.byteOffset, d.data.length);
  return {
    bitmap: { width: d.width, height: d.height, data },
    scan(x0, y0, w, h, f) {
      for (let y = y0; y < y0 + h; y++)
        for (let x = x0; x < x0 + w; x++)
          f(x, y, (y * d.width + x) * 4);
    },
  };
}

export interface TraceOptions {
  turdSize?: number;
  alphaMax?: number;
  optCurve?: boolean;
  optTolerance?: number;
  threshold?: number;
  blackOnWhite?: boolean;
  color?: string;
  background?: string;
}

export function traceImageData(imageData: ImageData, opts: TraceOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const p = new Potrace({
        turdSize: opts.turdSize ?? 2,
        alphaMax: opts.alphaMax ?? 1,
        optCurve: opts.optCurve ?? true,
        optTolerance: opts.optTolerance ?? 0.2,
        threshold: opts.threshold ?? Potrace.THRESHOLD_AUTO,
        blackOnWhite: opts.blackOnWhite ?? true,
        color: opts.color ?? Potrace.COLOR_AUTO,
        background: opts.background ?? Potrace.COLOR_TRANSPARENT,
      });
      (p as any)._processLoadedImage(imageDataToJimp(imageData));
      resolve(p.getSVG());
    } catch (e) {
      reject(e);
    }
  });
}
