import { state, saveState, defaultNotice } from "./store.js";
import { escapeHtml, formatPrice, formatDate } from "./utils.js";
import { showToast } from "./toast.js";
import { requireAuth, logout } from "./auth.js";

const ADMIN_NICKNAME = "admin";
const PRODUCT_IMAGE_BUCKET = "product-images";

let supabaseClient = null;

const sessionPanel = document.querySelector("#sessionPanel");
const uploadForm = document.querySelector("#uploadForm");
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

async function loadSupabaseEnv() {
  if (window.ENV?.VITE_SUPABASE_URL && window.ENV?.VITE_SUPABASE_ANON_KEY) {
    return window.ENV;
  }

  try {
    const response = await fetch(".env", { cache: "no-store" });
    if (!response.ok) return {};

    const text = await response.text();
    return Object.fromEntries(
      text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const [key, ...valueParts] = line.split("=");
          return [
            key.trim(),
            valueParts
              .join("=")
              .trim()
              .replace(/^["']|["']$/g, ""),
          ];
        }),
    );
  } catch {
    return {};
  }
}

async function setupSupabase() {
  const env = await loadSupabaseEnv();
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;

  if (!window.supabase || !supabaseUrl || !supabaseAnonKey) {
    console.error("Supabase 설정을 찾을 수 없습니다.");
    return;
  }

  supabaseClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
}

function isAdmin(user = state.currentUser) {
  return user?.nickname === ADMIN_NICKNAME && user?.isAdmin;
}

function normalizeProduct(row) {
  return {
    id: row.id,
    name: row.name,
    photo: row.image || row.photo || "",
    description: row.description || "",
    price: Number(row.price || 0),
    seller: row.seller || "알 수 없음",
    likes: Array.isArray(row.likes)
      ? row.likes
      : Array.isArray(row.liked_by)
        ? row.liked_by
        : [],
    createdAt: row.created_at || row.createdAt || new Date().toISOString(),
  };
}

async function loadProductsFromSupabase() {
  if (!supabaseClient) return;

  let { data, error } = await supabaseClient
    .from("products")
    .select("*")
    .order("created_at", { ascending: false });

  if (error?.code === "42703") {
    ({ data, error } = await supabaseClient.from("products").select("*"));
  }

  if (error) {
    console.error("상품 목록을 불러오지 못했습니다.", error);
    return;
  }

  state.products = (data || []).map(normalizeProduct);
  renderProducts();
}

async function uploadProductImage(file) {
  const extension = file.name.split(".").pop() || "png";
  const safeName =
    file.name
      .replace(/\.[^/.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 48) || "product";
  const uniqueId =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  const filePath = `${Date.now()}-${uniqueId}-${safeName}.${extension}`;

  const { error } = await supabaseClient.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(filePath, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (error) throw error;

  const { data } = supabaseClient.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .getPublicUrl(filePath);
  return data.publicUrl;
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
    : "공지 수정은 관리자 계정(admin / admin1234)으로 로그인하면 가능합니다.";
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
    const description = node.querySelector(".description");
    const seller = node.querySelector(".seller");
    const postedAt = node.querySelector(".posted-at");
    const heartButton = node.querySelector(".heart-button");
    const heartIcon = heartButton.querySelector("span");
    const likeSummary = node.querySelector(".like-summary");
    const likedByCurrentUser =
      state.currentUser && product.likes.includes(state.currentUser.nickname);

    image.src = product.photo;
    image.alt = `${product.name} 사진`;
    title.textContent = product.name;
    price.textContent = formatPrice(product.price);
    description.textContent =
      product.description || "간단 설명이 등록되지 않았습니다.";
    seller.textContent = `판매자 ${product.seller}`;
    postedAt.textContent = formatDate(product.createdAt);
    heartButton.classList.toggle("active", Boolean(likedByCurrentUser));
    heartIcon.textContent = likedByCurrentUser ? "♥" : "♡";
    heartButton.setAttribute(
      "aria-label",
      likedByCurrentUser ? "찜 취소" : "찜하기",
    );
    heartButton.title = likedByCurrentUser ? "찜 취소" : "찜하기";
    likeSummary.textContent =
      product.likes.length === 0
        ? "아직 찜한 사람이 없습니다"
        : `${product.likes.length}명 · ${product.likes.join(", ")}`;

    heartButton.addEventListener("click", () => toggleLike(product.id));
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

function toggleLike(productId) {
  if (!state.currentUser) {
    showToast("로그인 후 찜할 수 있습니다.", { type: "error" });
    return;
  }

  const product = state.products.find((item) => item.id === productId);
  if (!product) return;

  const nickname = state.currentUser.nickname;
  product.likes = product.likes.includes(nickname)
    ? product.likes.filter((name) => name !== nickname)
    : [...product.likes, nickname];

  saveState();
  renderProducts();
}

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!state.currentUser) {
    showToast("로그인 후 판매 글을 등록할 수 있습니다.", { type: "error" });
    return;
  }

  const name = document.querySelector("#productNameInput").value.trim();
  const photoFile = document.querySelector("#photoInput").files[0];
  const description = document.querySelector("#descriptionInput").value.trim();
  const price = document
    .querySelector("#priceInput")
    .value.replaceAll(",", "")
    .trim();

  const numericPrice = Number(price);

  if (
    !name ||
    !photoFile ||
    !price ||
    !Number.isFinite(numericPrice) ||
    numericPrice < 0
  ) {
    showToast("판매 글 정보를 모두 입력해주세요.", { type: "error" });
    return;
  }

  if (!supabaseClient) {
    showToast("Supabase 연결을 확인해주세요.", { type: "error" });
    return;
  }

  let imageUrl = "";
  try {
    imageUrl = await uploadProductImage(photoFile);
  } catch (error) {
    console.error("상품 이미지를 업로드하지 못했습니다.", error);
    showToast("상품 이미지를 업로드하지 못했습니다.", { type: "error" });
    return;
  }

  const { error } = await supabaseClient.from("products").insert({
    name,
    image: imageUrl,
    description,
    price: numericPrice,
    seller: state.currentUser.nickname,
  });

  if (error) {
    console.error("상품을 등록하지 못했습니다.", error);
    showToast("상품을 등록하지 못했습니다.", { type: "error" });
    return;
  }

  uploadForm.reset();
  await loadProductsFromSupabase();
  setView("market");
});

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
  // 로그인하지 않은 사용자는 여기서 login.html로 리다이렉트되고 이후 로직은 건너뛴다
  if (!requireAuth()) return;

  render();
  await setupSupabase();
  await loadProductsFromSupabase();
}

init();
