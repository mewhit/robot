import type {
  EndToEndSceneMouseCalibration,
  EndToEndSceneMouseCalibrationFit,
  EndToEndSceneMouseCalibrationProjectiveFit,
  EndToEndSceneMouseCalibrationSample,
} from "../end-to-end-config";
import { getSavedEndToEndConfig, setSavedEndToEndConfig } from "../../csvOperator";
import type { StartupPlayerTileCalibration } from "./startup-calibration";

export const SCENE_MOUSE_CALIBRATION_MIN_SAMPLES = 3;
export const SCENE_MOUSE_CALIBRATION_PROJECTIVE_MIN_SAMPLES = 4;
export const SCENE_MOUSE_CALIBRATION_GOOD_SAMPLES = 5;
export const SCENE_MOUSE_CALIBRATION_MAX_SAMPLES = 64;
export const SCENE_MOUSE_CALIBRATION_MAX_MEAN_ERROR_PX = 22;
export const SCENE_MOUSE_CALIBRATION_MAX_ERROR_PX = 55;
export const SCENE_MOUSE_CALIBRATION_MAX_CAPTURE_DELTA_PX = 24;
const SCENE_MOUSE_CALIBRATION_PROJECTIVE_DENOMINATOR_EPSILON = 1e-5;

export type SceneMouseCalibrationLocalProjection = {
  localX: number;
  localY: number;
  model: "affine" | "projective";
  sampleCount: number;
  meanErrorPx: number;
  maxErrorPx: number;
};

export type SceneMouseCalibrationWorldProjection = SceneMouseCalibrationLocalProjection & {
  screenPoint: { x: number; y: number };
  localPoint: { x: number; y: number };
  dxTiles: number;
  dyTiles: number;
  distanceTiles: number;
  source: "saved-3d-calibration";
};

export type SceneMouseCalibrationActiveFitMetrics = {
  model: "affine" | "projective";
  sampleCount: number;
  meanErrorPx: number;
  maxErrorPx: number;
};

function isProjectiveFitErrorWithinThreshold(fit: EndToEndSceneMouseCalibrationProjectiveFit): boolean {
  return (
    fit.meanErrorPx <= SCENE_MOUSE_CALIBRATION_MAX_MEAN_ERROR_PX &&
    fit.maxErrorPx <= SCENE_MOUSE_CALIBRATION_MAX_ERROR_PX
  );
}

export function getSceneMouseCalibrationProfileKey(calibration: StartupPlayerTileCalibration): string {
  return `scale-${Math.round(calibration.windowsScalePercent)}-capture-${Math.round(
    calibration.captureBounds.width,
  )}x${Math.round(calibration.captureBounds.height)}-runelite-${Math.round(
    calibration.windowBounds.width,
  )}x${Math.round(calibration.windowBounds.height)}`;
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const size = vector.length;
  if (matrix.length !== size || matrix.some((row) => row.length !== size)) {
    return null;
  }

  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivotRow][column])) {
        pivotRow = row;
      }
    }

    if (Math.abs(rows[pivotRow][column]) < 1e-8) {
      return null;
    }

    if (pivotRow !== column) {
      const temp = rows[column];
      rows[column] = rows[pivotRow];
      rows[pivotRow] = temp;
    }

    const pivot = rows[column][column];
    for (let col = column; col <= size; col += 1) {
      rows[column][col] /= pivot;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === column) {
        continue;
      }

      const factor = rows[row][column];
      for (let col = column; col <= size; col += 1) {
        rows[row][col] -= factor * rows[column][col];
      }
    }
  }

  return rows.map((row) => row[size]);
}

function solve3x3(matrix: number[][], vector: number[]): [number, number, number] | null {
  const result = solveLinearSystem(matrix, vector);
  return result ? [result[0], result[1], result[2]] : null;
}

function addNormalEquation(ata: number[][], atb: number[], row: number[], target: number): void {
  for (let r = 0; r < row.length; r += 1) {
    atb[r] += row[r] * target;
    for (let c = 0; c < row.length; c += 1) {
      ata[r][c] += row[r] * row[c];
    }
  }
}

