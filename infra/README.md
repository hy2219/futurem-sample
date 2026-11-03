# Azure 실습 환경 — Terraform은 로컬에서만

`just infra-setup`이 앱 개발 전에 **전체 환경과 7개 컨테이너**를 생성한다.
이후 Actions는 이미지 build/push와 기존 Container App의 이미지 업데이트만 담당한다.
Actions에는 Terraform, state, 앱 비밀값이 필요 없다. `app/`는 `/health`만 제공하는 독립 shell이며 업무/로그인 기능은 없다.

## 최초 실행

1. Node 24, Terraform 1.5 이상, Azure CLI, GitHub CLI, Just를 준비한다. Windows는 WSL/native CLI를 사용한다.
2. `az login`, `gh auth login` 후 대상 구독을 선택한다.
   비공개 개인 저장소는 GitHub Pro, 조직 저장소는 보호 규칙을 지원하는 Team/Enterprise 요금제와 repository admin 권한이 필요하다.
3. `infra/setup.example.json`을 `infra/setup.local.json`으로 복사한다.
   필드는 `subscriptionId`, 실제 `repository`, 전용 `resourceGroup`, 고유 `resourcePrefix`,
   선택 `location`(기본 `koreacentral`), 선택 `deploymentClientId`다.
   예전 미사용 GitHub 비밀값만 남은 미배포 환경을 새로 초기화할 때는 아래 명시적 승인 조건을 확인한다.
4. `just infra-setup`을 실행한다. 기존 `just setup`은 로컬 개발용이며 이 과정에서 호출하지 않는다.

`infra-setup`은 Azure 리소스를 생성하기 전에 `scripts/repository-setup.ts`를 호출한다.
이 초기화와 보호 규칙은 복사한 데모/업무 앱 저장소용이다. 원본 템플릿 유지보수에는 적용하지 않는다.
main에 PR을 필수로 요구하고 GitHub Actions의 `ci` 성공, 최신 main 반영, 대화 해결,
force push/삭제 금지와 bypass actor 없는 활성 ruleset을 적용한 뒤 실제 응답을 다시 읽는다.
템플릿 복사만으로 GitHub 설정은 복제되지 않는다. 요금제/권한이 부족하면 보호 완료로 간주하지 않고 중단한다.
개인 실습에서도 PR은 필수지만 다른 검토자 계정은 필수로 요구하지 않는다(승인 수 0).
조직에서 더 강한 검토 규칙을 이미 적용했다면 약화하거나 덮어쓰지 않는다.
클라우드 없이 저장소 보호만 먼저 준비할 수 있다:

```sh
node scripts/repository-setup.ts OWNER/REPOSITORY
```

```text
읽기 전용 인증/소유권/기존 state 검사
 → infra: local backend init -lockfile=readonly 및 state 읽기
 → 로컬 비밀값 6개 생성·0600 저장 (어떤 클라우드 리소스 생성보다 먼저)
 → GitHub main 보호 ruleset 적용 및 재확인 (실패 시 Azure 생성 전 중단)
 → 전용 RG + 비밀번호 없는 Entra 배포 ID/OIDC 준비
 → 빈 state이고 기존 ACR/ACA가 없을 때만 enable_apps=false 기반 apply
 → ACR Tasks로 7개 이미지 build/push (동일한 전체 Git SHA, 최대 3개 동시 실행)
 → enable_apps=true 전체 앱 apply
 → GitHub demo 환경/main 정책 및 CD용 Variables 등록
```

두 apply 모두 저장한 계획의
생성/변경 수를 표시하며 삭제·교체·알 수 없는 리소스가 있으면 중단한다.
최초 명령 실행은 이 제한된 생성 계획의 적용을 승인하는 것이며 `-auto-approve`는 쓰지 않는다.
이미지 실패 시 기반 state/비밀값을 보존하고 앱 apply는 실행하지 않는다.
중간 실패는 같은 checkout/SHA와 파일로 재실행한다. 기존 state를 빈 state로 간주하지 않는다.
전체 앱이 이미 state에 있으면 초기 이미지를 다시 빌드하지 않는다.

