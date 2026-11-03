# 템플릿으로 업무 앱을 만드는 단계별 가이드

**저장소 복사 → 운영자 보호 규칙/인프라 준비 → 작업 브랜치 → 업무 설명과 구현 → PR → CI → main Merge → 자동 CD**

이 문서는 특정 업무 시나리오를 포함하지 않습니다. 만들 업무와 완료 기준은 Copilot 채팅에서 설명합니다.
아래 브랜치 보호와 PR 절차는 **템플릿에서 생성한 데모/업무 앱 저장소**에 적용합니다.
원본 템플릿 `hy2219/simplified-sdlc`의 유지보수는 사용자의 지시에 따라 main에 직접 반영하며, 원본에 이 보호 규칙을 적용하지 않습니다.
운영자는 GitHub 보호 규칙과 최초 Azure 환경을 준비하고, 참가자는 준비된 리소스를 사용해 앱을 구현합니다.
로컬 개발만 한다면 Azure 관련 단계는 생략하지만 GitHub PR 절차는 유지합니다.

## 1. 실행 환경과 권한 확인

모든 명령은 복사한 저장소의 최상위 폴더에서 실행합니다.
macOS/Linux 터미널 또는 Windows의 WSL에서 아래 도구를 확인합니다.
클라우드 초기화는 Windows PowerShell이 아니라 WSL과 그 안에 설치한 native CLI를 사용합니다.

| 도구 | 확인 명령 | 필요한 버전/용도 |
| --- | --- | --- |
| Git | `git --version` | 저장소 복제와 작업 브랜치 |
| Node.js | `node --version` | 24 이상, CI/컨테이너는 24 |
| Bun | `bun --version` | `.bun-version`과 동일한 1.4.2 |
| Just | `just --version` | 개발/CI 공통 명령, CI는 1.58.0 |
| Docker Desktop/Engine | `docker info` | 로컬 API/DB/SSO/MCP/앱 실행 |
| Docker Compose | `docker compose version` | Compose v2 |
| GitHub CLI | `gh --version` | 저장소 설정, PR과 실행 상태 조회 |
| Azure CLI | `az version` | Azure를 사용할 운영자만 |
| Terraform | `terraform version` | Azure를 사용할 운영자만, 1.5 이상 |

버전 확인이 실패하면 해당 도구를 설치한 후 진행합니다.
Docker Desktop은 켜져 있는 것뿐 아니라 `docker info`가 성공해야 합니다.
VS Code와 GitHub Copilot 확장, Copilot 사용 권한도 준비합니다.
도구 설치에는 해당 제품의 공식 설치 안내를 사용합니다.

**브랜치 보호 권한과 요금제는 필수입니다.**
비공개 개인 저장소에는 GitHub Pro, 비공개 조직 저장소에는 보호 규칙을 지원하는 GitHub Team/Enterprise와 repository admin 권한이 필요합니다.
지원하지 않는 요금제라면 아래 보호 설정은 HTTP 403 등으로 중단됩니다.
이 경우 비용/공개 범위 변경은 운영자가 결정해야 하며, 보호 없이 진행하거나 저장소를 임의로 공개하지 않습니다.
Codespaces, Copilot과 Azure 사용 비용은 별도입니다.

## 2. 템플릿에서 내 저장소 만들기

1. 원본 템플릿의 GitHub 화면에서 **Use this template → Create a new repository**를 선택합니다.
2. 본인 또는 실습 조직을 Owner로 지정하고 저장소 이름을 입력합니다.
3. 데이터/소스 공개 정책에 맞는 Visibility를 선택합니다. 비공개 사용 시 1단계의 보호 지원 요금제를 확인합니다.
4. 생성이 끝나면 **Code**에서 clone URL을 복사합니다.
5. 터미널에서 복제하고 해당 디렉토리로 이동한 뒤 VS Code에서 엽니다.

```sh
git clone <복사한-저장소의-clone-URL>
cd <복사한-저장소-디렉토리>
git remote -v
git branch --show-current
```

