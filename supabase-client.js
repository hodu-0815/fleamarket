import { state, saveState } from "./store.js";

// 아이디를 Supabase Auth용 "가짜 이메일"로 변환한다.
// 실제 이메일을 수집하지 않기로 했기 때문에, 아이디에 고정 도메인을 붙여
// 이메일 형식만 맞춰서 Auth에 넘긴다. (예: hanim -> hanim@fleamarket.local)
const FAKE_EMAIL_DOMAIN = "fleamarket.local";

function idToEmail(id) {
  return `${String(id).trim().toLowerCase()}@${FAKE_EMAIL_DOMAIN}`;
}

let supabaseClient = null;

// .env 파일에서 Supabase 접속 정보를 읽는다.
// 번들러가 없는 정적 사이트라 빌드타임 주입 대신 런타임에 fetch로 읽는다.
async function loadSupabaseEnv() {
  if (window.ENV?.VITE_SUPABASE_URL && window.ENV?.VITE_SUPABASE_ANON_KEY) {
    return window.ENV;
  }

  try {
    const response = await fetch(".env", { cache: "no-store" });
    if (!response.ok) return {};

    const text = await response.text();
    // KEY=VALUE 형식만 파싱하고 주석(#)과 빈 줄은 건너뛴다
    return Object.fromEntries(
      text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const [key, ...valueParts] = line.split("=");
          return [
            key.trim(),
            valueParts
              .join("=")
              .trim()
              .replace(/^["']|["']$/g, ""),
          ];
        }),
    );
  } catch {
    return {};
  }
}

// Supabase 클라이언트를 한 번만 생성해 공유한다.
// 여러 곳(auth 가드, 상품 조회)에서 호출해도 같은 인스턴스를 재사용해야
// 인증 세션이 하나로 유지되고 GoTrueClient 중복 경고도 피할 수 있다.
export async function setupSupabase() {
  if (supabaseClient) return supabaseClient;

  const env = await loadSupabaseEnv();
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;

  if (!window.supabase || !url || !key) {
    console.error("Supabase 설정을 찾을 수 없습니다. (.env 파일을 확인하세요)");
    return null;
  }

  supabaseClient = window.supabase.createClient(url, key);
  return supabaseClient;
}

export function getClient() {
  return supabaseClient;
}

// 로그인한 사용자의 프로필(닉네임/관리자여부)을 조회한다.
async function fetchProfile(client, userId) {
  const { data, error } = await client
    .from("profiles")
    .select("nickname, is_admin")
    .eq("id", userId)
    .single();

  if (error) {
    console.error("프로필을 불러오지 못했습니다.", error);
    return null;
  }
  return data;
}

export async function signUp({ id, password, nickname, inviteCode }) {
  const client = await setupSupabase();
  if (!client) return { ok: false, reason: "no_client" };

  const code = String(inviteCode).trim();
  const name = String(nickname).trim();

  // 1) 가입 전 사전 검증 — 사용자에게 친절한 에러 메시지를 주기 위한 힌트 조회.
  //    실제 원자적 보장(동시 가입 경쟁 등)은 아래 auth.signUp이 발동시키는
  //    DB 트리거(handle_new_user)가 담당한다.
  const { data: precheck, error: precheckError } = await client.rpc(
    "precheck_signup",
    { p_code: code, p_nickname: name },
  );

  if (precheckError) {
    console.error("초대코드 사전 검증에 실패했습니다.", precheckError);
    return { ok: false, reason: "unknown" };
  }
  if (precheck !== "ok") {
    // invalid_code | used_code | duplicate_nickname | nickname_required
    return { ok: false, reason: precheck };
  }

  // 2) 실제 가입 — 아이디를 가짜 이메일로 변환해 넘기고,
  //    닉네임/초대코드는 트리거가 읽을 수 있도록 user metadata에 실어 보낸다.
  const { data, error } = await client.auth.signUp({
    email: idToEmail(id),
    password,
    options: { data: { nickname: name, invite_code: code } },
  });

  if (error) {
    // 이미 가입된 아이디(이메일 중복)
    if (/already registered|already exists|user already/i.test(error.message)) {
      return { ok: false, reason: "duplicate_id" };
    }
    // Auth 대시보드 최소 비밀번호 길이(기본 6자)보다 짧을 때
    if (/password/i.test(error.message) && /at least|characters|length|short/i.test(error.message)) {
      return { ok: false, reason: "password_too_short" };
    }
    console.error("회원가입에 실패했습니다.", error);
    return { ok: false, reason: "unknown" };
  }

  // 이메일 확인(Confirm email)이 켜져 있으면 세션이 발급되지 않는다.
  // 가짜 이메일은 확인 메일을 받을 수 없으므로 대시보드에서 반드시 꺼야 한다.
  if (!data.session) {
    return { ok: false, reason: "email_confirmation_required" };
  }

  const user = { id: data.user.id, nickname: name, isAdmin: false };
  state.currentUser = user;
  saveState();
  return { ok: true, user };
}

export async function signIn({ id, password }) {
  const client = await setupSupabase();
  if (!client) return { ok: false, reason: "no_client" };

  const { data, error } = await client.auth.signInWithPassword({
    email: idToEmail(id),
    password,
  });

  if (error || !data.session) {
    return { ok: false, reason: "invalid_credentials" };
  }

  const profile = await fetchProfile(client, data.user.id);
  const user = {
    id: data.user.id,
    nickname: profile?.nickname || id,
    isAdmin: Boolean(profile?.is_admin),
  };
  state.currentUser = user;
  saveState();
  return { ok: true, user };
}

// 현재 Supabase Auth 세션을 확인해 앱 세션(state.currentUser)과 동기화한다.
// 세션이 있으면 사용자 객체를, 없으면 null을 반환한다.
export async function getSession() {
  const client = await setupSupabase();
  if (!client) return null;

  const { data } = await client.auth.getSession();
  const session = data.session;

  if (!session) {
    state.currentUser = null;
    saveState();
    return null;
  }

  const profile = await fetchProfile(client, session.user.id);
  const user = {
    id: session.user.id,
    nickname: profile?.nickname || "사용자",
    isAdmin: Boolean(profile?.is_admin),
  };
  state.currentUser = user;
  saveState();
  return user;
}

export async function signOut() {
  const client = await setupSupabase();
  state.currentUser = null;
  saveState();
  if (client) await client.auth.signOut();
}
