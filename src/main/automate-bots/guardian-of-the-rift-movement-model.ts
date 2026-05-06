import { app } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import type { RobotBitmap } from "./shared/ocr-engine";

export type GuardianOfTheRiftMovementModelContext = {
  monitorTier: string;
  windowsScalePercent: number;
};

export type GuardianOfTheRiftMovementModelThresholds = {
  longDistanceTiles: number;
  veryLongDistanceTiles: number;
  topScreenDistanceTiles: number;
  topScreenYRatio: number;
  axisDominanceDistanceTiles: number;
  axisDominanceRatio: number;
  maxExtraWaitTicks: number;
};

export type GuardianOfTheRiftMovementTravelSample = {
  waitTicks: number;
  baseWaitTicks: number;
  travelTicks: number;
  distancePx: number;
  distanceTiles: number;
  tilePx: number;
  dxPx: number;
  dyPx: number;
  targetYRatio: number | null;
  axisDominanceRatio: number;
  movementModelVersion: number;
  movementExtraWaitTicks: number;
  movementReasons: string[];
};

export type GuardianOfTheRiftMovementObservationOutcome = "success" | "late";

export type GuardianOfTheRiftMovementModelSelection = {
  version: 1 | 2 | 3;
  key: string;
  path: string;
  observationCount: number;
  successCount: number;
  lateCount: number;
  longExtraWaitTicks: number;
  veryLongExtraWaitTicks: number;
  topScreenExtraWaitTicks: number;
  axisDominanceExtraWaitTicks: number;
  yBandExtraWaitTicks: {
    top: number;
    middle: number;
    bottom: number;
  };
};

export type GuardianOfTheRiftMovementObservationResult = {
  recorded: boolean;
  key: string;
  path: string;
  model: GuardianOfTheRiftMovementModelSelection;
};

type MovementObservation = {
  observedAtIso: string;
  kind: string;
  outcome: GuardianOfTheRiftMovementObservationOutcome;
  reason: string;
  elapsedTicks: number | null;
  waitTicks: number;
  baseWaitTicks: number;
  travelTicks: number;
  distancePx: number;
  distanceTiles: number;
  tilePx: number;
  dxPx: number;
  dyPx: number;
  targetYRatio: number | null;
  axisDominanceRatio: number;
  modelVersion: number;
  modelExtraWaitTicks: number;
  modelReasons: string[];
};

type MovementProfile = {
  version: 1;
  key: string;
  host: string;
  monitorTier: string;
  windowsScalePercent: number;
  bitmapWidth: number;
  bitmapHeight: number;
  observations: MovementObservation[];
  updatedAtIso: string;
};

type MovementHistoryFile = {
  version: 1;
  profiles: Record<string, MovementProfile>;
};

type BucketStats = {
  total: number;
  success: number;
  late: number;
};

const HISTORY_VERSION = 1;
const HISTORY_FILE_NAME = "guardian-of-the-rift-movement-model-history.json";
const MAX_OBSERVATIONS_PER_PROFILE = 240;
const VERSION_2_MIN_OBSERVATIONS = 8;
const VERSION_3_MIN_OBSERVATIONS = 25;
const BUCKET_MIN_OBSERVATIONS = 4;
const BUCKET_STRONG_SUCCESS_MIN = 5;
const BUCKET_LOW_LATE_SUCCESS_MIN = 8;

let historyFile: MovementHistoryFile | null = null;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Math.round(value) === value && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Math.round(value) === value && value >= 0;
}

function sanitizeKeyPart(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "_");

  return sanitized.length > 0 ? sanitized : "unknown";
}

function getHostKey(): string {
  return sanitizeKeyPart(os.hostname() || "unknown");
}

export function getGuardianOfTheRiftMovementModelHistoryPath(): string {
  try {
    return path.join(app.getPath("userData"), HISTORY_FILE_NAME);
  } catch {
    return path.join(process.cwd(), "automate-bot-logs", HISTORY_FILE_NAME);
  }
}

function buildProfileKey(bitmap: RobotBitmap, context: GuardianOfTheRiftMovementModelContext): string {
  return [
    `host=${getHostKey()}`,
    `display=${sanitizeKeyPart(context.monitorTier)}`,
    `scale=${Math.round(context.windowsScalePercent)}`,
    `capture=${bitmap.width}x${bitmap.height}`,
  ].join("|");
}

function clampExtraTicks(value: number, maxExtraWaitTicks: number): number {
  return Math.min(Math.max(0, Math.round(maxExtraWaitTicks)), Math.max(0, Math.round(value)));
}

