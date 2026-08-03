import { state, saveState, createEmptyProfile } from "./store.js";
import { formatPrice, formatDate } from "./utils.js?v=price-free-v2";
import { requireAuth, logout } from "./auth.js";
import {
  setupSupabase,
  getClient,
  updateProfile,
  uploadAvatar,
  updateProductLikes,
} from "./supabase-client.js";
import { showToast } from "./toast.js";
// 상품 상세 팝업은 메인피드와 동일한 공용 모듈을 그대로 재사용한다
import {
  initProductDetail,
  openProductDetail,
  getProductImages,
} from "./product-detail.js";

const likedGrid = document.querySelector("#likedGrid");
const likedCount = document.querySelector("#likedCount");
const myProductsGrid = document.querySelector("#myProductsGrid");
const myProductsCount = document.querySelector("#myProductsCount");
const productTemplate = document.querySelector("#mypageProductTemplate");
const DEFAULT_PRODUCT_IMAGE = "assets/default_image.png";
const LEGACY_DEFAULT_PRODUCT_IMAGE =
  "https://kqnxnnknexxkstwojwkb.supabase.co/storage/v1/object/public/product-images/default_image.png";

function getProductPhoto(row) {
  const images = Array.isArray(row.images) ? row.images : [];
  const photo = [images[0], row.image, row.photo]
    .map((url) => String(url || "").trim())
    .find((url) => url && url !== LEGACY_DEFAULT_PRODUCT_IMAGE);

  return photo || DEFAULT_PRODUCT_IMAGE;
}

const tabButtons = document.querySelectorAll(".mypage-tabbar .tab-button");
const viewPanels = document.querySelectorAll("[data-view-panel]");

const profileForm = document.querySelector("#profileForm");
const profileNickname = document.querySelector("#profileNickname");
const relationshipInput = document.querySelector("#relationshipInput");
const bioInput = document.querySelector("#bioInput");
const visitTimeInput = document.querySelector("#visitTimeInput");
// 저녁 여부는 셀렉트 대신 버튼 그룹으로 받는다. 그룹 컨테이너와 각 버튼을 잡아둔다
const dinnerGroup = document.querySelector("#dinnerInput");
const dinnerButtons = dinnerGroup
  ? dinnerGroup.querySelectorAll(".choice-button")
  : [];

// 허용된 값만 반영하고, 나머지는 안전하게 "미정"으로 처리한다
function setDinnerValue(value) {
  const next = ["undecided", "yes", "no"].includes(value) ? value : "undecided";
  dinnerButtons.forEach((button) => {
    const isSelected = button.dataset.value === next;
    button.classList.toggle("active", isSelected);
    // 토글 버튼 접근성: 선택 여부를 aria-pressed로 노출한다
    button.setAttribute("aria-pressed", isSelected ? "true" : "false");
  });
}

// 현재 선택된 버튼의 값을 읽는다. 선택이 없으면 "미정"
function getDinnerValue() {
  const active = dinnerGroup?.querySelector(".choice-button.active");
  return active ? active.dataset.value : "undecided";
}

// 버튼 클릭 시 해당 값으로 선택 상태를 전환한다
function bindDinnerButtons() {
  dinnerButtons.forEach((button) => {
    button.addEventListener("click", () => setDinnerValue(button.dataset.value));
  });
}
const avatarInput = document.querySelector("#avatarInput");
const avatarImage = document.querySelector("#avatarImage");
const avatarInitials = document.querySelector("#avatarInitials");

