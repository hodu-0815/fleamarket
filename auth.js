import { normalizeNickname } from "./utils.js";
import { signUp, signIn, signOut, getSession } from "./supabase-client.js";
import { showToast } from "./toast.js";

const FIELD_ERROR_IDS = {
  id: "signupIdError",
  password: "signupPasswordError",
  passwordConfirm: "signupPasswordConfirmError",
  nickname: "signupNicknameError",
  inviteCode: "signupInviteError",
};

// supabase-client의 reason 코드를 사용자 문구로 매핑한다
const REASON_MESSAGES = {
  invalid_code: "존재하지 않는 초대코드입니다.",
  used_code: "이미 사용된 초대코드입니다.",
  duplicate_id: "이미 사용 중인 아이디입니다.",
  duplicate_nickname: "이미 사용 중인 닉네임입니다.",
  nickname_required: "닉네임을 입력해주세요.",
  invalid_credentials: "아이디 또는 비밀번호가 맞지 않습니다.",
  email_confirmation_required:
    "이메일 확인 설정이 켜져 있어 가입을 완료할 수 없습니다. 관리자에게 문의해주세요.",
  no_client: "서버 연결에 실패했습니다. 잠시 후 다시 시도해주세요.",
  unknown: "회원가입에 실패했습니다. 잠시 후 다시 시도해주세요.",
};

// ---- 세션 가드 ------------------------------------------------------------
// 세션 판단 + 페이지 이동을 이 모듈 한 곳에 모아, 각 페이지 진입점의 중복을 없앤다.
// Supabase Auth 세션은 비동기로 확인되므로 가드 함수도 async로 동작한다.

// 보호된 페이지(index)용: 로그인 안 돼 있으면 로그인 페이지로 돌려보낸다
export async function requireAuth(loginUrl = "login.html") {
  const user = await getSession();
  if (!user) {
    window.location.replace(loginUrl);
    return false;
  }
  return true;
}

// 로그인/회원가입 페이지용: 이미 로그인 상태면 메인으로 돌려보낸다
export async function requireGuest(homeUrl = "index.html") {
  const user = await getSession();
  if (user) {
    window.location.replace(homeUrl);
    return false;
  }
  return true;
}

// 로그아웃: Supabase 세션을 정리하고 로그인 페이지로 이동한다
export async function logout(loginUrl = "login.html") {
  await signOut();
  window.location.href = loginUrl;
}

// ---- 로그인 --------------------------------------------------------------

// login.html의 로그인 폼(#loginForm)을 바인딩한다. 성공 시 onSuccess로 이동 위임.
export function initLogin({ onSuccess } = {}) {
  const loginForm = document.querySelector("#loginForm");
  if (!loginForm) return;

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(loginForm);
    const id = String(formData.get("id") || "").trim();
    const password = String(formData.get("password") || "").trim();

    if (!id || password.length < 2) return;

    const result = await signIn({ id, password });
    if (!result.ok) {
      showToast(REASON_MESSAGES[result.reason] || REASON_MESSAGES.unknown, {
        type: "error",
      });
      return;
    }

    // 세션은 signIn 내부에서 state.currentUser에 채워진다
    loginForm.reset();
    onSuccess?.();
  });
}

// ---- 회원가입 ------------------------------------------------------------

// signup.html의 회원가입 폼(#signupForm)을 바인딩한다. 성공 시 자동 로그인 + onSuccess.
export function initSignup({ onSuccess } = {}) {
  const signupForm = document.querySelector("#signupForm");
  if (!signupForm) return;

  signupForm.addEventListener("submit", (event) =>
    handleSignup(event, onSuccess),
  );
}

function clearFieldErrors() {
  Object.values(FIELD_ERROR_IDS).forEach((elementId) => {
    const el = document.querySelector(`#${elementId}`);
    if (el) el.textContent = "";
  });
}

function showFieldErrors(errors) {
  Object.entries(errors).forEach(([field, message]) => {
    const el = document.querySelector(`#${FIELD_ERROR_IDS[field]}`);
    if (el) el.textContent = message;
  });
}

function validate({ id, password, passwordConfirm, nickname, inviteCode }) {
  const errors = {};

  if (!id) {
    errors.id = "아이디를 입력해주세요.";
  } else if (!/^[A-Za-z0-9_]{4,20}$/.test(id)) {
    errors.id = "아이디는 영문/숫자/_ 4~20자로 입력해주세요.";
  }

  if (!password) {
    errors.password = "비밀번호를 입력해주세요.";
  } else if (password.length < 4) {
    errors.password = "비밀번호는 4자 이상이어야 합니다.";
  }

  if (password && passwordConfirm !== password) {
    errors.passwordConfirm = "비밀번호가 일치하지 않습니다.";
  }

  if (!nickname) {
    errors.nickname = "닉네임을 입력해주세요.";
  } else if (nickname.length > 16) {
    errors.nickname = "닉네임은 16자 이하로 입력해주세요.";
  }

  if (!inviteCode) {
    errors.inviteCode = "초대코드를 입력해주세요.";
  }

  return errors;
}

// 회원가입 reason 중 특정 입력 필드에 붙여야 자연스러운 것들은 필드 에러로 표시한다
const FIELD_REASONS = {
  invalid_code: "inviteCode",
  used_code: "inviteCode",
  duplicate_id: "id",
  duplicate_nickname: "nickname",
  nickname_required: "nickname",
};

async function handleSignup(event, onSuccess) {
  event.preventDefault();
  clearFieldErrors();

  const form = event.currentTarget;
  const formData = new FormData(form);
  const id = String(formData.get("id") || "").trim();
  const password = String(formData.get("password") || "");
  const passwordConfirm = String(formData.get("passwordConfirm") || "");
  const nickname = normalizeNickname(String(formData.get("nickname") || ""));
  const inviteCode = String(formData.get("inviteCode") || "").trim();

  const errors = validate({
    id,
    password,
    passwordConfirm,
    nickname,
    inviteCode,
  });
  if (Object.keys(errors).length > 0) {
    showFieldErrors(errors);
    return;
  }

  const result = await signUp({ id, password, nickname, inviteCode });
  if (!result.ok) {
    const message = REASON_MESSAGES[result.reason] || REASON_MESSAGES.unknown;
    // 초대코드/아이디/닉네임 문제는 해당 입력칸 아래에 붙여 보여준다
    const field = FIELD_REASONS[result.reason];
    if (field) {
      showFieldErrors({ [field]: message });
    } else {
      showToast(message, { type: "error" });
    }
    return;
  }

  // 세션은 signUp 내부에서 state.currentUser에 채워져 자동 로그인 상태가 된다
  form.reset();
  showToast(`${result.user.nickname}님, 가입을 환영해요!`, { type: "success" });
  onSuccess?.();
}