초기 이미지 빌드는 Docker 설치 없이 **Azure ACR Tasks**를 사용한다. 운영자는 ACR build 권한과
해당 지역/구독의 ACR Tasks 사용 가능 여부를 확인해야 한다. 빌드 비용이 발생할 수 있다.
`scripts/build-images.ts`가 native `az acr build --no-logs --timeout 1800 --output json --only-show-errors`
프로세스를 최대 3개씩 실행하고 각 CLI의 완료 JSON을 기다린다. ACR 빌드 제한은 30분, 로컬 프로세스 제한은 35분이다.
유효한 실행 ID와 `Succeeded` 상태를 받은 7개 이미지가 모두 필요하다. 실패/취소/시간 초과나 빈/잘못된 응답은 성공으로 간주하지 않는다.
실패한 묶음의 이미 시작한 프로세스도 모두 기다린 뒤 중단하며, 다음 묶음이나 앱 apply를 실행하지 않는다.
CLI 출력과 빌드 로그는 노출하지 않으며 오류가 나면 ACR Tasks에서 원인을 확인한다.
이미 제출한 원격 작업은 로컬 명령이 중단돼도 계속될 수 있으므로 재실행 전 ACR Tasks 상태를 확인한다.
정책/할당량 때문에 실패하면 설정을 약화시키거나 다른 저장소로 우회하지 않고 중단한다.
워크트리는 이미지 SHA에 해당하는 검토된 소스를 사용한다.

## 네트워크 경계

`network.tf`는 VNet `10.42.0.0/16`과 환경별 전용 서브넷/NSG를 생성한다.
연결할 기존 네트워크와 주소가 겹치면 배포 전에 주소 설계를 검토한다.
각 서브넷은 `Microsoft.App/environments`에 위임하며 Consumption workload profile을 사용한다.

| 영역 | 서브넷 | ACA 환경 | 앱 |
| --- | --- | --- | --- |
| frontend | `10.42.1.0/24` | 공개 환경 | app, sso |
| mcp | `10.42.2.0/24` | 내부 Load Balancer 환경 | runtime |
| resources | `10.42.3.0/24` | 내부 Load Balancer 환경 | api-1, api-2, db-1, db-2 |

