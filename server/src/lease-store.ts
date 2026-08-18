import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface LeaseRecord {
  sessionId: string;
  workerId: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  lastActivityAt: string;
  updatedAt: string;
}

type LeaseInput = Omit<LeaseRecord, "workerId" | "updatedAt">;

export class LeaseStore {
  private initialized = false;
  private readonly pending = new Map<string, LeaseRecord>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(private readonly root: string, private readonly workerId: string, private readonly coalesceMs = 250) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.root, { recursive: true });
    this.initialized = true;
  }

  schedule(input: LeaseInput): void {
    const lease: LeaseRecord = { ...input, workerId: this.workerId, updatedAt: new Date().toISOString() };
    this.pending.set(input.sessionId, lease);
    if (this.timers.has(input.sessionId)) return;
    const timer = setTimeout(() => {
      this.timers.delete(input.sessionId);
      void this.flush(input.sessionId);
    }, this.coalesceMs);
    timer.unref();
    this.timers.set(input.sessionId, timer);
  }

  async flush(sessionId: string): Promise<void> {
    const timer = this.timers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(sessionId);
    }
    const prior = this.inflight.get(sessionId);
    if (prior) await prior;
    const lease = this.pending.get(sessionId);
    if (!lease) return;
    this.pending.delete(sessionId);
    const write = this.writeLease(lease).finally(() => {
      this.inflight.delete(sessionId);
      if (this.pending.has(sessionId)) void this.flush(sessionId);
    });
    this.inflight.set(sessionId, write);
    await write;
  }

  async remove(sessionId: string): Promise<void> {
    await this.flush(sessionId);
    await this.initialize();
    const target = join(this.root, `${sessionId}.json`);
    await writeFile(`${target}.closed`, JSON.stringify({ sessionId, workerId: this.workerId, closedAt: new Date().toISOString() }), "utf8");
  }

  async get(sessionId: string): Promise<LeaseRecord | undefined> {
    await this.initialize();
    try {
      return JSON.parse(await readFile(join(this.root, `${sessionId}.json`), "utf8")) as LeaseRecord;
    } catch {
      return undefined;
    }
  }

  async prune(): Promise<void> {
    await this.initialize();
    for (const name of await readdir(this.root)) {
      if (!name.endsWith(".json")) continue;
      const record = await this.get(name.slice(0, -5));
      if (record && record.expiresAt <= new Date().toISOString()) await unlink(join(this.root, name)).catch(() => undefined);
    }
  }

  private async writeLease(lease: LeaseRecord): Promise<void> {
    await this.initialize();
    const target = join(this.root, `${lease.sessionId}.json`);
    const temporary = `${target}.tmp`;
    await writeFile(temporary, JSON.stringify(lease, null, 2), "utf8");
    await rename(temporary, target);
  }
}
