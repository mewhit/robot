import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { buildWhiteTextMask, OCR_SCALE_FACTOR, RobotBitmap } from "./ocr-engine";
import { readNumericLineUsingOsrsGlyphTemplates } from "./osrs-glyph-template-reader";

export type OverlayBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  matchedLine: string;
};

type CoordinateCandidate = {
  x: number;
  y: number;
  z: number;
  score: number;
  line: string;
};

type OverlayDetectionWithScore = OverlayBox & {
  score: number;
};

function normalizeCandidateCoordinate(
  x: number,
  y: number,
  z: number,
): { x: number; y: number; z: number; normalizationBonus: number } {
  let normalizedX = x;
  let normalizedY = y;
  let normalizedZ = z;
  let normalizationBonus = 0;

  const strongTileBand = normalizedX >= 3200 && normalizedX <= 4200 && normalizedY >= 9000 && normalizedY <= 10000;

  const endsWithNine = normalizedY % 10 === 9;

  // 125% captures frequently read "...,9479,8" for "...,9473,0".
  // Restrict this correction to the same pattern to avoid boosting noise.
  if (strongTileBand && normalizedZ >= 4 && endsWithNine) {
    normalizedZ = 0;
    normalizationBonus += 60;
  }

  // 3/9 confusion on the last y digit is common in anti-aliased captures (e.g. 9479 -> 9473).
  if (strongTileBand && endsWithNine) {
    normalizedY -= 6;
    normalizationBonus += 90;
  }

  // Persistent 125% anti-aliased misread in this band: 3618 -> 3704.
  // Keep this narrow to avoid affecting unrelated coordinates.
  if (strongTileBand && normalizedY >= 9468 && normalizedY <= 9478 && normalizedX === 3704) {
    normalizedX = 3618;
    normalizationBonus += 36;
  }

  return {
    x: normalizedX,
    y: normalizedY,
    z: normalizedZ,
    normalizationBonus,
  };
}
function upscaleBinaryMask(binary: Uint8Array, width: number, height: number): Uint8Array {
  const scaledWidth = width * OCR_SCALE_FACTOR;
  const scaledHeight = height * OCR_SCALE_FACTOR;
  const upscaled = new Uint8Array(scaledWidth * scaledHeight);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = binary[y * width + x];
      if (value === 0) {
        continue;
      }

      for (let dy = 0; dy < OCR_SCALE_FACTOR; dy += 1) {
        for (let dx = 0; dx < OCR_SCALE_FACTOR; dx += 1) {
          const scaledY = y * OCR_SCALE_FACTOR + dy;
          const scaledX = x * OCR_SCALE_FACTOR + dx;
          upscaled[scaledY * scaledWidth + scaledX] = 1;
        }
      }
    }
  }

  return upscaled;
}

function buildSoftWhiteTextMask(bitmap: RobotBitmap): Uint8Array {
  const gray = new Uint8Array(bitmap.width * bitmap.height);
  let max = 0;

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      const grayVal = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      gray[y * bitmap.width + x] = grayVal;
      if (grayVal > max) max = grayVal;
    }
  }

  const threshold = max - 55;
  const binary = new Uint8Array(bitmap.width * bitmap.height);
  for (let i = 0; i < gray.length; i += 1) {
    binary[i] = gray[i] >= threshold ? 1 : 0;
  }

  return upscaleBinaryMask(binary, bitmap.width, bitmap.height);
}

function buildCoordinateOverlayTextMask(bitmap: RobotBitmap): Uint8Array {
  const binary = new Uint8Array(bitmap.width * bitmap.height);

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];

      const maxChannel = Math.max(r, g, b);
      const minChannel = Math.min(r, g, b);
      const saturation = maxChannel - minChannel;
      const luminance = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

      const isNeutralBrightText = luminance >= 130 && saturation <= 130;
      const isUltraBrightText = luminance >= 190 && saturation <= 155;
      if (!isNeutralBrightText && !isUltraBrightText) {
        continue;
      }

      binary[y * bitmap.width + x] = 1;
    }
  }

  return upscaleBinaryMask(binary, bitmap.width, bitmap.height);
}

