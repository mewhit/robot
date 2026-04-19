/**
 * OCR Engine for reading tile coordinates from RuneLite screenshot overlay
 *
 * Pipeline:
 * 1. Capture bitmap from screen
 * 2. Convert to grayscale
 * 3. Apply binary threshold
 * 4. Upscale image (4x) for better OCR accuracy
 * 5. Find text bands
 * 6. Segment individual characters
 * 7. Classify glyphs using template matching
 * 8. Extract tile coordinates in format: X,Y,Z
 */

import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import * as robotModule from "robotjs";
import { saveBitmap } from "./save-bitmap";

const DEFAULT_OCR_DEBUG_DIR = "./ocr-debug";

// ============================================
// Types
// ============================================

export type RobotBitmap = {
  width: number;
  height: number;
  byteWidth: number;
  bytesPerPixel: number;
  image: Buffer;
};

export type TileCoordinate = {
  x: number;
  y: number;
  z: number;
};

export type TileReadResult = {
  tile: TileCoordinate | null;
  rawLine: string | null;
};

export type GameStatsReadResult = {
  stats: GameStats;
  rawLines: string[];
};

// ============================================
// Configuration Constants
// ============================================

/** Upscaling factor for image preprocessing (6x provides better digit recognition) */
export const OCR_SCALE_FACTOR = 6;

/** Binary threshold value (0-255); pixels >= threshold become 1, else 0 */
export const OCR_THRESHOLD = 180;

/** Regex to filter allowed characters in OCR output (digits and commas only) */
export const ALLOWED_OCR_CHARS = /[0-9,]/;

/** Glyph matching tolerance (max distance before rejecting a match) - increased for better number detection accuracy */
export const GLYPH_MATCH_TOLERANCE = 20;

// ============================================
// Debug Screenshot Export
// ============================================

/**
 * Save binary/mask image as PNG for debugging text detection
 * Converts binary array (0 or 1) to grayscale PNG
 * @param mask - Binary or grayscale array
 * @param width - Image width
 * @param height - Image height
 * @param filename - Output PNG filename
 * @param scale - Pixel scale factor (1 = normal, 4 = 4x size) for visualization
 */
export function saveMask(mask: Uint8Array, width: number, height: number, filename: string, scale: number = 1): void {
  let maxValue = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] > maxValue) {
      maxValue = mask[i];
    }
  }
  const isBinaryMask = maxValue <= 1;

  const png = new PNG({
    width: width * scale,
    height: height * scale,
  });

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const val = mask[y * width + x];
      // Convert binary masks to full white for visibility; keep grayscale masks unchanged.
      const pixel = isBinaryMask ? (val > 0 ? 255 : 0) : val;

      // Replicate pixel according to scale factor
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const ny = y * scale + dy;
          const nx = x * scale + dx;
          const idx = (ny * (width * scale) + nx) * 4;

          png.data[idx] = pixel;
          png.data[idx + 1] = pixel;
          png.data[idx + 2] = pixel;
          png.data[idx + 3] = 255;
        }
      }
    }
  }

  png.pack().pipe(fs.createWriteStream(filename));
}

/**
 * Debug helper: Save all OCR preprocessing stages to files
 * Useful for troubleshooting OCR accuracy issues
 * Saves: original → grayscale → binary → upscaled
 *
 * @param bitmap - Original captured bitmap
 * @param outputDir - Directory to save debug images (default: "./ocr-debug")
 */
