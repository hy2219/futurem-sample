# 준비된 외부 리소스

## 시연용 리소스 한눈에 보기

제조 IT 업무를 가정한 **API 2개와 DB 2개**입니다. 모든 업무 데이터는 합성이며 실제 고객 시스템이나 자료를 사용하지 않습니다.

| 구분 | 준비된 업무 데이터 | 주요 조회 항목 | MCP 도구 |
|---|---|---|---|
| **DB 1 — IT 자산** (`db_1`) | 품질분석·생산실적·창고관리·품질분석 보조 시스템 **4개** | 자산 ID, 시스템명, 사업장, 운영 상태, 중요도, 담당팀 ID | `list_it_assets` |
| **DB 2 — 변경 요청** (`db_2`) | 자산별 변경 요청 **4건** | 변경 ID, 대상 자산, 담당팀, 제목, 요청·승인·완료 상태, 위험도, 계획일 | `list_change_requests` |
| **API 1 — 유지보수 일정** (`api_1`) | 자산별 고정 점검 일정 **3건** | 일정 ID, 대상 자산, 시작·종료 시각, 업무 영향, 일정 상태 | `list_maintenance_windows` |
| **API 2 — 담당팀** (`api_2`) | 가상 품질정보·생산정보·자재물류 **3개 팀** | 팀 ID, 팀명, 가상 연락처, 지원시간 | `list_responsible_teams` |

건수는 현재 소스에 준비된 초기 합성 데이터 기준입니다.
`asset_id`로 자산·변경 요청·점검 일정을 연결하고, `team_id`로 담당팀을 연결합니다.
예를 들어 AST-002를 선택하면 생산실적 시스템, CHG-002 변경 요청, MW-002 점검 일정과 가상 생산정보팀을 함께 조회할 수 있습니다.

여기서 **Mock은 실제 회사 시스템 대신 만든 실습용 시스템**이라는 뜻입니다.
API는 실제 HTTP 서버, DB는 실제 PostgreSQL이며 앱은 MCP를 거쳐 실제로 조회합니다. 단위 테스트에서 사용하는 가짜 응답과는 다릅니다.
현재는 **조회만 지원**하며 변경 요청 생성·승인·수정 기능은 없습니다.
별도로 [Mock SSO](../sso/README.md)가 데모 로그인(`demo` / `demo1234`)을 제공합니다. SSO는 MCP를 거치지 않고 앱과 직접 연결됩니다.

## MCP 호출과 연결

각 API와 DB는 **독립 컨테이너**이며 루트 `mcp/`가 연결합니다. `external_resources/` 자체에는 패키지 설정이 없습니다.

각 리소스의 `resource.json`을 MCP 빌드와 시작 시 자동 탐색합니다.
도구 설명, 입력/출력 규격, 연결 환경변수, 토큰 권한을 정의하면 수동 등록 목록은 필요하지 않습니다.
[새 리소스 정의 방법](../mcp/README.md)

| 위치 | MCP 도구 | 입력 예시 | 결과 / 로컬 포트 |
|---|---|---|---|
| `api_1` | `list_maintenance_windows` | `{"asset_id":"AST-001"}` | `maintenance_windows` / 3103 |
| `api_2` | `list_responsible_teams` | `{"team_id":"TEAM-QUALITY"}` | `teams` / 3104 |
| `db_1` | `list_it_assets` | `{"status":"maintenance"}` | `assets` / 15432 |
| `db_2` | `list_change_requests` | `{"asset_id":"AST-001"}` | `change_requests` / 15433 |

`{}`로 전체 조회합니다. API는 각 `resources/resource.ts`에 고정 샘플을,
DB는 각 `init.sql`에 스키마, 샘플 데이터와 제한된 View를 정의합니다.
MCP가 발급한 토큰이 유효해야 호출할 수 있으며 DB는 토큰 검증 후 `demo_reader`로 View만 읽습니다.

