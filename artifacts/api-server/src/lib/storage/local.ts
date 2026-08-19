import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ByteRange, VideoStorage } from "./index";

export class LocalVideoStorage implements VideoStorage {
  readonly provider = "local";

  constructor(private readonly rootDir: string) {}

  private resolve(key: string): string {
    const root = path.resolve(this.rootDir);
    const full = path.resolve(root, key);
    if (full === root || !full.startsWith(root + path.sep)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return full;
  }

  async save(key: string, stream: Readable): Promise<{ sizeBytes: number }> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await pipeline(stream, createWriteStream(full));
    const { size } = await stat(full);
    return { sizeBytes: size };
  }

  async openReadStream(key: string, range?: ByteRange): Promise<Readable> {
    const full = this.resolve(key);
    await stat(full); // throws ENOENT before the stream is created
    return createReadStream(full, range);
  }

  async stat(key: string): Promise<{ sizeBytes: number } | null> {
    try {
      const { size } = await stat(this.resolve(key));
      return { sizeBytes: size };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolve(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}
