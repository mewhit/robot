import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IpcRenderer } from "electron";
import { CHANNELS } from "../main/ipcChannels";
import type {
  OsrsCacheMapIcon,
  OsrsCacheMapObject,
  OsrsCacheMapRegionView,
  OsrsCacheMapTile,
} from "../main/automate-bots/cache/cache-map-view";

type OsrsMapViewProps = {
  ipcRenderer: IpcRenderer;
};

type SelectedTile = {
  localX: number;
  localY: number;
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

function getTileKey(localX: number, localY: number, z: number): string {
  return `${localX},${localY},${z}`;
}

function clampPlane(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(3, Math.trunc(value)));
}

function formatObjectLabel(object: OsrsCacheMapObject): string {
  const name = object.name && object.name !== "null" ? object.name : `Object ${object.id}`;
  return `${name} (${object.id})`;
}

function getIconLabel(icon: OsrsCacheMapIcon): string {
  return icon.label || icon.name || icon.objectName || `Icon ${icon.areaId}`;
}

function drawMap(
  canvas: HTMLCanvasElement,
  region: OsrsCacheMapRegionView,
  plane: number,
  selectedTile: SelectedTile | null,
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

  ctx.strokeStyle = "#dc2626";
  ctx.lineWidth = 2;
  ctx.lineCap = "square";
  for (const tile of planeTiles) {
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
  const [regionXInput, setRegionXInput] = useState("50");
  const [regionYInput, setRegionYInput] = useState("50");
  const [worldXInput, setWorldXInput] = useState("");
  const [worldYInput, setWorldYInput] = useState("");
  const [plane, setPlane] = useState(0);
  const [region, setRegion] = useState<OsrsCacheMapRegionView | null>(null);
  const [selectedTile, setSelectedTile] = useState<SelectedTile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tilesByKey = useMemo(() => {
    const map = new Map<string, OsrsCacheMapTile>();
    for (const tile of region?.tiles ?? []) {
      map.set(getTileKey(tile.localX, tile.localY, tile.z), tile);
    }
    return map;
  }, [region]);

  const selectedTileData = selectedTile ? tilesByKey.get(getTileKey(selectedTile.localX, selectedTile.localY, plane)) ?? null : null;

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
  const wallTileCount = useMemo(
    () => planeTiles.filter((tile) => (tile.flags & (FLAG_NORTH | FLAG_EAST | FLAG_SOUTH | FLAG_WEST)) !== 0).length,
    [planeTiles],
  );
  const planeObjectCount = useMemo(() => region?.objects.filter((object) => object.z === plane).length ?? 0, [plane, region]);
  const planeIconCount = useMemo(() => region?.icons.filter((icon) => icon.z === plane).length ?? 0, [plane, region]);

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
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        setIsLoading(false);
      }
    },
    [ipcRenderer, regionXInput, regionYInput],
  );

  useEffect(() => {
    void loadRegion({ regionX: 50, regionY: 50 });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !region) {
      return;
    }

    drawMap(canvas, region, plane, selectedTile);
  }, [plane, region, selectedTile]);

  const handleCanvasClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const x = Math.floor(((event.clientX - rect.left) / rect.width) * REGION_SIZE);
      const topY = Math.floor(((event.clientY - rect.top) / rect.height) * REGION_SIZE);
      const y = REGION_SIZE - 1 - topY;
      if (x < 0 || x >= REGION_SIZE || y < 0 || y >= REGION_SIZE) {
        return;
      }

      setSelectedTile({ localX: x, localY: y });
    },
    [],
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
        <label className="osrs-map-field osrs-map-field-plane">
          <span>Plane</span>
          <select value={plane} onChange={(event) => setPlane(clampPlane(Number(event.target.value)))}>
            <option value={0}>0</option>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>
      </div>

      {error && <p className="osrs-map-error">{error}</p>}

      <div className="osrs-map-content">
        <div className="osrs-map-canvas-panel">
          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            className="osrs-map-canvas"
            onClick={handleCanvasClick}
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
                      <dt>Local</dt>
                      <dd>
                        {selectedTileData.localX},{selectedTileData.localY}
                      </dd>
                      <dt>Flags</dt>
                      <dd>0x{selectedTileData.flags.toString(16).padStart(2, "0")}</dd>
                      <dt>Blocked</dt>
                      <dd>{(selectedTileData.flags & FLAG_BLOCKED) !== 0 ? "Yes" : "No"}</dd>
                      <dt>Projectile</dt>
                      <dd>{(selectedTileData.flags & FLAG_PROJECTILE) !== 0 ? "Yes" : "No"}</dd>
                      <dt>Terrain</dt>
                      <dd>{selectedTileData.terrainSettings}</dd>
                    </dl>
                    {selectedTileObjects.length > 0 && (
                      <ul className="osrs-map-object-list">
                        {selectedTileObjects.slice(0, 8).map((object) => (
                          <li key={`${object.id}-${object.localX}-${object.localY}-${object.type}`}>
                            {formatObjectLabel(object)}
                          </li>
                        ))}
                      </ul>
                    )}
                    {selectedTileIcons.length > 0 && (
                      <ul className="osrs-map-object-list">
                        {selectedTileIcons.map((icon) => (
                          <li key={`icon-${icon.areaId}-${icon.localX}-${icon.localY}`}>
                            {getIconLabel(icon)} icon ({icon.areaId})
                          </li>
                        ))}
                      </ul>
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
