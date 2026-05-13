import { CacheInputStream } from "./cache-input-stream";

export type OsrsObjectDefinition = {
  id: number;
  name: string;
  sizeX: number;
  sizeY: number;
  interactType: number;
  blocksProjectile: boolean;
  wallOrDoor: number;
  mapAreaId: number;
  clipped: boolean;
  modelClipped: boolean;
  obstructsGround: boolean;
  isHollow: boolean;
  supportsItems: number;
};

export type OsrsObjectDefinitionMap = ReadonlyMap<number, OsrsObjectDefinition>;

export type LoadOsrsObjectDefinitionOptions = {
  rev220SoundData?: boolean;
};

function createDefaultObjectDefinition(id: number): OsrsObjectDefinition {
  return {
    id,
    name: "null",
    sizeX: 1,
    sizeY: 1,
    interactType: 2,
    blocksProjectile: true,
    wallOrDoor: -1,
    mapAreaId: -1,
    clipped: true,
    modelClipped: false,
    obstructsGround: false,
    isHollow: false,
    supportsItems: -1,
  };
}

function skipModelTable(stream: CacheInputStream, hasTypes: boolean): void {
  const count = stream.readUnsignedByte();
  for (let i = 0; i < count; i += 1) {
    stream.readUnsignedShort();
    if (hasTypes) {
      stream.readUnsignedByte();
    }
  }
}

function skipParams(stream: CacheInputStream): void {
  const count = stream.readUnsignedByte();
  for (let i = 0; i < count; i += 1) {
    const isString = stream.readUnsignedByte() === 1;
    stream.readUnsignedByte();
    stream.readUnsignedByte();
    stream.readUnsignedByte();
    if (isString) {
      stream.readString();
    } else {
      stream.readInt();
    }
  }
}

function skipEntityOp(stream: CacheInputStream): void {
  stream.readUnsignedByte();
  stream.readString();
}

function skipConditionalEntityOp(stream: CacheInputStream): void {
  stream.readUnsignedByte();
  stream.readUnsignedShort();
  stream.readUnsignedShort();
  stream.readInt();
  stream.readInt();
  stream.readString();
}

function skipConditionalEntitySubOp(stream: CacheInputStream): void {
  stream.readUnsignedByte();
  stream.readUnsignedShort();
  stream.readUnsignedShort();
  stream.readUnsignedShort();
  stream.readInt();
  stream.readInt();
  stream.readString();
}

