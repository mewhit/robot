export type AllInOneMiningOreDefinition = {
  id: string;
  label: string;
  cacheObjectNames: readonly string[];
  inventoryItemIds?: readonly number[];
};

export type AllInOneMiningLearnedMiningStats = {
  oreId: string;
  sampleCount: number;
  averageMineMs: number;
  lastMineMs: number;
  updatedAt: string;
};

export const ALL_IN_ONE_MINING_ORE_TYPES = [
  {
    id: "clay",
    label: "Clay",
    cacheObjectNames: ["Clay rocks", "Clay ore vein", "Soft clay rocks"],
    inventoryItemIds: [434],
  },
  {
    id: "copper",
    label: "Copper",
    cacheObjectNames: ["Copper rocks", "Copper ore vein"],
    inventoryItemIds: [436],
  },
  {
    id: "tin",
    label: "Tin",
    cacheObjectNames: ["Tin rocks", "Tin ore vein"],
    inventoryItemIds: [438],
  },
  {
    id: "iron",
    label: "Iron",
    cacheObjectNames: ["Iron rocks", "Iron ore vein"],
    inventoryItemIds: [440],
  },
  {
    id: "coal",
    label: "Coal",
    cacheObjectNames: ["Coal rocks", "Coal ore vein"],
    inventoryItemIds: [453],
  },
  {
    id: "silver",
    label: "Silver",
    cacheObjectNames: ["Silver rocks"],
    inventoryItemIds: [442],
  },
  {
    id: "gold",
    label: "Gold",
    cacheObjectNames: ["Gold rocks", "Gold vein"],
    inventoryItemIds: [444],
  },
  {
    id: "mithril",
    label: "Mithril",
    cacheObjectNames: ["Mithril rocks", "Mithril ore vein"],
    inventoryItemIds: [447],
  },
  {
    id: "adamantite",
    label: "Adamantite",
    cacheObjectNames: ["Adamantite rocks", "Adamant ore vein"],
    inventoryItemIds: [449],
  },
  {
    id: "runite",
    label: "Runite",
    cacheObjectNames: ["Runite rocks"],
    inventoryItemIds: [451],
  },
  {
    id: "blurite",
    label: "Blurite",
    cacheObjectNames: ["Blurite rocks"],
    inventoryItemIds: [668],
  },
  {
    id: "gem",
    label: "Gem",
    cacheObjectNames: ["Gem rocks", "Gem Rock", "Gemstone rock"],
    inventoryItemIds: [1617, 1619, 1621, 1623, 1625, 1627, 1629],
  },
  {
    id: "limestone",
    label: "Limestone",
    cacheObjectNames: ["Limestone rock"],
    inventoryItemIds: [3211],
  },
  {
    id: "sandstone",
    label: "Sandstone",
    cacheObjectNames: ["Sandstone rocks"],
    inventoryItemIds: [6971, 6973, 6975, 6977],
  },
  {
    id: "granite",
    label: "Granite",
    cacheObjectNames: ["Granite rocks"],
    inventoryItemIds: [6979, 6981, 6983],
  },
  {
    id: "amethyst",
    label: "Amethyst",
    cacheObjectNames: ["Amethyst crystals"],
    inventoryItemIds: [21347],
  },
  {
    id: "basalt",
    label: "Basalt",
    cacheObjectNames: ["Basalt rock", "Basalt rocks"],
    inventoryItemIds: [22603],
  },
  {
    id: "rune-essence",
    label: "Rune essence",
    cacheObjectNames: ["Rune essence", "Rune Essence"],
    inventoryItemIds: [1436, 7936],
  },
  {
    id: "dense-runestone",
    label: "Dense runestone",
    cacheObjectNames: ["Dense runestone"],
    inventoryItemIds: [13445, 13446, 7938],
  },
  {
    id: "daeyalt",
    label: "Daeyalt",
    cacheObjectNames: ["Daeyalt Essence", "Daeyalt rocks"],
    inventoryItemIds: [24706],
  },
  {
    id: "volcanic-sulphur",
    label: "Volcanic sulphur",
    cacheObjectNames: ["Volcanic sulphur", "Sulphur"],
    inventoryItemIds: [13571],
  },
  {
    id: "lovakite",
    label: "Lovakite",
    cacheObjectNames: ["Lovakite rocks"],
    inventoryItemIds: [13356],
  },
  {
    id: "barronite",
    label: "Barronite",
    cacheObjectNames: ["Barronite rocks"],
    inventoryItemIds: [25666, 25684],
  },
  {
    id: "calcified",
    label: "Calcified",
    cacheObjectNames: ["Calcified rocks"],
  },
  {
    id: "salt",
    label: "Salt",
    cacheObjectNames: ["Te salt rocks", "Efh salt rocks", "Urt salt rocks", "Salt Deposit"],
    inventoryItemIds: [22593, 22595, 22597],
  },
  {
    id: "saltpetre",
    label: "Saltpetre",
    cacheObjectNames: ["Saltpetre"],
    inventoryItemIds: [13421],
  },
  {
    id: "crashed-star",
    label: "Crashed Star",
    cacheObjectNames: ["Crashed Star"],
    inventoryItemIds: [25527],
  },
  {
    id: "ore-vein",
    label: "Ore vein",
    cacheObjectNames: ["Ore vein"],
    inventoryItemIds: [12011],
  },
] as const satisfies readonly AllInOneMiningOreDefinition[];

export type AllInOneMiningOreType = (typeof ALL_IN_ONE_MINING_ORE_TYPES)[number]["id"];

export type AllInOneMiningConfig = {
  enabledOreTypes: Record<AllInOneMiningOreType, boolean>;
  learnedMiningStatsByOreId?: Record<string, AllInOneMiningLearnedMiningStats>;
};

