export const AGILITY_BOT_ID = "agility";
export const ATTACK_ZAMORAK_WARRIOR_SAFE_SPOT_BOT_ID = "attack-zamorak-warrior-safe-spot";
export const COMBAT_AUTO_BOT_ID = "combat-auto";
export const END_TO_END_BOT_ID = "end-to-end";
export const MINING_GUILD_COAL_ORE_BOT_ID = "mining-guild-coal-ore";
export const MINING_GUILD_MITHRIL_ORE_BOT_ID = "mining-guild-mithril-ore";
export const MINING_MOTHERLODE_MINE_BOT_ID = "mining-motherlode-mine";
export const MINING_MOTHERLODE_MINE_V2_BOT_ID = "mining-motherlode-mine-v2";
export const MINING_MOTHERLODE_MINE_V3_BOT_ID = "mining-motherlode-mine-v3";
export const RUNECRAFTING_ARCEUUS_BLOOD_RUNE_BOT_ID = "runecrafting-arceuus-blood-rune";
export const RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID = "runecrafting-guardian-of-the-rift";

export type AutomateBotId =
  | typeof AGILITY_BOT_ID
  | typeof ATTACK_ZAMORAK_WARRIOR_SAFE_SPOT_BOT_ID
  | typeof COMBAT_AUTO_BOT_ID
  | typeof END_TO_END_BOT_ID
  | typeof MINING_GUILD_COAL_ORE_BOT_ID
  | typeof MINING_GUILD_MITHRIL_ORE_BOT_ID
  | typeof MINING_MOTHERLODE_MINE_BOT_ID
  | typeof MINING_MOTHERLODE_MINE_V2_BOT_ID
  | typeof MINING_MOTHERLODE_MINE_V3_BOT_ID
  | typeof RUNECRAFTING_ARCEUUS_BLOOD_RUNE_BOT_ID
  | typeof RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID;

export type AutomateBotDefinition = {
  id: AutomateBotId;
  name: string;
  group?: string;
  versionName?: string;
};

export const AUTOMATE_BOTS: AutomateBotDefinition[] = [
  {
    id: AGILITY_BOT_ID,
    name: "Agility",
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
    id: RUNECRAFTING_ARCEUUS_BLOOD_RUNE_BOT_ID,
    name: "Arceuus (Blood Rune)",
    group: "Runecrafting",
    versionName: "dense-runestone-mining-v1",
  },
  {
    id: RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID,
    name: "Guardian of the Rift",
    group: "Runecrafting",
    versionName: "optimized-salmon-guardian-safe-click",
  },
];

export const DEFAULT_AUTOMATE_BOT_ID: AutomateBotId = AUTOMATE_BOTS[0].id;

export function isAutomateBotId(value: string): value is AutomateBotId {
  return AUTOMATE_BOTS.some((bot) => bot.id === value);
}