export function loadOsrsObjectDefinition(
  id: number,
  data: Buffer,
  options: LoadOsrsObjectDefinitionOptions = {},
): OsrsObjectDefinition {
  const stream = new CacheInputStream(data);
  const definition = createDefaultObjectDefinition(id);
  const rev220SoundData = options.rev220SoundData ?? true;

  while (stream.remaining > 0) {
    const opcode = stream.readUnsignedByte();
    if (opcode === 0) {
      break;
    }

    if (opcode === 1) {
      skipModelTable(stream, true);
    } else if (opcode === 6) {
      const count = stream.readUnsignedByte();
      stream.skip(count * 5);
    } else if (opcode === 7) {
      const count = stream.readUnsignedByte();
      stream.skip(count * 4);
    } else if (opcode === 2) {
      definition.name = stream.readString();
    } else if (opcode === 5) {
      skipModelTable(stream, false);
    } else if (opcode === 14) {
      definition.sizeX = stream.readUnsignedByte();
    } else if (opcode === 15) {
      definition.sizeY = stream.readUnsignedByte();
    } else if (opcode === 17) {
      definition.interactType = 0;
      definition.blocksProjectile = false;
    } else if (opcode === 18) {
      definition.blocksProjectile = false;
    } else if (opcode === 19) {
      definition.wallOrDoor = stream.readUnsignedByte();
    } else if (opcode === 21) {
      stream.skip(0);
    } else if (opcode === 22) {
      stream.skip(0);
    } else if (opcode === 23) {
      stream.skip(0);
    } else if (opcode === 24) {
      stream.readUnsignedShort();
    } else if (opcode === 27) {
      definition.interactType = 1;
    } else if (opcode === 28) {
      stream.readUnsignedByte();
    } else if (opcode === 29) {
      stream.readByte();
    } else if (opcode === 39) {
      stream.readByte();
    } else if (opcode >= 30 && opcode < 35) {
      stream.readString();
    } else if (opcode === 40 || opcode === 41) {
      const count = stream.readUnsignedByte();
      stream.skip(count * 4);
    } else if (opcode === 61) {
      stream.readUnsignedShort();
    } else if (opcode === 62) {
      stream.skip(0);
    } else if (opcode === 64) {
      stream.skip(0);
    } else if (opcode === 65 || opcode === 66 || opcode === 67) {
      stream.readUnsignedShort();
    } else if (opcode === 68) {
      stream.readUnsignedShort();
    } else if (opcode === 69) {
      stream.readUnsignedByte();
    } else if (opcode === 70 || opcode === 71 || opcode === 72) {
      stream.readShort();
    } else if (opcode === 73) {
      definition.obstructsGround = true;
    } else if (opcode === 74) {
      definition.isHollow = true;
    } else if (opcode === 75) {
      definition.supportsItems = stream.readUnsignedByte();
    } else if (opcode === 77 || opcode === 92) {
      stream.readUnsignedShort();
      stream.readUnsignedShort();
      if (opcode === 92) {
        stream.readUnsignedShort();
      }
      const count = stream.readUnsignedByte();
      stream.skip((count + 1) * 2);
    } else if (opcode === 78) {
      stream.readUnsignedShort();
      stream.readUnsignedByte();
      if (rev220SoundData) {
        stream.readUnsignedByte();
      }
    } else if (opcode === 79) {
      stream.readUnsignedShort();
      stream.readUnsignedShort();
      stream.readUnsignedByte();
      if (rev220SoundData) {
        stream.readUnsignedByte();
      }
      const count = stream.readUnsignedByte();
      stream.skip(count * 2);
    } else if (opcode === 81) {
      stream.readUnsignedByte();
    } else if (opcode === 82) {
      definition.mapAreaId = stream.readUnsignedShort();
    } else if (opcode === 89) {
      stream.skip(0);
    } else if (opcode === 90) {
      stream.skip(0);
    } else if (opcode === 91) {
      stream.readUnsignedByte();
    } else if (opcode === 249) {
      skipParams(stream);
    } else if (opcode === 93) {
      stream.readUnsignedByte();
      stream.readUnsignedShort();
      stream.readUnsignedByte();
      stream.readUnsignedShort();
    } else if (opcode === 94) {
      stream.skip(0);
    } else if (opcode === 95) {
      stream.readUnsignedByte();
    } else if (opcode === 96) {
      stream.readUnsignedByte();
    } else if (opcode === 100) {
      skipEntityOp(stream);
    } else if (opcode === 101) {
      skipConditionalEntityOp(stream);
    } else if (opcode === 102) {
      skipConditionalEntitySubOp(stream);
    } else if (opcode === 103) {
      stream.skip(0);
    } else if (opcode === 104) {
      stream.readUnsignedByte();
    } else if (opcode === 105) {
      stream.skip(0);
    } else if (opcode === 106) {
      const count = stream.readUnsignedByte();
      stream.skip(count * 3);
    } else if (opcode === 107) {
      stream.readUnsignedShort();
    } else if (opcode >= 150 && opcode < 155) {
      stream.readString();
    } else if (opcode === 160) {
      const count = stream.readUnsignedByte();
      stream.skip(count * 2);
    } else if (opcode === 162) {
      stream.readInt();
    } else if (opcode === 163) {
      stream.skip(4);
    } else if (opcode === 164 || opcode === 165 || opcode === 166) {
      stream.readShort();
    } else if (opcode === 167) {
      stream.readUnsignedShort();
    } else if (opcode === 168 || opcode === 169 || opcode === 170 || opcode === 171 || opcode === 173) {
      stream.skip(0);
    } else if (opcode === 172) {
      stream.readUnsignedByte();
    } else if (opcode === 177 || opcode === 178) {
      stream.skip(0);
    } else if (opcode === 189) {
      stream.skip(0);
    } else if (opcode >= 190 && opcode < 196) {
      stream.readUnsignedShort();
    } else if (opcode === 196) {
      stream.readUnsignedByte();
    } else if (opcode === 197) {
      stream.readUnsignedByte();
    } else if (opcode === 198 || opcode === 199) {
      stream.skip(0);
    } else if (opcode === 200 || opcode === 201) {
      stream.skip(opcode === 200 ? 4 : 6);
    } else if (opcode >= 202 && opcode <= 209) {
      stream.skip(0);
    } else {
      throw new Error(`Unsupported object definition opcode ${opcode} for object ${id} at byte ${stream.position - 1}.`);
    }
  }

  if (definition.isHollow) {
    definition.interactType = 0;
    definition.blocksProjectile = false;
  }

  if (definition.supportsItems === -1) {
    definition.supportsItems = definition.interactType !== 0 ? 1 : 0;
  }

  return definition;
}

export function loadOsrsObjectDefinitions(
  entries: Iterable<readonly [number, Buffer]>,
  options?: LoadOsrsObjectDefinitionOptions,
): Map<number, OsrsObjectDefinition> {
  const definitions = new Map<number, OsrsObjectDefinition>();
  for (const [id, data] of entries) {
    definitions.set(id, loadOsrsObjectDefinition(id, data, options));
  }

  return definitions;
}