export function debugSaveAllStages(bitmap: RobotBitmap, outputDir: string = "./ocr-debug"): void {
  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Stage 1: Original bitmap
  saveBitmap(bitmap, `${outputDir}/01_original.png`);

  // Stage 2: Grayscale
  const gray = bitmapToGrayscale(bitmap);
  saveMask(gray, bitmap.width, bitmap.height, `${outputDir}/02_grayscale.png`);

  // Stage 3: Binary threshold
  const threshold = computeDynamicThreshold(gray);
  const binary = applyBinaryThreshold(gray, bitmap.width, bitmap.height, threshold);
  saveMask(binary, bitmap.width, bitmap.height, `${outputDir}/03_binary.png`);

  // Stage 4: Upscaled
  const upscaled = upscaleImage(binary, bitmap.width, bitmap.height, OCR_SCALE_FACTOR);
  saveMask(upscaled, bitmap.width * OCR_SCALE_FACTOR, bitmap.height * OCR_SCALE_FACTOR, `${outputDir}/04_upscaled.png`, 1);
}

/**
 * Save OCR stage images next to a raw screenshot path using per-loop filenames.
 * Example raw path: ./ocr-debug/loop-000001-raw.png
 * Output files: loop-000001-01-original.png, -02-grayscale.png, -03-binary.png, -04-upscaled.png
 */
export function debugSaveAllStagesForRaw(bitmap: RobotBitmap, rawScreenshotPath: string): void {
  const parsed = path.parse(rawScreenshotPath);
  const outputDir = parsed.dir || ".";
  const baseName = parsed.name.endsWith("-raw") ? parsed.name.slice(0, -4) : parsed.name;

  fs.mkdirSync(outputDir, { recursive: true });

  const originalPath = path.join(outputDir, `${baseName}-01-original.png`);
  const grayscalePath = path.join(outputDir, `${baseName}-02-grayscale.png`);
  const binaryPath = path.join(outputDir, `${baseName}-03-binary.png`);
  const upscaledPath = path.join(outputDir, `${baseName}-04-upscaled.png`);

  saveBitmap(bitmap, originalPath);

  const gray = bitmapToGrayscale(bitmap);
  saveMask(gray, bitmap.width, bitmap.height, grayscalePath);

  const threshold = computeDynamicThreshold(gray);
  const binary = applyBinaryThreshold(gray, bitmap.width, bitmap.height, threshold);
  saveMask(binary, bitmap.width, bitmap.height, binaryPath);

  const upscaled = upscaleImage(binary, bitmap.width, bitmap.height, OCR_SCALE_FACTOR);
  saveMask(upscaled, bitmap.width * OCR_SCALE_FACTOR, bitmap.height * OCR_SCALE_FACTOR, upscaledPath, 1);
}

export function flushOcrDebugDirectory(outputDir: string = DEFAULT_OCR_DEBUG_DIR): void {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
}

// ============================================
// Segment Debug Log (populated during OCR, cleared per read)
// ============================================

export type SegmentDebugEntry = {
  x0: number;
  x1: number;
  glyphWidth: number;
  glyphHeight: number;
  bits: string; // 5-char rows joined by "|"
  bestChar: string;
  bestDistance: number;
};

export let lastSegmentDebugLog: SegmentDebugEntry[] = [];

export function clearSegmentDebugLog(): void {
  lastSegmentDebugLog = [];
}

// ============================================
// Character Templates for Template Matching
// ============================================

const DIGIT_TEMPLATE_ROWS: Record<string, string[]> = {
  // Actual RuneLite font patterns observed from segment debug (6× scale, 5×7 template):
  "0": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["01110", "10001", "00001", "01111", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  ",": ["00000", "00000", "00000", "00000", "00000", "00110", "00100"],
};

const DIGIT_TEMPLATES = Object.entries(DIGIT_TEMPLATE_ROWS).map(([char, rows]) => ({
  char,
  bits: templateRowsToBits(rows),
}));

// RuneLite anti-aliased glyphs can collapse into alternate silhouettes after thresholding.
// Add targeted variants so the classifier can disambiguate common 4/6 confusions.
DIGIT_TEMPLATES.push(
  {
    char: "4",
    bits: templateRowsToBits(["10000", "10000", "10000", "10110", "10110", "11111", "00110"]),
  },
  {
    char: "6",
    bits: templateRowsToBits(["01110", "10000", "10000", "11110", "10001", "10001", "01110"]),
  },
);

// ============================================
// Image Processing Functions
// ============================================

/**
 * Convert template row strings to bit array for comparison
 * @param rows - Array of strings with "0" and "1" characters
 * @returns Flattened array of bits
 */
function templateRowsToBits(rows: string[]): number[] {
  const bits: number[] = [];
  for (const row of rows) {
    for (const char of row) {
      bits.push(char === "1" ? 1 : 0);
    }
  }
  return bits;
}

/**
 * Convert RGB bitmap to grayscale using standard luminosity formula
 * @param bitmap - RGB24 or RGBA32 bitmap from screen capture
 * @returns Grayscale array (0-255)
 */
function bitmapToGrayscale(bitmap: RobotBitmap): Uint8Array {
  const gray = new Uint8Array(bitmap.width * bitmap.height);
  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      const grayVal = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      gray[y * bitmap.width + x] = grayVal;
    }
  }
  return gray;
}