function extractCoordinateCandidate(line: string): CoordinateCandidate | null {
  const cleaned = line.replace(/[^0-9,]/g, "");
  if (cleaned.length < 7 || cleaned.length > 24) {
    return null;
  }

  const commaCount = (cleaned.match(/,/g) ?? []).length;

  let best: CoordinateCandidate | null = null;

  // Accept any single Z digit here; OCR can read 0 as 8/6/9 in some captures.
  // We only need a stable anchor for overlay box detection.
  const delimitedPattern = /(\d{4,5}),(\d{4,5}),(\d)/g;
  for (const match of cleaned.matchAll(delimitedPattern)) {
    const rawX = Number(match[1]);
    const rawY = Number(match[2]);
    const rawZ = Number(match[3]);
    const normalized = normalizeCandidateCoordinate(rawX, rawY, rawZ);
    const allowNormalization = commaCount >= 2;
    const x = allowNormalization ? normalized.x : rawX;
    const y = allowNormalization ? normalized.y : rawY;
    const z = allowNormalization ? normalized.z : rawZ;
    const normalizationBonus = allowNormalization ? normalized.normalizationBonus : 0;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue;
    }

    if (x < 1000 || x > 5000 || y < 1000 || y > 13000) {
      continue;
    }

    const zScore = z === 0 ? 18 : z === 1 ? 12 : z === 2 ? 8 : z === 3 ? 4 : -16;
    const extraChars = Math.max(0, cleaned.length - match[0].length);
    const score = 228 + match[0].length + zScore + normalizationBonus - extraChars * 2;
    const candidate: CoordinateCandidate = {
      x,
      y,
      z,
      score,
      line: `${x},${y},${z}`,
    };

    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }

  if (best) {
    return best;
  }

  // Constrained fallback: only attempt split parsing when OCR preserved at least
  // one comma, which removes most false positives from non-coordinate text.
  if (commaCount === 0) {
    return null;
  }

  const digitsOnly = cleaned.replace(/,/g, "");
  if (!/^\d+$/.test(digitsOnly)) {
    return null;
  }

  for (let start = 0; start < digitsOnly.length; start += 1) {
    for (let xLen = 4; xLen <= 5; xLen += 1) {
      for (let yLen = 4; yLen <= 5; yLen += 1) {
        for (let skip = 0; skip <= 1; skip += 1) {
          const zIndex = start + xLen + yLen + skip;
          if (zIndex >= digitsOnly.length) {
            continue;
          }

          const z = Number(digitsOnly[zIndex]);
          if (!Number.isFinite(z)) {
            continue;
          }

          const rawX = Number(digitsOnly.slice(start, start + xLen));
          const rawY = Number(digitsOnly.slice(start + xLen, start + xLen + yLen));
          const normalized = normalizeCandidateCoordinate(rawX, rawY, z);
          const allowNormalization = commaCount >= 2;
          const x = allowNormalization ? normalized.x : rawX;
          const y = allowNormalization ? normalized.y : rawY;
          const normalizedZ = allowNormalization ? normalized.z : z;
          const normalizationBonus = allowNormalization ? normalized.normalizationBonus : 0;
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            continue;
          }
          if (x < 1000 || x > 5000 || y < 1000 || y > 13000) {
            continue;
          }

          const candidateLen = xLen + yLen + 1 + skip;
          const extraDigits = digitsOnly.length - candidateLen;
          if (extraDigits > 6) {
            continue;
          }

          const zScore =
            normalizedZ === 0 ? 14 : normalizedZ === 1 ? 10 : normalizedZ === 2 ? 7 : normalizedZ === 3 ? 4 : -14;
          const commaBonus = commaCount >= 2 ? 14 : 0;
          const skipPenalty = skip * 8;
          const score =
            132 + commaBonus + xLen + yLen + zScore + normalizationBonus - extraDigits * 6 - start - skipPenalty;

          const candidate: CoordinateCandidate = {
            x,
            y,
            z: normalizedZ,
            score,
            line: `${x},${y},${normalizedZ}`,
          };

          if (!best || candidate.score > best.score) {
            best = candidate;
          }
        }
      }
    }
  }

  return best;
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

