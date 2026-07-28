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

### 내정보 수정 (Phase 2) — 미구현

- **수정 가능 필드**: 주인장과의 관계, 자기소개 한줄, 방문시간, 저녁먹을지 여부
- **아웃풋**: 저장 시 `profiles` 업데이트 + `state.profile` 갱신.

## 2. 필요한 공용 함수

- `supabase-client.js`: `setupSupabase()`, `getClient()`
- `auth.js`: `requireAuth()`, `logout()`
- `store.js`: `state`, `saveState()`
- `utils.js`: `escapeHtml()`, `formatPrice()`, `formatDate()`
- `toast.js`: `showToast()`

## 3. Supabase 쿼리 / Phase 1 임시 데이터

- 상품 목록: `products` select (피드와 동일)
- **내 상품**: `owner_id` 컬럼이 없어 `seller`(닉네임 문자열)로 필터
- **내 찜**: `likes` 테이블이 아직 없음. 피드(`app.js` `toggleLike`)가 localStorage `product.likes`(닉네임 배열)에만 쓰므로, 서버 fetch 후 동일 id의 local likes를 병합해 표시
- **찜 회수**: localStorage에서 닉네임 제거 후 `saveState()` (서버 DELETE 없음)

> 이후 `likes` 테이블 / `owner_id` 도입 시 이 문서를 갱신하고 mypage·피드 찜을 서버로 이전한다.

## 4. state 키

- 읽기: `state.currentUser`, `state.products`
- 쓰기: `state.products`(찜 회수 시 likes 배열), 로그아웃은 `auth.logout` → `state.currentUser = null`

## 닫힌 결정 (Phase 1)

- 찜 목록/내 상품: 서버 products fetch + localStorage likes 병합 / `seller` 필터로 확정 (임시)
- 진입: 별도 `mypage.html` (index 탭 아님)
