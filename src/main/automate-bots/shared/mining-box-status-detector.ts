import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { RobotBitmap } from "./ocr-engine";

export type MiningBoxStatus = "mining" | "not-mining" | "unknown";

export type MiningBoxStatusDetection = {
  status: MiningBoxStatus;
  isMining: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  greenPixelCount: number;
  redPixelCount: number;
  totalStatusPixelCount: number;
  dominantPixelCount: number;
  confidence: number;
};

type Roi = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PixelExtents = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  count: number;
};

const STATUS_SEARCH_LEFT_RATIO = 0.009;
const STATUS_SEARCH_RIGHT_RATIO = 0.05;
const STATUS_SEARCH_TOP_RATIO = 0.04;
const STATUS_SEARCH_BOTTOM_RATIO = 0.075;
const MIN_STATUS_SEARCH_WIDTH = 160;
const MIN_STATUS_SEARCH_HEIGHT = 110;

const MIN_STATUS_PIXEL_COUNT = 12;
const MIN_DOMINANCE_RATIO = 0.62;
const STATUS_BOX_PADDING_X = 10;
const STATUS_BOX_PADDING_Y = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveStatusRoi(bitmap: RobotBitmap): Roi {
  const x0 = Math.round(bitmap.width * STATUS_SEARCH_LEFT_RATIO);
  const x1 = Math.round(bitmap.width * STATUS_SEARCH_RIGHT_RATIO);
  const y0 = Math.round(bitmap.height * STATUS_SEARCH_TOP_RATIO);
  const y1 = Math.round(bitmap.height * STATUS_SEARCH_BOTTOM_RATIO);

  const x = clamp(x0, 0, bitmap.width - 1);
  const y = clamp(y0, 0, bitmap.height - 1);
  const maxX = clamp(Math.max(x0 + MIN_STATUS_SEARCH_WIDTH - 1, x1), 0, bitmap.width - 1);
  const maxY = clamp(Math.max(y0 + MIN_STATUS_SEARCH_HEIGHT - 1, y1), 0, bitmap.height - 1);

  return {
    x,
    y,
    width: maxX - x + 1,
    height: maxY - y + 1,
  };
}

function isMiningGreenPixel(r: number, g: number, b: number): boolean {
  return g >= 150 && r <= 120 && b <= 120 && g - Math.max(r, b) >= 60;
}

function isNotMiningRedPixel(r: number, g: number, b: number): boolean {
  return r >= 150 && g <= 120 && b <= 120 && r - Math.max(g, b) >= 60;
}

function createEmptyPixelExtents(): PixelExtents {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    count: 0,
  };
}

function recordPixel(extents: PixelExtents, x: number, y: number): void {
  extents.minX = Math.min(extents.minX, x);
  extents.minY = Math.min(extents.minY, y);
  extents.maxX = Math.max(extents.maxX, x);
  extents.maxY = Math.max(extents.maxY, y);
  extents.count += 1;
}

function extentsToRoi(bitmap: RobotBitmap, extents: PixelExtents, paddingX: number, paddingY: number): Roi | null {
  if (extents.count === 0) {
    return null;
  }

  const x = clamp(extents.minX - paddingX, 0, bitmap.width - 1);
  const y = clamp(extents.minY - paddingY, 0, bitmap.height - 1);
  const maxX = clamp(extents.maxX + paddingX, 0, bitmap.width - 1);
  const maxY = clamp(extents.maxY + paddingY, 0, bitmap.height - 1);

  return {
    x,
    y,
    width: maxX - x + 1,
    height: maxY - y + 1,
  };
}

function countStatusPixels(bitmap: RobotBitmap, roi: Roi): {
  greenPixelCount: number;
  redPixelCount: number;
  greenExtents: PixelExtents;
  redExtents: PixelExtents;
} {
  const greenExtents = createEmptyPixelExtents();
  const redExtents = createEmptyPixelExtents();

  for (let y = roi.y; y < roi.y + roi.height; y += 1) {
    for (let x = roi.x; x < roi.x + roi.width; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];

      if (isMiningGreenPixel(r, g, b)) {
        recordPixel(greenExtents, x, y);
      }

      if (isNotMiningRedPixel(r, g, b)) {
        recordPixel(redExtents, x, y);
      }
    }
  }

  return {
    greenPixelCount: greenExtents.count,
    redPixelCount: redExtents.count,
    greenExtents,
    redExtents,
  };
}

