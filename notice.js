import { state } from "./store.js";
import { getClient } from "./supabase-client.js";
import { showToast } from "./toast.js";

let root = null;
let notices = [];
let noticesLoading = true;
let currentNoticeId = null;
let editingNoticeId = null;
let activeNoticeDialog = null;
let closingNoticeDialog = null;
let restoreFocusElement = null;

const elements = {};

function isAdmin(user = state.currentUser) {
  return Boolean(user?.isAdmin);
}

function normalizeNotice(row) {
  return {
    id: row.id,
    title: row.title || "제목 없음",
    content: row.content || "",
    createdAt: row.created_at || row.createdAt || new Date().toISOString(),
    isPinned: Boolean(row.is_pinned || row.pinned),
  };
}

function sortNoticesByPriority(noticeItems) {
  return [...noticeItems].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

function createElement(tagName, className, textContent = "") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (textContent) element.textContent = textContent;
  return element;
}

function createHiddenText(text) {
  return createElement("span", "notice-sr-only", text);
}

function buildNoticeListShell() {
  const section = createElement("section", "notice-component");
  section.setAttribute("aria-labelledby", "noticeComponentTitle");

  const header = createElement("header", "notice-component-header");
  const title = createElement("h2", "", "Notice");
  title.id = "noticeComponentTitle";

  elements.createButton = createElement("button", "notice-create-button");
  elements.createButton.type = "button";
  elements.createButton.setAttribute("aria-label", "공지 작성");
  elements.createButton.title = "공지 작성";
  elements.createButton.append(
    createElement("span", "notice-create-icon", "✎"),
    createHiddenText("공지 작성"),
  );

  header.append(title, elements.createButton);

  elements.loading = createElement("div", "notice-loading");
  elements.loading.setAttribute("aria-live", "polite");
  elements.loading.setAttribute("role", "status");
  elements.loading.append(
    createElement("span", "notice-loading-dot"),
    createElement("span", "", "공지 불러오는 중"),
  );
  elements.loading.firstElementChild?.setAttribute("aria-hidden", "true");

  elements.empty = createElement("p", "notice-empty notice-hidden", "등록된 공지가 없습니다.");
  elements.list = createElement("div", "notice-list");
  elements.list.setAttribute("aria-live", "polite");

  section.append(header, elements.loading, elements.empty, elements.list);
  return section;
}

function buildDetailDialog() {
  elements.detailDialog = createElement("dialog", "notice-dialog notice-detail-dialog");
  elements.detailDialog.setAttribute("aria-labelledby", "noticeDetailTitle");

  const card = createElement("div", "notice-dialog-card");
  elements.detailCloseButton = createElement("button", "notice-dialog-close", "×");
  elements.detailCloseButton.type = "button";
  elements.detailCloseButton.setAttribute("aria-label", "공지 닫기");
  elements.detailCloseButton.title = "닫기";

  const detailView = createElement("section", "notice-detail-view");
  elements.detailTitle = createElement("h2", "");
  elements.detailTitle.id = "noticeDetailTitle";
  elements.detailContent = createElement("p", "notice-detail-content");
  detailView.append(elements.detailTitle, elements.detailContent);

  elements.detailActions = createElement("footer", "notice-dialog-actions notice-hidden");
  elements.editButton = createElement("button", "notice-action-button", "수정");
  elements.editButton.type = "button";
  elements.deleteButton = createElement("button", "notice-action-button", "삭제");
  elements.deleteButton.type = "button";
  elements.detailActions.append(elements.editButton, elements.deleteButton);

  card.append(elements.detailCloseButton, detailView, elements.detailActions);
  elements.detailDialog.append(card);
  return elements.detailDialog;
}

function buildEditorDialog() {
  elements.editorDialog = createElement("dialog", "notice-dialog notice-editor-dialog");
  elements.editorDialog.setAttribute("aria-labelledby", "noticeEditorTitle");

  const card = createElement("div", "notice-dialog-card");
  const editorTitle = createElement("h2", "notice-sr-only", "공지 작성");
  editorTitle.id = "noticeEditorTitle";

  elements.editorCloseButton = createElement("button", "notice-dialog-close", "×");
  elements.editorCloseButton.type = "button";
  elements.editorCloseButton.setAttribute("aria-label", "공지 작성 닫기");
  elements.editorCloseButton.title = "닫기";

  elements.editorForm = createElement("form", "notice-editor-form");

  const titleField = createElement("label", "notice-editor-field");
  titleField.setAttribute("for", "noticeTitleInput");
  titleField.append(createHiddenText("제목"));

  elements.titleInput = createElement("input", "");
  elements.titleInput.id = "noticeTitleInput";
  elements.titleInput.maxLength = 80;
  elements.titleInput.placeholder = "공지사항 제목";
  elements.titleInput.required = true;
  elements.titleClearButton = createElement("button", "notice-input-clear", "×");
  elements.titleClearButton.type = "button";
  elements.titleClearButton.setAttribute("aria-label", "제목 지우기");
  titleField.append(elements.titleInput, elements.titleClearButton);

  const contentField = createElement("label", "notice-editor-field notice-editor-content-field");
  contentField.setAttribute("for", "noticeContentInput");
  contentField.append(createHiddenText("내용"));

  elements.contentInput = createElement("textarea", "");
  elements.contentInput.id = "noticeContentInput";
  elements.contentInput.rows = 8;
  elements.contentInput.placeholder = "공지사항 내용";
  elements.contentInput.required = true;
  elements.contentClearButton = createElement("button", "notice-input-clear", "×");
  elements.contentClearButton.type = "button";
  elements.contentClearButton.setAttribute("aria-label", "내용 지우기");
  contentField.append(elements.contentInput, elements.contentClearButton);

  const formActions = createElement("div", "notice-dialog-actions");
  const saveButton = createElement("button", "notice-action-button", "저장");
  saveButton.type = "submit";
  formActions.append(saveButton);

  elements.editorForm.append(titleField, contentField, formActions);
  card.append(editorTitle, elements.editorCloseButton, elements.editorForm);
  elements.editorDialog.append(card);
  return elements.editorDialog;
}