function projectProjectiveFit(
  fit: EndToEndSceneMouseCalibrationProjectiveFit,
  dxTiles: number,
  dyTiles: number,
): { localX: number; localY: number } | null {
  const denominator = fit.wDx * dxTiles + fit.wDy * dyTiles + 1;
  if (!Number.isFinite(denominator) || Math.abs(denominator) < SCENE_MOUSE_CALIBRATION_PROJECTIVE_DENOMINATOR_EPSILON) {
    return null;
  }

  const localX = (fit.xDx * dxTiles + fit.xDy * dyTiles + fit.xOffset) / denominator;
  const localY = (fit.yDx * dxTiles + fit.yDy * dyTiles + fit.yOffset) / denominator;
  if (!Number.isFinite(localX) || !Number.isFinite(localY)) {
    return null;
  }

  return { localX, localY };
}

function projectiveFitErrorPx(
  fit: EndToEndSceneMouseCalibrationProjectiveFit,
  sample: EndToEndSceneMouseCalibrationSample,
): number {
  const predicted = projectProjectiveFit(fit, sample.dxTiles, sample.dyTiles);
  if (!predicted) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.hypot(predicted.localX - sample.localX, predicted.localY - sample.localY);
}

function fitProjectiveSceneMouseCalibrationSamplesOnce(
  samples: readonly EndToEndSceneMouseCalibrationSample[],
): EndToEndSceneMouseCalibrationProjectiveFit | null {
  if (samples.length < SCENE_MOUSE_CALIBRATION_PROJECTIVE_MIN_SAMPLES) {
    return null;
  }

  const size = 8;
  const ata = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
  const atb = Array.from({ length: size }, () => 0);

  for (const sample of samples) {
    const dx = sample.dxTiles;
    const dy = sample.dyTiles;
    addNormalEquation(ata, atb, [dx, dy, 1, 0, 0, 0, -sample.localX * dx, -sample.localX * dy], sample.localX);
    addNormalEquation(ata, atb, [0, 0, 0, dx, dy, 1, -sample.localY * dx, -sample.localY * dy], sample.localY);
  }

  const coefficients = solveLinearSystem(ata, atb);
  if (!coefficients) {
    return null;
  }

  const fit: EndToEndSceneMouseCalibrationProjectiveFit = {
    xDx: coefficients[0],
    xDy: coefficients[1],
    xOffset: coefficients[2],
    yDx: coefficients[3],
    yDy: coefficients[4],
    yOffset: coefficients[5],
    wDx: coefficients[6],
    wDy: coefficients[7],
    sampleCount: samples.length,
    meanErrorPx: 0,
    maxErrorPx: 0,
  };

  let totalError = 0;
  let maxError = 0;
  for (const sample of samples) {
    const error = projectiveFitErrorPx(fit, sample);
    if (!Number.isFinite(error)) {
      return null;
    }
    totalError += error;
    maxError = Math.max(maxError, error);
  }

  return {
    ...fit,
    meanErrorPx: totalError / samples.length,
    maxErrorPx: maxError,
  };
}

function fitProjectiveSceneMouseCalibrationSamples(
  samples: readonly EndToEndSceneMouseCalibrationSample[],
): EndToEndSceneMouseCalibrationProjectiveFit | null {
  let remaining = [...samples];
  let best = fitProjectiveSceneMouseCalibrationSamplesOnce(remaining);
  if (!best) {
    return null;
  }

  const minInlierCount = Math.max(
    SCENE_MOUSE_CALIBRATION_PROJECTIVE_MIN_SAMPLES,
    Math.ceil(samples.length * 0.72),
  );
  while (remaining.length > minInlierCount && !isProjectiveFitErrorWithinThreshold(best)) {
    let worstIndex = -1;
    let worstError = -1;
    for (let index = 0; index < remaining.length; index += 1) {
      const error = projectiveFitErrorPx(best, remaining[index]);
      if (error > worstError) {
        worstError = error;
        worstIndex = index;
      }
    }

    if (worstIndex < 0) {
      break;
    }

    const nextRemaining = remaining.filter((_, index) => index !== worstIndex);
    const nextFit = fitProjectiveSceneMouseCalibrationSamplesOnce(nextRemaining);
    if (!nextFit) {
      break;
    }

    if (nextFit.meanErrorPx > best.meanErrorPx && nextFit.maxErrorPx > best.maxErrorPx) {
      break;
    }

    remaining = nextRemaining;
    best = nextFit;
  }

  return best;
}

