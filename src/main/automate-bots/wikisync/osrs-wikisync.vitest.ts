import { describe, expect, it } from "vitest";
import {
  formatOsrsWikiSyncLocalSummary,
  formatOsrsWikiSyncSummary,
  parseOsrsWikiSyncLocalResponse,
  parseOsrsWikiSyncResponse,
} from "./osrs-wikisync";

describe("OSRS WikiSync parser", () => {
  it("parses quest statuses and levels", () => {
    const snapshot = parseOsrsWikiSyncResponse("Player", "https://example.test", {
      quests: {
        "Cook's Assistant": 2,
        "Rune Mysteries": 1,
        "Dragon Slayer I": 0,
      },
      levels: {
        Runecraft: 12,
        Combat: 44,
      },
    });

    expect(snapshot.quests).toEqual([
      { name: "Cook's Assistant", statusCode: 2, status: "completed" },
      { name: "Dragon Slayer I", statusCode: 0, status: "not-started" },
      { name: "Rune Mysteries", statusCode: 1, status: "started" },
    ]);
    expect(snapshot.levels.Runecraft).toBe(12);
    expect(formatOsrsWikiSyncSummary(snapshot)).toBe(
      "quests completed=1 started=1 notStarted=1 Runecraft=12 Combat=44",
    );
  });

  it("surfaces the no-data response", () => {
    expect(() =>
      parseOsrsWikiSyncResponse("Player", "https://example.test", {
        code: "NO_USER_DATA",
      }),
    ).toThrow("WikiSync has no uploaded data");
  });

  it("parses the local WebSocket GetPlayer response", () => {
    const snapshot = parseOsrsWikiSyncLocalResponse(
      {
        _wsType: "GetPlayer",
        sequenceId: 1,
        payload: {
          loadouts: [
            {
              name: "Player",
              equipment: {
                weapon: { id: 1351 },
                shield: null,
              },
              skills: {
                atk: 5,
                str: 6,
                def: 1,
                hp: 10,
                magic: 1,
                ranged: 1,
                prayer: 1,
                mining: 15,
              },
              buffs: {
                inWilderness: false,
              },
            },
          ],
        },
      },
      "ws://127.0.0.1:37767/",
      37767,
    );

    expect(snapshot.loadouts[0]).toMatchObject({
      name: "Player",
      equipment: {
        weapon: { id: 1351 },
        shield: null,
      },
      skills: {
        mining: 15,
      },
      buffs: {
        inWilderness: false,
      },
    });
    expect(formatOsrsWikiSyncLocalSummary(snapshot)).toContain("player=Player");
    expect(formatOsrsWikiSyncLocalSummary(snapshot)).toContain("equipment=1");
  });
});
