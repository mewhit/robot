import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import type { RobotBitmap } from "./ocr-engine";

type GrayscaleImage = {
  width: number;
  height: number;
  data: Uint8Array;
  level: number;
  xScale: number;
  yScale: number;
  featureScale: number;
};

type FastKeypointCandidate = {
  x: number;
  y: number;
  score: number;
};

type OrbKeypoint = {
  x: number;
  y: number;
  levelX: number;
  levelY: number;
  level: number;
  scale: number;
  score: number;
  angle: number;
  descriptor: Uint32Array;
};

type OrbVoteMatch = {
  reference: OrbKeypoint;
  scene: OrbKeypoint;
  distance: number;
  scale: number;
  rotation: number;
  voteCenterX: number;
  voteCenterY: number;
};

type BriefPair = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
};

type SalientReferenceSample = {
  x: number;
  y: number;
  weight: number;
  pixel: {
    b: number;
    g: number;
    r: number;
  };
};

export type BankDepositOrbMatch = {
  referenceX: number;
  referenceY: number;
  sceneX: number;
  sceneY: number;
  distance: number;
};

export type BankDepositOrbDetection = {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  score: number;
  appearanceScore: number;
  rawMatchCount: number;
  inlierCount: number;
  medianDistance: number;
  scale: number;
  rotationDeg: number;
  matches: BankDepositOrbMatch[];
};

export type BankDepositOrbDetectorResult = {
  detection: BankDepositOrbDetection | null;
  referenceKeypointCount: number;
  sceneKeypointCount: number;
  rawMatchCount: number;
  inlierCount: number;
};

type SearchBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const FAST_CIRCLE: ReadonlyArray<readonly [number, number]> = [
  [0, -3],
  [1, -3],
  [2, -2],
  [3, -1],
  [3, 0],
  [3, 1],
  [2, 2],
  [1, 3],
  [0, 3],
  [-1, 3],
  [-2, 2],
  [-3, 1],
  [-3, 0],
  [-3, -1],
  [-2, -2],
  [-1, -3],
];

const PYRAMID_SCALE = 1.2;
const MAX_PYRAMID_LEVELS = 5;
const ORB_PATCH_RADIUS = 12;
const ORB_EDGE_MARGIN = ORB_PATCH_RADIUS + 1;
const FAST_ARC_LENGTH = 9;
const REFERENCE_FAST_THRESHOLD = 10;
const SCENE_FAST_THRESHOLD = 12;
const REFERENCE_MAX_KEYPOINTS = 120;
const SCENE_MAX_KEYPOINTS = 4000;
const MAX_DESCRIPTOR_DISTANCE = 152;
const MAX_SCENE_MATCHES_PER_REFERENCE = 20;
const MAX_DISTANCE_FROM_BEST = 40;
const CENTER_BIN_SIZE = 10;
const MIN_INLIER_MATCHES = 2;
const CENTER_INLIER_TOLERANCE = 28;
const MIN_APPEARANCE_SCORE = 0.75;
const STRONG_APPEARANCE_SCORE = 0.88;
const SALIENT_SAMPLE_CELL_SIZE = 3;
const BRIEF_PAIR_COUNT = 256;
const BRIEF_WORD_COUNT = BRIEF_PAIR_COUNT / 32;
const SEARCH_LEFT_RATIO = 0.04;
const SEARCH_RIGHT_RATIO = 0.9;
const SEARCH_TOP_RATIO = 0.04;
const SEARCH_BOTTOM_RATIO = 0.87;

const BRIEF_PAIRS = createBriefPairs(0xc0ffee, BRIEF_PAIR_COUNT, ORB_PATCH_RADIUS);
const POPCOUNT_TABLE = createPopcountTable();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function resolveBankDepositOrbSearchBounds(bitmap: RobotBitmap): SearchBounds {
  const minX = clamp(Math.round(bitmap.width * SEARCH_LEFT_RATIO), 0, bitmap.width - 1);
  const maxX = clamp(Math.round(bitmap.width * SEARCH_RIGHT_RATIO), minX + 1, bitmap.width);
  const minY = clamp(Math.round(bitmap.height * SEARCH_TOP_RATIO), 0, bitmap.height - 1);
  const maxY = clamp(Math.round(bitmap.height * SEARCH_BOTTOM_RATIO), minY + 1, bitmap.height);

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function normalizeAngleRadians(angle: number): number {
  let normalized = angle;
  while (normalized > Math.PI) {
    normalized -= Math.PI * 2;
  }
  while (normalized <= -Math.PI) {
    normalized += Math.PI * 2;
  }
  return normalized;
}

function angleDistanceRadians(a: number, b: number): number {
  return Math.abs(normalizeAngleRadians(a - b));
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function weightedCircularMean(values: number[], weights: number[]): number {
  let sumX = 0;
  let sumY = 0;

  for (let i = 0; i < values.length; i += 1) {
    const weight = weights[i] ?? 1;
    sumX += Math.cos(values[i]) * weight;
    sumY += Math.sin(values[i]) * weight;
  }

  return Math.atan2(sumY, sumX);
}

function createPopcountTable(): Uint8Array {
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    let count = 0;
    while (value > 0) {
      count += value & 1;
      value >>= 1;
    }
    table[i] = count;
  }
  return table;
}

function popcount32(value: number): number {
  return (
    POPCOUNT_TABLE[value & 0xff] +
    POPCOUNT_TABLE[(value >>> 8) & 0xff] +
    POPCOUNT_TABLE[(value >>> 16) & 0xff] +
    POPCOUNT_TABLE[(value >>> 24) & 0xff]
  );
}

function hammingDistance(a: Uint32Array, b: Uint32Array): number {
  let distance = 0;
  for (let i = 0; i < BRIEF_WORD_COUNT; i += 1) {
    distance += popcount32(a[i] ^ b[i]);
  }
  return distance;
}

function toGrayscale(bitmap: RobotBitmap): GrayscaleImage {
  const gray = new Uint8Array(bitmap.width * bitmap.height);

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const pixelOffset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[pixelOffset];
      const g = bitmap.image[pixelOffset + 1];
      const r = bitmap.image[pixelOffset + 2];
      gray[y * bitmap.width + x] = (r * 77 + g * 150 + b * 29) >> 8;
    }
  }

  return {
    width: bitmap.width,
    height: bitmap.height,
    data: gray,
    level: 0,
    xScale: 1,
    yScale: 1,
    featureScale: 1,
  };
}