function normalizeObservation(value: unknown, maxExtraWaitTicks: number): MovementObservation | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<MovementObservation>;
  if (
    typeof candidate.observedAtIso !== "string" ||
    typeof candidate.kind !== "string" ||
    (candidate.outcome !== "success" && candidate.outcome !== "late") ||
    typeof candidate.reason !== "string" ||
    !isPositiveInteger(candidate.waitTicks) ||
    !isPositiveInteger(candidate.baseWaitTicks) ||
    !isPositiveInteger(candidate.travelTicks) ||
    !isFiniteNumber(candidate.distancePx) ||
    !isFiniteNumber(candidate.distanceTiles) ||
    !isPositiveInteger(candidate.tilePx) ||
    !isFiniteNumber(candidate.dxPx) ||
    !isFiniteNumber(candidate.dyPx) ||
    !isFiniteNumber(candidate.axisDominanceRatio) ||
    !isPositiveInteger(candidate.modelVersion) ||
    !isNonNegativeInteger(candidate.modelExtraWaitTicks)
  ) {
    return null;
  }

  return {
    observedAtIso: candidate.observedAtIso,
    kind: candidate.kind,
    outcome: candidate.outcome,
    reason: candidate.reason,
    elapsedTicks: isNonNegativeInteger(candidate.elapsedTicks) ? candidate.elapsedTicks : null,
    waitTicks: candidate.waitTicks,
    baseWaitTicks: candidate.baseWaitTicks,
    travelTicks: candidate.travelTicks,
    distancePx: candidate.distancePx,
    distanceTiles: candidate.distanceTiles,
    tilePx: candidate.tilePx,
    dxPx: candidate.dxPx,
    dyPx: candidate.dyPx,
    targetYRatio: isFiniteNumber(candidate.targetYRatio) ? candidate.targetYRatio : null,
    axisDominanceRatio: candidate.axisDominanceRatio,
    modelVersion: candidate.modelVersion,
    modelExtraWaitTicks: clampExtraTicks(candidate.modelExtraWaitTicks, maxExtraWaitTicks),
    modelReasons: Array.isArray(candidate.modelReasons)
      ? candidate.modelReasons.filter((reason): reason is string => typeof reason === "string").slice(0, 8)
      : [],
  };
}

function normalizeProfile(
  value: unknown,
  expectedKey: string,
  maxExtraWaitTicks: number,
): MovementProfile | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<MovementProfile>;
  if (
    candidate.version !== HISTORY_VERSION ||
    candidate.key !== expectedKey ||
    typeof candidate.host !== "string" ||
    typeof candidate.monitorTier !== "string" ||
    !isFiniteNumber(candidate.windowsScalePercent) ||
    !isPositiveInteger(candidate.bitmapWidth) ||
    !isPositiveInteger(candidate.bitmapHeight) ||
    !Array.isArray(candidate.observations) ||
    typeof candidate.updatedAtIso !== "string"
  ) {
    return null;
  }

  return {
    version: HISTORY_VERSION,
    key: candidate.key,
    host: candidate.host,
    monitorTier: candidate.monitorTier,
    windowsScalePercent: candidate.windowsScalePercent,
    bitmapWidth: candidate.bitmapWidth,
    bitmapHeight: candidate.bitmapHeight,
    observations: candidate.observations
      .map((observation) => normalizeObservation(observation, maxExtraWaitTicks))
      .filter((observation): observation is MovementObservation => observation !== null)
      .slice(-MAX_OBSERVATIONS_PER_PROFILE),
    updatedAtIso: candidate.updatedAtIso,
  };
}

function readHistoryFile(maxExtraWaitTicks: number): MovementHistoryFile {
  if (historyFile) {
    return historyFile;
  }

  const historyPath = getGuardianOfTheRiftMovementModelHistoryPath();
  if (!fs.existsSync(historyPath)) {
    historyFile = {
      version: HISTORY_VERSION,
      profiles: {},
    };
    return historyFile;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(historyPath, "utf8")) as Partial<MovementHistoryFile>;
    const profiles: Record<string, MovementProfile> = {};
    if (raw.version === HISTORY_VERSION && raw.profiles && typeof raw.profiles === "object") {
      for (const [key, value] of Object.entries(raw.profiles)) {
        const profile = normalizeProfile(value, key, maxExtraWaitTicks);
        if (profile) {
          profiles[key] = profile;
        }
      }
    }

    historyFile = {
      version: HISTORY_VERSION,
      profiles,
    };
    return historyFile;
  } catch (error) {
    console.warn(`Unable to read Guardian of the Rift movement model history at ${historyPath}: ${String(error)}`);
    historyFile = {
      version: HISTORY_VERSION,
      profiles: {},
    };
    return historyFile;
  }
}

