# mypage.md — 마이페이지 (홈 / 내정보수정)

- 모듈: `mypage.js` · 담당: 한임 · Phase: 1(홈) / 2(내정보수정)
- 원본: 옵시디언 `작업 페이지` > 🍝마이페이지 > 홈 / 내정보 수정
- 페이지: `mypage.html` (별도 진입, `login.html`과 동일 패턴)

## 1. 인풋/아웃풋

### 마이페이지 홈 (Phase 1) — 구현됨

- **내 찜 목록**: 내가 찜한 상품 목록. 각 항목에서 찜 회수(취소) 가능.
- **내가 올린 상품 목록**: `seller == 내 닉네임`으로 필터링. (아직 `owner_id` 없음)
- **로그아웃**: `auth.logout()` → 로그인 페이지로 이동.
- **마켓으로**: `index.html` 링크.

### 내정보 수정 (Phase 2) — 구현됨

- **수정 가능 필드**:
  - `relationship` — 주인장과의 관계 (textarea, max 120)
  - `bio` — 자기소개 한줄 (max 40)
  - `visit_time` — 방문 시간 (자유 텍스트)
  - `dinner` — `yes` | `no` | `undecided` (셀렉트)
  - `avatar_url` — 프로필 사진 (Storage `avatars` 업로드)
- **닉네임**: 표시만 (수정 불가)
- **아바타 미등록**: 닉네임 이니셜 원형 플레이스홀더
- **아웃풋**: 저장 시 `profiles` update + `state.profile` 갱신

## 2. 필요한 공용 함수

- `supabase-client.js`: `setupSupabase()`, `getClient()`, `updateProfile()`, `uploadAvatar()`
- `auth.js`: `requireAuth()`, `logout()`
- `store.js`: `state`, `saveState()`, `createEmptyProfile()`
- `utils.js`: `escapeHtml()`, `formatPrice()`, `formatDate()`
- `toast.js`: `showToast()`

## 3. Supabase 쿼리 / 데이터

### Phase 2 프로필

- 읽기: `getSession`/`signIn` → `profiles` select (확장 필드 포함) → `state.profile`
- 저장: `updateProfile` → `profiles` update (본인 row, RLS)
- 아바타: `uploadAvatar` → Storage 버킷 `avatars` (`{userId}/...` path)

### Phase 1 상품 (임시)

- 상품 목록: `products` select (피드와 동일)
- **내 상품**: `owner_id` 컬럼이 없어 `seller`(닉네임 문자열)로 필터
- **내 찜**: `likes` 테이블이 아직 없음. localStorage `product.likes` 병합
- **찜 회수**: localStorage에서 닉네임 제거 후 `saveState()`

## 4. state 키

- 읽기: `state.currentUser`, `state.profile`, `state.products`
- 쓰기: `state.profile`(내정보 저장), `state.products`(찜 회수), 로그아웃 시 `currentUser`/`profile` null

## 닫힌 결정

- Phase 1: 찜/내 상품은 localStorage likes + `seller` 필터 (임시)
- Phase 1: 진입은 별도 `mypage.html`
- Phase 2: 폼은 `mypage.html` 상단 섹션
- Phase 2: 아바타 미등록 시 이니셜 플레이스홀더 (랜덤 에셋 없음)
- Phase 2: `dinner`는 text enum (`yes`/`no`/`undecided`)