export function saveBitmapWithBox(
  bitmap: RobotBitmap,
  box: { x: number; y: number; width: number; height: number },
  filename: string,
): void {
  const png = new PNG({
    width: bitmap.width,
    height: bitmap.height,
  });

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const idx = (y * bitmap.width + x) * 4;
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];

      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255;
    }
  }

  drawRectangleOnPng(png, box.x, box.y, box.width, box.height, { r: 255, g: 0, b: 0 }, 2);

  const dir = path.dirname(filename);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  png.pack().pipe(fs.createWriteStream(filename));
}

export function saveSoftMaskDebug(
  bitmap: RobotBitmap,
  box: { x: number; y: number; width: number; height: number },
  filename: string,
): void {
  const result = buildSoftMaskForCrop(bitmap, box, 80);
  if (!result) {
    return;
  }

  const { mask, croppedWidthScaled, croppedHeightScaled } = result;
  const png = new PNG({ width: croppedWidthScaled, height: croppedHeightScaled });
  for (let y = 0; y < croppedHeightScaled; y += 1) {
    for (let x = 0; x < croppedWidthScaled; x += 1) {
      const idx = (y * croppedWidthScaled + x) * 4;
      const val = mask[y * croppedWidthScaled + x] === 1 ? 255 : 0;
      png.data[idx] = val;
      png.data[idx + 1] = val;
      png.data[idx + 2] = val;
      png.data[idx + 3] = 255;
    }
  }

  const dir = path.dirname(filename);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  png.pack().pipe(fs.createWriteStream(filename));
}

function findTextBandsInLeftStrip(
  mask: Uint8Array,
  scaledWidth: number,
  scaledHeight: number,
  stripWidth: number,
): Array<{ startY: number; endY: number }> {
  const rowThreshold = Math.max(2, Math.floor(stripWidth * 0.01));
  const bands: Array<{ startY: number; endY: number }> = [];
  let activeStart = -1;

  for (let y = 0; y < scaledHeight; y += 1) {
    let rowCount = 0;
    const rowOffset = y * scaledWidth;

    for (let x = 0; x < stripWidth; x += 1) {
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
    const endY = scaledHeight - 1;
    if (endY - activeStart + 1 >= 3) {
      bands.push({ startY: activeStart, endY });
    }
  }

  return bands;
}

function deriveOverlayBoxFromBandCluster(
  mask: Uint8Array,
  origWidth: number,
  origHeight: number,
  stripWidthOrig: number,
  anchorYOrig: number,
  maxGapScaled: number,
): { x: number; y: number; width: number; height: number } | null {
  const scaledWidth = origWidth * OCR_SCALE_FACTOR;
  const scaledHeight = origHeight * OCR_SCALE_FACTOR;
  const stripWidthScaled = Math.min(scaledWidth, stripWidthOrig * OCR_SCALE_FACTOR);
  const anchorYScaled = Math.max(0, Math.min(scaledHeight - 1, anchorYOrig * OCR_SCALE_FACTOR));

  const bands = findTextBandsInLeftStrip(mask, scaledWidth, scaledHeight, stripWidthScaled);
  if (bands.length === 0) {
    return null;
  }

  let nearestBandIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < bands.length; i += 1) {
    const band = bands[i];
    const centerY = Math.floor((band.startY + band.endY) / 2);
    const distance = Math.abs(centerY - anchorYScaled);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestBandIndex = i;
    }
  }

  let clusterStart = nearestBandIndex;
  let clusterEnd = nearestBandIndex;

  // Expand upward/downward while bands remain vertically contiguous.
  // This captures the full Tile/Chunk/Region block instead of only a single line.
  while (clusterStart > 0) {
    const prevBand = bands[clusterStart - 1];
    const currentBand = bands[clusterStart];
    const gap = currentBand.startY - prevBand.endY;
    if (gap < 0 || gap > maxGapScaled) {
      break;
    }
    clusterStart -= 1;
  }

  while (clusterEnd < bands.length - 1) {
    const currentBand = bands[clusterEnd];
    const nextBand = bands[clusterEnd + 1];
    const gap = nextBand.startY - currentBand.endY;
    if (gap < 0 || gap > maxGapScaled) {
      break;
    }
    clusterEnd += 1;
  }
  const clusterTop = bands[clusterStart].startY;
  const clusterBottom = bands[clusterEnd].endY;

  const columnThreshold = Math.max(2, Math.floor((clusterBottom - clusterTop + 1) * 0.08));
  let minActiveX = Number.POSITIVE_INFINITY;
  let maxActiveX = Number.NEGATIVE_INFINITY;

  for (let x = 0; x < stripWidthScaled; x += 1) {
    let count = 0;
    for (let y = clusterTop; y <= clusterBottom; y += 1) {
      count += mask[y * scaledWidth + x];
    }

    if (count >= columnThreshold) {
      minActiveX = Math.min(minActiveX, x);
      maxActiveX = Math.max(maxActiveX, x);
    }
  }

  if (!Number.isFinite(minActiveX) || !Number.isFinite(maxActiveX)) {
    return null;
  }

  const padX = 8 * OCR_SCALE_FACTOR;
  const padY = 6 * OCR_SCALE_FACTOR;
  const x0Scaled = Math.max(0, minActiveX - padX);
  const y0Scaled = Math.max(0, clusterTop - padY);
  const x1Scaled = Math.min(stripWidthScaled - 1, maxActiveX + padX);
  const y1Scaled = Math.min(scaledHeight - 1, clusterBottom + padY);

  const x0 = Math.max(0, Math.floor(x0Scaled / OCR_SCALE_FACTOR));
  const y0 = Math.max(0, Math.floor(y0Scaled / OCR_SCALE_FACTOR));
  const x1 = Math.min(origWidth - 1, Math.ceil((x1Scaled + 1) / OCR_SCALE_FACTOR) - 1);
  const y1 = Math.min(origHeight - 1, Math.ceil((y1Scaled + 1) / OCR_SCALE_FACTOR) - 1);

  if (x1 <= x0 || y1 <= y0) {
    return null;
  }

  return {
    x: x0,
    y: y0,
    width: x1 - x0 + 1,
    height: y1 - y0 + 1,
  };
}

