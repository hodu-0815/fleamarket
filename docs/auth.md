# auth.md — 회원가입 / 로그인 / 초대코드 / 자동로그인

- 모듈: `auth.js` · 담당: 한임 · Phase: 1
- 원본: 옵시디언 `작업 페이지` > 🍝회원가입 / 🍝로그인

## 1. 인풋/아웃풋

### 회원가입

- **필수 인풋**: ID, PW, 초대코드, 닉네임
- **선택 인풋 (Phase 2)**: 주인장과의 관계(textarea), 자기소개 한줄, 방문시간, 저녁먹을지 여부, 프로필이미지(미등록 시 랜덤 배치)
- **검증**: 초대코드가 유효하고 미사용 상태여야 가입 가능. 사용된 코드/없는 코드는 거절.
- **아웃풋**: 가입 성공 시 자동 로그인 → 메인피드로 이동. 실패 시 사유별 에러 메시지.

### 로그인

- **인풋**: ID / PW
- **자동로그인**: 페이지 재진입 시 기존 세션 있으면 로그인 상태 복원 (init 시 `getSession()`)
- **아웃풋**: 성공 시 세션 저장 + 메인피드. 실패 시 에러 메시지.

## 2. 필요한 공용 함수

- `supabase-client.js`: `signUp()`, `signIn()`, `getSession()`
- `store.js`: `state.session`, `state.profile`, `saveState()`
- `utils.js`: `normalizeNickname()`, `escapeHtml()`

## 3. Supabase 쿼리

- `invite_codes`: 코드 존재 여부만 확인(재사용 가능). 가입 성공 시 `used_by`/`used_at`은 마지막 사용 기록으로만 갱신
- `profiles`: 신규 프로필 insert (id, nickname, 필수 필드)
- 인증: Supabase Auth 사용 여부는 스키마 확정 시 결정 (PROJECT_PLAN 3절 `password` 주석 참고)

## 4. state 키

- 쓰기: `state.session`, `state.profile`
- 읽기: `state.session` (로그인 여부 판단)

## 열린 결정 (2단계에서 확정)

- Supabase Auth를 쓸지, `profiles`에 password 직접 저장할지
- 초대코드 발급/관리 화면은 이번 범위 밖 (admin이 DB에서 직접 넣는 것으로 시작)
