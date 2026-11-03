import { authorization as createAuthorization, sessionToken as createSessionToken } from "../../test_utils/stubs.js";

const actual = await vi.importActual<typeof import("../../auth/tokens.js")>("../../auth/tokens.js");
export const sessionToken = createSessionToken();
export const equalSecret = vi.fn<typeof actual.equalSecret>(actual.equalSecret);
export const signToken = vi.fn<typeof actual.signToken>(async () => sessionToken);

// Keep the signer interface aligned; cryptographic behavior has separate real tests.
({ equalSecret, signToken } satisfies typeof import("../../auth/tokens.js"));

export const authorization = vi.fn<typeof createAuthorization>(createAuthorization);