// app.js normalizeProduct와 동일 shape로 맞춰 피드·마이페이지가 같은 필드를 쓴다
function normalizeProduct(row) {
  return {
    id: row.id,
    name: row.name,
    photo: getProductPhoto(row),
    // 상세 팝업은 여러 장 이미지 캐러셀을 쓰므로 카드용 photo와 별개로 전체 이미지 배열도 담아둔다
    images: getProductImages(row),
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

async function loadProducts() {
  const client = getClient();
  if (!client) {
    // 클라이언트가 없으면 localStorage에 남은 상품으로만 화면을 그린다
    state.products = (state.products || []).map(normalizeProduct);
    return;
  }

  let { data, error } = await client
    .from("products")
    .select("*")
    .order("created_at", { ascending: false });

  if (error?.code === "42703") {
    ({ data, error } = await client.from("products").select("*"));
  }

  if (error) {
    console.error("상품 목록을 불러오지 못했습니다.", error);
    showToast("상품 목록을 불러오지 못했습니다.", { type: "error" });
    return;
  }

  // 찜(likes)은 서버 products.likes 컬럼을 그대로 신뢰한다 (더 이상 localStorage로 덮어쓰지 않음)
  state.products = (data || []).map(normalizeProduct);
  saveState();
}

// 하단 로그아웃 버튼은 정적 마크업이라 초기화 때 한 번만 바인딩한다
function bindLogout() {
  document
    .querySelector("#mypageLogoutButton")
    .addEventListener("click", () => {
      logout();
    });
}

// 닉네임 앞글자로 이니셜 플레이스홀더를 만든다
function getInitials(nickname) {
  const text = String(nickname || "").trim();
  if (!text) return "?";
  return Array.from(text)[0];
}

function renderAvatar(avatarUrl, nickname) {
  const hasImage = Boolean(avatarUrl);

  avatarImage.classList.toggle("hidden", !hasImage);
  avatarInitials.classList.toggle("hidden", hasImage);

  if (hasImage) {
    avatarImage.src = avatarUrl;
    avatarImage.alt = `${nickname || "나"}의 프로필 사진`;
  } else {
    avatarImage.removeAttribute("src");
    avatarImage.alt = "";
    avatarInitials.textContent = getInitials(nickname);
  }
}

function fillProfileForm() {
  const user = state.currentUser;
  const profile = state.profile || createEmptyProfile();

  profileNickname.textContent = user?.nickname || "";
  relationshipInput.value = profile.relationship || "";
  bioInput.value = profile.bio || "";
  visitTimeInput.value = profile.visitTime || "";
  setDinnerValue(profile.dinner || "undecided");
  renderAvatar(profile.avatarUrl, user?.nickname);
}

// hideMeta=true면 판매자·등록일 메타 줄을 숨긴다 (찜 목록 카드는 이미지/이름/가격만 노출)
function createProductCard(product, { showUnlike = false, hideMeta = false } = {}) {
  const node = productTemplate.content.cloneNode(true);
  const card = node.querySelector(".product-card");
  const image = node.querySelector(".product-image");
  const title = node.querySelector("h3");
  const price = node.querySelector(".price");
  const sellerRow = node.querySelector(".seller-row");
  const seller = node.querySelector(".seller");
  const postedAt = node.querySelector(".posted-at");
  const actions = node.querySelector(".mypage-card-actions");

  image.src = product.photo;
  image.alt = `${product.name} 사진`;
  title.textContent = product.name;
  price.textContent = formatPrice(product.price);

  // 찜 카드는 판매자/등록일 줄을 통째로 제거하고, 그 외 카드에서만 값을 채운다
  if (hideMeta) {
    sellerRow.remove();
  } else {
    seller.textContent = `판매자 ${product.seller}`;
    postedAt.textContent = formatDate(product.createdAt);
  }

  if (showUnlike) {
    const unlikeButton = document.createElement("button");
    unlikeButton.type = "button";
    unlikeButton.className = "secondary-button wide";
    unlikeButton.textContent = "찜 취소";
    // 찜 취소 버튼 클릭이 카드 클릭(상세 팝업 열기)으로 번지지 않도록 전파를 막는다
    unlikeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      unlikeProduct(product.id);
    });
    actions.append(unlikeButton);
  } else {
    actions.remove();
  }

  // 카드를 누르면 메인피드와 동일한 상세 팝업을 연다
  card.addEventListener("click", () => openProductDetail(product));

  return card;
}

function renderLikedList() {
  likedGrid.innerHTML = "";
  const nickname = state.currentUser?.nickname;
  const liked = (state.products || []).filter(
    (product) => nickname && product.likes.includes(nickname),
  );

  likedCount.textContent = `${liked.length}개`;

  if (liked.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "아직 찜한 상품이 없습니다.";
    likedGrid.append(empty);
    return;
  }

  liked.forEach((product) => {
    likedGrid.append(
      createProductCard(product, { showUnlike: true, hideMeta: true }),
    );
  });
}

