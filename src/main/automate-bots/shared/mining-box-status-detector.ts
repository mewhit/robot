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
  textComponentCount: number;
  textColumnCount: number;
  textWidth: number;
  textHeight: number;
  textLikeScore: number;
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

type SearchRoiProfile = {
  leftRatio: number;
  rightRatio: number;
  topRatio: number;
  bottomRatio: number;
  minWidth: number;
  minHeight: number;
};

type StatusCandidateDetection = {
  greenPixelCount: number;
  redPixelCount: number;
  status: MiningBoxStatus;
  dominantPixelCount: number;
  confidence: number;
  detectionRoi: Roi;
  textComponentCount: number;
  textColumnCount: number;
  textWidth: number;
  textHeight: number;
  textLikeScore: number;
};

type StatusColorBand = {
  startY: number;
  endY: number;
};

type StatusTextMetrics = {
  textComponentCount: number;
  narrowComponentCount: number;
  textColumnCount: number;
  textWidth: number;
  textHeight: number;
  textLikeScore: number;
  textLike: boolean;
};

type StatusTextComponentSummary = {
  componentCount: number;
  narrowComponentCount: number;
};

const STATUS_SEARCH_PROFILES: SearchRoiProfile[] = [
  {
    leftRatio: 0.009,
    rightRatio: 0.05,
    topRatio: 0.04,
    bottomRatio: 0.075,
    minWidth: 160,
    minHeight: 110,
  },
  {
    leftRatio: 0.003,
    rightRatio: 0.15,
    topRatio: 0.17,
    bottomRatio: 0.235,
    minWidth: 180,
    minHeight: 110,
  },
  {
    leftRatio: 0.035,
    rightRatio: 0.15,
    topRatio: 0.26,
    bottomRatio: 0.36,
    minWidth: 180,
    minHeight: 130,
  },
];

