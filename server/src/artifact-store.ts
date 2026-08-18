import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface ArtifactRecord {
  id: string;
  sessionId: string;
  mimeType: string;
  bytes: number;
  createdAt: string;
  expiresAt: string;
  path: string;
}

interface PendingArtifact {
  record: ArtifactRecord;
  data: Buffer;
}

export class ArtifactStore {
  private initialized = false;
  private readonly pending = new Map<string, PendingArtifact>();
  private readonly queue: string[] = [];
  private activeWriters = 0;

  constructor(private readonly root: string, private readonly ttlMs = 60 * 60 * 1000, private readonly maxConcurrentWriters = 2, private readonly maxQueueLength = 64) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.root, { recursive: true });
    this.initialized = true;
  }

  enqueue(sessionId: string, mimeType: string, base64: string): ArtifactRecord {
    if (this.queue.length >= this.maxQueueLength) throw new Error("Artifact persistence queue is full");
    const id = `art_${randomUUID()}`;
    const createdAt = new Date();
    const record: ArtifactRecord = {
      id,
      sessionId,
      mimeType,
      bytes: Buffer.byteLength(base64, "base64"),
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + this.ttlMs).toISOString(),
      path: join(this.root, `${id}.bin`),
    };
    this.pending.set(id, { record, data: Buffer.from(base64, "base64") });
    this.queue.push(id);
    void this.drain();
    return record;
  }

  async get(id: string): Promise<{ record: ArtifactRecord; data: Buffer } | undefined> {
    const pending = this.pending.get(id);
    if (pending) return pending;
    const path = join(this.root, `${id}.bin`);
    try {
      const raw = await readFile(path, "utf8");
      const newline = raw.indexOf("\n");
      if (newline < 0) return undefined;
      const record = JSON.parse(raw.slice(0, newline)) as ArtifactRecord;
      if (record.expiresAt <= new Date().toISOString()) {
        await unlink(path).catch(() => undefined);
        return undefined;
      }
      return { record, data: Buffer.from(raw.slice(newline + 1), "base64") };
    } catch {
      return undefined;
    }
  }

  async flush(): Promise<void> {
    while (this.queue.length > 0 || this.activeWriters > 0) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  async prune(): Promise<void> {
    await this.initialize();
    for (const name of await readdir(this.root)) {
      if (!name.endsWith(".bin")) continue;
      const item = await this.get(name.slice(0, -4));
      if (!item) await unlink(join(this.root, name)).catch(() => undefined);
    }
  }

  private async drain(): Promise<void> {
    while (this.activeWriters < this.maxConcurrentWriters && this.queue.length > 0) {
      const id = this.queue.shift();
      if (!id) return;
      const item = this.pending.get(id);
      if (!item) continue;
      this.activeWriters += 1;
      void this.write(item).finally(() => {
        this.activeWriters -= 1;
        this.pending.delete(id);
        void this.drain();
      });
    }
  }

  private async write(item: PendingArtifact): Promise<void> {
    await this.initialize();
    const temporary = `${item.record.path}.tmp`;
    await writeFile(temporary, JSON.stringify(item.record) + "\n" + item.data.toString("base64"), "utf8");
    await rename(temporary, item.record.path);
  }
}