function sampleGrayBilinear(image: GrayscaleImage, x: number, y: number): number {
  const clampedX = clamp(x, 0, image.width - 1);
  const clampedY = clamp(y, 0, image.height - 1);

  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const tx = clampedX - x0;
  const ty = clampedY - y0;

  const i00 = image.data[y0 * image.width + x0];
  const i10 = image.data[y0 * image.width + x1];
  const i01 = image.data[y1 * image.width + x0];
  const i11 = image.data[y1 * image.width + x1];

  const top = i00 * (1 - tx) + i10 * tx;
  const bottom = i01 * (1 - tx) + i11 * tx;
  return top * (1 - ty) + bottom * ty;
}

function resizeGrayscaleBilinear(source: GrayscaleImage, width: number, height: number): Uint8Array {
  const resized = new Uint8Array(width * height);
  const scaleX = source.width / width;
  const scaleY = source.height / height;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = (x + 0.5) * scaleX - 0.5;
      const sourceY = (y + 0.5) * scaleY - 0.5;
      resized[y * width + x] = Math.round(sampleGrayBilinear(source, sourceX, sourceY));
    }
  }

  return resized;
}

function buildPyramid(baseImage: GrayscaleImage): GrayscaleImage[] {
  const minDimension = ORB_EDGE_MARGIN * 2 + 1;
  const levels: GrayscaleImage[] = [baseImage];

  for (let level = 1; level < MAX_PYRAMID_LEVELS; level += 1) {
    const previous = levels[levels.length - 1];
    const nextWidth = Math.round(previous.width / PYRAMID_SCALE);
    const nextHeight = Math.round(previous.height / PYRAMID_SCALE);

    if (nextWidth < minDimension || nextHeight < minDimension) {
      break;
    }

    if (nextWidth === previous.width || nextHeight === previous.height) {
      break;
    }

    levels.push({
      width: nextWidth,
      height: nextHeight,
      data: resizeGrayscaleBilinear(previous, nextWidth, nextHeight),
      level,
      xScale: baseImage.width / nextWidth,
      yScale: baseImage.height / nextHeight,
      featureScale: (baseImage.width / nextWidth + baseImage.height / nextHeight) / 2,
    });
  }

  return levels;
}

function detectFastCandidates(image: GrayscaleImage, threshold: number): FastKeypointCandidate[] {
  const scores = new Int32Array(image.width * image.height);

  for (let y = ORB_EDGE_MARGIN; y < image.height - ORB_EDGE_MARGIN; y += 1) {
    for (let x = ORB_EDGE_MARGIN; x < image.width - ORB_EDGE_MARGIN; x += 1) {
      const centerIndex = y * image.width + x;
      const center = image.data[centerIndex];

      let quickBrightCount = 0;
      let quickDarkCount = 0;
      for (const quickIndex of [0, 4, 8, 12]) {
        const [dx, dy] = FAST_CIRCLE[quickIndex];
        const sample = image.data[(y + dy) * image.width + (x + dx)];
        if (sample > center + threshold) {
          quickBrightCount += 1;
        } else if (sample < center - threshold) {
          quickDarkCount += 1;
        }
      }

      if (quickBrightCount < 3 && quickDarkCount < 3) {
        continue;
      }

      const diffs = new Int16Array(FAST_CIRCLE.length);
      let score = 0;

      for (let i = 0; i < FAST_CIRCLE.length; i += 1) {
        const [dx, dy] = FAST_CIRCLE[i];
        const sample = image.data[(y + dy) * image.width + (x + dx)];
        const diff = sample - center;
        diffs[i] = diff;
        if (Math.abs(diff) > threshold) {
          score += Math.abs(diff);
        }
      }

      let brightRun = 0;
      let darkRun = 0;
      let isCorner = false;

      for (let i = 0; i < FAST_CIRCLE.length + FAST_ARC_LENGTH - 1; i += 1) {
        const diff = diffs[i % FAST_CIRCLE.length];

        if (diff > threshold) {
          brightRun += 1;
          darkRun = 0;
        } else if (diff < -threshold) {
          darkRun += 1;
          brightRun = 0;
        } else {
          brightRun = 0;
          darkRun = 0;
        }

        if (brightRun >= FAST_ARC_LENGTH || darkRun >= FAST_ARC_LENGTH) {
          isCorner = true;
          break;
        }
      }

      if (isCorner) {
        scores[centerIndex] = score;
      }
    }
  }

  const candidates: FastKeypointCandidate[] = [];
  for (let y = ORB_EDGE_MARGIN; y < image.height - ORB_EDGE_MARGIN; y += 1) {
    for (let x = ORB_EDGE_MARGIN; x < image.width - ORB_EDGE_MARGIN; x += 1) {
      const centerIndex = y * image.width + x;
      const score = scores[centerIndex];
      if (score === 0) {
        continue;
      }

      let isMax = true;
      for (let dy = -1; dy <= 1 && isMax; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }

          if (scores[(y + dy) * image.width + (x + dx)] > score) {
            isMax = false;
            break;
          }
        }
      }

      if (!isMax) {
        continue;
      }

      candidates.push({ x, y, score });
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}

