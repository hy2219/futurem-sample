# 채팅으로 업무 앱 구현

## 필수 개발 스킬

- 기능 구현, 버그 수정, 동작 변경 전에 반드시 [thin-slice-tdd 스킬](skills/thin-slice-tdd/SKILL.md)을 읽고 적용한다. 자동 로드 여부와 관계없이 따르며, 문서만 수정하는 작업은 제외한다.

## 계획과 설계 원칙

- 기능 구상, 계획과 범위 변경 전에 [domain-feature-planning 스킬](skills/domain-feature-planning/SKILL.md)을 읽고 DDD 업무 분석과 INVEST 여섯 기준으로 다음 수직 슬라이스를 합의한다.
- 구현, 버그 수정, 리팩터링과 코드 검토 전반에서 [solid-design 스킬](skills/solid-design/SKILL.md)을 읽고 SOLID의 책임, 계약과 의존성 판단 기준을 적용한다. 불필요한 추상화와 미래 기능은 추가하지 않는다.

## 구현과 연결

- `app/`는 Next.js App Router와 React 기반의 업무 기능 없는 실행 골격이다. 사용자가 업무를 설명하면 입력, 원하는 결과, 완료 기준을 확인하고 부족한 내용을 질문한다. 계획은 채팅에서 확인하며 시나리오 파일을 만들도록 요구하지 않는다.
- `docs/instruction.md`, `docs/architecture.md`, `external_resources/README.md`, MCP 도구 목록을 확인한다. 준비된 리소스로 불가능한 요구는 구현 전에 설명한다.
- 업무 소스, 의존성과 빌드는 `app/` 패키지 안에서 관리한다. Next.js 표준 라우트는 `app/app/`의 `page.tsx`, `layout.tsx`, `route.ts`에 두고 필요한 업무 모듈을 나란히 관리한다. 별도 Node HTTP 서버나 `main.ts` 진입점을 만들지 않는다. `next build`의 standalone 결과와 static asset을 Docker에 포함하고 `build`, `start`, `typecheck`, `test` 스크립트를 유지한다.
- MCP Client Secret, SSO 코드 교환/세션 검증과 리소스 호출은 Server Component/Route Handler의 서버 전용 경계에서만 처리한다. 비밀값에 `NEXT_PUBLIC_`를 붙이거나 Client Component의 props/번들로 넘기지 않는다. 사용자별 페이지와 인증 응답은 정적 생성/공유 캐시하지 않는다.
- Next.js standalone 서버는 `NODE_ENV`를 production으로 바꾸므로 Docker 진입점이 보존한 `APP_RUNTIME_NODE_ENV`를 서버 런타임 설정에서 읽어 로컬 HTTP와 Azure HTTPS 쿠키/Origin 처리를 구분한다. 기본 production의 Secure 쿠키는 유지하고, 브라우저 헤더를 믿어 보안을 낮추지 않는다.
- 의존성 설치와 스크립트 실행에는 `.bun-version`에 고정된 Bun을 사용한다. 각 패키지의 `bun.lock`을 유지하고 npm/Yarn 잠금 파일을 추가하지 않는다. CI와 Docker에서는 `bun install --frozen-lockfile`로 설치한다. 서비스 실행 런타임은 Node.js 24다.
- 앱은 `PORT=8080`, `/health`, `MCP_URL`, `SSO_URL`, `APP_CLIENT_ID`, `APP_CLIENT_SECRET`, `SSO_SESSION_KEY` 환경을 지원한다. 이 복사본의 로컬 공개 포트는 3100이며 MCP/SSO/API는 3101–3104, DB는 15432/15433이다. 원본 템플릿은 변경하지 않으며 클라우드 변경은 운영자가 승인한 대상에서만 수행한다.
- 루트 `mcp/`가 외부 리소스 접근을 담당한다. `external_resources/<이름>/resource.json`이 카탈로그, 입력/출력, 권한과 호출 정의의 원본이다. `mcp/resources/resource.ts`가 공통 규격, 같은 모듈의 `registry.ts`가 자동 탐색, `adapters.ts`가 HTTP/PostgreSQL/MCP 호출을 담당한다.
- 새 리소스는 디렉토리와 규격에 맞는 `resource.json`으로 추가한다. MCP 서버에 리소스별 조건문이나 수동 목록을 추가하지 않는다. 빌드 시 검증/패키징하고 시작 시 자동 등록하며 실시간 파일 변경 감지는 지원하지 않는다. 대상 주소 환경값, Compose 서비스와 Azure 자원은 필요한 경우 별도로 연결한다. API와 DB, SSO는 독립 컨테이너다.
- 앱에서 다른 컨테이너 소스를 import하거나 공통 의존성으로 합치지 않는다. 준비된 Mock 서버의 인증과 데이터를 업무 구현을 위해 변경하지 않는다. 하위 모듈마다 별도 패키지를 만들지 않으며 서비스의 독립 패키지를 유지한다. DB는 `init.sql`, Dockerfile, `resource.json`만 둔다.
- 앱 서버는 HTTP Basic 헤더의 Client ID/Secret으로 MCP를 호출한다. 인증값을 브라우저, URL, 도구 인자, 로그에 노출하지 않는다. MCP는 대상 리소스용 단기 토큰을 발급하며 API나 DB 어댑터가 검증한다.
- `db_1`과 `db_2`는 별도 엔진이며 `demo_reader`로 View만 조회한다. 임의 SQL이나 실제 고객 데이터 연결은 추가하지 않는다.
- 로그인 구현 전 반드시 `sso/README.md`의 요청/응답, 프록시 경로, 오류와 완료 기준을 읽는다. Mock SSO는 앱과 직접 연결하며 MCP를 거치지 않는다. state, PKCE, 단일 사용 코드, 서명된 세션을 검증하고 앱에서 로그아웃을 처리한다. 없는 OAuth 응답 필드나 SSO logout API를 추측해서 추가하지 않는다. 업무 리소스 토큰과 로그인 세션은 별개다.
- `node scripts/setup.ts`는 로컬 `.env`와 `.vscode/mcp.json`만 준비한다. 비밀값, 토큰, Terraform 상태를 커밋하거나 출력하지 않는다.
- `infra-setup`은 로컬 전용 최초 준비 명령이다. `scripts/infra-setup.ts`에서 로컬 Terraform과 실제 이미지 빌드/push, Azure/OIDC와 GitHub Variables 설정을 처리한다. `infra-update`는 비공개 변수 파일로 apply만 수행하고 기본 승인을 유지한다. Terraform state는 로컬 `.state/`에 보관하고 비공개 변수와 함께 안전하게 백업한다. 실행 중 추적 파일/잠금 파일은 변경하지 않는다.
- Actions에서는 Terraform을 실행하지 않는다. OIDC 인증 후 기존 ACR에 이미지를 push하고 기존 ACA 이미지만 업데이트한다. 앱 비밀값/state/Blob/사설 runner는 필요 없다. 앱 비밀값은 로컬 비공개 변수/state와 ACA Secrets에 관리하고 GitHub Secrets에 추가하지 않는다. 기존 클라우드 저장소와 과거 state는 자동 삭제하거나 backend를 강제 마이그레이션하지 않는다. 이미지 소유권은 Actions에 있으므로 로컬 apply가 배포된 이미지를 되돌리지 않게 한다.
- Azure는 frontend(App/SSO), MCP, resources(API/DB) 환경/서브넷을 분리하고 NSG로 frontend→resources 직접 연결을 차단한다. 서로 다른 환경은 내부 FQDN과 Private DNS로 연결한다. 기본 플랫폼 통신과 인증을 보존하고 VNet 없는 기존 환경은 자동 교체하지 않는다. 계획/코드 확인을 실제 Azure 연결 차단 검증으로 대신하지 않는다.
- 아래 브랜치 전략은 템플릿에서 만든 데모/업무 앱 저장소에 적용한다. 원본 `hy2219/simplified-sdlc` 유지보수는 사용자 지시에 따라 main에 직접 반영하며 원본에 보호 ruleset을 적용하거나 PR을 만들지 않는다.
- 복사본의 작업은 `feature/...` 또는 `fix/...` 브랜치에서 하고 main에 직접 push/force push하지 않는다. PR의 `ci` 성공과 대화 해결 후 main으로 merge한다. `scripts/repository-setup.ts`가 main의 PR 필수/필수 ci/force push 및 삭제 금지/no-bypass ruleset을 적용하며 템플릿 복사만으로 보호 설정이 복제되지는 않는다. 비공개 저장소 요금제나 권한이 지원하지 않으면 중단하고 보고한다. 규칙을 약화하거나 저장소를 공개하지 않는다.
- main 대상 PR의 CI와 필수 `ci` gate는 `.github/workflows/ci.yml`이 정의한다. main merge 후 CD가 같은 검사를 다시 실행하고 OIDC로 기존 ACA 이미지만 자동 업데이트한다. PR에는 Azure 배포 권한을 주지 않으며 검사 실패 시 배포하지 않는다. `workflow_dispatch`는 운영자의 재배포/복구용으로만 남긴다.
- `docker-compose.yml`은 하나만 유지한다. 공통 명령 진입점은 `justfile`이며 각 모듈의 `package.json` 스크립트를 직접 호출하고 별도 범용 실행기를 만들지 않는다. 루트 `package.json`과 `bun.lock`은 공통 개발 도구만 관리하고 서비스별 패키지는 독립적으로 유지한다. `scripts/`에는 초기 설정 스크립트와 대응 검사만 둔다.
- 모든 계정과 데이터는 실습용이다. 회사 SSO나 운영용 DB로 설명하지 않는다.