function buildNoticeComponent() {
  root.replaceChildren(buildNoticeListShell());
  document.body.append(buildDetailDialog(), buildEditorDialog());
}

function createNoticeListItem(notice) {
  const item = createElement("div", "notice-item");
  item.setAttribute("role", "button");
  item.setAttribute("tabindex", "0");
  item.setAttribute("aria-label", `${notice.title} 공지 열기`);

  const title = createElement("span", "notice-title", notice.title);

  item.append(title);

  item.addEventListener("click", () => openNoticeDetail(notice, item));
  item.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openNoticeDetail(notice, item);
  });

  return item;
}

function renderNotice() {
  elements.createButton.classList.toggle("notice-hidden", !isAdmin());
  elements.list.replaceChildren();
  elements.loading.classList.toggle("notice-hidden", !noticesLoading);
  elements.list.classList.toggle("notice-hidden", noticesLoading || notices.length === 0);
  elements.empty.classList.toggle("notice-hidden", noticesLoading || notices.length > 0);

  if (noticesLoading || notices.length === 0) return;

  sortNoticesByPriority(notices).forEach((notice) => {
    elements.list.append(createNoticeListItem(notice));
  });
}

async function loadNoticesFromSupabase() {
  const client = getClient();
  if (!client) return;

  noticesLoading = true;
  renderNotice();

  const { data, error } = await client
    .from("notices")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("공지 목록을 불러오지 못했습니다.", error);
    showToast("공지 목록을 불러오지 못했습니다.", { type: "error" });
    noticesLoading = false;
    renderNotice();
    return;
  }

  notices = sortNoticesByPriority((data || []).map(normalizeNotice));
  noticesLoading = false;
  renderNotice();
}

function openNoticeDetail(notice, focusElement = document.activeElement) {
  currentNoticeId = notice.id;
  elements.detailTitle.textContent = notice.title;
  elements.detailContent.textContent = notice.content;
  elements.detailActions.classList.toggle("notice-hidden", !isAdmin());
  openNoticeDialog(elements.detailDialog, focusElement);
}

function closeNoticeDetail() {
  closeNoticeDialog(elements.detailDialog);
}

function findNoticeById(noticeId) {
  return notices.find((notice) => notice.id === noticeId);
}

function editCurrentNotice() {
  const notice = findNoticeById(currentNoticeId);
  if (!notice || !isAdmin()) return;

  closeNoticeDetail();
  window.setTimeout(() => openNoticeEditor(notice), 190);
}

function openNoticeEditor(notice = null) {
  if (!isAdmin()) return;

  editingNoticeId = notice?.id || null;
  elements.titleInput.value = notice?.title || "";
  elements.contentInput.value = notice?.content || "";
  openNoticeDialog(elements.editorDialog);
}

function closeNoticeEditor() {
  closeNoticeDialog(elements.editorDialog);
}

function getFocusableElements(container) {
  return Array.from(
    container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => {
    return !element.closest(".notice-hidden") && element.getClientRects().length > 0;
  });
}

function focusFirstNoticeControl(dialog) {
  const firstInput = dialog.querySelector("input, textarea");
  if (firstInput && firstInput.getClientRects().length > 0) {
    firstInput.focus();
    return;
  }

  getFocusableElements(dialog)[0]?.focus();
}

function openNoticeDialog(dialog, focusElement = document.activeElement) {
  restoreFocusElement = focusElement;
  activeNoticeDialog = dialog;
  document.body.classList.add("notice-modal-open");
  dialog.classList.remove("closing");
  dialog.showModal();
  window.setTimeout(() => focusFirstNoticeControl(dialog), 0);
}

function closeNoticeDialog(dialog) {
  if (!dialog?.open || closingNoticeDialog === dialog) return;

  closingNoticeDialog = dialog;
  dialog.classList.add("closing");
  window.setTimeout(() => {
    if (dialog.open) dialog.close();
  }, 180);
}

