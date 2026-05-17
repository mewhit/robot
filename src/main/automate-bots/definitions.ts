const LEGACY_AGILITY_BOT_ID = "agility";

export const AGILITY_FALADOR_ROOFTOP_BOT_ID = "agility-falador-rooftop";
export const AGILITY_BOT_ID = AGILITY_FALADOR_ROOFTOP_BOT_ID;
export const ATTACK_ZAMORAK_WARRIOR_SAFE_SPOT_BOT_ID = "attack-zamorak-warrior-safe-spot";
export const COMBAT_AUTO_BOT_ID = "combat-auto";
export const END_TO_END_BOT_ID = "end-to-end";
export const MINING_GUILD_COAL_ORE_BOT_ID = "mining-guild-coal-ore";
export const MINING_GUILD_MITHRIL_ORE_BOT_ID = "mining-guild-mithril-ore";
export const MINING_MOTHERLODE_MINE_BOT_ID = "mining-motherlode-mine";
export const MINING_MOTHERLODE_MINE_V2_BOT_ID = "mining-motherlode-mine-v2";
export const MINING_MOTHERLODE_MINE_V3_BOT_ID = "mining-motherlode-mine-v3";
const LEGACY_RUNECRAFTING_ARCEUUS_BLOOD_RUNE_BOT_ID = "runecrafting-arceuus-blood-rune";
export const RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_BOT_ID = "runecrafting-arceuus-blood-rune-v2";
export const RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID = "runecrafting-guardian-of-the-rift";

export type AutomateBotStepDefinition = {
  id: string;
  name: string;
};

export const AGILITY_FALADOR_ROOFTOP_STEPS = [
  { id: `${AGILITY_FALADOR_ROOFTOP_BOT_ID}-step-watch`, name: "Watch Highlights" },
] as const satisfies readonly AutomateBotStepDefinition[];

export const RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_STEPS = [
  { id: `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_BOT_ID}-step-00-plugin-check`, name: "Step 00 Plugin Check" },
  { id: `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_BOT_ID}-step-01-mine`, name: "Step 01 Mine" },
  { id: `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_BOT_ID}-step-02-altar-travel`, name: "Step 02 Altar Travel" },
  { id: `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_BOT_ID}-step-03-chisel-dark-essence`, name: "Step 03 Chisel Dark Essence" },
  { id: `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_BOT_ID}-step-04-re-mine`, name: "Step 04 Re-Mine" },
  { id: `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_BOT_ID}-step-05-dark-altar-2`, name: "Step 05 Dark Altar 2" },
  { id: `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_BOT_ID}-step-06-blood-altar`, name: "Step 06 Blood Altar" },
  { id: `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_BOT_ID}-step-07-chisel-blood-altar`, name: "Step 07 Chisel Blood Altar" },
  { id: `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_BOT_ID}-step-08-return-agility-shortcut`, name: "Step 08 Return Agility Shortcut" },
  { id: `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_BOT_ID}-step-09-mine-again`, name: "Step 09 Mine Again" },
  { id: `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_BOT_ID}-step-10-altar-travel`, name: "Step 10 Altar Travel" },
  { id: `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_BOT_ID}-step-11-follow-blue-tiles`, name: "Step 11 Follow Blue Tiles" },
  { id: `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_BOT_ID}-step-12-click-magenta`, name: "Step 12 Click Magenta" },
  { id: `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_BOT_ID}-step-12-check-magenta-inventory`, name: "Step 12 Check Magenta Inventory" },
  { id: `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_BOT_ID}-step-13-follow-another-blue`, name: "Step 13 Follow Another Blue" },
  { id: `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_BOT_ID}-step-14-blood-altar-craft`, name: "Step 14 Blood Altar Craft" },
  { id: `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_BOT_ID}-step-15-return-to-mining`, name: "Step 15 Return To Mining" },
] as const satisfies readonly AutomateBotStepDefinition[];

export type AutomateBotId =
  | typeof AGILITY_FALADOR_ROOFTOP_BOT_ID
  | typeof ATTACK_ZAMORAK_WARRIOR_SAFE_SPOT_BOT_ID
  | typeof COMBAT_AUTO_BOT_ID
  | typeof END_TO_END_BOT_ID
  | typeof MINING_GUILD_COAL_ORE_BOT_ID
  | typeof MINING_GUILD_MITHRIL_ORE_BOT_ID
  | typeof MINING_MOTHERLODE_MINE_BOT_ID
  | typeof MINING_MOTHERLODE_MINE_V2_BOT_ID
  | typeof MINING_MOTHERLODE_MINE_V3_BOT_ID
  | typeof RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_BOT_ID
  | typeof RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID;

export type AutomateBotDefinition = {
  id: AutomateBotId;
  name: string;
  group?: string;
  versionName?: string;
  steps?: readonly AutomateBotStepDefinition[];
};

export const AUTOMATE_BOTS: AutomateBotDefinition[] = [
  {
    id: AGILITY_FALADOR_ROOFTOP_BOT_ID,
    name: "Falador Rooftop",
    group: "Agility",
    versionName: "falador-rooftop-v2",
    steps: AGILITY_FALADOR_ROOFTOP_STEPS,
  },
  {
    id: END_TO_END_BOT_ID,
    name: "End To End",
  },
  {
    id: COMBAT_AUTO_BOT_ID,
    name: "Auto",
    group: "Combat",
  },
  {
    id: MINING_GUILD_COAL_ORE_BOT_ID,
    name: "Mining Guild Coal Ore (engine)",
    group: "Mining",
  },
  {
    id: MINING_GUILD_MITHRIL_ORE_BOT_ID,
    name: "Mining Guild Mithril Ore (engine)",
    group: "Mining",
  },
  {
    id: ATTACK_ZAMORAK_WARRIOR_SAFE_SPOT_BOT_ID,
    name: "Zamorak Warrior SafeSpot (unfinished)",
    group: "Combat",
  },
  {
    id: MINING_MOTHERLODE_MINE_BOT_ID,
    name: "Motherlode Mine",
    group: "Mining",
  },
  {
    id: MINING_MOTHERLODE_MINE_V2_BOT_ID,
    name: "Motherlode Mine V2",
    group: "Mining",
  },
  {
    id: MINING_MOTHERLODE_MINE_V3_BOT_ID,
    name: "Motherlode Mine V3 (engine)",
    group: "Mining",
  },
  {
    id: RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_BOT_ID,
    name: "Arceuus (Blood Rune)",
    group: "Runecrafting",
    versionName: "step-scaffold-v2",
    steps: RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_STEPS,
  },
  {
    id: RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID,
    name: "Guardian of the Rift",
    group: "Runecrafting",
    versionName: "optimized-salmon-guardian-safe-click",
  },
];

export const DEFAULT_AUTOMATE_BOT_ID: AutomateBotId = AUTOMATE_BOTS[0].id;

export function normalizeAutomateBotId(value: string | null | undefined): AutomateBotId | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    return null;
  }

  if (normalized === LEGACY_AGILITY_BOT_ID) {
    return AGILITY_FALADOR_ROOFTOP_BOT_ID;
  }

  if (normalized === LEGACY_RUNECRAFTING_ARCEUUS_BLOOD_RUNE_BOT_ID) {
    return RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_BOT_ID;
  }

  return isAutomateBotId(normalized) ? normalized : null;
}

export function isAutomateBotId(value: string): value is AutomateBotId {
  return AUTOMATE_BOTS.some((bot) => bot.id === value);
}
