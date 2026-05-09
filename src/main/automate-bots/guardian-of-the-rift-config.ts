export const GUARDIAN_OF_THE_RIFT_POUCHES = ["small", "medium", "large", "giant", "abyssal"] as const;
export type GuardianOfTheRiftPouch = (typeof GUARDIAN_OF_THE_RIFT_POUCHES)[number];

export const GUARDIAN_OF_THE_RIFT_ACTIVE_ELEMENTS = [
  "air",
  "water",
  "earth",
  "fire",
  "mind",
  "body",
  "chaos",
  "cosmic",
  "nature",
  "law",
  "death",
  "blood",
] as const;

export type GuardianOfTheRiftActiveElement = (typeof GUARDIAN_OF_THE_RIFT_ACTIVE_ELEMENTS)[number];

export type GuardianOfTheRiftConfig = {
  useAgilityCourse: boolean;
  runecraftLevel: number;
  activeGuardianElements: Record<GuardianOfTheRiftActiveElement, boolean>;
  pouches: Record<GuardianOfTheRiftPouch, boolean>;
};

export type GuardianOfTheRiftColossalPouchStats = {
  capacity: number;
  fullUsesBeforeDecay: number;
};

export function getGuardianOfTheRiftColossalPouchStats(
  runecraftLevel: number,
): GuardianOfTheRiftColossalPouchStats | null {
  if (runecraftLevel >= 85) {
    return { capacity: 40, fullUsesBeforeDecay: 8 };
  }

  if (runecraftLevel >= 75) {
    return { capacity: 27, fullUsesBeforeDecay: 12 };
  }

  if (runecraftLevel >= 50) {
    return { capacity: 16, fullUsesBeforeDecay: 20 };
  }

  if (runecraftLevel >= 25) {
    return { capacity: 8, fullUsesBeforeDecay: 40 };
  }

  return null;
}

export function normalizeGuardianOfTheRiftRunecraftLevel(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 77;
  }

  return Math.max(1, Math.min(99, Math.round(value)));
}

export function createDefaultGuardianOfTheRiftConfig(): GuardianOfTheRiftConfig {
  const activeGuardianElements = {} as Record<GuardianOfTheRiftActiveElement, boolean>;

  for (const element of GUARDIAN_OF_THE_RIFT_ACTIVE_ELEMENTS) {
    activeGuardianElements[element] = true;
  }

  const pouches = {} as Record<GuardianOfTheRiftPouch, boolean>;
  for (const pouch of GUARDIAN_OF_THE_RIFT_POUCHES) {
    pouches[pouch] = false;
  }

  return {
    useAgilityCourse: false,
    runecraftLevel: 77,
    activeGuardianElements,
    pouches,
  };
}

export function normalizeGuardianOfTheRiftConfig(raw: unknown): GuardianOfTheRiftConfig {
  const defaults = createDefaultGuardianOfTheRiftConfig();
  if (!raw || typeof raw !== "object") {
    return defaults;
  }

  const candidate = raw as Partial<GuardianOfTheRiftConfig>;
  const normalizedActiveElements = { ...defaults.activeGuardianElements };

  if (candidate.activeGuardianElements && typeof candidate.activeGuardianElements === "object") {
    const activeElements = candidate.activeGuardianElements as Partial<Record<GuardianOfTheRiftActiveElement, boolean>>;

    for (const element of GUARDIAN_OF_THE_RIFT_ACTIVE_ELEMENTS) {
      const value = activeElements[element];
      if (typeof value === "boolean") {
        normalizedActiveElements[element] = value;
      }
    }
  }

  const normalizedPouches = { ...defaults.pouches };
  if (candidate.pouches && typeof candidate.pouches === "object") {
    const rawPouches = candidate.pouches as Partial<Record<GuardianOfTheRiftPouch, boolean>>;
    for (const pouch of GUARDIAN_OF_THE_RIFT_POUCHES) {
      const value = rawPouches[pouch];
      if (typeof value === "boolean") {
        normalizedPouches[pouch] = value;
      }
    }
  }

  // Enforce abyssal-exclusive constraint: if abyssal is on, disable all others
  if (normalizedPouches.abyssal) {
    for (const pouch of GUARDIAN_OF_THE_RIFT_POUCHES) {
      if (pouch !== "abyssal") {
        normalizedPouches[pouch] = false;
      }
    }
  }

  return {
    useAgilityCourse:
      typeof candidate.useAgilityCourse === "boolean" ? candidate.useAgilityCourse : defaults.useAgilityCourse,
    runecraftLevel: normalizeGuardianOfTheRiftRunecraftLevel(candidate.runecraftLevel),
    activeGuardianElements: normalizedActiveElements,
    pouches: normalizedPouches,
  };
}
