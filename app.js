import { state, saveState, defaultNotice } from "./store.js";
import { escapeHtml, formatPrice, formatDate } from "./utils.js";
import { requireAuth, logout } from "./auth.js";
import { setupSupabase, getClient } from "./supabase-client.js";

const sessionPanel = document.querySelector("#sessionPanel");
const noticeCopy = document.querySelector("#noticeCopy");
const noticeEditor = document.querySelector("#noticeEditor");
const noticeInput = document.querySelector("#noticeInput");
const editNoticeButton = document.querySelector("#editNoticeButton");
const cancelNoticeButton = document.querySelector("#cancelNoticeButton");
const productGrid = document.querySelector("#productGrid");
const productTemplate = document.querySelector("#productTemplate");
const marketCount = document.querySelector("#marketCount");
const tabButtons = document.querySelectorAll(".tab-button");
const viewPanels = document.querySelectorAll("[data-view-panel]");
const adminHelp = document.querySelector("#adminHelp");

// 관리자 여부는 profiles.is_admin 플래그로 판정한다(닉네임 하드코딩 제거).
function isAdmin(user = state.currentUser) {
  return Boolean(user?.isAdmin);
}

function normalizeProduct(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    price: Number(row.price || 0),
    category: row.category || "기타",
    image: row.image || "",
    seller: row.seller || "알 수 없음",
    createdAt: row.created_at || new Date().toISOString(),
  };
}

async function loadProductsFromSupabase() {
  const client = getClient();
  if (!client) {
    state.products = [];
    renderProducts();
    return;
  }

  const { data, error } = await client
    .from("products")
    .select("id, name, description, price, category, image, seller, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("상품 목록을 불러오지 못했습니다.", error);
    state.products = [];
    renderProducts();
    return;
  }

  state.products = (data || []).map(normalizeProduct);
  renderProducts();
}

function renderSession() {
  const user = state.currentUser;

  // 가드(requireAuth)를 통과해야 index에 도달하지만, 방어적으로 안내만 노출한다
  if (!user) {
    sessionPanel.innerHTML = `
      <strong>로그인이 필요합니다</strong>
      <p>판매 글 등록과 찜 기능을 사용하려면 입장해주세요.</p>
    `;
    return;
  }

  sessionPanel.innerHTML = `
    <strong>${escapeHtml(user.nickname)}${isAdmin(user) ? " · 관리자" : ""}</strong>
    <p>${isAdmin(user) ? "공지 편집 권한이 있습니다." : "판매 등록과 찜하기가 가능합니다."}</p>
    <button class="secondary-button" id="logoutButton" type="button">나가기</button>
  `;

  // 로그아웃은 세션 정리 + 로그인 페이지 이동을 auth.js로 위임
  document.querySelector("#logoutButton").addEventListener("click", () => {
    logout();
  });
}

function renderNotice() {
  noticeCopy.innerHTML = `<p>${escapeHtml(state.notice)}</p>`;
  noticeInput.value = state.notice;
  editNoticeButton.classList.toggle("hidden", !isAdmin());
  adminHelp.textContent = isAdmin()
    ? "연필 버튼을 눌러 공지사항을 수정할 수 있습니다."
    : "공지 수정은 관리자 계정으로 로그인하면 가능합니다.";
  noticeEditor.classList.add("hidden");
  noticeCopy.classList.remove("hidden");
}

function renderProducts() {
  productGrid.innerHTML = "";
  const sortedProducts = [...state.products].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  );
  marketCount.textContent = `${sortedProducts.length}개 등록`;

  if (sortedProducts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "아직 등록된 판매 글이 없습니다.";
    productGrid.append(empty);
    return;
  }

  sortedProducts.forEach((product) => {
    const node = productTemplate.content.cloneNode(true);
    const card = node.querySelector(".product-card");
    const image = node.querySelector(".product-image");
    const title = node.querySelector("h3");
    const price = node.querySelector(".price");
    const category = node.querySelector(".description");
    const seller = node.querySelector(".seller");
    const postedAt = node.querySelector(".posted-at");
    const likeRow = node.querySelector(".like-row");

    if (product.image) {
      image.src = product.image;
    } else {
      image.removeAttribute("src");
    }
    image.alt = `${product.name} 사진`;
    title.textContent = product.name;
    price.textContent = formatPrice(product.price);
    category.textContent = product.category;
    seller.textContent = `판매자 ${product.seller}`;
    postedAt.textContent = formatDate(product.createdAt);
    likeRow?.remove();

    productGrid.append(card);
  });
}

function render() {
  renderSession();
  renderNotice();
  renderProducts();
}

function setView(viewName) {
  tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });

  viewPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.viewPanel === viewName);
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

editNoticeButton.addEventListener("click", () => {
  if (!isAdmin()) return;
  noticeInput.value = state.notice;
  noticeCopy.classList.add("hidden");
  noticeEditor.classList.remove("hidden");
  noticeInput.focus();
});

cancelNoticeButton.addEventListener("click", () => {
  noticeEditor.classList.add("hidden");
  noticeCopy.classList.remove("hidden");
});

noticeEditor.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!isAdmin()) return;

  state.notice = noticeInput.value.trim() || defaultNotice;
  saveState();
  renderNotice();
});

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setView(button.dataset.view);
  });
});

async function init() {
  // Supabase 클라이언트를 먼저 준비해야 세션 확인(requireAuth)이 가능하다
  await setupSupabase();

  // 로그인하지 않은 사용자는 여기서 login.html로 리다이렉트되고 이후 로직은 건너뛴다.
  // requireAuth가 세션을 확인하며 state.currentUser를 채운 뒤 화면을 그린다.
  if (!(await requireAuth())) return;

  render();
  await loadProductsFromSupabase();
}

init();