function computeOrientation(image: GrayscaleImage, x: number, y: number): number {
  let m10 = 0;
  let m01 = 0;

  for (let dy = -ORB_PATCH_RADIUS; dy <= ORB_PATCH_RADIUS; dy += 1) {
    const row = y + dy;
    const maxDx = Math.floor(Math.sqrt(ORB_PATCH_RADIUS * ORB_PATCH_RADIUS - dy * dy));
    for (let dx = -maxDx; dx <= maxDx; dx += 1) {
      const intensity = image.data[row * image.width + (x + dx)];
      m10 += dx * intensity;
      m01 += dy * intensity;
    }
  }

  return Math.atan2(m01, m10);
}

function createBriefPairs(seed: number, count: number, radius: number): BriefPair[] {
  let state = seed >>> 0;
  const nextRandom = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };

  const points: Array<{ x: number; y: number }> = [];

  while (points.length < count * 2) {
    const x = Math.round((nextRandom() * 2 - 1) * radius);
    const y = Math.round((nextRandom() * 2 - 1) * radius);
    if (x * x + y * y > radius * radius) {
      continue;
    }
    points.push({ x, y });
  }

  const pairs: BriefPair[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = points[i * 2];
    const b = points[i * 2 + 1];
    pairs.push({
      ax: a.x,
      ay: a.y,
      bx: b.x,
      by: b.y,
    });
  }

  return pairs;
}

function computeDescriptor(image: GrayscaleImage, x: number, y: number, angle: number): Uint32Array {
  const descriptor = new Uint32Array(BRIEF_WORD_COUNT);
  const cosAngle = Math.cos(angle);
  const sinAngle = Math.sin(angle);

  for (let i = 0; i < BRIEF_PAIRS.length; i += 1) {
    const pair = BRIEF_PAIRS[i];

    const ax = x + pair.ax * cosAngle - pair.ay * sinAngle;
    const ay = y + pair.ax * sinAngle + pair.ay * cosAngle;
    const bx = x + pair.bx * cosAngle - pair.by * sinAngle;
    const by = y + pair.bx * sinAngle + pair.by * cosAngle;

    if (sampleGrayBilinear(image, ax, ay) < sampleGrayBilinear(image, bx, by)) {
      descriptor[i >>> 5] |= 1 << (i & 31);
    }
  }

  return descriptor;
}

function extractOrbKeypoints(
  bitmap: RobotBitmap,
  fastThreshold: number,
  maxKeypoints: number,
): OrbKeypoint[] {
  const pyramid = buildPyramid(toGrayscale(bitmap));
  const keypoints: OrbKeypoint[] = [];
  const levelBudget = Math.max(10, Math.ceil(maxKeypoints / pyramid.length));

  for (const image of pyramid) {
    const candidates = detectFastCandidates(image, fastThreshold);
    const budget = image.level === 0 ? levelBudget + Math.floor(levelBudget / 2) : levelBudget;
    const selected = candidates.slice(0, budget);

    for (const candidate of selected) {
      const angle = computeOrientation(image, candidate.x, candidate.y);
      keypoints.push({
        x: candidate.x * image.xScale,
        y: candidate.y * image.yScale,
        levelX: candidate.x,
        levelY: candidate.y,
        level: image.level,
        scale: image.featureScale,
        score: candidate.score,
        angle,
        descriptor: computeDescriptor(image, candidate.x, candidate.y, angle),
      });
    }
  }

  return keypoints.sort((a, b) => b.score - a.score).slice(0, maxKeypoints);
}