## 공통 UI 필수 사용

- 화면 구현 전 `https://github.com/hy2219/custom-ui`의 앱에 고정된 승인 버전 문서와 Storybook을 확인하고, 그 버전이 제공하는 컴포넌트와 변형만 사용한다.
- Next.js 화면은 `@hy2219/custom-ui/react`의 정식 React 컴포넌트를 사용한다. HTML 문자열 렌더러를 `dangerouslySetInnerHTML`로 삽입하거나 앱에서 React 래퍼를 만들어 대체하지 않는다. 기본 승인 버전은 `0.2.0`이며, 이전 고정 버전 소비 앱을 임의로 올리지 않는다.
- `app/`에서 새 UI 컴포넌트를 절대 만들지 않는다. HTML/JSX/CSS로 직접 구현하거나 라이브러리 코드를 복사하거나 다른 UI 라이브러리로 대체해 우회하지 않는다. 앱은 제공된 컴포넌트의 조합, 업무 데이터 연결과 페이지 배치만 담당한다.
- 필요한 컴포넌트, 변형 또는 상태가 없으면 해당 UI 구현을 즉시 중단하고 사용자에게 **"공통 UI 라이브러리의 승인된 버전에 [필요한 UI]가 없어 현재 요청한 화면을 구현할 수 없습니다."**라고 알린다. 무엇이 없는지 설명하고 공통 라이브러리에 먼저 추가하도록 요청한다. 임시 UI를 만들거나 임의로 라이브러리를 수정/업그레이드하지 않는다. 승인된 릴리스에 필요한 UI가 제공되고 버전 사용 승인을 받은 뒤에만 재개한다.
- 설치와 버전 고정은 `docs/instruction.md`의 **조직 공통 UI 사용** 절차를 따른다. 문서/패키지 접근 실패도 임의 대체하지 말고 사용자에게 알린 뒤 중단한다.