function handleNoticeDialogClosed(dialog) {
  dialog.classList.remove("closing");

  if (activeNoticeDialog === dialog) {
    activeNoticeDialog = null;
  }

  if (!elements.detailDialog.open && !elements.editorDialog.open) {
    document.body.classList.remove("notice-modal-open");
  }

  if (closingNoticeDialog === dialog) {
    closingNoticeDialog = null;
  }

  if (restoreFocusElement?.isConnected) {
    restoreFocusElement.focus();
  }
  restoreFocusElement = null;
}

function handleNoticeDialogKeydown(event) {
  if (!activeNoticeDialog?.open) return;

  if (event.key === "Escape") {
    event.preventDefault();
    if (activeNoticeDialog === elements.editorDialog) return;
    closeNoticeDialog(activeNoticeDialog);
    return;
  }

  if (event.key !== "Tab") return;

  const focusableElements = getFocusableElements(activeNoticeDialog);
  if (!focusableElements.length) {
    event.preventDefault();
    activeNoticeDialog.focus();
    return;
  }

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  if (event.shiftKey && document.activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus();
  } else if (!event.shiftKey && document.activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus();
  }
}

function getNoticeFormValues() {
  return {
    title: elements.titleInput.value.trim(),
    content: elements.contentInput.value.trim(),
  };
}

function isValidNoticeFormValues({ title, content }) {
  return Boolean(title && content);
}

async function createNotice(payload) {
  return getClient().from("notices").insert(payload);
}

async function updateNotice(noticeId, payload) {
  return getClient().from("notices").update(payload).eq("id", noticeId);
}

async function saveNoticeForm() {
  if (!isAdmin()) return false;

  const formValues = getNoticeFormValues();

  if (!isValidNoticeFormValues(formValues)) {
    showToast("공지 제목과 내용을 모두 입력해주세요.", { type: "error" });
    return false;
  }

  const { error } = editingNoticeId
    ? await updateNotice(editingNoticeId, formValues)
    : await createNotice(formValues);

  if (error) {
    console.error("공지를 저장하지 못했습니다.", error);
    showToast("공지를 저장하지 못했습니다.", { type: "error" });
    return false;
  }

  showToast(
    editingNoticeId ? "공지가 수정되었습니다." : "공지가 등록되었습니다.",
    { type: "success" },
  );
  closeNoticeEditor();
  await loadNoticesFromSupabase();
  return true;
}

async function deleteNotice(notice) {
  if (!isAdmin()) return false;
  if (!window.confirm("이 공지를 삭제할까요?")) return false;

  const { error } = await getClient()
    .from("notices")
    .delete()
    .eq("id", notice.id);

  if (error) {
    console.error("공지를 삭제하지 못했습니다.", error);
    showToast("공지를 삭제하지 못했습니다.", { type: "error" });
    return false;
  }

  showToast("공지가 삭제되었습니다.", { type: "success" });
  await loadNoticesFromSupabase();
  return true;
}

async function deleteCurrentNotice() {
  const notice = findNoticeById(currentNoticeId);
  if (!notice || !isAdmin()) return;

  if (await deleteNotice(notice)) {
    closeNoticeDetail();
  }
}

function bindNoticeEvents() {
  elements.createButton.addEventListener("click", () => openNoticeEditor());
  elements.detailCloseButton.addEventListener("click", closeNoticeDetail);
  elements.editButton.addEventListener("click", editCurrentNotice);
  elements.deleteButton.addEventListener("click", deleteCurrentNotice);
  elements.editorCloseButton.addEventListener("click", closeNoticeEditor);
  elements.titleClearButton.addEventListener("click", (event) => {
    event.preventDefault();
    elements.titleInput.value = "";
    elements.titleInput.focus();
  });
  elements.contentClearButton.addEventListener("click", (event) => {
    event.preventDefault();
    elements.contentInput.value = "";
    elements.contentInput.focus();
  });
  elements.editorForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveNoticeForm();
  });

  elements.detailDialog.addEventListener("keydown", handleNoticeDialogKeydown);
  elements.editorDialog.addEventListener("keydown", handleNoticeDialogKeydown);

  elements.detailDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeNoticeDetail();
  });
  elements.editorDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
  });

  elements.detailDialog.addEventListener("click", (event) => {
    if (event.target === elements.detailDialog) closeNoticeDetail();
  });
  elements.editorDialog.addEventListener("click", (event) => {
    if (event.target === elements.editorDialog) event.preventDefault();
  });

  elements.detailDialog.addEventListener("close", () => {
    currentNoticeId = null;
    handleNoticeDialogClosed(elements.detailDialog);
  });
  elements.editorDialog.addEventListener("close", () => {
    editingNoticeId = null;
    elements.editorForm.reset();
    handleNoticeDialogClosed(elements.editorDialog);
  });
}

export async function initNotice() {
  root = document.querySelector("#noticeRoot");
  if (!root) return;

  buildNoticeComponent();
  bindNoticeEvents();
  renderNotice();
  await loadNoticesFromSupabase();
}
