import { app } from "electron";
import fs from "fs";
import path from "path";
import type { StartupPlayerTileCalibration } from "./startup-calibration";
import { getWorldTileChebyshevDistance, isSameWorldTile, type WorldRouteTile } from "./world-route-planner";
import { clamp } from "./osrs-helper";

export const MINIMAP_CLICK_CALIBRATION_VERSION = 1;
export const MINIMAP_CLICK_CALIBRATION_FILE_NAME = "minimap-click-calibration-v1.json";
export const MINIMAP_CLICK_CALIBRATION_DEFAULT_GOOD_ERROR_TILES = 3;
export const MINIMAP_CLICK_CALIBRATION_DEFAULT_TRUSTED_ERROR_TILES = 1;
export const MINIMAP_CLICK_CALIBRATION_DEFAULT_TRUSTED_STREAK = 3;
export const MINIMAP_CLICK_CALIBRATION_DEFAULT_OFFSET_LEARN_RATE = 0.35;
export const MINIMAP_CLICK_CALIBRATION_DEFAULT_OFFSET_MAX_PX = 48;
export const MINIMAP_CLICK_CALIBRATION_DEFAULT_STABLE_TICKS = 2;
export const MINIMAP_CLICK_CALIBRATION_DEFAULT_MAX_STABLE_READS = 5;

export type MinimapClickCalibrationOptions = {
  fileName: string;
  defaultTilePxScale: number;
  defaultRadiusRatio: number;
  tilePxScaleMin: number;
  tilePxScaleMax: number;
  radiusRatioMin: number;
  radiusRatioMax: number;
  goodErrorTiles: number;
  trustedErrorTiles: number;
  trustedStreak: number;
  offsetLearnRate: number;
  offsetMaxPx: number;
  warn?: (message: string) => void;
};

export type MinimapClickSavedCalibration = {
  version: 1;
  tilePxScale: number;
  radiusRatio: number;
  projectionOffsetLocalX: number;
  projectionOffsetLocalY: number;
  sampleCount: number;
  goodStreak: number;
  averageErrorTiles: number;
  lastErrorTiles: number;
  captureWidth: number | null;
  captureHeight: number | null;
  windowsScalePercent: number | null;
  updatedAtIso: string;
  validatedAtIso: string | null;
};

export type MinimapClickCalibrationState = {
  tilePxScale: number;
  radiusRatio: number;
  projectionOffsetLocalX: number;
  projectionOffsetLocalY: number;
  calibrationSampleCount: number;
  calibrationErrorSumTiles: number;
  calibrationGoodStreak: number;
  isCalibrationTrusted: boolean;
  startupValidationPending: boolean;
  savedCalibrationPath: string | null;
};

export type MinimapClickCalibrationObservation = {
  targetTile: WorldRouteTile;
  actualTile: WorldRouteTile;
  northX: number;
  northY: number;
  eastX: number;
  eastY: number;
  effectiveTilePx: number;
  sourceCalibration?: StartupPlayerTileCalibration | null;
};

export type MinimapClickCalibrationObservationResult = {
  targetErrorTiles: number;
  targetErrorX: number;
  targetErrorY: number;
  correctionLocalX: number;
  correctionLocalY: number;
  summary: string;
  saved: boolean;
};

export type MinimapClickStablePlayerTileRead = {
  tile: WorldRouteTile;
  firstTile: WorldRouteTile;
  attempts: number;
  waitedMs: number;
};

export type ReadStablePlayerTileForMinimapClickCalibrationParams<TWindow> = {
  expectedTile: WorldRouteTile | null;
  getWindow: () => TWindow | null;
  readTile: (window: TWindow, expectedTile: WorldRouteTile | null, previousTile: WorldRouteTile | null) => WorldRouteTile | null;
  sleep: (ms: number) => Promise<void>;
  isRunning: () => boolean;
  gameTickMs: number;
  stableTicks?: number;
  maxStableReads?: number;
  warn?: (message: string) => void;
};

