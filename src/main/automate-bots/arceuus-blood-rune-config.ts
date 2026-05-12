export type ArceuusBloodRuneConfig = {
  agilityLevel: number;
};

export function normalizeArceuusBloodRuneAgilityLevel(value: unknown): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) {
    return 1;
  }

  return Math.max(1, Math.min(99, Math.round(raw)));
}

export function createDefaultArceuusBloodRuneConfig(): ArceuusBloodRuneConfig {
  return {
    agilityLevel: 1,
  };
}

export function normalizeArceuusBloodRuneConfig(raw: unknown): ArceuusBloodRuneConfig {
  const defaults = createDefaultArceuusBloodRuneConfig();
  if (!raw || typeof raw !== "object") {
    return defaults;
  }

  const candidate = raw as Partial<ArceuusBloodRuneConfig>;
  return {
    agilityLevel: normalizeArceuusBloodRuneAgilityLevel(candidate.agilityLevel),
  };
}
