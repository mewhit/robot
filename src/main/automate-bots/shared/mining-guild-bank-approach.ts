export type TileCoord = {
  x: number;
  y: number;
  z: number;
};

export type TileBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  z: number;
};

export type StableTileRead = {
  tile: TileCoord | null;
  stableReadCount: number;
};

export type BankApproachLocalPlan = {
  point: { x: number; y: number };
  deltaXTiles: number;
  deltaYTiles: number;
  distanceTiles: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function axisDistance(dx: number, dy: number): number {
  return Math.max(Math.abs(dx), Math.abs(dy));
}

export function isSameTileCoord(a: TileCoord | null, b: TileCoord | null): boolean {
  if (!!a && !!b) {
    return a.x === b.x && a.y === b.y && a.z === b.z;
  }

  return a === b;
}

export function isTileWithinBounds(tile: TileCoord, bounds: TileBounds): boolean {
  return (
    tile.z === bounds.z &&
    tile.x >= bounds.minX &&
    tile.x <= bounds.maxX &&
    tile.y >= bounds.minY &&
    tile.y <= bounds.maxY
  );
}

export function trackStableTileRead(previous: StableTileRead, nextTile: TileCoord | null, bounds: TileBounds): StableTileRead {
  if (!nextTile || !isTileWithinBounds(nextTile, bounds)) {
    return {
      tile: null,
      stableReadCount: 0,
    };
  }

  return {
    tile: nextTile,
    stableReadCount: isSameTileCoord(previous.tile, nextTile) ? previous.stableReadCount + 1 : 1,
  };
}

export function planBankApproachLocalPoint(params: {
  captureSize: { width: number; height: number };
  anchor: { x: number; y: number };
  tilePx: number;
  targetTile: TileCoord;
  playerTile: TileCoord;
  arrivalRadiusTiles: number;
  maxClickDistanceTiles: number;
  edgeMarginPx: number;
}): BankApproachLocalPlan | null {
  const deltaXTiles = params.targetTile.x - params.playerTile.x;
  const deltaYTiles = params.targetTile.y - params.playerTile.y;
  const distanceTiles = axisDistance(deltaXTiles, deltaYTiles);
  if (distanceTiles <= params.arrivalRadiusTiles) {
    return null;
  }

  const moveScale = distanceTiles > params.maxClickDistanceTiles ? params.maxClickDistanceTiles / distanceTiles : 1;
  const minLocalX = params.edgeMarginPx;
  const minLocalY = params.edgeMarginPx;
  const maxLocalX = params.captureSize.width - 1 - params.edgeMarginPx;
  const maxLocalY = params.captureSize.height - 1 - params.edgeMarginPx;

  return {
    point: {
      x: clamp(params.anchor.x + Math.round(deltaXTiles * params.tilePx * moveScale), minLocalX, maxLocalX),
      // Facing north means larger world-y should be clicked upward on screen.
      y: clamp(params.anchor.y - Math.round(deltaYTiles * params.tilePx * moveScale), minLocalY, maxLocalY),
    },
    deltaXTiles,
    deltaYTiles,
    distanceTiles,
  };
}
