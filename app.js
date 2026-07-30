import { state, saveState, defaultNotice } from "./store.js";
import { escapeHtml, formatPrice, formatDate } from "./utils.js";
import { showToast } from "./toast.js";
import { requireAuth, logout } from "./auth.js";
import {
  setupSupabase,
  getClient,
  updateProductLikes,
} from "./supabase-client.js";

const PRODUCT_IMAGE_BUCKET = "product-images";

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
const productDetailModal = document.querySelector("#productDetailModal");
const productDetailHeroImage = document.querySelector(".detail-hero-image");
const productDetailCategory = document.querySelector(".detail-category");
const productDetailTitle = document.querySelector("#productDetailTitle");
const productDetailPrice = document.querySelector(".detail-price");
const productDetailDescription = document.querySelector(".detail-description");
const productDetailMetaValues = document.querySelectorAll(".detail-meta dd");
const productDetailCloseButton = document.querySelector(".dialog-close-button");

// 관리자 여부는 profiles.is_admin 플래그로 판정한다(닉네임 하드코딩 제거).
function isAdmin(user = state.currentUser) {
  return Boolean(user?.isAdmin);
}

function normalizeProduct(row) {
  return {
    id: row.id,
    name: row.name,
    photo: row.image || row.photo || "",
    category: row.category || "카테고리 없음",
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
  const client = getClient();
  if (!client) return;

  let { data, error } = await client
    .from("products")
    .select("*")
    .order("created_at", { ascending: false });

  if (error?.code === "42703") {
    ({ data, error } = await client.from("products").select("*"));
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

  const client = getClient();
  const { error } = await client.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(filePath, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (error) throw error;

  const { data } = client.storage
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
    <div class="session-actions">
      <a class="secondary-button session-link" href="mypage.html">마이페이지</a>
      <button class="secondary-button" id="logoutButton" type="button">나가기</button>
    </div>
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
    const seller = node.querySelector(".seller");
    const likeCount = node.querySelector(".like-count");
    const likedByCurrentUser =
      state.currentUser && product.likes.includes(state.currentUser.nickname);

    image.src = product.photo;
    image.alt = `${product.name} 사진`;
    title.textContent = product.name;
    price.textContent = formatPrice(product.price);
    seller.textContent = product.seller;
    likeCount.textContent = product.likes.length;
    card.addEventListener("click", () => {
      openProductDetail(product);
    });
    productGrid.append(card);
  });
}

function formatProductDate(value) {
  if (!value) return "등록일 없음";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "등록일 없음";

  return formatDate(date);
}

function renderProductDetailHeroImage(photo, title) {
  productDetailHeroImage.replaceChildren();

  if (!photo) {
    productDetailHeroImage.setAttribute("aria-label", "대표 이미지 없음");
    return;
  }

  const image = document.createElement("img");
  image.src = photo;
  image.alt = `${title} 대표 이미지`;
  image.style.display = "block";
  image.style.width = "100%";
  image.style.height = "100%";
  image.style.objectFit = "cover";
  productDetailHeroImage.append(image);
  productDetailHeroImage.setAttribute("aria-label", `${title} 대표 이미지`);
}

function openProductDetail(product) {
  if (!productDetailModal) return;

  const title = product.name || "상품명 없음";
  const numericPrice = Number(product.price);
  const price = Number.isFinite(numericPrice) ? numericPrice : 0;
  const photo = product.photo || "";
  const likeCount = Array.isArray(product.likes) ? product.likes.length : 0;

  renderProductDetailHeroImage(photo, title);
  productDetailCategory.textContent = product.category || "카테고리 없음";
  productDetailTitle.textContent = title;
  productDetailPrice.textContent = formatPrice(price);
  productDetailDescription.textContent =
    product.description || "상품 설명이 없습니다.";
  productDetailMetaValues[0].textContent = product.seller || "알 수 없음";
  productDetailMetaValues[1].textContent = formatProductDate(
    product.createdAt,
  );
  productDetailMetaValues[2].textContent = likeCount;
  productDetailModal.showModal();
}

function closeProductDetailModal() {
  productDetailModal.close();
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

async function toggleLike(productId) {
  if (!state.currentUser) {
    showToast("로그인 후 찜할 수 있습니다.", { type: "error" });
    return;
  }

  const product = state.products.find((item) => item.id === productId);
  if (!product) return;

  const nickname = state.currentUser.nickname;
  // 이미 찜했으면 내 닉네임을 빼고, 아니면 추가한 새 배열을 만든다
  const nextLikes = product.likes.includes(nickname)
    ? product.likes.filter((name) => name !== nickname)
    : [...product.likes, nickname];

  // 서버 products.likes 컬럼에 반영해야 다른 기기/마이페이지에서도 동일하게 보인다
  const result = await updateProductLikes(product.id, nextLikes);
  if (!result.ok) {
    showToast("찜 정보를 저장하지 못했습니다.", { type: "error" });
    return;
  }

  // 서버가 확정한 likes로 로컬 상태를 맞춘 뒤 다시 그린다
  product.likes = result.likes;
  saveState();
  renderProducts();
}

async function saveCustomCategory(category) {
  const normalizedCategory = category.trim();
  if (!normalizedCategory) return;

  const client = getClient();
  if (!client) return;

  const { data: savedCategories, error: selectError } = await client
    .from("categories")
    .select("name")
    .eq("name", normalizedCategory)
    .limit(1);

  if (selectError) {
    console.error("카테고리 중복 확인에 실패했습니다.", selectError);
    return;
  }

  if (savedCategories?.length) return;

  const { error } = await client.from("categories").insert({
    name: normalizedCategory,
  });

  if (error) {
    console.error("카테고리를 저장하지 못했습니다.", error);
    return;
  }

  appendCustomCategoryOption(normalizedCategory);
}
function appendCustomCategoryOption(category) {
  const categorySelect = document.querySelector("#categorySelect");
  if (!categorySelect) return;

  const normalizedCategory = category.trim();
  if (!normalizedCategory) return;

  const optionExists = Array.from(categorySelect.options).some(
    (option) => option.value === normalizedCategory,
  );

  if (optionExists) return;

  const option = document.createElement("option");
  option.value = normalizedCategory;
  option.textContent = normalizedCategory;

  const otherOption = Array.from(categorySelect.options).find(
    (item) => item.value === "기타",
  );

  categorySelect.insertBefore(option, otherOption || null);
}

async function loadCustomCategoryOptions() {
  const client = getClient();
  if (!client) return;

  const { data, error } = await client.from("categories").select("name");

  console.log("categories:", data);

  if (error) {
    console.error("카테고리를 불러오지 못했습니다.", error);
    return;
  }

  (data || []).forEach((category) => {
    console.log("append:", category.name);
    appendCustomCategoryOption(category.name || "");
  });
}

function updateCategoryCustomInputVisibility() {
  const categorySelect = document.querySelector("#categorySelect");
  const categoryCustomInput = document.querySelector("#categoryCustomInput");

  if (!categorySelect || !categoryCustomInput) return;

  if (categorySelect.value === "기타") {
    categoryCustomInput.classList.remove("hidden");
  } else {
    categoryCustomInput.classList.add("hidden");
    categoryCustomInput.value = "";
  }
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

  if (!getClient()) {
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
const categorySelect = document.querySelector("#categorySelect");
const categoryCustomInput = document.querySelector("#categoryCustomInput");

const category =
  categorySelect?.value === "기타"
    ? categoryCustomInput?.value.trim()
    : categorySelect?.value;
    console.log("category:", category);

if (categorySelect?.value === "기타") {
  await saveCustomCategory(category || "");
}
  const { error } = await getClient().from("products").insert({
    name,
    image: imageUrl,
    description,
    price: numericPrice,
    seller: state.currentUser.nickname,
    category,
  });

  if (error) {
    console.error("상품을 등록하지 못했습니다.", error);
    showToast("상품을 등록하지 못했습니다.", { type: "error" });
    return;
  }

  uploadForm.reset();
  await loadCustomCategoryOptions();
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

productDetailCloseButton.addEventListener("click", closeProductDetailModal);

productDetailModal.addEventListener("click", (event) => {
  if (event.target === productDetailModal) {
    closeProductDetailModal();
  }
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

updateCategoryCustomInputVisibility();

document
  .querySelector("#categorySelect")
  ?.addEventListener("change", updateCategoryCustomInputVisibility);

async function init() {
  // Supabase 클라이언트를 먼저 준비해야 세션 확인(requireAuth)이 가능하다
  await setupSupabase();

  await loadCustomCategoryOptions();

  // 로그인하지 않은 사용자는 여기서 login.html로 리다이렉트되고 이후 로직은 건너뛴다.
  // requireAuth가 세션을 확인하며 state.currentUser를 채운 뒤 화면을 그린다.
  if (!(await requireAuth())) return;

  render();
  await loadProductsFromSupabase();
}

init();