`<...>`는 실제 값으로 바꿉니다. remote는 원본 템플릿이 아니라 **내 복사본**이어야 하고 기본 브랜치는 `main`이어야 합니다.
원본에 수정 사항을 push하지 않습니다.
템플릿의 파일은 복사되지만 GitHub ruleset, Azure 리소스, OIDC, Variables, Secrets 설정은 복사되지 않습니다.

## 3. 운영자가 main 보호 규칙 적용

GitHub CLI에 로그인하고 권한을 확인합니다.

```sh
gh auth login
gh auth status
node scripts/repository-setup.ts OWNER/REPOSITORY
```

`OWNER/REPOSITORY`는 2단계에서 만든 실제 저장소입니다.
이 스크립트는 `simplified-sdlc-main`이라는 활성 ruleset을 생성하고 GitHub에서 다시 읽어 확인합니다.

| 적용 규칙 | 결과 |
| --- | --- |
| main 변경은 PR 필수 | 작업 브랜치에서 push한 뒤 PR로 merge |
| GitHub Actions의 `ci` 성공 필수 | Unit, Integration, E2E 중 하나라도 실패/취소/생략되면 merge 불가 |
| 최신 main 반영 필수 | 다른 PR이 먼저 merge되면 브랜치를 최신화하고 CI 재실행 |
| PR 대화 해결 필수 | 미해결 review 대화를 해결한 뒤 merge |
| force push와 main 삭제 금지 | main 이력 덮어쓰기와 삭제 방지 |
| bypass actor 없음 | 관리자 계정에도 일반적인 직접 push 예외를 주지 않음 |

개인 실습에서도 PR은 필수지만 별도 검토자 계정은 강제하지 않습니다(필수 승인 수 0).
조직이 기존에 더 강한 검토/보호 정책을 사용하면 이를 약화하지 않습니다.
저장소 정책을 수정할 권한이 있는 관리자가 규칙 자체를 바꾸는 것까지 막는 기능은 아닙니다.

GitHub의 **Settings → Rules → Rulesets → simplified-sdlc-main**에서 적용 상태를 확인합니다.
권한/요금제/기존 규칙 불일치 오류가 나오면 **여기서 중단**하고 운영자가 해결합니다.
스크립트가 실패했는데 직접 push가 차단됐다고 간주하지 않습니다.
설정 직후 필수 `ci`가 아직 실행 이력에 없어도 정상이며, 첫 PR에서 실행됩니다.

## 4. 운영자가 최초 Azure 인프라 준비

Azure 배포를 하지 않는 로컬 전용 실습이면 이 단계는 생략합니다.
상세 리소스/권한은 [Azure 안내](../infra/README.md)를 함께 확인합니다.

운영자는 전용 리소스 그룹 관리, Entra 애플리케이션/OIDC와 역할 할당 권한이 있어야 합니다.
구독의 `Microsoft.App`, `Microsoft.ContainerRegistry`, `Microsoft.OperationalInsights`,
`Microsoft.ManagedIdentity`, `Microsoft.Network` provider는 관리자가 미리 등록해야 합니다. 초기화가 조직 정책을 해제하지는 않습니다.

```sh
az login
az account list --query "[].{name:name,id:id}" -o table
az account set --subscription <대상-구독-ID>
az account show --query "{subscription:id,tenant:tenantId}" -o json
```

VS Code에서 `infra/setup.example.json`을 같은 디렉토리의 `setup.local.json`으로 복사합니다.
다음 필드를 실제 환경에 맞게 입력합니다.

| 필드 | 입력 |
| --- | --- |
| `subscriptionId` | 위에서 선택한 실제 Azure 구독 UUID |
| `repository` | 복사본의 실제 `OWNER/REPOSITORY` |
| `resourceGroup` | 해당 복사본 전용 리소스 그룹 이름 |
| `resourcePrefix` | 해당 환경의 고유한 소문자 prefix |
| `location` | 사용할 지역, 예제 기본값은 `koreacentral` |
| `deploymentClientId` | 기존에 검토된 배포 ID를 재사용할 때만 선택적으로 입력 |