/**
 * Compute dynamic threshold based on max local brightness
 * Keeps only the brightest pixels (~top 10-15%), which correspond to text
 * @param gray - Grayscale array (0-255)
 * @returns Dynamic threshold value (max pixel - 30)
 */
function computeDynamicThreshold(gray: Uint8Array): number {
  let max = 0;

  for (let i = 0; i < gray.length; i++) {
    if (gray[i] > max) max = gray[i];
  }

  return max - 30;
}

/**
 * Apply binary threshold to convert grayscale to black/white
 * Strong thresholding (binaire fort) isolates text from background
 * @param gray - Grayscale array (0-255)
 * @param width - Image width
 * @param height - Image height
 * @param threshold - Threshold value; pixels >= threshold become 1
 * @returns Binary array (0 or 1)
 */
function applyBinaryThreshold(gray: Uint8Array, width: number, height: number, threshold: number): Uint8Array {
  const binary = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i += 1) {
    binary[i] = gray[i] >= threshold ? 1 : 0;
  }
  return binary;
}

/**
 * Upscale binary image by nearest-neighbor
 * Improves OCR accuracy by providing larger glyph area for template matching
 * @param binary - Binary array (0 or 1)
 * @param width - Original width
 * @param height - Original height
 * @param scale - Upscaling factor (e.g., 4 for 4x zoom)
 * @returns Upscaled binary array
 */
function upscaleImage(binary: Uint8Array, width: number, height: number, scale: number): Uint8Array {
  const newWidth = width * scale;
  const newHeight = height * scale;
  const upscaled = new Uint8Array(newWidth * newHeight);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const val = binary[y * width + x];
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const ny = y * scale + dy;
          const nx = x * scale + dx;
          upscaled[ny * newWidth + nx] = val;
        }
      }
    }
  }

  return upscaled;
}

/**
 * Find the leftmost and rightmost columns containing white pixels
 * Dynamically detects text boundaries regardless of overlay size
 * @param mask - Upscaled binary mask (1 = text, 0 = background)
 * @param width - Mask width (upscaled)
 * @param height - Mask height (upscaled)
 * @returns Object with minX and maxX (inclusive bounds), or null if no text found
 */
function findTextBounds(mask: Uint8Array, width: number, height: number): { minX: number; maxX: number } | null {
  let minX = width;
  let maxX = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }

  return maxX >= 0 ? { minX, maxX } : null;
}

/**
 * Calculate optimal scan start position (x-ratio) based on detected text bounds
 * Skips left padding and starts from where text actually begins
 * @param mask - Upscaled binary mask
 * @param maskWidth - Upscaled mask width
 * @param maskHeight - Upscaled mask height
 * @returns startXRatio to use for scanning (0.0-1.0), or null if no text found
 */
function calculateOptimalStartXRatio(mask: Uint8Array, maskWidth: number, maskHeight: number): number | null {
  const bounds = findTextBounds(mask, maskWidth, maskHeight);
  if (!bounds) {
    return null;
  }

  // Start from just before the detected text to ensure we capture the beginning
  const safeMargin = Math.max(0, bounds.minX - 10);
  return Math.max(0, safeMargin / maskWidth);
}

