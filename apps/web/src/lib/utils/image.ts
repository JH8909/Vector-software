/**
 * 图片工具 — 加载 + 缩放 + 掩码预处理
 */

export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片加载失败')); };
    img.src = url;
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

// ── ImageData 提取 ─────────────────────────────────────

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
  ctx.imageSmoothingEnabled = true;
  (ctx as any).imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return { imageData: ctx.getImageData(0, 0, w, h), usedWidth: w, usedHeight: h, canvas };
}

// ── 掩码反锯齿（核心：亚像素边缘） ───────────────────
//
// 二值掩码只有 0/255，Potrace 沿像素对角线追踪 → 锯齿
// 解法：3×3 box blur 在硬边处生成灰度过渡带(128±64)，
// Potrace 的自动阈值(≈128)在这些灰度上拟合光滑贝塞尔曲线

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
            // 只取 R 通道（三通道相同）
            sum += src[(ny * width + nx) << 2];
            cnt++;
          }
        }
        const v = Math.round(sum / cnt);
        dst[i] = dst[i + 1] = dst[i + 2] = v;
        dst[i + 3] = 255;
      }
    }
    // swap buffers
    const tmp = src;
    src = dst;
    // create new array for next pass destination
    dst = new Uint8ClampedArray(p === passes - 1 ? 0 : data.length);
  }

  const out = new ImageData(width, height);
  out.data.set(src);
  return out;
}

// ── 掩码膨胀（关层间缝隙） ────────────────────────────

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
              dx = dy = 2; // break
            }
          }
        }
      }
    }
  }
  return out;
}

// ── 工具 ──────────────────────────────────────────────

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function estimateColorCount(imageData: ImageData, tolerance = 12): number {
  const { data } = imageData;
  const colors = new Set<string>();
  const step = Math.max(1, Math.floor(Math.sqrt(data.length / 4 / 15000)));
  for (let i = 0; i < data.length; i += step * 4) {
    if (data[i + 3] < 10) continue;
    colors.add(
      `${Math.round(data[i] / tolerance) * tolerance},` +
      `${Math.round(data[i + 1] / tolerance) * tolerance},` +
      `${Math.round(data[i + 2] / tolerance) * tolerance}`
    );
  }
  return colors.size;
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