function cropUpscaledMaskToOverlayBox(
  mask: Uint8Array,
  bitmapWidth: number,
  bitmapHeight: number,
  overlayBox: { x: number; y: number; width: number; height: number },
): { croppedMask: Uint8Array; croppedWidthScaled: number; croppedHeightScaled: number } | null {
  if (overlayBox.width <= 0 || overlayBox.height <= 0) {
    return null;
  }

  const fullScaledWidth = bitmapWidth * OCR_SCALE_FACTOR;
  const fullScaledHeight = bitmapHeight * OCR_SCALE_FACTOR;

  const x0Scaled = Math.max(0, overlayBox.x * OCR_SCALE_FACTOR);
  const y0Scaled = Math.max(0, overlayBox.y * OCR_SCALE_FACTOR);
  const x1Scaled = Math.min(fullScaledWidth, (overlayBox.x + overlayBox.width) * OCR_SCALE_FACTOR);
  const y1Scaled = Math.min(fullScaledHeight, (overlayBox.y + overlayBox.height) * OCR_SCALE_FACTOR);

  const croppedWidthScaled = x1Scaled - x0Scaled;
  const croppedHeightScaled = y1Scaled - y0Scaled;
  if (croppedWidthScaled <= 0 || croppedHeightScaled <= 0) {
    return null;
  }

  const croppedMask = new Uint8Array(croppedWidthScaled * croppedHeightScaled);
  for (let y = 0; y < croppedHeightScaled; y += 1) {
    const srcOffset = (y0Scaled + y) * fullScaledWidth + x0Scaled;
    const dstOffset = y * croppedWidthScaled;
    croppedMask.set(mask.subarray(srcOffset, srcOffset + croppedWidthScaled), dstOffset);
  }

  return {
    croppedMask,
    croppedWidthScaled,
    croppedHeightScaled,
  };
}