function matchOrbFeatures(
  referenceKeypoints: OrbKeypoint[],
  sceneKeypoints: OrbKeypoint[],
  referenceWidth: number,
  referenceHeight: number,
): OrbVoteMatch[] {
  const provisionalMatches: Array<{ refIndex: number; sceneIndex: number; distance: number }> = [];

  for (let refIndex = 0; refIndex < referenceKeypoints.length; refIndex += 1) {
    const reference = referenceKeypoints[refIndex];
    const candidateDistances: Array<{ sceneIndex: number; distance: number }> = [];

    for (let sceneIndex = 0; sceneIndex < sceneKeypoints.length; sceneIndex += 1) {
      const scene = sceneKeypoints[sceneIndex];
      const distance = hammingDistance(reference.descriptor, scene.descriptor);
      candidateDistances.push({ sceneIndex, distance });
    }

    candidateDistances.sort((a, b) => a.distance - b.distance);
    const bestDistance = candidateDistances[0]?.distance;
    if (bestDistance === undefined) {
      continue;
    }

    for (const candidate of candidateDistances.slice(0, MAX_SCENE_MATCHES_PER_REFERENCE)) {
      if (candidate.distance > bestDistance + MAX_DISTANCE_FROM_BEST) {
        continue;
      }

      provisionalMatches.push({
        refIndex,
        sceneIndex: candidate.sceneIndex,
        distance: candidate.distance,
      });
    }
  }

  const matches: OrbVoteMatch[] = [];
  for (const provisionalMatch of provisionalMatches) {
    const reference = referenceKeypoints[provisionalMatch.refIndex];
    const scene = sceneKeypoints[provisionalMatch.sceneIndex];
    const scale = scene.scale / reference.scale;
    if (!Number.isFinite(scale) || scale <= 0 || scale > 4) {
      continue;
    }

    const rotation = normalizeAngleRadians(scene.angle - reference.angle);
    const referenceDx = reference.x - referenceWidth / 2;
    const referenceDy = reference.y - referenceHeight / 2;

    matches.push({
      reference,
      scene,
      distance: provisionalMatch.distance,
      scale,
      rotation,
      voteCenterX: scene.x - referenceDx,
      voteCenterY: scene.y - referenceDy,
    });
  }

  return matches.sort((a, b) => a.distance - b.distance);
}

function getMatchWeight(match: OrbVoteMatch): number {
  return Math.max(1, MAX_DESCRIPTOR_DISTANCE - match.distance + 1);
}

function computeWeightedCenter(matches: OrbVoteMatch[]): { x: number; y: number } {
  let sumX = 0;
  let sumY = 0;
  let totalWeight = 0;

  for (const match of matches) {
    const weight = getMatchWeight(match);
    sumX += match.voteCenterX * weight;
    sumY += match.voteCenterY * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: sumX / totalWeight,
    y: sumY / totalWeight,
  };
}

function computeTransformedBounds(
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  scale: number,
  rotation: number,
): { x: number; y: number; width: number; height: number } {
  const corners: Array<[number, number]> = [
    [-width / 2, -height / 2],
    [width / 2, -height / 2],
    [width / 2, height / 2],
    [-width / 2, height / 2],
  ];

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const [cornerX, cornerY] of corners) {
    const rotatedX = centerX + (cornerX * Math.cos(rotation) - cornerY * Math.sin(rotation)) * scale;
    const rotatedY = centerY + (cornerX * Math.sin(rotation) + cornerY * Math.cos(rotation)) * scale;
    minX = Math.min(minX, rotatedX);
    minY = Math.min(minY, rotatedY);
    maxX = Math.max(maxX, rotatedX);
    maxY = Math.max(maxY, rotatedY);
  }

  const x = Math.floor(minX);
  const y = Math.floor(minY);
  return {
    x,
    y,
    width: Math.max(1, Math.ceil(maxX) - x),
    height: Math.max(1, Math.ceil(maxY) - y),
  };
}

function readBitmapPixel(bitmap: RobotBitmap, x: number, y: number): { b: number; g: number; r: number; a: number } {
  const clampedX = clamp(Math.round(x), 0, bitmap.width - 1);
  const clampedY = clamp(Math.round(y), 0, bitmap.height - 1);
  const offset = clampedY * bitmap.byteWidth + clampedX * bitmap.bytesPerPixel;
  return {
    b: bitmap.image[offset],
    g: bitmap.image[offset + 1],
    r: bitmap.image[offset + 2],
    a: bitmap.image[offset + 3] ?? 255,
  };
}

function sampleBitmapPixel(bitmap: RobotBitmap, x: number, y: number): { b: number; g: number; r: number; a: number } {
  const clampedX = clamp(x, 0, bitmap.width - 1);
  const clampedY = clamp(y, 0, bitmap.height - 1);

  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(bitmap.width - 1, x0 + 1);
  const y1 = Math.min(bitmap.height - 1, y0 + 1);
  const tx = clampedX - x0;
  const ty = clampedY - y0;

  const p00 = readBitmapPixel(bitmap, x0, y0);
  const p10 = readBitmapPixel(bitmap, x1, y0);
  const p01 = readBitmapPixel(bitmap, x0, y1);
  const p11 = readBitmapPixel(bitmap, x1, y1);

  const mix = (a: number, b: number, c: number, d: number): number => {
    const top = a * (1 - tx) + b * tx;
    const bottom = c * (1 - tx) + d * tx;
    return top * (1 - ty) + bottom * ty;
  };

  return {
    b: mix(p00.b, p10.b, p01.b, p11.b),
    g: mix(p00.g, p10.g, p01.g, p11.g),
    r: mix(p00.r, p10.r, p01.r, p11.r),
    a: mix(p00.a, p10.a, p01.a, p11.a),
  };
}

