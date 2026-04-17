import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { buildWhiteTextMask, OCR_SCALE_FACTOR, readNumericLine, RobotBitmap } from "./ocr-engine";

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

function extractCoordinateCandidate(line: string): CoordinateCandidate | null {
  const cleaned = line.replace(/[^0-9,]/g, "");
  if (cleaned.length < 7 || cleaned.length > 24) {
    return null;
  }

  const commaCount = (cleaned.match(/,/g) ?? []).length;

  let best: CoordinateCandidate | null = null;

  // Accept any single Z digit here; OCR can read 0 as 8/6/9 in some captures.
  // We only need a stable anchor for overlay box detection.
  const delimitedPattern = /(\d{3,5}),(\d{3,5}),(\d)/g;
  for (const match of cleaned.matchAll(delimitedPattern)) {
    const x = Number(match[1]);
    const y = Number(match[2]);
    const z = Number(match[3]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue;
    }

    if (x < 0 || x > 10000 || y < 0 || y > 10000) {
      continue;
    }

    const zPenalty = z > 3 ? 10 : 0;
    const extraChars = Math.max(0, cleaned.length - match[0].length);
    const score = 220 + match[0].length - zPenalty - extraChars * 2;
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
    for (let xLen = 3; xLen <= 5; xLen += 1) {
      for (let yLen = 3; yLen <= 5; yLen += 1) {
        const zIndex = start + xLen + yLen;
        if (zIndex >= digitsOnly.length) {
          continue;
        }

        const z = Number(digitsOnly[zIndex]);
        if (!Number.isFinite(z)) {
          continue;
        }

        const x = Number(digitsOnly.slice(start, start + xLen));
        const y = Number(digitsOnly.slice(start + xLen, zIndex));
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          continue;
        }
        if (x < 0 || x > 10000 || y < 0 || y > 10000) {
          continue;
        }

        const candidateLen = xLen + yLen + 1;
        const extraDigits = digitsOnly.length - candidateLen;
        if (extraDigits > 5) {
          continue;
        }

        const zPenalty = z > 3 ? 8 : 0;
        const commaBonus = commaCount >= 2 ? 12 : 0;
        const score = 120 + commaBonus + xLen + yLen - extraDigits * 8 - start * 3 - zPenalty;

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

export function detectOverlayBoxInScreenshot(bitmap: RobotBitmap): OverlayBox | null {
  // ── 1. Binary mask (white text on dark background) ──────────────────────────
  const mask = buildWhiteTextMask(bitmap);
  const scaledWidth = bitmap.width * OCR_SCALE_FACTOR;
  const scaledHeight = bitmap.height * OCR_SCALE_FACTOR;

  // ── 2. Left-strip constraint: adapt based on resolution ──────────────────────
  // For fullscreen/large resolutions, search up to 1/4 width (was 1/6)
  // This accommodates overlay positioning in various fullscreen scenarios
  const stripRatio = bitmap.width > 2560 ? 0.25 : 0.166; // 25% for 4K+, ~16.7% for 1080p
  const leftStripWidthOrig = Math.max(40, Math.floor(bitmap.width * stripRatio));
  const scaledStripWidth = Math.min(scaledWidth, leftStripWidthOrig * OCR_SCALE_FACTOR);

  // ── 3. Build strip-only sub-mask (prevents right-side text contamination) ───
  // stripMask dimensions: scaledStripWidth × scaledHeight
  // readNumericLine sees origWidth = leftStripWidthOrig, so it stays inside the strip.
  const stripMask = new Uint8Array(scaledStripWidth * scaledHeight);
  for (let sy = 0; sy < scaledHeight; sy += 1) {
    for (let sx = 0; sx < scaledStripWidth; sx += 1) {
      stripMask[sy * scaledStripWidth + sx] = mask[sy * scaledWidth + sx];
    }
  }

  // ── 4. Detect horizontal text bands in the left strip ───────────────────────
  // findTextBandsInLeftStrip returns startY/endY in upscaled (×OCR_SCALE_FACTOR) coords.
  // readNumericLine expects the same upscaled coords — pass them directly.
  const bands = findTextBandsInLeftStrip(mask, scaledWidth, scaledHeight, scaledStripWidth);
  if (bands.length === 0) {
    return null;
  }

  // Max gap between adjacent overlay lines: scale-independent, adapted for fullscreen
  // Increased from 30px to 40px to handle fullscreen resolution variations
  const maxGapScaled = 40 * OCR_SCALE_FACTOR;

  const scanRatios = [0, 0.15, 0.25, 0.35];

  let bestDetection: (OverlayBox & { score: number }) | null = null;

  for (let i = 0; i < bands.length; i += 1) {
    const band = bands[i];

    let bestCandidate: CoordinateCandidate | null = null;
    for (const ratio of scanRatios) {
      const line = readNumericLine(stripMask, leftStripWidthOrig, bitmap.height, band.startY, band.endY, ratio);
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
    const tileZ = bestCandidate.z;

    // ── 7. Coordinate range validation ───────────────────────────────────────
    // Relaxed constraints to support fullscreen scenarios (e.g., Y up to 10,000+)
    // X: 0 to 10,000 (covers most RuneScape map regions)
    // Y: 0 to 10,000 (covers all known regions including southern areas)
    // Z ∈ [0, 3] is already enforced by the regex character class [0-3]
    if (tileX < 0 || tileX > 10000) {
      continue;
    }
    if (tileY < 0 || tileY > 10000) {
      continue;
    }

    // ── 8. Nearby-bands validation (optional for fullscreen) ───────────────────
    // In standard views, the RuneLite overlay always has 3 lines (Tile / Chunk ID / Region ID).
    // For fullscreen scenarios, the overlay might be isolated, so we relax this requirement.
    // Only validate if multiple bands exist nearby.
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

    // ── 9. Expand around the matched band cluster → full overlay box ─────────
    // deriveOverlayBoxFromBandCluster expects anchorY in original (non-scaled) pixels.
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

    // Prefer candidates that sit near other digit-heavy lines
    // (Chunk ID / Region ID context), and with plausible box size.
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

      const neighborLine = readNumericLine(
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

    const totalScore = bestCandidate.score + contextScore + geometryScore;

    const detection: OverlayBox & { score: number } = {
      x: overlayBox.x,
      y: overlayBox.y,
      width: overlayBox.width,
      height: overlayBox.height,
      matchedLine: bestCandidate.line,
      score: totalScore,
    };

    if (!bestDetection || detection.score > bestDetection.score) {
      bestDetection = detection;
    }
  }

  if (!bestDetection) {
    return null;
  }

  const { score: _score, ...result } = bestDetection;
  return result;
}
