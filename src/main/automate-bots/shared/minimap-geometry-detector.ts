import type { ScreenBitmap } from "../../windowsScreenCapture";
import { clamp } from "./osrs-helper";

export type RuneliteMinimapGeometryCandidate = {
  centerLocalX: number;
  centerLocalY: number;
  radiusPx: number;
  score: number;
  averageEdgeScore: number;
  hitRatio: number;
  coverage: number;
  continuityScore: number;
  samples: number;
};

export type RuneliteMinimapGeometryDetection = {
  centerLocalX: number;
  centerLocalY: number;
  radiusPx: number;
  tilePx: number;
  score: number;
  source: "detected-from-contour";
  expectedCenterLocalX: number;
  expectedCenterLocalY: number;
  expectedRadiusPx: number;
  candidates: RuneliteMinimapGeometryCandidate[];
  summary: string;
};

export type RuneliteMinimapGeometrySearchResult = {
  detection: RuneliteMinimapGeometryDetection | null;
  expectedCenterLocalX: number;
  expectedCenterLocalY: number;
  expectedRadiusPx: number;
  candidates: RuneliteMinimapGeometryCandidate[];
  summary: string;
};

export type RuneliteMinimapGeometryDetectionOptions = {
  scale: number;
  expectedCenterLocalX?: number;
  expectedCenterLocalY?: number;
  expectedRadiusPx?: number;
  expectedTilePx?: number;
  minScore?: number;
};

type Rgb = {
  r: number;
  g: number;
  b: number;
};

type CachedRuneliteMinimapDetection = {
  scale: number;
  expectedCenterLocalX: number;
  expectedCenterLocalY: number;
  expectedRadiusPx: number;
  minScore: number;
  result: RuneliteMinimapGeometrySearchResult;
};

const RUNELITE_MINIMAP_CENTER_RIGHT_OFFSET_LOGICAL = 122;
const RUNELITE_MINIMAP_CENTER_Y_LOGICAL = 84;
const RUNELITE_MINIMAP_RADIUS_LOGICAL = 73;
const RUNELITE_MINIMAP_TILE_PX_LOGICAL = 4;
const RUNELITE_MINIMAP_CONTOUR_MIN_SCORE = 0.43;
const RUNELITE_MINIMAP_COARSE_CENTER_STEP_LOGICAL = 5;
const RUNELITE_MINIMAP_COARSE_RADIUS_STEP_LOGICAL = 4;
const RUNELITE_MINIMAP_COARSE_SAMPLE_COUNT = 56;
const RUNELITE_MINIMAP_REFINED_SAMPLE_COUNT = 112;
const RUNELITE_MINIMAP_BUCKET_COUNT = 16;
const RUNELITE_MINIMAP_TOP_CANDIDATE_COUNT = 8;
const detectionCache = new WeakMap<ScreenBitmap, CachedRuneliteMinimapDetection>();
const circleSampleCache = new Map<string, readonly CircleSamplePoint[]>();

type CircleSamplePoint = {
  cos: number;
  sin: number;
  bucket: number;
};

type MinimapCenterSeed = {
  centerLocalX: number;
  centerLocalY: number;
  pixelCount: number;
  width: number;
  height: number;
  score: number;
};

function getBitmapRgb(bitmap: ScreenBitmap, x: number, y: number): Rgb | null {
  const localX = Math.round(x);
  const localY = Math.round(y);
  if (localX < 0 || localY < 0 || localX >= bitmap.width || localY >= bitmap.height) {
    return null;
  }

  const offset = localY * bitmap.byteWidth + localX * bitmap.bytesPerPixel;
  return {
    b: bitmap.image[offset],
    g: bitmap.image[offset + 1],
    r: bitmap.image[offset + 2],
  };
}