기존 리소스 그룹은 소유권 태그가 일치해야 하며 다른 프로젝트 리소스를 가져오지 않습니다.
`initializeFreshEnvironment`는 일반 신규 사용자가 추가할 값이 아닙니다. 과거 미사용 GitHub 비밀값만 남은 미배포 환경을 검토한 운영자만 Azure 안내에 따라 사용합니다.

```sh
just infra-setup
```

정확한 명령 이름은 `infra-init`이 아니라 **`infra-setup`**입니다.
이 명령은 보호 규칙을 재확인하고, 로컬 Terraform으로 기반 리소스를 만든 뒤 ACR Tasks에서 7개 이미지를 빌드하여 전체 컨테이너를 배포합니다.
최초 이미지 빌드는 별도 Node helper가 native Azure CLI 프로세스를 최대 3개씩 병렬 실행하며 완료 JSON의 유효한 실행 ID와 `Succeeded`를 확인합니다.
ACR 빌드 제한은 30분, 각 로컬 프로세스 제한은 35분입니다. 7개 모두 성공해야 앱을 생성하며 실패한 묶음도 시작한 프로세스는 모두 기다립니다.
실패/취소/시간 초과/빈 응답은 배포 실패로 처리하고 다음 묶음을 시작하지 않습니다. 출력은 노출하지 않으므로 재시도 전 ACR Tasks를 확인합니다.
로컬 Docker 없이도 이 최초 클라우드 빌드는 가능하지만, 다음 로컬 개발 단계에는 Docker가 필요합니다.
앱은 아직 업무 기능이 없는 골격이며 이 단계에서 로그인이나 업무 화면을 자동 생성하지 않습니다.
GitHub의 `demo` 배포 환경/main 정책, OIDC 신뢰와 배포용 Variables도 준비됩니다.
Azure에서는 VNet과 전용 서브넷/NSG 3개, frontend/MCP/resources ACA 환경을 분리합니다.
환경마다 Azure 관리 Load Balancer/IP 비용이 추가될 수 있습니다.
기존 VNet 없는 단일 환경은 자동 교체하지 않으며, 해당 state가 있으면 운영자가 별도 이전 계획을 검토해야 합니다.

| 비공개 파일 | 보관하는 내용 |
| --- | --- |
| `infra/setup.local.json` | 대상 구독/저장소/리소스 그룹 설정 |
| `infra/deployment.auto.tfvars.json` | 클라우드 런타임 값, 대상 ID와 최초 이미지 SHA |
| `infra/.state/` | 런타임 비밀값이 포함될 수 있는 local state, backup과 계획 |

이 파일들은 Git/Docker에서 제외하고 **state와 변수 파일을 함께 암호화된 개인 백업**에 보관합니다.
앱 비밀값은 이 로컬 파일/state와 필요한 ACA Secrets에 있으며 GitHub Secrets에는 새로 등록하지 않습니다.
로컬 개발용 `.env`를 클라우드 비밀값으로 재사용하지 않습니다.
Terraform은 Actions에서 실행하지 않으며, 이후 인프라를 바꿀 때만 운영자가 `just infra-update`를 실행합니다.
일반 앱 기능 수정에는 `infra-setup` 재실행이나 Terraform 변경이 필요 없습니다.
실패하면 기존 state/변수를 보존하고 같은 소스로 원인을 해결해 재개합니다. 파일을 지우고 새 환경처럼 재생성하지 않습니다.

## 5. 작업 브랜치와 로컬 실행 준비

main을 최신화한 뒤 이번 작업용 브랜치를 만듭니다.

```sh
git switch main
git pull --ff-only
git switch -c feature/my-work
just install
just up
```

`feature/my-work`는 작업에 맞는 새 이름으로 바꿉니다. 버그 수정은 `fix/...`처럼 구분해도 됩니다.
main에서 직접 코딩/commit/push하지 않습니다.
`just install`은 고정된 Bun lockfile로 독립 패키지의 의존성을 설치합니다.
`just up`은 로컬용 `just setup`을 호출한 뒤 실제 컨테이너를 빌드하고 실행합니다.