/**
 * Build white text mask from bitmap
 * Complete preprocessing pipeline: grayscale → dynamic threshold → upscale
 * Uses dynamic threshold based on max brightness to isolate text pixels
 * @param bitmap - RGB bitmap from screen capture
 * @returns Binary mask (1 = text, 0 = background)
 */
export function buildWhiteTextMask(bitmap: RobotBitmap): Uint8Array {
  const gray = bitmapToGrayscale(bitmap);
  const threshold = computeDynamicThreshold(gray);
  const binary = applyBinaryThreshold(gray, bitmap.width, bitmap.height, threshold);

  return upscaleImage(binary, bitmap.width, bitmap.height, OCR_SCALE_FACTOR);
}
// ============================================
// Text Band Detection
// ============================================

/**
 * Find horizontal bands in mask where text appears
 * @param mask - Binary mask (1 = text, 0 = background)
 * @param origWidth - Original bitmap width
 * @param origHeight - Original bitmap height
 * @returns Array of y-ranges containing text
 */
function findTextBands(mask: Uint8Array, origWidth: number, origHeight: number): Array<{ startY: number; endY: number }> {
  const width = origWidth * OCR_SCALE_FACTOR;
  const height = origHeight * OCR_SCALE_FACTOR;
  const rowThreshold = Math.max(4, Math.floor(width * 0.018));
  const bands: Array<{ startY: number; endY: number }> = [];
  let activeStart = -1;

  for (let y = 0; y < height; y += 1) {
    let rowCount = 0;
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      rowCount += mask[rowOffset + x];
    }

    if (rowCount >= rowThreshold) {
      if (activeStart < 0) {
        activeStart = y;
      }
      continue;
    }

    if (activeStart >= 0) {
      const endY = y - 1;
      if (endY - activeStart + 1 >= 3) {
        bands.push({ startY: activeStart, endY });
      }
      activeStart = -1;
    }
  }

  if (activeStart >= 0) {
    const endY = height - 1;
    if (endY - activeStart + 1 >= 3) {
      bands.push({ startY: activeStart, endY });
    }
  }

  return bands;
}

/**
 * Split tall bands into overlapping windows to isolate individual text lines
 * without clipping glyphs at slice boundaries
 * @param bands - Text bands from findTextBands
 * @returns Expanded array of bands with slices for tall regions
 */
function splitTallBands(bands: Array<{ startY: number; endY: number }>): Array<{ startY: number; endY: number }> {
  const expanded: Array<{ startY: number; endY: number }> = [];
  for (const band of bands) {
    expanded.push(band);

    const height = band.endY - band.startY + 1;
    if (height <= 16) {
      continue;
    }

    const sliceHeight = 12;
    const stride = 6;
    for (let y = band.startY; y <= band.endY; y += stride) {
      expanded.push({
        startY: y,
        endY: Math.min(band.endY, y + sliceHeight - 1),
      });

      if (y + sliceHeight - 1 >= band.endY) {
        break;
      }
    }
  }

  return expanded;
}

// ============================================
// Character Segmentation & Classification
// ============================================

/**
 * Segment connected components (individual glyph regions) in a horizontal band
 * Merges close gaps to keep ligatures together
 * @param mask - Binary mask
 * @param origWidth - Original bitmap width
 * @param origHeight - Original bitmap height
 * @param startY - Band start y (in upscaled mask coordinates)
 * @param endY - Band end y (in upscaled mask coordinates)
 * @param startXRatio - Start scanning from this fraction of image width (0-1)
 * @param strictMode - Use strict glyph matching tolerance
 * @returns String of recognized digits and commas
 */
