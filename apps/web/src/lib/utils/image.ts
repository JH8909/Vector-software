/**
 * 图片工具 — 加载 + 缩放 + fringe 压平 + 掩码预处理
 */

/** Windows 上 file.type 常为空，用扩展名兜底 */
export function isValidImageFile(file: File): boolean {
  const types = ['image/png', 'image/jpeg', 'image/webp', 'image/jpg', 'image/pjpeg'];
  if (file.type && types.includes(file.type)) return true;
  return /\.(png|jpe?g|webp)$/i.test(file.name);
}

export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片加载失败')); };
    img.src = url;
  });
}

export function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = dataUrl;
  });
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('文件读取失败'));
    r.readAsDataURL(file);
  });
}

const MIN_PX = 1500;

export function getImageData(img: HTMLImageElement): {
  imageData: ImageData; usedWidth: number; usedHeight: number; canvas: HTMLCanvasElement;
} {
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (Math.max(w, h) < MIN_PX) {
    const r = MIN_PX / Math.max(w, h);
    w = Math.round(w * r);
    h = Math.round(h * r);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  // 高质量平滑放大：减轻锯齿（最近邻会把边缘放大成方块阶梯）
  ctx.imageSmoothingEnabled = true;
  (ctx as CanvasRenderingContext2D & { imageSmoothingQuality?: string }).imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return { imageData: ctx.getImageData(0, 0, w, h), usedWidth: w, usedHeight: h, canvas };
}

/**
 * 软 fringe 处理：只处理半透明像素，不吃掉不透明前景色。
 */
export function flattenFringeSoft(imageData: ImageData): ImageData {
  const { data, width, height } = imageData;
  const out = new ImageData(width, height);
  out.data.set(data);
  const bg = estimateBackground(data, width, height);

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a >= 245) continue;

    if (a < 10) {
      out.data[i] = bg[0]; out.data[i + 1] = bg[1]; out.data[i + 2] = bg[2];
      out.data[i + 3] = 0;
      continue;
    }

    const t = a / 255;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const cr = Math.round(r * t + bg[0] * (1 - t));
    const cg = Math.round(g * t + bg[1] * (1 - t));
    const cb = Math.round(b * t + bg[2] * (1 - t));
    const dBg = colorDist(cr, cg, cb, bg[0], bg[1], bg[2]);
    if (dBg < 18) {
      out.data[i] = bg[0]; out.data[i + 1] = bg[1]; out.data[i + 2] = bg[2];
      out.data[i + 3] = 0;
    } else {
      out.data[i] = cr; out.data[i + 1] = cg; out.data[i + 2] = cb;
      out.data[i + 3] = 255;
    }
  }
  return out;
}

/** 兼容旧调用：统一走软处理，避免误伤前景 */
export function flattenFringe(imageData: ImageData, _aggressive = true): ImageData {
  return flattenFringeSoft(imageData);
}

function estimateBackground(
  data: Uint8ClampedArray,
  width: number,
  height: number
): [number, number, number] {
  // 采样四边中位色
  const samples: number[][] = [[], [], []];
  const push = (i: number) => {
    if (data[i + 3] < 200) return;
    samples[0].push(data[i]);
    samples[1].push(data[i + 1]);
    samples[2].push(data[i + 2]);
  };
  for (let x = 0; x < width; x++) {
    push((0 * width + x) << 2);
    push(((height - 1) * width + x) << 2);
  }
  for (let y = 0; y < height; y++) {
    push((y * width + 0) << 2);
    push((y * width + (width - 1)) << 2);
  }
  if (samples[0].length === 0) return [255, 255, 255];
  const med = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  return [med(samples[0]), med(samples[1]), med(samples[2])];
}

function colorDist(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** 二值掩码最近邻放大（超采样追踪用） */
export function upscaleBinaryMask(
  mask: Uint8Array,
  width: number,
  height: number,
  scale: number
): { mask: Uint8Array; width: number; height: number } {
  if (scale <= 1) return { mask, width, height };
  const nw = width * scale;
  const nh = height * scale;
  const out = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < nw; x++) {
      const sx = Math.floor(x / scale);
      out[y * nw + x] = mask[sy * width + sx];
    }
  }
  return { mask: out, width: nw, height: nh };
}

