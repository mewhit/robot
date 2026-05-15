import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import type { RobotBitmap } from "./ocr-engine";

export type RuneLiteSidePanelSearchRoi = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RuneLiteSidePanelOrangeIndicator = {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  pixelCount: number;
  fillRatio: number;
  aspectRatio: number;
  avgRed: number;
  avgGreen: number;
  avgBlue: number;
  score: number;
};

export type RuneLiteSidePanelOrangeDetection = {
  searchRoi: RuneLiteSidePanelSearchRoi;
  candidates: RuneLiteSidePanelOrangeIndicator[];
  bestIndicator: RuneLiteSidePanelOrangeIndicator | null;
};

type MaskComponent = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixelCount: number;
  redSum: number;
  greenSum: number;
  blueSum: number;
};

const DEFAULT_RIGHT_SEARCH_WIDTH_PX = 260;
const DEFAULT_MIN_PIXEL_COUNT = 24;
const DEFAULT_MIN_HEIGHT_PX = 18;
const DEFAULT_MAX_HEIGHT_PX = 72;
const DEFAULT_MAX_WIDTH_PX = 8;
const DEFAULT_MIN_FILL_RATIO = 0.72;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeSearchRoi(bitmap: RobotBitmap, roi: RuneLiteSidePanelSearchRoi): RuneLiteSidePanelSearchRoi {
  const x = clamp(Math.floor(roi.x), 0, bitmap.width - 1);
  const y = clamp(Math.floor(roi.y), 0, bitmap.height - 1);
  const right = clamp(Math.floor(roi.x + roi.width - 1), x, bitmap.width - 1);
  const bottom = clamp(Math.floor(roi.y + roi.height - 1), y, bitmap.height - 1);
  return { x, y, width: right - x + 1, height: bottom - y + 1 };
}

function makeDefaultSearchRoi(bitmap: RobotBitmap, rightSearchWidthPx: number): RuneLiteSidePanelSearchRoi {
  const width = Math.min(Math.max(1, Math.round(rightSearchWidthPx)), bitmap.width);
  return {
    x: Math.max(0, bitmap.width - width),
    y: 0,
    width,
    height: bitmap.height,
  };
}

function isRuneLiteSidePanelOrangePixel(r: number, g: number, b: number): boolean {
  return r >= 205 && g >= 90 && g <= 165 && b <= 36 && r - g >= 60 && g - b >= 70;
}

function buildMask(bitmap: RobotBitmap, roi: RuneLiteSidePanelSearchRoi): Uint8Array {
  const mask = new Uint8Array(bitmap.width * bitmap.height);

  for (let y = roi.y; y < roi.y + roi.height; y += 1) {
    for (let x = roi.x; x < roi.x + roi.width; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (isRuneLiteSidePanelOrangePixel(r, g, b)) {
        mask[y * bitmap.width + x] = 1;
      }
    }
  }

  return mask;
}

function collectConnectedComponents(mask: Uint8Array, bitmap: RobotBitmap): MaskComponent[] {
  const remaining = mask.slice();
  const components: MaskComponent[] = [];

  for (let startIndex = 0; startIndex < remaining.length; startIndex += 1) {
    if (!remaining[startIndex]) {
      continue;
    }

    const stack = [startIndex];
    remaining[startIndex] = 0;

    let minX = bitmap.width;
    let minY = bitmap.height;
    let maxX = -1;
    let maxY = -1;
    let pixelCount = 0;
    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;

    while (stack.length > 0) {
      const index = stack.pop();
      if (index === undefined) {
        break;
      }

      const x = index % bitmap.width;
      const y = Math.floor(index / bitmap.width);
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];

      pixelCount += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      redSum += r;
      greenSum += g;
      blueSum += b;

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }

          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextY < 0 || nextX >= bitmap.width || nextY >= bitmap.height) {
            continue;
          }

          const nextIndex = nextY * bitmap.width + nextX;
          if (!remaining[nextIndex]) {
            continue;
          }

          remaining[nextIndex] = 0;
          stack.push(nextIndex);
        }
      }
    }

    components.push({ minX, minY, maxX, maxY, pixelCount, redSum, greenSum, blueSum });
  }

  return components;
}

