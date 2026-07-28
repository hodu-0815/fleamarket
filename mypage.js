import { state, saveState } from "./store.js";
import { escapeHtml, formatPrice, formatDate } from "./utils.js";
import { requireAuth, logout } from "./auth.js";
import { setupSupabase, getClient } from "./supabase-client.js";
import { showToast } from "./toast.js";

const sessionPanel = document.querySelector("#mypageSessionPanel");
const likedGrid = document.querySelector("#likedGrid");
const likedCount = document.querySelector("#likedCount");
const myProductsGrid = document.querySelector("#myProductsGrid");
const myProductsCount = document.querySelector("#myProductsCount");
const productTemplate = document.querySelector("#mypageProductTemplate");

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

// 서버 products에는 likes 컬럼이 없으므로, 피드(toggleLike)가 쓴 localStorage likes를 덮어씌운다
function mergeLocalLikes(products) {
  const localById = new Map(
    (state.products || []).map((item) => [String(item.id), item]),
  );

  return products.map((product) => {
    const local = localById.get(String(product.id));
    if (local && Array.isArray(local.likes)) {
      return { ...product, likes: [...local.likes] };
    }
    return product;
  });
}

async function loadProducts() {
  const client = getClient();
  if (!client) {
    // 클라이언트 없어도 localStorage 상품으로 화면은 그릴 수 있다
    state.products = mergeLocalLikes(
      (state.products || []).map(normalizeProduct),
    );
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

  const fromServer = (data || []).map(normalizeProduct);
  state.products = mergeLocalLikes(fromServer);
  saveState();
}

function renderSession() {
  const user = state.currentUser;
  if (!user) return;

  sessionPanel.innerHTML = `
    <strong>${escapeHtml(user.nickname)}</strong>
    <p>찜 목록과 내가 올린 상품을 확인하세요.</p>
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
  renderLikedList();
  renderMyProducts();
}

// 찜 취소는 서버 likes 테이블이 없어 localStorage만 갱신한다 (피드와 동일)
function unlikeProduct(productId) {
  if (!state.currentUser) return;

  const product = state.products.find((item) => item.id === productId);
  if (!product) return;

  const nickname = state.currentUser.nickname;
  product.likes = product.likes.filter((name) => name !== nickname);
  saveState();
  renderLikedList();
  showToast("찜을 취소했습니다.", { type: "success" });
}

export function initMypage() {
  render();
}

async function boot() {
  await setupSupabase();
  if (!(await requireAuth())) return;

  await loadProducts();
  initMypage();
}

boot();
