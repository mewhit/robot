export type EndToEndConfig = {
  playerName: string;
  completedGuideStepIds: string[];
  completedGuideStepIdsByPlayerName: Record<string, string[]>;
  sceneMouseCalibration: EndToEndSceneMouseCalibration | null;
  sceneMouseCalibrationsByProfileKey: Record<string, EndToEndSceneMouseCalibration>;
};

export type EndToEndSceneMouseCalibrationSample = {
  localX: number;
  localY: number;
  dxTiles: number;
  dyTiles: number;
  tileX: number;
  tileY: number;
  z: number;
  source: string;
  createdAt: string;
};

export type EndToEndSceneMouseCalibrationFit = {
  xDx: number;
  xDy: number;
  xOffset: number;
  yDx: number;
  yDy: number;
  yOffset: number;
  sampleCount: number;
  meanErrorPx: number;
  maxErrorPx: number;
  projective?: EndToEndSceneMouseCalibrationProjectiveFit | null;
};

export type EndToEndSceneMouseCalibrationProjectiveFit = {
  xDx: number;
  xDy: number;
  xOffset: number;
  yDx: number;
  yDy: number;
  yOffset: number;
  wDx: number;
  wDy: number;
  sampleCount: number;
  meanErrorPx: number;
  maxErrorPx: number;
};

export type EndToEndSceneMouseCalibration = {
  schemaVersion: 1;
  updatedAt: string;
  windowsScalePercent: number;
  captureWidth: number;
  captureHeight: number;
  runeliteWindowWidth: number | null;
  runeliteWindowHeight: number | null;
  profileKey: string | null;
  samples: EndToEndSceneMouseCalibrationSample[];
  fit: EndToEndSceneMouseCalibrationFit | null;
};

export function normalizeEndToEndPlayerName(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/\s+/g, " ").slice(0, 12);
}

function normalizeCompletedGuideStepIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map((stepId) => String(stepId).trim()).filter(Boolean))].slice(0, 2000)
    : [];
}

function normalizeCompletedGuideStepIdsByPlayerName(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, string[]> = {};
  for (const [rawPlayerName, rawStepIds] of Object.entries(value)) {
    const playerName = normalizeEndToEndPlayerName(rawPlayerName);
    if (!playerName) {
      continue;
    }

    result[playerName] = normalizeCompletedGuideStepIds(rawStepIds);
  }

  return result;
}

function normalizeSceneMouseCalibrationsByProfileKey(value: unknown): Record<string, EndToEndSceneMouseCalibration> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, EndToEndSceneMouseCalibration> = {};
  for (const [rawProfileKey, rawCalibration] of Object.entries(value)) {
    const profileKey = String(rawProfileKey).trim().slice(0, 120);
    if (!profileKey) {
      continue;
    }

    const calibration = normalizeEndToEndSceneMouseCalibration(rawCalibration);
    if (!calibration) {
      continue;
    }

    result[calibration.profileKey || profileKey] = calibration;
  }

  return result;
}

export function normalizeEndToEndConfig(value: unknown): EndToEndConfig {
  const candidate = value && typeof value === "object" ? (value as Partial<EndToEndConfig>) : {};
  const playerName = normalizeEndToEndPlayerName(candidate.playerName);
  const legacyCompletedGuideStepIds = normalizeCompletedGuideStepIds(candidate.completedGuideStepIds);
  const completedGuideStepIdsByPlayerName = normalizeCompletedGuideStepIdsByPlayerName(
    candidate.completedGuideStepIdsByPlayerName,
  );
  if (playerName && legacyCompletedGuideStepIds.length > 0 && !completedGuideStepIdsByPlayerName[playerName]) {
    completedGuideStepIdsByPlayerName[playerName] = legacyCompletedGuideStepIds;
  }
  const sceneMouseCalibration = normalizeEndToEndSceneMouseCalibration(candidate.sceneMouseCalibration);
  const sceneMouseCalibrationsByProfileKey = normalizeSceneMouseCalibrationsByProfileKey(
    candidate.sceneMouseCalibrationsByProfileKey,
  );
  if (sceneMouseCalibration?.profileKey && !sceneMouseCalibrationsByProfileKey[sceneMouseCalibration.profileKey]) {
    sceneMouseCalibrationsByProfileKey[sceneMouseCalibration.profileKey] = sceneMouseCalibration;
  }

  return {
    playerName,
    completedGuideStepIds: playerName
      ? completedGuideStepIdsByPlayerName[playerName] ?? []
      : legacyCompletedGuideStepIds,
    completedGuideStepIdsByPlayerName,
    sceneMouseCalibration,
    sceneMouseCalibrationsByProfileKey,
  };
}