export function readNumericLine(
  mask: Uint8Array,
  origWidth: number,
  origHeight: number,
  startY: number,
  endY: number,
  startXRatio: number,
  strictMode: boolean = false,
  maxMergeGap: number = Math.max(1, Math.floor(OCR_SCALE_FACTOR / 2)),
): string {
  const width = origWidth * OCR_SCALE_FACTOR;
  const height = origHeight * OCR_SCALE_FACTOR;
  const y0 = Math.max(0, startY - 2);
  const y1 = Math.min(height - 1, endY + 2);
  const x0 = Math.max(0, Math.floor(width * startXRatio));
  const x1 = width - 1;
  const segments: Array<{ startX: number; endX: number }> = [];
  let segmentStart = -1;

  for (let x = x0; x <= x1; x += 1) {
    let colCount = 0;
    for (let y = y0; y <= y1; y += 1) {
      colCount += mask[y * width + x];
    }

    if (colCount > 0) {
      if (segmentStart < 0) {
        segmentStart = x;
      }
      continue;
    }

    if (segmentStart >= 0) {
      segments.push({ startX: segmentStart, endX: x - 1 });
      segmentStart = -1;
    }
  }

  if (segmentStart >= 0) {
    segments.push({ startX: segmentStart, endX: x1 });
  }

  const mergedSegments = mergeCloseSegments(segments, Math.max(0, Math.floor(maxMergeGap)));
  let output = "";
  for (const segment of mergedSegments) {
    const char = classifySegment(mask, width, y0, y1, segment.startX, segment.endX, strictMode);
    if (char && ALLOWED_OCR_CHARS.test(char)) {
      output += char;
    }
  }

  return output;
}

/**
 * Merge closely-spaced segments (handles kerning in fonts)
 * @param segments - Segments from column analysis
 * @param maxGap - Maximum gap (in pixels) to merge
 * @returns Merged segments
 */
function mergeCloseSegments(segments: Array<{ startX: number; endX: number }>, maxGap: number): Array<{ startX: number; endX: number }> {
  if (segments.length === 0) {
    return [];
  }

  const merged: Array<{ startX: number; endX: number }> = [];
  let current = { ...segments[0] };

  for (let i = 1; i < segments.length; i += 1) {
    const next = segments[i];
    const gap = next.startX - current.endX - 1;
    if (gap <= maxGap) {
      current.endX = next.endX;
    } else {
      merged.push(current);
      current = { ...next };
    }
  }

  merged.push(current);
  return merged;
}

/**
 * Normalize glyph bounds and scale to template size for comparison
 * @param mask - Binary mask
 * @param width - Mask width
 * @param x0 - Glyph left edge
 * @param x1 - Glyph right edge
 * @param y0 - Glyph top edge
 * @param y1 - Glyph bottom edge
 * @param targetWidth - Normalize to this width
 * @param targetHeight - Normalize to this height
 * @returns Normalized bit array
 */
function normalizeGlyph(
  mask: Uint8Array,
  width: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  targetWidth: number,
  targetHeight: number,
): number[] {
  const sourceWidth = x1 - x0 + 1;
  const sourceHeight = y1 - y0 + 1;
  const bits: number[] = [];

  for (let ty = 0; ty < targetHeight; ty += 1) {
    const syStart = y0 + Math.floor((ty * sourceHeight) / targetHeight);
    const syEndExclusive = y0 + Math.ceil(((ty + 1) * sourceHeight) / targetHeight);

    for (let tx = 0; tx < targetWidth; tx += 1) {
      const sxStart = x0 + Math.floor((tx * sourceWidth) / targetWidth);
      const sxEndExclusive = x0 + Math.ceil(((tx + 1) * sourceWidth) / targetWidth);

      let area = 0;
      let white = 0;

      for (let sy = syStart; sy < syEndExclusive; sy += 1) {
        for (let sx = sxStart; sx < sxEndExclusive; sx += 1) {
          area += 1;
          white += mask[sy * width + sx];
        }
      }

      const density = area > 0 ? white / area : 0;
      bits.push(density >= 0.3 ? 1 : 0);
    }
  }

  return bits;
}