function classifyStatus(
  greenPixelCount: number,
  redPixelCount: number,
): {
  status: MiningBoxStatus;
  dominantPixelCount: number;
  confidence: number;
} {
  const totalStatusPixelCount = greenPixelCount + redPixelCount;
  const dominantPixelCount = Math.max(greenPixelCount, redPixelCount);

  if (dominantPixelCount < MIN_STATUS_PIXEL_COUNT || totalStatusPixelCount === 0) {
    return {
      status: "unknown",
      dominantPixelCount,
      confidence: 0,
    };
  }

  const dominanceRatio = dominantPixelCount / totalStatusPixelCount;
  if (dominanceRatio < MIN_DOMINANCE_RATIO) {
    return {
      status: "unknown",
      dominantPixelCount,
      confidence: 0,
    };
  }

  const status: MiningBoxStatus = greenPixelCount >= redPixelCount ? "mining" : "not-mining";
  const confidence = clamp((dominanceRatio - 0.5) * 1.8 + dominantPixelCount / 80, 0, 1);

  return {
    status,
    dominantPixelCount,
    confidence,
  };
}

function resolveDetectedStatusBox(
  bitmap: RobotBitmap,
  searchRoi: Roi,
  status: MiningBoxStatus,
  greenExtents: PixelExtents,
  redExtents: PixelExtents,
): Roi {
  if (status === "mining") {
    return extentsToRoi(bitmap, greenExtents, STATUS_BOX_PADDING_X, STATUS_BOX_PADDING_Y) ?? searchRoi;
  }

  if (status === "not-mining") {
    return extentsToRoi(bitmap, redExtents, STATUS_BOX_PADDING_X, STATUS_BOX_PADDING_Y) ?? searchRoi;
  }

  return searchRoi;
}

export function detectMiningBoxStatusInScreenshot(bitmap: RobotBitmap): MiningBoxStatusDetection {
  const searchRoi = resolveStatusRoi(bitmap);
  const counts = countStatusPixels(bitmap, searchRoi);
  const classification = classifyStatus(counts.greenPixelCount, counts.redPixelCount);
  const detectionRoi = resolveDetectedStatusBox(
    bitmap,
    searchRoi,
    classification.status,
    counts.greenExtents,
    counts.redExtents,
  );

  return {
    status: classification.status,
    isMining: classification.status === "mining",
    x: detectionRoi.x,
    y: detectionRoi.y,
    width: detectionRoi.width,
    height: detectionRoi.height,
    greenPixelCount: counts.greenPixelCount,
    redPixelCount: counts.redPixelCount,
    totalStatusPixelCount: counts.greenPixelCount + counts.redPixelCount,
    dominantPixelCount: classification.dominantPixelCount,
    confidence: classification.confidence,
  };
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

function getStatusColor(status: MiningBoxStatus): { r: number; g: number; b: number } {
  switch (status) {
    case "mining":
      return { r: 40, g: 214, b: 88 };
    case "not-mining":
      return { r: 236, g: 72, b: 72 };
    case "unknown":
    default:
      return { r: 244, g: 188, b: 44 };
  }
}

export function saveBitmapWithMiningBoxStatusDebug(bitmap: RobotBitmap, detection: MiningBoxStatusDetection, outputPath: string): void {
  const png = new PNG({
    width: bitmap.width,
    height: bitmap.height,
  });

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const srcOffset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const dstOffset = (y * bitmap.width + x) * 4;

      png.data[dstOffset] = bitmap.image[srcOffset + 2];
      png.data[dstOffset + 1] = bitmap.image[srcOffset + 1];
      png.data[dstOffset + 2] = bitmap.image[srcOffset];
      png.data[dstOffset + 3] = 255;
    }
  }

  drawRectangleOnPng(png, detection.x, detection.y, detection.width, detection.height, getStatusColor(detection.status), 3);

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  png.pack().pipe(fs.createWriteStream(outputPath));
}