function renderMyProducts() {
  myProductsGrid.innerHTML = "";
  const nickname = state.currentUser?.nickname;
  // Phase 1: owner_id 없이 seller(닉네임)로 내 상품을 판별한다
  const mine = (state.products || []).filter(
    (product) => nickname && product.seller === nickname,
  );

  myProductsCount.textContent = `${mine.length}개`;

  if (mine.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "아직 올린 상품이 없습니다.";
    myProductsGrid.append(empty);
    return;
  }

  mine.forEach((product) => {
    myProductsGrid.append(createProductCard(product));
  });
}

function render() {
  fillProfileForm();
  renderLikedList();
  renderMyProducts();
}

// 찜 취소는 서버 products.likes 배열에서 내 닉네임을 빼고 저장한다 (피드 toggleLike와 동일 방식)
async function unlikeProduct(productId) {
  if (!state.currentUser) return;

  const product = state.products.find((item) => item.id === productId);
  if (!product) return;

  const nickname = state.currentUser.nickname;
  const nextLikes = product.likes.filter((name) => name !== nickname);

  const result = await updateProductLikes(product.id, nextLikes);
  if (!result.ok) {
    showToast("찜을 취소하지 못했습니다.", { type: "error" });
    return;
  }

  // 서버가 확정한 likes로 로컬 상태를 맞춘 뒤 목록을 다시 그린다
  product.likes = result.likes;
  saveState();
  renderLikedList();
  showToast("찜을 취소했습니다.", { type: "success" });
}

// 선택한 파일을 즉시 미리보기로 보여준다 (저장 전 로컬 미리보기)
function bindAvatarPreview() {
  avatarInput.addEventListener("change", () => {
    const file = avatarInput.files?.[0];
    if (!file) {
      renderAvatar(state.profile?.avatarUrl, state.currentUser?.nickname);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    avatarImage.classList.remove("hidden");
    avatarInitials.classList.add("hidden");
    avatarImage.src = objectUrl;
    avatarImage.alt = "선택한 프로필 사진 미리보기";
  });
}

async function handleProfileSubmit(event) {
  event.preventDefault();

  const relationship = relationshipInput.value.trim();
  const bio = bioInput.value.trim();
  const visitTime = visitTimeInput.value.trim();
  const dinner = getDinnerValue();
  const file = avatarInput.files?.[0];

  if (bio.length > 40) {
    showToast("자기소개는 40자 이하로 입력해주세요.", { type: "error" });
    return;
  }

  let avatarUrl = state.profile?.avatarUrl || "";

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
    relationship,
    bio,
    visitTime,
    dinner,
    avatarUrl,
  });

  if (!result.ok) {
    showToast("내 정보를 저장하지 못했습니다.", { type: "error" });
    return;
  }

  avatarInput.value = "";
  fillProfileForm();
  showToast("내 정보를 저장했습니다.", { type: "success" });
}

// 선택한 탭에 맞춰 버튼 활성 상태와 보이는 섹션(패널)을 토글한다 (메인화면 setView와 동일 패턴)
function setView(viewName) {
  tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });

  viewPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.viewPanel === viewName);
  });
}

// 탭 버튼 클릭 시 해당 섹션으로 전환한다
function bindTabs() {
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
}

export function initMypage() {
  bindAvatarPreview();
  bindLogout();
  bindTabs();
  bindDinnerButtons();
  // 상세 팝업(공용 모듈) 초기화.
  // - onEdit: 수정 폼은 index.html에만 있으므로, 편집 대상 id를 실어 메인 페이지로 이동해 수정 시트를 연다
  // - onChange: 찜/삭제로 목록이 바뀌면 내 찜·내 상품 목록을 다시 그린다
  initProductDetail({
    onEdit: (product) => {
      window.location.href = `index.html?edit=${encodeURIComponent(product.id)}`;
    },
    onChange: () => {
      renderLikedList();
      renderMyProducts();
    },
  });
  profileForm.addEventListener("submit", handleProfileSubmit);
  render();
}

async function boot() {
  await setupSupabase();
  // requireAuth → getSession이 currentUser/profile을 채운다
  if (!(await requireAuth())) return;

  await loadProducts();
  initMypage();
}

boot();
