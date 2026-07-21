import { state, saveState } from "./store.js";

// mock 초대코드 목록. 실제로는 invite_codes 테이블에서 조회/검증한다.
const INVITE_CODES = ["WELCOME", "FRIEND2026", "DONGNE"];

let supabaseClient = null;

export async function setupSupabase() {
  // TODO: Supabase로 교체 — 환경변수 로드 후 createClient
  return supabaseClient;
}

export function getClient() {
  return supabaseClient;
}

export async function signUp({ id, password, nickname, inviteCode }) {
  // TODO: Supabase로 교체 — invite_codes 검증 + profiles insert를
  // 서버(unique 제약 + RLS)에서 처리. 아래는 mock 구현.
  const code = String(inviteCode).trim();

  if (!INVITE_CODES.includes(code)) {
    return { ok: false, reason: "invalid_code" };
  }
  if (state.usedInviteCodes.includes(code)) {
    return { ok: false, reason: "used_code" };
  }
  if (state.accounts[id]) {
    return { ok: false, reason: "duplicate_id" };
  }

  state.accounts[id] = {
    id,
    // 실서비스 금지: 평문 비밀번호를 클라이언트에 저장하지 않는다. mock 편의용.
    password,
    nickname,
    isAdmin: false,
    createdAt: new Date().toISOString(),
  };
  state.usedInviteCodes.push(code);
  saveState();

  return { ok: true, user: { id, nickname, isAdmin: false } };
}

export async function signIn({ id, password }) {
  // TODO: Supabase Auth로 교체
  const account = state.accounts[id];
  if (!account || account.password !== password) {
    return { ok: false, reason: "invalid_credentials" };
  }
  return {
    ok: true,
    user: { id: account.id, nickname: account.nickname, isAdmin: account.isAdmin },
  };
}

export async function getSession() {
  // TODO: Supabase Auth 세션으로 교체
  return state.currentUser;
}

export async function signOut() {
  // TODO: Supabase Auth signOut으로 교체
  state.currentUser = null;
  saveState();
}
