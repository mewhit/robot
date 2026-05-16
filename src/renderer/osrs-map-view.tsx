import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IpcRenderer } from "electron";
import { CHANNELS } from "../main/ipcChannels";
import type {
  OsrsCacheMapIcon,
  OsrsCacheMapObject,
  OsrsCacheMapRegionView,
  OsrsCacheMapTile,
} from "../main/automate-bots/cache/cache-map-view";
import type {
  EndToEndPathTile,
  EndToEndRoutePathSnapshot,
} from "../main/automate-bots/end-to-end/route-path-snapshot";

type OsrsMapViewProps = {
  ipcRenderer: IpcRenderer;
};

type SelectedTile = {
  localX: number;
  localY: number;
};

type OsrsMapFilterState = {
  regionXInput: string;
  regionYInput: string;
  worldXInput: string;
  worldYInput: string;
  plane: number;
};

type ParsedManualRoutePath = {
  pathTiles: EndToEndPathTile[];
  playerTile: EndToEndPathTile | null;
  destinationTile: EndToEndPathTile | null;
  targetTile: EndToEndPathTile | null;
  clickTile: EndToEndPathTile | null;
};

const CANVAS_SIZE = 768;
const REGION_SIZE = 64;
const CELL_SIZE = CANVAS_SIZE / REGION_SIZE;
const FLAG_BLOCKED = 1 << 0;
const FLAG_NORTH = 1 << 1;
const FLAG_EAST = 1 << 2;
const FLAG_SOUTH = 1 << 3;
const FLAG_WEST = 1 << 4;
const FLAG_PROJECTILE = 1 << 5;
const OSRS_MAP_FILTERS_STORAGE_KEY = "robot.osrs-map.filters.v1";
const DEFAULT_OSRS_MAP_FILTERS: OsrsMapFilterState = {
  regionXInput: "50",
  regionYInput: "50",
  worldXInput: "",
  worldYInput: "",
  plane: 0,
};

function getTileKey(localX: number, localY: number, z: number): string {
  return `${localX},${localY},${z}`;
}

function clampPlane(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(3, Math.trunc(value)));
}

function normalizeIntegerInput(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^-?\d+$/.test(text)) {
    return fallback;
  }

  return text;
}

function readOsrsMapFilters(): OsrsMapFilterState {
  try {
    const raw = window.localStorage.getItem(OSRS_MAP_FILTERS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_OSRS_MAP_FILTERS;
    }

    const parsed = JSON.parse(raw) as Partial<OsrsMapFilterState>;
    return {
      regionXInput: normalizeIntegerInput(parsed.regionXInput, DEFAULT_OSRS_MAP_FILTERS.regionXInput),
      regionYInput: normalizeIntegerInput(parsed.regionYInput, DEFAULT_OSRS_MAP_FILTERS.regionYInput),
      worldXInput: normalizeIntegerInput(parsed.worldXInput, DEFAULT_OSRS_MAP_FILTERS.worldXInput),
      worldYInput: normalizeIntegerInput(parsed.worldYInput, DEFAULT_OSRS_MAP_FILTERS.worldYInput),
      plane: clampPlane(Number(parsed.plane)),
    };
  } catch {
    return DEFAULT_OSRS_MAP_FILTERS;
  }
}

function writeOsrsMapFilters(filters: OsrsMapFilterState): void {
  try {
    window.localStorage.setItem(OSRS_MAP_FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Ignore storage failures; the map should still work normally.
  }
}

function parseInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number(value);
  }

  return null;
}