| 자동 생성 파일 | 용도 |
| --- | --- |
| `.env` | 복사본별 Client ID/Secret, 서명키, DB 비밀번호와 로컬 포트 |
| `.vscode/mcp.json` | Copilot이 로컬 MCP를 호출할 주소와 인증값 |

기존 파일이 있으면 재사용합니다. 앱 구현이나 Azure 배포를 하는 스크립트는 아닙니다.
두 파일과 토큰, state는 공유하거나 commit하지 않습니다.
`just up`이 실패하면 Docker 상태, 포트 충돌과 컨테이너 로그를 확인하고 성공한 것으로 넘기지 않습니다.

Codespaces/Dev Containers는 초기 설치와 컨테이너 준비를 자동 수행할 수 있습니다.
자동 준비가 끝났다면 같은 명령을 불필요하게 반복하지 말고 결과를 확인합니다.
전달 포트는 비공개로 유지하고, 클라우드 state는 다른 컴퓨터에서 새로 만들지 않습니다.

## 6. 실행 상태와 MCP 연결 확인

1. 로컬 브라우저에서 **http://localhost:3100**을 엽니다. 템플릿에서는 업무 기능이 아직 없다는 안내가 정상입니다.
2. Codespaces라면 **Ports** 탭의 3100번 전달 주소를 사용합니다.
3. VS Code의 Copilot을 **에이전트 모드**로 엽니다.
4. 연결된 MCP의 기능 목록을 설명해 달라고 요청하고 **external-resources** 사용을 승인합니다.
5. 목록이 없으면 VS Code의 **MCP: List Servers**에서 서버 상태를 확인합니다.

기본 MCP 주소는 `http://localhost:3101/mcp`이며 일반 웹 화면이 아닙니다.
고객, 주문, 제품과 재고 조회 리소스가 준비되어 있습니다. 자세한 계약은 [리소스 안내](../external_resources/README.md)에 있습니다.
도구가 보이지 않거나 인증에 실패하면 업무 구현 전에 연결부터 해결합니다.

클라우드는 App/SSO, MCP, 외부 리소스를 서로 다른 ACA 환경/서브넷에 배치합니다.
앱만 인터넷에 공개하고 NSG는 App 영역에서 API/DB 영역으로 직접 연결하는 것을 차단하도록 정의합니다.
MCP 영역에서 필요한 리소스 포트로만 접근하도록 허용하며 인증, 리소스별 토큰과 DB View 최소 권한도 유지합니다.
실제 배포 후 연결 차단과 정상 MCP 경로를 확인해야 합니다. 로컬 Docker는 이 Azure 네트워크 격리를 재현하지 않습니다.
앱 서버는 MCP를 통해 업무 리소스를 호출하고 Mock SSO에는 직접 연결합니다.
브라우저에 MCP Client Secret이나 DB 연결 정보를 전달하지 않습니다.

## 7. Copilot에 업무 설명하고 얇은 단위로 구현

별도 시나리오/YAML 파일을 만들 필요는 없습니다. 채팅에서 다음 내용을 설명합니다.

| 설명할 것 | 내용 |
| --- | --- |
| 사용자와 목표 | 누가 어떤 일을 완료하려는지 |
| 입력 | 사용할 리소스와 사용자가 입력/선택할 값 |
| 결과 | 화면이나 출력으로 보여야 할 것 |
| 완료 기준 | 성공과 실패를 사용자가 구별할 구체적인 조건 |
| 범위 | 이번에 하지 않을 기능 |

부족한 내용은 질문하게 하고 구현 계획을 채팅에서 확인한 뒤 진행합니다.
`app/`에 구현하고 준비된 MCP/SSO 계약을 따르도록 요청합니다.
준비된 리소스에 없는 데이터/기능은 에이전트가 임의로 있다고 가정하지 않게 합니다.
리소스 인증이나 DB 권한을 앱 구현 편의를 위해 약화하지 않습니다.

### DDD 기반 계획

