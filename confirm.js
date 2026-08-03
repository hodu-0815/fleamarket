// 공통 확인 팝업(showConfirm): 브라우저 기본 window.confirm을 대체하는 Promise 기반 다이얼로그.
// 사용자가 확인을 누르면 true, 취소/배경 클릭/ESC면 false로 resolve한다.
// 스타일은 styles.css의 .confirm-modal / .confirm-panel / .confirm-actions 규칙을 그대로 사용한다.

// message: 표시할 문구
// options.confirmText / cancelText: 버튼 라벨
// options.tone: "danger"면 확인 버튼을 위험(빨강) 스타일로 강조
// options.title: 있을 때만 제목 줄을 추가
export function showConfirm(message, options = {}) {
  const {
    confirmText = "확인",
    cancelText = "취소",
    tone = "default",
    title = "",
  } = options;

  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "confirm-modal";

    const panel = document.createElement("div");
    panel.className = "confirm-panel";

    // 제목은 선택 사항이라 값이 있을 때만 넣는다
    if (title) {
      const titleEl = document.createElement("h2");
      titleEl.className = "confirm-title";
      titleEl.textContent = title;
      panel.append(titleEl);
    }

    const messageEl = document.createElement("p");
    messageEl.className = "confirm-message";
    messageEl.textContent = message;

    const actions = document.createElement("div");
    actions.className = "confirm-actions";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "secondary-button";
    cancelButton.textContent = cancelText;

    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    // 삭제처럼 위험한 동작은 tone: "danger"로 확인 버튼을 강조한다
    confirmButton.className =
      tone === "danger" ? "primary-button danger" : "primary-button";
    confirmButton.textContent = confirmText;

    actions.append(cancelButton, confirmButton);
    panel.append(messageEl, actions);
    dialog.append(panel);
    document.body.append(dialog);

    // 여러 경로(확인/취소/배경/ESC)로 닫히므로 한 번만 정리·resolve 되도록 가드를 둔다
    let settled = false;
    const close = (result) => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(result);
    };

    confirmButton.addEventListener("click", () => close(true));
    cancelButton.addEventListener("click", () => close(false));
    // 다이얼로그 바깥(배경)을 누르면 취소로 처리한다
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) close(false);
    });
    // ESC 등 네이티브 취소도 false로 통일한다
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close(false);
    });

    dialog.showModal();
    // 기본 포커스는 확인 버튼에 둔다
    confirmButton.focus();
  });
}