/**
 * Classify a segment as a digit or comma using template matching
 * @param mask - Binary mask
 * @param width - Mask width
 * @param y0 - Search region top
 * @param y1 - Search region bottom
 * @param x0 - Segment left edge
 * @param x1 - Segment right edge
 * @param strictMode - If true, use strict tolerance (GLYPH_MATCH_TOLERANCE); if false, use relaxed tolerance (25)
 * @returns Recognized character ("0"-"9" or ",") or empty string for noise
 */
function classifySegment(
  mask: Uint8Array,
  width: number,
  y0: number,
  y1: number,
  x0: number,
  x1: number,
  strictMode: boolean = false,
): string {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let whiteCount = 0;

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (mask[y * width + x] === 1) {
        whiteCount += 1;
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (whiteCount < 2 || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return "";
  }

  const glyphWidth = x1 - x0 + 1;
  const glyphHeight = maxY - minY + 1;
  // Comma is ~2 source px wide × 3 source px tall; threshold must be in upscaled coords
  if (glyphWidth <= OCR_SCALE_FACTOR * 2 && glyphHeight <= OCR_SCALE_FACTOR * 4) {
    return ",";
  }

  const normalizedBits = normalizeGlyph(mask, width, x0, x1, minY, maxY, 5, 7);
  let bestChar = "";
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const template of DIGIT_TEMPLATES) {
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

  // Record debug entry so callers can inspect what was seen
  const rows: string[] = [];
  for (let row = 0; row < 7; row++) {
    rows.push(normalizedBits.slice(row * 5, row * 5 + 5).join(""));
  }
  lastSegmentDebugLog.push({
    x0,
    x1,
    glyphWidth: x1 - x0 + 1,
    glyphHeight: maxY - minY + 1,
    bits: rows.join("|"),
    bestChar,
    bestDistance,
  });

  // Use configurable tolerance - relaxed in normal mode for better number detection
  const tolerance = strictMode ? GLYPH_MATCH_TOLERANCE : 25;

  // Reject weak matches to avoid random UI noise becoming fake coordinates
  if (bestDistance > tolerance) {
    return "";
  }

  return bestChar;
}

// ============================================
// Tile Coordinate Extraction
// ============================================

/**
 * Extract tile coordinates from a numeric line
 * Expected format: "X,Y,Z" where X,Y are 3-5 digit coordinates, Z is 0-3
 * @param line - Recognized text line
 * @returns Tile object with validity score, or null if invalid
 */
function extractTileCandidate(line: string): { tile: TileCoordinate; score: number } | null {
  const match = line.match(/(\d{3,5}),(\d{3,5}),(\d{1,2})/);
  if (!match) {
    return null;
  }

  const x = Number(match[1]);
  const y = Number(match[2]);
  const z = Number(match[3]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }

  let score = 0;
  if (x >= 2500 && x <= 4000) {
    score += 4;
  }
  if (y >= 2500 && y <= 4000) {
    score += 4;
  }
  if (z >= 0 && z <= 3) {
    score += 3;
  }
  if (match[1].length === 4 || match[1].length === 5) {
    score += 1;
  }
  if (match[2].length === 4 || match[2].length === 5) {
    score += 1;
  }

  if (score < 9) {
    return null;
  }

  return {
    tile: { x, y, z },
    score,
  };
}

/**
 * Fallback parser when OCR misses comma glyphs.
 * Tries plausible splits for X,Y,Z directly from digits.
 */
function extractTileCandidateFromDigitsOnly(digitsOnly: string): { tile: TileCoordinate; score: number } | null {
  if (!/^\d+$/.test(digitsOnly)) {
    return null;
  }

  let best: { tile: TileCoordinate; score: number } | null = null;

  const minTileDigits = 7;
  const maxTileDigits = 12;

  for (let start = 0; start < digitsOnly.length; start += 1) {
    for (let totalLen = minTileDigits; totalLen <= maxTileDigits; totalLen += 1) {
      if (start + totalLen > digitsOnly.length) {
        continue;
      }

      const candidateDigits = digitsOnly.slice(start, start + totalLen);

      for (let xLen = 3; xLen <= 5; xLen += 1) {
        for (let yLen = 3; yLen <= 5; yLen += 1) {
          for (let zLen = 1; zLen <= 2; zLen += 1) {
            if (xLen + yLen + zLen !== candidateDigits.length) {
              continue;
            }

            const x = Number(candidateDigits.slice(0, xLen));
            const y = Number(candidateDigits.slice(xLen, xLen + yLen));
            const z = Number(candidateDigits.slice(xLen + yLen));
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
              continue;
            }

            let score = 0;
            if (x >= 2500 && x <= 4000) {
              score += 4;
            }
            if (y >= 2500 && y <= 4000) {
              score += 4;
            }
            if (z >= 0 && z <= 3) {
              score += 3;
            }
            if (xLen === 4 || xLen === 5) {
              score += 1;
            }
            if (yLen === 4 || yLen === 5) {
              score += 1;
            }

            if (score < 9) {
              continue;
            }

            const candidate = { tile: { x, y, z }, score };
            if (!best || candidate.score > best.score) {
              best = candidate;
            }
          }
        }
      }
    }
  }

  return best;
}

