import { state, saveState } from "./store.js";
import { normalizeNickname } from "./utils.js";
import { signUp } from "./supabase-client.js";
import { showToast } from "./toast.js";

// 관리자 계정은 별도 회원가입 없이 고정 자격증명으로만 로그인한다
const ADMIN_NICKNAME = "admin";
const ADMIN_PASSWORD = "admin1234";

const FIELD_ERROR_IDS = {
  id: "signupIdError",
  password: "signupPasswordError",
  passwordConfirm: "signupPasswordConfirmError",
  nickname: "signupNicknameError",
  inviteCode: "signupInviteError",
};

const REASON_MESSAGES = {
  invalid_code: "존재하지 않는 초대코드입니다.",
  used_code: "이미 사용된 초대코드입니다.",
  duplicate_id: "이미 사용 중인 아이디입니다.",
};

// ---- 세션 가드 ------------------------------------------------------------
// 세션 판단 + 페이지 이동을 이 모듈 한 곳에 모아, 각 페이지 진입점의 중복을 없앤다.

// 보호된 페이지(index)용: 로그인 안 돼 있으면 로그인 페이지로 돌려보낸다
export function requireAuth(loginUrl = "login.html") {
  if (!state.currentUser) {
    window.location.replace(loginUrl);
    return false;
  }
  return true;
}

// 로그인/회원가입 페이지용: 이미 로그인 상태면 메인으로 돌려보낸다
export function requireGuest(homeUrl = "index.html") {
  if (state.currentUser) {
    window.location.replace(homeUrl);
    return false;
  }
  return true;
}

// 로그아웃: 세션을 비우고 로그인 페이지로 이동한다
export function logout(loginUrl = "login.html") {
  state.currentUser = null;
  saveState();
  window.location.href = loginUrl;
}

// ---- 로그인 --------------------------------------------------------------

// login.html의 로그인 폼(#loginForm)을 바인딩한다. 성공 시 onSuccess로 이동 위임.
export function initLogin({ onSuccess } = {}) {
  const loginForm = document.querySelector("#loginForm");
  if (!loginForm) return;

  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const formData = new FormData(loginForm);
    const nickname = normalizeNickname(String(formData.get("nickname") || ""));
    const password = String(formData.get("password") || "").trim();

    if (!nickname || password.length < 2) return;

    // 기존에 로그인한 적 있는 닉네임이면 비밀번호가 일치해야 통과
    if (state.users[nickname] && state.users[nickname].password !== password) {
      showToast("비밀번호가 맞지 않습니다.", { type: "error" });
      return;
    }

    const isAdminLogin =
      nickname === ADMIN_NICKNAME && password === ADMIN_PASSWORD;

    // admin 닉네임인데 관리자 비밀번호가 아니면 일반 로그인으로 흘리지 않고 차단
    if (nickname === ADMIN_NICKNAME && !isAdminLogin) {
      showToast("관리자 비밀번호가 맞지 않습니다.", { type: "error" });
      return;
    }

    state.users[nickname] = {
      password,
      isAdmin: isAdminLogin,
    };
    state.currentUser = {
      nickname,
      isAdmin: isAdminLogin,
    };

    saveState();
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
    showToast(REASON_MESSAGES[result.reason] || "회원가입에 실패했습니다.", {
      type: "error",
    });
    return;
  }

  // 가입 성공 시 곧바로 세션을 채워 자동 로그인 상태로 만든다
  state.currentUser = {
    id: result.user.id,
    nickname: result.user.nickname,
    isAdmin: result.user.isAdmin,
  };
  saveState();
  form.reset();
  showToast(`${result.user.nickname}님, 가입을 환영해요!`, { type: "success" });
  onSuccess?.();
}
