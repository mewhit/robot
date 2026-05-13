export class CacheInputStream {
  private offset = 0;

  constructor(private readonly buffer: Buffer) {}

  get position(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.buffer.length - this.offset;
  }

  seek(position: number): void {
    if (!Number.isInteger(position) || position < 0 || position > this.buffer.length) {
      throw new RangeError(`Invalid cache stream position ${position}.`);
    }

    this.offset = position;
  }

  readUnsignedByte(): number {
    this.ensureRemaining(1);
    const value = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  peekUnsignedByte(): number {
    this.ensureRemaining(1);
    return this.buffer.readUInt8(this.offset);
  }

  readByte(): number {
    this.ensureRemaining(1);
    const value = this.buffer.readInt8(this.offset);
    this.offset += 1;
    return value;
  }

  readUnsignedShort(): number {
    this.ensureRemaining(2);
    const value = this.buffer.readUInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  readShort(): number {
    this.ensureRemaining(2);
    const value = this.buffer.readInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  readInt(): number {
    this.ensureRemaining(4);
    const value = this.buffer.readInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  readUnsignedInt(): number {
    this.ensureRemaining(4);
    const value = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  readUnsignedMedium(): number {
    this.ensureRemaining(3);
    const value = (this.buffer[this.offset] << 16) | (this.buffer[this.offset + 1] << 8) | this.buffer[this.offset + 2];
    this.offset += 3;
    return value;
  }

  readNullableLargeSmart(): number {
    this.ensureRemaining(1);
    const peek = this.buffer.readUInt8(this.offset);
    return peek < 128 ? this.readUnsignedShort() - 1 : this.readInt() & 0x7fffffff;
  }

  readBytes(length: number): Buffer {
    if (!Number.isInteger(length) || length < 0) {
      throw new RangeError(`Invalid cache byte length ${length}.`);
    }

    this.ensureRemaining(length);
    const value = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  readString(): string {
    const start = this.offset;
    while (this.offset < this.buffer.length && this.buffer[this.offset] !== 0) {
      this.offset += 1;
    }

    this.ensureRemaining(1);
    const value = this.buffer.subarray(start, this.offset).toString("latin1");
    this.offset += 1;
    return value;
  }

  readUnsignedShortSmart(): number {
    this.ensureRemaining(1);
    const peek = this.buffer.readUInt8(this.offset);
    return peek < 128 ? this.readUnsignedByte() : this.readUnsignedShort() - 32768;
  }

  readShortSmart(): number {
    this.ensureRemaining(1);
    const peek = this.buffer.readUInt8(this.offset);
    return peek < 128 ? this.readUnsignedByte() - 64 : this.readUnsignedShort() - 49152;
  }

  skip(length: number): void {
    if (!Number.isInteger(length) || length < 0) {
      throw new RangeError(`Invalid cache skip length ${length}.`);
    }

    this.ensureRemaining(length);
    this.offset += length;
  }

  private ensureRemaining(length: number): void {
    if (this.remaining < length) {
      throw new RangeError(
        `Cache stream underflow at ${this.offset}: wanted ${length} byte(s), ${this.remaining} remaining.`,
      );
    }
  }
}
