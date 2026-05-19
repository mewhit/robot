import type {
  EndToEndSceneMouseCalibration,
  EndToEndSceneMouseCalibrationFit,
  EndToEndSceneMouseCalibrationSample,
} from "../end-to-end-config";
import type { StartupPlayerTileCalibration } from "./startup-calibration";

export const SCENE_MOUSE_CALIBRATION_MIN_SAMPLES = 3;
export const SCENE_MOUSE_CALIBRATION_GOOD_SAMPLES = 5;
export const SCENE_MOUSE_CALIBRATION_MAX_SAMPLES = 64;
export const SCENE_MOUSE_CALIBRATION_MAX_MEAN_ERROR_PX = 22;
export const SCENE_MOUSE_CALIBRATION_MAX_ERROR_PX = 55;
export const SCENE_MOUSE_CALIBRATION_MAX_CAPTURE_DELTA_PX = 24;

function solve3x3(matrix: number[][], vector: number[]): [number, number, number] | null {
  const rows = matrix.map((row, index) => [row[0], row[1], row[2], vector[index]]);
  for (let column = 0; column < 3; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivotRow][column])) {
        pivotRow = row;
      }
    }

    if (Math.abs(rows[pivotRow][column]) < 1e-6) {
      return null;
    }

    if (pivotRow !== column) {
      const temp = rows[column];
      rows[column] = rows[pivotRow];
      rows[pivotRow] = temp;
    }

    const pivot = rows[column][column];
    for (let col = column; col < 4; col += 1) {
      rows[column][col] /= pivot;
    }

    for (let row = 0; row < 3; row += 1) {
      if (row === column) {
        continue;
      }

      const factor = rows[row][column];
      for (let col = column; col < 4; col += 1) {
        rows[row][col] -= factor * rows[column][col];
      }
    }
  }

  return [rows[0][3], rows[1][3], rows[2][3]];
}

export function fitSceneMouseCalibrationSamples(
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

export function isSceneMouseCalibrationWindowCompatible(
  calibration: StartupPlayerTileCalibration,
  sceneCalibration: EndToEndSceneMouseCalibration | null,
): sceneCalibration is EndToEndSceneMouseCalibration {
  return (
    !!sceneCalibration &&
    sceneCalibration.windowsScalePercent === calibration.windowsScalePercent &&
    Math.abs(sceneCalibration.captureWidth - calibration.captureBounds.width) <=
      SCENE_MOUSE_CALIBRATION_MAX_CAPTURE_DELTA_PX &&
    Math.abs(sceneCalibration.captureHeight - calibration.captureBounds.height) <=
      SCENE_MOUSE_CALIBRATION_MAX_CAPTURE_DELTA_PX
  );
}

export function isSceneMouseCalibrationFitAcceptable(
  fit: EndToEndSceneMouseCalibrationFit | null,
): fit is EndToEndSceneMouseCalibrationFit {
  return (
    !!fit &&
    fit.sampleCount >= SCENE_MOUSE_CALIBRATION_MIN_SAMPLES &&
    fit.meanErrorPx <= SCENE_MOUSE_CALIBRATION_MAX_MEAN_ERROR_PX &&
    fit.maxErrorPx <= SCENE_MOUSE_CALIBRATION_MAX_ERROR_PX
  );
}
