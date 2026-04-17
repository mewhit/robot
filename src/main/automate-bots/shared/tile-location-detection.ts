import { saveBitmapWithBox } from "./coordinate-box-detector";
import { buildWhiteTextMask, OCR_SCALE_FACTOR, readNumericLine, RobotBitmap } from "./ocr-engine";

export type TileLocationBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  matchedLine: string;
};

type TileLocationCandidate = {
  x: number;
  y: number;
  z: number;
  line: string;
  score: number;
};

type TextBand = {
  startY: number;
  endY: number;
};

type MaskComponent = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixelCount: number;
};

type DetectionWithScore = TileLocationBox & {
  score: number;
};

const START_SCAN_RATIOS = [0, 0.05, 0.1, 0.15];
const MIN_ACCEPTABLE_SCORE = 10;
const BRIGHT_TEXT_LUMINANCE_MIN = 165;
const BRIGHT_TEXT_SATURATION_MAX = 80;
const ULTRA_BRIGHT_TEXT_LUMINANCE_MIN = 215;
const ULTRA_BRIGHT_TEXT_SATURATION_MAX = 130;
const GROUP_PAD_X = 16;
const GROUP_PAD_Y = 14;
const BOX_PAD_X = 8;
const BOX_PAD_Y = 10;
const FALLBACK_WINDOW_WIDTH = 120;
const FALLBACK_WINDOW_HEIGHT = 30;

function isBrightTooltipTextPixel(r: number, g: number, b: number): boolean {
  const maxChannel = Math.max(r, g, b);
  const minChannel = Math.min(r, g, b);
  const luminance = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

  return (
    (luminance >= BRIGHT_TEXT_LUMINANCE_MIN && maxChannel - minChannel <= BRIGHT_TEXT_SATURATION_MAX) ||
    (luminance >= ULTRA_BRIGHT_TEXT_LUMINANCE_MIN && maxChannel - minChannel <= ULTRA_BRIGHT_TEXT_SATURATION_MAX)
  );
}

function buildBrightTooltipTextMask(bitmap: RobotBitmap): Uint8Array {
  const mask = new Uint8Array(bitmap.width * bitmap.height);

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];

      if (!isBrightTooltipTextPixel(r, g, b)) {
        continue;
      }

      mask[y * bitmap.width + x] = 1;
    }
  }

  return mask;
}

function cropBitmap(bitmap: RobotBitmap, x: number, y: number, width: number, height: number): RobotBitmap {
  const cropped = {
    width,
    height,
    byteWidth: width * bitmap.bytesPerPixel,
    bytesPerPixel: bitmap.bytesPerPixel,
    image: Buffer.alloc(width * height * bitmap.bytesPerPixel),
  };

  for (let row = 0; row < height; row += 1) {
    const sourceStart = (y + row) * bitmap.byteWidth + x * bitmap.bytesPerPixel;
    const sourceEnd = sourceStart + width * bitmap.bytesPerPixel;
    const targetStart = row * cropped.byteWidth;
    bitmap.image.copy(cropped.image, targetStart, sourceStart, sourceEnd);
  }

  return cropped;
}

function cropBinaryMask(mask: Uint8Array, fullWidth: number, x: number, y: number, width: number, height: number): Uint8Array {
  const cropped = new Uint8Array(width * height);

  for (let row = 0; row < height; row += 1) {
    const sourceOffset = (y + row) * fullWidth + x;
    const targetOffset = row * width;
    cropped.set(mask.subarray(sourceOffset, sourceOffset + width), targetOffset);
  }

  return cropped;
}

function upscaleBinaryMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  const scaledWidth = width * OCR_SCALE_FACTOR;
  const scaledHeight = height * OCR_SCALE_FACTOR;
  const upscaled = new Uint8Array(scaledWidth * scaledHeight);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = mask[y * width + x];
      for (let dy = 0; dy < OCR_SCALE_FACTOR; dy += 1) {
        for (let dx = 0; dx < OCR_SCALE_FACTOR; dx += 1) {
          const scaledY = y * OCR_SCALE_FACTOR + dy;
          const scaledX = x * OCR_SCALE_FACTOR + dx;
          upscaled[scaledY * scaledWidth + scaledX] = value;
        }
      }
    }
  }

  return upscaled;
}

function findTextBands(mask: Uint8Array, scaledWidth: number, scaledHeight: number): TextBand[] {
  const rowThreshold = Math.max(2, Math.floor(scaledWidth * 0.01));
  const bands: TextBand[] = [];
  let activeStart = -1;

  for (let y = 0; y < scaledHeight; y += 1) {
    let rowCount = 0;
    const rowOffset = y * scaledWidth;

    for (let x = 0; x < scaledWidth; x += 1) {
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
      if (endY - activeStart + 1 >= 2) {
        bands.push({ startY: activeStart, endY });
      }
      activeStart = -1;
    }
  }

  if (activeStart >= 0) {
    bands.push({ startY: activeStart, endY: scaledHeight - 1 });
  }

  return bands;
}