function writeHistoryFile(nextHistoryFile: MovementHistoryFile): void {
  const historyPath = getGuardianOfTheRiftMovementModelHistoryPath();
  try {
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    fs.writeFileSync(historyPath, `${JSON.stringify(nextHistoryFile, null, 2)}\n`, "utf8");
    historyFile = nextHistoryFile;
  } catch (error) {
    console.warn(`Unable to write Guardian of the Rift movement model history at ${historyPath}: ${String(error)}`);
  }
}

function createProfile(
  key: string,
  bitmap: RobotBitmap,
  context: GuardianOfTheRiftMovementModelContext,
  nowIso: string,
): MovementProfile {
  return {
    version: HISTORY_VERSION,
    key,
    host: getHostKey(),
    monitorTier: context.monitorTier,
    windowsScalePercent: Math.round(context.windowsScalePercent),
    bitmapWidth: bitmap.width,
    bitmapHeight: bitmap.height,
    observations: [],
    updatedAtIso: nowIso,
  };
}

function getOrCreateProfile(
  history: MovementHistoryFile,
  bitmap: RobotBitmap,
  context: GuardianOfTheRiftMovementModelContext,
  maxExtraWaitTicks: number,
): MovementProfile {
  const key = buildProfileKey(bitmap, context);
  const existing = history.profiles[key];
  if (existing) {
    return existing;
  }

  const profile = createProfile(key, bitmap, context, new Date().toISOString());
  history.profiles[key] = normalizeProfile(profile, key, maxExtraWaitTicks) ?? profile;
  return history.profiles[key];
}

function getStats(observations: MovementObservation[], predicate: (observation: MovementObservation) => boolean): BucketStats {
  const selected = observations.filter(predicate);
  return {
    total: selected.length,
    success: selected.filter((observation) => observation.outcome === "success").length,
    late: selected.filter((observation) => observation.outcome === "late").length,
  };
}

function pickLearnedExtraTicks(stats: BucketStats, fallbackTicks: number, maxExtraWaitTicks: number): number {
  const fallback = clampExtraTicks(fallbackTicks, maxExtraWaitTicks);
  if (stats.total < BUCKET_MIN_OBSERVATIONS) {
    return fallback;
  }

  const lateRate = stats.late / Math.max(1, stats.total);
  if (stats.late >= 2 && lateRate >= 0.4) {
    return clampExtraTicks(fallback + 1, maxExtraWaitTicks);
  }

  if (stats.late >= 1 && lateRate >= 0.2) {
    return Math.max(fallback, 1);
  }

  if (stats.success >= BUCKET_STRONG_SUCCESS_MIN && stats.late === 0) {
    return 0;
  }

  if (stats.success >= BUCKET_LOW_LATE_SUCCESS_MIN && lateRate <= 0.1) {
    return clampExtraTicks(fallback - 1, maxExtraWaitTicks);
  }

  return fallback;
}

