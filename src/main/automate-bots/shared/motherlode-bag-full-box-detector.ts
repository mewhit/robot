import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { RobotBitmap } from "./ocr-engine";

export type MotherlodeBagFullState = "native" | "green" | "yellow" | "red";

export type MotherlodeBagFullBox = {
  state: MotherlodeBagFullState;
  x: number;
  y: number;
  width: number;
  height: number;
  totalPixelCount: number;
  nativePixelCount: number;
  greenPixelCount: number;
  yellowPixelCount: number;
  redPixelCount: number;
  dominantPixelCount: number;
  confidence: number;
};

type ColorCounts = {
  native: number;
  green: number;
  yellow: number;
  red: number;
};

type Roi = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type TextBand = {
  startY: number;
  endY: number;
};

type CandidateRoiMetrics = {
  roi: Roi;
  totalPixelCount: number;
  textPixelCount: number;
  counts: ColorCounts;
  activePixelCount: number;
  activeScore: number;
  nativeScore: number;
};

// The sack panel always lives in the left-side overlay strip, but other
// RuneLite plugins can move it vertically. Scan the full strip instead of
// assuming a fixed y-ratio.
const SEARCH_LEFT_RATIO = 0;
const SEARCH_TOP_RATIO = 0;
const SEARCH_RIGHT_RATIO = 0.14;
const SEARCH_BOTTOM_RATIO = 0.4;

const ROI_LEFT_RATIO = 0.0283;
const ROI_RIGHT_RATIO = 0.0605;
const ROI_TOP_RATIO = 0.0813;
const ROI_BOTTOM_RATIO = 0.0904;

const TEXT_ROW_THRESHOLD_RATIO = 0.012;
const MAX_TEXT_BAND_HEIGHT_RATIO = 0.06;
const MAX_CANDIDATE_BAND_GAP_RATIO = 0.015;
const CANDIDATE_TEXT_GROUP_SIZE = 3;

const ACTIVE_SELECTION_MIN_PIXEL_COUNT = 80;
const ACTIVE_SELECTION_MIN_SCORE = 18;
const MIN_STATE_FILL_RATIO = 0.04;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveStatusPanelSearchBounds(bitmap: RobotBitmap): Roi {
  const x0 = Math.round(bitmap.width * SEARCH_LEFT_RATIO);
  const x1 = Math.round(bitmap.width * SEARCH_RIGHT_RATIO);
  const y0 = Math.round(bitmap.height * SEARCH_TOP_RATIO);
  const y1 = Math.round(bitmap.height * SEARCH_BOTTOM_RATIO);

  const x = clamp(x0, 0, bitmap.width - 1);
  const y = clamp(y0, 0, bitmap.height - 1);
  const maxX = clamp(Math.max(x0 + 30, x1), 0, bitmap.width - 1);
  const maxY = clamp(Math.max(y0 + 30, y1), 0, bitmap.height - 1);

  return {
    x,
    y,
    width: maxX - x + 1,
    height: maxY - y + 1,
  };
}

function resolveStatusPanelRoi(bitmap: RobotBitmap): Roi {
  const x0 = Math.round(bitmap.width * ROI_LEFT_RATIO);
  const x1 = Math.round(bitmap.width * ROI_RIGHT_RATIO);
  const y0 = Math.round(bitmap.height * ROI_TOP_RATIO);
  const y1 = Math.round(bitmap.height * ROI_BOTTOM_RATIO);

  const x = clamp(x0, 0, bitmap.width - 1);
  const y = clamp(y0, 0, bitmap.height - 1);
  const maxX = clamp(Math.max(x0 + 2, x1), 0, bitmap.width - 1);
  const maxY = clamp(Math.max(y0 + 2, y1), 0, bitmap.height - 1);

  return {
    x,
    y,
    width: maxX - x + 1,
    height: maxY - y + 1,
  };
}

function isGreenStatusPixel(r: number, g: number, b: number): boolean {
  return g >= 105 && g - r >= 28 && g - b >= 20 && r <= 110 && b <= 70;
}

function isYellowStatusPixel(r: number, g: number, b: number): boolean {
  return r >= 130 && g >= 75 && g <= 160 && b <= 55 && r - g >= 18 && r - b >= 65;
}

function isRedStatusPixel(r: number, g: number, b: number): boolean {
  return r >= 120 && g <= 75 && b <= 55 && r - Math.max(g, b) >= 48;
}

