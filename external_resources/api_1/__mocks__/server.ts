import { createApiEnv as createEnv } from "../test_utils/stubs.js";

export const createApiEnv = vi.fn<typeof createEnv>(createEnv);
