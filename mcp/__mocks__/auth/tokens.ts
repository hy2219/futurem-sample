import { makeEnvironment as createEnvironment } from "../../test_utils/stubs.js";

export const makeEnvironment = vi.fn<typeof createEnvironment>(createEnvironment);
