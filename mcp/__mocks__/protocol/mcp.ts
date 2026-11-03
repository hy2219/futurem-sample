import type { Request, Notification, Result } from "@modelcontextprotocol/sdk/types.js";
import { makeEnvironment } from "../../test_utils/stubs.js";

const actual = await vi.importActual<typeof import("@modelcontextprotocol/sdk/client/index.js")>("@modelcontextprotocol/sdk/client/index.js");
export const getSupportedElicitationModes = vi.fn<typeof actual.getSupportedElicitationModes>(actual.getSupportedElicitationModes);
export const clientState = {
  instances: [] as Pick<Client, "identity" | "connect" | "close">[],
  connectError: undefined as Error | undefined,
  failConnect(): void { this.connectError = new Error("Prepared connection failure"); },
};

export class Client<RequestT extends Request = Request, NotificationT extends Notification = Notification, ResultT extends Result = Result>
  extends actual.Client<RequestT, NotificationT, ResultT> {
  readonly identity = makeEnvironment();
  constructor(...args: ConstructorParameters<typeof actual.Client>) {
    super(...args);
    clientState.instances.push(this);
  }
  override connect = vi.fn<InstanceType<typeof actual.Client>["connect"]>(async () => {
    if (clientState.connectError) throw clientState.connectError;
  });
  override close = vi.fn<InstanceType<typeof actual.Client>["close"]>(async () => {});
}

export function resetClients(): void {
  clientState.instances.length = 0;
  clientState.connectError = undefined;
}

({ Client, getSupportedElicitationModes } satisfies typeof actual);