function colorDistance(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function scoreWarmRuneliteFramePixel(rgb: Rgb): number {
  const brightness = (rgb.r + rgb.g + rgb.b) / 3;
  const maxChannel = Math.max(rgb.r, rgb.g, rgb.b);
  const minChannel = Math.min(rgb.r, rgb.g, rgb.b);
  const saturation = maxChannel - minChannel;

  if (brightness < 34 || brightness > 235 || saturation < 10 || rgb.b > 155) {
    return 0;
  }

  const warmScore = clamp((rgb.r + rgb.g - rgb.b * 1.7 - 28) / 110, 0, 1);
  const brightnessScore = clamp((brightness - 34) / 92, 0, 1) * clamp((235 - brightness) / 105, 0, 1);
  const balanceScore = clamp(1 - Math.abs(rgb.r - rgb.g) / 120, 0, 1);
  const saturationScore = clamp(saturation / 82, 0, 1);

  return clamp(warmScore * 0.42 + brightnessScore * 0.28 + balanceScore * 0.18 + saturationScore * 0.12, 0, 1);
}

function isIgnoredContourSample(
  bitmap: ScreenBitmap,
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  radiusPx: number,
  scale: number,
): boolean {
  if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) {
    return true;
  }

  const dx = x - centerX;
  const dy = y - centerY;

  if (x > bitmap.width - Math.round(34 * scale)) {
    return true;
  }

  if (dy < -radiusPx * 0.52 && dx < -radiusPx * 0.22) {
    return true;
  }

  if (dx < -radiusPx * 0.72 && dy > -radiusPx * 0.52 && dy < radiusPx * 0.92) {
    return true;
  }

  if (dx > radiusPx * 0.42 && dy > radiusPx * 0.58) {
    return true;
  }

  return false;
}

function scoreRuneliteMinimapContourSample(
  bitmap: ScreenBitmap,
  centerX: number,
  centerY: number,
  radiusPx: number,
  cos: number,
  sin: number,
): number {
  let previous = getBitmapRgb(bitmap, centerX + cos * (radiusPx - 12), centerY + sin * (radiusPx - 12));
  let bestEdge = 0;
  let bestWarmFrame = 0;

  for (let offset = -9; offset <= 12; offset += 3) {
    const current = getBitmapRgb(bitmap, centerX + cos * (radiusPx + offset), centerY + sin * (radiusPx + offset));
    if (!current) {
      previous = null;
      continue;
    }

    bestWarmFrame = Math.max(bestWarmFrame, scoreWarmRuneliteFramePixel(current));
    if (previous) {
      bestEdge = Math.max(bestEdge, colorDistance(previous, current));
    }

    previous = current;
  }

  const inner = getBitmapRgb(bitmap, centerX + cos * (radiusPx - 8), centerY + sin * (radiusPx - 8));
  const outer = getBitmapRgb(bitmap, centerX + cos * (radiusPx + 8), centerY + sin * (radiusPx + 8));
  const radialContrast = inner && outer ? colorDistance(inner, outer) : 0;
  const edgeScore = clamp(Math.max(bestEdge, radialContrast * 0.72) / 72, 0, 1);

  return clamp(edgeScore * 0.78 + bestWarmFrame * 0.22, 0, 1);
}

function isLikelyMinimapCenterMarkerPixel(rgb: Rgb): boolean {
  const brightness = (rgb.r + rgb.g + rgb.b) / 3;
  const maxChannel = Math.max(rgb.r, rgb.g, rgb.b);
  const minChannel = Math.min(rgb.r, rgb.g, rgb.b);
  const whiteMarker = brightness >= 185 && maxChannel - minChannel <= 78 && rgb.r >= 160 && rgb.g >= 160 && rgb.b >= 160;
  const greenMarker = rgb.g >= 155 && rgb.r <= 135 && rgb.b <= 145 && rgb.g - rgb.r >= 45 && rgb.g - rgb.b >= 35;
  const orangeMarker = rgb.r >= 190 && rgb.g >= 80 && rgb.g <= 180 && rgb.b <= 95 && rgb.r - rgb.g >= 35;

  return whiteMarker || greenMarker || orangeMarker;
}