export function createDefaultEndToEndConfig(): EndToEndConfig {
  return {
    playerName: "",
    completedGuideStepIds: [],
    completedGuideStepIdsByPlayerName: {},
    sceneMouseCalibration: null,
    sceneMouseCalibrationsByProfileKey: {},
  };
}

export function setEndToEndConfigActivePlayerName(config: EndToEndConfig, playerName: string): EndToEndConfig {
  const normalizedPlayerName = normalizeEndToEndPlayerName(playerName);
  const normalizedConfig = normalizeEndToEndConfig(config);
  if (!normalizedPlayerName) {
    return normalizedConfig;
  }

  const completedGuideStepIdsByPlayerName = {
    ...normalizedConfig.completedGuideStepIdsByPlayerName,
  };
  if (normalizedConfig.playerName && normalizedConfig.completedGuideStepIds.length > 0) {
    completedGuideStepIdsByPlayerName[normalizedConfig.playerName] = normalizedConfig.completedGuideStepIds;
  }

  return normalizeEndToEndConfig({
    ...normalizedConfig,
    playerName: normalizedPlayerName,
    completedGuideStepIds: completedGuideStepIdsByPlayerName[normalizedPlayerName] ?? [],
    completedGuideStepIdsByPlayerName,
  });
}

export function setEndToEndGuideStepCompletion(
  config: EndToEndConfig,
  stepId: string,
  completed: boolean,
): EndToEndConfig {
  const normalizedConfig = normalizeEndToEndConfig(config);
  const normalizedStepId = String(stepId).trim();
  if (!normalizedStepId) {
    return normalizedConfig;
  }

  const completedGuideStepIds = new Set(normalizedConfig.completedGuideStepIds);
  if (completed) {
    completedGuideStepIds.add(normalizedStepId);
  } else {
    completedGuideStepIds.delete(normalizedStepId);
  }

  const nextCompletedGuideStepIds = Array.from(completedGuideStepIds);
  const completedGuideStepIdsByPlayerName = {
    ...normalizedConfig.completedGuideStepIdsByPlayerName,
  };
  if (normalizedConfig.playerName) {
    completedGuideStepIdsByPlayerName[normalizedConfig.playerName] = nextCompletedGuideStepIds;
  }

  return normalizeEndToEndConfig({
    ...normalizedConfig,
    completedGuideStepIds: nextCompletedGuideStepIds,
    completedGuideStepIdsByPlayerName,
  });
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeIsoString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : new Date().toISOString();
}

function normalizeSceneMouseCalibrationSample(value: unknown): EndToEndSceneMouseCalibrationSample | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<EndToEndSceneMouseCalibrationSample>;
  if (
    !isFiniteNumber(candidate.localX) ||
    !isFiniteNumber(candidate.localY) ||
    !isFiniteNumber(candidate.dxTiles) ||
    !isFiniteNumber(candidate.dyTiles) ||
    !isFiniteNumber(candidate.tileX) ||
    !isFiniteNumber(candidate.tileY) ||
    !isFiniteNumber(candidate.z)
  ) {
    return null;
  }

  return {
    localX: Math.round(candidate.localX),
    localY: Math.round(candidate.localY),
    dxTiles: Math.round(candidate.dxTiles),
    dyTiles: Math.round(candidate.dyTiles),
    tileX: Math.round(candidate.tileX),
    tileY: Math.round(candidate.tileY),
    z: Math.round(candidate.z),
    source: typeof candidate.source === "string" ? candidate.source.trim().slice(0, 80) : "unknown",
    createdAt: normalizeIsoString(candidate.createdAt),
  };
}

