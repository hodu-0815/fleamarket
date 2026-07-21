function ensureContainer() {
  let container = document.querySelector("#toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.className = "toast-container";
    container.setAttribute("aria-live", "polite");
    document.body.append(container);
  }
  return container;
}

export function showToast(message, { type = "info", duration = 2600 } = {}) {
  const container = ensureContainer();

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.setAttribute("aria-live", type === "error" ? "assertive" : "polite");
  toast.textContent = message;
  container.append(toast);

  requestAnimationFrame(() => toast.classList.add("show"));

  window.setTimeout(() => {
    toast.classList.remove("show");
    toast.addEventListener("transitionend", () => toast.remove(), {
      once: true,
    });
    window.setTimeout(() => toast.remove(), 400);
  }, duration);
}