function isNativeStatusPixel(r: number, g: number, b: number): boolean {
  return r >= 50 && r <= 120 && g >= 40 && g <= 105 && b >= 25 && b <= 80 && r >= g && g >= b - 5;
}

function isStatusPanelTextPixel(r: number, g: number, b: number): boolean {
  const maxChannel = Math.max(r, g, b);
  const minChannel = Math.min(r, g, b);
  const saturation = maxChannel - minChannel;
  const luminance = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

  const isNeutralBrightText = luminance >= 150 && saturation <= 170;
  const isYellowishText = luminance >= 110 && r >= 140 && g >= 100 && b <= 120;
  const isGreenText = luminance >= 90 && g >= 140 && r <= 190 && b <= 160;
  const isRedText = luminance >= 80 && r >= 150 && g <= 140 && b <= 120;

  return isNeutralBrightText || isYellowishText || isGreenText || isRedText;
}

function findTextBands(bitmap: RobotBitmap, searchBounds: Roi): TextBand[] {
  const bands: TextBand[] = [];
  const rowThreshold = Math.max(3, Math.floor(searchBounds.width * TEXT_ROW_THRESHOLD_RATIO));
  const maxBandHeight = Math.max(16, Math.round(bitmap.height * MAX_TEXT_BAND_HEIGHT_RATIO));
  let activeStart = -1;

  for (let y = searchBounds.y; y < searchBounds.y + searchBounds.height; y += 1) {
    let rowCount = 0;

    for (let x = searchBounds.x; x < searchBounds.x + searchBounds.width; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];

      if (isStatusPanelTextPixel(r, g, b)) {
        rowCount += 1;
      }
    }

    if (rowCount >= rowThreshold) {
      if (activeStart < 0) {
        activeStart = y;
      }
      continue;
    }

    if (activeStart >= 0) {
      const endY = y - 1;
      const bandHeight = endY - activeStart + 1;
      if (bandHeight >= 3 && bandHeight <= maxBandHeight) {
        bands.push({ startY: activeStart, endY });
      }
      activeStart = -1;
    }
  }

  if (activeStart >= 0) {
    const endY = searchBounds.y + searchBounds.height - 1;
    const bandHeight = endY - activeStart + 1;
    if (bandHeight >= 3 && bandHeight <= maxBandHeight) {
      bands.push({ startY: activeStart, endY });
    }
  }

  return bands;
}

function resolveTextBounds(bitmap: RobotBitmap, searchBounds: Roi, bands: TextBand[]): Roi | null {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;

  for (const band of bands) {
    for (let y = band.startY; y <= band.endY; y += 1) {
      for (let x = searchBounds.x; x < searchBounds.x + searchBounds.width; x += 1) {
        const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
        const b = bitmap.image[offset];
        const g = bitmap.image[offset + 1];
        const r = bitmap.image[offset + 2];

        if (!isStatusPanelTextPixel(r, g, b)) {
          continue;
        }

        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    return null;
  }

  return {
    x: minX,
    y: bands[0].startY,
    width: maxX - minX + 1,
    height: bands[bands.length - 1].endY - bands[0].startY + 1,
  };
}

function expandRoi(bitmap: RobotBitmap, roi: Roi, padX: number, padY: number): Roi {
  const x = clamp(roi.x - padX, 0, bitmap.width - 1);
  const y = clamp(roi.y - padY, 0, bitmap.height - 1);
  const maxX = clamp(roi.x + roi.width - 1 + padX, 0, bitmap.width - 1);
  const maxY = clamp(roi.y + roi.height - 1 + padY, 0, bitmap.height - 1);

  return {
    x,
    y,
    width: maxX - x + 1,
    height: maxY - y + 1,
  };
}

function collectColorCounts(bitmap: RobotBitmap, roi: Roi): ColorCounts {
  const counts: ColorCounts = {
    native: 0,
    green: 0,
    yellow: 0,
    red: 0,
  };

  for (let y = roi.y; y < roi.y + roi.height; y += 1) {
    for (let x = roi.x; x < roi.x + roi.width; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];

      if (isGreenStatusPixel(r, g, b)) {
        counts.green += 1;
      }

      if (isYellowStatusPixel(r, g, b)) {
        counts.yellow += 1;
      }

      if (isRedStatusPixel(r, g, b)) {
        counts.red += 1;
      }

      if (isNativeStatusPixel(r, g, b)) {
        counts.native += 1;
      }
    }
  }

  return counts;
}

function collectCandidateRoiMetrics(bitmap: RobotBitmap, roi: Roi): CandidateRoiMetrics {
  const counts: ColorCounts = {
    native: 0,
    green: 0,
    yellow: 0,
    red: 0,
  };
  let textPixelCount = 0;

  for (let y = roi.y; y < roi.y + roi.height; y += 1) {
    for (let x = roi.x; x < roi.x + roi.width; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];

      if (isStatusPanelTextPixel(r, g, b)) {
        textPixelCount += 1;
      }

      if (isGreenStatusPixel(r, g, b)) {
        counts.green += 1;
      }

      if (isYellowStatusPixel(r, g, b)) {
        counts.yellow += 1;
      }

      if (isRedStatusPixel(r, g, b)) {
        counts.red += 1;
      }

      if (isNativeStatusPixel(r, g, b)) {
        counts.native += 1;
      }
    }
  }

  const totalPixelCount = roi.width * roi.height;
  const activePixelCount = Math.max(counts.green, counts.yellow, counts.red);
  const activeScore = (activePixelCount * activePixelCount) / Math.max(1, totalPixelCount);
  const nativeScore = (counts.native * counts.native) / Math.max(1, totalPixelCount) + roi.y * 0.5 + textPixelCount * 0.05;

  return {
    roi,
    totalPixelCount,
    textPixelCount,
    counts,
    activePixelCount,
    activeScore,
    nativeScore,
  };
}