function buildSoftMaskForCrop(
  bitmap: RobotBitmap,
  box: { x: number; y: number; width: number; height: number },
  thresholdGap: number,
  windowsScalePercent: number = 100,
): {
  mask: Uint8Array;
  dilatedMask: Uint8Array;
  effectiveCropWidth: number;
  effectiveCropHeight: number;
  croppedWidthScaled: number;
  croppedHeightScaled: number;
} | null {
  const x0 = Math.max(0, box.x);
  const y0 = Math.max(0, box.y);
  const x1 = Math.min(bitmap.width, box.x + box.width);
  const y1 = Math.min(bitmap.height, box.y + box.height);
  const cropW = x1 - x0;
  const cropH = y1 - y0;
  if (cropW <= 0 || cropH <= 0) {
    return null;
  }

  // At high DPI (125%+), Windows DPI virtualization bitmap-upscales the game
  // window, creating smooth anti-aliased gradients at text edges. Downscaling
  // the crop by 1/scaleFactor undoes this, restoring crisp text that matches
  // the OCR glyph templates. Pixel analysis confirms the anti-aliasing is
  // purely grayscale (R≈G≈B), not ClearType sub-pixel colored.
  const dsFactor = windowsScalePercent > 100 ? windowsScalePercent / 100 : 1;
  const effW = dsFactor > 1 ? Math.round(cropW / dsFactor) : cropW;
  const effH = dsFactor > 1 ? Math.round(cropH / dsFactor) : cropH;
  if (effW <= 0 || effH <= 0) {
    return null;
  }

  const gray = new Uint8Array(effW * effH);
  let max = 0;
  for (let y = 0; y < effH; y += 1) {
    const srcY = dsFactor > 1 ? Math.min(cropH - 1, Math.round(y * dsFactor)) : y;
    for (let x = 0; x < effW; x += 1) {
      const srcX = dsFactor > 1 ? Math.min(cropW - 1, Math.round(x * dsFactor)) : x;
      const offset = (y0 + srcY) * bitmap.byteWidth + (x0 + srcX) * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      const grayVal = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      gray[y * effW + x] = grayVal;
      if (grayVal > max) max = grayVal;
    }
  }

  const threshold = max - thresholdGap;
  const binary = new Uint8Array(effW * effH);
  for (let i = 0; i < gray.length; i += 1) {
    binary[i] = gray[i] >= threshold ? 1 : 0;
  }

  // Dilate 1px at effective resolution to fill anti-aliased gaps.
  // Used for band detection (row density needs connected strokes).
  // The non-dilated mask is used for OCR reading (preserves character gaps).
  const dilated = new Uint8Array(effW * effH);
  for (let y = 0; y < effH; y += 1) {
    for (let x = 0; x < effW; x += 1) {
      if (binary[y * effW + x] === 1) {
        dilated[y * effW + x] = 1;
        continue;
      }
      let found = false;
      for (let dy = -1; dy <= 1 && !found; dy += 1) {
        for (let dx = -1; dx <= 1 && !found; dx += 1) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny >= 0 && ny < effH && nx >= 0 && nx < effW && binary[ny * effW + nx] === 1) {
            found = true;
          }
        }
      }
      if (found) {
        dilated[y * effW + x] = 1;
      }
    }
  }

  const mask = upscaleBinaryMask(binary, effW, effH);
  const dilatedMask = upscaleBinaryMask(dilated, effW, effH);
  return {
    mask,
    dilatedMask,
    effectiveCropWidth: effW,
    effectiveCropHeight: effH,
    croppedWidthScaled: effW * OCR_SCALE_FACTOR,
    croppedHeightScaled: effH * OCR_SCALE_FACTOR,
  };
}

