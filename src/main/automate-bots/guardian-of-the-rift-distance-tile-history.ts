import { app } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import type { RobotBitmap } from "./shared/ocr-engine";

export type GuardianOfTheRiftDistanceTileContext = {
  monitorTier: string;
  windowsScalePercent: number;
};

export type GuardianOfTheRiftDistanceTileStartupCalibration = {
  tilePx: number;
  source: "bot-raw" | "manager-raw" | "fallback";
  botRawTilePx: number | null;
  managerRawTilePx: number | null;
};

export type GuardianOfTheRiftDistanceTravelSample = {
  distancePx: number;
  distanceTiles: number;
  tilePx: number;
  travelTicks: number;
  waitTicks: number;
};

export type GuardianOfTheRiftDistanceTileHistorySelection = {
  tilePx: number;
  source: "history-learned" | "history-mode" | "startup";
  key: string;
  path: string;
  startupTilePx: number;
  startupObservationCount: number;
  correctionObservationCount: number;
  observedModeTilePx: number | null;
  learnedTilePx: number | null;
  correctionDebt: number;
};

export type GuardianOfTheRiftDistanceTileCorrectionResult = {
  recorded: boolean;
  ignoredReason: string | null;
  key: string;
  path: string;
  previousTilePx: number;
  candidateTilePx: number | null;
  nextTilePx: number;
  adjusted: boolean;
  correctionDebt: number;
  correctionThreshold: number;
  correctionObservationCount: number;
};

type StartupTileObservation = {
  observedAtIso: string;
  tilePx: number;
  source: "bot-raw" | "manager-raw" | "fallback";
  botRawTilePx: number | null;
  managerRawTilePx: number | null;
};

type CorrectionTileObservation = {
  observedAtIso: string;
  phase: string;
  reason: string;
  previousTilePx: number;
  candidateTilePx: number;
  distancePx: number;
  axisDistancePx: number;
  distanceTiles: number;
  travelTicks: number;
  waitTicks: number;
};

type DistanceTileProfile = {
  version: 1;
  key: string;
  host: string;
  monitorTier: string;
  windowsScalePercent: number;
  bitmapWidth: number;
  bitmapHeight: number;
  learnedTilePx: number | null;
  correctionDebt: number;
  startupObservations: StartupTileObservation[];
  correctionObservations: CorrectionTileObservation[];
  updatedAtIso: string;
};

type DistanceTileHistoryFile = {
  version: 1;
  profiles: Record<string, DistanceTileProfile>;
};

const HISTORY_FILE_NAME = "guardian-of-the-rift-distance-tile-history.json";
const HISTORY_VERSION = 1;
const MAX_STARTUP_OBSERVATIONS_PER_PROFILE = 80;
const MAX_CORRECTION_OBSERVATIONS_PER_PROFILE = 80;

let historyFile: DistanceTileHistoryFile | null = null;

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

export function getGuardianOfTheRiftDistanceTileHistoryPath(): string {
  try {
    return path.join(app.getPath("userData"), HISTORY_FILE_NAME);
  } catch {
    return path.join(process.cwd(), "automate-bot-logs", HISTORY_FILE_NAME);
  }
}

function buildProfileKey(bitmap: RobotBitmap, context: GuardianOfTheRiftDistanceTileContext): string {
  return [
    `host=${getHostKey()}`,
    `display=${sanitizeKeyPart(context.monitorTier)}`,
    `scale=${Math.round(context.windowsScalePercent)}`,
    `capture=${bitmap.width}x${bitmap.height}`,
  ].join("|");
}

function clampTilePx(tilePx: number, minTilePx: number, maxTilePx: number): number {
  return Math.min(maxTilePx, Math.max(minTilePx, Math.round(tilePx)));
}

function normalizeStartupObservation(value: unknown, minTilePx: number, maxTilePx: number): StartupTileObservation | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<StartupTileObservation>;
  if (
    typeof candidate.observedAtIso !== "string" ||
    !isPositiveInteger(candidate.tilePx) ||
    (candidate.source !== "bot-raw" && candidate.source !== "manager-raw" && candidate.source !== "fallback")
  ) {
    return null;
  }

  return {
    observedAtIso: candidate.observedAtIso,
    tilePx: clampTilePx(candidate.tilePx, minTilePx, maxTilePx),
    source: candidate.source,
    botRawTilePx: isFiniteNumber(candidate.botRawTilePx) ? candidate.botRawTilePx : null,
    managerRawTilePx: isFiniteNumber(candidate.managerRawTilePx) ? candidate.managerRawTilePx : null,
  };
}

