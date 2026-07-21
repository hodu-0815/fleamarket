# friendmap.md — 친구맵 타임라인 (Phase 3)

- 모듈: `friendmap.js` · 담당: 한임 · Phase: 3 (시간 남으면 / 런칭 후)
- 원본: 옵시디언 `작업 페이지` > 🍝친구맵 페이지

> Phase 3라 지금은 스케치만. Phase 1/2가 끝난 뒤 상세화합니다.

## 1. 인풋/아웃풋

- **친구 카드 타임라인 뷰**: 친구(다른 사용자) 카드를 타임라인 형태로 나열
- **카드에 표시**:
  - 닉네임
  - 유진(주인장)과의 관계 (`profiles.relationship`)
  - 올린 상품 목록
  - 방문 시간 범위 (`profiles.visit_time`)

## 2. 필요한 공용 함수

- `supabase-client.js`: `getClient()`
- `store.js`: `state.session`
- `utils.js`: `escapeHtml()`, `formatDate()`

## 3. Supabase 쿼리

- `profiles` 전체 조회 (관계/방문시간/닉네임)
- 각 프로필의 상품: `products`에서 `owner_id` 기준 조회

## 4. state 키

- 읽기: `state.session`, `state.products`(재사용 가능)

## 열린 결정

- 타임라인 정렬 기준(방문시간? 가입순?)은 Phase 3 착수 시 확정