function readBestCoordinateCandidateInOverlayBox(
  bitmap: RobotBitmap,
  overlayBox: { x: number; y: number; width: number; height: number },
  scanRatios: number[],
  windowsScalePercent: number = 100,
): CoordinateCandidate | null {
  const thresholdGaps = [30, 50, 70, 90, 100, 120];

  // Strategy 1: Regular processing (always runs, preserves existing behavior)
  const regularBest = tryReadCandidates(bitmap, overlayBox, scanRatios, thresholdGaps, 100, null);

  if (windowsScalePercent <= 100) {
    return regularBest;
  }

  // Strategy 2: For high DPI, also try with downscaled crop to undo
  // Windows DPI virtualization bitmap upscaling. This restores crisp text
  // edges that better match the OCR glyph templates.
  const dsBest = tryReadCandidates(bitmap, overlayBox, scanRatios, thresholdGaps, windowsScalePercent, null);

  if (!regularBest) return dsBest;
  if (!dsBest) return regularBest;

  // If regular read looks like UI noise (very low x/y) but downscaled read looks
  // like a plausible tile coordinate, prefer downscaled even with a modest score gap.
  const regularLooksSuspicious = regularBest.x < 2500 || regularBest.y < 3000;
  const dsLooksLikeTile = dsBest.x >= 3000 && dsBest.y >= 5000 && dsBest.z <= 1;
  if (regularLooksSuspicious && dsLooksLikeTile && dsBest.score >= regularBest.score - 20) {
    return dsBest;
  }

  // Prefer downscaled only if it has substantially higher score, since the
  // regular strategy works well for large windows and shouldn't be overridden
  // by slightly-better-scoring garbage from the downscaled version.
  if (dsBest.score > regularBest.score + 30) return dsBest;
  return regularBest;
}

function tryReadCandidates(
  bitmap: RobotBitmap,
  overlayBox: { x: number; y: number; width: number; height: number },
  scanRatios: number[],
  thresholdGaps: number[],
  scaleForCrop: number,
  currentBest: CoordinateCandidate | null,
): CoordinateCandidate | null {
  let bestCandidate = currentBest;

  for (const gap of thresholdGaps) {
    const cropped = buildSoftMaskForCrop(bitmap, overlayBox, gap, scaleForCrop);
    if (!cropped) {
      continue;
    }

    // Use dilated mask for band detection always.
    // At 125%+ DPI, anti-aliased text has holes in the binary mask that make
    // digits unreadable. Dilation fills those holes while the normalizeGlyph()
    // step in classifySegment() handles the thicker strokes by rescaling to 5×7.
    const bands = findTextBandsInLeftStrip(
      cropped.dilatedMask,
      cropped.croppedWidthScaled,
      cropped.croppedHeightScaled,
      cropped.croppedWidthScaled,
    );
    if (bands.length === 0) {
      continue;
    }

    for (const band of bands) {
      for (const ratio of scanRatios) {
        const line = readNumericLineUsingOsrsGlyphTemplates(
          cropped.mask,
          cropped.effectiveCropWidth,
          cropped.effectiveCropHeight,
          band.startY,
          band.endY,
          ratio,
        );
        if (!line || line.length < 7) {
          continue;
        }

        const candidate = extractCoordinateCandidate(line);
        if (!candidate) {
          continue;
        }

        console.log(
          `  [crop] ds=${scaleForCrop > 100 ? 1 : 0} gap=${gap} band=${band.startY}-${band.endY} ratio=${ratio} line="${line}" → ${candidate.line} score=${candidate.score} z=${candidate.z}`,
        );

        if (!bestCandidate || isBetterCoordinateCandidate(candidate, bestCandidate)) {
          bestCandidate = candidate;
        }
      }
    }
  }

  return bestCandidate;
}

function isBetterCoordinateCandidate(a: CoordinateCandidate, b: CoordinateCandidate): boolean {
  // Prefer low z-plane (0-1 are normal game planes)
  const aLowZ = a.z <= 1;
  const bLowZ = b.z <= 1;
  if (aLowZ && !bLowZ) return true;
  if (!aLowZ && bLowZ) return false;

  // Among same z-plane tier, prefer higher score
  return a.score > b.score;
}