/** 对 Uint8 二值掩码做 1px 膨胀（trap / 关缝） */
export function dilateBinaryMask(
  mask: Uint8Array,
  width: number,
  height: number,
  iterations = 1
): Uint8Array {
  let src = mask;
  for (let it = 0; it < iterations; it++) {
    const out = new Uint8Array(src.length);
    out.set(src);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (src[i] === 1) continue;
        let hit = false;
        for (let dy = -1; dy <= 1 && !hit; dy++) {
          for (let dx = -1; dx <= 1 && !hit; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            if (src[ny * width + nx] === 1) hit = true;
          }
        }
        if (hit) out[i] = 1;
      }
    }
    src = out;
  }
  return src;
}

/** 将 SVG path 坐标整体缩放（超采样后还原） */
export function scaleSvgPathCoords(svg: string, factor: number): string {
  if (factor === 1) return svg;
  return svg.replace(/d="([^"]*)"/g, (_, d: string) => {
    const scaled = d.replace(/-?\d*\.?\d+/g, (num: string) => {
      const v = parseFloat(num);
      if (Number.isNaN(v)) return num;
      const s = v / factor;
      return (Math.round(s * 1000) / 1000).toString();
    });
    return `d="${scaled}"`;
  });
}

export function antiAliasMask(mask: ImageData, passes: number = 1): ImageData {
  const { data, width, height } = mask;
  if (width < 2 || height < 2) return mask;

  let src = data;
  let dst = new Uint8ClampedArray(data.length);

  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) << 2;
        let sum = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = Math.min(height - 1, Math.max(0, y + dy));
          for (let dx = -1; dx <= 1; dx++) {
            const nx = Math.min(width - 1, Math.max(0, x + dx));
            sum += src[(ny * width + nx) << 2];
            cnt++;
          }
        }
        const v = Math.round(sum / cnt);
        dst[i] = dst[i + 1] = dst[i + 2] = v;
        dst[i + 3] = 255;
      }
    }
    src = dst;
    dst = new Uint8ClampedArray(p === passes - 1 ? 0 : data.length);
  }

  const out = new ImageData(width, height);
  out.data.set(src);
  return out;
}

export function dilateMask(mask: ImageData): ImageData {
  const { data, width, height } = mask;
  const out = new ImageData(width, height);
  for (let i = 0; i < data.length; i++) out.data[i] = data[i];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) << 2;
      if (out.data[i] === 0) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (data[(ny * width + nx) << 2] === 0) {
              out.data[i] = out.data[i + 1] = out.data[i + 2] = 0;
              out.data[i + 3] = 255;
              dx = dy = 2;
            }
          }
        }
      }
    }
  }
  return out;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function estimateColorCount(imageData: ImageData, tolerance = 18): number {
  const { data } = imageData;
  const buckets = new Map<string, number>();
  const step = Math.max(1, Math.floor(Math.sqrt(data.length / 4 / 20000)));
  let total = 0;
  for (let i = 0; i < data.length; i += step * 4) {
    if (data[i + 3] < 10) continue;
    const key =
      `${Math.round(data[i] / tolerance) * tolerance},` +
      `${Math.round(data[i + 1] / tolerance) * tolerance},` +
      `${Math.round(data[i + 2] / tolerance) * tolerance}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
    total++;
  }
  // 丢掉占比极低的 JPEG 噪点色
  const minN = Math.max(2, total * 0.002);
  let count = 0;
  for (const n of buckets.values()) if (n >= minN) count++;
  return Math.max(1, count);
}

export function isHighContrastImage(imageData: ImageData): boolean {
  const { data } = imageData;
  let hc = 0, total = 0;
  const step = Math.max(1, Math.floor(Math.sqrt(data.length / 4 / 5000)));
  for (let i = 0; i < data.length; i += step * 4) {
    if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 30 || data[i] > 225) hc++;
    total++;
  }
  return total > 0 && hc / total > 0.7;
}

export function hasTransparency(imageData: ImageData): boolean {
  for (let i = 3; i < imageData.data.length; i += 4) if (imageData.data[i] < 255 && imageData.data[i] > 0) return true;
  return false;
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
