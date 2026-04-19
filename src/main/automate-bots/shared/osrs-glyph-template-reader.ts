import { OCR_SCALE_FACTOR } from "./ocr-engine";

const ALLOWED_CHARS = /[0-9,]/;

type GlyphTemplate = {
  char: string;
  bits: number[];
  holeCount: number;
};

type HoleSummary = {
  count: number;
  largestCenterY: number;
};

const TEMPLATE_ROWS: Record<string, string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["01110", "10001", "00001", "01110", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  ",": ["00000", "00000", "00000", "00000", "00000", "00110", "00100"],
};

const TEMPLATE_VARIANTS: Array<{ char: string; rows: string[] }> = [
  // RuneLite anti-aliasing occasionally breaks joins in these glyphs.
  { char: "0", rows: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"] },
  { char: "1", rows: ["00100", "01100", "00100", "00100", "00100", "00100", "00100"] },
  { char: "4", rows: ["10000", "10000", "10000", "10110", "10110", "11111", "00110"] },
  { char: "6", rows: ["01110", "10000", "10000", "11110", "10001", "10001", "01110"] },
  { char: "8", rows: ["01110", "10001", "10000", "01110", "10001", "10001", "01110"] },
  { char: "8", rows: ["01110", "10001", "10001", "01110", "10000", "10001", "01110"] },
  { char: "9", rows: ["01110", "10001", "10001", "01111", "00001", "00010", "01100"] },
];

const GLYPH_TEMPLATES: GlyphTemplate[] = [
  ...Object.entries(TEMPLATE_ROWS).map(([char, rows]) => {
    const bits = templateRowsToBits(rows);
    return {
      char,
      bits,
      holeCount: analyzeHoles(bits, 5, 7).count,
    };
  }),
  ...TEMPLATE_VARIANTS.map(({ char, rows }) => {
    const bits = templateRowsToBits(rows);
    return {
      char,
      bits,
      holeCount: analyzeHoles(bits, 5, 7).count,
    };
  }),
];

function templateRowsToBits(rows: string[]): number[] {
  const bits: number[] = [];
  for (const row of rows) {
    for (const c of row) {
      bits.push(c === "1" ? 1 : 0);
    }
  }
  return bits;
}

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
      bits.push(density >= 0.32 ? 1 : 0);
    }
  }

  return bits;
}

function analyzeHoles(bits: number[], width: number, height: number): HoleSummary {
  const visited = new Uint8Array(bits.length);
  let holeCount = 0;
  let largestArea = 0;
  let largestCenterY = 3;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const startIndex = y * width + x;
      if (visited[startIndex] === 1 || bits[startIndex] !== 0) {
        continue;
      }

      const queue: number[] = [startIndex];
      visited[startIndex] = 1;
      let touchesBorder = false;
      let area = 0;
      let sumY = 0;

      while (queue.length > 0) {
        const index = queue.pop();
        if (index === undefined) {
          break;
        }

        const cx = index % width;
        const cy = Math.floor(index / width);
        area += 1;
        sumY += cy;

        if (cx === 0 || cy === 0 || cx === width - 1 || cy === height - 1) {
          touchesBorder = true;
        }

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) {
              continue;
            }
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
              continue;
            }
            const nIndex = ny * width + nx;
            if (visited[nIndex] === 1 || bits[nIndex] !== 0) {
              continue;
            }
            visited[nIndex] = 1;
            queue.push(nIndex);
          }
        }
      }

      if (!touchesBorder && area > 0) {
        holeCount += 1;
        if (area > largestArea) {
          largestArea = area;
          largestCenterY = sumY / area;
        }
      }
    }
  }

  return {
    count: holeCount,
    largestCenterY,
  };
}