function findMinimapCenterSeeds(bitmap: ScreenBitmap, scale: number): MinimapCenterSeed[] {
  const minX = Math.max(
    0,
    Math.min(bitmap.width - 1, Math.max(Math.floor(bitmap.width * 0.5), bitmap.width - Math.round(650 * scale))),
  );
  const maxX = Math.max(minX, bitmap.width - Math.round(36 * scale));
  const minY = Math.max(0, Math.round(34 * scale));
  const maxY = Math.min(bitmap.height - 1, Math.round(170 * scale));
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  if (width <= 0 || height <= 0) {
    return [];
  }

  const candidate = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);
  for (let localY = 0; localY < height; localY += 1) {
    for (let localX = 0; localX < width; localX += 1) {
      const rgb = getBitmapRgb(bitmap, minX + localX, minY + localY);
      if (rgb && isLikelyMinimapCenterMarkerPixel(rgb)) {
        candidate[localY * width + localX] = 1;
      }
    }
  }

  const seeds: MinimapCenterSeed[] = [];
  const queue: number[] = [];
  for (let startIndex = 0; startIndex < candidate.length; startIndex += 1) {
    if (candidate[startIndex] === 0 || visited[startIndex] !== 0) {
      continue;
    }

    visited[startIndex] = 1;
    queue.length = 0;
    queue.push(startIndex);
    let queueIndex = 0;
    let pixelCount = 0;
    let sumX = 0;
    let sumY = 0;
    let componentMinX = Number.POSITIVE_INFINITY;
    let componentMinY = Number.POSITIVE_INFINITY;
    let componentMaxX = Number.NEGATIVE_INFINITY;
    let componentMaxY = Number.NEGATIVE_INFINITY;

    while (queueIndex < queue.length) {
      const index = queue[queueIndex];
      queueIndex += 1;
      const localX = index % width;
      const localY = Math.floor(index / width);
      const worldX = minX + localX;
      const worldY = minY + localY;
      pixelCount += 1;
      sumX += worldX;
      sumY += worldY;
      componentMinX = Math.min(componentMinX, worldX);
      componentMinY = Math.min(componentMinY, worldY);
      componentMaxX = Math.max(componentMaxX, worldX);
      componentMaxY = Math.max(componentMaxY, worldY);

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }

          const nextX = localX + dx;
          const nextY = localY + dy;
          if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
            continue;
          }

          const nextIndex = nextY * width + nextX;
          if (candidate[nextIndex] === 0 || visited[nextIndex] !== 0) {
            continue;
          }

          visited[nextIndex] = 1;
          queue.push(nextIndex);
        }
      }
    }

    const componentWidth = componentMaxX - componentMinX + 1;
    const componentHeight = componentMaxY - componentMinY + 1;
    const maxSeedSize = Math.max(8, Math.round(18 * scale));
    if (pixelCount < 2 || pixelCount > 150 || componentWidth > maxSeedSize || componentHeight > maxSeedSize) {
      continue;
    }

    const centerLocalX = sumX / pixelCount;
    const centerLocalY = sumY / pixelCount;
    const shapeBalance = Math.min(componentWidth, componentHeight) / Math.max(componentWidth, componentHeight, 1);
    const sizeScore = clamp(pixelCount / 18, 0, 1);
    const score = sizeScore * 0.5 + shapeBalance * 0.3 + clamp((maxSeedSize - Math.max(componentWidth, componentHeight)) / maxSeedSize, 0, 1) * 0.2;
    seeds.push({
      centerLocalX: Math.round(centerLocalX),
      centerLocalY: Math.round(centerLocalY),
      pixelCount,
      width: componentWidth,
      height: componentHeight,
      score,
    });
  }

  seeds.sort((a, b) => b.score - a.score);
  return seeds.slice(0, 80);
}

function getCircleSamplePoints(sampleCount: number, bucketCount: number): readonly CircleSamplePoint[] {
  const key = `${sampleCount}:${bucketCount}`;
  const cached = circleSampleCache.get(key);
  if (cached) {
    return cached;
  }

  const samples: CircleSamplePoint[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const angle = (index / sampleCount) * Math.PI * 2;
    samples.push({
      cos: Math.cos(angle),
      sin: Math.sin(angle),
      bucket: Math.min(bucketCount - 1, Math.floor((index / sampleCount) * bucketCount)),
    });
  }

  circleSampleCache.set(key, samples);
  return samples;
}

