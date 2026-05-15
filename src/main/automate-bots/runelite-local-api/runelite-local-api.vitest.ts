import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchRuneLiteLocalApiSnapshot,
  formatRuneLiteLocalApiProbe,
  formatRuneLiteLocalApiSnapshot,
} from "./runelite-local-api";

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
        probe: {
          baseUrl: "http://127.0.0.1:8080",
          responses: [],
        },
      }),
    ).toBe("base=http://127.0.0.1:8080 skills=2 Attack=1 Mining=15 inventory=2 equipment=0");
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
});
