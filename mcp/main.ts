import { createRuntime } from "./server.js";
import { errorCode } from "./http/http.js";

const port = Number(process.env.PORT ?? 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
const instance = createRuntime(process.env);
const server = instance.app.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "listening", service: "external-resources", port }));
});
server.on("error", (error) => { console.error(errorCode(error)); process.exitCode = 1; });
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    server.close(async () => {
      await instance.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