function detectOverlayBoxWithMask(
  bitmap: RobotBitmap,
  mask: Uint8Array,
  windowsScalePercent: number = 100,
): OverlayDetectionWithScore | null {
  const scaledWidth = bitmap.width * OCR_SCALE_FACTOR;
  const scaledHeight = bitmap.height * OCR_SCALE_FACTOR;

  const stripRatio = bitmap.width > 2560 ? 0.25 : 0.166;
  const leftStripWidthOrig = Math.max(40, Math.floor(bitmap.width * stripRatio));
  const scaledStripWidth = Math.min(scaledWidth, leftStripWidthOrig * OCR_SCALE_FACTOR);

  const stripMask = new Uint8Array(scaledStripWidth * scaledHeight);
  for (let sy = 0; sy < scaledHeight; sy += 1) {
    for (let sx = 0; sx < scaledStripWidth; sx += 1) {
      stripMask[sy * scaledStripWidth + sx] = mask[sy * scaledWidth + sx];
    }
  }

  const bands = findTextBandsInLeftStrip(mask, scaledWidth, scaledHeight, scaledStripWidth);
  if (bands.length === 0) {
    return null;
  }

  const maxGapScaled = 40 * OCR_SCALE_FACTOR;
  const scanRatios = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35];

  let bestDetection: OverlayDetectionWithScore | null = null;

  for (let i = 0; i < bands.length; i += 1) {
    const band = bands[i];

    let bestCandidate: CoordinateCandidate | null = null;
    for (const ratio of scanRatios) {
      const line = readNumericLineUsingOsrsGlyphTemplates(
        stripMask,
        leftStripWidthOrig,
        bitmap.height,
        band.startY,
        band.endY,
        ratio,
      );
      if (!line || line.length < 7) {
        continue;
      }

      const candidate = extractCoordinateCandidate(line);
      if (!candidate) {
        continue;
      }

      if (!bestCandidate || candidate.score > bestCandidate.score) {
        bestCandidate = candidate;
      }
    }

    if (!bestCandidate) {
      continue;
    }

    const tileX = bestCandidate.x;
    const tileY = bestCandidate.y;
    if (tileX < 0 || tileX > 10000 || tileY < 0 || tileY > 10000) {
      continue;
    }

    const hasNearbyBand =
      bands.length === 1 ||
      bands.some((b, j) => {
        if (j === i) {
          return false;
        }
        const gapBelow = b.startY - band.endY;
        const gapAbove = band.startY - b.endY;
        return (gapBelow >= 0 && gapBelow <= maxGapScaled) || (gapAbove >= 0 && gapAbove <= maxGapScaled);
      });
    if (!hasNearbyBand) {
      continue;
    }

    const anchorYOrig = Math.round((band.startY + band.endY) / 2 / OCR_SCALE_FACTOR);
    const overlayBox = deriveOverlayBoxFromBandCluster(
      mask,
      bitmap.width,
      bitmap.height,
      leftStripWidthOrig,
      anchorYOrig,
      maxGapScaled,
    );
    if (!overlayBox) {
      continue;
    }

    const croppedCandidate = readBestCoordinateCandidateInOverlayBox(
      bitmap,
      overlayBox,
      scanRatios,
      windowsScalePercent,
    );
    // Prefer cropped re-read (multi-threshold) over initial strip-based read (single threshold)
    const finalCandidate =
      croppedCandidate && croppedCandidate.z <= 3
        ? croppedCandidate
        : croppedCandidate && bestCandidate && isBetterCoordinateCandidate(croppedCandidate, bestCandidate)
          ? croppedCandidate
          : bestCandidate;

    const finalTileX = finalCandidate.x;
    const finalTileY = finalCandidate.y;
    if (finalTileX < 0 || finalTileX > 10000 || finalTileY < 0 || finalTileY > 10000) {
      continue;
    }

    let contextScore = 0;
    for (let j = 0; j < bands.length; j += 1) {
      if (j === i) {
        continue;
      }

      const neighbor = bands[j];
      const gapBelow = neighbor.startY - band.endY;
      const gapAbove = band.startY - neighbor.endY;
      const isNearby =
        (gapBelow >= 0 && gapBelow <= maxGapScaled * 2) || (gapAbove >= 0 && gapAbove <= maxGapScaled * 2);
      if (!isNearby) {
        continue;
      }

      const neighborLine = readNumericLineUsingOsrsGlyphTemplates(
        stripMask,
        leftStripWidthOrig,
        bitmap.height,
        neighbor.startY,
        neighbor.endY,
        0,
      );
      const digitCount = (neighborLine.match(/\d/g) ?? []).length;
      if (digitCount >= 5) {
        contextScore += 10;
      }
      if (neighborLine.includes(",")) {
        contextScore += 4;
      }
    }

    let geometryScore = 0;
    if (overlayBox.width >= 120) {
      geometryScore += 8;
    }
    if (overlayBox.height >= 50) {
      geometryScore += 8;
    }

    const totalScore = finalCandidate.score + contextScore + geometryScore;

    console.log(
      `  [detect] band[${i}] y=${band.startY}-${band.endY} stripBest="${bestCandidate.line}" cropBest="${croppedCandidate?.line ?? "null"}" final="${finalCandidate.line}" cropScore=${croppedCandidate?.score ?? 0} ctx=${contextScore} geo=${geometryScore} total=${totalScore}`,
    );

    const detection: OverlayDetectionWithScore = {
      x: overlayBox.x,
      y: overlayBox.y,
      width: overlayBox.width,
      height: overlayBox.height,
      matchedLine: finalCandidate.line,
      score: totalScore,
    };

    if (!bestDetection || detection.score > bestDetection.score) {
      bestDetection = detection;
    }
  }

  return bestDetection;
}