export function resolveMinimapClickCalibrationOptions(
  options: Partial<MinimapClickCalibrationOptions> = {},
): MinimapClickCalibrationOptions {
  return {
    fileName: options.fileName ?? MINIMAP_CLICK_CALIBRATION_FILE_NAME,
    defaultTilePxScale: options.defaultTilePxScale ?? 1,
    defaultRadiusRatio: options.defaultRadiusRatio ?? 0.74,
    tilePxScaleMin: options.tilePxScaleMin ?? 0.9,
    tilePxScaleMax: options.tilePxScaleMax ?? 1.14,
    radiusRatioMin: options.radiusRatioMin ?? 0.66,
    radiusRatioMax: options.radiusRatioMax ?? 0.88,
    goodErrorTiles: options.goodErrorTiles ?? MINIMAP_CLICK_CALIBRATION_DEFAULT_GOOD_ERROR_TILES,
    trustedErrorTiles: options.trustedErrorTiles ?? MINIMAP_CLICK_CALIBRATION_DEFAULT_TRUSTED_ERROR_TILES,
    trustedStreak: options.trustedStreak ?? MINIMAP_CLICK_CALIBRATION_DEFAULT_TRUSTED_STREAK,
    offsetLearnRate: options.offsetLearnRate ?? MINIMAP_CLICK_CALIBRATION_DEFAULT_OFFSET_LEARN_RATE,
    offsetMaxPx: options.offsetMaxPx ?? MINIMAP_CLICK_CALIBRATION_DEFAULT_OFFSET_MAX_PX,
    warn: options.warn,
  };
}

export async function readStablePlayerTileForMinimapClickCalibration<TWindow>(
  params: ReadStablePlayerTileForMinimapClickCalibrationParams<TWindow>,
): Promise<MinimapClickStablePlayerTileRead | null> {
  const window = params.getWindow();
  if (!window) {
    params.warn?.("Minimap calibration stable read skipped: RuneLite window unavailable.");
    return null;
  }

  const stableTicks = params.stableTicks ?? MINIMAP_CLICK_CALIBRATION_DEFAULT_STABLE_TICKS;
  const maxStableReads = params.maxStableReads ?? MINIMAP_CLICK_CALIBRATION_DEFAULT_MAX_STABLE_READS;
  let firstTile: WorldRouteTile | null = null;
  let previousTile: WorldRouteTile | null = null;
  let waitedMs = 0;

  for (let attempt = 1; attempt <= maxStableReads && params.isRunning(); attempt += 1) {
    const currentTile = params.readTile(window, params.expectedTile, previousTile);
    if (currentTile) {
      firstTile ??= currentTile;
      if (previousTile && isSameWorldTile(previousTile, currentTile)) {
        return {
          tile: currentTile,
          firstTile,
          attempts: attempt,
          waitedMs,
        };
      }

      previousTile = currentTile;
    }

    if (attempt < maxStableReads) {
      const waitMs = stableTicks * params.gameTickMs;
      await params.sleep(waitMs);
      waitedMs += waitMs;
    }
  }

  return null;
}

