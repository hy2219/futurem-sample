import type { ResourceAdapter, ResourceManifest } from "../../resources/resource.js";
import { makeResourceOutput } from "../../test_utils/stubs.js";

export class FakeAdapter implements ResourceAdapter {
  readonly result: { message: string };
  private readinessError?: Error;
  private callError?: Error;
  private invalidOutput = false;

  constructor(readonly resource: ResourceManifest) {
    this.result = makeResourceOutput(resource.id);
  }

  ready = vi.fn<ResourceAdapter["ready"]>(async () => {
    if (this.readinessError) throw this.readinessError;
  });
  call = vi.fn<ResourceAdapter["call"]>(async () => {
    if (this.callError) throw this.callError;
    return this.invalidOutput ? { message: 7 } : this.result;
  });
  close = vi.fn<ResourceAdapter["close"]>(async () => {});

  failReady(): void { this.readinessError = new Error("private database connection detail"); }
  failCall(): void { this.callError = new Error("Prepared adapter call failure"); }
  badOutput(): void { this.invalidOutput = true; }
}

export const adapters = new Map<string, FakeAdapter>();
export const createAdapters = vi.fn<typeof import("../../resources/adapters.js").createAdapters>((resources, _env) => {
  const prepared = new Map<string, FakeAdapter>();
  for (const resource of resources) {
    const adapter = new FakeAdapter(resource);
    prepared.set(resource.id, adapter);
    adapters.set(resource.id, adapter);
  }
  return prepared;
});

export function resetAdapters(): void {
  adapters.clear();
  createAdapters.mockClear();
}

({ createAdapters } satisfies Pick<typeof import("../../resources/adapters.js"), "createAdapters">);