function fitAffineSceneMouseCalibrationSamples(
  samples: readonly EndToEndSceneMouseCalibrationSample[],
): EndToEndSceneMouseCalibrationFit | null {
  if (samples.length < SCENE_MOUSE_CALIBRATION_MIN_SAMPLES) {
    return null;
  }

  const ata = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const atx = [0, 0, 0];
  const aty = [0, 0, 0];

  for (const sample of samples) {
    const row = [sample.dxTiles, sample.dyTiles, 1];
    for (let r = 0; r < 3; r += 1) {
      atx[r] += row[r] * sample.localX;
      aty[r] += row[r] * sample.localY;
      for (let c = 0; c < 3; c += 1) {
        ata[r][c] += row[r] * row[c];
      }
    }
  }

  const xCoefficients = solve3x3(ata, atx);
  const yCoefficients = solve3x3(ata, aty);
  if (!xCoefficients || !yCoefficients) {
    return null;
  }

  let totalError = 0;
  let maxError = 0;
  for (const sample of samples) {
    const predictedX = xCoefficients[0] * sample.dxTiles + xCoefficients[1] * sample.dyTiles + xCoefficients[2];
    const predictedY = yCoefficients[0] * sample.dxTiles + yCoefficients[1] * sample.dyTiles + yCoefficients[2];
    const error = Math.hypot(predictedX - sample.localX, predictedY - sample.localY);
    totalError += error;
    maxError = Math.max(maxError, error);
  }

  return {
    xDx: xCoefficients[0],
    xDy: xCoefficients[1],
    xOffset: xCoefficients[2],
    yDx: yCoefficients[0],
    yDy: yCoefficients[1],
    yOffset: yCoefficients[2],
    sampleCount: samples.length,
    meanErrorPx: totalError / samples.length,
    maxErrorPx: maxError,
  };
}

export function fitSceneMouseCalibrationSamples(
  samples: readonly EndToEndSceneMouseCalibrationSample[],
): EndToEndSceneMouseCalibrationFit | null {
  const affineFit = fitAffineSceneMouseCalibrationSamples(samples);
  if (!affineFit) {
    return null;
  }

  return {
    ...affineFit,
    projective: fitProjectiveSceneMouseCalibrationSamples(samples),
  };
}

export function isSceneMouseCalibrationWindowCompatible(
  calibration: StartupPlayerTileCalibration,
  sceneCalibration: EndToEndSceneMouseCalibration | null,
): sceneCalibration is EndToEndSceneMouseCalibration {
  const savedRuneliteWindowWidth = sceneCalibration?.runeliteWindowWidth ?? null;
  const savedRuneliteWindowHeight = sceneCalibration?.runeliteWindowHeight ?? null;
  const hasRuneliteWindowProfile = savedRuneliteWindowWidth !== null && savedRuneliteWindowHeight !== null;
  return (
    !!sceneCalibration &&
    sceneCalibration.windowsScalePercent === calibration.windowsScalePercent &&
    Math.abs(sceneCalibration.captureWidth - calibration.captureBounds.width) <=
      SCENE_MOUSE_CALIBRATION_MAX_CAPTURE_DELTA_PX &&
    Math.abs(sceneCalibration.captureHeight - calibration.captureBounds.height) <=
      SCENE_MOUSE_CALIBRATION_MAX_CAPTURE_DELTA_PX &&
    (!hasRuneliteWindowProfile ||
      (savedRuneliteWindowWidth === Math.round(calibration.windowBounds.width) &&
        savedRuneliteWindowHeight === Math.round(calibration.windowBounds.height)))
  );
}

export function isSceneMouseCalibrationFitAcceptable(
  fit: EndToEndSceneMouseCalibrationFit | null,
): fit is EndToEndSceneMouseCalibrationFit {
  if (!fit) {
    return false;
  }

  const affineOk =
    fit.sampleCount >= SCENE_MOUSE_CALIBRATION_MIN_SAMPLES &&
    fit.meanErrorPx <= SCENE_MOUSE_CALIBRATION_MAX_MEAN_ERROR_PX &&
    fit.maxErrorPx <= SCENE_MOUSE_CALIBRATION_MAX_ERROR_PX;
  return affineOk || isSceneMouseCalibrationProjectiveFitAcceptable(fit.projective ?? null);
}

