import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { OCR_SCALE_FACTOR, RobotBitmap } from "./ocr-engine";

export type InventoryCountResult = {
  count: number | null;
  rawText: string | null;
  searchRoi: { x: number; y: number; width: number; height: number };
};

// ============================================
// Search region — bottom-right inventory panel
// (RuneLite Inventory Count plugin number overlay)
// Measured from 3840x2128 screenshots:
//   count number at x≈89%-91%, y≈84%-85%
// ============================================

const SEARCH_LEFT_RATIO = 0.86;
const SEARCH_TOP_RATIO = 0.82;
const SEARCH_RIGHT_RATIO = 1.0;
const SEARCH_BOTTOM_RATIO = 0.9;
const MIN_BOTTOM_RIGHT_SEARCH_WIDTH = 700;
const MIN_BOTTOM_RIGHT_SEARCH_HEIGHT = 420;

// Minimum cyan pixels per row to qualify as a text row
const TEXT_ROW_THRESHOLD_RATIO = 0.002;
// Maximum height of a text band (in screen pixels)
const MAX_BAND_HEIGHT_RATIO = 0.06;
// Minimum height of a text band (in screen pixels)
const MIN_BAND_HEIGHT_PX = 4;

function isInventoryCountPixel(r: number, g: number, b: number): boolean {
  // Cyan (#00FFFF) Arial Bold text.
  // Core pixels: r≈0, g≈255, b≈255.
  // Anti-aliased edge pixels have some red bleed but blue and green stay dominant.
  return r <= 80 && g >= 150 && b >= 150 && g + b >= 320 && Math.abs(g - b) <= 80;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

type Roi = { x: number; y: number; width: number; height: number };

function cropBitmap(bitmap: RobotBitmap, roi: Roi): RobotBitmap {
  const cropped: RobotBitmap = {
    width: roi.width,
    height: roi.height,
    byteWidth: roi.width * bitmap.bytesPerPixel,
    bytesPerPixel: bitmap.bytesPerPixel,
    image: Buffer.alloc(roi.width * roi.height * bitmap.bytesPerPixel),
  };

  for (let row = 0; row < roi.height; row += 1) {
    const sourceStart = (roi.y + row) * bitmap.byteWidth + roi.x * bitmap.bytesPerPixel;
    const sourceEnd = sourceStart + roi.width * bitmap.bytesPerPixel;
    const targetStart = row * cropped.byteWidth;
    bitmap.image.copy(cropped.image, targetStart, sourceStart, sourceEnd);
  }

  return cropped;
}

function buildWhitePixelMask(bitmap: RobotBitmap): Uint8Array {
  const binary = new Uint8Array(bitmap.width * bitmap.height);

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];

      if (isInventoryCountPixel(r, g, b)) {
        binary[y * bitmap.width + x] = 1;
      }
    }
  }

  // Repair isolated gaps (single-pixel holes between set pixels)
  const repaired = binary.slice();
  for (let y = 1; y < bitmap.height - 1; y += 1) {
    for (let x = 1; x < bitmap.width - 1; x += 1) {
      const idx = y * bitmap.width + x;
      if (binary[idx] === 1) {
        continue;
      }
      const left = binary[idx - 1];
      const right = binary[idx + 1];
      const up = binary[idx - bitmap.width];
      const down = binary[idx + bitmap.width];
      if ((left === 1 && right === 1) || (up === 1 && down === 1)) {
        repaired[idx] = 1;
      }
    }
  }

  // Upscale by OCR_SCALE_FACTOR
  const scaledWidth = bitmap.width * OCR_SCALE_FACTOR;
  const scaledHeight = bitmap.height * OCR_SCALE_FACTOR;
  const upscaled = new Uint8Array(scaledWidth * scaledHeight);

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      if (repaired[y * bitmap.width + x] === 0) {
        continue;
      }
      for (let dy = 0; dy < OCR_SCALE_FACTOR; dy += 1) {
        for (let dx = 0; dx < OCR_SCALE_FACTOR; dx += 1) {
          upscaled[(y * OCR_SCALE_FACTOR + dy) * scaledWidth + (x * OCR_SCALE_FACTOR + dx)] = 1;
        }
      }
    }
  }

  return upscaled;
}