export function getMinimapClickCalibrationPath(options: Partial<MinimapClickCalibrationOptions> = {}): string | null {
  const resolved = resolveMinimapClickCalibrationOptions(options);
  try {
    return path.join(app.getPath("userData"), resolved.fileName);
  } catch {
    return path.join(process.cwd(), "automate-bot-logs", resolved.fileName);
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeSavedMinimapClickCalibration(
  value: unknown,
  options: MinimapClickCalibrationOptions,
): MinimapClickSavedCalibration | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<MinimapClickSavedCalibration>;
  if (
    candidate.version !== MINIMAP_CLICK_CALIBRATION_VERSION ||
    !isFiniteNumber(candidate.tilePxScale) ||
    !isFiniteNumber(candidate.radiusRatio) ||
    !isFiniteNumber(candidate.projectionOffsetLocalX) ||
    !isFiniteNumber(candidate.projectionOffsetLocalY)
  ) {
    return null;
  }

  return {
    version: MINIMAP_CLICK_CALIBRATION_VERSION,
    tilePxScale: clamp(candidate.tilePxScale, options.tilePxScaleMin, options.tilePxScaleMax),
    radiusRatio: clamp(candidate.radiusRatio, options.radiusRatioMin, options.radiusRatioMax),
    projectionOffsetLocalX: clamp(candidate.projectionOffsetLocalX, -options.offsetMaxPx, options.offsetMaxPx),
    projectionOffsetLocalY: clamp(candidate.projectionOffsetLocalY, -options.offsetMaxPx, options.offsetMaxPx),
    sampleCount: Math.max(0, Math.round(isFiniteNumber(candidate.sampleCount) ? candidate.sampleCount : 0)),
    goodStreak: Math.max(0, Math.round(isFiniteNumber(candidate.goodStreak) ? candidate.goodStreak : 0)),
    averageErrorTiles: Math.max(0, isFiniteNumber(candidate.averageErrorTiles) ? candidate.averageErrorTiles : 0),
    lastErrorTiles: Math.max(0, isFiniteNumber(candidate.lastErrorTiles) ? candidate.lastErrorTiles : 0),
    captureWidth: isFiniteNumber(candidate.captureWidth) ? Math.round(candidate.captureWidth) : null,
    captureHeight: isFiniteNumber(candidate.captureHeight) ? Math.round(candidate.captureHeight) : null,
    windowsScalePercent: isFiniteNumber(candidate.windowsScalePercent) ? candidate.windowsScalePercent : null,
    updatedAtIso: typeof candidate.updatedAtIso === "string" ? candidate.updatedAtIso : new Date(0).toISOString(),
    validatedAtIso: typeof candidate.validatedAtIso === "string" ? candidate.validatedAtIso : null,
  };
}

export function readSavedMinimapClickCalibration(
  options: Partial<MinimapClickCalibrationOptions> = {},
): MinimapClickSavedCalibration | null {
  const resolved = resolveMinimapClickCalibrationOptions(options);
  const filePath = getMinimapClickCalibrationPath(resolved);
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  try {
    return normalizeSavedMinimapClickCalibration(JSON.parse(fs.readFileSync(filePath, "utf8")), resolved);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    resolved.warn?.(`Minimap calibration load failed: path=${filePath} error=${message}.`);
    return null;
  }
}

export function createMinimapClickCalibrationState(
  savedCalibration: MinimapClickSavedCalibration | null = null,
  options: Partial<MinimapClickCalibrationOptions> = {},
): MinimapClickCalibrationState {
  const resolved = resolveMinimapClickCalibrationOptions(options);
  const savedTrustedGoodStreak =
    savedCalibration && savedCalibration.lastErrorTiles <= resolved.trustedErrorTiles
      ? savedCalibration.goodStreak
      : 0;
  const isTrusted =
    !!savedCalibration &&
    savedTrustedGoodStreak >= resolved.trustedStreak &&
    savedCalibration.lastErrorTiles <= resolved.trustedErrorTiles;

  return {
    tilePxScale: savedCalibration?.tilePxScale ?? resolved.defaultTilePxScale,
    radiusRatio: savedCalibration?.radiusRatio ?? resolved.defaultRadiusRatio,
    projectionOffsetLocalX: savedCalibration?.projectionOffsetLocalX ?? 0,
    projectionOffsetLocalY: savedCalibration?.projectionOffsetLocalY ?? 0,
    calibrationSampleCount: savedCalibration?.sampleCount ?? 0,
    calibrationErrorSumTiles: (savedCalibration?.averageErrorTiles ?? 0) * (savedCalibration?.sampleCount ?? 0),
    calibrationGoodStreak: savedTrustedGoodStreak,
    isCalibrationTrusted: isTrusted,
    startupValidationPending: isTrusted,
    savedCalibrationPath: getMinimapClickCalibrationPath(resolved),
  };
}

export function shouldRunMinimapClickCalibration(state: MinimapClickCalibrationState): boolean {
  return !state.isCalibrationTrusted || state.startupValidationPending;
}

export function saveMinimapClickCalibration(
  state: MinimapClickCalibrationState,
  calibration: StartupPlayerTileCalibration | null,
  lastErrorTiles: number,
  options: Partial<MinimapClickCalibrationOptions> = {},
): boolean {
  const resolved = resolveMinimapClickCalibrationOptions(options);
  const filePath = state.savedCalibrationPath ?? getMinimapClickCalibrationPath(resolved);
  if (!filePath) {
    return false;
  }

  const averageErrorTiles =
    state.calibrationSampleCount > 0 ? state.calibrationErrorSumTiles / state.calibrationSampleCount : lastErrorTiles;
  const payload: MinimapClickSavedCalibration = {
    version: MINIMAP_CLICK_CALIBRATION_VERSION,
    tilePxScale: state.tilePxScale,
    radiusRatio: state.radiusRatio,
    projectionOffsetLocalX: state.projectionOffsetLocalX,
    projectionOffsetLocalY: state.projectionOffsetLocalY,
    sampleCount: state.calibrationSampleCount,
    goodStreak: state.calibrationGoodStreak,
    averageErrorTiles,
    lastErrorTiles,
    captureWidth: calibration?.captureBounds.width ?? null,
    captureHeight: calibration?.captureBounds.height ?? null,
    windowsScalePercent: calibration?.windowsScalePercent ?? null,
    updatedAtIso: new Date().toISOString(),
    validatedAtIso: state.isCalibrationTrusted ? new Date().toISOString() : null,
  };

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    resolved.warn?.(`Minimap calibration save failed: path=${filePath} error=${message}.`);
    return false;
  }
}