function toOrangeIndicator(
  component: MaskComponent,
  options: {
    minPixelCount: number;
    minHeightPx: number;
    maxHeightPx: number;
    maxWidthPx: number;
    minFillRatio: number;
  },
): RuneLiteSidePanelOrangeIndicator | null {
  const width = component.maxX - component.minX + 1;
  const height = component.maxY - component.minY + 1;
  const fillRatio = component.pixelCount / (width * height);
  const aspectRatio = height / width;

  if (component.pixelCount < options.minPixelCount) {
    return null;
  }

  if (height < options.minHeightPx || height > options.maxHeightPx || width > options.maxWidthPx) {
    return null;
  }

  if (fillRatio < options.minFillRatio || aspectRatio < 3) {
    return null;
  }

  const avgRed = component.redSum / component.pixelCount;
  const avgGreen = component.greenSum / component.pixelCount;
  const avgBlue = component.blueSum / component.pixelCount;
  const centerX = Math.round(component.minX + width / 2);
  const centerY = Math.round(component.minY + height / 2);
  const orangeStrength = avgRed + avgGreen - avgBlue * 2;
  const score = component.pixelCount * 4 + height * 8 + fillRatio * 120 + orangeStrength - width * 5;

  return {
    x: component.minX,
    y: component.minY,
    width,
    height,
    centerX,
    centerY,
    pixelCount: component.pixelCount,
    fillRatio,
    aspectRatio,
    avgRed,
    avgGreen,
    avgBlue,
    score,
  };
}

function sortIndicators(indicators: RuneLiteSidePanelOrangeIndicator[]): RuneLiteSidePanelOrangeIndicator[] {
  return indicators.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    if (b.pixelCount !== a.pixelCount) {
      return b.pixelCount - a.pixelCount;
    }

    return a.y - b.y;
  });
}

function bitmapToPng(bitmap: RobotBitmap): PNG {
  const png = new PNG({ width: bitmap.width, height: bitmap.height });

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const targetOffset = (y * bitmap.width + x) * 4;
      const sourceOffset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      png.data[targetOffset] = bitmap.image[sourceOffset + 2];
      png.data[targetOffset + 1] = bitmap.image[sourceOffset + 1];
      png.data[targetOffset + 2] = bitmap.image[sourceOffset];
      png.data[targetOffset + 3] = bitmap.image[sourceOffset + 3] ?? 255;
    }
  }

  return png;
}

function setPngPixel(png: PNG, x: number, y: number, color: { r: number; g: number; b: number }): void {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) {
    return;
  }

  const offset = (y * png.width + x) * 4;
  png.data[offset] = color.r;
  png.data[offset + 1] = color.g;
  png.data[offset + 2] = color.b;
  png.data[offset + 3] = 255;
}

function drawBox(
  png: PNG,
  box: { x: number; y: number; width: number; height: number },
  color: { r: number; g: number; b: number },
  thickness: number,
): void {
  const x0 = clamp(Math.round(box.x), 0, png.width - 1);
  const y0 = clamp(Math.round(box.y), 0, png.height - 1);
  const x1 = clamp(Math.round(box.x + box.width - 1), x0, png.width - 1);
  const y1 = clamp(Math.round(box.y + box.height - 1), y0, png.height - 1);

  for (let offset = 0; offset < thickness; offset += 1) {
    for (let x = x0; x <= x1; x += 1) {
      setPngPixel(png, x, y0 + offset, color);
      setPngPixel(png, x, y1 - offset, color);
    }

    for (let y = y0; y <= y1; y += 1) {
      setPngPixel(png, x0 + offset, y, color);
      setPngPixel(png, x1 - offset, y, color);
    }
  }
}

function drawCross(png: PNG, x: number, y: number, color: { r: number; g: number; b: number }, radius: number): void {
  for (let delta = -radius; delta <= radius; delta += 1) {
    setPngPixel(png, x + delta, y, color);
    setPngPixel(png, x, y + delta, color);
  }
}

