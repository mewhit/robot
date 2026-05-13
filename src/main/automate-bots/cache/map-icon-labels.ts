export const OSRS_MAP_ICON_LABEL_BY_SPRITE_ID: ReadonlyMap<number, string> = new Map<number, string>([
  [1447, "General store"],
  [1448, "Sword shop"],
  [1449, "Magic shop"],
  [1450, "Axe shop"],
  [1451, "Helmet shop"],
  [1452, "Bank"],
  [1453, "Quest start"],
  [1454, "Amulet shop"],
  [1455, "Mining site"],
  [1456, "Furnace"],
  [1457, "Anvil"],
  [1458, "Combat training"],
  [1459, "Dungeon"],
  [1460, "Staff shop"],
  [1461, "Platebody shop"],
  [1462, "Platelegs shop"],
  [1463, "Scimitar shop"],
  [1464, "Archery shop"],
  [1465, "Shield shop"],
  [1466, "Altar"],
  [1467, "Herbalist"],
  [1468, "Jewellery shop"],
  [1469, "Gem shop"],
  [1470, "Crafting shop"],
  [1471, "Candle shop"],
  [1472, "Fishing shop"],
  [1473, "Fishing spot"],
  [1474, "Clothes shop"],
  [1475, "Apothecary"],
  [1476, "Silk trader"],
  [1477, "Kebab seller"],
  [1478, "Pub"],
  [1479, "Mace shop"],
  [1480, "Tannery"],
  [1481, "Rare trees"],
  [1482, "Spinning wheel"],
  [1483, "Food shop"],
  [1484, "Cookery shop"],
  [1485, "Miniquest"],
  [1486, "Water source"],
  [1487, "Cooking range"],
  [1488, "Skirt shop"],
  [1489, "Silver shop"],
  [1490, "Transportation"],
  [1491, "Agility shortcut"],
]);

export function resolveOsrsMapIconLabel(params: {
  areaName?: string | null;
  spriteId: number;
  objectName?: string | null;
}): string | null {
  const areaName = params.areaName?.trim();
  if (areaName) {
    return areaName;
  }

  const spriteLabel = OSRS_MAP_ICON_LABEL_BY_SPRITE_ID.get(params.spriteId);
  if (spriteLabel) {
    return spriteLabel;
  }

  const objectName = params.objectName?.trim();
  if (objectName && objectName !== "null") {
    return objectName;
  }

  return null;
}
