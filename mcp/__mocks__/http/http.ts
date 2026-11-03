import { makeHttpPeerData, makeUpstreamPayload } from "../../test_utils/stubs.js";

const actual = await vi.importActual<typeof import("../../http/http.js")>("../../http/http.js");
export const HttpError = actual.HttpError;
export const application = vi.fn<typeof actual.application>(actual.application);
export const errors = vi.fn<typeof actual.errors>(actual.errors);
export const errorCode = vi.fn<typeof actual.errorCode>(actual.errorCode);
export const required = vi.fn<typeof actual.required>(actual.required);

export class Upstream {
  readonly data = makeUpstreamPayload();
  readonly requests: Parameters<typeof globalThis.fetch>[] = [];
  private response: () => Promise<Response> = async () => Response.json(this.data);

  fetch = vi.fn<typeof globalThis.fetch>(async (...args) => {
    this.requests.push(args);
    return this.response();
  });

  reset(): void {
    this.requests.length = 0;
    this.fetch.mockClear();
    this.response = async () => Response.json(this.data);
  }
  deny(status = 403): void {
    this.response = async () => Response.json({ error: "Denied" }, { status });
  }
  invalidJson(): void {
    this.response = async () => new Response("<invalid>");
  }
  unavailable(): void {
    this.response = async () => { throw new TypeError("fetch failed"); };
  }
}

export const upstream = new Upstream();
export const fetch = upstream.fetch;
export const httpPeer = {
  ...makeHttpPeerData(),
  requests: [] as { url: string; options: RequestInit }[],
  failure: undefined as Error | undefined,
  fail(): void { this.failure = new HttpError(503, "Prepared upstream failure"); },
};
export const requestJson = vi.fn<typeof actual.requestJson>(async (url, options = {}) => {
  httpPeer.requests.push({ url, options });
  if (httpPeer.failure) throw httpPeer.failure;
  return httpPeer.result;
});

export function resetHttp(): void {
  upstream.reset();
  httpPeer.requests.length = 0;
  httpPeer.failure = undefined;
  requestJson.mockClear();
}

({ application, errors, HttpError, errorCode, required, requestJson } satisfies typeof actual);
