import { CacheInputStream } from "./cache-input-stream";

export type OsrsItemDefinition = {
  id: number;
  name: string;
  stackable: boolean;
  members: boolean;
  notedId: number;
  notedTemplateId: number;
  placeholderId: number;
  placeholderTemplateId: number;
};

export type OsrsItemDefinitionMap = ReadonlyMap<number, OsrsItemDefinition>;

function createDefaultItemDefinition(id: number): OsrsItemDefinition {
  return {
    id,
    name: "null",
    stackable: false,
    members: false,
    notedId: -1,
    notedTemplateId: -1,
    placeholderId: -1,
    placeholderTemplateId: -1,
  };
}

function skipParams(stream: CacheInputStream): void {
  const count = stream.readUnsignedByte();
  for (let i = 0; i < count; i += 1) {
    const isString = stream.readUnsignedByte() === 1;
    stream.skip(3);
    if (isString) {
      stream.readString();
    } else {
      stream.readInt();
    }
  }
}

function skipSubops(stream: CacheInputStream): void {
  stream.readUnsignedByte();
  while (stream.remaining > 0) {
    const subopId = stream.readUnsignedByte();
    if (subopId === 0) {
      break;
    }
    stream.readString();
  }
}

function skipEntitySubOp(stream: CacheInputStream): void {
  stream.readUnsignedByte();
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

export function loadOsrsItemDefinition(id: number, data: Buffer): OsrsItemDefinition {
  const stream = new CacheInputStream(data);
  const definition = createDefaultItemDefinition(id);

  while (stream.remaining > 0) {
    const opcode = stream.readUnsignedByte();
    if (opcode === 0) {
      break;
    }

    if (opcode === 1) {
      stream.readUnsignedShort();
    } else if (opcode === 2) {
      definition.name = stream.readString();
    } else if (opcode === 3) {
      stream.readString();
    } else if (opcode === 4 || opcode === 5 || opcode === 6 || opcode === 95) {
      stream.readUnsignedShort();
    } else if (opcode === 7 || opcode === 8) {
      stream.readShort();
    } else if (opcode === 9) {
      stream.readString();
    } else if (opcode === 11) {
      definition.stackable = true;
    } else if (opcode === 12) {
      stream.readInt();
    } else if (
      opcode === 13 ||
      opcode === 14 ||
      opcode === 27 ||
      opcode === 42 ||
      opcode === 113 ||
      opcode === 114 ||
      opcode === 115
    ) {
      stream.readByte();
    } else if (opcode === 15) {
      stream.skip(0);
    } else if (opcode === 16) {
      definition.members = true;
    } else if (opcode === 23 || opcode === 25) {
      stream.readUnsignedShort();
      stream.readByte();
    } else if (
      opcode === 24 ||
      opcode === 26 ||
      opcode === 78 ||
      opcode === 79 ||
      opcode === 90 ||
      opcode === 91 ||
      opcode === 92 ||
      opcode === 93 ||
      opcode === 94 ||
      opcode === 110 ||
      opcode === 111 ||
      opcode === 112
    ) {
      stream.readUnsignedShort();
    } else if ((opcode >= 30 && opcode < 35) || (opcode >= 35 && opcode < 40)) {
      stream.readString();
    } else if (opcode === 40 || opcode === 41) {
      const count = stream.readUnsignedByte();
      stream.skip(count * 4);
    } else if (opcode === 43) {
      skipSubops(stream);
    } else if (opcode === 44) {
      stream.readInt();
    } else if (opcode === 45 || opcode === 48) {
      stream.readInt();
      stream.readUnsignedByte();
    } else if (opcode >= 46 && opcode <= 54) {
      stream.readInt();
    } else if (opcode === 65) {
      stream.skip(0);
    } else if (opcode === 75) {
      stream.readShort();
    } else if (opcode === 97) {
      definition.notedId = stream.readUnsignedShort();
    } else if (opcode === 98) {
      definition.notedTemplateId = stream.readUnsignedShort();
    } else if (opcode >= 100 && opcode < 110) {
      stream.readUnsignedShort();
      stream.readUnsignedShort();
    } else if (opcode === 139 || opcode === 140) {
      stream.readUnsignedShort();
    } else if (opcode === 148) {
      definition.placeholderId = stream.readUnsignedShort();
    } else if (opcode === 149) {
      definition.placeholderTemplateId = stream.readUnsignedShort();
    } else if (opcode === 200) {
      skipEntitySubOp(stream);
    } else if (opcode === 201) {
      skipConditionalEntityOp(stream);
    } else if (opcode === 202) {
      skipConditionalEntitySubOp(stream);
    } else if (opcode === 249) {
      skipParams(stream);
    } else {
      throw new Error(`Unsupported item definition opcode ${opcode} for item ${id} at byte ${stream.position - 1}.`);
    }
  }

  return definition;
}

export function loadOsrsItemDefinitions(entries: Iterable<readonly [number, Buffer]>): Map<number, OsrsItemDefinition> {
  const definitions = new Map<number, OsrsItemDefinition>();
  for (const [id, data] of entries) {
    definitions.set(id, loadOsrsItemDefinition(id, data));
  }

  return definitions;
}
