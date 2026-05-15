import { describe, expect, it } from "vitest";
import {
  normalizeEndToEndConfig,
  setEndToEndConfigActivePlayerName,
  setEndToEndGuideStepCompletion,
} from "./end-to-end-config";

describe("End To End character-scoped checklist config", () => {
  it("uses completed guide steps from the active player only", () => {
    const config = normalizeEndToEndConfig({
      playerName: "Moose 2136",
      completedGuideStepIdsByPlayerName: {
        "Moose 2136": ["ironman-guide-1.1-step-4"],
        Other: ["ironman-guide-1.1-step-8"],
      },
    });

    expect(config.completedGuideStepIds).toEqual(["ironman-guide-1.1-step-4"]);

    const switched = setEndToEndConfigActivePlayerName(config, "Other");

    expect(switched.playerName).toBe("Other");
    expect(switched.completedGuideStepIds).toEqual(["ironman-guide-1.1-step-8"]);
  });

  it("writes manual or automatic completion to the active player's bucket", () => {
    const config = normalizeEndToEndConfig({
      playerName: "Moose 2136",
      completedGuideStepIdsByPlayerName: {
        "Moose 2136": [],
        Other: ["ironman-guide-1.1-step-8"],
      },
    });

    const updated = setEndToEndGuideStepCompletion(config, "ironman-guide-1.1-step-4", true);

    expect(updated.completedGuideStepIds).toEqual(["ironman-guide-1.1-step-4"]);
    expect(updated.completedGuideStepIdsByPlayerName["Moose 2136"]).toEqual(["ironman-guide-1.1-step-4"]);
    expect(updated.completedGuideStepIdsByPlayerName.Other).toEqual(["ironman-guide-1.1-step-8"]);
  });
});