function scoreRuneliteMinimapCandidate(
  bitmap: ScreenBitmap,
  centerLocalX: number,
  centerLocalY: number,
  radiusPx: number,
  scale: number,
  expectedCenterLocalX: number,
  expectedCenterLocalY: number,
  expectedRadiusPx: number,
  samplePoints: readonly CircleSamplePoint[],
): RuneliteMinimapGeometryCandidate | null {
  if (
    centerLocalX - radiusPx < 0 ||
    centerLocalY - radiusPx < 0 ||
    centerLocalX + radiusPx >= bitmap.width ||
    centerLocalY + radiusPx >= bitmap.height
  ) {
    return null;
  }

  const bucketScores = new Array<number>(RUNELITE_MINIMAP_BUCKET_COUNT).fill(0);
  const bucketSamples = new Array<number>(RUNELITE_MINIMAP_BUCKET_COUNT).fill(0);
  let totalScore = 0;
  let hits = 0;
  let samples = 0;

  for (const sample of samplePoints) {
    const cos = sample.cos;
    const sin = sample.sin;
    const sampleX = centerLocalX + cos * radiusPx;
    const sampleY = centerLocalY + sin * radiusPx;

    if (isIgnoredContourSample(bitmap, sampleX, sampleY, centerLocalX, centerLocalY, radiusPx, scale)) {
      continue;
    }

    const sampleScore = scoreRuneliteMinimapContourSample(bitmap, centerLocalX, centerLocalY, radiusPx, cos, sin);
    const bucket = sample.bucket;
    totalScore += sampleScore;
    hits += sampleScore >= 0.34 ? 1 : 0;
    bucketScores[bucket] += sampleScore;
    bucketSamples[bucket] += 1;
    samples += 1;
  }

  if (samples < Math.round(samplePoints.length * 0.48)) {
    return null;
  }

  const averageEdgeScore = totalScore / samples;
  const hitRatio = hits / samples;
  const usableBucketAverages = bucketScores.flatMap((score, index) =>
    bucketSamples[index] > 0 ? [score / bucketSamples[index]] : [],
  );
  const strongBuckets = usableBucketAverages.filter((score) => score >= 0.27).length;
  const continuityScore = usableBucketAverages.length > 0 ? strongBuckets / usableBucketAverages.length : 0;
  const coverage = samples / samplePoints.length;
  const expectedCenterDistance = Math.hypot(centerLocalX - expectedCenterLocalX, centerLocalY - expectedCenterLocalY);
  const expectedRadiusDistance = Math.abs(radiusPx - expectedRadiusPx);
  const centerPenalty = clamp(expectedCenterDistance / Math.max(1, 330 * scale), 0, 1) * 0.035;
  const radiusPenalty = clamp(expectedRadiusDistance / Math.max(1, 18 * scale), 0, 1) * 0.025;
  const score = clamp(
    averageEdgeScore * 0.54 +
      hitRatio * 0.24 +
      continuityScore * 0.16 +
      coverage * 0.06 -
      centerPenalty -
      radiusPenalty,
    0,
    1,
  );

  return {
    centerLocalX,
    centerLocalY,
    radiusPx,
    score,
    averageEdgeScore,
    hitRatio,
    coverage,
    continuityScore,
    samples,
  };
}

function insertTopCandidate(
  topCandidates: RuneliteMinimapGeometryCandidate[],
  candidate: RuneliteMinimapGeometryCandidate | null,
): void {
  if (!candidate) {
    return;
  }

  topCandidates.push(candidate);
  topCandidates.sort((a, b) => b.score - a.score);
  if (topCandidates.length > RUNELITE_MINIMAP_TOP_CANDIDATE_COUNT) {
    topCandidates.length = RUNELITE_MINIMAP_TOP_CANDIDATE_COUNT;
  }
}

function formatCandidate(candidate: RuneliteMinimapGeometryCandidate): string {
  return `${candidate.centerLocalX},${candidate.centerLocalY}/r${candidate.radiusPx}/score=${candidate.score.toFixed(2)}/edge=${candidate.averageEdgeScore.toFixed(2)}/hit=${candidate.hitRatio.toFixed(2)}/cont=${candidate.continuityScore.toFixed(2)}`;
}

function buildSummary(candidates: readonly RuneliteMinimapGeometryCandidate[]): string {
  if (candidates.length === 0) {
    return "top=[]";
  }

  return `top=[${candidates.slice(0, 4).map(formatCandidate).join(";")}]`;
}

function isSameCacheRequest(
  cached: CachedRuneliteMinimapDetection,
  scale: number,
  expectedCenterLocalX: number,
  expectedCenterLocalY: number,
  expectedRadiusPx: number,
  minScore: number,
): boolean {
  return (
    Math.abs(cached.scale - scale) < 0.001 &&
    Math.abs(cached.expectedCenterLocalX - expectedCenterLocalX) <= 1 &&
    Math.abs(cached.expectedCenterLocalY - expectedCenterLocalY) <= 1 &&
    Math.abs(cached.expectedRadiusPx - expectedRadiusPx) <= 1 &&
    Math.abs(cached.minScore - minScore) < 0.001
  );
}