export function resetMinimapClickCalibrationLearning(
  state: MinimapClickCalibrationState,
  options: Partial<MinimapClickCalibrationOptions> = {},
): void {
  const resolved = resolveMinimapClickCalibrationOptions(options);
  state.tilePxScale = resolved.defaultTilePxScale;
  state.radiusRatio = resolved.defaultRadiusRatio;
  state.projectionOffsetLocalX = 0;
  state.projectionOffsetLocalY = 0;
  state.calibrationSampleCount = 0;
  state.calibrationErrorSumTiles = 0;
  state.calibrationGoodStreak = 0;
  state.isCalibrationTrusted = false;
  state.startupValidationPending = false;
}

export function invalidateMinimapClickCalibration(
  state: MinimapClickCalibrationState,
  calibration: StartupPlayerTileCalibration | null,
  lastErrorTiles: number,
  options: Partial<MinimapClickCalibrationOptions> = {},
): boolean {
  resetMinimapClickCalibrationLearning(state, options);
  state.calibrationSampleCount = 1;
  state.calibrationErrorSumTiles = Math.max(0, lastErrorTiles);
  return saveMinimapClickCalibration(state, calibration, lastErrorTiles, options);
}

export function observeMinimapClickCalibration(
  state: MinimapClickCalibrationState,
  observation: MinimapClickCalibrationObservation,
  options: Partial<MinimapClickCalibrationOptions> = {},
): MinimapClickCalibrationObservationResult {
  const resolved = resolveMinimapClickCalibrationOptions(options);
  const targetErrorTiles = getWorldTileChebyshevDistance(observation.actualTile, observation.targetTile);
  const targetErrorX = observation.actualTile.x - observation.targetTile.x;
  const targetErrorY = observation.actualTile.y - observation.targetTile.y;
  const correctionWorldX = observation.targetTile.x - observation.actualTile.x;
  const correctionWorldY = observation.targetTile.y - observation.actualTile.y;
  const correctionLocalX =
    (observation.eastX * correctionWorldX + observation.northX * correctionWorldY) * observation.effectiveTilePx;
  const correctionLocalY =
    (observation.eastY * correctionWorldX + observation.northY * correctionWorldY) * observation.effectiveTilePx;

  state.projectionOffsetLocalX = clamp(
    state.projectionOffsetLocalX + correctionLocalX * resolved.offsetLearnRate,
    -resolved.offsetMaxPx,
    resolved.offsetMaxPx,
  );
  state.projectionOffsetLocalY = clamp(
    state.projectionOffsetLocalY + correctionLocalY * resolved.offsetLearnRate,
    -resolved.offsetMaxPx,
    resolved.offsetMaxPx,
  );
  state.calibrationSampleCount += 1;
  state.calibrationErrorSumTiles += targetErrorTiles;
  const isGoodSample = targetErrorTiles <= resolved.goodErrorTiles;
  const isTrustedSample = targetErrorTiles <= resolved.trustedErrorTiles;
  if (isTrustedSample) {
    state.calibrationGoodStreak += 1;
  } else {
    state.calibrationGoodStreak = 0;
  }

  let summary = `learning-goodStreak=${state.calibrationGoodStreak}/${resolved.trustedStreak}`;
  let saved = false;
  if (state.startupValidationPending) {
    state.startupValidationPending = false;
    if (isTrustedSample) {
      state.isCalibrationTrusted = true;
      summary = "startup-check-passed";
      saved = saveMinimapClickCalibration(state, observation.sourceCalibration ?? null, targetErrorTiles, resolved);
    } else if (isGoodSample) {
      state.isCalibrationTrusted = false;
      summary = `startup-check-refining trustedError=${resolved.trustedErrorTiles}`;
      saved = saveMinimapClickCalibration(state, observation.sourceCalibration ?? null, targetErrorTiles, resolved);
    } else {
      state.isCalibrationTrusted = false;
      state.calibrationGoodStreak = 0;
      state.calibrationSampleCount = 1;
      state.calibrationErrorSumTiles = targetErrorTiles;
      summary = "startup-check-failed-reset";
      saved = invalidateMinimapClickCalibration(state, observation.sourceCalibration ?? null, targetErrorTiles, resolved);
    }
  } else if (state.calibrationGoodStreak >= resolved.trustedStreak) {
    state.isCalibrationTrusted = true;
    summary = "trusted-saved";
    saved = saveMinimapClickCalibration(state, observation.sourceCalibration ?? null, targetErrorTiles, resolved);
  } else {
    state.isCalibrationTrusted = false;
    if (isGoodSample) {
      summary = `refining-goodStreak=${state.calibrationGoodStreak}/${resolved.trustedStreak}`;
      saved = saveMinimapClickCalibration(state, observation.sourceCalibration ?? null, targetErrorTiles, resolved);
    }
  }

  return {
    targetErrorTiles,
    targetErrorX,
    targetErrorY,
    correctionLocalX,
    correctionLocalY,
    summary,
    saved,
  };
}
