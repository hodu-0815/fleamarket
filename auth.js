import { state, saveState } from "./store.js";
import { normalizeNickname } from "./utils.js";
import { signUp } from "./supabase-client.js";
import { showToast } from "./toast.js";

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

let onAuthSuccess = null;

export function init(options = {}) {
  onAuthSuccess = options.onAuthSuccess ?? null;

  const loginForm = document.querySelector("#loginForm");
  const signupForm = document.querySelector("#signupForm");
  const loginSwitchRow = document.querySelector("#loginSwitchRow");
  const backToLoginRow = document.querySelector("#backToLoginRow");
  const showSignupButton = document.querySelector("#showSignupButton");
  const showLoginButton = document.querySelector("#showLoginButton");
  const authTitle = document.querySelector("#loginTitle");

  if (!signupForm || !loginForm) return;

  function setMode(mode) {
    const signup = mode === "signup";
    signupForm.classList.toggle("hidden", !signup);
    backToLoginRow?.classList.toggle("hidden", !signup);
    loginForm.classList.toggle("hidden", signup);
    loginSwitchRow?.classList.toggle("hidden", signup);
    if (authTitle) authTitle.textContent = signup ? "회원가입" : "간단 로그인";
    if (signup) clearFieldErrors();
  }

  showSignupButton?.addEventListener("click", () => setMode("signup"));
  showLoginButton?.addEventListener("click", () => setMode("login"));
  signupForm.addEventListener("submit", handleSignup);
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

async function handleSignup(event) {
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

  state.currentUser = {
    id: result.user.id,
    nickname: result.user.nickname,
    isAdmin: result.user.isAdmin,
  };
  saveState();
  form.reset();
  showToast(`${result.user.nickname}님, 가입을 환영해요!`, { type: "success" });
  onAuthSuccess?.();
}