export function searchRuneliteMinimapGeometry(
  bitmap: ScreenBitmap,
  options: RuneliteMinimapGeometryDetectionOptions,
): RuneliteMinimapGeometrySearchResult {
  const scale = Number.isFinite(options.scale) && options.scale > 0 ? options.scale : 1;
  const expectedRadiusPx = options.expectedRadiusPx ?? clamp(Math.round(RUNELITE_MINIMAP_RADIUS_LOGICAL * scale), 55, 108);
  const expectedTilePx = options.expectedTilePx ?? clamp(Math.round(RUNELITE_MINIMAP_TILE_PX_LOGICAL * scale), 3, 7);
  const expectedCenterLocalX =
    options.expectedCenterLocalX ?? bitmap.width - Math.round(RUNELITE_MINIMAP_CENTER_RIGHT_OFFSET_LOGICAL * scale);
  const expectedCenterLocalY = options.expectedCenterLocalY ?? Math.round(RUNELITE_MINIMAP_CENTER_Y_LOGICAL * scale);
  const minScore = options.minScore ?? RUNELITE_MINIMAP_CONTOUR_MIN_SCORE;
  const cached = detectionCache.get(bitmap);
  if (cached && isSameCacheRequest(cached, scale, expectedCenterLocalX, expectedCenterLocalY, expectedRadiusPx, minScore)) {
    return cached.result;
  }

  const centerStep = Math.max(3, Math.round(RUNELITE_MINIMAP_COARSE_CENTER_STEP_LOGICAL * scale));
  const radiusStep = Math.max(2, Math.round(RUNELITE_MINIMAP_COARSE_RADIUS_STEP_LOGICAL * scale));
  const centerXMin = Math.max(
    0,
    Math.min(bitmap.width - 1, Math.max(Math.floor(bitmap.width * 0.52), bitmap.width - Math.round(620 * scale))),
  );
  const centerXMax = Math.max(centerXMin, bitmap.width - Math.round(34 * scale));
  const centerYMin = Math.max(Math.round(42 * scale), expectedRadiusPx - Math.round(38 * scale));
  const centerYMax = Math.min(
    bitmap.height - expectedRadiusPx - 1,
    Math.max(centerYMin, Math.round(126 * scale)),
  );
  const radiusMin = Math.max(48, Math.round(60 * scale));
  const radiusMax = Math.min(
    108,
    Math.max(radiusMin, expectedRadiusPx + Math.round(8 * scale)),
  );
  const coarseSamplePoints = getCircleSamplePoints(RUNELITE_MINIMAP_COARSE_SAMPLE_COUNT, RUNELITE_MINIMAP_BUCKET_COUNT);
  const refinedSamplePoints = getCircleSamplePoints(RUNELITE_MINIMAP_REFINED_SAMPLE_COUNT, RUNELITE_MINIMAP_BUCKET_COUNT);
  const seedCandidates: RuneliteMinimapGeometryCandidate[] = [];
  const centerSeeds = findMinimapCenterSeeds(bitmap, scale);
  for (const seed of centerSeeds) {
    for (let centerY = seed.centerLocalY - 3; centerY <= seed.centerLocalY + 3; centerY += 3) {
      for (let centerX = seed.centerLocalX - 3; centerX <= seed.centerLocalX + 3; centerX += 3) {
        for (let radiusPx = radiusMin; radiusPx <= radiusMax; radiusPx += 2) {
          insertTopCandidate(
            seedCandidates,
            scoreRuneliteMinimapCandidate(
              bitmap,
              centerX,
              centerY,
              radiusPx,
              scale,
              expectedCenterLocalX,
              expectedCenterLocalY,
              expectedRadiusPx,
              refinedSamplePoints,
            ),
          );
        }
      }
    }
  }

  const bestSeed = seedCandidates[0] ?? null;
  if (bestSeed && bestSeed.score >= minScore && bestSeed.hitRatio >= 0.28 && bestSeed.continuityScore >= 0.38) {
    const summary = `${buildSummary(seedCandidates)} seeds=${centerSeeds.length}`;
    const detection: RuneliteMinimapGeometryDetection = {
      centerLocalX: bestSeed.centerLocalX,
      centerLocalY: bestSeed.centerLocalY,
      radiusPx: bestSeed.radiusPx,
      tilePx: expectedTilePx,
      score: bestSeed.score,
      source: "detected-from-contour",
      expectedCenterLocalX,
      expectedCenterLocalY,
      expectedRadiusPx,
      candidates: seedCandidates.slice(0, RUNELITE_MINIMAP_TOP_CANDIDATE_COUNT),
      summary,
    };
    const result: RuneliteMinimapGeometrySearchResult = {
      detection,
      expectedCenterLocalX,
      expectedCenterLocalY,
      expectedRadiusPx,
      candidates: seedCandidates.slice(0, RUNELITE_MINIMAP_TOP_CANDIDATE_COUNT),
      summary,
    };

    detectionCache.set(bitmap, {
      scale,
      expectedCenterLocalX,
      expectedCenterLocalY,
      expectedRadiusPx,
      minScore,
      result,
    });

    return result;
  }

  const coarseCandidates: RuneliteMinimapGeometryCandidate[] = [];

  for (let centerY = centerYMin; centerY <= centerYMax; centerY += centerStep) {
    for (let centerX = centerXMin; centerX <= centerXMax; centerX += centerStep) {
      for (let radiusPx = radiusMin; radiusPx <= radiusMax; radiusPx += radiusStep) {
        insertTopCandidate(
          coarseCandidates,
          scoreRuneliteMinimapCandidate(
            bitmap,
            Math.round(centerX),
            Math.round(centerY),
            Math.round(radiusPx),
            scale,
            expectedCenterLocalX,
            expectedCenterLocalY,
            expectedRadiusPx,
            coarseSamplePoints,
          ),
        );
      }
    }
  }

  const refinedCandidates: RuneliteMinimapGeometryCandidate[] = [];
  for (const coarseCandidate of coarseCandidates.slice(0, 5)) {
    const refineCenterRange = Math.max(3, centerStep);
    const refineRadiusRange = Math.max(2, radiusStep);
    for (
      let centerY = coarseCandidate.centerLocalY - refineCenterRange;
      centerY <= coarseCandidate.centerLocalY + refineCenterRange;
      centerY += 1
    ) {
      for (
        let centerX = coarseCandidate.centerLocalX - refineCenterRange;
        centerX <= coarseCandidate.centerLocalX + refineCenterRange;
        centerX += 1
      ) {
        for (
          let radiusPx = coarseCandidate.radiusPx - refineRadiusRange;
          radiusPx <= coarseCandidate.radiusPx + refineRadiusRange;
          radiusPx += 1
        ) {
          insertTopCandidate(
            refinedCandidates,
            scoreRuneliteMinimapCandidate(
              bitmap,
              centerX,
              centerY,
              radiusPx,
            scale,
            expectedCenterLocalX,
            expectedCenterLocalY,
            expectedRadiusPx,
            refinedSamplePoints,
          ),
        );
      }
      }
    }
  }

  const candidates = refinedCandidates.length > 0 ? refinedCandidates : coarseCandidates;
  const best = candidates[0] ?? null;
  const summary = `${buildSummary(candidates)} seeds=${centerSeeds.length}`;
  const detection =
    best && best.score >= minScore && best.hitRatio >= 0.28 && best.continuityScore >= 0.38
      ? {
          centerLocalX: best.centerLocalX,
          centerLocalY: best.centerLocalY,
          radiusPx: best.radiusPx,
          tilePx: expectedTilePx,
          score: best.score,
          source: "detected-from-contour" as const,
          expectedCenterLocalX,
          expectedCenterLocalY,
          expectedRadiusPx,
          candidates: candidates.slice(0, RUNELITE_MINIMAP_TOP_CANDIDATE_COUNT),
          summary,
        }
      : null;
  const result: RuneliteMinimapGeometrySearchResult = {
    detection,
    expectedCenterLocalX,
    expectedCenterLocalY,
    expectedRadiusPx,
    candidates: candidates.slice(0, RUNELITE_MINIMAP_TOP_CANDIDATE_COUNT),
    summary,
  };

  detectionCache.set(bitmap, {
    scale,
    expectedCenterLocalX,
    expectedCenterLocalY,
    expectedRadiusPx,
    minScore,
    result,
  });

  return result;
}

export function detectRuneliteMinimapGeometry(
  bitmap: ScreenBitmap,
  options: RuneliteMinimapGeometryDetectionOptions,
): RuneliteMinimapGeometryDetection | null {
  return searchRuneliteMinimapGeometry(bitmap, options).detection;
}