function mergeCloseSegments(
  segments: Array<{ startX: number; endX: number }>,
  maxGap: number,
): Array<{ startX: number; endX: number }> {
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

function splitSegmentAtValleys(
  mask: Uint8Array,
  width: number,
  y0: number,
  y1: number,
  segment: { startX: number; endX: number },
): Array<{ startX: number; endX: number }> {
  const minGlyphWidth = Math.max(2, OCR_SCALE_FACTOR);
  const segments: Array<{ startX: number; endX: number }> = [segment];

  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;
    for (let i = 0; i < segments.length; i += 1) {
      const current = segments[i];
      const currentWidth = current.endX - current.startX + 1;
      if (currentWidth < minGlyphWidth * 2) {
        continue;
      }

      let bestSplitX = -1;
      let bestColumnScore = Number.POSITIVE_INFINITY;

      for (let x = current.startX + minGlyphWidth; x <= current.endX - minGlyphWidth; x += 1) {
        let count = 0;
        for (let y = y0; y <= y1; y += 1) {
          count += mask[y * width + x];
        }

        if (count < bestColumnScore) {
          bestColumnScore = count;
          bestSplitX = x;
        }
      }

      if (bestSplitX < 0 || bestColumnScore > 1) {
        continue;
      }

      const left = { startX: current.startX, endX: bestSplitX - 1 };
      const right = { startX: bestSplitX + 1, endX: current.endX };
      if (left.endX - left.startX + 1 < minGlyphWidth || right.endX - right.startX + 1 < minGlyphWidth) {
        continue;
      }

      segments.splice(i, 1, left, right);
      changed = true;
      break;
    }

    if (!changed) {
      break;
    }
  }

  return segments;
}

function disambiguateLoopDigits(bestChar: string, holeSummary: HoleSummary, normalizedBits: number[]): string {
  if (!["0", "6", "8", "9"].includes(bestChar)) {
    return bestChar;
  }

  if (holeSummary.count >= 2) {
    return "8";
  }

  if (holeSummary.count === 0) {
    // Anti-aliased captures can collapse loop holes; keep the template winner.
    return bestChar;
  }

  const topRows = normalizedBits.slice(0, 15).reduce((acc, bit) => acc + bit, 0);
  const bottomRows = normalizedBits.slice(20).reduce((acc, bit) => acc + bit, 0);

  if (holeSummary.largestCenterY <= 2.2) {
    return "9";
  }
  if (holeSummary.largestCenterY >= 4.2) {
    // Broken 8 often collapses to a low-center hole but remains near vertically balanced.
    const balance = Math.abs(topRows - bottomRows);
    if (balance <= 2) {
      return "8";
    }
    return "6";
  }

  return "0";
}

function classifySegment(
  mask: Uint8Array,
  width: number,
  y0: number,
  y1: number,
  x0: number,
  x1: number,
  strictMode: boolean,
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
  if (glyphWidth <= OCR_SCALE_FACTOR * 2 && glyphHeight <= OCR_SCALE_FACTOR * 4) {
    const lowerStart = minY + Math.floor(glyphHeight * 0.6);
    let lowerInk = 0;
    for (let y = lowerStart; y <= maxY; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        lowerInk += mask[y * width + x];
      }
    }

    if (lowerInk > 0) {
      return ",";
    }
  }

  const normalizedBits = normalizeGlyph(mask, width, x0, x1, minY, maxY, 5, 7);
  const holeSummary = analyzeHoles(normalizedBits, 5, 7);

  let bestChar = "";
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const template of GLYPH_TEMPLATES) {
    let distance = 0;
    for (let i = 0; i < normalizedBits.length; i += 1) {
      if (normalizedBits[i] !== template.bits[i]) {
        distance += 1;
      }
    }

    if (template.char !== ",") {
      distance += Math.abs(holeSummary.count - template.holeCount) * 3;
    }

    if (distance < bestDistance) {
      bestDistance = distance;
      bestChar = template.char;
    }
  }

  const tolerance = strictMode ? 20 : 26;
  if (bestDistance > tolerance) {
    return "";
  }

  return disambiguateLoopDigits(bestChar, holeSummary, normalizedBits);
}

export function readNumericLineUsingOsrsGlyphTemplates(
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

  const rawSegments: Array<{ startX: number; endX: number }> = [];
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
      rawSegments.push({ startX: segmentStart, endX: x - 1 });
      segmentStart = -1;
    }
  }

  if (segmentStart >= 0) {
    rawSegments.push({ startX: segmentStart, endX: x1 });
  }

  const merged = mergeCloseSegments(rawSegments, Math.max(0, Math.floor(maxMergeGap)));
  const refined: Array<{ startX: number; endX: number }> = [];
  for (const segment of merged) {
    refined.push(...splitSegmentAtValleys(mask, width, y0, y1, segment));
  }

  let output = "";
  for (const segment of refined) {
    const glyph = classifySegment(mask, width, y0, y1, segment.startX, segment.endX, strictMode);
    if (glyph && ALLOWED_CHARS.test(glyph)) {
      output += glyph;
    }
  }

  return output;
}