function resolveDynamicStatusPanelRoi(bitmap: RobotBitmap): CandidateRoiMetrics | null {
  const searchBounds = resolveStatusPanelSearchBounds(bitmap);
  const bands = findTextBands(bitmap, searchBounds);
  if (bands.length < CANDIDATE_TEXT_GROUP_SIZE) {
    return null;
  }

  const maxBandGap = Math.max(12, Math.round(bitmap.height * MAX_CANDIDATE_BAND_GAP_RATIO));
  const padX = clamp(Math.round(bitmap.width * 0.004), 8, 16);
  const padY = clamp(Math.round(bitmap.height * 0.004), 6, 12);
  const seen = new Set<string>();

  let bestActive: CandidateRoiMetrics | null = null;
  let bestNative: CandidateRoiMetrics | null = null;

  for (let index = 0; index + CANDIDATE_TEXT_GROUP_SIZE - 1 < bands.length; index += 1) {
    const candidateBands = bands.slice(index, index + CANDIDATE_TEXT_GROUP_SIZE);
    let hasLargeGap = false;

    for (let bandIndex = 1; bandIndex < candidateBands.length; bandIndex += 1) {
      const gap = candidateBands[bandIndex].startY - candidateBands[bandIndex - 1].endY;
      if (gap < 0 || gap > maxBandGap) {
        hasLargeGap = true;
        break;
      }
    }

    if (hasLargeGap) {
      continue;
    }

    const textBounds = resolveTextBounds(bitmap, searchBounds, candidateBands);
    if (!textBounds) {
      continue;
    }

    const roi = expandRoi(bitmap, textBounds, padX, padY);
    const key = `${roi.x}:${roi.y}:${roi.width}:${roi.height}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const metrics = collectCandidateRoiMetrics(bitmap, roi);

    if (!bestActive || metrics.activeScore > bestActive.activeScore) {
      bestActive = metrics;
    }

    if (!bestNative || metrics.nativeScore > bestNative.nativeScore) {
      bestNative = metrics;
    }
  }

  if (bestActive && bestActive.activePixelCount >= ACTIVE_SELECTION_MIN_PIXEL_COUNT && bestActive.activeScore >= ACTIVE_SELECTION_MIN_SCORE) {
    return bestActive;
  }

  return bestNative;
}

function classifyState(counts: ColorCounts, totalPixelCount: number): {
  state: MotherlodeBagFullState;
  dominantPixelCount: number;
  confidence: number;
} {
  const candidates: Array<{ state: Exclude<MotherlodeBagFullState, "native">; pixelCount: number }> = [
    { state: "green", pixelCount: counts.green },
    { state: "yellow", pixelCount: counts.yellow },
    { state: "red", pixelCount: counts.red },
  ];

  candidates.sort((a, b) => b.pixelCount - a.pixelCount);

  const top = candidates[0];
  const topFillRatio = top.pixelCount / Math.max(1, totalPixelCount);
  const minAbsolutePixels = Math.max(24, Math.floor(totalPixelCount * 0.02));

  if (top.pixelCount >= minAbsolutePixels && topFillRatio >= MIN_STATE_FILL_RATIO) {
    const confidence = clamp(topFillRatio * 3 + top.pixelCount / 260, 0, 1);
    return {
      state: top.state,
      dominantPixelCount: top.pixelCount,
      confidence,
    };
  }

  const nativeFillRatio = counts.native / Math.max(1, totalPixelCount);
  const activeFillRatio = (counts.green + counts.yellow + counts.red) / Math.max(1, totalPixelCount);
  const confidence = clamp(nativeFillRatio * 0.8 + (1 - activeFillRatio), 0.2, 1);

  return {
    state: "native",
    dominantPixelCount: counts.native,
    confidence,
  };
}

export function detectMotherlodeBagFullBoxInScreenshot(bitmap: RobotBitmap): MotherlodeBagFullBox {
  const dynamicCandidate = resolveDynamicStatusPanelRoi(bitmap);
  const roi = dynamicCandidate?.roi ?? resolveStatusPanelRoi(bitmap);
  const totalPixelCount = dynamicCandidate?.totalPixelCount ?? roi.width * roi.height;
  const colorCounts = dynamicCandidate?.counts ?? collectColorCounts(bitmap, roi);
  const classification = classifyState(colorCounts, totalPixelCount);

  return {
    state: classification.state,
    x: roi.x,
    y: roi.y,
    width: roi.width,
    height: roi.height,
    totalPixelCount,
    nativePixelCount: colorCounts.native,
    greenPixelCount: colorCounts.green,
    yellowPixelCount: colorCounts.yellow,
    redPixelCount: colorCounts.red,
    dominantPixelCount: classification.dominantPixelCount,
    confidence: classification.confidence,
  };
}

export function detectMotherlodeBagFullStateInScreenshot(bitmap: RobotBitmap): MotherlodeBagFullState {
  return detectMotherlodeBagFullBoxInScreenshot(bitmap).state;
}

function drawRectangleOnPng(
  png: PNG,
  x: number,
  y: number,
  width: number,
  height: number,
  color: { r: number; g: number; b: number },
  thickness: number,
): void {
  const clampX0 = Math.max(0, Math.min(png.width - 1, x));
  const clampY0 = Math.max(0, Math.min(png.height - 1, y));
  const clampX1 = Math.max(0, Math.min(png.width - 1, x + width - 1));
  const clampY1 = Math.max(0, Math.min(png.height - 1, y + height - 1));

  if (clampX1 < clampX0 || clampY1 < clampY0) {
    return;
  }

  const paintPixel = (px: number, py: number) => {
    if (px < 0 || py < 0 || px >= png.width || py >= png.height) {
      return;
    }

    const idx = (py * png.width + px) * 4;
    png.data[idx] = color.r;
    png.data[idx + 1] = color.g;
    png.data[idx + 2] = color.b;
    png.data[idx + 3] = 255;
  };

  for (let t = 0; t < thickness; t += 1) {
    const top = clampY0 + t;
    const bottom = clampY1 - t;
    const left = clampX0 + t;
    const right = clampX1 - t;

    if (left > right || top > bottom) {
      break;
    }

    for (let px = left; px <= right; px += 1) {
      paintPixel(px, top);
      paintPixel(px, bottom);
    }

    for (let py = top; py <= bottom; py += 1) {
      paintPixel(left, py);
      paintPixel(right, py);
    }
  }
}

function getStateColor(state: MotherlodeBagFullState): { r: number; g: number; b: number } {
  switch (state) {
    case "green":
      return { r: 40, g: 214, b: 88 };
    case "yellow":
      return { r: 244, g: 188, b: 44 };
    case "red":
      return { r: 236, g: 72, b: 72 };
    case "native":
      return { r: 176, g: 136, b: 88 };
    default:
      return { r: 255, g: 255, b: 255 };
  }
}

export function saveBitmapWithMotherlodeBagFullBox(
  bitmap: RobotBitmap,
  detection: MotherlodeBagFullBox,
  filename: string,
): void {
  const png = new PNG({
    width: bitmap.width,
    height: bitmap.height,
  });

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const pngIdx = (y * bitmap.width + x) * 4;
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];

      png.data[pngIdx] = r;
      png.data[pngIdx + 1] = g;
      png.data[pngIdx + 2] = b;
      png.data[pngIdx + 3] = 255;
    }
  }

  drawRectangleOnPng(png, detection.x, detection.y, detection.width, detection.height, getStateColor(detection.state), 3);

  const dir = path.dirname(filename);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  png.pack().pipe(fs.createWriteStream(filename));
}
