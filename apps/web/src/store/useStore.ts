'use client';

import { create } from 'zustand';
import { AppState, DEFAULT_SETTINGS, DEFAULT_EXPORT, VectorSettings, VectorMode, LayerInfo } from '@/types';
import { loadImageFromFile, loadImageFromDataUrl, fileToDataUrl, getImageData, estimateColorCount, isHighContrastImage, hasTransparency } from '@/lib/utils/image';
import { vectorize } from '@/lib/vectorizer';

/** 各模式推荐默认（切换模式时合并）— 保守，避免吃细节 */
const MODE_DEFAULTS: Record<VectorMode, Partial<VectorSettings>> = {
  line_art: {
    colorCount: 1,
    noiseReduction: 20,
    pathPrecision: 55,
    smoothness: 50,
    cornerPreservation: 65,
    minArea: 12,
  },
  logo_color: {
    colorCount: 6,
    noiseReduction: 18,
    pathPrecision: 55,
    smoothness: 55,
    cornerPreservation: 50,
    minArea: 12,
  },
  illustration_color: {
    colorCount: 12,
    noiseReduction: 15,
    pathPrecision: 60,
    smoothness: 55,
    cornerPreservation: 45,
    minArea: 8,
  },
  high_precision: {
    colorCount: 16,
    noiseReduction: 12,
    pathPrecision: 70,
    smoothness: 60,
    cornerPreservation: 40,
    minArea: 6,
  },
};

let cachedImg: HTMLImageElement | null = null;
let cachedFile: File | null = null;
let cachedPaths: Record<string, string[]> = {}; // layerId → paths

let _taskSeq = 0;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
const TIMEOUT_MS = 45000;

async function ensureCachedImage(): Promise<HTMLImageElement> {
  const s = useStore.getState();
  if (cachedImg && (s.sourceFile ? cachedFile === s.sourceFile : true)) {
    return cachedImg;
  }
  if (s.sourceFile) {
    cachedImg = await loadImageFromFile(s.sourceFile);
    cachedFile = s.sourceFile;
    return cachedImg;
  }
  if (s.sourceDataUrl) {
    cachedImg = await loadImageFromDataUrl(s.sourceDataUrl);
    cachedFile = null;
    return cachedImg;
  }
  throw new Error('未找到可转换的图片');
}

async function doVectorize(seq: number, settings: VectorSettings) {
  const s = useStore.getState();
  if (!s.sourceDataUrl) return;

  useStore.setState({ jobStatus: 'processing', errorMessage: null });

  try {
    const img = await ensureCachedImage();
    const result = await Promise.race([
      vectorize(img, settings),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('矢量化超时，请减小图片尺寸或降低颜色数量')), TIMEOUT_MS)
      ),
    ]);

    if (seq !== _taskSeq) return;

    const oldUrl = useStore.getState().svgPreviewUrl;
    if (oldUrl) URL.revokeObjectURL(oldUrl);

    const blob = new Blob([result.layeredSvg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);

    // Cache paths per layer for toggleLayer rebuilds
    const parser = /<g id="([^"]+)"[^>]*>([\s\S]*?)<\/g>/g;
    let m;
    while ((m = parser.exec(result.layeredSvg)) !== null) {
      const inner = m[2];
      const paths: string[] = [];
      const pre = /<path[^>]*\/>/g;
      let p;
      while ((p = pre.exec(inner)) !== null) paths.push(p[0]);
      cachedPaths[m[1]] = paths;
    }

  useStore.setState({
      svgResult: result.flatSvg,
      layeredSvg: result.layeredSvg,
      flatSvg: result.flatSvg,
      svgPreviewUrl: url,
      qualityReport: result.qualityReport,
      layers: result.layers,
      exportLayered: true,
      jobStatus: result.pathCount > 0 ? 'completed' : 'failed',
      errorMessage: result.pathCount > 0 ? null : '未生成矢量路径',
    });
  } catch (err) {
    if (seq !== _taskSeq) return;
    useStore.setState({
      jobStatus: 'failed',
      errorMessage: err instanceof Error ? err.message : '转换失败，请重试',
    });
  }
}

function schedule() {
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => {
    _taskSeq++;
    doVectorize(_taskSeq, useStore.getState().settings);
  }, 100);
}

const SK = 'vf_dataurl';
const IK = 'vf_info';
const SK_SETTINGS = 'vf_settings';