// ============================================
// Game Stats Extraction
// ============================================

export type GameStats = {
  totalLaps: number | null;
  lapsUntilGoal: number | null;
  rawStats: Record<string, string>;
};

/**
 * Extract a single integer value from text
 * Handles leading/trailing whitespace and invalid formats
 * @param text - Text containing the number
 * @returns Parsed integer or null if invalid
 */
function extractIntFromText(text: string): number | null {
  const match = text.match(/(\d+)/);
  if (!match) {
    return null;
  }
  const num = Number(match[1]);
  return Number.isFinite(num) ? num : null;
}

/**
 * Extract game stats (laps, goals, etc.) from multiple text bands
 * Scans all bands for lines containing stat keywords, extracts numbers
 * @param mask - Binary mask
 * @param origWidth - Original bitmap width
 * @param origHeight - Original bitmap height
 * @returns Game stats with tap counts and raw text
 */
function extractGameStats(mask: Uint8Array, origWidth: number, origHeight: number): GameStats {
  const whiteMask = mask;
  const baseBands = findTextBands(whiteMask, origWidth, origHeight);
  const bands = splitTallBands(baseBands);
  const rawStats: Record<string, string> = {};
  let totalLaps: number | null = null;
  let lapsUntilGoal: number | null = null;

  // Scan all bands for stat lines (typically lines that don't start with digits)
  for (const band of bands) {
    // Scan from left edge (0.0) and also mid-image for stats that appear on right side
    const scanRatios = [0.0, 0.2, 0.4, 0.6];

    for (const startRatio of scanRatios) {
      const line = readNumericLine(whiteMask, origWidth, origHeight, band.startY, band.endY, startRatio);
      if (!line || line.length < 2) {
        continue;
      }

      // Look for lines with letters (e.g., "Total", "Laps", "goal")
      if (/[a-zA-Z]/.test(line)) {
        rawStats[line] = line;

        // Extract total laps (format: "Total Laps: 1" or similar)
        if (line.toLowerCase().includes("total") && line.toLowerCase().includes("lap")) {
          const num = extractIntFromText(line);
          if (num !== null && num >= 0 && num <= 999) {
            totalLaps = num;
          }
        }

        // Extract laps until goal
        if (line.toLowerCase().includes("goal")) {
          const num = extractIntFromText(line);
          if (num !== null && num >= 0 && num <= 999) {
            lapsUntilGoal = num;
          }
        }
      }
    }
  }

  return {
    totalLaps,
    lapsUntilGoal,
    rawStats,
  };
}

