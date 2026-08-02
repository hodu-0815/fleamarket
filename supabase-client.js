import { state, saveState, createEmptyProfile } from "./store.js";

// 아이디를 Supabase Auth용 "가짜 이메일"로 변환한다.
// 실제 이메일을 수집하지 않기로 했기 때문에, 아이디에 고정 도메인을 붙여
// 이메일 형식만 맞춰서 Auth에 넘긴다. (예: hanim -> hanim@fleamarket.local)
const FAKE_EMAIL_DOMAIN = "fleamarket.local";
const AVATAR_BUCKET = "avatars";
const DINNER_VALUES = new Set(["yes", "no", "undecided"]);

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

// DB row → state.profile shape
function normalizeProfile(row) {
  const empty = createEmptyProfile();
  if (!row) return empty;

  const dinner = DINNER_VALUES.has(row.dinner) ? row.dinner : "undecided";

  return {
    relationship: row.relationship || "",
    bio: row.bio || "",
    visitTime: row.visit_time || "",
    dinner,
    avatarUrl: row.avatar_url || "",
  };
}

// currentUser + profile을 한곳에서 동기화한다
function applySessionUser(userId, profileRow, fallbackNickname) {
  const nickname = profileRow?.nickname || fallbackNickname || "사용자";
  state.currentUser = {
    id: userId,
    nickname,
    isAdmin: Boolean(profileRow?.is_admin),
  };
  state.profile = normalizeProfile(profileRow);
  saveState();
  return state.currentUser;
}

function clearSession() {
  state.currentUser = null;
  state.profile = null;
  saveState();
}

// 로그인한 사용자의 프로필(닉네임/관리자/확장 필드)을 조회한다.
async function fetchProfile(client, userId) {
  const { data, error } = await client
    .from("profiles")
    .select(
      "nickname, is_admin, relationship, bio, visit_time, dinner, avatar_url",
    )
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
    if (
      /password/i.test(error.message) &&
      /at least|characters|length|short/i.test(error.message)
    ) {
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

  // 가입 직후엔 확장 필드가 비어 있으므로 빈 profile로 세션을 채운다
  applySessionUser(
    data.user.id,
    { nickname: name, is_admin: false },
    name,
  );
  return { ok: true, user: state.currentUser };
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
  const user = applySessionUser(data.user.id, profile, id);
  return { ok: true, user };
}

// 현재 Supabase Auth 세션을 확인해 앱 세션(state.currentUser/profile)과 동기화한다.
// 세션이 있으면 사용자 객체를, 없으면 null을 반환한다.
export async function getSession() {
  const client = await setupSupabase();
  if (!client) return null;

  const { data } = await client.auth.getSession();
  const session = data.session;

  if (!session) {
    clearSession();
    return null;
  }

  const profile = await fetchProfile(client, session.user.id);
  return applySessionUser(session.user.id, profile, "사용자");
}

export async function signOut() {
  const client = await setupSupabase();
  clearSession();
  if (client) await client.auth.signOut();
}

// 본인 프로필 확장 필드를 갱신한다 (닉네임/is_admin은 건드리지 않음)
export async function updateProfile({
  relationship,
  bio,
  visitTime,
  dinner,
  avatarUrl,
}) {
  const client = await setupSupabase();
  if (!client) return { ok: false, reason: "no_client" };

  const userId = state.currentUser?.id;
  if (!userId) return { ok: false, reason: "no_session" };

  const nextDinner = DINNER_VALUES.has(dinner) ? dinner : "undecided";
  const payload = {
    relationship: String(relationship || "").trim() || null,
    bio: String(bio || "").trim() || null,
    visit_time: String(visitTime || "").trim() || null,
    dinner: nextDinner,
    avatar_url: String(avatarUrl || "").trim() || null,
  };

  const { data, error } = await client
    .from("profiles")
    .update(payload)
    .eq("id", userId)
    .select(
      "nickname, is_admin, relationship, bio, visit_time, dinner, avatar_url",
    )
    .single();

  if (error) {
    console.error("프로필을 저장하지 못했습니다.", error);
    return { ok: false, reason: "unknown" };
  }

  applySessionUser(userId, data, state.currentUser.nickname);
  return { ok: true, profile: state.profile };
}

// 상품 찜(likes)을 서버에 저장한다.
// likes는 찜한 사용자의 닉네임 배열이며, products.likes(text[]) 컬럼에 그대로 반영한다.
// 토글(추가/삭제) 판단은 호출부(도메인)에서 하고, 여기서는 최종 배열을 저장만 한다.
export async function updateProductLikes(productId, likes) {
  const client = await setupSupabase();
  if (!client) return { ok: false, reason: "no_client" };

  const { data, error } = await client
    .from("products")
    .update({ likes })
    .eq("id", productId)
    .select("likes")
    .single();

  if (error) {
    console.error("찜 정보를 저장하지 못했습니다.", error);
    return { ok: false, reason: "unknown" };
  }

  // 서버가 확정한 likes를 돌려줘 호출부가 로컬 상태를 맞출 수 있게 한다
  return { ok: true, likes: Array.isArray(data?.likes) ? data.likes : [] };
}

// 아바타 이미지를 avatars 버킷에 올리고 public URL을 반환한다
export async function uploadAvatar(file) {
  const client = await setupSupabase();
  if (!client) throw new Error("no_client");

  const userId = state.currentUser?.id;
  if (!userId) throw new Error("no_session");

  const extension = file.name.split(".").pop() || "png";
  const safeName =
    file.name
      .replace(/\.[^/.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 48) || "avatar";
  const uniqueId =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  // RLS가 path 첫 세그먼트를 auth.uid()와 비교하므로 userId 폴더 아래에 둔다
  const filePath = `${userId}/${Date.now()}-${uniqueId}-${safeName}.${extension}`;

  const { error } = await client.storage.from(AVATAR_BUCKET).upload(filePath, file, {
    cacheControl: "3600",
    upsert: false,
  });

  if (error) throw error;

  const { data } = client.storage.from(AVATAR_BUCKET).getPublicUrl(filePath);
  return data.publicUrl;
}
