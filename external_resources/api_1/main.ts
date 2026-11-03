import { createApi } from "./server.js";

try {
  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535");
  const server = createApi(process.env).listen(port, "0.0.0.0", () => {
    console.log(`API 1 listening on port ${port}`);
  });
  server.on("error", () => { console.error("API 1 failed to listen"); process.exitCode = 1; });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => { server.close(() => { process.exitCode = 0; }); });
  }
} catch {
  console.error("API 1 startup failed: check APP_CLIENT_ID, RESOURCE_TOKEN_KEY and PORT");
  process.exitCode = 1;
}
