import { initLogin, requireGuest } from "./auth.js";

// 이미 로그인한 사용자는 로그인 화면을 볼 필요 없이 메인으로 보낸다
if (requireGuest()) {
  // 로그인 성공 시 메인 피드로 이동 (세션 저장은 auth.js가 처리)
  initLogin({ onSuccess: () => (window.location.href = "index.html") });
}
