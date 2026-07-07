'use client';

import { create } from 'zustand';
import { AppState, DEFAULT_SETTINGS, DEFAULT_EXPORT, VectorSettings } from '@/types';
import { loadImageFromFile, fileToDataUrl, getImageData, estimateColorCount, isHighContrastImage, hasTransparency } from '@/lib/utils/image';
import { vectorize } from '@/lib/vectorizer';

let cachedImg: HTMLImageElement | null = null;
let cachedFile: File | null = null;

let _taskSeq = 0;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
const TIMEOUT_MS = 25000;

async function doVectorize(seq: number, settings: VectorSettings) {
  const s = useStore.getState();
  if (!s.sourceFile || !s.sourceDataUrl) return;

  useStore.setState({ jobStatus: 'processing' });

  try {
    if (cachedFile !== s.sourceFile || !cachedImg) {
      cachedImg = await loadImageFromFile(s.sourceFile);
      cachedFile = s.sourceFile;
    }

    const result = await Promise.race([
      vectorize(cachedImg, settings),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('矢量化超时，请减小图片尺寸或降低颜色数量')), TIMEOUT_MS)
      ),
    ]);

    if (seq !== _taskSeq) return;

    const oldUrl = useStore.getState().svgPreviewUrl;
    if (oldUrl) URL.revokeObjectURL(oldUrl);

    const blob = new Blob([result.svg], { type: 'image/svg+xml' });
    useStore.setState({
      svgResult: result.svg,
      svgPreviewUrl: URL.createObjectURL(blob),
      qualityReport: result.qualityReport,
      jobStatus: 'completed',
    });
  } catch (err) {
    if (seq !== _taskSeq) return;
    useStore.setState({
      jobStatus: 'failed',
      errorMessage: err instanceof Error ? err.message : '转换失败，请重试',
    });
  }
}

// 100ms 防抖 — 近实时响应拖动
function schedule() {
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => {
    _taskSeq++;
    doVectorize(_taskSeq, useStore.getState().settings);
  }, 100);
}

const SK = 'vf_dataurl';
const IK = 'vf_info';

export const useStore = create<AppState>((set, get) => ({
  sourceFile: null, sourceDataUrl: null, imageInfo: null,
  jobStatus: 'idle', svgResult: null, svgPreviewUrl: null,
  errorMessage: null, settings: { ...DEFAULT_SETTINGS },
  qualityReport: null, exportSettings: { ...DEFAULT_EXPORT },
  showExportDialog: false,

  prepareFile: async (file: File) => {
    const dataUrl = await fileToDataUrl(file);
    const img = await loadImageFromFile(file);
    cachedImg = img; cachedFile = file;

    const { imageData } = getImageData(img);
    const alpha = hasTransparency(imageData);
    const cc = estimateColorCount(imageData);
    const hc = isHighContrastImage(imageData);
    let mode = DEFAULT_SETTINGS.mode;
    if (hc && cc <= 4) mode = 'line_art';
    else if (cc <= 12) mode = 'logo_color';
    else if (cc <= 30) mode = 'illustration_color';
    else mode = 'high_precision';

    const info = {
      name: file.name, width: img.naturalWidth, height: img.naturalHeight,
      format: (file.name.split('.').pop() || '').toLowerCase(), fileSize: file.size,
      hasAlpha: alpha, colorCount: cc, isHighContrast: hc,
    };

    try { sessionStorage.setItem(SK, dataUrl); sessionStorage.setItem(IK, JSON.stringify(info)); } catch {}

    set({
      sourceFile: file, sourceDataUrl: dataUrl, imageInfo: info,
      settings: { ...DEFAULT_SETTINGS, mode, colorCount: Math.min(Math.max(2, cc), 24) },
      exportSettings: { ...DEFAULT_EXPORT, width: img.naturalWidth, height: img.naturalHeight },
      svgResult: null, svgPreviewUrl: null, qualityReport: null,
      jobStatus: 'idle',
    });
  },

  restoreFromCache: (dataUrl: string) => {
    let info: any = null;
    try { const raw = sessionStorage.getItem(IK); if (raw) info = JSON.parse(raw); } catch {}
    set({
      sourceFile: null,  // 刷新后 File 对象丢失，但 dataUrl 和 imageInfo 还在
      sourceDataUrl: dataUrl, imageInfo: info,
      settings: { ...DEFAULT_SETTINGS },
      exportSettings: { ...DEFAULT_EXPORT, ...(info ? { width: info.width, height: info.height } : {}) },
      svgResult: null, svgPreviewUrl: null, qualityReport: null,
      jobStatus: 'idle',
    });
  },

  startConversion: async () => {
    _taskSeq++;
    await doVectorize(_taskSeq, get().settings);
  },

  setSourceFile: async (file: File) => {
    await get().prepareFile(file);
    set({ jobStatus: 'processing' });
    _taskSeq++;
    await doVectorize(_taskSeq, get().settings);
  },

  setSettings: (partial) => {
    set(s => ({ settings: { ...s.settings, ...partial } }));
    schedule();
  },

  setExportSettings: (partial) => set(s => ({ exportSettings: { ...s.exportSettings, ...partial } })),
  setShowExportDialog: (show) => set({ showExportDialog: show }),

  reset: () => {
    _taskSeq++;
    if (_debounceTimer) clearTimeout(_debounceTimer);
    const oldUrl = get().svgPreviewUrl;
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    cachedImg = null; cachedFile = null;
    try { sessionStorage.removeItem(SK); sessionStorage.removeItem(IK); } catch {}
    set({
      sourceFile: null, sourceDataUrl: null, imageInfo: null,
      jobStatus: 'idle', svgResult: null, svgPreviewUrl: null,
      errorMessage: null, settings: { ...DEFAULT_SETTINGS },
      qualityReport: null, exportSettings: { ...DEFAULT_EXPORT },
      showExportDialog: false,
    });
  },
}));
