import { state } from "./store.js";
import { normalizeNickname } from "./utils.js";
import {
  signUp,
  signIn,
  signOut,
  getSession,
  updateProfile,
  uploadAvatar,
} from "./supabase-client.js";
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
  password_too_short: "비밀번호는 6자 이상이어야 합니다.",
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

// signup.html의 회원가입 폼(#signupForm)을 바인딩한다. 성공 시 자동 로그인 + 온보딩 팝업.
export function initSignup({ onSuccess } = {}) {
  const signupForm = document.querySelector("#signupForm");
  if (!signupForm) return;

  // 가입 성공 직후 띄울 선택 프로필 입력 팝업을 미리 바인딩해 둔다.
  // (팝업 저장/스킵이 끝나야 onSuccess로 메인 이동하므로 open은 handleSignup에서 호출)
  const onboarding = initSignupOnboarding(onSuccess);

  signupForm.addEventListener("submit", (event) =>
    handleSignup(event, onboarding),
  );
}

// ---- 가입 직후 온보딩(선택 프로필) 팝업 ------------------------------------
// 마이페이지 프로필 폼과 같은 선택 항목(관계/자기소개/방문시간/저녁/사진)을 받는다.
// mypage.js의 헬퍼는 export돼 있지 않아, 팝업 전용 최소 헬퍼를 여기서 국소적으로 재현한다.

// 저장 대신 "미정"으로 안전하게 처리할 저녁 값 목록
const DINNER_CHOICES = ["undecided", "yes", "no"];

// 닉네임 앞글자로 이니셜 플레이스홀더를 만든다 (사진 미선택 시 표시)
function getInitials(nickname) {
  const text = String(nickname || "").trim();
  if (!text) return "?";
  return Array.from(text)[0];
}

function initSignupOnboarding(onSuccess) {
  const modal = document.querySelector("#signupOnboardingModal");
  // 팝업 마크업이 없으면(구버전 페이지 등) 온보딩 없이 바로 이동하도록 폴백을 준다
  if (!modal) {
    return { open: () => onSuccess?.() };
  }

  const nicknameLabel = modal.querySelector("#onboardingNickname");
  const relationshipInput = modal.querySelector("#onboardingRelationship");
  const bioInput = modal.querySelector("#onboardingBio");
  const visitTimeInput = modal.querySelector("#onboardingVisitTime");
  const dinnerGroup = modal.querySelector("#onboardingDinnerInput");
  const dinnerButtons = dinnerGroup
    ? dinnerGroup.querySelectorAll(".choice-button")
    : [];
  const avatarInput = modal.querySelector("#onboardingAvatarInput");
  const avatarImage = modal.querySelector("#onboardingAvatarImage");
  const avatarInitials = modal.querySelector("#onboardingAvatarInitials");
  const saveButton = modal.querySelector("#onboardingSaveButton");
  const skipButton = modal.querySelector("#onboardingSkipButton");

  // 허용된 값만 반영하고, 나머지는 안전하게 "미정"으로 처리한다
  function setDinnerValue(value) {
    const next = DINNER_CHOICES.includes(value) ? value : "undecided";
    dinnerButtons.forEach((button) => {
      const isSelected = button.dataset.value === next;
      button.classList.toggle("active", isSelected);
      button.setAttribute("aria-pressed", isSelected ? "true" : "false");
    });
  }

  // 현재 선택된 저녁 버튼 값을 읽는다. 선택이 없으면 "미정"
  function getDinnerValue() {
    const active = dinnerGroup?.querySelector(".choice-button.active");
    return active ? active.dataset.value : "undecided";
  }

  // 사진 미선택 상태: 이니셜만 보이도록 초기화한다
  function renderAvatarPlaceholder(nickname) {
    avatarImage.classList.add("hidden");
    avatarImage.removeAttribute("src");
    avatarImage.alt = "";
    avatarInitials.classList.remove("hidden");
    avatarInitials.textContent = getInitials(nickname);
  }

  // 저장 전 로컬 미리보기: 선택한 파일을 즉시 원형 썸네일에 보여준다
  avatarInput.addEventListener("change", () => {
    const file = avatarInput.files?.[0];
    if (!file) {
      renderAvatarPlaceholder(state.currentUser?.nickname);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    avatarInitials.classList.add("hidden");
    avatarImage.classList.remove("hidden");
    avatarImage.src = objectUrl;
    avatarImage.alt = "선택한 프로필 사진 미리보기";
  });

  dinnerButtons.forEach((button) => {
    button.addEventListener("click", () => setDinnerValue(button.dataset.value));
  });

  // 저장: 사진이 있으면 업로드 후 URL을 포함해 프로필을 갱신한다.
  // 업로드 실패 시에는 팝업을 유지해 다시 시도할 수 있게 한다.
  async function handleSave() {
    saveButton.disabled = true;
    try {
      let avatarUrl = "";
      const file = avatarInput.files?.[0];
      if (file) {
        try {
          avatarUrl = await uploadAvatar(file);
        } catch (error) {
          console.error("프로필 사진을 업로드하지 못했습니다.", error);
          showToast("프로필 사진을 업로드하지 못했습니다.", { type: "error" });
          return;
        }
      }

      const result = await updateProfile({
        relationship: relationshipInput.value.trim(),
        bio: bioInput.value.trim(),
        visitTime: visitTimeInput.value.trim(),
        dinner: getDinnerValue(),
        avatarUrl,
      });

      if (!result.ok) {
        showToast("프로필을 저장하지 못했습니다.", { type: "error" });
        return;
      }

      modal.close();
      onSuccess?.();
    } finally {
      saveButton.disabled = false;
    }
  }

  // 나중에 하기: 저장 없이 팝업만 닫고 메인으로 이동한다 (모두 선택 항목이므로)
  function handleSkip() {
    modal.close();
    onSuccess?.();
  }

  saveButton.addEventListener("click", handleSave);
  skipButton.addEventListener("click", handleSkip);

  // 가입 성공 직후 호출된다. 닉네임/기본값으로 초기화한 뒤 팝업을 연다.
  function open() {
    nicknameLabel.textContent = state.currentUser?.nickname || "";
    relationshipInput.value = "";
    bioInput.value = "";
    visitTimeInput.value = "";
    setDinnerValue("undecided");
    avatarInput.value = "";
    renderAvatarPlaceholder(state.currentUser?.nickname);
    modal.showModal();
  }

  return { open };
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

  // Supabase Auth 기본 최소 길이가 6자라 프론트도 맞춰 미리 막는다
  if (!password) {
    errors.password = "비밀번호를 입력해주세요.";
  } else if (password.length < 6) {
    errors.password = "비밀번호는 6자 이상이어야 합니다.";
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
  password_too_short: "password",
  duplicate_id: "id",
  duplicate_nickname: "nickname",
  nickname_required: "nickname",
};

async function handleSignup(event, onboarding) {
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

  // 세션은 signUp 내부에서 state.currentUser에 채워져 자동 로그인 상태가 된다.
  // 선택 프로필(관계/자기소개/방문시간/저녁/사진)은 곧바로 메인으로 보내지 않고
  // 온보딩 팝업에서 받는다. 저장/나중에 하기 어느 쪽이든 끝나면 onSuccess로 이동한다.
  form.reset();
  showToast(`${result.user.nickname}님, 가입을 환영해요!`, { type: "success" });
  onboarding.open();
}
