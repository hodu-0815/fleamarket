# 화면별 스펙 문서 (docs/)

이 폴더는 **코딩 기준 스펙**을 담습니다. 제품 아이디어/기획 원본은 옵시디언 `작업 페이지` 노트에 있고, 여기 문서는 그걸 "AI/개발자가 바로 구현할 수 있는 형태"로 옮긴 것입니다. Cursor·Codex 등 AI 도구는 옵시디언을 못 읽으므로, 실제 작업 기준은 항상 이 폴더를 봅니다.

- 기능 범위/일정/데이터 모델: [../PROJECT_PLAN.md](../PROJECT_PLAN.md)
- 협업/스택 규칙, 파일 담당: [../AGENTS.md](../AGENTS.md)

## 문서 목록 (모듈 = 화면 단위)

이 폴더에는 **한임 담당 화면 스펙만** 둡니다. 유진 담당 화면(`feed.js`, `product-form.js`)의 스펙은 유진이 직접 작성합니다.

| 문서 | 대응 모듈 | 담당 | Phase |
| --- | --- | --- | --- |
| [auth.md](auth.md) | `auth.js` | 한임 | 1 |
| [mypage.md](mypage.md) | `mypage.js` | 한임 | 1(홈) / 2(내정보수정) |
| [friendmap.md](friendmap.md) | `friendmap.js` | 한임 | 3 |

> 유진 담당: `feed.js`(메인피드/상세팝업/찜), `product-form.js`(상품 등록·수정·삭제). 담당 구분은 [../AGENTS.md](../AGENTS.md) 8~9절 참고.

각 문서는 아래 4파트로 통일합니다.

1. **인풋/아웃풋** — 화면이 받는 입력과 보여주는 것
2. **필요한 공용 함수** — `store.js` / `utils.js` / `supabase-client.js`에서 `import`해 쓰는 것
3. **Supabase 쿼리** — 이 화면이 건드리는 테이블/작업
4. **state 키** — 이 화면이 읽고/쓰는 중앙 상태

---

## 공용 계약 (Shared Contract) — 한임 전용, 여기가 기준

> 화면 모듈(`feed.js`, `product-form.js` 등)은 아래 시그니처만 `import`해서 씁니다. **직접 Supabase 클라이언트를 만들거나 localStorage를 만지지 않습니다.** 시그니처 변경은 한임과 상의 (AGENTS.md 8절).
>
> 아래는 하이브리드 2단계(공용 뼈대 분리)에서 확정할 **초안 계약**입니다. 실제 분리 구현 시 최종 확정합니다.

### `store.js` — 중앙 상태

```js
export const state; // 아래 shape
export function loadState();   // localStorage → state
export function saveState();   // state → localStorage
```

`state` shape (초안):

```js
{
  session: null,        // 로그인 사용자 { id, nickname, isAdmin } | null
  profile: null,        // 확장 프로필 필드 (Phase 2)
  products: [],         // 메인피드용 상품 목록
  likes: [],            // 내 찜 product_id 배열 (마이페이지/피드 공유)
  notice: "",           // 공지
}
```

- `STORAGE_KEY`는 `store.js` 내부 상수. 다른 모듈은 몰라도 됨.

### `utils.js` — 순수 함수 (부작용 없음)

```js
export function escapeHtml(value);       // innerHTML 넣기 전 필수
export function formatPrice(value);      // 1234 → "1,234원"
export function formatDate(value);       // ISO → "7월 21일 21:14"
export function normalizeNickname(value);
```

### `supabase-client.js` — DB 연결 + 얇은 helper

```js
export async function setupSupabase();   // 클라이언트 1회 초기화 (app.js에서 호출)
export function getClient();             // 초기화된 supabase client 반환

// 인증 관련은 auth.js가 쓰지만 연결부는 여기에 둠
export async function signUp({ id, password, nickname, inviteCode });
export async function signIn({ id, password });
export async function signOut();
export async function getSession();      // 자동로그인용
```

> 화면 모듈이 필요로 하는 쿼리 helper(예: `fetchProducts()`, `toggleLike()`)를 여기에 추가할지, 각 모듈에서 `getClient()`로 직접 쿼리할지는 2단계에서 결정. 현재 원칙: **인증/공용 = 여기, 화면 고유 쿼리 = 각 모듈에서 `getClient()` 사용.**

## 데이터 모델 참조

테이블 스키마(`profiles`, `invite_codes`, `products`, `product_images`, `likes`)는 [../PROJECT_PLAN.md](../PROJECT_PLAN.md) 3절 참고.
