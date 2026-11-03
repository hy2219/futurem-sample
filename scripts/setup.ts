import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

const destination = resolve(".env");
if (existsSync(destination)) {
  console.log("기존 .env를 유지합니다. 복사본별 인증값은 재시작 시에도 유지합니다.");
} else {
  const secret = (): string => randomBytes(32).toString("hex");
  const values = {
    APP_CLIENT_ID: randomUUID(),
    APP_CLIENT_SECRET: secret(),
    RESOURCE_TOKEN_KEY: secret(),
    SSO_SESSION_KEY: secret(),
    POSTGRES_PASSWORD: secret(),
    PG_READER_PASSWORD: secret(),
  };
  writeFileSync(destination, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(""), {
    mode: 0o600, flag: "wx",
  });
  console.log("복사본별 인증값을 비공개 .env에 저장했습니다. 앱이나 Azure 리소스는 생성하지 않습니다.");
}
const credentials = parseEnv(readFileSync(destination, "utf8"));
for (const name of ["APP_CLIENT_ID", "APP_CLIENT_SECRET", "RESOURCE_TOKEN_KEY", "SSO_SESSION_KEY", "POSTGRES_PASSWORD", "PG_READER_PASSWORD"]) {
  if (!credentials[name]) throw new Error(`기존 .env에 ${name} 값이 없습니다.`);
}
const mcpConfig = resolve(".vscode/mcp.json");
if (!existsSync(mcpConfig)) {
  mkdirSync(resolve(".vscode"), { recursive: true });
  writeFileSync(mcpConfig, JSON.stringify({
    servers: {
      "external-resources": {
        type: "http",
        url: "http://127.0.0.1:3101/mcp",
        headers: {
          Authorization: `Basic ${Buffer.from(`${credentials.APP_CLIENT_ID}:${credentials.APP_CLIENT_SECRET}`).toString("base64")}`,
        },
      },
    },
  }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  console.log("로컬 Copilot MCP 연결을 .vscode/mcp.json에 저장했습니다. 이 파일은 공유하지 마세요.");
}
console.log("Mock 서버 시작: docker compose up --build -d --wait");