function computeAppearanceWeight(referenceBitmap: RobotBitmap, x: number, y: number): number {
  const center = readBitmapPixel(referenceBitmap, x, y);
  if (center.a < 96) {
    return 0;
  }

  const left = readBitmapPixel(referenceBitmap, Math.max(0, x - 1), y);
  const right = readBitmapPixel(referenceBitmap, Math.min(referenceBitmap.width - 1, x + 1), y);
  const up = readBitmapPixel(referenceBitmap, x, Math.max(0, y - 1));
  const down = readBitmapPixel(referenceBitmap, x, Math.min(referenceBitmap.height - 1, y + 1));

  const grayscale = (pixel: { b: number; g: number; r: number }): number => (pixel.r * 77 + pixel.g * 150 + pixel.b * 29) >> 8;
  const gradient =
    Math.abs(grayscale(right) - grayscale(left)) + Math.abs(grayscale(down) - grayscale(up));
  const saturation = Math.max(center.r, center.g, center.b) - Math.min(center.r, center.g, center.b);
  const greenDominance = center.g - Math.max(center.r, center.b);
  const brownishDominance = center.r - center.g + (center.g - center.b);

  return (
    1 +
    gradient / 40 +
    saturation / 30 +
    Math.max(0, greenDominance) / 14 +
    Math.max(0, brownishDominance - 18) / 28
  );
}

function computeAppearanceScore(
  referenceBitmap: RobotBitmap,
  screenshotBitmap: RobotBitmap,
  centerX: number,
  centerY: number,
  scale: number,
  rotation: number,
): number {
  const referenceCenterX = referenceBitmap.width / 2;
  const referenceCenterY = referenceBitmap.height / 2;
  const cosRotation = Math.cos(rotation);
  const sinRotation = Math.sin(rotation);

  let weightedError = 0;
  let totalWeight = 0;

  for (let y = 0; y < referenceBitmap.height; y += 1) {
    for (let x = 0; x < referenceBitmap.width; x += 1) {
      const weight = computeAppearanceWeight(referenceBitmap, x, y);
      const referencePixel = readBitmapPixel(referenceBitmap, x, y);
      const localX = (x + 0.5 - referenceCenterX) * scale;
      const localY = (y + 0.5 - referenceCenterY) * scale;
      const sceneX = centerX + localX * cosRotation - localY * sinRotation;
      const sceneY = centerY + localX * sinRotation + localY * cosRotation;
      const scenePixel = sampleBitmapPixel(screenshotBitmap, sceneX, sceneY);

      weightedError +=
        weight *
        ((Math.abs(referencePixel.r - scenePixel.r) +
          Math.abs(referencePixel.g - scenePixel.g) +
          Math.abs(referencePixel.b - scenePixel.b)) /
          3);
      totalWeight += weight;
    }
  }

  if (totalWeight === 0) {
    return 0;
  }

  return clamp(1 - weightedError / (totalWeight * 255), 0, 1);
}

function buildSalientReferenceSamples(referenceBitmap: RobotBitmap): SalientReferenceSample[] {
  const samples: SalientReferenceSample[] = [];

  for (let cellTop = 0; cellTop < referenceBitmap.height; cellTop += SALIENT_SAMPLE_CELL_SIZE) {
    for (let cellLeft = 0; cellLeft < referenceBitmap.width; cellLeft += SALIENT_SAMPLE_CELL_SIZE) {
      let bestSample: SalientReferenceSample | null = null;

      for (
        let y = cellTop;
        y < Math.min(referenceBitmap.height, cellTop + SALIENT_SAMPLE_CELL_SIZE);
        y += 1
      ) {
        for (
          let x = cellLeft;
          x < Math.min(referenceBitmap.width, cellLeft + SALIENT_SAMPLE_CELL_SIZE);
          x += 1
        ) {
          const weight = computeAppearanceWeight(referenceBitmap, x, y);
          if (weight <= 0) {
            continue;
          }

          const sample = {
            x,
            y,
            weight,
            pixel: readBitmapPixel(referenceBitmap, x, y),
          };

          if (!bestSample || sample.weight > bestSample.weight) {
            bestSample = sample;
          }
        }
      }

      if (bestSample) {
        samples.push(bestSample);
      }
    }
  }

  return samples.sort((a, b) => b.weight - a.weight);
}