NSG는 frontend에서 resources 서브넷으로 나가는 모든 포트를 우선 차단한다.
MCP 환경은 frontend에서 들어오는 HTTPS만, 리소스 환경은 MCP 서브넷에서 들어오는 HTTPS와 DB 포트만 허용한다.
ACA 프록시의 31443, TCP ingress의 동적 nodeport `30000-32767`, 같은 서브넷 내부 통신과 Azure Load Balancer probe도 허용한다.
리소스 NSG에서는 31443이 nodeport 범위 안에 포함되므로 별도 중복 항목으로 넣지 않는다.
나머지 backend inbound는 차단하며, 기본 outbound는 DNS, 이미지 pull과 플랫폼 운영을 위해 유지한다.
플랫폼용 허용 규칙을 임의 삭제하거나 API 인증/DB View 최소 권한을 제거하지 않는다.
공개 frontend 환경의 인터넷 ingress는 서브넷을 거치지 않으므로 이 NSG로 공개 App 접근을 제한한다고 해석하지 않는다.
포트와 플랫폼 통신 요구는 [Azure의 NSG 안내](https://learn.microsoft.com/azure/container-apps/firewall-integration)를 따른다.

내부 환경의 앱은 `external_enabled=true`여도 인터넷 공개가 아니라 **VNet의 내부 Load Balancer에 공개**되는 것이다.
App만 공개 frontend ingress를 사용하고 SSO는 frontend 환경 내부에서만 접근한다.
MCP와 리소스 환경 각각에 default domain의 Private DNS zone, wildcard A record와 VNet link를 생성한다.
App→MCP와 MCP→API는 HTTPS FQDN, MCP→DB는 리소스 환경 FQDN의 TCP 5432/5433을 사용한다.
이는 Private Endpoint 구성이 아니며 Key Vault, Firewall, NAT Gateway도 추가하지 않는다.

격리 단위는 개별 프로세스가 아니라 서브넷이다. MCP 서브넷에 다른 앱을 추가하면 그 앱도 리소스 접근 영역에 들어간다.
실제 적용 후에는 App의 직접 API/DB 접근이 HTTP 401/403이 아니라 **연결 단계에서 차단**되는지,
App→MCP→리소스와 로그인, 이미지 업데이트는 동작하는지 별도 확인해야 한다.
로컬 Docker Compose는 이 Azure NSG 격리를 재현하지 않는다.
Terraform 구성/계획 검사와 정적 회귀 검사는 정책 정의 확인이며, 실제 Azure에서 차단을 검증한 결과가 아니다.

### 기존 단일 환경은 자동 교체하지 않는다

이 구성은 VNet 없는 기존 ACA 환경에 제자리로 추가할 수 없다.
`infra-setup`은 기존 frontend 환경의 subnet 정보가 없으면 이미지 빌드/클라우드 변경 전에 중단한다.
ACA 환경에는 `prevent_destroy`를 두어 직접 `infra-update`로 실행해도 교체/삭제가 막히게 한다.
이 제한을 풀거나 state를 삭제해 우회하지 않는다. 기존 상태 백업, 이전/재생성 대상, 데이터 손실과 URL 변경을 검토한 운영자의 별도 승인이 필요하다.
`prevent_destroy`는 계획되지 않은 교체 방지용이며, 환경 폐기 시에도 소유권을 확인한 명시적 변경 절차가 필요하다.

사용자 VNet을 쓰는 ACA 환경은 Azure가 관리하는 별도 인프라 리소스 그룹에 Load Balancer와 IP를 만들 수 있다.
이 리소스는 환경별 추가 비용이 발생하며 직접 수정하지 않는다.

## state와 비밀값

| 비공개 로컬 파일 | 용도 |
| --- | --- |
| `infra/setup.local.json` | 구독·저장소·RG·prefix 설정 |
| `infra/deployment.auto.tfvars.json` | 대상 subscription/tenant, 배포 principal, 최초 SHA, 앱 비밀값 |
| `infra/.state/terraform.tfstate`와 `.backup` | **유일한 활성 Terraform state**, 런타임 비밀값 포함 |
| `infra/.state/deployment.tfplan` | 민감한 저장 계획 |

state/변수/계획은 0600, `.state/`는 0700이다. Git/Docker에 포함하지 말고 암호화된 개인 백업에
state와 변수 파일을 **함께** 보존한다. 한 운영자가 한 로컬 state로 관리하며 동시 실행하지 않는다.
파일이 없거나 손상됐으면 백업을 복구한다. 새 값을 생성하여 기존 환경을 덮어쓰지 않는다.
GitHub에 예전 앱 secret 이름이 있는데 로컬 파일이 없으면 자동 채택·삭제·회전하지 않고 중단한다.
이전에 앱을 배포하지 않은 환경을 검토한 운영자는 설정에 **`"initializeFreshEnvironment": true`**를
명시하여 새 로컬 값 6개를 생성할 수 있다. 이 승인은 기존 ACR/ACA 리소스가 없고 활성 관리 state가
비어 있을 때만 유효하다. 기존 GitHub 값은 수정하지 않고 남겨 두며 이후 Actions에서도 사용하지 않는다.
실제 앱/기반 리소스나 비어 있지 않은 state가 있으면 이 승인으로도 복구 검사를 우회할 수 없다.

| 값 | 로컬 변수/state | ACA secret | GitHub |
| --- | --- | --- | --- |
| `APP_CLIENT_ID` | 있음 | 일반 환경값 | 새로 등록하지 않음 |
| `APP_CLIENT_SECRET`, `RESOURCE_TOKEN_KEY`, `SSO_SESSION_KEY` | 있음 | 필요한 앱에만 | 읽기/쓰기 안 함 |
| `POSTGRES_PASSWORD`, `PG_READER_PASSWORD` | 있음 | DB 및 runtime reader URL | 읽기/쓰기 안 함 |
| Azure 배포 ID | client/object ID만 | 없음 | 공개 Variables + 단기 OIDC |

기존 GitHub secret **이름 목록만** 복구 필요 여부 확인에 사용한다. secret 값은 읽거나 쓰지 않는다.
로컬 `.env`를 클라우드 비밀값으로 재사용하지 않는다.

### 이전 Azure Blob backend는 자동 이전하지 않는다

`infra/.terraform/terraform.tfstate` 메타데이터가 `azurerm`이면 init 전에 명시적으로 중단한다.
`-reconfigure`, `-migrate-state`, import 또는 destroy로 우회하지 않는다.
기존 Blob과 `infra/bootstrap/.state`, `.terraform`, 변수, `backend.local.hcl`은 삭제·변경하지 않는다.
추적된 `infra/bootstrap/*.tf`와 lockfile만 더 이상 활성 구성에 포함하지 않는다.
이전 환경의 state/리소스 소유권을 먼저 수동 검토하고 안전하게 보관해야 한다.
새 로컬 흐름은 Blob, Private Endpoint 또는 사설 state에 연결하는 Actions runner를 요구하지 않는다.
기업 네트워크 정책을 해제하거나 네트워크 설정을 변경하지 않는다.

## 권한과 CD 설정

로컬 운영자는 전용 RG/리소스 생성, Entra 앱 생성, 역할 할당 및 GitHub repository admin 권한이 필요하다.
`Microsoft.App`, `Microsoft.ContainerRegistry`, `Microsoft.OperationalInsights`, `Microsoft.ManagedIdentity`, `Microsoft.Network`는
관리자가 미리 등록한다. state용 Storage provider는 필요 없다.

배포 ID에는 전용 RG의 **Container Apps Contributor**, ACR 범위의 **AcrPush**와 **Reader**만 새로 부여한다.
ACR Reader는 Actions의 레지스트리 대상 확인과 로그인에 필요한 메타데이터 조회용이며 인프라 변경 권한은 주지 않는다.
Terraform 실행 권한/RBAC 관리자/Blob 역할을 배포 ID에 부여하지 않는다.
이전에 더 넓게 부여한 역할은 경고만 하고 삭제하지 않으므로 운영자가 검토한다.
이미지 pull 관리 ID는 ACR의 `AcrPull`만 받는다.
OIDC subject는 GitHub API의 실제 immutable prefix(또는 default name prefix)에 `:environment:demo`를 붙인다.
기존 OIDC 신뢰/검토자/main 정책을 약화시키거나 덮어쓰지 않는다.

CD용 Repository Variables는 `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`,
`AZURE_RESOURCE_GROUP`, `DEPLOY_REPOSITORY`, `ACR_NAME`, `ACR_LOGIN_SERVER`뿐이다.
예전 state/runner 변수와 secrets는 그대로 두며 사용하지 않는다.

CI는 main 대상 PR에서 실행한다. 전체 성공을 집계한 `ci`만 필수 상태 검사로 등록한다.
main에 merge하면 CD가 자동 실행되어 같은 CI를 다시 수행한 뒤 기존 ACA 이미지를 업데이트한다.
CD의 이미지 빌드/push는 최대 3개 병렬 matrix로 실행한다. 모든 선택 이미지가 성공해야 배포 job이 실행된다.
실패한 이미지를 무시하거나 일부 앱부터 업데이트하지 않는다.
PR에서는 OIDC 배포 권한을 사용하지 않는다. 원본/준비 전 복사본처럼
`DEPLOY_REPOSITORY`가 실제 저장소와 일치하지 않으면 배포 단계는 실행되지 않는다.
수동 `Deploy workshop`은 main에서 재배포/복구할 때만 사용한다.

## 이후 인프라 변경

`just infra-update`는 **로컬 Terraform apply만** 실행하며 기본 대화형 승인을 유지한다.
init, 로그인, 이미지 빌드는 실행하지 않는다. 대상 구독과 tenant는 private tfvars에 고정된다.
`enable_apps=true`, `enable_business_app=true`를 유지한다. false는 앱 삭제를 계획할 수 있다.
두 Container App 리소스의 image는 `ignore_changes`로 분리하여 이후 Actions 이미지 업데이트를 되돌리지 않는다.

## 리소스와 이미지

기반 25개와 앱 7개로 Terraform 관리 리소스는 **32개**다. RG는 CLI로 생성하고 Terraform은 조회만 한다.
기반은 ACR, image-pull ID, 역할 3개, Log Analytics, ACA 환경 3개, VNet,
서브넷/NSG/연결 각 3개, Private DNS zone/A record/VNet link 각 2개다.
NSG 규칙은 각 NSG 안에 정의하며 Azure가 자동 관리하는 인프라 리소스는 이 수에 포함하지 않는다.

| 앱 | 이미지 repository | Docker context / Dockerfile | ingress |
| --- | --- | --- | --- |
| runtime | external-resources | 루트 / `mcp/Dockerfile` | MCP 내부 환경의 HTTPS |
| sso | mock-sso | `sso` / Dockerfile | 내부 HTTP |
| api-1 / api-2 | api-1 / api-2 | `external_resources/api_1`, `api_2` | 리소스 내부 환경의 HTTPS |
| db-1 / db-2 | db-1 / db-2 | `external_resources/db_1`, `db_2` | 리소스 내부 환경의 TCP 5432 / 5433 |
| app | business-app | `app` / Dockerfile | 공개 HTTPS |

HTTP target은 8080, DB target은 둘 다 5432다. DB는 합성 실습용 임시 PostgreSQL이며
재시작/재배포 시 데이터가 초기화될 수 있다. 기업 SSO, Key Vault, 영구 DB나 업무 기능은 제공하지 않는다.

Azure 인증/apply 없이 구성 검증:

```sh
terraform -chdir=infra fmt -check
terraform -chdir=infra validate
```

별도 검증용 checkout에서 provider가 없을 때만 `init -backend=false -lockfile=readonly`로 설치한다.
활성 운영 checkout의 backend 메타데이터나 state를 검증 목적으로 재구성하지 않는다.
