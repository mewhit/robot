import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchRuneLiteLocalApiSnapshot,
  formatRuneLiteLocalApiProbe,
  formatRuneLiteLocalApiSnapshot,
  hasRuneLiteLocalApiItemPayload,
} from "./runelite-local-api";
import { deriveWorldTile } from "../mapping/world-coordinate";

function jsonResponse(json: unknown): Response {
  return new Response(JSON.stringify(json), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });
}

function notFoundResponse(): Response {
  return new Response("", { status: 404 });
}

describe("RuneLite local API formatter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("summarizes discovered JSON endpoints", () => {
    expect(
      formatRuneLiteLocalApiProbe({
        baseUrl: "http://127.0.0.1:8080",
        responses: [
          {
            url: "http://127.0.0.1:8080/stats",
            status: 200,
            contentType: "application/json",
            json: {
              attack: 1,
              inventory: [{ id: 995, quantity: 10 }],
            },
          },
        ],
      }),
    ).toBe("base=http://127.0.0.1:8080 endpoints=1 /stats:object(2) attack=1 inventory=array(1)");
  });

  it("summarizes typed http-server snapshots", () => {
    expect(
      formatRuneLiteLocalApiSnapshot({
        baseUrl: "http://127.0.0.1:8080",
        skills: [
          { stat: "Attack", level: 1, boostedLevel: 1, xp: 40 },
          { stat: "Mining", level: 15, boostedLevel: 15, xp: 2411 },
        ],
        inventory: [
          { id: 1351, quantity: 1 },
          { id: 590, quantity: 1 },
        ],
        equipment: [],
        playerTile: deriveWorldTile(1600, 3200, 0),
        probe: {
          baseUrl: "http://127.0.0.1:8080",
          responses: [],
        },
      }),
    ).toBe("base=http://127.0.0.1:8080 tile=1600,3200,0 inventory=2 equipment=0");
  });

  it("includes skill levels only when requested", () => {
    expect(
      formatRuneLiteLocalApiSnapshot(
        {
          baseUrl: "http://127.0.0.1:8080",
          skills: [
            { stat: "Attack", level: 1, boostedLevel: 1, xp: 40 },
            { stat: "Mining", level: 15, boostedLevel: 15, xp: 2411 },
          ],
          inventory: [],
          equipment: [],
          playerTile: deriveWorldTile(1600, 3200, 0),
          probe: {
            baseUrl: "http://127.0.0.1:8080",
            responses: [],
          },
        },
        { includeSkills: true },
      ),
    ).toBe("base=http://127.0.0.1:8080 tile=1600,3200,0 skills=2 Attack=1 Mining=15 inventory=0 equipment=0");
  });

  it("prefers /inv slot data over compact /inventory data", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === "/stats" || pathname === "/equip") {
        return jsonResponse([]);
      }
      if (pathname === "/inv") {
        return jsonResponse([
          { id: 1351, quantity: 1, slot: 0 },
          { id: 1265, quantity: 1, slot: 7 },
        ]);
      }
      if (pathname === "/inventory") {
        return jsonResponse([
          { id: 1351, quantity: 1 },
          { id: 1265, quantity: 1 },
        ]);
      }

      return notFoundResponse();
    });

    const snapshot = await fetchRuneLiteLocalApiSnapshot();

    expect(snapshot.inventory).toEqual([
      { id: 1351, quantity: 1, slot: 0 },
      { id: 1265, quantity: 1, slot: 7 },
    ]);
  });

  it("filters empty inventory slot payloads", async () => {
    expect(hasRuneLiteLocalApiItemPayload({ id: 13445, quantity: 1 })).toBe(true);
    expect(hasRuneLiteLocalApiItemPayload({ id: -1, quantity: 0 })).toBe(false);
    expect(hasRuneLiteLocalApiItemPayload({ id: 0, quantity: 0 })).toBe(false);
    expect(hasRuneLiteLocalApiItemPayload({ id: 13445, quantity: 0 })).toBe(false);

    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === "/stats" || pathname === "/equip") {
        return jsonResponse([]);
      }
      if (pathname === "/inv") {
        return jsonResponse([
          { id: 565, quantity: 7160 },
          { id: -1, quantity: 0 },
          { id: 0, quantity: 0 },
          { id: 13445, quantity: 1 },
          { id: 1755, quantity: 1 },
          { id: 13446, quantity: 0 },
        ]);
      }

      return notFoundResponse();
    });

    const snapshot = await fetchRuneLiteLocalApiSnapshot();

    expect(snapshot.inventory).toEqual([
      { id: 565, quantity: 7160, slot: 0 },
      { id: 13445, quantity: 1, slot: 3 },
      { id: 1755, quantity: 1, slot: 4 },
    ]);
  });

  it("parses player world tile data from location endpoints", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === "/stats" || pathname === "/inv" || pathname === "/equip") {
        return jsonResponse([]);
      }
      if (pathname === "/location") {
        return jsonResponse({ worldPoint: { x: 1712, y: 3884, plane: 0 } });
      }

      return notFoundResponse();
    });

    const snapshot = await fetchRuneLiteLocalApiSnapshot();

    expect(snapshot.playerTile?.key).toBe("1712,3884,0");
    expect(formatRuneLiteLocalApiSnapshot(snapshot)).toContain("tile=1712,3884,0");
  });
});