const MIN_STATUS_PIXEL_COUNT = 12;
const MIN_DOMINANCE_RATIO = 0.62;
const STATUS_BOX_PADDING_X = 10;
const STATUS_BOX_PADDING_Y = 6;
const STATUS_LINE_PADDING_X = 8;
const STATUS_LINE_PADDING_Y = 4;
const MIN_STATUS_ROW_PIXEL_COUNT = 2;
const MAX_STATUS_BAND_GAP = 2;
const MIN_STATUS_TEXT_WIDTH = 28;
const MIN_STATUS_TEXT_HEIGHT = 7;
const MIN_STATUS_TEXT_COMPONENTS = 6;
const MIN_STATUS_TEXT_NARROW_COMPONENTS = 2;
const MIN_STATUS_TEXT_COLUMNS = 16;
const MAX_STATUS_TEXT_FILL_RATIO = 0.68;
const MIN_TEXT_COMPONENT_PIXELS = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveStatusRoi(bitmap: RobotBitmap, profile: SearchRoiProfile): Roi {
  const x0 = Math.round(bitmap.width * profile.leftRatio);
  const x1 = Math.round(bitmap.width * profile.rightRatio);
  const y0 = Math.round(bitmap.height * profile.topRatio);
  const y1 = Math.round(bitmap.height * profile.bottomRatio);

  const x = clamp(x0, 0, bitmap.width - 1);
  const y = clamp(y0, 0, bitmap.height - 1);
  const maxX = clamp(Math.max(x0 + profile.minWidth - 1, x1), 0, bitmap.width - 1);
  const maxY = clamp(Math.max(y0 + profile.minHeight - 1, y1), 0, bitmap.height - 1);

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

function isStatusPixelForStatus(r: number, g: number, b: number, status: MiningBoxStatus): boolean {
  if (status === "mining") {
    return isMiningGreenPixel(r, g, b);
  }

  if (status === "not-mining") {
    return isNotMiningRedPixel(r, g, b);
  }

  return false;
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

function findStatusColorBands(bitmap: RobotBitmap, roi: Roi): StatusColorBand[] {
  const bands: StatusColorBand[] = [];
  let activeStartY = -1;
  let lastActiveY = -1;

  for (let y = roi.y; y < roi.y + roi.height; y += 1) {
    let rowStatusPixelCount = 0;

    for (let x = roi.x; x < roi.x + roi.width; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];

      if (isMiningGreenPixel(r, g, b) || isNotMiningRedPixel(r, g, b)) {
        rowStatusPixelCount += 1;
      }
    }

    if (rowStatusPixelCount >= MIN_STATUS_ROW_PIXEL_COUNT) {
      if (activeStartY < 0) {
        activeStartY = y;
      }
      lastActiveY = y;
      continue;
    }

    if (activeStartY >= 0 && y - lastActiveY > MAX_STATUS_BAND_GAP) {
      bands.push({
        startY: activeStartY,
        endY: lastActiveY,
      });
      activeStartY = -1;
      lastActiveY = -1;
    }
  }

  if (activeStartY >= 0) {
    bands.push({
      startY: activeStartY,
      endY: lastActiveY,
    });
  }

  return bands;
}

function countStatusTextColumns(bitmap: RobotBitmap, extents: PixelExtents, status: MiningBoxStatus): number {
  if (extents.count === 0 || status === "unknown") {
    return 0;
  }

  let columns = 0;
  for (let x = extents.minX; x <= extents.maxX; x += 1) {
    let hasPixel = false;
    for (let y = extents.minY; y <= extents.maxY; y += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (isStatusPixelForStatus(r, g, b, status)) {
        hasPixel = true;
        break;
      }
    }

    if (hasPixel) {
      columns += 1;
    }
  }

  return columns;
}

function countStatusTextComponents(
  bitmap: RobotBitmap,
  extents: PixelExtents,
  status: MiningBoxStatus,
): StatusTextComponentSummary {
  if (extents.count === 0 || status === "unknown") {
    return {
      componentCount: 0,
      narrowComponentCount: 0,
    };
  }

  const width = extents.maxX - extents.minX + 1;
  const height = extents.maxY - extents.minY + 1;
  const visited = new Uint8Array(width * height);
  let componentCount = 0;
  let narrowComponentCount = 0;

  const isDominantPixel = (localX: number, localY: number): boolean => {
    const x = extents.minX + localX;
    const y = extents.minY + localY;
    const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
    const b = bitmap.image[offset];
    const g = bitmap.image[offset + 1];
    const r = bitmap.image[offset + 2];
    return isStatusPixelForStatus(r, g, b, status);
  };

  for (let localY = 0; localY < height; localY += 1) {
    for (let localX = 0; localX < width; localX += 1) {
      const startIndex = localY * width + localX;
      if (visited[startIndex] === 1 || !isDominantPixel(localX, localY)) {
        continue;
      }

      const queue: number[] = [startIndex];
      visited[startIndex] = 1;
      let pixelCount = 0;
      let minLocalX = localX;
      let maxLocalX = localX;

      while (queue.length > 0) {
        const index = queue.pop();
        if (index === undefined) {
          break;
        }

        pixelCount += 1;
        const cx = index % width;
        const cy = Math.floor(index / width);
        minLocalX = Math.min(minLocalX, cx);
        maxLocalX = Math.max(maxLocalX, cx);

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

            const nextIndex = ny * width + nx;
            if (visited[nextIndex] === 1 || !isDominantPixel(nx, ny)) {
              continue;
            }

            visited[nextIndex] = 1;
            queue.push(nextIndex);
          }
        }
      }

      if (pixelCount >= MIN_TEXT_COMPONENT_PIXELS) {
        componentCount += 1;
        const componentWidth = maxLocalX - minLocalX + 1;
        const narrowWidth = Math.max(3, Math.floor(height * 0.35));
        if (componentWidth <= narrowWidth) {
          narrowComponentCount += 1;
        }
      }
    }
  }

  return {
    componentCount,
    narrowComponentCount,
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

function getDominantExtents(
  status: MiningBoxStatus,
  greenExtents: PixelExtents,
  redExtents: PixelExtents,
): PixelExtents {
  if (status === "mining") {
    return greenExtents;
  }

  if (status === "not-mining") {
    return redExtents;
  }

  return greenExtents.count >= redExtents.count ? greenExtents : redExtents;
}

function analyzeStatusTextLine(
  bitmap: RobotBitmap,
  status: MiningBoxStatus,
  dominantExtents: PixelExtents,
): StatusTextMetrics {
  if (status === "unknown" || dominantExtents.count === 0) {
    return {
      textComponentCount: 0,
      narrowComponentCount: 0,
      textColumnCount: 0,
      textWidth: 0,
      textHeight: 0,
      textLikeScore: 0,
      textLike: false,
    };
  }

  const textWidth = dominantExtents.maxX - dominantExtents.minX + 1;
  const textHeight = dominantExtents.maxY - dominantExtents.minY + 1;
  const textColumnCount = countStatusTextColumns(bitmap, dominantExtents, status);
  const componentSummary = countStatusTextComponents(bitmap, dominantExtents, status);
  const textComponentCount = componentSummary.componentCount;
  const fillRatio = dominantExtents.count / Math.max(1, textWidth * textHeight);
  const textLike =
    textWidth >= MIN_STATUS_TEXT_WIDTH &&
    textHeight >= MIN_STATUS_TEXT_HEIGHT &&
    textColumnCount >= MIN_STATUS_TEXT_COLUMNS &&
    textComponentCount >= MIN_STATUS_TEXT_COMPONENTS &&
    componentSummary.narrowComponentCount >= MIN_STATUS_TEXT_NARROW_COMPONENTS &&
    fillRatio <= MAX_STATUS_TEXT_FILL_RATIO;

  return {
    textComponentCount,
    narrowComponentCount: componentSummary.narrowComponentCount,
    textColumnCount,
    textWidth,
    textHeight,
    textLikeScore: textLike ? textWidth + textColumnCount + textComponentCount * 8 + dominantExtents.count / 3 : 0,
    textLike,
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

function createUnknownStatusCandidate(searchRoi: Roi, counts: ReturnType<typeof countStatusPixels>): StatusCandidateDetection {
  return {
    greenPixelCount: counts.greenPixelCount,
    redPixelCount: counts.redPixelCount,
    status: "unknown",
    dominantPixelCount: Math.max(counts.greenPixelCount, counts.redPixelCount),
    confidence: 0,
    detectionRoi: searchRoi,
    textComponentCount: 0,
    textColumnCount: 0,
    textWidth: 0,
    textHeight: 0,
    textLikeScore: 0,
  };
}

function buildStatusLineCandidate(bitmap: RobotBitmap, searchRoi: Roi, band: StatusColorBand): StatusCandidateDetection {
  const lineY = clamp(band.startY - STATUS_LINE_PADDING_Y, searchRoi.y, searchRoi.y + searchRoi.height - 1);
  const lineMaxY = clamp(band.endY + STATUS_LINE_PADDING_Y, searchRoi.y, searchRoi.y + searchRoi.height - 1);
  const lineRoi = {
    x: searchRoi.x,
    y: lineY,
    width: searchRoi.width,
    height: lineMaxY - lineY + 1,
  };
  const lineCounts = countStatusPixels(bitmap, lineRoi);
  const lineClassification = classifyStatus(lineCounts.greenPixelCount, lineCounts.redPixelCount);
  const dominantExtents = getDominantExtents(lineClassification.status, lineCounts.greenExtents, lineCounts.redExtents);
  const textMetrics = analyzeStatusTextLine(bitmap, lineClassification.status, dominantExtents);
  const detectionRoi =
    extentsToRoi(bitmap, dominantExtents, STATUS_LINE_PADDING_X, STATUS_LINE_PADDING_Y) ??
    resolveDetectedStatusBox(bitmap, searchRoi, lineClassification.status, lineCounts.greenExtents, lineCounts.redExtents);
  const status = textMetrics.textLike ? lineClassification.status : "unknown";

  return {
    greenPixelCount: lineCounts.greenPixelCount,
    redPixelCount: lineCounts.redPixelCount,
    status,
    dominantPixelCount: lineClassification.dominantPixelCount,
    confidence: status === "unknown" ? 0 : lineClassification.confidence,
    detectionRoi,
    textComponentCount: textMetrics.textComponentCount,
    textColumnCount: textMetrics.textColumnCount,
    textWidth: textMetrics.textWidth,
    textHeight: textMetrics.textHeight,
    textLikeScore: textMetrics.textLikeScore,
  };
}

function buildStatusCandidates(bitmap: RobotBitmap, searchRoi: Roi): StatusCandidateDetection[] {
  const counts = countStatusPixels(bitmap, searchRoi);
  const candidates = findStatusColorBands(bitmap, searchRoi).map((band) =>
    buildStatusLineCandidate(bitmap, searchRoi, band),
  );

  candidates.push(createUnknownStatusCandidate(searchRoi, counts));
  return candidates;
}

function scoreStatusCandidate(candidate: StatusCandidateDetection): number {
  const totalStatusPixelCount = candidate.greenPixelCount + candidate.redPixelCount;
  if (candidate.status === "unknown") {
    return totalStatusPixelCount;
  }

  return 10_000 + candidate.confidence * 1_000 + candidate.textLikeScore + candidate.dominantPixelCount;
}

function pickBestStatusCandidate(candidates: StatusCandidateDetection[]): StatusCandidateDetection {
  let best = candidates[0];
  let bestScore = scoreStatusCandidate(best);

  for (const candidate of candidates.slice(1)) {
    const score = scoreStatusCandidate(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

export function detectMiningBoxStatusInScreenshot(bitmap: RobotBitmap): MiningBoxStatusDetection {
  const candidates = STATUS_SEARCH_PROFILES.flatMap((profile) =>
    buildStatusCandidates(bitmap, resolveStatusRoi(bitmap, profile)),
  );
  const bestCandidate = pickBestStatusCandidate(candidates);

  return {
    status: bestCandidate.status,
    isMining: bestCandidate.status === "mining",
    x: bestCandidate.detectionRoi.x,
    y: bestCandidate.detectionRoi.y,
    width: bestCandidate.detectionRoi.width,
    height: bestCandidate.detectionRoi.height,
    greenPixelCount: bestCandidate.greenPixelCount,
    redPixelCount: bestCandidate.redPixelCount,
    totalStatusPixelCount: bestCandidate.greenPixelCount + bestCandidate.redPixelCount,
    dominantPixelCount: bestCandidate.dominantPixelCount,
    confidence: bestCandidate.confidence,
    textComponentCount: bestCandidate.textComponentCount,
    textColumnCount: bestCandidate.textColumnCount,
    textWidth: bestCandidate.textWidth,
    textHeight: bestCandidate.textHeight,
    textLikeScore: bestCandidate.textLikeScore,
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
