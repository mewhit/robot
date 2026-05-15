import { describe, expect, it } from "vitest";
import { formatEndToEndGuideChecklistExecutionOrder, parseEndToEndGuideChecklistHtml } from "./guide-checklist";

describe("parseEndToEndGuideChecklistHtml", () => {
  it("extracts section 1 checklist steps from HowTo JSON-LD", () => {
    const checklist = parseEndToEndGuideChecklistHtml(
      `<!doctype html>
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "HowTo",
          "name": "OSRS Ironman Guide - 1.1 Early quests",
          "step": [
            {
              "@type": "HowToStep",
              "position": 1,
              "name": "Intro",
              "text": "Intro step"
            },
            {
              "@type": "HowToStep",
              "position": 4,
              "name": "Buy a spade",
              "text": "Buy a spade, start X marks the spot quest",
              "itemListElement": { "@type": "HowToDirection", "text": "Location: Lumbridge" }
            },
            {
              "@type": "HowToStep",
              "position": 5,
              "name": "Bank",
              "text": "Bank everything"
            }
          ]
        }
      </script>
      <div>5<!-- --> steps in this section</div>`,
      "2026-05-13T00:00:00.000Z",
    );

    expect(checklist.title).toBe("OSRS Ironman Guide - 1.1 Early quests");
    expect(checklist.expectedStepCount).toBe(2);
    expect(checklist.steps.map((step) => step.position)).toEqual([1, 2]);
    expect(checklist.steps.map((step) => step.sourcePosition)).toEqual([4, 5]);
    expect(checklist.steps[0]).toMatchObject({
      id: "ironman-guide-1.1-step-4",
      position: 1,
      sourcePosition: 4,
      text: "Buy a spade, start X marks the spot quest",
      location: "Lumbridge",
    });
  });

  it("moves buy-spade into source step 4 but keeps starting X Marks as source step 8", () => {
    const checklist = parseEndToEndGuideChecklistHtml(
      `<!doctype html>
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "HowTo",
          "name": "OSRS Ironman Guide - 1.1 Early quests",
          "step": [
            { "@type": "HowToStep", "position": 1, "name": "Intro 1", "text": "Intro 1" },
            { "@type": "HowToStep", "position": 2, "name": "Intro 2", "text": "Intro 2" },
            { "@type": "HowToStep", "position": 3, "name": "Intro 3", "text": "Intro 3" },
            { "@type": "HowToStep", "position": 4, "name": "Visible 1", "text": "Visible 1" },
            { "@type": "HowToStep", "position": 5, "name": "Visible 2", "text": "Visible 2" },
            { "@type": "HowToStep", "position": 6, "name": "Visible 3", "text": "Visible 3" },
            { "@type": "HowToStep", "position": 7, "name": "Visible 4", "text": "Visible 4" },
            { "@type": "HowToStep", "position": 8, "name": "Buy a spade, start X Marks the Spot", "text": "Buy a spade, start X Marks the Spot quest" },
            { "@type": "HowToStep", "position": 9, "name": "Visible 6", "text": "Visible 6" }
          ]
        }
      </script>
      <div>9<!-- --> steps in this section</div>`,
      "2026-05-13T00:00:00.000Z",
    );

    expect(checklist.expectedStepCount).toBe(6);
    expect(checklist.steps.map((step) => step.position)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(checklist.steps.map((step) => step.sourcePosition)).toEqual([4, 8, 5, 6, 7, 9]);
    expect(checklist.steps[0]).toMatchObject({
      sourcePosition: 4,
      sourcePositions: [4, 8],
      text: "Visible 1; Buy a spade",
    });
    expect(checklist.steps[1]).toMatchObject({
      id: "ironman-guide-1.1-step-8-start-x-marks-the-spot",
      sourcePosition: 8,
      sourcePositions: [8],
      text: "Start X Marks the Spot quest",
    });
    expect(checklist.steps.map((step) => `${step.position}:src${step.sourcePosition}`)).toEqual([
      "1:src4",
      "2:src8",
      "3:src5",
      "4:src6",
      "5:src7",
      "6:src9",
    ]);
    expect(formatEndToEndGuideChecklistExecutionOrder(checklist.steps)).toBe(
      "1:src4+8, 2:src8, 3:src5, 4:src6, 5:src7, 6:src9",
    );
  });
});
