# 외부 리소스 MCP

루트 `mcp/`가 카탈로그, 앱 인증, 리소스 토큰 발급과 요청 전달을 담당합니다.
Compose 서비스는 `runtime`, 로컬 주소는 `http://localhost:3101/mcp`입니다.
이 MCP는 독립 Mock 시연용 대체물입니다. 이미 구축 중인 POSCO DX 게이트웨이를
재구축/교체하지 않으며 실제 adapter/auth/policy 연결은 별도로 협의합니다.

## 디렉토리로 확장하기

**`external_resources/<이름>/resource.json`을 추가하면 MCP 소스를 수정하지 않아도 도구가 등록됩니다.**

```text
external_resources/
  api_1/resource.json
  api_2/resource.json
  db_1/resource.json
  db_2/resource.json
  api_3/resource.json        새로 추가할 리소스
```

빌드가 정의를 탐색하고 `mcp/dist/resources/registry.json`으로 묶습니다.
서버 시작 시 묶인 정의를 다시 검증하고 동일한 목록으로 `tools/list`와 `tools/call`을 구성합니다.
API 서버도 자신의 `resource.json`에서 도구 설명, 입력 규격, 인증 대상과 경로를 읽습니다.
실행 중인 서버가 파일 변경을 실시간 반영하는 방식은 아니므로 **변경 후 재빌드하고 재시작**합니다.

## HTTP 리소스 예시

`external_resources/api_3/resource.json`:

```json
{
  "version": 1,
  "id": "api_3",
  "type": "http",
  "connection": { "urlEnv": "API_3_URL" },
  "tools": [{
    "name": "get_status",
    "title": "API 3: 상태 조회",
    "description": "준비된 API에서 상태를 조회합니다.",
    "authorization": { "audience": "mock.api_3", "scope": "status:read" },
    "operation": { "method": "GET", "path": "/status" },
    "inputSchema": {
      "type": "object", "additionalProperties": false, "properties": {}
    },
    "outputSchema": {
      "type": "object", "additionalProperties": false, "required": ["status"],
      "properties": { "status": { "type": "string" } }
    }
  }]
}
```

리소스 `id`는 디렉토리 이름과 같아야 하고 도구 `name`은 전체에서 고유해야 합니다.
MCP 서버 환경에 `API_3_URL`을 설정하고 대상 API가 같은 토큰 issuer, audience, scope를 검증하도록 준비합니다.
주소나 비밀값 자체를 정의 파일에 넣지 않습니다.

## 지원하는 어댑터

| `type` | 연결과 호출 |
|---|---|
| `http` | `urlEnv` 주소에 GET 쿼리 또는 POST JSON을 전송하고 Bearer 토큰 전달 |
| `postgres` | `urlEnv` DB에 제한된 계정으로 연결, 지정 View와 columns만 읽음 |
| `mcp` | `urlEnv`의 MCP에 토큰으로 인증하고 `operation.tool` 호출, `structuredContent` 사용 |

PostgreSQL의 `operation`은 `view`, `columns`, `filters`, `orderBy`, `resultKey`,
`limit`, DB 어댑터용 `path`를 정의합니다. 실제 예시는 `db_1/resource.json`, `db_2/resource.json`에 있습니다.
View 존재와 입력 매핑을 확인하고 SQL 식별자는 제한하며 필터값은 매개변수로 전달합니다.
원본 테이블이나 임의 SQL, 쓰기 작업을 허용하지 않습니다.
MCP 응답이 객체 안의 특정 필드에 담겨 있으면 `operation.resultKey`로 그 필드를 지정합니다.
지정하지 않으면 전체 `structuredContent`를 출력 규격으로 검증합니다.

JSON Schema는 object, array, string, number, integer, boolean, null과 enum,
required, 길이/숫자/배열 범위를 지원합니다. 객체는 `properties`와 `additionalProperties: false`가 필수입니다.
외부 `$ref`, 정규식 등 지원하지 않는 키워드는 묵시적으로 무시하지 않고 거부합니다.
GET과 DB의 입력 필드는 스칼라 값이어야 합니다. POST와 MCP 입력은 중첩 객체도 가능합니다.

## 검증과 빌드

```sh
bun install --cwd mcp --frozen-lockfile --ignore-scripts
bun run --cwd mcp build
bun run --cwd mcp test
bun run --cwd mcp test:integration
docker compose up --build -d --wait runtime
bun run --cwd mcp test:container
```

짧은 명령은 `just unit mcp`, `just integration mcp`입니다.
`just integration`은 외부 API와 MCP의 DB 접근/권한 검사까지, `just lint`는 전체 소스 lint를 실행합니다.
`main.ts`, `server.ts`와 대응 Unit은 MCP 루트에 둡니다. `auth/`, `http/`, `protocol/`, `resources/` 하위 모듈에서도
`resources/registry.ts`와 `resources/registry.test.ts`처럼 구현체와 Unit을 나란히 둡니다.
Integration만 별도 `integration/`에 있습니다. `test:integration`은
registry, resource 규격, adapter, server와 SDK를 실제로 연결하고,
`test:container`는 실행 중인 API와 DB 컨테이너까지 확인합니다.
Unit과 Integration은 Vitest 5.0.3으로 소스 테스트를 실행합니다. Unit의 외부 의존성은
실제 export 규격을 유지하는 `__mocks__/` 모듈을 `vi.mock`으로 교체하며, HTTP 전역 경계만
`vi.stubGlobal`을 사용합니다. Faker 데이터는 `test_utils/stubs.ts`에서 생성합니다.
서버 Unit은 실제 registry와 MCP SDK에 준비된 adapter를 연결하여 readiness, 도구 목록과
호출·입출력 오류를 검증합니다. Integration에서는 adapter와 SDK를 교체하지 않습니다.

정의가 없거나 잘못된 규격, 중복 이름, 충돌 경로가 있으면 빌드가 실패합니다.
필수 연결 환경값이 없으면 시작이 실패합니다. 응답이 출력 규격과 다르면 호출도 실패합니다.

MCP Docker는 정의 파일을 가져오기 위해 **저장소 루트를 빌드 context**로 사용합니다:
`docker build -f mcp/Dockerfile .`
이미지에는 MCP 실행 코드와 검증된 정의 묶음만 포함하며 다른 컨테이너의 코드나 의존성을 공유하지 않습니다.
개별 API, DB, 앱, SSO의 독립 빌드 구조는 유지합니다.

**자동 등록은 MCP의 기능입니다.** 새 컨테이너 실행, Compose 서비스와 환경값 추가,
Azure 리소스 생성까지 자동화하지는 않습니다. 대상 서버가 이미 실행 중이면 그 연결 설정만 추가하면 됩니다.
기본 예제는 API 두 개와 DB 두 개만 제공합니다.
실제 다른 MCP를 연결할 때는 `type: "mcp"` 정의를 추가하면 되며, 별도의 데모 MCP 서버는 포함하지 않습니다.