function extractTileLocationCandidate(line: string): TileLocationCandidate | null {
  const cleaned = line.replace(/[^0-9,]/g, "");
  const matches = [...cleaned.matchAll(/(\d{3,5}),(\d{3,5}),(\d{1,2})/g)];

  let best: TileLocationCandidate | null = null;

  for (const match of matches) {
    const x = Number(match[1]);
    const y = Number(match[2]);
    const z = Number(match[3]);

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue;
    }

    let score = 0;
    if (x >= 2500 && x <= 4000) {
      score += 5;
    } else if (x >= 200 && x <= 4000) {
      score += 2;
    }

    if (y >= 2500 && y <= 4000) {
      score += 5;
    } else if (y >= 200 && y <= 8000) {
      score += 2;
    }

    if (z >= 0 && z <= 3) {
      score += 3;
    }

    if (match[1].length >= 4) {
      score += 1;
    }
    if (match[2].length >= 4) {
      score += 1;
    }

    score -= Math.max(0, cleaned.length - match[0].length);

    const candidate: TileLocationCandidate = {
      x,
      y,
      z,
      line: match[0],
      score,
    };

    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }

  return best;
}

function deriveBoxFromBand(
  upscaledMask: Uint8Array,
  cropX: number,
  cropY: number,
  cropWidth: number,
  cropHeight: number,
  band: TextBand,
  matchedLine: string,
  score: number,
): DetectionWithScore | null {
  const scaledWidth = cropWidth * OCR_SCALE_FACTOR;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let y = band.startY; y <= band.endY; y += 1) {
    const rowOffset = y * scaledWidth;

    for (let x = 0; x < scaledWidth; x += 1) {
      if (upscaledMask[rowOffset + x] === 0) {
        continue;
      }

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return null;
  }

  const paddedX0 = Math.max(0, minX - BOX_PAD_X * OCR_SCALE_FACTOR);
  const paddedY0 = Math.max(0, minY - BOX_PAD_Y * OCR_SCALE_FACTOR);
  const paddedX1 = Math.min(scaledWidth - 1, maxX + BOX_PAD_X * OCR_SCALE_FACTOR);
  const paddedY1 = Math.min(cropHeight * OCR_SCALE_FACTOR - 1, maxY + BOX_PAD_Y * OCR_SCALE_FACTOR);

  const x0 = cropX + Math.max(0, Math.floor(paddedX0 / OCR_SCALE_FACTOR));
  const y0 = cropY + Math.max(0, Math.floor(paddedY0 / OCR_SCALE_FACTOR));
  const x1 = cropX + Math.min(cropWidth - 1, Math.ceil((paddedX1 + 1) / OCR_SCALE_FACTOR) - 1);
  const y1 = cropY + Math.min(cropHeight - 1, Math.ceil((paddedY1 + 1) / OCR_SCALE_FACTOR) - 1);

  if (x1 < x0 || y1 < y0) {
    return null;
  }

  return {
    x: x0,
    y: y0,
    width: x1 - x0 + 1,
    height: y1 - y0 + 1,
    matchedLine,
    score,
  };
}

function detectBestInUpscaledMask(
  upscaledMask: Uint8Array,
  cropX: number,
  cropY: number,
  cropWidth: number,
  cropHeight: number,
): DetectionWithScore | null {
  const bands = findTextBands(upscaledMask, cropWidth * OCR_SCALE_FACTOR, cropHeight * OCR_SCALE_FACTOR);
  let best: DetectionWithScore | null = null;

  for (const band of bands) {
    for (const ratio of START_SCAN_RATIOS) {
      const line = readNumericLine(upscaledMask, cropWidth, cropHeight, band.startY, band.endY, ratio);
      if (!line) {
        continue;
      }

      const candidate = extractTileLocationCandidate(line);
      if (!candidate) {
        continue;
      }

      const detection = deriveBoxFromBand(upscaledMask, cropX, cropY, cropWidth, cropHeight, band, candidate.line, candidate.score);
      if (!detection) {
        continue;
      }

      if (!best || detection.score > best.score) {
        best = detection;
      }
    }
  }

  return best;
}

function detectBestInBinaryMask(
  mask: Uint8Array,
  cropX: number,
  cropY: number,
  cropWidth: number,
  cropHeight: number,
): DetectionWithScore | null {
  return detectBestInUpscaledMask(upscaleBinaryMask(mask, cropWidth, cropHeight), cropX, cropY, cropWidth, cropHeight);
}

function collectConnectedComponents(mask: Uint8Array, width: number, height: number): MaskComponent[] {
  const remaining = mask.slice();
  const components: MaskComponent[] = [];

  for (let startIndex = 0; startIndex < remaining.length; startIndex += 1) {
    if (!remaining[startIndex]) {
      continue;
    }

    const stack = [startIndex];
    remaining[startIndex] = 0;

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let pixelCount = 0;

    while (stack.length > 0) {
      const index = stack.pop();
      if (index === undefined) {
        break;
      }

      const x = index % width;
      const y = Math.floor(index / width);

      pixelCount += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }

          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
            continue;
          }

          const nextIndex = nextY * width + nextX;
          if (!remaining[nextIndex]) {
            continue;
          }

          remaining[nextIndex] = 0;
          stack.push(nextIndex);
        }
      }
    }

    components.push({
      minX,
      minY,
      maxX,
      maxY,
      pixelCount,
    });
  }

  return components;
}

