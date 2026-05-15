import { describe, expect, it } from "vitest";
import { estimateEndToEndGuideQuestProgress, formatEndToEndGuideQuestProgressEstimate } from "./guide-progress";
import type { EndToEndGuideChecklist } from "./guide-checklist";
import type { OsrsWikiSyncQuest } from "../wikisync/osrs-wikisync";

function quest(name: string, status: OsrsWikiSyncQuest["status"]): OsrsWikiSyncQuest {
  const statusCode = status === "completed" ? 2 : status === "started" ? 1 : status === "not-started" ? 0 : -1;
  return { name, status, statusCode };
}

describe("estimateEndToEndGuideQuestProgress", () => {
  it("finds the first quest checklist step that is not satisfied", () => {
    const checklist: EndToEndGuideChecklist = {
      sectionId: "ironman-guide-1.1",
      title: "Section 1.1",
      sourceUrl: "https://ironman.guide/guide/early-game",
      expectedStepCount: 4,
      fetchedAt: "2026-05-13T00:00:00.000Z",
      steps: [
        {
          id: "ironman-guide-1.1-step-4",
          position: 1,
          sourcePosition: 4,
          title: "Sell starter gear",
          text: "Sell starter gear",
        },
        {
          id: "ironman-guide-1.1-step-34",
          position: 2,
          sourcePosition: 34,
          title: "Finish the X marks the spot quest",
          text: "Finish the X marks the spot quest by talking to Veos",
        },
        {
          id: "ironman-guide-1.1-step-37",
          position: 3,
          sourcePosition: 37,
          title: "Start The Knight's sword quest",
          text: "Start The Knight's sword quest by talking to the squire",
        },
        {
          id: "ironman-guide-1.1-step-146",
          position: 4,
          sourcePosition: 146,
          title: "Finish the Knight's sword quest",
          text: "Finish the Knight's sword quest",
        },
      ],
    };

    const estimate = estimateEndToEndGuideQuestProgress(checklist, [
      quest("X Marks the Spot", "completed"),
      quest("The Knight's Sword", "started"),
    ]);

    expect(estimate.satisfiedQuestSteps).toBe(2);
    expect(estimate.totalQuestSteps).toBe(3);
    expect(estimate.firstUnsatisfied?.displayIndex).toBe(4);
    expect(estimate.firstUnsatisfied?.questName).toBe("The Knight's Sword");
    expect(formatEndToEndGuideQuestProgressEstimate(estimate)).toContain("nextLikely=#4 sourceStep=146");
  });
});