DB View는 각각 `workshop.asset_summary`, `workshop.change_request_summary`입니다.
출력 필드/필터/열 매핑은 각 `resource.json`이 단일 원본이며 전체 카탈로그는 빌드 시 자동 생성합니다.
`asset_id`로 자산·변경·일정을, 자산의 `team_id`로 담당팀을 연결합니다.
서로 다른 DB이므로 DB 간 FK는 없고 `e2e/resources.test.ts`가 전체 조인 정합성을 검사합니다.
AST-001(가상 품질분석), AST-002(가상 생산실적), AST-003(가상 창고관리),
AST-004(가상 품질분석 보조) 4개이며 담당팀은 3개입니다.
AST-004에는 변경/일정이 없어 정상 빈 결과를 시연합니다.
알 수 없는 ID도 빈 결과이며 잘못된 enum/추가 인자는 오류입니다.
모든 데이터는 합성이며 example.com 연락처는 실사용하지 않습니다. 일정은 고정 시연용 KST입니다.

```sh
node scripts/setup.ts
docker compose up --build -d --wait
```

## 패키지와 테스트

처음에는 `just install`을 실행합니다. `just unit resources`와
`just integration resources`는 외부 API 테스트만 선택합니다.
MCP까지 함께 실행하려면 기본값인 `just unit`, `just integration`을 사용합니다.
통합 명령은 컨테이너를 자동으로 시작하며 종료하거나 DB 볼륨을 삭제하지 않습니다.
정리는 `just down`, 전체 소스 lint는 `just lint`입니다.

앱, MCP, SSO, 두 API는 각각 독립 `package.json`, `bun.lock`, `tsconfig.json`, `Dockerfile`을 갖습니다.
JS/TS의 `main.ts`, `server.ts`와 대응 Unit은 각 모듈 루트에 둡니다.
`auth/`, `resources/` 등 필요한 하위 모듈에서도 구현체와 `*.test.ts`를 같은 디렉토리에 둡니다.
Integration이 필요한 서비스만 별도 `integration/`을 둡니다.
DB는 Node.js가 아니므로 다음 세 파일만 둡니다.

```text
db_1/ 또는 db_2/
  Dockerfile       postgres:17-bookworm 기반 이미지
  init.sql         스키마, 데이터, View와 조회 권한
  resource.json    MCP 연결 정의
```

PostgreSQL 공식 이미지가 `/docker-entrypoint-initdb.d/init.sql`을 빈 데이터 저장소의
최초 시작 시 실행합니다. 빌드할 때 데이터를 생성하지 않으며 기존 볼륨에는 다시 적용하지 않습니다.
`init.sql`은 psql의 `\getenv`로 `PG_READER_PASSWORD`를 읽으므로 비밀번호를 소스에 적지 않습니다.

```sh
bun install --cwd external_resources/api_1 --frozen-lockfile --ignore-scripts
bun run --cwd external_resources/api_1 test
bun run --cwd external_resources/api_1 test:container
```

`api_2`, `mcp`, `sso`도 같은 명령을 각 경로에서 사용합니다.
`app`은 현재 Unit으로 골격을 검사하며 통합 스크립트는 필요한 업무 연동이 생길 때만 추가합니다.
API의 `resources/resource.test.ts` 등 구현체 옆의 파일은 Unit, `integration/integration.test.ts`는 실제 HTTP와 토큰 검사를 담당합니다.
MCP 통합 검사는 API 연결과 두 DB의 View 접근 및 격리도 확인합니다.
실제 lint 도구는 루트 `package.json`에서 관리하는 Biome이며 서비스 실행 의존성이 아닙니다.
기본 문법/중복 키/도달 불가능 코드/debugger/명시적 any를 검사하며 포맷을 강제로 바꾸지 않습니다.

DB 테스트는 중복 디렉토리 없이 `mcp/integration/container.integration.test.ts`에서 데이터 반환,
View 전용 조회, 원본 테이블/쓰기 거부, 두 DB 격리와 토큰 검증을 확인합니다.
`just integration mcp` 또는 `just integration`으로 실행합니다.
초기화하려면 `docker compose down -v` 후 재시작합니다. **이 명령은 해당 실습 DB 데이터를 삭제합니다.**