const ALL_IN_ONE_MINING_ORE_TYPE_IDS = ALL_IN_ONE_MINING_ORE_TYPES.map((ore) => ore.id);

export function createDefaultAllInOneMiningConfig(): AllInOneMiningConfig {
  const enabledOreTypes = {} as Record<AllInOneMiningOreType, boolean>;
  for (const oreType of ALL_IN_ONE_MINING_ORE_TYPE_IDS) {
    enabledOreTypes[oreType] = false;
  }

  return { enabledOreTypes, learnedMiningStatsByOreId: {} };
}

export function isAllInOneMiningOreType(value: string): value is AllInOneMiningOreType {
  return ALL_IN_ONE_MINING_ORE_TYPE_IDS.some((oreType) => oreType === value);
}

export function normalizeAllInOneMiningConfig(raw: unknown): AllInOneMiningConfig {
  const defaults = createDefaultAllInOneMiningConfig();
  if (!raw || typeof raw !== "object") {
    return defaults;
  }

  const candidate = raw as Partial<AllInOneMiningConfig> & {
    selectedOreTypes?: unknown;
  };
  const enabledOreTypes = { ...defaults.enabledOreTypes };
  const learnedMiningStatsByOreId = normalizeAllInOneMiningLearnedStatsByOreId(candidate.learnedMiningStatsByOreId);

  if (candidate.enabledOreTypes && typeof candidate.enabledOreTypes === "object") {
    const rawOreTypes = candidate.enabledOreTypes as Partial<Record<AllInOneMiningOreType, boolean>>;
    for (const oreType of ALL_IN_ONE_MINING_ORE_TYPE_IDS) {
      if (typeof rawOreTypes[oreType] === "boolean") {
        enabledOreTypes[oreType] = rawOreTypes[oreType] === true;
      }
    }
  }

  if (Array.isArray(candidate.selectedOreTypes)) {
    for (const rawOreType of candidate.selectedOreTypes) {
      if (typeof rawOreType === "string" && isAllInOneMiningOreType(rawOreType)) {
        enabledOreTypes[rawOreType] = true;
      }
    }
  }

  return { enabledOreTypes, learnedMiningStatsByOreId };
}

export function getAllInOneMiningSelectedOreTypes(config: AllInOneMiningConfig): AllInOneMiningOreType[] {
  const normalized = normalizeAllInOneMiningConfig(config);
  return ALL_IN_ONE_MINING_ORE_TYPE_IDS.filter((oreType) => normalized.enabledOreTypes[oreType]);
}

export function setAllInOneMiningOreTypeEnabled(
  config: AllInOneMiningConfig,
  oreType: AllInOneMiningOreType,
  enabled: boolean,
): AllInOneMiningConfig {
  const normalized = normalizeAllInOneMiningConfig(config);
  return {
    enabledOreTypes: {
      ...normalized.enabledOreTypes,
      [oreType]: enabled,
    },
    learnedMiningStatsByOreId: normalized.learnedMiningStatsByOreId,
  };
}

function normalizeAllInOneMiningLearnedStats(value: unknown): AllInOneMiningLearnedMiningStats | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<AllInOneMiningLearnedMiningStats>;
  const oreId = typeof candidate.oreId === "string" ? candidate.oreId.trim() : "";
  const sampleCount = Number(candidate.sampleCount);
  const averageMineMs = Number(candidate.averageMineMs);
  const lastMineMs = Number(candidate.lastMineMs);
  if (
    !isAllInOneMiningOreType(oreId) ||
    !Number.isFinite(sampleCount) ||
    !Number.isFinite(averageMineMs) ||
    !Number.isFinite(lastMineMs)
  ) {
    return null;
  }

  return {
    oreId,
    sampleCount: Math.max(0, Math.round(sampleCount)),
    averageMineMs: Math.max(0, Math.round(averageMineMs)),
    lastMineMs: Math.max(0, Math.round(lastMineMs)),
    updatedAt: typeof candidate.updatedAt === "string" && candidate.updatedAt.trim() ? candidate.updatedAt.trim() : new Date().toISOString(),
  };
}

function normalizeAllInOneMiningLearnedStatsByOreId(
  value: unknown,
): Record<string, AllInOneMiningLearnedMiningStats> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, AllInOneMiningLearnedMiningStats> = {};
  for (const [rawOreId, rawStats] of Object.entries(value)) {
    const stats = normalizeAllInOneMiningLearnedStats(rawStats);
    if (!stats || stats.oreId !== rawOreId) {
      continue;
    }

    result[stats.oreId] = stats;
  }

  return result;
}

export function setAllInOneMiningLearnedMiningStats(
  config: AllInOneMiningConfig,
  oreId: AllInOneMiningOreType,
  observedMineMs: number,
): AllInOneMiningConfig {
  const normalized = normalizeAllInOneMiningConfig(config);
  if (!Number.isFinite(observedMineMs) || observedMineMs <= 0) {
    return normalized;
  }

  const existing = normalized.learnedMiningStatsByOreId?.[oreId] ?? null;
  const sampleCount = (existing?.sampleCount ?? 0) + 1;
  const averageMineMs = Math.round((((existing?.averageMineMs ?? 0) * (sampleCount - 1)) + observedMineMs) / sampleCount);

  return {
    ...normalized,
    learnedMiningStatsByOreId: {
      ...(normalized.learnedMiningStatsByOreId ?? {}),
      [oreId]: {
        oreId,
        sampleCount,
        averageMineMs,
        lastMineMs: Math.round(observedMineMs),
        updatedAt: new Date().toISOString(),
      },
    },
  };
}
