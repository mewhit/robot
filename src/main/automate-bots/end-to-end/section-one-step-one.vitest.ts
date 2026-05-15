import { describe, expect, it } from "vitest";
import {
  evaluateEndToEndSectionOneStepOne,
  formatEndToEndSectionOneStepOneState,
} from "./section-one-step-one";
import type { RuneLiteLocalApiSnapshot } from "../runelite-local-api/runelite-local-api";

function snapshot(inventoryIds: number[], equipmentIds: number[] = []): RuneLiteLocalApiSnapshot {
  return {
    baseUrl: "http://127.0.0.1:8080",
    skills: [],
    inventory: inventoryIds.map((id) => ({ id, quantity: 1 })),
    equipment: equipmentIds.map((id) => ({ id, quantity: 1 })),
    probe: {
      baseUrl: "http://127.0.0.1:8080",
      responses: [],
    },
  };
}

describe("evaluateEndToEndSectionOneStepOne", () => {
  const itemNamesById = new Map([
    [1, "Bronze dagger"],
    [2, "Bronze sword"],
    [3, "Bronze axe"],
    [4, "Wooden shield"],
    [5, "Shortbow"],
    [6, "Bronze pickaxe"],
    [7, "Spade"],
  ]);

  it("requires action when starter gear is still present", () => {
    const state = evaluateEndToEndSectionOneStepOne(snapshot([1, 6, 7], [4]), itemNamesById);

    expect(state.status).toBe("needs-action");
    expect(state.presentTargetItems.map((item) => item.name)).toEqual(["Bronze dagger", "Wooden shield"]);
    expect(state.missingRequiredInventoryItemNames).toEqual([]);
    expect(formatEndToEndSectionOneStepOneState(state)).toContain("sell=Bronze dagger@inventory, Wooden shield@equipment");
    expect(formatEndToEndSectionOneStepOneState(state)).toContain("buy=none");
  });

  it("requires action when starter gear is absent but the spade is missing", () => {
    const state = evaluateEndToEndSectionOneStepOne(snapshot([6]), itemNamesById);

    expect(state.status).toBe("needs-action");
    expect(state.presentTargetItems).toEqual([]);
    expect(state.missingRequiredInventoryItemNames).toEqual(["spade"]);
    expect(formatEndToEndSectionOneStepOneState(state)).toContain("sell=none buy=spade");
  });

  it("is complete when starter gear is absent and a spade is in inventory", () => {
    const state = evaluateEndToEndSectionOneStepOne(snapshot([6, 7]), itemNamesById);

    expect(state.status).toBe("complete");
    expect(state.presentTargetItems).toEqual([]);
    expect(state.presentRequiredInventoryItems.map((item) => item.name)).toEqual(["Spade"]);
    expect(formatEndToEndSectionOneStepOneState(state)).toContain("requiredInventory=Spade@inventory");
  });
});