function selectModel(profile: MovementProfile, thresholds: GuardianOfTheRiftMovementModelThresholds): GuardianOfTheRiftMovementModelSelection {
  const observations = profile.observations;
  const observationCount = observations.length;
  const successCount = observations.filter((observation) => observation.outcome === "success").length;
  const lateCount = observations.filter((observation) => observation.outcome === "late").length;
  const version: 1 | 2 | 3 =
    observationCount >= VERSION_3_MIN_OBSERVATIONS ? 3 : observationCount >= VERSION_2_MIN_OBSERVATIONS ? 2 : 1;

  const longStats = getStats(
    observations,
    (observation) => observation.distanceTiles >= thresholds.longDistanceTiles,
  );
  const veryLongStats = getStats(
    observations,
    (observation) => observation.distanceTiles >= thresholds.veryLongDistanceTiles,
  );
  const topStats = getStats(
    observations,
    (observation) =>
      observation.targetYRatio !== null &&
      observation.distanceTiles >= thresholds.topScreenDistanceTiles &&
      observation.targetYRatio <= thresholds.topScreenYRatio,
  );
  const axisStats = getStats(
    observations,
    (observation) =>
      observation.distanceTiles >= thresholds.axisDominanceDistanceTiles &&
      observation.axisDominanceRatio >= thresholds.axisDominanceRatio,
  );

  const longExtraWaitTicks = version >= 2 ? pickLearnedExtraTicks(longStats, 1, thresholds.maxExtraWaitTicks) : 1;
  const veryLongExtraWaitTicks =
    version >= 2 ? pickLearnedExtraTicks(veryLongStats, 1, thresholds.maxExtraWaitTicks) : 1;
  const topScreenExtraWaitTicks = version >= 2 ? pickLearnedExtraTicks(topStats, 1, thresholds.maxExtraWaitTicks) : 1;
  const axisDominanceExtraWaitTicks = version >= 2 ? pickLearnedExtraTicks(axisStats, 1, thresholds.maxExtraWaitTicks) : 1;

  const topBandStats = getStats(
    observations,
    (observation) => observation.targetYRatio !== null && observation.targetYRatio <= thresholds.topScreenYRatio,
  );
  const middleBandStats = getStats(
    observations,
    (observation) =>
      observation.targetYRatio !== null &&
      observation.targetYRatio > thresholds.topScreenYRatio &&
      observation.targetYRatio <= 0.7,
  );
  const bottomBandStats = getStats(
    observations,
    (observation) => observation.targetYRatio !== null && observation.targetYRatio > 0.7,
  );

  return {
    version,
    key: profile.key,
    path: getGuardianOfTheRiftMovementModelHistoryPath(),
    observationCount,
    successCount,
    lateCount,
    longExtraWaitTicks,
    veryLongExtraWaitTicks,
    topScreenExtraWaitTicks,
    axisDominanceExtraWaitTicks,
    yBandExtraWaitTicks: {
      top: version >= 3 ? pickLearnedExtraTicks(topBandStats, topScreenExtraWaitTicks, thresholds.maxExtraWaitTicks) : 0,
      middle: version >= 3 ? pickLearnedExtraTicks(middleBandStats, 0, thresholds.maxExtraWaitTicks) : 0,
      bottom: version >= 3 ? pickLearnedExtraTicks(bottomBandStats, 0, thresholds.maxExtraWaitTicks) : 0,
    },
  };
}

export function selectGuardianOfTheRiftMovementModel(params: {
  bitmap: RobotBitmap;
  context: GuardianOfTheRiftMovementModelContext;
  thresholds: GuardianOfTheRiftMovementModelThresholds;
}): GuardianOfTheRiftMovementModelSelection {
  const history = readHistoryFile(params.thresholds.maxExtraWaitTicks);
  const profile = getOrCreateProfile(history, params.bitmap, params.context, params.thresholds.maxExtraWaitTicks);
  writeHistoryFile(history);
  return selectModel(profile, params.thresholds);
}

export function recordGuardianOfTheRiftMovementObservation(params: {
  bitmap: RobotBitmap;
  context: GuardianOfTheRiftMovementModelContext;
  thresholds: GuardianOfTheRiftMovementModelThresholds;
  kind: string;
  outcome: GuardianOfTheRiftMovementObservationOutcome;
  reason: string;
  elapsedTicks: number | null;
  travel: GuardianOfTheRiftMovementTravelSample;
}): GuardianOfTheRiftMovementObservationResult {
  const history = readHistoryFile(params.thresholds.maxExtraWaitTicks);
  const profile = getOrCreateProfile(history, params.bitmap, params.context, params.thresholds.maxExtraWaitTicks);
  const nowIso = new Date().toISOString();

  profile.observations = [
    ...profile.observations,
    {
      observedAtIso: nowIso,
      kind: params.kind,
      outcome: params.outcome,
      reason: params.reason,
      elapsedTicks: isNonNegativeInteger(params.elapsedTicks) ? params.elapsedTicks : null,
      waitTicks: params.travel.waitTicks,
      baseWaitTicks: params.travel.baseWaitTicks,
      travelTicks: params.travel.travelTicks,
      distancePx: params.travel.distancePx,
      distanceTiles: params.travel.distanceTiles,
      tilePx: params.travel.tilePx,
      dxPx: params.travel.dxPx,
      dyPx: params.travel.dyPx,
      targetYRatio: params.travel.targetYRatio,
      axisDominanceRatio: params.travel.axisDominanceRatio,
      modelVersion: params.travel.movementModelVersion,
      modelExtraWaitTicks: params.travel.movementExtraWaitTicks,
      modelReasons: params.travel.movementReasons,
    },
  ].slice(-MAX_OBSERVATIONS_PER_PROFILE);
  profile.updatedAtIso = nowIso;
  writeHistoryFile(history);

  return {
    recorded: true,
    key: profile.key,
    path: getGuardianOfTheRiftMovementModelHistoryPath(),
    model: selectModel(profile, params.thresholds),
  };
}