export function isSceneMouseCalibrationAffineFitAcceptable(
  fit: EndToEndSceneMouseCalibrationFit | null,
): fit is EndToEndSceneMouseCalibrationFit {
  return (
    !!fit &&
    fit.sampleCount >= SCENE_MOUSE_CALIBRATION_MIN_SAMPLES &&
    fit.meanErrorPx <= SCENE_MOUSE_CALIBRATION_MAX_MEAN_ERROR_PX &&
    fit.maxErrorPx <= SCENE_MOUSE_CALIBRATION_MAX_ERROR_PX
  );
}

export function isSceneMouseCalibrationProjectiveFitAcceptable(
  fit: EndToEndSceneMouseCalibrationProjectiveFit | null,
): fit is EndToEndSceneMouseCalibrationProjectiveFit {
  return (
    !!fit &&
    fit.sampleCount >= SCENE_MOUSE_CALIBRATION_PROJECTIVE_MIN_SAMPLES &&
    isProjectiveFitErrorWithinThreshold(fit)
  );
}

export function getSceneMouseCalibrationActiveFitMetrics(
  fit: EndToEndSceneMouseCalibrationFit | null,
): SceneMouseCalibrationActiveFitMetrics | null {
  if (!fit) {
    return null;
  }

  const projectiveFit = fit.projective ?? null;
  if (isSceneMouseCalibrationProjectiveFitAcceptable(projectiveFit)) {
    return {
      model: "projective",
      sampleCount: projectiveFit.sampleCount,
      meanErrorPx: projectiveFit.meanErrorPx,
      maxErrorPx: projectiveFit.maxErrorPx,
    };
  }

  if (isSceneMouseCalibrationAffineFitAcceptable(fit)) {
    return {
      model: "affine",
      sampleCount: fit.sampleCount,
      meanErrorPx: fit.meanErrorPx,
      maxErrorPx: fit.maxErrorPx,
    };
  }

  return null;
}

export function projectSceneMouseCalibrationLocalPoint(
  fit: EndToEndSceneMouseCalibrationFit,
  dxTiles: number,
  dyTiles: number,
): SceneMouseCalibrationLocalProjection | null {
  const projectiveFit = fit.projective ?? null;
  if (isSceneMouseCalibrationProjectiveFitAcceptable(projectiveFit)) {
    const projected = projectProjectiveFit(projectiveFit, dxTiles, dyTiles);
    if (projected) {
      return {
        ...projected,
        model: "projective",
        sampleCount: projectiveFit.sampleCount,
        meanErrorPx: projectiveFit.meanErrorPx,
        maxErrorPx: projectiveFit.maxErrorPx,
      };
    }
  }

  if (!isSceneMouseCalibrationAffineFitAcceptable(fit)) {
    return null;
  }

  return {
    localX: fit.xDx * dxTiles + fit.xDy * dyTiles + fit.xOffset,
    localY: fit.yDx * dxTiles + fit.yDy * dyTiles + fit.yOffset,
    model: "affine",
    sampleCount: fit.sampleCount,
    meanErrorPx: fit.meanErrorPx,
    maxErrorPx: fit.maxErrorPx,
  };
}

export function getCompatibleSavedSceneMouseCalibration(
  calibration: StartupPlayerTileCalibration,
): EndToEndSceneMouseCalibration | null {
  const config = getSavedEndToEndConfig();
  const profileKey = getSceneMouseCalibrationProfileKey(calibration);
  const candidates = [
    config.sceneMouseCalibrationsByProfileKey[profileKey] ?? null,
    config.sceneMouseCalibration,
  ];

  for (const sceneCalibration of candidates) {
    if (!isSceneMouseCalibrationWindowCompatible(calibration, sceneCalibration) || !sceneCalibration.fit) {
      continue;
    }

    if (!isSceneMouseCalibrationFitAcceptable(sceneCalibration.fit)) {
      continue;
    }

    return sceneCalibration;
  }

  return null;
}

