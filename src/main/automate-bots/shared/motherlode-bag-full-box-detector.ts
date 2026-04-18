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

// The panel is in the top-left and scales with client size.
const ROI_LEFT_RATIO = 0.0283;
const ROI_RIGHT_RATIO = 0.0605;
const ROI_TOP_RATIO = 0.0813;
const ROI_BOTTOM_RATIO = 0.0904;

const MIN_STATE_FILL_RATIO = 0.07;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
  const roi = resolveStatusPanelRoi(bitmap);
  const totalPixelCount = roi.width * roi.height;
  const colorCounts = collectColorCounts(bitmap, roi);
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
