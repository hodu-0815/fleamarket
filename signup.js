import { initSignup, requireGuest } from "./auth.js";

// 이미 로그인한 사용자는 회원가입 화면 대신 메인으로 보낸다
if (requireGuest()) {
  // 가입 성공 시 자동 로그인된 상태로 메인 피드로 이동 (세션 저장은 auth.js가 처리)
  initSignup({ onSuccess: () => (window.location.href = "index.html") });
}
