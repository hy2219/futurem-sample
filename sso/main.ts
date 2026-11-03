import { createServer } from "node:http";
import { createSso } from "./server.js";

function main(): void {
  const portText = process.env.PORT ?? "8080";
  if (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) {
    throw new Error("Invalid PORT");
  }
  const service = createSso(process.env);
  const server = createServer(service.app);
  server.on("error", () => {
    console.error("Mock SSO failed to listen");
    process.exitCode = 1;
  });
  server.listen(Number(portText), "0.0.0.0");
  const shutdown = () => {
    server.close(() => { void service.close(); });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

try {
  main();
} catch {
  console.error("Mock SSO startup failed: check APP_CLIENT_ID, SSO_SESSION_KEY, and PORT");
  process.exitCode = 1;
}