function findBestReferencePatchMatch(
  referenceBitmap: RobotBitmap,
  screenshotBitmap: RobotBitmap,
): { topLeftX: number; topLeftY: number; centerX: number; centerY: number; appearanceScore: number } | null {
  if (screenshotBitmap.width < referenceBitmap.width || screenshotBitmap.height < referenceBitmap.height) {
    return null;
  }

  const samples = buildSalientReferenceSamples(referenceBitmap);
  if (samples.length === 0) {
    return null;
  }

  const totalWeight = samples.reduce((sum, sample) => sum + sample.weight, 0);
  let bestScore = Number.POSITIVE_INFINITY;
  let bestX = 0;
  let bestY = 0;
  let bestCenterDistance = Number.POSITIVE_INFINITY;
  let bestDenseAppearanceScore = Number.NEGATIVE_INFINITY;
  const preferredCenterX = screenshotBitmap.width / 2;
  const preferredCenterY = screenshotBitmap.height / 2;

  for (let topY = 0; topY <= screenshotBitmap.height - referenceBitmap.height; topY += 1) {
    for (let topX = 0; topX <= screenshotBitmap.width - referenceBitmap.width; topX += 1) {
      let score = 0;

      for (const sample of samples) {
        const screenshotPixel = readBitmapPixel(screenshotBitmap, topX + sample.x, topY + sample.y);
        score +=
          sample.weight *
          ((Math.abs(screenshotPixel.r - sample.pixel.r) +
            Math.abs(screenshotPixel.g - sample.pixel.g) +
            Math.abs(screenshotPixel.b - sample.pixel.b)) /
            3);

        if (score >= bestScore) {
          break;
        }
      }

      const centerX = topX + referenceBitmap.width / 2;
      const centerY = topY + referenceBitmap.height / 2;
      const centerDistance = Math.hypot(centerX - preferredCenterX, centerY - preferredCenterY);
      const denseAppearanceScore =
        score <= bestScore + 0.001
          ? computeAppearanceScore(referenceBitmap, screenshotBitmap, centerX, centerY, 1, 0)
          : Number.NEGATIVE_INFINITY;

      if (score < bestScore - 0.001) {
        bestScore = score;
        bestX = topX;
        bestY = topY;
        bestCenterDistance = centerDistance;
        bestDenseAppearanceScore = denseAppearanceScore;
        continue;
      }

      if (
        Math.abs(score - bestScore) <= 0.001 &&
        (denseAppearanceScore > bestDenseAppearanceScore + 0.001 ||
          (Math.abs(denseAppearanceScore - bestDenseAppearanceScore) <= 0.001 &&
            centerDistance < bestCenterDistance))
      ) {
        bestX = topX;
        bestY = topY;
        bestCenterDistance = centerDistance;
        bestDenseAppearanceScore = denseAppearanceScore;
      }
    }
  }

  return {
    topLeftX: bestX,
    topLeftY: bestY,
    centerX: bestX + referenceBitmap.width / 2,
    centerY: bestY + referenceBitmap.height / 2,
    appearanceScore: clamp(1 - bestScore / (totalWeight * 255), 0, 1),
  };
}

function cropBitmap(bitmap: RobotBitmap, x: number, y: number, width: number, height: number): RobotBitmap {
  const clampedX = clamp(x, 0, bitmap.width - 1);
  const clampedY = clamp(y, 0, bitmap.height - 1);
  const cropWidth = Math.max(1, Math.min(width, bitmap.width - clampedX));
  const cropHeight = Math.max(1, Math.min(height, bitmap.height - clampedY));
  const image = Buffer.alloc(cropWidth * cropHeight * 4);

  for (let row = 0; row < cropHeight; row += 1) {
    const sourceStart = (clampedY + row) * bitmap.byteWidth + clampedX * bitmap.bytesPerPixel;
    const sourceEnd = sourceStart + cropWidth * bitmap.bytesPerPixel;
    bitmap.image.copy(image, row * cropWidth * 4, sourceStart, sourceEnd);
  }

  return {
    width: cropWidth,
    height: cropHeight,
    byteWidth: cropWidth * 4,
    bytesPerPixel: 4,
    image,
  };
}

function offsetDetectionToSourceBitmap(
  detection: BankDepositOrbDetection | null,
  searchBounds: SearchBounds,
): BankDepositOrbDetection | null {
  if (!detection) {
    return null;
  }

  return {
    ...detection,
    x: detection.x + searchBounds.x,
    y: detection.y + searchBounds.y,
    centerX: detection.centerX + searchBounds.x,
    centerY: detection.centerY + searchBounds.y,
    matches: detection.matches.map((match) => ({
      ...match,
      sceneX: match.sceneX + searchBounds.x,
      sceneY: match.sceneY + searchBounds.y,
    })),
  };
}

function countLocalOrbMatches(referenceBitmap: RobotBitmap, candidateBitmap: RobotBitmap): number {
  const referenceKeypoints = extractOrbKeypoints(
    referenceBitmap,
    REFERENCE_FAST_THRESHOLD,
    REFERENCE_MAX_KEYPOINTS,
  );
  const candidateKeypoints = extractOrbKeypoints(
    candidateBitmap,
    REFERENCE_FAST_THRESHOLD,
    REFERENCE_MAX_KEYPOINTS,
  );

  let matchCount = 0;

  for (const referenceKeypoint of referenceKeypoints) {
    let bestCandidate: OrbKeypoint | null = null;
    let bestDistance = Number.MAX_SAFE_INTEGER;

    for (const candidateKeypoint of candidateKeypoints) {
      const distance = hammingDistance(referenceKeypoint.descriptor, candidateKeypoint.descriptor);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestCandidate = candidateKeypoint;
      }
    }

    if (
      bestCandidate &&
      bestDistance <= 120 &&
      Math.abs(bestCandidate.x - referenceKeypoint.x) <= 6 &&
      Math.abs(bestCandidate.y - referenceKeypoint.y) <= 6
    ) {
      matchCount += 1;
    }
  }

  return matchCount;
}

