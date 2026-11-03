# Future M — 합성 제조 ITSM 데모

원본 템플릿과 분리된 데모로, 실제 고객 자료나 회사 계정을 사용하지 않습니다.
데모 로그인 후 IT 자산 4건을 조회하고, 상태별로 필터링하거나 자산의 변경 요청,
유지보수 일정과 담당팀을 확인할 수 있습니다. 모든 업무 데이터는 MCP를 통해 조회합니다.
자산 화면의 **변경 점검 보드** 링크(`/changes`)에서는 미완료 변경의 현황과 위험도별 건수·비중,
위험도 및 변경 계획일 순의 목록을 확인합니다. 변경명을 선택하면 대상 시스템 상태·중요도,
등록된 점검 일정·업무 영향과 담당팀 연락처·지원시간을 함께 볼 수 있습니다.
승인 대기는 요청 상태인 미완료 변경이며, 완료된 변경은 보드 목록과 집계에서 제외합니다.
등록 정보 없음과 조회 실패를 구별하고 일부 조회가 실패해도 확인된 정보는 유지합니다.
변경 계획일과 점검 일정을 구분해 표시하며 작업 가능 여부 판정이나 생성·수정·승인은 제공하지 않습니다.
개인용 준비 기록과 로컬 인증 설정은 저장소와 클라우드 빌드에서 제외합니다.

**준비된 Mock 리소스로 시작하고, 만들고 싶은 업무 앱은 Copilot과 함께 구현합니다.**
`app/`에는 Next.js와 React 기반 로그인·자산 조회 앱이 구현되어 있습니다.

## 시작하기

1. **Use this template**으로 저장소를 복사하고 VS Code에서 엽니다.
2. [단계별 가이드](docs/instruction.md)에 따라 운영자가 main 보호 규칙과 필요한 Azure 환경을 먼저 준비합니다.
3. 작업 브랜치에서 Node.js 24 이상, Bun 1.4.2, Just, Docker Desktop을 준비하고 아래 명령을 실행합니다.
4. Copilot의 MCP 연결 요청에서 **external-resources**를 승인합니다.
5. 만들고 싶은 업무, 입력, 결과, 완료 기준을 Copilot에 설명합니다.

```sh
just install
just up
```

앱은 http://localhost:3100 에서 확인할 수 있습니다.
Codespaces나 VS Code Dev Containers를 쓰면 `.devcontainer`가 같은 준비를 자동으로 수행합니다.
`just up`이 최초 인증값 준비도 수행합니다.
Copilot 사용 권한이 필요하며 Codespaces와 Azure 사용에는 비용이 발생할 수 있습니다.

## 앱을 만들고 배포하는 흐름

**업무 설명 → 구현과 결과 확인 → 작업 브랜치 Push → PR → CI → main Merge → 자동 배포**

별도 시나리오 파일 없이 채팅으로 사용자, 입력, 원하는 결과와 완료 기준을 설명합니다.
Copilot이 부족한 내용을 질문하고 계획을 확인한 뒤 `app/`에 구현합니다.
Next.js 앱에서 준비된 MCP와 Mock SSO를 서버 측으로 연결하고, 화면은 공식 React 공통 UI로 구성합니다.
화면은 조직 공통 [custom-ui](https://github.com/hy2219/custom-ui)의 승인된 버전을 재사용합니다. Storybook과 설치 절차는 [단계별 가이드](docs/instruction.md)를 확인합니다.

복사한 앱 저장소는 PR의 필수 `ci` 성공 후 main에 merge하며, 준비된 Azure 환경에 자동 배포됩니다.
비공개 저장소의 보호 규칙에는 지원 요금제(Pro/Team/Enterprise)와 admin 권한이 필요합니다.
원본 템플릿 유지보수는 main에 직접 반영합니다.

## 준비된 리소스

| 위치 | 반환하는 가상 데이터 |
|---|---|
| `external_resources/db_1` | 가상 제조 IT 자산 (asset_id/team_id) |
| `external_resources/db_2` | 자산별 가상 변경 요청 |
| `external_resources/api_1` | 자산별 가상 유지보수 일정 |
| `external_resources/api_2` | 가상 담당팀 (team_id) |
| `sso` | 데모 로그인: `demo / demo1234` |
| `mcp` | 리소스 카탈로그, 인증과 요청 전달 |

리소스 추가 방법은 [MCP 확장 안내](mcp/README.md)를 확인합니다.

POSCO DX는 이미 MCP 게이트웨이를 구축하고 있습니다. 여기의 MCP는 Mock 시연용
독립 대체물이며 DX 게이트웨이의 재구축/교체 제안이 아닙니다. 실제 adapter/auth/policy
정합은 별도 협의합니다. 한 달은 작은 앱 구현 시간이 아니라 DX 협조·접근·정책·통합
의사결정의 여유 기간입니다. 제조 명칭·팀·일정·연락처는 모두 합성 데이터입니다.

## 주요 명령

| 명령 | 용도 |
|---|---|
| `just install` | 개발 도구와 패키지 설치 |
| `just up` / `just down` | 로컬 환경 실행 / 중지 |
| `just accept` | 구현 완료 전 전체 검사 |
| `just infra-setup` | 운영자의 최초 Azure 환경 준비 |
| `just infra-update` | 운영자의 인프라 변경 적용 |

Terraform과 state는 로컬에서만 관리하고, Actions는 이미지 빌드와 기존 ACA 업데이트만 담당합니다.
`.env`, MCP 인증 설정과 Terraform state 등 비공개 파일은 Git에 올리지 않습니다.

## 상세 안내

| 문서 | 내용 |
|---|---|
| [단계별 사용자 가이드](docs/instruction.md) | 준비부터 PR과 자동 배포까지 |
| [전체 구조](docs/architecture.md) | 서비스 역할과 연결 흐름 |
| [Azure 구성](infra/README.md) | 인프라, 네트워크와 운영 |
| [외부 리소스](external_resources/README.md) / [MCP](mcp/README.md) / [SSO](sso/README.md) | 리소스와 연동 계약 |
| [Copilot 지침](.github/copilot-instructions.md) / [TDD 스킬](.github/skills/thin-slice-tdd/SKILL.md) | 에이전트의 개발 규칙 |

**실제 회사 계정이나 기밀 데이터는 입력하지 마세요.**
