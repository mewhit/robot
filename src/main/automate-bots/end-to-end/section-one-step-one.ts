import { openOsrsCacheStore } from "../cache/cache-store";
import { loadOsrsItemDefinitionsFromCache } from "../cache/osrs-region-cache";
import type { RuneLiteLocalApiItem, RuneLiteLocalApiSnapshot } from "../runelite-local-api/runelite-local-api";

export const SECTION_ONE_STEP_ONE_SOURCE_STEP_ID = "ironman-guide-1.1-step-4";
export const SECTION_ONE_STEP_ONE_BOT_STEP_ID = "section-1-step-1-sell-starter-gear";

const STARTER_GEAR_TO_SELL = ["bronze dagger", "bronze sword", "bronze axe", "wooden shield", "shortbow"];
const REQUIRED_INVENTORY_ITEMS = ["spade"];

export type EndToEndSectionOneStepOneItem = {
  id: number;
  name: string;
  quantity: number;
  source: "inventory" | "equipment";
  slot?: number;
};

export type EndToEndSectionOneStepOneState = {
  status: "complete" | "needs-action";
  sourceStepId: string;
  missingTargetNames: string[];
  presentTargetItems: EndToEndSectionOneStepOneItem[];
  missingRequiredInventoryItemNames: string[];
  presentRequiredInventoryItems: EndToEndSectionOneStepOneItem[];
  inventoryItemNames: string[];
};

function normalizeItemName(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatItemName(name: string, quantity: number): string {
  return quantity > 1 ? `${name} x${quantity}` : name;
}

function formatStateItem(item: EndToEndSectionOneStepOneItem): string {
  const slot = item.slot !== undefined ? `#${item.slot}` : "";
  return `${formatItemName(item.name, item.quantity)}@${item.source}${slot}`;
}

function toNamedItems(
  items: RuneLiteLocalApiItem[],
  source: "inventory" | "equipment",
  itemNamesById: ReadonlyMap<number, string>,
): EndToEndSectionOneStepOneItem[] {
  return items
    .map((item) => {
      if (item.id < 0 || item.quantity <= 0) {
        return null;
      }

      const name = itemNamesById.get(item.id);
      if (!name || name === "null") {
        return null;
      }

      return {
        id: item.id,
        name,
        quantity: item.quantity,
        source,
        ...(item.slot !== undefined ? { slot: item.slot } : {}),
      };
    })
    .filter((item): item is EndToEndSectionOneStepOneItem => item !== null);
}

export function evaluateEndToEndSectionOneStepOne(
  snapshot: RuneLiteLocalApiSnapshot,
  itemNamesById: ReadonlyMap<number, string>,
): EndToEndSectionOneStepOneState {
  const namedItems = [
    ...toNamedItems(snapshot.inventory, "inventory", itemNamesById),
    ...toNamedItems(snapshot.equipment, "equipment", itemNamesById),
  ];
  const targetNames = new Set(STARTER_GEAR_TO_SELL.map(normalizeItemName));
  const presentTargetItems = namedItems.filter((item) => targetNames.has(normalizeItemName(item.name)));
  const presentTargetNames = new Set(presentTargetItems.map((item) => normalizeItemName(item.name)));
  const inventoryItems = namedItems.filter((item) => item.source === "inventory");
  const requiredInventoryNames = new Set(REQUIRED_INVENTORY_ITEMS.map(normalizeItemName));
  const presentRequiredInventoryItems = inventoryItems.filter((item) =>
    requiredInventoryNames.has(normalizeItemName(item.name)),
  );
  const presentRequiredInventoryNames = new Set(
    presentRequiredInventoryItems.map((item) => normalizeItemName(item.name)),
  );
  const missingRequiredInventoryItemNames = REQUIRED_INVENTORY_ITEMS.filter(
    (name) => !presentRequiredInventoryNames.has(normalizeItemName(name)),
  );

  return {
    status: presentTargetItems.length === 0 && missingRequiredInventoryItemNames.length === 0 ? "complete" : "needs-action",
    sourceStepId: SECTION_ONE_STEP_ONE_SOURCE_STEP_ID,
    missingTargetNames: STARTER_GEAR_TO_SELL.filter((name) => !presentTargetNames.has(normalizeItemName(name))),
    presentTargetItems,
    missingRequiredInventoryItemNames,
    presentRequiredInventoryItems,
    inventoryItemNames: namedItems
      .filter((item) => item.source === "inventory")
      .map((item) => formatItemName(item.name, item.quantity)),
  };
}

export function loadOsrsItemNamesByIdFromCache(cacheDirectoryPath?: string): Map<number, string> {
  const store = openOsrsCacheStore(cacheDirectoryPath);
  try {
    const definitions = loadOsrsItemDefinitionsFromCache(store);
    return new Map([...definitions].map(([id, definition]) => [id, definition.name]));
  } finally {
    store.close();
  }
}

export function formatEndToEndSectionOneStepOneState(state: EndToEndSectionOneStepOneState): string {
  if (state.status === "complete") {
    const requiredInventory = state.presentRequiredInventoryItems.map(formatStateItem).join(", ");
    return `sourceStep=4 status=complete starterGear=none requiredInventory=${requiredInventory || "present"}`;
  }

  const present = state.presentTargetItems
    .map(formatStateItem)
    .join(", ");
  const missingRequiredInventory = state.missingRequiredInventoryItemNames.join(", ");
  return [
    `sourceStep=4 status=needs-action`,
    present ? `sell=${present}` : "sell=none",
    missingRequiredInventory ? `buy=${missingRequiredInventory}` : "buy=none",
  ].join(" ");
}