function mergeNearbyComponents(components: MaskComponent[], gapX: number, gapY: number): MaskComponent[] {
  const pending = components.slice();
  const merged: MaskComponent[] = [];

  while (pending.length > 0) {
    let current = pending.pop();
    if (!current) {
      break;
    }

    let mergedOne = true;
    while (mergedOne) {
      mergedOne = false;

      for (let i = pending.length - 1; i >= 0; i -= 1) {
        const next = pending[i];
        const separated =
          current.maxX + gapX < next.minX ||
          next.maxX + gapX < current.minX ||
          current.maxY + gapY < next.minY ||
          next.maxY + gapY < current.minY;

        if (separated) {
          continue;
        }

        pending.splice(i, 1);
        current = {
          minX: Math.min(current.minX, next.minX),
          minY: Math.min(current.minY, next.minY),
          maxX: Math.max(current.maxX, next.maxX),
          maxY: Math.max(current.maxY, next.maxY),
          pixelCount: current.pixelCount + next.pixelCount,
        };
        mergedOne = true;
      }
    }

    merged.push(current);
  }

  return merged;
}

function detectFromMergedTextGroups(bitmap: RobotBitmap): DetectionWithScore | null {
  const brightMask = buildBrightTooltipTextMask(bitmap);
  const components = collectConnectedComponents(brightMask, bitmap.width, bitmap.height).filter((component) => {
    const width = component.maxX - component.minX + 1;
    const height = component.maxY - component.minY + 1;
    return component.pixelCount >= 4 && width <= 32 && height <= 20;
  });

  const groups = mergeNearbyComponents(components, 18, 10).filter((group) => {
    const width = group.maxX - group.minX + 1;
    const height = group.maxY - group.minY + 1;
    return group.pixelCount >= 25 && width >= 30 && width <= 180 && height >= 8 && height <= 40;
  });

  let best: DetectionWithScore | null = null;

  for (const group of groups) {
    if (group.minX < bitmap.width * 0.08 && group.minY < bitmap.height * 0.12) {
      continue;
    }

    const cropX = Math.max(0, group.minX - GROUP_PAD_X);
    const cropY = Math.max(0, group.minY - GROUP_PAD_Y);
    const cropX1 = Math.min(bitmap.width - 1, group.maxX + GROUP_PAD_X);
    const cropY1 = Math.min(bitmap.height - 1, group.maxY + GROUP_PAD_Y);
    const cropWidth = cropX1 - cropX + 1;
    const cropHeight = cropY1 - cropY + 1;

    const croppedMask = cropBinaryMask(brightMask, bitmap.width, cropX, cropY, cropWidth, cropHeight);
    const detection = detectBestInBinaryMask(croppedMask, cropX, cropY, cropWidth, cropHeight);
    if (!detection || detection.score < MIN_ACCEPTABLE_SCORE) {
      continue;
    }

    if (!best || detection.score > best.score) {
      best = detection;
    }
  }

  return best;
}

function detectWithSlidingWindowFallback(bitmap: RobotBitmap): DetectionWithScore | null {
  const strideX = Math.max(16, Math.floor(bitmap.width / 80));
  const strideY = Math.max(14, Math.floor(bitmap.height / 60));
  let best: DetectionWithScore | null = null;

  for (let cropY = 0; cropY <= bitmap.height - FALLBACK_WINDOW_HEIGHT; cropY += strideY) {
    for (let cropX = 0; cropX <= bitmap.width - FALLBACK_WINDOW_WIDTH; cropX += strideX) {
      if (cropX < bitmap.width * 0.08 && cropY < bitmap.height * 0.12) {
        continue;
      }

      const croppedBitmap = cropBitmap(bitmap, cropX, cropY, FALLBACK_WINDOW_WIDTH, FALLBACK_WINDOW_HEIGHT);
      const fallbackMask = buildWhiteTextMask(croppedBitmap);
      const detection = detectBestInUpscaledMask(fallbackMask, cropX, cropY, FALLBACK_WINDOW_WIDTH, FALLBACK_WINDOW_HEIGHT);
      if (!detection || detection.score < MIN_ACCEPTABLE_SCORE) {
        continue;
      }

      if (!best || detection.score > best.score) {
        best = detection;
      }
    }
  }

  return best;
}

export function detectTileLocationBoxInScreenshot(bitmap: RobotBitmap): TileLocationBox | null {
  const fastDetection = detectFromMergedTextGroups(bitmap);
  if (fastDetection) {
    const { score: _score, ...result } = fastDetection;
    return result;
  }

  const fallbackDetection = detectWithSlidingWindowFallback(bitmap);
  if (!fallbackDetection) {
    return null;
  }

  const { score: _score, ...result } = fallbackDetection;
  return result;
}

export function saveBitmapWithTileLocationBox(bitmap: RobotBitmap, box: TileLocationBox, filename: string): void {
  saveBitmapWithBox(bitmap, box, filename);
}