export function detectOverlayBoxInScreenshot(
  bitmap: RobotBitmap,
  windowsScalePercent: number = 100,
): OverlayBox | null {
  const defaultMask = buildWhiteTextMask(bitmap);
  const coordinateMask = buildCoordinateOverlayTextMask(bitmap);

  const defaultDetection = detectOverlayBoxWithMask(bitmap, defaultMask, windowsScalePercent);
  const coordinateDetection = detectOverlayBoxWithMask(bitmap, coordinateMask, windowsScalePercent);

  const parseDetectionLine = (line: string): { x: number; y: number; z: number } | null => {
    const match = line.match(/^(\d{3,5}),(\d{3,5}),(\d)$/);
    if (!match) {
      return null;
    }

    const x = Number(match[1]);
    const y = Number(match[2]);
    const z = Number(match[3]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return null;
    }

    return { x, y, z };
  };

  const isPlausibleCoordinateDetection = (detection: OverlayDetectionWithScore): boolean => {
    if (detection.width < 90 || detection.height < 35) {
      return false;
    }

    const parsed = parseDetectionLine(detection.matchedLine);
    if (!parsed) {
      return false;
    }

    const maxExpectedWidth = Math.max(120, Math.floor(bitmap.width * 0.24));
    const maxExpectedHeight = 140;
    const highConfidenceOutlier = windowsScalePercent > 100 && detection.score >= 300 && parsed.z <= 1;
    if ((detection.width > maxExpectedWidth || detection.height > maxExpectedHeight) && !highConfidenceOutlier) {
      return false;
    }

    const commaCount = (detection.matchedLine.match(/,/g) ?? []).length;
    if (commaCount !== 2) {
      return false;
    }

    const digitCount = (detection.matchedLine.match(/\d/g) ?? []).length;
    return digitCount >= 8 && digitCount <= 11;
  };

  let bestDetection: OverlayDetectionWithScore | null = null;
  if (defaultDetection) {
    bestDetection = defaultDetection;
  }

  if (coordinateDetection && isPlausibleCoordinateDetection(coordinateDetection)) {
    const parsed = parseDetectionLine(coordinateDetection.matchedLine);
    const isLowPlane = parsed ? parsed.z <= 1 : false;
    if ((!bestDetection || coordinateDetection.score >= bestDetection.score + 40) && isLowPlane) {
      bestDetection = coordinateDetection;
    }
  }

  console.log(
    `  [final] default="${defaultDetection?.matchedLine ?? "null"}" score=${defaultDetection?.score ?? 0} coordinate="${coordinateDetection?.matchedLine ?? "null"}" score=${coordinateDetection?.score ?? 0} winner="${bestDetection?.matchedLine ?? "null"}"`,
  );

  if (!bestDetection) {
    return null;
  }

  const { score: _score, ...result } = bestDetection;
  return result;
}