function normalizeCorrectionObservation(value: unknown, minTilePx: number, maxTilePx: number): CorrectionTileObservation | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<CorrectionTileObservation>;
  if (
    typeof candidate.observedAtIso !== "string" ||
    typeof candidate.phase !== "string" ||
    typeof candidate.reason !== "string" ||
    !isPositiveInteger(candidate.previousTilePx) ||
    !isPositiveInteger(candidate.candidateTilePx) ||
    !isFiniteNumber(candidate.distancePx) ||
    !isFiniteNumber(candidate.axisDistancePx) ||
    !isFiniteNumber(candidate.distanceTiles) ||
    !isPositiveInteger(candidate.travelTicks) ||
    !isPositiveInteger(candidate.waitTicks)
  ) {
    return null;
  }

  return {
    observedAtIso: candidate.observedAtIso,
    phase: candidate.phase,
    reason: candidate.reason,
    previousTilePx: clampTilePx(candidate.previousTilePx, minTilePx, maxTilePx),
    candidateTilePx: clampTilePx(candidate.candidateTilePx, minTilePx, maxTilePx),
    distancePx: candidate.distancePx,
    axisDistancePx: candidate.axisDistancePx,
    distanceTiles: candidate.distanceTiles,
    travelTicks: candidate.travelTicks,
    waitTicks: candidate.waitTicks,
  };
}

function normalizeProfile(
  value: unknown,
  expectedKey: string,
  minTilePx: number,
  maxTilePx: number,
): DistanceTileProfile | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<DistanceTileProfile>;
  if (
    candidate.version !== HISTORY_VERSION ||
    candidate.key !== expectedKey ||
    typeof candidate.host !== "string" ||
    typeof candidate.monitorTier !== "string" ||
    !isFiniteNumber(candidate.windowsScalePercent) ||
    !isPositiveInteger(candidate.bitmapWidth) ||
    !isPositiveInteger(candidate.bitmapHeight) ||
    !Array.isArray(candidate.startupObservations) ||
    !Array.isArray(candidate.correctionObservations) ||
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
    learnedTilePx: isPositiveInteger(candidate.learnedTilePx)
      ? clampTilePx(candidate.learnedTilePx, minTilePx, maxTilePx)
      : null,
    correctionDebt: isNonNegativeInteger(candidate.correctionDebt) ? candidate.correctionDebt : 0,
    startupObservations: candidate.startupObservations
      .map((observation) => normalizeStartupObservation(observation, minTilePx, maxTilePx))
      .filter((observation): observation is StartupTileObservation => observation !== null)
      .slice(-MAX_STARTUP_OBSERVATIONS_PER_PROFILE),
    correctionObservations: candidate.correctionObservations
      .map((observation) => normalizeCorrectionObservation(observation, minTilePx, maxTilePx))
      .filter((observation): observation is CorrectionTileObservation => observation !== null)
      .slice(-MAX_CORRECTION_OBSERVATIONS_PER_PROFILE),
    updatedAtIso: candidate.updatedAtIso,
  };
}

