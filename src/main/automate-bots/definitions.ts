export const AGILITY_BOT_ID = "agility";
export const ATTACK_ZAMORAK_WARRIOR_SAFE_SPOT_BOT_ID = "attack-zamorak-warrior-safe-spot";

export type AutomateBotId = typeof AGILITY_BOT_ID | typeof ATTACK_ZAMORAK_WARRIOR_SAFE_SPOT_BOT_ID;

export type AutomateBotDefinition = {
  id: AutomateBotId;
  name: string;
};

export const AUTOMATE_BOTS: AutomateBotDefinition[] = [
  {
    id: AGILITY_BOT_ID,
    name: "Agility",
  },
  {
    id: ATTACK_ZAMORAK_WARRIOR_SAFE_SPOT_BOT_ID,
    name: "Attack Zamorak Warrior SafeSpot",
  },
];

export const DEFAULT_AUTOMATE_BOT_ID: AutomateBotId = AUTOMATE_BOTS[0].id;

export function isAutomateBotId(value: string): value is AutomateBotId {
  return AUTOMATE_BOTS.some((bot) => bot.id === value);
}