// ============================================
// Main OCR Entry Point
// ============================================

/**
 * Read tile coordinate from top-left screen overlay
 * Scans multiple bands and start positions to find best match
 * @param bounds - Screen capture bounds
 * @param robotScreen - Robot screen API
 * @param overlayWidthRatio - Width as fraction of game window
 * @param overlayHeightRatio - Height as fraction of game window
 * @returns Tile coordinate and raw OCR text
 */
export function readTileCoordinateFromOverlay(
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  },
  robotScreen: (typeof robotModule)["screen"],
  debugRawScreenshotPath: string | null = null,
): TileReadResult {
  // Capture only the Tile row overlay (top-left of the RuneLite window)
  const overlayX = bounds.x;
  const overlayY = bounds.y;
  const overlayWidth = bounds.width * 0.15;
  const overlayHeight = bounds.height * 0.15;

  const bitmap = robotScreen.capture(overlayX, overlayY, overlayWidth, overlayHeight);

  if (debugRawScreenshotPath) {
    saveBitmap(bitmap, debugRawScreenshotPath);
    debugSaveAllStagesForRaw(bitmap, debugRawScreenshotPath);
  }

  // 🧠 PREPROCESS
  const mask = buildWhiteTextMask(bitmap);

  // 🧠 FIND TEXT LINES
  const baseBands = findTextBands(mask, bitmap.width, bitmap.height).sort((a, b) => a.startY - b.startY);
  const bands = splitTallBands(baseBands).sort((a, b) => a.startY - b.startY);

  let best: TileCoordinate | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let raw: string | null = null;

  // Dynamically calculate optimal starting position based on detected text bounds
  const maskWidth = bitmap.width * OCR_SCALE_FACTOR;
  const maskHeight = bitmap.height * OCR_SCALE_FACTOR;
  const textBounds = findTextBounds(mask, maskWidth, maskHeight);
  const optimalStartRatio = textBounds !== null ? Math.max(0, (textBounds.minX - 10) / maskWidth) : null;
  const scanRatios = optimalStartRatio !== null ? [optimalStartRatio] : [0.08, 0.12, 0.16, 0.2];

  // Save cropped mask PNG for debugging
  if (debugRawScreenshotPath && textBounds) {
    const cropStartX = Math.max(0, textBounds.minX - 10);
    const cropEndX = Math.min(maskWidth - 1, textBounds.maxX + 10);
    const cropWidth = cropEndX - cropStartX + 1;
    const croppedMask = new Uint8Array(cropWidth * maskHeight);
    for (let y = 0; y < maskHeight; y++) {
      for (let x = cropStartX; x <= cropEndX; x++) {
        croppedMask[y * cropWidth + (x - cropStartX)] = mask[y * maskWidth + x];
      }
    }
    const croppedPath = debugRawScreenshotPath.replace("-raw.png", "-cropped.png");
    saveMask(croppedMask, cropWidth, maskHeight, croppedPath, 1);
  }

  for (const band of bands) {
    for (const startXRatio of scanRatios) {
      const line = readNumericLine(mask, bitmap.width, bitmap.height, band.startY, band.endY, startXRatio);
      if (!line) {
        continue;
      }

      if (raw === null) {
        raw = line;
      }

      const cleaned = line.replace(/[^0-9,]/g, "");
      if (cleaned.length < 7 || cleaned.length > 16) {
        continue;
      }

      const fromDelimited = extractTileCandidate(cleaned);
      const digitsOnly = cleaned.replace(/,/g, "");
      const fromDigitsOnly = extractTileCandidateFromDigitsOnly(digitsOnly);
      const candidate = fromDelimited ?? fromDigitsOnly;

      if (candidate && candidate.score > bestScore) {
        best = candidate.tile;
        bestScore = candidate.score;
        raw = cleaned;
      }
    }
  }

  return {
    tile: best,
    rawLine: raw,
  };
}