function normalizeManualPathTile(value: unknown, fallbackPlane: number): EndToEndPathTile | null {
  if (Array.isArray(value)) {
    const x = parseInteger(value[0]);
    const y = parseInteger(value[1]);
    const z = parseInteger(value[2] ?? fallbackPlane);
    return x !== null && y !== null && z !== null ? { x, y, z } : null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const x = parseInteger(candidate.x ?? candidate.worldX);
  const y = parseInteger(candidate.y ?? candidate.worldY);
  const z = parseInteger(candidate.z ?? candidate.plane ?? fallbackPlane);
  return x !== null && y !== null && z !== null ? { x, y, z } : null;
}

function sameWorldTile(a: EndToEndPathTile, b: EndToEndPathTile): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function parseManualPathJson(input: string, fallbackPlane: number): ParsedManualRoutePath | null {
  try {
    const parsed = JSON.parse(input) as unknown;
    const container = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
    const pathValue = container
      ? container.pathTiles ?? container.path ?? container.tiles ?? container.points
      : parsed;
    if (!Array.isArray(pathValue)) {
      return null;
    }

    const pathTiles = pathValue
      .map((value) => normalizeManualPathTile(value, fallbackPlane))
      .filter((tile): tile is EndToEndPathTile => tile !== null);
    if (pathTiles.length === 0) {
      return null;
    }

    return {
      pathTiles,
      playerTile: container ? normalizeManualPathTile(container.playerTile ?? container.startTile, fallbackPlane) : null,
      destinationTile: container
        ? normalizeManualPathTile(container.destinationTile ?? container.destTile ?? container.endTile, fallbackPlane)
        : null,
      targetTile: container ? normalizeManualPathTile(container.targetTile, fallbackPlane) : null,
      clickTile: container ? normalizeManualPathTile(container.clickTile, fallbackPlane) : null,
    };
  } catch {
    return null;
  }
}

function parseLooseTileObject(input: string, fallbackPlane: number): EndToEndPathTile | null {
  const x = /(?:^|[,{]\s*)["']?(?:x|worldX)["']?\s*[:=]\s*(-?\d+)/i.exec(input);
  const y = /(?:^|[,{]\s*)["']?(?:y|worldY)["']?\s*[:=]\s*(-?\d+)/i.exec(input);
  const z = /(?:^|[,{]\s*)["']?(?:z|plane)["']?\s*[:=]\s*(-?\d+)/i.exec(input);
  return x && y
    ? {
        x: Number(x[1]),
        y: Number(y[1]),
        z: z ? Number(z[1]) : fallbackPlane,
      }
    : null;
}

function parseManualPathText(input: string, fallbackPlane: number): ParsedManualRoutePath | null {
  const firstPathMarkerIndex = input.search(/\[(?:START|PLAYER)\s*:/i);
  const pathText = firstPathMarkerIndex >= 0 ? input.slice(firstPathMarkerIndex) : input;
  const triplePattern = /(?:\[([A-Z_+]+)\s*:)?\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)(?:\])?/gi;
  const pathTiles: EndToEndPathTile[] = [];
  let playerTile: EndToEndPathTile | null = null;
  let destinationTile: EndToEndPathTile | null = null;
  let targetTile: EndToEndPathTile | null = null;
  let clickTile: EndToEndPathTile | null = null;
  let match: RegExpExecArray | null;

  while ((match = triplePattern.exec(pathText)) !== null) {
    const tile = {
      x: Number(match[2]),
      y: Number(match[3]),
      z: Number(match[4]),
    };
    const labels = new Set((match[1]?.toUpperCase() ?? "").split("+").filter(Boolean));
    pathTiles.push(tile);

    if (labels.has("START") || labels.has("PLAYER")) {
      playerTile = tile;
    }
    if (labels.has("CLICK")) {
      clickTile = tile;
    }
    if (labels.has("DEST") || labels.has("DESTINATION") || labels.has("END")) {
      destinationTile = tile;
    }
    if (labels.has("TARGET")) {
      targetTile = tile;
    }
  }

  if (pathTiles.length === 0) {
    const objectPattern = /\{[^{}]*\}/g;
    while ((match = objectPattern.exec(pathText)) !== null) {
      const tile = parseLooseTileObject(match[0], fallbackPlane);
      if (tile) {
        pathTiles.push(tile);
      }
    }
  }

  return pathTiles.length > 0
    ? { pathTiles, playerTile, destinationTile, targetTile, clickTile }
    : null;
}

function buildManualRoutePathSnapshot(input: string, fallbackPlane: number): EndToEndRoutePathSnapshot {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Paste a path before drawing it.");
  }

  const parsed = parseManualPathJson(trimmed, fallbackPlane) ?? parseManualPathText(trimmed, fallbackPlane);
  if (!parsed || parsed.pathTiles.length === 0) {
    throw new Error("Could not find any world tiles. Use x,y,z triples or a JSON array of points.");
  }

  const playerTile = parsed.playerTile ?? parsed.pathTiles[0];
  const destinationTile = parsed.destinationTile ?? parsed.pathTiles[parsed.pathTiles.length - 1];
  const targetTile = parsed.targetTile;
  const clickTile = parsed.clickTile;
  const clickIndex = clickTile ? parsed.pathTiles.findIndex((tile) => sameWorldTile(tile, clickTile)) : -1;

  return {
    schemaVersion: 1,
    id: `manual-route-${Date.now()}`,
    botId: "end-to-end",
    label: `Manual Path (${parsed.pathTiles.length} tiles)`,
    sourceStep: "manual-map-input",
    destinationLabel: "Manual destination",
    createdAt: new Date().toISOString(),
    routeStatus: "ready",
    regionX: playerTile.x >> 6,
    regionY: playerTile.y >> 6,
    plane: playerTile.z,
    playerTile,
    destinationTile,
    storeTile: null,
    targetTile,
    clickTile,
    pathTiles: parsed.pathTiles,
    pathLength: Math.max(0, parsed.pathTiles.length - 1),
    nextWaypointPathLength: clickIndex >= 0 ? clickIndex : 0,
    selectionReason: "Manual map path input",
  };
}

function formatObjectLabel(object: OsrsCacheMapObject): string {
  const name = object.name && object.name !== "null" ? object.name : `Object ${object.id}`;
  return `${name} (${object.id})`;
}

function formatObjectTypeDescription(type: number): string {
  if (type >= 0 && type <= 3) {
    return "Wall object";
  }
  if (type === 9) {
    return "Diagonal object";
  }
  if (type === 10 || type === 11) {
    return "Game object";
  }
  if (type === 22) {
    return "Ground object";
  }
  if (type >= 12) {
    return "Large/scenery object";
  }

  return "Unknown object";
}

function getIconLabel(icon: OsrsCacheMapIcon): string {
  return icon.label || icon.name || icon.objectName || `Icon ${icon.areaId}`;
}

function formatWorldTile(tile: EndToEndPathTile | null | undefined): string {
  return tile ? `${tile.x},${tile.y},${tile.z}` : "None";
}

function isSameSelectedTile(a: SelectedTile | null, b: SelectedTile | null): boolean {
  return !!a && !!b && a.localX === b.localX && a.localY === b.localY;
}

function formatDirectionalFlags(flags: number): string {
  const directions = [
    (flags & FLAG_NORTH) !== 0 ? "N" : null,
    (flags & FLAG_EAST) !== 0 ? "E" : null,
    (flags & FLAG_SOUTH) !== 0 ? "S" : null,
    (flags & FLAG_WEST) !== 0 ? "W" : null,
  ].filter((direction): direction is string => direction !== null);

  return directions.length > 0 ? directions.join(" ") : "None";
}

function formatYesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

function formatCollisionFlags(flags: number): string {
  const names = [
    (flags & FLAG_BLOCKED) !== 0 ? "Blocked" : null,
    (flags & FLAG_PROJECTILE) !== 0 ? "Projectile" : null,
    (flags & FLAG_NORTH) !== 0 ? "North" : null,
    (flags & FLAG_EAST) !== 0 ? "East" : null,
    (flags & FLAG_SOUTH) !== 0 ? "South" : null,
    (flags & FLAG_WEST) !== 0 ? "West" : null,
  ].filter((name): name is string => name !== null);

  return names.length > 0 ? names.join(", ") : "None";
}

function getRouteTileCanvasCenter(
  region: OsrsCacheMapRegionView,
  plane: number,
  tile: EndToEndPathTile,
): { x: number; y: number; localX: number; localY: number } | null {
  if (tile.z !== plane) {
    return null;
  }

  const localX = tile.x - region.baseX;
  const localY = tile.y - region.baseY;
  if (localX < 0 || localX >= REGION_SIZE || localY < 0 || localY >= REGION_SIZE) {
    return null;
  }

  return {
    x: localX * CELL_SIZE + CELL_SIZE / 2,
    y: (REGION_SIZE - 1 - localY) * CELL_SIZE + CELL_SIZE / 2,
    localX,
    localY,
  };
}

function isRouteTileInRegion(region: OsrsCacheMapRegionView, plane: number, tile: EndToEndPathTile): boolean {
  return getRouteTileCanvasCenter(region, plane, tile) !== null;
}

function drawRouteMarker(
  ctx: CanvasRenderingContext2D,
  region: OsrsCacheMapRegionView,
  plane: number,
  tile: EndToEndPathTile | null,
  label: string,
  fillStyle: string,
  strokeStyle: string,
): void {
  if (!tile) {
    return;
  }

  const point = getRouteTileCanvasCenter(region, plane, tile);
  if (!point) {
    return;
  }

  ctx.save();
  ctx.fillStyle = fillStyle;
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(point.x, point.y, Math.max(7, CELL_SIZE * 0.52), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 9px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, point.x, point.y + 0.5);
  ctx.restore();
}

function drawRoutePath(
  ctx: CanvasRenderingContext2D,
  region: OsrsCacheMapRegionView,
  plane: number,
  routePath: EndToEndRoutePathSnapshot | null,
): void {
  if (!routePath || routePath.pathTiles.length === 0) {
    return;
  }

  const segments: Array<Array<{ x: number; y: number }>> = [];
  let segment: Array<{ x: number; y: number }> = [];

  for (const tile of routePath.pathTiles) {
    const point = getRouteTileCanvasCenter(region, plane, tile);
    if (!point) {
      if (segment.length > 0) {
        segments.push(segment);
        segment = [];
      }
      continue;
    }

    segment.push({ x: point.x, y: point.y });
  }

  if (segment.length > 0) {
    segments.push(segment);
  }

  if (segments.length === 0) {
    return;
  }

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const lineWidth of [7, 3]) {
    ctx.strokeStyle = lineWidth === 7 ? "rgba(255, 255, 255, 0.88)" : "#f97316";
    ctx.lineWidth = lineWidth;
    for (const routeSegment of segments) {
      if (routeSegment.length < 2) {
        continue;
      }

      ctx.beginPath();
      ctx.moveTo(routeSegment[0].x, routeSegment[0].y);
      for (const point of routeSegment.slice(1)) {
        ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
    }
  }

  ctx.fillStyle = "#ea580c";
  for (const tile of routePath.pathTiles) {
    const point = getRouteTileCanvasCenter(region, plane, tile);
    if (!point) {
      continue;
    }

    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(2.25, CELL_SIZE * 0.18), 0, Math.PI * 2);
    ctx.fill();
  }

  const destinationMarkerLabel = routePath.destinationLabel?.includes("X Marks") ? "Q" : "G";
  drawRouteMarker(ctx, region, plane, routePath.destinationTile ?? routePath.storeTile, destinationMarkerLabel, "#d97706", "#78350f");
  drawRouteMarker(ctx, region, plane, routePath.targetTile, "D", "#db2777", "#831843");
  drawRouteMarker(ctx, region, plane, routePath.clickTile, "C", "#2563eb", "#1e3a8a");
  drawRouteMarker(ctx, region, plane, routePath.playerTile, "S", "#059669", "#064e3b");
  ctx.restore();
}

function drawDirectionalCollisionWalls(ctx: CanvasRenderingContext2D, tiles: OsrsCacheMapTile[]): void {
  ctx.save();
  ctx.strokeStyle = "#dc2626";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "square";
  for (const tile of tiles) {
    const px = tile.localX * CELL_SIZE;
    const py = (REGION_SIZE - 1 - tile.localY) * CELL_SIZE;
    const flags = tile.flags;

    if ((flags & FLAG_NORTH) !== 0) {
      ctx.beginPath();
      ctx.moveTo(px + 1, py + 1);
      ctx.lineTo(px + CELL_SIZE - 1, py + 1);
      ctx.stroke();
    }
    if ((flags & FLAG_EAST) !== 0) {
      ctx.beginPath();
      ctx.moveTo(px + CELL_SIZE - 1, py + 1);
      ctx.lineTo(px + CELL_SIZE - 1, py + CELL_SIZE - 1);
      ctx.stroke();
    }
    if ((flags & FLAG_SOUTH) !== 0) {
      ctx.beginPath();
      ctx.moveTo(px + 1, py + CELL_SIZE - 1);
      ctx.lineTo(px + CELL_SIZE - 1, py + CELL_SIZE - 1);
      ctx.stroke();
    }
    if ((flags & FLAG_WEST) !== 0) {
      ctx.beginPath();
      ctx.moveTo(px + 1, py + 1);
      ctx.lineTo(px + 1, py + CELL_SIZE - 1);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawMap(
  canvas: HTMLCanvasElement,
  region: OsrsCacheMapRegionView,
  plane: number,
  selectedTile: SelectedTile | null,
  hoveredTile: SelectedTile | null,
  routePath: EndToEndRoutePathSnapshot | null,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.fillStyle = "#eef4ef";
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  const planeTiles = region.tiles.filter((tile) => tile.z === plane);
  for (const tile of planeTiles) {
    const px = tile.localX * CELL_SIZE;
    const py = (REGION_SIZE - 1 - tile.localY) * CELL_SIZE;
    const isTerrainBlocked = (tile.terrainSettings & 1) !== 0;

    if (tile.blocked) {
      ctx.fillStyle = isTerrainBlocked ? "#64748b" : tile.projectileBlocked ? "#8b5e3c" : "#a16207";
      ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
    } else if (tile.projectileBlocked) {
      ctx.fillStyle = "rgba(245, 158, 11, 0.2)";
      ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
    }
  }

  for (const object of region.objects) {
    if (object.z !== plane || object.type < 9) {
      continue;
    }

    const px = object.localX * CELL_SIZE;
    const py = (REGION_SIZE - object.localY - object.sizeY) * CELL_SIZE;
    ctx.fillStyle = object.blocksProjectile ? "rgba(14, 116, 144, 0.26)" : "rgba(20, 184, 166, 0.18)";
    ctx.fillRect(px, py, object.sizeX * CELL_SIZE, object.sizeY * CELL_SIZE);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 9px sans-serif";
  for (const icon of region.icons) {
    if (icon.z !== plane) {
      continue;
    }

    const cx = icon.localX * CELL_SIZE + CELL_SIZE / 2;
    const cy = (REGION_SIZE - 1 - icon.localY) * CELL_SIZE + CELL_SIZE / 2;
    const label = getIconLabel(icon);
    const initials = label
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?";
    ctx.fillStyle = "#fef3c7";
    ctx.strokeStyle = "#92400e";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(5, CELL_SIZE * 0.42), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#78350f";
    ctx.fillText(initials, cx, cy + 0.5);
  }

  ctx.strokeStyle = "rgba(15, 23, 42, 0.08)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= REGION_SIZE; i += 1) {
    const p = i * CELL_SIZE;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, CANVAS_SIZE);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(CANVAS_SIZE, p);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(15, 23, 42, 0.35)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= REGION_SIZE; i += 8) {
    const p = i * CELL_SIZE;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, CANVAS_SIZE);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(CANVAS_SIZE, p);
    ctx.stroke();
  }

  drawRoutePath(ctx, region, plane, routePath);
  drawDirectionalCollisionWalls(ctx, planeTiles);

  if (hoveredTile) {
    const px = hoveredTile.localX * CELL_SIZE;
    const py = (REGION_SIZE - 1 - hoveredTile.localY) * CELL_SIZE;
    ctx.save();
    ctx.strokeStyle = "rgba(15, 23, 42, 0.82)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(px + 2, py + 2, CELL_SIZE - 4, CELL_SIZE - 4);
    ctx.restore();
  }

  if (selectedTile) {
    const px = selectedTile.localX * CELL_SIZE;
    const py = (REGION_SIZE - 1 - selectedTile.localY) * CELL_SIZE;
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 3;
    ctx.strokeRect(px + 1.5, py + 1.5, CELL_SIZE - 3, CELL_SIZE - 3);
  }
}

export default function OsrsMapView({ ipcRenderer }: OsrsMapViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [initialFilters] = useState(readOsrsMapFilters);
  const [regionXInput, setRegionXInput] = useState(initialFilters.regionXInput);
  const [regionYInput, setRegionYInput] = useState(initialFilters.regionYInput);
  const [worldXInput, setWorldXInput] = useState(initialFilters.worldXInput);
  const [worldYInput, setWorldYInput] = useState(initialFilters.worldYInput);
  const [plane, setPlane] = useState(initialFilters.plane);
  const [region, setRegion] = useState<OsrsCacheMapRegionView | null>(null);
  const [selectedTile, setSelectedTile] = useState<SelectedTile | null>(null);
  const [hoveredTile, setHoveredTile] = useState<SelectedTile | null>(null);
  const [routePath, setRoutePath] = useState<EndToEndRoutePathSnapshot | null>(null);
  const [routePathFilePath, setRoutePathFilePath] = useState<string | null>(null);
  const [manualPathInput, setManualPathInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isPathLoading, setIsPathLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);

  const tilesByKey = useMemo(() => {
    const map = new Map<string, OsrsCacheMapTile>();
    for (const tile of region?.tiles ?? []) {
      map.set(getTileKey(tile.localX, tile.localY, tile.z), tile);
    }
    return map;
  }, [region]);

  const selectedTileData = selectedTile ? tilesByKey.get(getTileKey(selectedTile.localX, selectedTile.localY, plane)) ?? null : null;
  const hoveredTileData = hoveredTile ? tilesByKey.get(getTileKey(hoveredTile.localX, hoveredTile.localY, plane)) ?? null : null;

  const selectedTileObjects = useMemo(() => {
    if (!region || !selectedTile) {
      return [];
    }

    return region.objects.filter((object) => {
      if (object.z !== plane) {
        return false;
      }

      return (
        selectedTile.localX >= object.localX &&
        selectedTile.localX < object.localX + object.sizeX &&
        selectedTile.localY >= object.localY &&
        selectedTile.localY < object.localY + object.sizeY
      );
    });
  }, [plane, region, selectedTile]);

  const selectedTileIcons = useMemo(() => {
    if (!region || !selectedTile) {
      return [];
    }

    return region.icons.filter(
      (icon) => icon.z === plane && icon.localX === selectedTile.localX && icon.localY === selectedTile.localY,
    );
  }, [plane, region, selectedTile]);

  const planeTiles = useMemo(() => region?.tiles.filter((tile) => tile.z === plane) ?? [], [plane, region]);
  const blockedTileCount = useMemo(() => planeTiles.filter((tile) => tile.blocked).length, [planeTiles]);
  const terrainBlockedTileCount = useMemo(
    () => planeTiles.filter((tile) => (tile.terrainSettings & 1) !== 0).length,
    [planeTiles],
  );
  const wallTileCount = useMemo(
    () => planeTiles.filter((tile) => (tile.flags & (FLAG_NORTH | FLAG_EAST | FLAG_SOUTH | FLAG_WEST)) !== 0).length,
    [planeTiles],
  );
  const planeObjectCount = useMemo(() => region?.objects.filter((object) => object.z === plane).length ?? 0, [plane, region]);
  const planeIconCount = useMemo(() => region?.icons.filter((icon) => icon.z === plane).length ?? 0, [plane, region]);
  const visibleRouteTileCount = useMemo(() => {
    if (!region || !routePath) {
      return 0;
    }

    return routePath.pathTiles.filter((tile) => isRouteTileInRegion(region, plane, tile)).length;
  }, [plane, region, routePath]);
  const selectedRouteIndices = useMemo(() => {
    if (!region || !selectedTile || !routePath) {
      return [];
    }

    const worldX = region.baseX + selectedTile.localX;
    const worldY = region.baseY + selectedTile.localY;
    return routePath.pathTiles
      .map((tile, index) => (tile.x === worldX && tile.y === worldY && tile.z === plane ? index : -1))
      .filter((index) => index >= 0);
  }, [plane, region, routePath, selectedTile]);

  const loadRegion = useCallback(
    async (payload?: { regionX?: number; regionY?: number; worldX?: number; worldY?: number }) => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await ipcRenderer.invoke(CHANNELS.GET_OSRS_CACHE_MAP_REGION, payload ?? {
          regionX: Number(regionXInput),
          regionY: Number(regionYInput),
        });
        if (!result?.ok || !result.region) {
          setError(result?.error || "Unable to load cache map region.");
          return;
        }

        const nextRegion = result.region as OsrsCacheMapRegionView;
        setRegion(nextRegion);
        setRegionXInput(String(nextRegion.regionX));
        setRegionYInput(String(nextRegion.regionY));
        setSelectedTile(null);
        setHoveredTile(null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        setIsLoading(false);
      }
    },
    [ipcRenderer, regionXInput, regionYInput],
  );

  useEffect(() => {
    void loadRegion({
      regionX: Number(initialFilters.regionXInput),
      regionY: Number(initialFilters.regionYInput),
    });
  }, []);

  useEffect(() => {
    writeOsrsMapFilters({
      regionXInput,
      regionYInput,
      worldXInput,
      worldYInput,
      plane,
    });
  }, [plane, regionXInput, regionYInput, worldXInput, worldYInput]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !region) {
      return;
    }

    drawMap(canvas, region, plane, selectedTile, hoveredTile, routePath);
  }, [hoveredTile, plane, region, routePath, selectedTile]);

  const readCanvasTileFromMouseEvent = useCallback((event: React.MouseEvent<HTMLCanvasElement>): SelectedTile | null => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * REGION_SIZE);
    const topY = Math.floor(((event.clientY - rect.top) / rect.height) * REGION_SIZE);
    const y = REGION_SIZE - 1 - topY;
    if (x < 0 || x >= REGION_SIZE || y < 0 || y >= REGION_SIZE) {
      return null;
    }

    return { localX: x, localY: y };
  }, []);

  const handleCanvasClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const tile = readCanvasTileFromMouseEvent(event);
      if (tile) {
        setSelectedTile(tile);
      }
    },
    [readCanvasTileFromMouseEvent],
  );

  const handleCanvasMouseMove = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const tile = readCanvasTileFromMouseEvent(event);
      setHoveredTile((current) => (isSameSelectedTile(current, tile) ? current : tile));
    },
    [readCanvasTileFromMouseEvent],
  );

  const handleLoadWorldTile = useCallback(() => {
    const worldX = Number(worldXInput);
    const worldY = Number(worldYInput);
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) {
      setError("World X and Y must be valid numbers.");
      return;
    }

    void loadRegion({ worldX, worldY });
  }, [loadRegion, worldXInput, worldYInput]);

  const loadLatestPath = useCallback(async () => {
    setIsPathLoading(true);
    setPathError(null);
    try {
      const result = await ipcRenderer.invoke(CHANNELS.GET_END_TO_END_LATEST_PATH);
      if (!result?.ok) {
        setPathError(result?.error || "Unable to load latest End To End path.");
        return;
      }

      const nextPath = (result.path ?? null) as EndToEndRoutePathSnapshot | null;
      if (!nextPath) {
        setRoutePath(null);
        setRoutePathFilePath(result.filePath ?? null);
        setPathError("No saved End To End path yet. Start the End To End bot once to generate it.");
        return;
      }

      setRoutePath(nextPath);
      setRoutePathFilePath(typeof result.filePath === "string" ? result.filePath : null);
      setPlane(clampPlane(nextPath.plane));
      await loadRegion({ regionX: nextPath.regionX, regionY: nextPath.regionY });
    } catch (loadError) {
      setPathError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsPathLoading(false);
    }
  }, [ipcRenderer, loadRegion]);

  const drawManualPath = useCallback(async () => {
    setIsPathLoading(true);
    setPathError(null);
    try {
      const nextPath = buildManualRoutePathSnapshot(manualPathInput, plane);
      setRoutePath(nextPath);
      setRoutePathFilePath(null);
      setPlane(clampPlane(nextPath.plane));
      await loadRegion({ regionX: nextPath.regionX, regionY: nextPath.regionY });
    } catch (drawError) {
      setPathError(drawError instanceof Error ? drawError.message : String(drawError));
    } finally {
      setIsPathLoading(false);
    }
  }, [loadRegion, manualPathInput, plane]);

  return (
    <div className="osrs-map-view">
      <div className="osrs-map-toolbar">
        <label className="osrs-map-field">
          <span>Region X</span>
          <input value={regionXInput} onChange={(event) => setRegionXInput(event.target.value)} inputMode="numeric" />
        </label>
        <label className="osrs-map-field">
          <span>Region Y</span>
          <input value={regionYInput} onChange={(event) => setRegionYInput(event.target.value)} inputMode="numeric" />
        </label>
        <button type="button" className="osrs-map-action" onClick={() => void loadRegion()} disabled={isLoading}>
          Load
        </button>
        <label className="osrs-map-field">
          <span>World X</span>
          <input value={worldXInput} onChange={(event) => setWorldXInput(event.target.value)} inputMode="numeric" />
        </label>
        <label className="osrs-map-field">
          <span>World Y</span>
          <input value={worldYInput} onChange={(event) => setWorldYInput(event.target.value)} inputMode="numeric" />
        </label>
        <button type="button" className="osrs-map-action" onClick={handleLoadWorldTile} disabled={isLoading}>
          Use World
        </button>
        <button
          type="button"
          className="osrs-map-action"
          onClick={() => void loadLatestPath()}
          disabled={isLoading || isPathLoading}
        >
          Latest Path
        </button>
        <button
          type="button"
          className="osrs-map-action osrs-map-action-secondary"
          onClick={() => {
            setRoutePath(null);
            setRoutePathFilePath(null);
            setPathError(null);
          }}
          disabled={!routePath || isPathLoading}
        >
          Clear Path
        </button>
        <label className="osrs-map-field osrs-map-field-plane">
          <span>Plane</span>
          <select value={plane} onChange={(event) => setPlane(clampPlane(Number(event.target.value)))}>
            <option value={0}>0</option>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>
        <div className="osrs-map-hover-readout">
          <span>Hover</span>
          <strong>
            {hoveredTileData
              ? `${hoveredTileData.worldX},${hoveredTileData.worldY},${hoveredTileData.z}`
              : "None"}
          </strong>
          {hoveredTileData && (
            <em>
              local {hoveredTileData.localX},{hoveredTileData.localY}
            </em>
          )}
        </div>
      </div>

      <div className="osrs-map-path-input-panel">
        <label className="osrs-map-path-input-field">
          <span>Manual Path</span>
          <textarea
            value={manualPathInput}
            onChange={(event) => setManualPathInput(event.target.value)}
            placeholder="[START:1774,3849,0] -> 1775,3849,0 -> [CLICK:1768,3869,0] -> [DEST:1734,3873,0]"
            spellCheck={false}
          />
        </label>
        <div className="osrs-map-path-actions">
          <button
            type="button"
            className="osrs-map-action"
            onClick={() => void drawManualPath()}
            disabled={isLoading || isPathLoading || manualPathInput.trim().length === 0}
          >
            Draw Path
          </button>
          <button
            type="button"
            className="osrs-map-action osrs-map-action-secondary"
            onClick={() => setManualPathInput("")}
            disabled={manualPathInput.length === 0}
          >
            Clear Input
          </button>
        </div>
      </div>

      {error && <p className="osrs-map-error">{error}</p>}
      {pathError && <p className="osrs-map-error">{pathError}</p>}

      <div className="osrs-map-content">
        <div className="osrs-map-canvas-panel">
          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            className="osrs-map-canvas"
            onClick={handleCanvasClick}
            onMouseMove={handleCanvasMouseMove}
            onMouseLeave={() => setHoveredTile(null)}
          />
        </div>

        <aside className="osrs-map-details">
          {region ? (
            <>
              <dl className="osrs-map-stats">
                <dt>Cache</dt>
                <dd title={region.cacheDirectoryPath}>{region.cacheDirectoryPath}</dd>
                <dt>Region</dt>
                <dd>
                  {region.regionX},{region.regionY} ({region.regionId})
                </dd>
                <dt>Base</dt>
                <dd>
                  {region.baseX},{region.baseY}
                </dd>
                <dt>Blocked</dt>
                <dd>{blockedTileCount} tiles</dd>
                <dt>Terrain</dt>
                <dd>{terrainBlockedTileCount} blocked</dd>
                <dt>Walls</dt>
                <dd>{wallTileCount} tiles</dd>
                <dt>Objects</dt>
                <dd>
                  {planeObjectCount}/{region.locationCount}
                </dd>
                <dt>Icons</dt>
                <dd>{planeIconCount}</dd>
                <dt>Defs</dt>
                <dd>{region.objectDefinitionCount}</dd>
              </dl>

              <div className="osrs-map-legend">
                <span className="osrs-map-legend-item"><i className="legend-walkable" /> Walkable</span>
                <span className="osrs-map-legend-item"><i className="legend-blocked" /> Blocked</span>
                <span className="osrs-map-legend-item"><i className="legend-object" /> Object</span>
                <span className="osrs-map-legend-item"><i className="legend-wall" /> Wall</span>
                <span className="osrs-map-legend-item"><i className="legend-icon" /> Map icon</span>
                <span className="osrs-map-legend-item"><i className="legend-path" /> Route path</span>
              </div>

              <div className="osrs-map-route">
                <h3>Route Path</h3>
                {routePath ? (
                  <dl>
                    <dt>Label</dt>
                    <dd title={routePath.label}>{routePath.label}</dd>
                    <dt>Saved</dt>
                    <dd title={routePathFilePath ?? undefined}>{new Date(routePath.createdAt).toLocaleString()}</dd>
                    <dt>Start</dt>
                    <dd>{formatWorldTile(routePath.playerTile)}</dd>
                    <dt>Destination</dt>
                    <dd title={routePath.destinationLabel ?? undefined}>
                      {routePath.destinationLabel ?? "Unknown"} {formatWorldTile(routePath.destinationTile)}
                    </dd>
                    <dt>Click</dt>
                    <dd>{formatWorldTile(routePath.clickTile)}</dd>
                    <dt>Target</dt>
                    <dd>{formatWorldTile(routePath.targetTile)}</dd>
                    <dt>Steps</dt>
                    <dd>{routePath.pathLength}</dd>
                    <dt>Visible</dt>
                    <dd>
                      {visibleRouteTileCount}/{routePath.pathTiles.length}
                    </dd>
                    <dt>Reason</dt>
                    <dd title={routePath.selectionReason ?? undefined}>{routePath.selectionReason ?? "None"}</dd>
                  </dl>
                ) : (
                  <p>No route path loaded.</p>
                )}
              </div>

              <div className="osrs-map-selected">
                {selectedTileData ? (
                  <>
                    <h3>Tile</h3>
                    <dl>
                      <dt>World</dt>
                      <dd>
                        {selectedTileData.worldX},{selectedTileData.worldY},{selectedTileData.z}
                      </dd>
                      <dt>Region</dt>
                      <dd>
                        {region.regionX},{region.regionY} ({region.regionId})
                      </dd>
                      <dt>Local</dt>
                      <dd>
                        {selectedTileData.localX},{selectedTileData.localY}
                      </dd>
                      <dt>Flags</dt>
                      <dd title={formatCollisionFlags(selectedTileData.flags)}>
                        0x{selectedTileData.flags.toString(16).padStart(2, "0")} ({selectedTileData.flags})
                      </dd>
                      <dt>Blocked</dt>
                      <dd>{formatYesNo((selectedTileData.flags & FLAG_BLOCKED) !== 0)}</dd>
                      <dt>Projectile</dt>
                      <dd>{formatYesNo((selectedTileData.flags & FLAG_PROJECTILE) !== 0)}</dd>
                      <dt>Walls</dt>
                      <dd>{formatDirectionalFlags(selectedTileData.flags)}</dd>
                      <dt>Terrain</dt>
                      <dd title={`settings=${selectedTileData.terrainSettings} underlay=${selectedTileData.underlayId} overlay=${selectedTileData.overlayId} path=${selectedTileData.overlayPath} rotation=${selectedTileData.overlayRotation}`}>
                        settings={selectedTileData.terrainSettings} underlay={selectedTileData.underlayId} overlay={selectedTileData.overlayId}
                      </dd>
                      <dt>Overlay</dt>
                      <dd>
                        path={selectedTileData.overlayPath} rot={selectedTileData.overlayRotation}
                      </dd>
                      <dt>Height</dt>
                      <dd>{selectedTileData.height}</dd>
                      <dt>Path</dt>
                      <dd>{selectedRouteIndices.length > 0 ? selectedRouteIndices.join(", ") : "No"}</dd>
                      <dt>Objects</dt>
                      <dd>{selectedTileObjects.length}</dd>
                      <dt>Icons</dt>
                      <dd>{selectedTileIcons.length}</dd>
                    </dl>
                    {selectedTileObjects.length > 0 && (
                      <div className="osrs-map-detail-group">
                        <h4>Objects</h4>
                        {selectedTileObjects.slice(0, 8).map((object) => (
                          <dl className="osrs-map-object-detail" key={`${object.id}-${object.localX}-${object.localY}-${object.type}`}>
                            <dt>Name</dt>
                            <dd title={formatObjectLabel(object)}>{formatObjectLabel(object)}</dd>
                            <dt>ID</dt>
                            <dd>{object.id}</dd>
                            <dt>Agility</dt>
                            <dd title={object.agilityObstacleKey ?? ""}>
                              {object.agilityObstacleKey
                                ? `Yes (${object.agilityObstacleKey}${object.agilityShortcutLevel !== null ? `, level ${object.agilityShortcutLevel}` : ""})`
                                : "No"}
                            </dd>
                            {object.agilityShortcut && (
                              <>
                                <dt>Shortcut</dt>
                                <dd title={object.agilityShortcutKey ?? ""}>
                                  {object.agilityShortcutDescription ?? "Shortcut"} level {object.agilityShortcutLevel}
                                </dd>
                              </>
                            )}
                            <dt>Type</dt>
                            <dd title={formatObjectTypeDescription(object.type)}>
                              {object.type} ({formatObjectTypeDescription(object.type)})
                            </dd>
                            <dt>Interact</dt>
                            <dd>{object.interactType}</dd>
                            <dt>Orient</dt>
                            <dd>{object.orientation}</dd>
                            <dt>World</dt>
                            <dd>
                              {object.worldX},{object.worldY},{object.z}
                            </dd>
                            <dt>Local</dt>
                            <dd>
                              {object.localX},{object.localY}
                            </dd>
                            <dt>Size</dt>
                            <dd>
                              {object.sizeX}x{object.sizeY} rotated, def {object.definitionSizeX}x{object.definitionSizeY}
                            </dd>
                            <dt>Projectile</dt>
                            <dd>{formatYesNo(object.blocksProjectile)}</dd>
                            <dt>Wall/Door</dt>
                            <dd>{object.wallOrDoor}</dd>
                            <dt>Map Area</dt>
                            <dd>{object.mapAreaId}</dd>
                            <dt>Clipped</dt>
                            <dd>
                              clip={formatYesNo(object.clipped)} model={formatYesNo(object.modelClipped)}
                            </dd>
                            <dt>Ground</dt>
                            <dd>
                              obstruct={formatYesNo(object.obstructsGround)} hollow={formatYesNo(object.isHollow)}
                            </dd>
                            <dt>Items</dt>
                            <dd>{object.supportsItems}</dd>
                          </dl>
                        ))}
                      </div>
                    )}
                    {selectedTileIcons.length > 0 && (
                      <div className="osrs-map-detail-group">
                        <h4>Icons</h4>
                        {selectedTileIcons.map((icon) => (
                          <dl className="osrs-map-object-detail" key={`icon-${icon.areaId}-${icon.localX}-${icon.localY}`}>
                            <dt>Label</dt>
                            <dd title={getIconLabel(icon)}>{getIconLabel(icon)}</dd>
                            <dt>Area</dt>
                            <dd>{icon.areaId}</dd>
                            <dt>Sprite</dt>
                            <dd>{icon.spriteId}</dd>
                            <dt>Category</dt>
                            <dd>{icon.category}</dd>
                            <dt>Object</dt>
                            <dd title={icon.objectName}>
                              {icon.objectName} ({icon.objectId})
                            </dd>
                            <dt>Type</dt>
                            <dd>{icon.type}</dd>
                            <dt>Orient</dt>
                            <dd>{icon.orientation}</dd>
                            <dt>World</dt>
                            <dd>
                              {icon.worldX},{icon.worldY},{icon.z}
                            </dd>
                            <dt>Local</dt>
                            <dd>
                              {icon.localX},{icon.localY}
                            </dd>
                          </dl>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p>Click a tile.</p>
                )}
              </div>
            </>
          ) : (
            <p>{isLoading ? "Loading cache map..." : "No region loaded."}</p>
          )}
        </aside>
      </div>
    </div>
  );
}