type TextBand = { startY: number; endY: number };

function findTextBands(cropped: RobotBitmap): TextBand[] {
  const rowThreshold = Math.max(2, Math.floor(cropped.width * TEXT_ROW_THRESHOLD_RATIO));
  const maxBandHeight = Math.max(30, Math.round(cropped.height * MAX_BAND_HEIGHT_RATIO));
  const bands: TextBand[] = [];
  let activeStart = -1;

  for (let y = 0; y < cropped.height; y += 1) {
    let rowCount = 0;

    for (let x = 0; x < cropped.width; x += 1) {
      const offset = y * cropped.byteWidth + x * cropped.bytesPerPixel;
      const b = cropped.image[offset];
      const g = cropped.image[offset + 1];
      const r = cropped.image[offset + 2];

      if (isInventoryCountPixel(r, g, b)) {
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
      const bandHeight = y - 1 - activeStart + 1;
      if (bandHeight >= MIN_BAND_HEIGHT_PX && bandHeight <= maxBandHeight) {
        bands.push({ startY: activeStart, endY: y - 1 });
      }
      activeStart = -1;
    }
  }

  if (activeStart >= 0) {
    const bandHeight = cropped.height - 1 - activeStart + 1;
    if (bandHeight >= MIN_BAND_HEIGHT_PX && bandHeight <= maxBandHeight) {
      bands.push({ startY: activeStart, endY: cropped.height - 1 });
    }
  }

  return bands;
}

function pickBestBand(bands: TextBand[]): TextBand | null {
  if (bands.length === 0) {
    return null;
  }

  // Prefer bands with the most total cyan pixels (the count number will dominate)
  let best = bands[0];
  let bestPixels = 0;

  for (const band of bands) {
    const height = band.endY - band.startY + 1;
    if (height >= MIN_BAND_HEIGHT_PX && height <= 28) {
      const pixels = height; // proxy: taller bands have more pixels
      if (pixels > bestPixels) {
        bestPixels = pixels;
        best = band;
      }
    }
  }

  return best;
}

// ============================================
// Arial Bold digit templates (5x7)
// Derived from actual 3840x2128 screenshots at 100% DPI
// ============================================

type GlyphTemplate = {
  char: string;
  bits: number[];
};

const ARIAL_BOLD_TEMPLATE_ROWS: Record<string, string[]> = {
  "0": ["01110", "11111", "11011", "11011", "11011", "11111", "01110"],
  "1": ["00011", "01111", "11111", "00011", "00011", "00011", "00011"],
  "2": ["01110", "11011", "00011", "00111", "01110", "11100", "11111"],
  "3": ["01110", "11011", "00111", "00111", "00011", "11011", "01110"],
  "4": ["00110", "00110", "01110", "01010", "11111", "11111", "00010"],
  "5": ["01111", "11000", "11110", "11111", "00011", "11011", "01110"],
  "6": ["01110", "11111", "11110", "11111", "11011", "11111", "01110"],
  "7": ["11111", "00111", "00110", "01100", "01100", "11100", "11000"],
  "8": ["01110", "11011", "11011", "01110", "11011", "11111", "01110"],
  "9": ["01110", "11011", "11011", "11111", "01111", "11111", "01110"],
};

function templateRowsToBits(rows: string[]): number[] {
  const bits: number[] = [];
  for (const row of rows) {
    for (const c of row) {
      bits.push(c === "1" ? 1 : 0);
    }
  }
  return bits;
}

const ARIAL_BOLD_TEMPLATES: GlyphTemplate[] = Object.entries(ARIAL_BOLD_TEMPLATE_ROWS).map(([char, rows]) => ({
  char,
  bits: templateRowsToBits(rows),
}));

function normalizeGlyph(mask: Uint8Array, width: number, x0: number, x1: number, y0: number, y1: number): number[] {
  const targetWidth = 5;
  const targetHeight = 7;
  const sourceWidth = x1 - x0 + 1;
  const sourceHeight = y1 - y0 + 1;
  const bits: number[] = [];

  for (let ty = 0; ty < targetHeight; ty += 1) {
    const syStart = y0 + Math.floor((ty * sourceHeight) / targetHeight);
    const syEnd = y0 + Math.ceil(((ty + 1) * sourceHeight) / targetHeight);

    for (let tx = 0; tx < targetWidth; tx += 1) {
      const sxStart = x0 + Math.floor((tx * sourceWidth) / targetWidth);
      const sxEnd = x0 + Math.ceil(((tx + 1) * sourceWidth) / targetWidth);

      let area = 0;
      let white = 0;
      for (let sy = syStart; sy < syEnd; sy += 1) {
        for (let sx = sxStart; sx < sxEnd; sx += 1) {
          area += 1;
          white += mask[sy * width + sx] ?? 0;
        }
      }

      bits.push(area > 0 && white / area >= 0.32 ? 1 : 0);
    }
  }

  return bits;
}

function classifyInventoryCountDigit(
  mask: Uint8Array,
  scaledWidth: number,
  bandY0: number,
  bandY1: number,
  segX0: number,
  segX1: number,
): string {
  // Find actual ink extents within the band
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let inkCount = 0;

  for (let y = bandY0; y <= bandY1; y += 1) {
    for (let x = segX0; x <= segX1; x += 1) {
      if (mask[y * scaledWidth + x] === 1) {
        inkCount += 1;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (inkCount < 4 || !Number.isFinite(minY)) {
    return "";
  }

  const normalizedBits = normalizeGlyph(mask, scaledWidth, segX0, segX1, minY, maxY);

  let bestChar = "";
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const template of ARIAL_BOLD_TEMPLATES) {
    let distance = 0;
    for (let i = 0; i < normalizedBits.length; i += 1) {
      if (normalizedBits[i] !== template.bits[i]) {
        distance += 1;
      }
    }

    if (distance < bestDistance) {
      bestDistance = distance;
      bestChar = template.char;
    }
  }

  // Reject if too far from all templates
  return bestDistance <= 8 ? bestChar : "";
}

function readInventoryCountLine(mask: Uint8Array, origWidth: number, origHeight: number, bandY0: number, bandY1: number): string {
  const scaledWidth = origWidth * OCR_SCALE_FACTOR;
  const scaledHeight = origHeight * OCR_SCALE_FACTOR;
  const y0 = Math.max(0, bandY0 - 2);
  const y1 = Math.min(scaledHeight - 1, bandY1 + 2);

  // Find column segments
  const rawSegments: Array<{ startX: number; endX: number }> = [];
  let segStart = -1;

  for (let x = 0; x < scaledWidth; x += 1) {
    let colCount = 0;
    for (let y = y0; y <= y1; y += 1) {
      colCount += mask[y * scaledWidth + x] ?? 0;
    }

    if (colCount > 0) {
      if (segStart < 0) {
        segStart = x;
      }
      continue;
    }

    if (segStart >= 0) {
      rawSegments.push({ startX: segStart, endX: x - 1 });
      segStart = -1;
    }
  }

  if (segStart >= 0) {
    rawSegments.push({ startX: segStart, endX: scaledWidth - 1 });
  }

  // Merge segments that are very close (anti-aliasing gaps within a single glyph)
  const maxMergeGap = Math.max(1, Math.floor(OCR_SCALE_FACTOR / 2));
  const merged: Array<{ startX: number; endX: number }> = [];
  let current = rawSegments[0];

  for (let i = 1; i < rawSegments.length; i += 1) {
    const next = rawSegments[i];
    if (next.startX - current.endX - 1 <= maxMergeGap) {
      current = { startX: current.startX, endX: next.endX };
    } else {
      merged.push(current);
      current = next;
    }
  }

  if (current) {
    merged.push(current);
  }

  let output = "";
  for (const seg of merged) {
    const glyph = classifyInventoryCountDigit(mask, scaledWidth, y0, y1, seg.startX, seg.endX);
    output += glyph;
  }

  return output;
}

export function detectInventoryCount(bitmap: RobotBitmap): InventoryCountResult {
  const ratioSearchX0 = Math.round(bitmap.width * SEARCH_LEFT_RATIO);
  const ratioSearchY0 = Math.round(bitmap.height * SEARCH_TOP_RATIO);
  const minWidthSearchX0 = bitmap.width - MIN_BOTTOM_RIGHT_SEARCH_WIDTH;
  const minHeightSearchY0 = bitmap.height - MIN_BOTTOM_RIGHT_SEARCH_HEIGHT;
  const searchX0 = clamp(Math.min(ratioSearchX0, minWidthSearchX0), 0, bitmap.width - 1);
  const searchY0 = clamp(Math.min(ratioSearchY0, minHeightSearchY0), 0, bitmap.height - 1);
  const searchX1 = clamp(Math.round(bitmap.width * SEARCH_RIGHT_RATIO) - 1, searchX0, bitmap.width - 1);
  const searchY1 = clamp(Math.round(bitmap.height * SEARCH_BOTTOM_RATIO), searchY0, bitmap.height - 1);
  const searchRoi: Roi = {
    x: searchX0,
    y: searchY0,
    width: searchX1 - searchX0 + 1,
    height: searchY1 - searchY0 + 1,
  };

  const cropped = cropBitmap(bitmap, searchRoi);
  const bands = findTextBands(cropped);
  const band = pickBestBand(bands);

  if (!band) {
    return { count: null, rawText: null, searchRoi };
  }

  const mask = buildWhitePixelMask(cropped);

  const rawText = readInventoryCountLine(mask, cropped.width, cropped.height, band.startY * OCR_SCALE_FACTOR, band.endY * OCR_SCALE_FACTOR);

  if (!rawText || rawText.length === 0) {
    return { count: null, rawText: null, searchRoi };
  }

  const parsed = Number(rawText);
  const count = Number.isFinite(parsed) && parsed >= 0 && parsed <= 28 ? parsed : null;

  return { count, rawText, searchRoi };
}

// ============================================
// Debug / save utilities
// ============================================

export function saveBitmapWithInventoryCountDebug(bitmap: RobotBitmap, result: InventoryCountResult, outputPath: string): void {
  const png = new PNG({ width: bitmap.width, height: bitmap.height });

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const srcOffset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const dstOffset = (y * bitmap.width + x) * 4;

      png.data[dstOffset] = bitmap.image[srcOffset + 2]; // R
      png.data[dstOffset + 1] = bitmap.image[srcOffset + 1]; // G
      png.data[dstOffset + 2] = bitmap.image[srcOffset]; // B
      png.data[dstOffset + 3] = 255;
    }
  }

  // Draw search region rectangle in yellow
  const roi = result.searchRoi;

  function drawHLine(y: number, x0: number, x1: number, r: number, g: number, b: number): void {
    for (let x = x0; x <= x1; x += 1) {
      if (x >= 0 && x < bitmap.width && y >= 0 && y < bitmap.height) {
        const idx = (y * bitmap.width + x) * 4;
        png.data[idx] = r;
        png.data[idx + 1] = g;
        png.data[idx + 2] = b;
        png.data[idx + 3] = 255;
      }
    }
  }

  function drawVLine(x: number, y0: number, y1: number, r: number, g: number, b: number): void {
    for (let y = y0; y <= y1; y += 1) {
      if (x >= 0 && x < bitmap.width && y >= 0 && y < bitmap.height) {
        const idx = (y * bitmap.width + x) * 4;
        png.data[idx] = r;
        png.data[idx + 1] = g;
        png.data[idx + 2] = b;
        png.data[idx + 3] = 255;
      }
    }
  }

  drawHLine(roi.y, roi.x, roi.x + roi.width - 1, 255, 255, 0);
  drawHLine(roi.y + roi.height - 1, roi.x, roi.x + roi.width - 1, 255, 255, 0);
  drawVLine(roi.x, roi.y, roi.y + roi.height - 1, 255, 255, 0);
  drawVLine(roi.x + roi.width - 1, roi.y, roi.y + roi.height - 1, 255, 255, 0);

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  png.pack().pipe(fs.createWriteStream(outputPath));
}
