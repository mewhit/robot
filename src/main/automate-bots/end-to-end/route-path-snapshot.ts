import fs from "fs";
import path from "path";
import { app } from "electron";

export type EndToEndPathTile = {
  x: number;
  y: number;
  z: number;
};

export type EndToEndRoutePathSnapshot = {
  schemaVersion: 1;
  id: string;
  botId: "end-to-end";
  label: string;
  sourceStep: string;
  destinationLabel: string | null;
  createdAt: string;
  routeStatus: "ready" | "already-there" | "unavailable";
  regionX: number;
  regionY: number;
  plane: number;
  playerTile: EndToEndPathTile;
  destinationTile: EndToEndPathTile | null;
  storeTile: EndToEndPathTile | null;
  targetTile: EndToEndPathTile | null;
  clickTile: EndToEndPathTile | null;
  pathTiles: EndToEndPathTile[];
  pathLength: number;
  nextWaypointPathLength: number;
  selectionReason: string | null;
};

const LATEST_ROUTE_PATH_FILE_NAME = "end-to-end-latest-route-path.json";

let latestSnapshot: EndToEndRoutePathSnapshot | null = null;

function getLatestRoutePathFilePath(): string {
  return path.join(app.getPath("userData"), LATEST_ROUTE_PATH_FILE_NAME);
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}

function normalizeTile(value: unknown): EndToEndPathTile | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<EndToEndPathTile>;
  if (!isFiniteInteger(candidate.x) || !isFiniteInteger(candidate.y) || !isFiniteInteger(candidate.z)) {
    return null;
  }

  return {
    x: candidate.x,
    y: candidate.y,
    z: candidate.z,
  };
}

function normalizeRouteStatus(value: unknown): EndToEndRoutePathSnapshot["routeStatus"] {
  return value === "already-there" || value === "unavailable" ? value : "ready";
}

function normalizeSnapshot(value: unknown): EndToEndRoutePathSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<EndToEndRoutePathSnapshot>;
  const playerTile = normalizeTile(candidate.playerTile);
  const rawPathTiles = Array.isArray(candidate.pathTiles) ? candidate.pathTiles : [];
  const pathTiles = rawPathTiles.map(normalizeTile).filter((tile): tile is EndToEndPathTile => tile !== null);
  if (!playerTile || pathTiles.length === 0) {
    return null;
  }

  return {
    schemaVersion: 1,
    id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : `route-${Date.now()}`,
    botId: "end-to-end",
    label: typeof candidate.label === "string" && candidate.label.trim() ? candidate.label : "End To End route",
    sourceStep:
      typeof candidate.sourceStep === "string" && candidate.sourceStep.trim()
        ? candidate.sourceStep
        : "unknown",
    destinationLabel:
      typeof candidate.destinationLabel === "string" && candidate.destinationLabel.trim()
        ? candidate.destinationLabel
        : null,
    createdAt:
      typeof candidate.createdAt === "string" && candidate.createdAt.trim()
        ? candidate.createdAt
        : new Date().toISOString(),
    routeStatus: normalizeRouteStatus(candidate.routeStatus),
    regionX: isFiniteInteger(candidate.regionX) ? candidate.regionX : playerTile.x >> 6,
    regionY: isFiniteInteger(candidate.regionY) ? candidate.regionY : playerTile.y >> 6,
    plane: isFiniteInteger(candidate.plane) ? candidate.plane : playerTile.z,
    playerTile,
    destinationTile: normalizeTile(candidate.destinationTile) ?? normalizeTile(candidate.storeTile),
    storeTile: normalizeTile(candidate.storeTile),
    targetTile: normalizeTile(candidate.targetTile),
    clickTile: normalizeTile(candidate.clickTile),
    pathTiles,
    pathLength: isFiniteInteger(candidate.pathLength) ? Math.max(0, candidate.pathLength) : Math.max(0, pathTiles.length - 1),
    nextWaypointPathLength: isFiniteInteger(candidate.nextWaypointPathLength)
      ? Math.max(0, candidate.nextWaypointPathLength)
      : 0,
    selectionReason:
      typeof candidate.selectionReason === "string" && candidate.selectionReason.trim()
        ? candidate.selectionReason
        : null,
  };
}

export function saveLatestEndToEndRoutePathSnapshot(
  snapshot: EndToEndRoutePathSnapshot,
): { snapshot: EndToEndRoutePathSnapshot; filePath: string } {
  const normalized = normalizeSnapshot(snapshot);
  if (!normalized) {
    throw new Error("Cannot save End To End route path snapshot without a player tile and path tiles.");
  }

  const filePath = getLatestRoutePathFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  latestSnapshot = normalized;
  return { snapshot: normalized, filePath };
}

export function readLatestEndToEndRoutePathSnapshot(): {
  snapshot: EndToEndRoutePathSnapshot | null;
  filePath: string;
} {
  const filePath = getLatestRoutePathFilePath();
  if (latestSnapshot) {
    return { snapshot: latestSnapshot, filePath };
  }

  if (!fs.existsSync(filePath)) {
    return { snapshot: null, filePath };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    latestSnapshot = normalizeSnapshot(parsed);
  } catch (error) {
    console.warn(`Unable to read End To End route path snapshot at ${filePath}: ${String(error)}`);
    latestSnapshot = null;
  }

  return { snapshot: latestSnapshot, filePath };
}
