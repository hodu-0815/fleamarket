const STORAGE_KEY = "fleamarket-state-v1";

export const defaultNotice =
  "플리마켓 운영 시간은 오전 11시부터 오후 4시까지입니다.\n판매 글에는 실제 사진과 거래 가능한 금액을 정확히 적어주세요.";

// Phase 2 확장 프로필의 기본값 (미입력/미정 상태)
export function createEmptyProfile() {
  return {
    relationship: "",
    bio: "",
    visitTime: "",
    dinner: "undecided",
    avatarUrl: "",
  };
}

function createFallback() {
  return {
    currentUser: null,
    profile: null,
    notice: defaultNotice,
    products: [],
    users: {},
    accounts: {},
    usedInviteCodes: [],
  };
}

function loadState() {
  const fallback = createFallback();

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { ...fallback, ...saved };
  } catch {
    return fallback;
  }
}

export const state = loadState();

export function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
