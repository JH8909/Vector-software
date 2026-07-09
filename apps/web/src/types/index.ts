// ============================================================
// 核心类型定义
// ============================================================

/** 转换模式 */
export type VectorMode = 'line_art' | 'logo_color' | 'illustration_color' | 'high_precision';

/** 转换状态 */
export type JobStatus = 'idle' | 'queued' | 'processing' | 'completed' | 'failed';

/** 导出格式 */
export type ExportFormat = 'svg' | 'pdf' | 'eps';

/** 导出单位 */
export type ExportUnit = 'mm' | 'cm' | 'inch' | 'px';

/** 背景模式 */
export type BackgroundMode = 'transparent' | 'white' | 'black';

/** 矢量转换参数 */
export interface VectorSettings {
  mode: VectorMode;
  colorCount: number;          // 颜色数量，1-64
  noiseReduction: number;      // 去噪强度 0-100
  pathPrecision: number;       // 路径精度 0-100
  smoothness: number;          // 边缘平滑 0-100
  cornerPreservation: number;  // 角点保留 0-100
  minArea: number;             // 最小碎片过滤面积
}

/** 图片信息 */
export interface ImageInfo {
  name: string;
  width: number;
  height: number;
  format: string;
  fileSize: number;
  hasAlpha: boolean;
  colorCount: number;
  isHighContrast: boolean;
}

/** 质量报告 */
export interface QualityWarning {
  type: 'low_resolution' | 'too_many_paths' | 'too_many_colors' | 'blurry_edge' | 'large_file';
  message: string;
  severity: 'info' | 'warning' | 'error';
}

export interface QualityReport {
  isPrintReady: boolean;
  warnings: QualityWarning[];
  pathCount: number;
  colorCount: number;
  estimatedFileSize: number;
  recommendations: string[];
}

/** 导出设置 */
export interface ExportSettings {
  format: ExportFormat;
  unit: ExportUnit;
  width: number;
  height: number;
  scale: number;
  background: BackgroundMode;
}

/** 图层信息 */
export interface LayerInfo {
  id: string;
  name: string;
  fill: string;
  visible: boolean;
  type: string;
}

/** 应用状态 */
export interface AppState {
  // 上传
  sourceFile: File | null;
  sourceDataUrl: string | null;
  imageInfo: ImageInfo | null;

  // 转换
  jobStatus: JobStatus;
  svgResult: string | null;
  svgPreviewUrl: string | null;
  errorMessage: string | null;

  // 参数
  settings: VectorSettings;

  // 质量报告
  qualityReport: QualityReport | null;

  // 图层
  layers: LayerInfo[];
  layeredSvg: string | null;     // 带 <g> 分层的原始 SVG
  flatSvg: string | null;        // 扁平化（无 <g>）SVG

  // 导出
  exportSettings: ExportSettings;
  showExportDialog: boolean;
  exportLayered: boolean;        // true=保留图层结构, false=扁平化

  // Actions
  setSourceFile: (file: File) => Promise<void>;
  prepareFile: (file: File) => Promise<void>;
  restoreFromCache: (dataUrl: string) => void;
  startConversion: () => Promise<void>;
  setSettings: (settings: Partial<VectorSettings>) => void;
  setExportSettings: (settings: Partial<ExportSettings>) => void;
  setShowExportDialog: (show: boolean) => void;
  toggleLayer: (id: string) => void;
  setExportLayered: (v: boolean) => void;
  reset: () => void;
}

/** 通用最佳默认 — 保守识别优先 */
export const DEFAULT_SETTINGS: VectorSettings = {
  mode: 'logo_color',
  colorCount: 6,
  noiseReduction: 18,
  pathPrecision: 55,
  smoothness: 55,
  cornerPreservation: 50,
  minArea: 12,
};

export const DEFAULT_EXPORT: ExportSettings = {
  format: 'svg',
  unit: 'px',
  width: 0,
  height: 0,
  scale: 1,
  background: 'transparent',
};
