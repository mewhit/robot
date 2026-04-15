export type RobotApi = {
  getMousePos: () => { x: number; y: number };
  moveMouse: (x: number, y: number) => void;
  mouseClick: (button?: "left" | "right" | "middle", double?: boolean) => void;
  getPixelColor?: (x: number, y: number) => string;
  keyTap: (key: string, modifier?: string | string[]) => void;
  keyToggle?: (key: string, downOrUp: "down" | "up") => void;
};

export type ExplorerNode = {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  children?: ExplorerNode[];
};

export type CsvRow = {
  index: number;
  action: string;
  stepName: string;
  x: number;
  y: number;
  elapsedSeconds: number;
  radius: number;
  elapsedRange: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  elapsedMin: number | null;
  elapsedMax: number | null;
  percentageX: number;
  percentageY: number;
  rangeX: {
    min: number;
    max: number;
  };
  rangeY: {
    min: number;
    max: number;
  };
};

export type VirtualBounds = {
  minX: number;
  minY: number;
  width: number;
  height: number;
};
