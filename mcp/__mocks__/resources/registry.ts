import { makeHttpResource as createResource } from "../../test_utils/stubs.js";

export const makeHttpResource = vi.fn<typeof createResource>(createResource);
