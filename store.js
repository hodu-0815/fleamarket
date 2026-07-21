const STORAGE_KEY = "fleamarket-state-v1";

export const defaultNotice =
  "플리마켓 운영 시간은 오전 11시부터 오후 4시까지입니다.\n판매 글에는 실제 사진과 거래 가능한 금액을 정확히 적어주세요.";

function createFallback() {
  return {
    currentUser: null,
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