function ensureParentDirectory(filename: string): void {
  const dir = path.dirname(filename);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writePngToFile(png: PNG, filename: string): Promise<void> {
  ensureParentDirectory(filename);
  return new Promise((resolve, reject) => {
    png.pack().pipe(fs.createWriteStream(filename)).on("finish", resolve).on("error", reject);
  });
}

export function detectRuneLiteSidePanelOrangeIndicator(
  bitmap: RobotBitmap,
  options: {
    searchRoi?: RuneLiteSidePanelSearchRoi;
    rightSearchWidthPx?: number;
    minPixelCount?: number;
    minHeightPx?: number;
    maxHeightPx?: number;
    maxWidthPx?: number;
    minFillRatio?: number;
  } = {},
): RuneLiteSidePanelOrangeDetection {
  const searchRoi = normalizeSearchRoi(
    bitmap,
    options.searchRoi ?? makeDefaultSearchRoi(bitmap, options.rightSearchWidthPx ?? DEFAULT_RIGHT_SEARCH_WIDTH_PX),
  );
  const mask = buildMask(bitmap, searchRoi);
  const components = collectConnectedComponents(mask, bitmap).filter((component) => component.pixelCount >= 2);
  const candidates = sortIndicators(
    components
      .map((component) =>
        toOrangeIndicator(component, {
          minPixelCount: options.minPixelCount ?? DEFAULT_MIN_PIXEL_COUNT,
          minHeightPx: options.minHeightPx ?? DEFAULT_MIN_HEIGHT_PX,
          maxHeightPx: options.maxHeightPx ?? DEFAULT_MAX_HEIGHT_PX,
          maxWidthPx: options.maxWidthPx ?? DEFAULT_MAX_WIDTH_PX,
          minFillRatio: options.minFillRatio ?? DEFAULT_MIN_FILL_RATIO,
        }),
      )
      .filter((indicator): indicator is RuneLiteSidePanelOrangeIndicator => indicator !== null),
  );

  return {
    searchRoi,
    candidates,
    bestIndicator: candidates[0] ?? null,
  };
}

export async function saveBitmapWithRuneLiteSidePanelOrangeDebug(
  bitmap: RobotBitmap,
  detection: RuneLiteSidePanelOrangeDetection,
  outputPath: string,
  options: {
    referenceBox?: { x: number; y: number; width: number; height: number } | null;
  } = {},
): Promise<void> {
  const png = bitmapToPng(bitmap);
  drawBox(png, detection.searchRoi, { r: 255, g: 220, b: 0 }, 3);

  for (const candidate of detection.candidates) {
    const isBest = candidate === detection.bestIndicator;
    const color = isBest ? { r: 0, g: 255, b: 80 } : { r: 255, g: 0, b: 255 };
    drawBox(png, candidate, color, isBest ? 4 : 2);
    drawCross(png, candidate.centerX, candidate.centerY, color, 6);
  }

  if (options.referenceBox) {
    drawBox(png, options.referenceBox, { r: 64, g: 220, b: 255 }, 3);
    drawCross(
      png,
      Math.round(options.referenceBox.x + options.referenceBox.width / 2),
      Math.round(options.referenceBox.y + options.referenceBox.height / 2),
      { r: 64, g: 220, b: 255 },
      7,
    );
  }

  await writePngToFile(png, outputPath);
}

export function formatRuneLiteSidePanelOrangeDetection(detection: RuneLiteSidePanelOrangeDetection): string {
  const best = detection.bestIndicator
    ? `best=${detection.bestIndicator.centerX},${detection.bestIndicator.centerY} ${detection.bestIndicator.width}x${detection.bestIndicator.height} px=${detection.bestIndicator.pixelCount} fill=${detection.bestIndicator.fillRatio.toFixed(2)} score=${detection.bestIndicator.score.toFixed(1)}`
    : "best=none";
  const candidates = detection.candidates
    .map((candidate) => `${candidate.centerX},${candidate.centerY}:${candidate.width}x${candidate.height}:${candidate.pixelCount}`)
    .join("|");
  return `roi=${detection.searchRoi.x},${detection.searchRoi.y},${detection.searchRoi.width}x${detection.searchRoi.height} ${best} candidates=${candidates || "none"}`;
}
