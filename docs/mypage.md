# mypage.md — 마이페이지 (홈 / 내정보수정)

- 모듈: `mypage.js` · 담당: 한임 · Phase: 1(홈) / 2(내정보수정)
- 원본: 옵시디언 `작업 페이지` > 🍝마이페이지 > 홈 / 내정보 수정

## 1. 인풋/아웃풋

### 마이페이지 홈 (Phase 1)

- **내 찜 목록**: 내가 찜한 상품 목록. 각 항목에서 찜 회수(취소) 가능.
- **내가 올린 상품 목록**: 전체 상품에서 `owner_id == 내 id`로 필터링.
- **로그아웃**: 세션 종료 후 로그인/피드로 이동.

### 내정보 수정 (Phase 2)

- **수정 가능 필드**: 주인장과의 관계, 자기소개 한줄, 방문시간, 저녁먹을지 여부
- **아웃풋**: 저장 시 `profiles` 업데이트 + `state.profile` 갱신.

## 2. 필요한 공용 함수

- `supabase-client.js`: `getClient()`, `signOut()`
- `store.js`: `state.session`, `state.profile`, `state.likes`, `saveState()`
- `utils.js`: `escapeHtml()`, `formatPrice()`, `formatDate()`

## 3. Supabase 쿼리

- 내 찜: `likes`에서 `user_id == 내 id` 조회 → 해당 `product_id`로 `products` 조인/조회
- 찜 회수: `likes`에서 해당 row delete
- 내 상품: `products`에서 `owner_id == 내 id` 조회 (또는 `state.products` 재사용 후 필터)
- 내정보 수정: `profiles` update (`relationship`, `bio`, `visit_time`, `dinner`)

## 4. state 키

- 읽기: `state.session`, `state.profile`, `state.likes`, `state.products`
- 쓰기: `state.profile`(수정 시), `state.likes`(찜 회수 시), `state.session`(로그아웃 시 null)

## 열린 결정

- 찜 목록/내 상품을 매번 서버에서 fetch할지, `state`에서 필터할지 (피드와 데이터 공유 방식 2단계 확정)