function normalizeSceneMouseCalibrationFit(value: unknown): EndToEndSceneMouseCalibrationFit | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<EndToEndSceneMouseCalibrationFit>;
  if (
    !isFiniteNumber(candidate.xDx) ||
    !isFiniteNumber(candidate.xDy) ||
    !isFiniteNumber(candidate.xOffset) ||
    !isFiniteNumber(candidate.yDx) ||
    !isFiniteNumber(candidate.yDy) ||
    !isFiniteNumber(candidate.yOffset) ||
    !isFiniteNumber(candidate.sampleCount) ||
    !isFiniteNumber(candidate.meanErrorPx) ||
    !isFiniteNumber(candidate.maxErrorPx)
  ) {
    return null;
  }

  return {
    xDx: candidate.xDx,
    xDy: candidate.xDy,
    xOffset: candidate.xOffset,
    yDx: candidate.yDx,
    yDy: candidate.yDy,
    yOffset: candidate.yOffset,
    sampleCount: Math.max(0, Math.round(candidate.sampleCount)),
    meanErrorPx: Math.max(0, candidate.meanErrorPx),
    maxErrorPx: Math.max(0, candidate.maxErrorPx),
    projective: normalizeSceneMouseCalibrationProjectiveFit(candidate.projective),
  };
}

function normalizeSceneMouseCalibrationProjectiveFit(
  value: unknown,
): EndToEndSceneMouseCalibrationProjectiveFit | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<EndToEndSceneMouseCalibrationProjectiveFit>;
  if (
    !isFiniteNumber(candidate.xDx) ||
    !isFiniteNumber(candidate.xDy) ||
    !isFiniteNumber(candidate.xOffset) ||
    !isFiniteNumber(candidate.yDx) ||
    !isFiniteNumber(candidate.yDy) ||
    !isFiniteNumber(candidate.yOffset) ||
    !isFiniteNumber(candidate.wDx) ||
    !isFiniteNumber(candidate.wDy) ||
    !isFiniteNumber(candidate.sampleCount) ||
    !isFiniteNumber(candidate.meanErrorPx) ||
    !isFiniteNumber(candidate.maxErrorPx)
  ) {
    return null;
  }

  return {
    xDx: candidate.xDx,
    xDy: candidate.xDy,
    xOffset: candidate.xOffset,
    yDx: candidate.yDx,
    yDy: candidate.yDy,
    yOffset: candidate.yOffset,
    wDx: candidate.wDx,
    wDy: candidate.wDy,
    sampleCount: Math.max(0, Math.round(candidate.sampleCount)),
    meanErrorPx: Math.max(0, candidate.meanErrorPx),
    maxErrorPx: Math.max(0, candidate.maxErrorPx),
  };
}

export function normalizeEndToEndSceneMouseCalibration(value: unknown): EndToEndSceneMouseCalibration | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<EndToEndSceneMouseCalibration>;
  if (
    candidate.schemaVersion !== 1 ||
    !isFiniteNumber(candidate.windowsScalePercent) ||
    !isFiniteNumber(candidate.captureWidth) ||
    !isFiniteNumber(candidate.captureHeight)
  ) {
    return null;
  }

  const samples = Array.isArray(candidate.samples)
    ? candidate.samples.map(normalizeSceneMouseCalibrationSample).filter((sample): sample is EndToEndSceneMouseCalibrationSample => sample !== null)
    : [];

  return {
    schemaVersion: 1,
    updatedAt: normalizeIsoString(candidate.updatedAt),
    windowsScalePercent: Math.round(candidate.windowsScalePercent),
    captureWidth: Math.round(candidate.captureWidth),
    captureHeight: Math.round(candidate.captureHeight),
    runeliteWindowWidth: isFiniteNumber(candidate.runeliteWindowWidth) ? Math.round(candidate.runeliteWindowWidth) : null,
    runeliteWindowHeight: isFiniteNumber(candidate.runeliteWindowHeight) ? Math.round(candidate.runeliteWindowHeight) : null,
    profileKey: typeof candidate.profileKey === "string" ? candidate.profileKey.trim().slice(0, 120) : null,
    samples: samples.slice(-80),
    fit: normalizeSceneMouseCalibrationFit(candidate.fit),
  };
}