계획은 **DDD(Domain-Driven Design)**를 바탕으로 기술 구성보다 업무의 의미와 규칙에서 시작합니다.
에이전트는 [domain-feature-planning 스킬](../.github/skills/domain-feature-planning/SKILL.md)을 사용해 공통 업무 언어, 규칙과 책임 경계를 확인합니다.
계획은 채팅에서 합의하며 현재 요구에 필요한 모델만 선택합니다. DDD라는 이유로 새 마이크로서비스나 계층을 기본 추가하지 않습니다.

### INVEST 기반 기능 구상

같은 스킬에서 **Independent, Negotiable, Valuable, Estimable, Small, Testable** 각각을 근거와 함께 판정합니다.
질문 목록, 보완 방법과 계획 출력 형식은 스킬에 모아 두었습니다.
에이전트는 사용자 가치, 성공/실패 완료 기준, 의존성과 불확실성을 설명하고 가장 작은 다음 결과를 합의합니다.
가치나 완료 기준이 불명확하면 구현하지 않고 질문합니다.

### SOLID 기반 구현

구현, 수정, 리팩터링과 코드 검토에는 [solid-design 스킬](../.github/skills/solid-design/SKILL.md)을 적용합니다.
책임, 확장, 대체 가능한 동작 계약, 작은 계약과 의존 방향을 구체적인 변경 위치에 연결해 판단합니다.
원칙별 위반 신호, 최소 수정과 오용 방지 기준은 스킬에 모았습니다. 불필요한 추상화를 늘리지 않으며 기존 UI와 보안 계약도 유지합니다.

### 조직 공통 UI 사용

