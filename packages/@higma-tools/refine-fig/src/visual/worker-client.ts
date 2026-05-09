/**
 * @file Driver for `render-node-worker` — sends a render queue to a
 * long-lived subprocess and respawns it transparently on crash.
 *
 * The native resvg library can panic on a small set of inputs (zero-
 * area paths, malformed glyph outlines). The panic kills the
 * subprocess; the parent observes the closed pipe, marks the
 * outstanding request as un-renderable, and restarts the worker
 * to handle the next request. From the caller's perspective each
 * `render(req)` resolves with a result or a structured failure.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Writable } from "node:stream";

export type RenderJob = {
  readonly nodeGuid: string;
  readonly maxWidth: number;
  readonly outPath: string;
};

export type RenderJobResult =
  | { readonly kind: "ok"; readonly outPath: string }
  | { readonly kind: "failed"; readonly error: string };

export type WorkerClient = {
  readonly render: (job: RenderJob) => Promise<RenderJobResult>;
  readonly close: () => Promise<void>;
};

type WorkerResponse =
  | { readonly id: string; readonly ok: true }
  | { readonly id: string; readonly ok: false; readonly error: string };

function isReadyMessage(value: unknown): value is { readonly ready: true } {
  if (!value || typeof value !== "object") {
    return false;
  }
  const r = (value as { ready?: unknown }).ready;
  return r === true;
}

function toWorkerResponse(value: unknown): WorkerResponse | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const v = value as { id?: unknown; ok?: unknown; error?: unknown };
  if (typeof v.id !== "string") {
    return undefined;
  }
  if (v.ok === true) {
    return { id: v.id, ok: true };
  }
  if (v.ok === false && typeof v.error === "string") {
    return { id: v.id, ok: false, error: v.error };
  }
  return undefined;
}

const WORKER_BIN = workerEntryPath();

function workerEntryPath(): string {
  // The worker source lives next to this file at ./render-node-worker.ts.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "render-node-worker.ts");
}

type Pending = {
  readonly id: string;
  readonly resolve: (response: WorkerResponse) => void;
};

type ProcessState = {
  readonly proc: ChildProcess;
  readonly stdin: Writable;
  readonly rl: ReadlineInterface;
  readonly readyPromise: Promise<void>;
  // Tracks every request whose response hasn't arrived. On a crash
  // these all resolve with `crashed=true` so the client can mark them.
  pending: Map<string, Pending>;
  crashed: boolean;
};

/** Spawn a worker bound to `figPath`. The returned client respawns transparently. */
export function createWorkerClient(figPath: string): WorkerClient {
  const state: { value: ProcessState | undefined; nextId: number } = { value: undefined, nextId: 0 };

  function spawnState(): ProcessState {
    const proc = spawn("bun", [WORKER_BIN, figPath], { stdio: ["pipe", "pipe", "inherit"] });
    if (!proc.stdout || !proc.stdin) {
      throw new Error("createWorkerClient: spawned worker has no stdio pipes");
    }
    const stdin: Writable = proc.stdin;
    const rl = createInterface({ input: proc.stdout });
    const newState: ProcessState = {
      proc,
      stdin,
      rl,
      readyPromise: new Promise<void>((resolveReady, rejectReady) => {
        rl.once("line", (line: string) => {
          try {
            const parsed: unknown = JSON.parse(line);
            if (isReadyMessage(parsed)) {
              resolveReady();
              return;
            }
            rejectReady(new Error(`worker: expected {"ready":true}, got ${line}`));
          } catch (err) {
            rejectReady(err);
          }
        });
      }),
      pending: new Map(),
      crashed: false,
    };
    rl.on("line", (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      try {
        const parsed: unknown = JSON.parse(trimmed);
        const response = toWorkerResponse(parsed);
        if (response) {
          const pending = newState.pending.get(response.id);
          if (pending) {
            newState.pending.delete(response.id);
            pending.resolve(response);
          }
        }
      } catch (parseError) {
        // Non-JSON noise from worker (debug logs etc.) is expected and
        // safe to ignore — every protocol message is whole-line JSON.
        // We surface the line on stderr to aid debugging when the
        // protocol does drift.
        process.stderr.write(`worker-client: non-JSON line ignored (${parseError instanceof Error ? parseError.message : String(parseError)}): ${trimmed}\n`);
      }
    });
    proc.on("close", () => {
      newState.crashed = true;
      // Resolve every still-pending request as a crash so the queue
      // does not hang. The render() loop will re-spawn for the next job.
      for (const [id, p] of newState.pending) {
        p.resolve({ id, ok: false, error: "worker crashed (likely native panic)" });
      }
      newState.pending.clear();
    });
    return newState;
  }

  async function ensureWorker(): Promise<ProcessState> {
    if (!state.value || state.value.crashed) {
      const next = spawnState();
      await next.readyPromise;
      state.value = next;
    }
    return state.value;
  }

  async function render(job: RenderJob): Promise<RenderJobResult> {
    const worker = await ensureWorker();
    const id = `${state.nextId}`;
    state.nextId = state.nextId + 1;
    const responsePromise = new Promise<WorkerResponse>((resolveResp) => {
      worker.pending.set(id, { id, resolve: resolveResp });
    });
    worker.stdin.write(`${JSON.stringify({ id, ...job })}\n`);
    const response = await responsePromise;
    if (response.ok) {
      return { kind: "ok", outPath: job.outPath };
    }
    return { kind: "failed", error: response.error };
  }

  async function close(): Promise<void> {
    const current = state.value;
    if (!current || current.crashed) {
      return;
    }
    current.stdin.end();
    await new Promise<void>((resolveClose) => {
      current.proc.once("close", () => resolveClose());
    });
  }

  return { render, close };
}