function buildDetectionFromSeedMatches(
  referenceBitmap: RobotBitmap,
  screenshotBitmap: RobotBitmap,
  matches: OrbVoteMatch[],
  seedMatches: OrbVoteMatch[],
): BankDepositOrbDetection | null {
  if (matches.length < MIN_INLIER_MATCHES || seedMatches.length === 0) {
    return null;
  }

  let center = computeWeightedCenter(seedMatches);
  let inliers = matches.filter(
    (match) => Math.hypot(match.voteCenterX - center.x, match.voteCenterY - center.y) <= CENTER_INLIER_TOLERANCE,
  );

  if (inliers.length < MIN_INLIER_MATCHES) {
    return null;
  }

  const scaleMedian = median(inliers.map((match) => match.scale));
  const rotationWeights = inliers.map((match) => getMatchWeight(match));
  const rotationMean = weightedCircularMean(
    inliers.map((match) => match.rotation),
    rotationWeights,
  );

  const scaleTolerance = Math.max(0.35, scaleMedian * 0.35);
  const refinedInliers = inliers.filter(
    (match) =>
      Math.abs(match.scale - scaleMedian) <= scaleTolerance &&
      angleDistanceRadians(match.rotation, rotationMean) <= Math.PI / 3,
  );

  if (refinedInliers.length >= MIN_INLIER_MATCHES) {
    inliers = refinedInliers;
  }

  center = computeWeightedCenter(inliers);

  const finalScale = median(inliers.map((match) => match.scale));
  const finalRotation = weightedCircularMean(
    inliers.map((match) => match.rotation),
    inliers.map((match) => getMatchWeight(match)),
  );
  const bounds = computeTransformedBounds(
    referenceBitmap.width,
    referenceBitmap.height,
    center.x,
    center.y,
    finalScale,
    finalRotation,
  );
  const appearanceScore = computeAppearanceScore(
    referenceBitmap,
    screenshotBitmap,
    center.x,
    center.y,
    finalScale,
    finalRotation,
  );

  if (appearanceScore < MIN_APPEARANCE_SCORE) {
    return null;
  }

  const medianDistance = median(inliers.map((match) => match.distance));
  const score =
    inliers.length * 120 +
    matches.length * 15 +
    appearanceScore * 240 -
    medianDistance * 2;

  return {
    x: clamp(bounds.x, 0, screenshotBitmap.width - 1),
    y: clamp(bounds.y, 0, screenshotBitmap.height - 1),
    width: Math.min(bounds.width, screenshotBitmap.width),
    height: Math.min(bounds.height, screenshotBitmap.height),
    centerX: Math.round(center.x),
    centerY: Math.round(center.y),
    score,
    appearanceScore,
    rawMatchCount: matches.length,
    inlierCount: inliers.length,
    medianDistance,
    scale: finalScale,
    rotationDeg: (finalRotation * 180) / Math.PI,
    matches: inliers.map((match) => ({
      referenceX: Math.round(match.reference.x),
      referenceY: Math.round(match.reference.y),
      sceneX: Math.round(match.scene.x),
      sceneY: Math.round(match.scene.y),
      distance: match.distance,
    })),
  };
}

function resolveDetection(
  referenceBitmap: RobotBitmap,
  screenshotBitmap: RobotBitmap,
  matches: OrbVoteMatch[],
): BankDepositOrbDetection | null {
  if (matches.length < MIN_INLIER_MATCHES) {
    return null;
  }

  const voteBins = new Map<string, OrbVoteMatch[]>();
  for (const match of matches) {
    const binX = Math.round(match.voteCenterX / CENTER_BIN_SIZE);
    const binY = Math.round(match.voteCenterY / CENTER_BIN_SIZE);
    const key = `${binX},${binY}`;
    const existing = voteBins.get(key);
    if (existing) {
      existing.push(match);
    } else {
      voteBins.set(key, [match]);
    }
  }

  const rankedBins = [...voteBins.values()].sort((a, b) => {
    const aWeight = a.reduce((sum, match) => sum + getMatchWeight(match), 0);
    const bWeight = b.reduce((sum, match) => sum + getMatchWeight(match), 0);
    return bWeight - aWeight;
  });

  let bestDetection: BankDepositOrbDetection | null = null;
  let bestRank = Number.NEGATIVE_INFINITY;

  const appearanceSeed = findBestReferencePatchMatch(referenceBitmap, screenshotBitmap);
  if (appearanceSeed && appearanceSeed.appearanceScore >= MIN_APPEARANCE_SCORE) {
    const candidateCrop = cropBitmap(
      screenshotBitmap,
      appearanceSeed.topLeftX,
      appearanceSeed.topLeftY,
      referenceBitmap.width,
      referenceBitmap.height,
    );
    const localOrbMatchCount = countLocalOrbMatches(referenceBitmap, candidateCrop);
    const bounds = computeTransformedBounds(
      referenceBitmap.width,
      referenceBitmap.height,
      appearanceSeed.centerX,
      appearanceSeed.centerY,
      1,
      0,
    );
    const candidate: BankDepositOrbDetection = {
      x: clamp(bounds.x, 0, screenshotBitmap.width - 1),
      y: clamp(bounds.y, 0, screenshotBitmap.height - 1),
      width: Math.min(bounds.width, screenshotBitmap.width),
      height: Math.min(bounds.height, screenshotBitmap.height),
      centerX: Math.round(appearanceSeed.centerX),
      centerY: Math.round(appearanceSeed.centerY),
      score:
        localOrbMatchCount * 220 +
        appearanceSeed.appearanceScore * 2400 -
        40,
      appearanceScore: appearanceSeed.appearanceScore,
      rawMatchCount: matches.length,
      inlierCount: localOrbMatchCount,
      medianDistance: 0,
      scale: 1,
      rotationDeg: 0,
      matches: [],
    };

    const candidateRank =
      candidate.appearanceScore * 7000 +
      candidate.inlierCount * 120 -
      candidate.medianDistance * 3;

    bestDetection = candidate;
    bestRank = candidateRank;

    if (candidate.appearanceScore >= STRONG_APPEARANCE_SCORE) {
      return candidate;
    }
  }

  for (const seedMatches of rankedBins.slice(0, 24)) {
    const candidate = buildDetectionFromSeedMatches(referenceBitmap, screenshotBitmap, matches, seedMatches);
    if (!candidate) {
      continue;
    }

    const rank =
      candidate.appearanceScore * 6500 +
      candidate.inlierCount * 90 +
      candidate.rawMatchCount * 3 -
      candidate.medianDistance * 3;

    if (rank > bestRank) {
      bestRank = rank;
      bestDetection = candidate;
    }
  }

  return bestDetection;
}

