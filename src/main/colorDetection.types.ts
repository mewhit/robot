export type Coordinate = {
  x: number;
  y: number;
};

export type WatchBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RgbColor = {
  r: number;
  g: number;
  b: number;
};

export type DetectColorShapesOptions = {
  tolerance?: number;
  minShapeSize?: number;
  stepPx?: number;
  mergeGapPx?: number;
};

export type Shape = {
  coordinates: Coordinate[];
  center: Coordinate;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  area: number;
};
