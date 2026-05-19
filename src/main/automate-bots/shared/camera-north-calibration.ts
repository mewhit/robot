import type { Window } from "node-window-manager";
import { readStartupPlayerTileCalibration, type StartupPlayerTileCalibration } from "./startup-calibration";
import { holdRobotKey } from "./robot-keyboard";

const CAMERA_NORTH_KEY = "u";
const CAMERA_NORTH_MAX_ATTEMPTS = 2;
const CAMERA_NORTH_ALIGNMENT_MAX_DEGREES = 7;
const CAMERA_NORTH_MIN_COMPASS_CONFIDENCE = 0.55;
const CAMERA_NORTH_HOLD_MS = 190;
const CAMERA_NORTH_SETTLE_MS = 700;

export type CameraNorthCalibrationResult =
  | {
      ok: true;
      calibration: StartupPlayerTileCalibration;
      attempts: number;
      clickedCompass: number;
      tappedNorthKey: number;
      summary: string;
    }
  | {
      ok: false;
      calibration: StartupPlayerTileCalibration | null;
      attempts: number;
      clickedCompass: number;
      tappedNorthKey: number;
      summary: string;
      error: string;
    };

export type CameraNorthCalibrationOptions = {
  log?: (message: string) => void;
  shouldContinue?: () => boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export function getCompassNorthAngleDegrees(calibration: StartupPlayerTileCalibration | null): number | null {
  const compass = calibration?.compassNorth ?? null;
  if (!compass) {
    return null;
  }

  return Math.abs(Math.atan2(compass.northVectorX, -compass.northVectorY) * (180 / Math.PI));
}

function isCameraNorthAligned(calibration: StartupPlayerTileCalibration | null): boolean {
  const compass = calibration?.compassNorth ?? null;
  const angleDegrees = getCompassNorthAngleDegrees(calibration);
  return (
    !!compass &&
    angleDegrees !== null &&
    angleDegrees <= CAMERA_NORTH_ALIGNMENT_MAX_DEGREES &&
    compass.confidence >= CAMERA_NORTH_MIN_COMPASS_CONFIDENCE
  );
}

function formatCompassNorth(calibration: StartupPlayerTileCalibration | null): string {
  const compass = calibration?.compassNorth ?? null;
  const angleDegrees = getCompassNorthAngleDegrees(calibration);
  if (!compass) {
    return `compass=missing angle=unavailable max=${CAMERA_NORTH_ALIGNMENT_MAX_DEGREES}deg`;
  }

  return `compass=vector=${compass.northVectorX.toFixed(3)},${compass.northVectorY.toFixed(
    3,
  )} confidence=${compass.confidence.toFixed(2)} pixels=${compass.pixelCount} angle=${
    angleDegrees?.toFixed(1) ?? "unavailable"
  }deg max=${CAMERA_NORTH_ALIGNMENT_MAX_DEGREES}deg`;
}

function readCameraNorthCalibration(window: Window): StartupPlayerTileCalibration | null {
  return readStartupPlayerTileCalibration(window, {
    requireRuneLiteCoordinatePattern: true,
  });
}

export async function forceCameraNorthForCalibration(
  window: Window,
  options: CameraNorthCalibrationOptions = {},
): Promise<CameraNorthCalibrationResult> {
  const log = options.log ?? (() => undefined);
  const shouldContinue = options.shouldContinue ?? (() => true);
  let clickedCompass = 0;
  let tappedNorthKey = 0;
  let lastCalibration: StartupPlayerTileCalibration | null = null;

  for (let attempt = 1; attempt <= CAMERA_NORTH_MAX_ATTEMPTS && shouldContinue(); attempt += 1) {
    const beforeCalibration = readCameraNorthCalibration(window);
    lastCalibration = beforeCalibration ?? lastCalibration;
    log(`Camera north calibration attempt ${attempt}: before ${formatCompassNorth(beforeCalibration)}.`);

    const result = await holdRobotKey(CAMERA_NORTH_KEY, CAMERA_NORTH_HOLD_MS, {
      shouldContinue,
    });
    tappedNorthKey += 1;
    if (!result.ok) {
      log(
        `Camera north calibration attempt ${attempt}: held '${CAMERA_NORTH_KEY}' ${CAMERA_NORTH_HOLD_MS}ms result=${
          result.error ?? "failed"
        }.`,
      );
      continue;
    }

    log(`Camera north calibration attempt ${attempt}: held '${CAMERA_NORTH_KEY}' ${CAMERA_NORTH_HOLD_MS}ms result=ok.`);
    await sleep(CAMERA_NORTH_SETTLE_MS);

    const afterCalibration = readCameraNorthCalibration(window);
    lastCalibration = afterCalibration ?? beforeCalibration ?? lastCalibration;
    const verified = isCameraNorthAligned(afterCalibration);
    log(
      `Camera north calibration attempt ${attempt}: after ${formatCompassNorth(afterCalibration)} verification=${
        verified ? "compass-verified" : "key-assumed-north"
      }.`,
    );

    if (afterCalibration) {
      return {
        ok: true,
        calibration: afterCalibration,
        attempts: attempt,
        clickedCompass,
        tappedNorthKey,
        summary: `${verified ? "compass-verified" : "key-assumed-north"} ${formatCompassNorth(afterCalibration)}`,
      };
    }
  }

  lastCalibration = readCameraNorthCalibration(window) ?? lastCalibration;
  const summary = formatCompassNorth(lastCalibration);
  return {
    ok: false,
    calibration: lastCalibration,
    attempts: CAMERA_NORTH_MAX_ATTEMPTS,
    clickedCompass,
    tappedNorthKey,
    summary,
    error: `camera north calibration failed; ${summary}`,
  };
}
