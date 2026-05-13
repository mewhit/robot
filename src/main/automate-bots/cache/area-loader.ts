import { CacheInputStream } from "./cache-input-stream";

export const OSRS_AREA_DEFINITION_ARCHIVE_ID = 35;

export type OsrsAreaDefinition = {
  id: number;
  spriteId: number;
  name: string | null;
  textColor: number;
  category: number;
  textScale: number;
};

export type OsrsAreaDefinitionMap = ReadonlyMap<number, OsrsAreaDefinition>;

function createDefaultAreaDefinition(id: number): OsrsAreaDefinition {
  return {
    id,
    spriteId: -1,
    name: null,
    textColor: 0,
    category: -1,
    textScale: 0,
  };
}

export function loadOsrsAreaDefinition(id: number, data: Buffer): OsrsAreaDefinition {
  const stream = new CacheInputStream(data);
  const definition = createDefaultAreaDefinition(id);

  while (stream.remaining > 0) {
    const opcode = stream.readUnsignedByte();
    if (opcode === 0) {
      break;
    }

    if (opcode === 1) {
      definition.spriteId = stream.readNullableLargeSmart();
    } else if (opcode === 2) {
      stream.readNullableLargeSmart();
    } else if (opcode === 3) {
      definition.name = stream.readString();
    } else if (opcode === 4) {
      definition.textColor = stream.readUnsignedMedium();
    } else if (opcode === 5) {
      stream.readUnsignedMedium();
    } else if (opcode === 6) {
      definition.textScale = stream.readUnsignedByte();
    } else if (opcode === 7 || opcode === 8) {
      stream.readUnsignedByte();
    } else if (opcode >= 10 && opcode <= 14) {
      stream.readString();
    } else if (opcode === 15) {
      const pointCount = stream.readUnsignedByte();
      stream.skip(pointCount * 4);
      stream.readInt();
      const fieldCount = stream.readUnsignedByte();
      stream.skip(fieldCount * 4);
      stream.skip(pointCount);
    } else if (opcode === 16) {
      stream.skip(0);
    } else if (opcode === 17) {
      stream.readString();
    } else if (opcode === 18) {
      stream.readNullableLargeSmart();
    } else if (opcode === 19) {
      definition.category = stream.readUnsignedShort();
    } else if (opcode === 21 || opcode === 22) {
      stream.readInt();
    } else if (opcode === 23) {
      stream.skip(3);
    } else if (opcode === 24) {
      stream.skip(4);
    } else if (opcode === 25) {
      stream.readNullableLargeSmart();
    } else if (opcode === 28 || opcode === 29 || opcode === 30) {
      stream.readUnsignedByte();
    } else {
      throw new Error(`Unsupported area definition opcode ${opcode} for area ${id} at byte ${stream.position - 1}.`);
    }
  }

  return definition;
}

export function loadOsrsAreaDefinitions(entries: Iterable<readonly [number, Buffer]>): Map<number, OsrsAreaDefinition> {
  const definitions = new Map<number, OsrsAreaDefinition>();
  for (const [id, data] of entries) {
    definitions.set(id, loadOsrsAreaDefinition(id, data));
  }

  return definitions;
}
