'use client';

import { create } from 'zustand';
import { AppState, DEFAULT_SETTINGS, DEFAULT_EXPORT, VectorSettings, LayerInfo } from '@/types';
import { loadImageFromFile, fileToDataUrl, getImageData, estimateColorCount, isHighContrastImage, hasTransparency } from '@/lib/utils/image';
import { vectorize } from '@/lib/vectorizer';

let cachedImg: HTMLImageElement | null = null;
let cachedFile: File | null = null;
let cachedPaths: Record<string, string[]> = {}; // layerId → paths

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
      layers: [], layeredSvg: null, flatSvg: null,
      jobStatus: 'idle',
    });
  },

  restoreFromCache: (dataUrl: string) => {
    let info: any = null;
    try { const raw = sessionStorage.getItem(IK); if (raw) info = JSON.parse(raw); } catch {}
    set({
      sourceFile: null, sourceDataUrl: dataUrl, imageInfo: info,
      settings: { ...DEFAULT_SETTINGS },
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
    set(s => ({ settings: { ...s.settings, ...partial } }));
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
    try { sessionStorage.removeItem(SK); sessionStorage.removeItem(IK); } catch {}
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