화면을 만들기 전에 [custom-ui](https://github.com/hy2219/custom-ui)의 **사용할 릴리스 버전**과 Storybook을 확인합니다.
**앱에서 새 UI 컴포넌트를 만드는 것은 금지합니다.** Button, Input, Label 등을 포함해 화면에 필요한 UI는 고정된 승인 버전의 공통 패키지가 제공하는 컴포넌트로만 구성합니다.
Button은 Primary/Secondary/Tertiary/Danger와 승인된 크기/상태를 선택하고, 앱에서는 업무 데이터와 배치만 구현합니다.
필요한 컴포넌트, 변형 또는 상태가 없으면 에이전트는 해당 UI 구현을 중단하고 다음과 같이 사용자에게 알립니다.

> 공통 UI 라이브러리의 승인된 버전에 [필요한 UI]가 없어 현재 요청한 화면을 구현할 수 없습니다.

부족한 항목을 구체적으로 설명하고 공통 라이브러리에 먼저 추가하도록 요청합니다.
HTML/JSX/CSS 직접 구현, 소스 복사, 다른 라이브러리나 임시 UI로 대체하는 우회는 허용하지 않습니다.
에이전트가 임의로 공통 라이브러리를 수정하거나 버전을 올려서도 안 됩니다.
UI 담당자가 공통 라이브러리에 추가해 릴리스하고 해당 버전 사용이 승인된 뒤에만 앱 구현을 재개합니다.

Next.js 앱의 기준 버전은 정식 React 컴포넌트를 제공하는 **`@hy2219/custom-ui` `0.2.0`**입니다. `latest`, `^0.2.0`, `main` 같은 변경 가능한 참조로 설치하지 않습니다.
화면은 `@hy2219/custom-ui/react`에서 컴포넌트를 import하고 공통 CSS를 사용합니다. 이전 HTML 문자열 렌더러를 React에 삽입하는 래퍼를 앱에서 만들지 않습니다.
템플릿은 검증된 기준 패키지를 이미 포함합니다. 파일이 있으면 다시 내려받아 덮어쓰지 않고 버전과 체크섬만 확인합니다.
비공개 예제는 배포 중 다른 저장소를 인증할 필요가 없도록 승인된 릴리스 tgz와 체크섬을 작업 브랜치에 포함하는 방식을 사용합니다.
운영자는 라이브러리 읽기 권한이 있는 GitHub 계정으로 다음을 수행합니다.

```sh
gh release view v0.2.0 --repo hy2219/custom-ui
gh release download v0.2.0 --repo hy2219/custom-ui --pattern hy2219-custom-ui-0.2.0.tgz --pattern SHA256SUMS --dir app/vendor
```

`SHA256SUMS`에 기록된 패키지 SHA-256과 내려받은 파일을 대조합니다.
macOS는 `shasum -a 256 app/vendor/hy2219-custom-ui-0.2.0.tgz`, Linux/WSL은 `sha256sum app/vendor/hy2219-custom-ui-0.2.0.tgz`로 계산합니다.
값이 다르면 설치하지 말고 릴리스 담당자에게 확인합니다. 파일이 이미 있으면 덮어쓰지 말고 기존 버전/체크섬을 먼저 확인합니다.

```sh
cd app
bun add ./vendor/hy2219-custom-ui-0.2.0.tgz
cd ..
```

`app/package.json`의 `@hy2219/custom-ui`가 해당 파일만 가리키는지, 설치된 패키지의 버전이 `0.2.0`인지 확인하고 `app/bun.lock`도 함께 저장합니다.
Docker의 의존성 설치 단계에서도 `vendor/`를 먼저 복사해야 합니다. 라이브러리 소스를 앱으로 복사하는 방식이 아닙니다.
릴리스에 포함된 Storybook 빌드는 조직 권한으로 내려받아 로컬에서 보거나, UI 저장소의 `bun run storybook`으로 실행합니다.
공통 사용법과 변형은 UI 저장소에서 관리하며 이 가이드에 다시 나열하지 않습니다.
업데이트할 때는 새 버전/체크섬을 명시하고 UI 변경을 검토하는 PR로 진행합니다.
사내 배포 환경에 패키지 레지스트리가 준비되면 동일한 정확한 버전을 사용하도록 설치 경로만 교체할 수 있습니다.
이 규칙은 `.github/copilot-instructions.md`의 **공통 UI 필수 사용**에 에이전트 지시로도 명시돼 있습니다.
금지 규칙은 에이전트가 준수해야 할 지시이며, 현재 CI가 모든 임의 UI 생성을 자동 탐지/차단한다는 뜻은 아닙니다.

에이전트는 `.github/skills/thin-slice-tdd/SKILL.md`를 따라 한 번에 아주 얇은 사용자 흐름 하나를 구현합니다.
먼저 실제 E2E의 예상 실패를 확인하고 필요한 하위 테스트와 최소 구현으로 동일 E2E를 통과시킵니다.
화면과 기능은 요구사항과 생성 결과에 따라 달라지므로 이 문서만 실행해서 특정 앱이 자동 완성되지는 않습니다.

소스와 Unit은 `app/` 내부의 같은 디렉토리에 1:1로 둡니다.
Next.js 앱의 라우트는 `app/app/page.tsx`, `layout.tsx`, `health/route.ts`처럼 프레임워크 표준 구조를 사용합니다. 대응 Unit은 `page.test.tsx`, `route.test.ts`처럼 옆에 둡니다.
SSO 요청/코드 교환과 MCP 호출은 서버의 Route Handler/Server Component에서만 실행하고 비밀값을 브라우저에 전달하지 않습니다.
사용자별 데이터는 정적 생성/공유 캐시하지 않습니다. `next build`는 standalone 배포 결과를 만들며 다른 준비 서비스의 `main.ts`/`server.ts` 구조는 유지합니다.
standalone 서버가 `NODE_ENV`를 바꾸기 전에 Docker 진입점이 원래 실행 모드를 `APP_RUNTIME_NODE_ENV`에 보존합니다.
인증 구현은 서버 런타임 설정에서 이를 읽어 로컬 HTTP와 Azure HTTPS를 구분하며, Azure의 Secure 쿠키와 같은 출처 검사를 약화하지 않습니다.
필요한 Integration만 `app/integration/`, 전체 사용자 흐름 E2E는 루트 `e2e/`에 둡니다.
Unit은 Vitest globals와 교체 가능한 `__mocks__`를 사용하고 실제 Integration/E2E는 핵심 경로를 가짜로 대체하지 않습니다.

로그인이 필요하면 [SSO 계약](../sso/README.md)을 먼저 읽고 앱에 연결합니다.
Mock 계정은 `demo / demo1234`이며 실제 회사 SSO가 아닙니다.
템플릿 골격에는 로그인 기능이 없고 앱 구현 시 연결해야 합니다. 실제 고객 정보나 기밀 자료를 입력하지 않습니다.

## 8. 로컬 결과 확인

```sh
just up
just typecheck app
just unit app
just integration app
just e2e
just accept
```

변경 중에는 해당 테스트만 선택해서 실행하고, 마지막에는 `just accept`로 완료 기준을 확인합니다.
Integration은 정의되어 있을 때만 실행하지만 정의된 검사의 실패는 그대로 실패입니다.
기반 MCP 리소스 E2E만 통과한 것을 새 업무 기능 완료로 간주하지 않습니다.
업무의 실제 사용자 흐름 E2E도 작성해야 합니다.
Playwright가 필요한 앱은 에이전트가 E2E 실행 경로와 브라우저 준비를 구성하도록 합니다.
브라우저가 없다는 오류와 업무 동작 오류를 구분하며 검사를 skip하지 않습니다.
관찰한 입력/오류/기대 결과를 Copilot에 설명해 수정하고 같은 경로를 다시 확인합니다.

## 9. 작업 브랜치를 Push하고 PR 만들기

VS Code의 **Source Control** 또는 다음 명령으로 변경 파일을 검토합니다.

```sh
git branch --show-current
git status --short
git diff
```

현재 브랜치가 `feature/...` 또는 `fix/...`인지 확인합니다.
`.env`, `.vscode/mcp.json`, `infra/setup.local.json`, private tfvars/state나 비밀값이 포함되지 않았는지 검토합니다.
필요한 소스와 테스트만 stage하고 commit한 뒤 **작업 브랜치**를 push합니다.

```sh
git add <검토한-파일-또는-디렉토리>
git commit -m "<변경-내용>"
git push -u origin <작업-브랜치>
gh pr create --base main --head <작업-브랜치> --fill
```

GitHub의 **Compare & pull request**로 생성해도 됩니다.
base는 `main`, compare는 이번 작업 브랜치로 선택하고 변경 목적과 결과를 설명합니다.
작업 브랜치 push만으로는 배포되지 않으며, main 대상 PR 생성/갱신이 CI를 시작합니다.
PR 검사에는 Azure 배포 권한을 주지 않습니다.

## 10. CI 결과 확인하고 PR Merge

PR의 **Checks**에서 Unit, Integration, E2E와 최종 **`ci`** 결과를 확인합니다.
Unit이 실패해 Integration이 생략되어도 최종 `ci`는 실패하므로 merge할 수 없습니다.
CLI로 기다리려면 해당 작업 브랜치에서 실행합니다.

```sh
gh pr checks --watch
```

실패하면 원인을 확인해 **동일 작업 브랜치**에서 수정하고 commit/push합니다. PR이 자동 갱신되고 CI가 다시 실행됩니다.
다른 PR이 먼저 merge되어 최신화가 필요하면 다음처럼 반영합니다.

```sh
git fetch origin
git merge origin/main
git push
```

충돌을 해결하고 CI가 다시 성공할 때까지 기다립니다.
검사를 끄거나 성공하지 않은 상태에서 우회 merge하지 않습니다.
대화를 해결하고 필수 `ci`가 성공하면 PR 화면에서 **Squash and merge → Confirm squash and merge**를 선택합니다.
이전 전체 이력을 다시 squash하거나 main을 force push하는 것이 아니라 **이번 PR만** 하나의 변경 커밋으로 merge합니다.
조직에서 별도 승인을 요구하면 해당 승인도 받아야 합니다.

## 11. main Merge 후 자동 CD 확인

main에 merge되면 **Deploy workshop**이 자동 실행됩니다. 일반 작업에서 별도 Run workflow 클릭은 필요 없습니다.
이 워크플로는 merge된 SHA에서 CI를 다시 실행한 뒤 OIDC로 Azure에 로그인합니다.
선택한 이미지를 모두 빌드/push한 후 기존 ACA 이미지를 업데이트하며, Terraform이나 런타임 비밀값을 GitHub로 가져오지 않습니다.
CD의 이미지 빌드/push도 최대 3개 병렬이며, 모든 선택 이미지의 성공을 기다린 뒤 업데이트합니다.
자동 배포에서는 업무 앱도 포함합니다.

```sh
gh run list --workflow deploy.yml --branch main --limit 5
gh run watch <확인할-run-ID> --exit-status
```

GitHub의 **Actions → Deploy workshop → 해당 실행**에서도 확인할 수 있습니다.
최초 Azure 준비 전이거나 `DEPLOY_REPOSITORY`가 실제 저장소와 일치하지 않으면 배포 job은 생략됩니다.
이를 배포 성공으로 간주하지 말고 운영자가 4단계 준비와 Variables를 확인합니다.
환경에 조직 검토자 승인이 있으면 승인 대기 상태를 확인합니다.
CI/이미지 빌드/인증 실패 시 로그의 실패 단계부터 해결하며, 성공하지 않은 배포를 완료로 보지 않습니다.
실행 요약의 **Workshop URL**을 열어 실제 로그인과 요청한 업무 흐름까지 확인합니다.

수동 **Run workflow**는 운영자가 같은 main 소스를 재배포하거나 복구할 때만 사용합니다.
수동 실행 시 `deploy_app`을 체크해야 업무 앱도 업데이트됩니다.
체크하지 않으면 Mock 서비스 이미지만 업데이트하며 기존 앱을 삭제하지 않습니다.

## 12. 다음 작업과 종료

PR merge 후 main을 최신화하고 다음 작업 브랜치를 만듭니다.

```sh
git switch main
git pull --ff-only
git switch -c feature/next-work
```

로컬 컨테이너를 중지할 때는 다음 명령을 사용합니다.

```sh
just down
```

다음에 다시 시작할 때는 Docker를 실행한 뒤 `just up`을 사용합니다.
`just down`은 DB 볼륨을 유지합니다. **일반 종료에 `docker compose down -v`를 사용하지 마세요. DB 데이터를 삭제합니다.**
로컬 컨테이너 중지는 Azure 리소스를 삭제하지 않습니다. Azure 삭제는 소유권과 백업을 확인한 운영자가 별도로 수행합니다.

## 문제 발생 시 중단 위치

| 증상 | 확인/처리 |
| --- | --- |
| 보호 API HTTP 403 | GitHub 요금제와 repository admin 권한 확인. 우회하지 말고 3단계에서 중단 |
| `docker info` 실패/시간 초과 | Docker 엔진 연결 확인. 공유 Docker나 다른 사람 컨테이너를 임의 재시작/삭제하지 않음 |
| `infra-setup`의 기존 state/소유권 오류 | 원래 state/변수 백업과 실제 대상 확인. state를 지워 재생성하지 않음 |
| Azure 정책/할당량/권한 오류 | 운영자에게 실제 오류 전달. 정책이나 네트워크 제한을 해제하지 않음 |
| 포트가 이미 사용 중 | 해당 컨테이너/포트 소유자 확인 후 이 복사본의 로컬 포트만 조정 |
| 패키지 다운로드 HTTP 429 | 서비스 측 제한 여부 확인 후 동일 소스에서 재시도. lockfile을 지워 우회하지 않음 |
| PR `ci` 실패 또는 대기 | 세부 job과 최신 main 상태 확인. 검사 생략/이름 변경으로 통과시키지 않음 |
| CD 생략/실패 | 실제 저장소 Variables, demo 환경 승인, OIDC와 기존 Azure 리소스 확인 |
| `/health`만 성공 | 업무 기능 완료가 아님. 실제 사용자 흐름과 데이터 조회까지 확인 |
