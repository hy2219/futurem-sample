set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

default:
    @just --list

# 모든 독립 패키지와 lint 도구 설치
install:
    bun install --frozen-lockfile --ignore-scripts
    bun install --cwd app --frozen-lockfile --ignore-scripts
    bun install --cwd mcp --frozen-lockfile --ignore-scripts
    bun install --cwd sso --frozen-lockfile --ignore-scripts
    bun install --cwd external_resources/api_1 --frozen-lockfile --ignore-scripts
    bun install --cwd external_resources/api_2 --frozen-lockfile --ignore-scripts

# 복사본별 인증값과 MCP 연결 준비
setup:
    node scripts/setup.ts

# 로컬 state로 기반 생성 → 7개 이미지 빌드/push → 전체 앱 생성
infra-setup config="infra/setup.local.json":
    node scripts/infra-setup.ts {{ quote(config) }}

# 준비된 로컬 state/비공개 변수로 apply만 실행 (기본 승인 유지)
infra-update:
    terraform -chdir=infra apply -var-file=deployment.auto.tfvars.json

# 컨테이너 빌드와 시작
up: setup
    docker compose up --build -d --wait --wait-timeout 240

# 컨테이너 중지 (DB 볼륨 유지)
down:
    docker compose down

# 전체 소스 lint (파일 수정 없음)
lint:
    bun run lint

# 타입 검사: external / resources / mcp / app / sso / all
typecheck scope="external": (_run scope "typecheck")

# 단위 테스트 (기본 MCP + 외부 API)
unit scope="external": (_run scope "test")

# 정의된 통합 검사만 실행 (파일/스크립트는 필요할 때만 추가)
integration scope="external": up (_run scope "test:integration") && (_run scope "test:container")

# 루트 e2e/ 실행. 먼저 just up 필요, 빈 테스트 디렉토리는 실패
e2e:
    node --input-type=module -e "import { globSync, statSync } from 'node:fs'; if (!Array.from(globSync('e2e/**/*.test.ts')).some(path => statSync(path).isFile() && statSync(path).size > 0)) throw new Error('Add a real feature test to e2e/*.test.ts before running E2E.');"
    node --env-file=.env --test "e2e/**/*.test.ts"

# 단위 및 통합 검사
test scope="external": (unit scope) && (integration scope)

# 기반 검사 (업무 E2E와 별개)
check scope="external": lint (typecheck scope) (unit scope) && (integration scope)

# 피처 완료 검사
accept: (check "all") && e2e

_run scope task:
    @just {{ if scope =~ "^(external|resources|mcp|app|sso|all)$" { "_" + scope } else { error("Unknown scope: " + scope) } }} {{ quote(task) }}

_package package task:
    bun run --cwd {{ quote(package) }} {{ if task =~ "^test:(integration|container)$" { "--if-present" } else { "" } }} {{ quote(task) }}

_resources task: (_package "external_resources/api_1" task) (_package "external_resources/api_2" task)

_mcp task: (_package "mcp" task)

_app task: (_package "app" task)

_sso task: (_package "sso" task)

_external task: (_mcp task) (_resources task)

_all task: (_external task) (_app task) (_sso task)
