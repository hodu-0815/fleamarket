import { state, saveState, createEmptyProfile } from "./store.js";
import { escapeHtml, formatPrice, formatDate } from "./utils.js?v=price-free-v2";
import { requireAuth, logout } from "./auth.js";
import {
  setupSupabase,
  getClient,
  updateProfile,
  uploadAvatar,
  updateProductLikes,
} from "./supabase-client.js";
import { showToast } from "./toast.js";

const sessionPanel = document.querySelector("#mypageSessionPanel");
const likedGrid = document.querySelector("#likedGrid");
const likedCount = document.querySelector("#likedCount");
const myProductsGrid = document.querySelector("#myProductsGrid");
const myProductsCount = document.querySelector("#myProductsCount");
const productTemplate = document.querySelector("#mypageProductTemplate");

const profileForm = document.querySelector("#profileForm");
const profileNickname = document.querySelector("#profileNickname");
const relationshipInput = document.querySelector("#relationshipInput");
const bioInput = document.querySelector("#bioInput");
const visitTimeInput = document.querySelector("#visitTimeInput");
const dinnerInput = document.querySelector("#dinnerInput");
const avatarInput = document.querySelector("#avatarInput");
const avatarImage = document.querySelector("#avatarImage");
const avatarInitials = document.querySelector("#avatarInitials");

// app.js normalizeProduct와 동일 shape로 맞춰 피드·마이페이지가 같은 필드를 쓴다
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

function renderSession() {
  const user = state.currentUser;
  if (!user) return;

  sessionPanel.innerHTML = `
    <strong>${escapeHtml(user.nickname)}</strong>
    <p>내 정보와 찜·판매 목록을 관리하세요.</p>
    <div class="session-actions">
      <a class="secondary-button session-link" href="index.html">마켓으로</a>
      <button class="secondary-button" id="mypageLogoutButton" type="button">로그아웃</button>
    </div>
  `;

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
  dinnerInput.value = profile.dinner || "undecided";
  renderAvatar(profile.avatarUrl, user?.nickname);
}

function createProductCard(product, { showUnlike = false } = {}) {
  const node = productTemplate.content.cloneNode(true);
  const card = node.querySelector(".product-card");
  const image = node.querySelector(".product-image");
  const title = node.querySelector("h3");
  const price = node.querySelector(".price");
  const seller = node.querySelector(".seller");
  const postedAt = node.querySelector(".posted-at");
  const actions = node.querySelector(".mypage-card-actions");

  image.src = product.photo;
  image.alt = `${product.name} 사진`;
  title.textContent = product.name;
  price.textContent = formatPrice(product.price);
  seller.textContent = `판매자 ${product.seller}`;
  postedAt.textContent = formatDate(product.createdAt);

  if (showUnlike) {
    const unlikeButton = document.createElement("button");
    unlikeButton.type = "button";
    unlikeButton.className = "secondary-button wide";
    unlikeButton.textContent = "찜 취소";
    unlikeButton.addEventListener("click", () => unlikeProduct(product.id));
    actions.append(unlikeButton);
  } else {
    actions.remove();
  }

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
    likedGrid.append(createProductCard(product, { showUnlike: true }));
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
  renderSession();
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
  const dinner = dinnerInput.value;
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

export function initMypage() {
  bindAvatarPreview();
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