function readHistoryFile(minTilePx: number, maxTilePx: number): DistanceTileHistoryFile {
  if (historyFile) {
    return historyFile;
  }

  const historyPath = getGuardianOfTheRiftDistanceTileHistoryPath();
  if (!fs.existsSync(historyPath)) {
    historyFile = {
      version: HISTORY_VERSION,
      profiles: {},
    };
    return historyFile;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(historyPath, "utf8")) as Partial<DistanceTileHistoryFile>;
    const profiles: Record<string, DistanceTileProfile> = {};
    if (raw.version === HISTORY_VERSION && raw.profiles && typeof raw.profiles === "object") {
      for (const [key, value] of Object.entries(raw.profiles)) {
        const profile = normalizeProfile(value, key, minTilePx, maxTilePx);
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
    console.warn(`Unable to read Guardian of the Rift distance tile history at ${historyPath}: ${String(error)}`);
    historyFile = {
      version: HISTORY_VERSION,
      profiles: {},
    };
    return historyFile;
  }
}

function writeHistoryFile(nextHistoryFile: DistanceTileHistoryFile): void {
  const historyPath = getGuardianOfTheRiftDistanceTileHistoryPath();
  try {
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    fs.writeFileSync(historyPath, `${JSON.stringify(nextHistoryFile, null, 2)}\n`, "utf8");
    historyFile = nextHistoryFile;
  } catch (error) {
    console.warn(`Unable to write Guardian of the Rift distance tile history at ${historyPath}: ${String(error)}`);
  }
}

function createProfile(
  key: string,
  bitmap: RobotBitmap,
  context: GuardianOfTheRiftDistanceTileContext,
  nowIso: string,
): DistanceTileProfile {
  return {
    version: HISTORY_VERSION,
    key,
    host: getHostKey(),
    monitorTier: context.monitorTier,
    windowsScalePercent: Math.round(context.windowsScalePercent),
    bitmapWidth: bitmap.width,
    bitmapHeight: bitmap.height,
    learnedTilePx: null,
    correctionDebt: 0,
    startupObservations: [],
    correctionObservations: [],
    updatedAtIso: nowIso,
  };
}

function getOrCreateProfile(
  history: DistanceTileHistoryFile,
  bitmap: RobotBitmap,
  context: GuardianOfTheRiftDistanceTileContext,
  minTilePx: number,
  maxTilePx: number,
): DistanceTileProfile {
  const key = buildProfileKey(bitmap, context);
  const existing = history.profiles[key];
  if (existing) {
    return existing;
  }

  const profile = createProfile(key, bitmap, context, new Date().toISOString());
  history.profiles[key] = normalizeProfile(profile, key, minTilePx, maxTilePx) ?? profile;
  return history.profiles[key];
}

function pickMostLikelyTilePx(values: number[], minTilePx: number, maxTilePx: number): number | null {
  const counts = new Map<number, number>();
  for (const value of values) {
    const tilePx = clampTilePx(value, minTilePx, maxTilePx);
    counts.set(tilePx, (counts.get(tilePx) ?? 0) + 1);
  }

  let bestTilePx: number | null = null;
  let bestCount = 0;
  for (const [tilePx, count] of counts) {
    if (count > bestCount || (count === bestCount && bestTilePx !== null && tilePx < bestTilePx)) {
      bestTilePx = tilePx;
      bestCount = count;
    }
  }

  return bestTilePx;
}

export function recordGuardianOfTheRiftDistanceTileStartupObservation(params: {
  bitmap: RobotBitmap;
  context: GuardianOfTheRiftDistanceTileContext;
  startupCalibration: GuardianOfTheRiftDistanceTileStartupCalibration;
  minTilePx: number;
  maxTilePx: number;
}): GuardianOfTheRiftDistanceTileHistorySelection {
  const history = readHistoryFile(params.minTilePx, params.maxTilePx);
  const profile = getOrCreateProfile(history, params.bitmap, params.context, params.minTilePx, params.maxTilePx);
  const nowIso = new Date().toISOString();
  const startupTilePx = clampTilePx(params.startupCalibration.tilePx, params.minTilePx, params.maxTilePx);

  profile.startupObservations = [
    ...profile.startupObservations,
    {
      observedAtIso: nowIso,
      tilePx: startupTilePx,
      source: params.startupCalibration.source,
      botRawTilePx: params.startupCalibration.botRawTilePx,
      managerRawTilePx: params.startupCalibration.managerRawTilePx,
    },
  ].slice(-MAX_STARTUP_OBSERVATIONS_PER_PROFILE);

  const nonFallbackStartupTilePx = profile.startupObservations
    .filter((observation) => observation.source !== "fallback")
    .map((observation) => observation.tilePx);
  const observedModeTilePx =
    pickMostLikelyTilePx(nonFallbackStartupTilePx, params.minTilePx, params.maxTilePx) ??
    pickMostLikelyTilePx(
      profile.startupObservations.map((observation) => observation.tilePx),
      params.minTilePx,
      params.maxTilePx,
    );

  profile.updatedAtIso = nowIso;
  writeHistoryFile(history);

  const learnedTilePx =
    profile.learnedTilePx !== null ? clampTilePx(profile.learnedTilePx, params.minTilePx, params.maxTilePx) : null;
  const tilePx = learnedTilePx ?? observedModeTilePx ?? startupTilePx;

  return {
    tilePx,
    source: learnedTilePx !== null ? "history-learned" : observedModeTilePx !== null ? "history-mode" : "startup",
    key: profile.key,
    path: getGuardianOfTheRiftDistanceTileHistoryPath(),
    startupTilePx,
    startupObservationCount: profile.startupObservations.length,
    correctionObservationCount: profile.correctionObservations.length,
    observedModeTilePx,
    learnedTilePx,
    correctionDebt: profile.correctionDebt,
  };
}

export function recordGuardianOfTheRiftDistanceTileCorrection(params: {
  bitmap: RobotBitmap;
  context: GuardianOfTheRiftDistanceTileContext;
  phase: string;
  reason: string;
  travel: GuardianOfTheRiftDistanceTravelSample;
  minTilePx: number;
  maxTilePx: number;
  travelSpeedTilesPerTick: number;
  minTravelTicks: number;
  correctionThreshold: number;
}): GuardianOfTheRiftDistanceTileCorrectionResult {
  const previousTilePx = clampTilePx(params.travel.tilePx, params.minTilePx, params.maxTilePx);
  const key = buildProfileKey(params.bitmap, params.context);
  const historyPath = getGuardianOfTheRiftDistanceTileHistoryPath();
  const baseResult = {
    key,
    path: historyPath,
    previousTilePx,
    nextTilePx: previousTilePx,
    adjusted: false,
    correctionDebt: 0,
    correctionThreshold: params.correctionThreshold,
    correctionObservationCount: 0,
  };

  if (params.travel.travelTicks < params.minTravelTicks) {
    return {
      ...baseResult,
      recorded: false,
      ignoredReason: `travel=${params.travel.travelTicks} tick(s) below correction minimum ${params.minTravelTicks}`,
      candidateTilePx: null,
    };
  }

  const axisDistancePx = params.travel.distanceTiles * params.travel.tilePx;
  const oneMoreTravelTickMaxTilePx =
    Math.ceil(axisDistancePx / Math.max(1, params.travel.travelTicks * params.travelSpeedTilesPerTick)) - 1;
  const candidateTilePx = clampTilePx(
    Math.min(
      previousTilePx - 1,
      oneMoreTravelTickMaxTilePx,
    ),
    params.minTilePx,
    params.maxTilePx,
  );

  if (candidateTilePx >= previousTilePx) {
    return {
      ...baseResult,
      recorded: false,
      ignoredReason: `candidateTilePx=${candidateTilePx}px is not lower than current ${previousTilePx}px`,
      candidateTilePx,
    };
  }

  const history = readHistoryFile(params.minTilePx, params.maxTilePx);
  const profile = getOrCreateProfile(history, params.bitmap, params.context, params.minTilePx, params.maxTilePx);
  const nowIso = new Date().toISOString();
  profile.correctionObservations = [
    ...profile.correctionObservations,
    {
      observedAtIso: nowIso,
      phase: params.phase,
      reason: params.reason,
      previousTilePx,
      candidateTilePx,
      distancePx: params.travel.distancePx,
      axisDistancePx,
      distanceTiles: params.travel.distanceTiles,
      travelTicks: params.travel.travelTicks,
      waitTicks: params.travel.waitTicks,
    },
  ].slice(-MAX_CORRECTION_OBSERVATIONS_PER_PROFILE);
  profile.correctionDebt += 1;

  let nextTilePx = previousTilePx;
  let adjusted = false;
  if (profile.correctionDebt >= Math.max(1, params.correctionThreshold)) {
    nextTilePx = Math.min(profile.learnedTilePx ?? previousTilePx, candidateTilePx);
    profile.learnedTilePx = clampTilePx(nextTilePx, params.minTilePx, params.maxTilePx);
    profile.correctionDebt = 0;
    adjusted = true;
  }

  profile.updatedAtIso = nowIso;
  writeHistoryFile(history);

  return {
    recorded: true,
    ignoredReason: null,
    key: profile.key,
    path: historyPath,
    previousTilePx,
    candidateTilePx,
    nextTilePx: adjusted ? nextTilePx : previousTilePx,
    adjusted,
    correctionDebt: profile.correctionDebt,
    correctionThreshold: Math.max(1, params.correctionThreshold),
    correctionObservationCount: profile.correctionObservations.length,
  };
}