export const useStore = create<AppState>((set, get) => ({
  sourceFile: null, sourceDataUrl: null, imageInfo: null,
  jobStatus: 'idle', svgResult: null, svgPreviewUrl: null,
  errorMessage: null, settings: { ...DEFAULT_SETTINGS },
  qualityReport: null,
  layers: [],
  layeredSvg: null,
  flatSvg: null,
  exportSettings: { ...DEFAULT_EXPORT },
  showExportDialog: false,
  exportLayered: true,

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

    const modeDefaults = MODE_DEFAULTS[mode];
    const colorCount = mode === 'line_art'
      ? 1
      : Math.min(Math.max(1, cc), mode === 'logo_color' ? 8 : 16);

    const info = {
      name: file.name, width: img.naturalWidth, height: img.naturalHeight,
      format: (file.name.split('.').pop() || '').toLowerCase(), fileSize: file.size,
      hasAlpha: alpha, colorCount: cc, isHighContrast: hc,
    };
    const settings = { ...DEFAULT_SETTINGS, ...modeDefaults, mode, colorCount };
    try {
      sessionStorage.setItem(SK, dataUrl);
      sessionStorage.setItem(IK, JSON.stringify(info));
      sessionStorage.setItem(SK_SETTINGS, JSON.stringify(settings));
    } catch {}

    set({
      sourceFile: file, sourceDataUrl: dataUrl, imageInfo: info,
      settings,
      exportSettings: { ...DEFAULT_EXPORT, width: img.naturalWidth, height: img.naturalHeight },
      svgResult: null, svgPreviewUrl: null, qualityReport: null,
      layers: [], layeredSvg: null, flatSvg: null,
      jobStatus: 'idle',
    });
  },

  restoreFromCache: (dataUrl: string) => {
    let info: any = null;
    let settings: VectorSettings = { ...DEFAULT_SETTINGS };
    try {
      const raw = sessionStorage.getItem(IK);
      if (raw) info = JSON.parse(raw);
      const rawSettings = sessionStorage.getItem(SK_SETTINGS);
      if (rawSettings) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(rawSettings) };
    } catch {}
    cachedImg = null;
    cachedFile = null;
    set({
      sourceFile: null, sourceDataUrl: dataUrl, imageInfo: info,
      settings,
      exportSettings: { ...DEFAULT_EXPORT, ...(info ? { width: info.width, height: info.height } : {}) },
      svgResult: null, svgPreviewUrl: null, qualityReport: null,
      layers: [], layeredSvg: null, flatSvg: null,
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
    set(s => {
      const next = { ...s.settings, ...partial };
      // 切换模式时套用该模式推荐参数（保留用户刚改的 mode）
      if (partial.mode && partial.mode !== s.settings.mode) {
        Object.assign(next, MODE_DEFAULTS[partial.mode], { mode: partial.mode });
      }
      return { settings: next };
    });
    schedule();
  },

  setExportSettings: (partial) => set(s => ({ exportSettings: { ...s.exportSettings, ...partial } })),
  setShowExportDialog: (show) => set({ showExportDialog: show }),
  setExportLayered: (v) => set({ exportLayered: v }),

  toggleLayer: (id: string) => {
    set(s => {
      const layers = s.layers.map(l =>
        l.id === id ? { ...l, visible: !l.visible } : l
      );
      const vb = s.layeredSvg?.match(/viewBox="0 0 (\d+) (\d+)"/) || ['', '100', '100'];
      const w = parseInt(vb[1]), h = parseInt(vb[2]);

      // Rebuild SVG: visible layers get their paths, hidden ones are skipped
      const groups = layers
        .filter(l => l.visible)
        .map(l => {
          const paths = (cachedPaths[l.id] || []).join('\n    ');
          return `  <g id="${l.id}" data-name="${l.name}" data-type="${l.type}">\n    ${paths}\n  </g>`;
        })
        .join('\n');
      const layeredSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n${groups}\n</svg>`;

      const oldUrl = s.svgPreviewUrl;
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      const blob = new Blob([layeredSvg], { type: 'image/svg+xml' });
      return { layers, layeredSvg, svgPreviewUrl: URL.createObjectURL(blob) };
    });
  },

  reset: () => {
    _taskSeq++;
    if (_debounceTimer) clearTimeout(_debounceTimer);
    const oldUrl = get().svgPreviewUrl;
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    cachedImg = null; cachedFile = null; cachedPaths = {};
    try { sessionStorage.removeItem(SK); sessionStorage.removeItem(IK); sessionStorage.removeItem(SK_SETTINGS); } catch {}
    set({
      sourceFile: null, sourceDataUrl: null, imageInfo: null,
      jobStatus: 'idle', svgResult: null, svgPreviewUrl: null,
      errorMessage: null, settings: { ...DEFAULT_SETTINGS },
      qualityReport: null, layers: [], layeredSvg: null, flatSvg: null,
      exportSettings: { ...DEFAULT_EXPORT },
      showExportDialog: false, exportLayered: true,
    });
  },
}));