export function projectSavedSceneMouseCalibrationWorldTile(
  calibration: StartupPlayerTileCalibration,
  playerTile: Pick<NonNullable<StartupPlayerTileCalibration["playerTile"]>, "x" | "y" | "z">,
  targetTile: Pick<NonNullable<StartupPlayerTileCalibration["playerTile"]>, "x" | "y" | "z">,
): SceneMouseCalibrationWorldProjection | null {
  if (playerTile.z !== targetTile.z) {
    return null;
  }

  const fit = getCompatibleSavedSceneMouseCalibration(calibration)?.fit ?? null;
  if (!fit) {
    return null;
  }

  const dxTiles = targetTile.x - playerTile.x;
  const dyTiles = targetTile.y - playerTile.y;
  const projected = projectSceneMouseCalibrationLocalPoint(fit, dxTiles, dyTiles);
  if (!projected || !Number.isFinite(projected.localX) || !Number.isFinite(projected.localY)) {
    return null;
  }

  const localPoint = {
    x: Math.round(projected.localX),
    y: Math.round(projected.localY),
  };
  return {
    ...projected,
    localPoint,
    screenPoint: {
      x: calibration.captureBounds.x + localPoint.x,
      y: calibration.captureBounds.y + localPoint.y,
    },
    dxTiles,
    dyTiles,
    distanceTiles: Math.max(Math.abs(dxTiles), Math.abs(dyTiles)),
    source: "saved-3d-calibration",
  };
}

export function saveSharedSceneMouseCalibration(
  calibration: StartupPlayerTileCalibration,
  samples: readonly EndToEndSceneMouseCalibrationSample[],
  fit: EndToEndSceneMouseCalibrationFit | null,
): EndToEndSceneMouseCalibration {
  const config = getSavedEndToEndConfig();
  const profileKey = getSceneMouseCalibrationProfileKey(calibration);
  const nextCalibration: EndToEndSceneMouseCalibration = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    windowsScalePercent: calibration.windowsScalePercent,
    captureWidth: calibration.captureBounds.width,
    captureHeight: calibration.captureBounds.height,
    runeliteWindowWidth: Math.round(calibration.windowBounds.width),
    runeliteWindowHeight: Math.round(calibration.windowBounds.height),
    profileKey,
    samples: samples.slice(-SCENE_MOUSE_CALIBRATION_MAX_SAMPLES),
    fit,
  };

  setSavedEndToEndConfig({
    ...config,
    sceneMouseCalibration: nextCalibration,
    sceneMouseCalibrationsByProfileKey: {
      ...config.sceneMouseCalibrationsByProfileKey,
      [profileKey]: nextCalibration,
    },
  });

  return nextCalibration;
}

export function formatSceneMouseCalibrationFit(fit: EndToEndSceneMouseCalibrationFit | null): string {
  if (!fit) {
    return "fit=unavailable";
  }

  const activeModel = getSceneMouseCalibrationActiveFitMetrics(fit)?.model ?? "none";
  const affine = `affine=samples=${fit.sampleCount} mean=${fit.meanErrorPx.toFixed(1)}px max=${fit.maxErrorPx.toFixed(
    1,
  )}px xDx=${fit.xDx.toFixed(2)} xDy=${fit.xDy.toFixed(2)} yDx=${fit.yDx.toFixed(2)} yDy=${fit.yDy.toFixed(2)}`;
  const projective = fit.projective
    ? `projective=samples=${fit.projective.sampleCount} mean=${fit.projective.meanErrorPx.toFixed(
        1,
      )}px max=${fit.projective.maxErrorPx.toFixed(1)}px xDx=${fit.projective.xDx.toFixed(
        2,
      )} xDy=${fit.projective.xDy.toFixed(2)} yDx=${fit.projective.yDx.toFixed(
        2,
      )} yDy=${fit.projective.yDy.toFixed(2)} wDx=${fit.projective.wDx.toFixed(5)} wDy=${fit.projective.wDy.toFixed(5)}`
    : "projective=unavailable";

  return `fit active=${activeModel} ${affine} ${projective}`;
}
