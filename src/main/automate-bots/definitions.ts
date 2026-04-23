export const AGILITY_BOT_ID = "agility";
export const ATTACK_ZAMORAK_WARRIOR_SAFE_SPOT_BOT_ID = "attack-zamorak-warrior-safe-spot";
export const COMBAT_AUTO_BOT_ID = "combat-auto";
export const MINING_GUILD_MITHRIL_ORE_BOT_ID = "mining-guild-mithril-ore";
export const MINING_MOTHERLODE_MINE_BOT_ID = "mining-motherlode-mine";
export const MINING_MOTHERLODE_MINE_V2_BOT_ID = "mining-motherlode-mine-v2";
export const MINING_MOTHERLODE_MINE_V3_BOT_ID = "mining-motherlode-mine-v3";

export type AutomateBotId =
  | typeof AGILITY_BOT_ID
  | typeof ATTACK_ZAMORAK_WARRIOR_SAFE_SPOT_BOT_ID
  | typeof COMBAT_AUTO_BOT_ID
  | typeof MINING_GUILD_MITHRIL_ORE_BOT_ID
  | typeof MINING_MOTHERLODE_MINE_BOT_ID
  | typeof MINING_MOTHERLODE_MINE_V2_BOT_ID
  | typeof MINING_MOTHERLODE_MINE_V3_BOT_ID;

export type AutomateBotDefinition = {
  id: AutomateBotId;
  name: string;
  group?: string;
};

export const AUTOMATE_BOTS: AutomateBotDefinition[] = [
  {
    id: AGILITY_BOT_ID,
    name: "Agility",
  },
  {
    id: COMBAT_AUTO_BOT_ID,
    name: "Auto",
    group: "Combat",
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
];

export const DEFAULT_AUTOMATE_BOT_ID: AutomateBotId = AUTOMATE_BOTS[0].id;

export function isAutomateBotId(value: string): value is AutomateBotId {
  return AUTOMATE_BOTS.some((bot) => bot.id === value);
}