export function detectBankDepositIconWithOrb(
  referenceBitmap: RobotBitmap,
  screenshotBitmap: RobotBitmap,
): BankDepositOrbDetectorResult {
  const searchBounds = resolveBankDepositOrbSearchBounds(screenshotBitmap);
  const searchBitmap = cropBitmap(
    screenshotBitmap,
    searchBounds.x,
    searchBounds.y,
    searchBounds.width,
    searchBounds.height,
  );
  const referenceKeypoints = extractOrbKeypoints(
    referenceBitmap,
    REFERENCE_FAST_THRESHOLD,
    REFERENCE_MAX_KEYPOINTS,
  );
  const sceneKeypoints = extractOrbKeypoints(searchBitmap, SCENE_FAST_THRESHOLD, SCENE_MAX_KEYPOINTS);
  const matches = matchOrbFeatures(
    referenceKeypoints,
    sceneKeypoints,
    referenceBitmap.width,
    referenceBitmap.height,
  );
  const detection = offsetDetectionToSourceBitmap(
    resolveDetection(referenceBitmap, searchBitmap, matches),
    searchBounds,
  );

  return {
    detection,
    referenceKeypointCount: referenceKeypoints.length,
    sceneKeypointCount: sceneKeypoints.length,
    rawMatchCount: matches.length,
    inlierCount: detection?.inlierCount ?? 0,
  };
}

function setPngPixel(
  png: PNG,
  x: number,
  y: number,
  color: { r: number; g: number; b: number },
): void {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) {
    return;
  }

  const index = (y * png.width + x) * 4;
  png.data[index] = color.r;
  png.data[index + 1] = color.g;
  png.data[index + 2] = color.b;
  png.data[index + 3] = 255;
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
  const x0 = clamp(x, 0, png.width - 1);
  const y0 = clamp(y, 0, png.height - 1);
  const x1 = clamp(x + width - 1, 0, png.width - 1);
  const y1 = clamp(y + height - 1, 0, png.height - 1);

  for (let t = 0; t < thickness; t += 1) {
    for (let drawX = x0 + t; drawX <= x1 - t; drawX += 1) {
      setPngPixel(png, drawX, y0 + t, color);
      setPngPixel(png, drawX, y1 - t, color);
    }

    for (let drawY = y0 + t; drawY <= y1 - t; drawY += 1) {
      setPngPixel(png, x0 + t, drawY, color);
      setPngPixel(png, x1 - t, drawY, color);
    }
  }
}

function drawCrossOnPng(
  png: PNG,
  x: number,
  y: number,
  radius: number,
  color: { r: number; g: number; b: number },
): void {
  for (let offset = -radius; offset <= radius; offset += 1) {
    setPngPixel(png, x + offset, y, color);
    setPngPixel(png, x, y + offset, color);
  }
}

function drawPointOnPng(
  png: PNG,
  x: number,
  y: number,
  color: { r: number; g: number; b: number },
): void {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      setPngPixel(png, x + dx, y + dy, color);
    }
  }
}

export function saveBitmapWithBankDepositOrbDetection(
  bitmap: RobotBitmap,
  result: BankDepositOrbDetectorResult,
  filename: string,
): void {
  const png = new PNG({
    width: bitmap.width,
    height: bitmap.height,
  });

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const pngIndex = (y * bitmap.width + x) * 4;
      const bitmapIndex = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;

      png.data[pngIndex] = bitmap.image[bitmapIndex + 2];
      png.data[pngIndex + 1] = bitmap.image[bitmapIndex + 1];
      png.data[pngIndex + 2] = bitmap.image[bitmapIndex];
      png.data[pngIndex + 3] = 255;
    }
  }

  if (result.detection) {
    drawRectangleOnPng(
      png,
      result.detection.x,
      result.detection.y,
      result.detection.width,
      result.detection.height,
      { r: 0, g: 255, b: 0 },
      3,
    );
    drawCrossOnPng(png, result.detection.centerX, result.detection.centerY, 10, { r: 255, g: 255, b: 0 });

    for (const match of result.detection.matches) {
      drawPointOnPng(png, match.sceneX, match.sceneY, { r: 255, g: 64, b: 64 });
    }
  }

  const directory = path.dirname(filename);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  png.pack().pipe(fs.createWriteStream(filename));
}
