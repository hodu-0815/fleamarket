import { state, saveState } from "./store.js";
import { escapeHtml, formatPrice } from "./utils.js?v=price-free-v2";
import { showToast } from "./toast.js";
import { requireAuth } from "./auth.js";
import {
  setupSupabase,
  getClient,
  fetchFriends,
} from "./supabase-client.js";
import { initNotice } from "./notice.js";
// 상품 상세 팝업은 메인피드·마이페이지가 공유하는 공용 모듈로 분리했다.
// 상세 보기 관련 헬퍼(이미지/소유 판별)도 상세 모듈을 단일 출처로 삼아 여기서 import만 한다.
import {
  initProductDetail,
  openProductDetail,
  getProductImages,
  normalizeImageUrls,
  findProductById,
  canEditProduct,
} from "./product-detail.js";

const PRODUCT_IMAGE_BUCKET = "product-images";
const DEFAULT_PRODUCT_IMAGE = "assets/default_image.png";
const MAX_PRODUCT_IMAGES = 3;

const sessionPanel = document.querySelector("#sessionPanel");
const uploadForm = document.querySelector("#uploadForm");
const photoUploadButton = document.querySelector("#photoUploadButton");
const photoUploadCount = document.querySelector("#photoUploadCount");
const productImagePreview = document.querySelector("#productImagePreview");
const productNameInput = document.querySelector("#productNameInput");
const productImagesInput = document.querySelector("#productImagesInput");
const descriptionInput = document.querySelector("#descriptionInput");
const categorySelect = document.querySelector("#categorySelect");
const categoryCustomInput = document.querySelector("#categoryCustomInput");
const priceInput = document.querySelector("#priceInput");
const productGrid = document.querySelector("#productGrid");
const productTemplate = document.querySelector("#productTemplate");
const marketCount = document.querySelector("#marketCount");
const marketCategoryFilter = document.querySelector("#marketCategoryFilter");
const tabButtons = document.querySelectorAll(".tab-button");
const viewPanels = document.querySelectorAll("[data-view-panel]");
const openSellButton = document.querySelector("#openSellButton");
const fabLayer = document.querySelector("#fabLayer");
const sellModal = document.querySelector("#sellModal");
const sellCloseButton = document.querySelector("#sellCloseButton");
const timeline = document.querySelector("#timeline");
const friendCount = document.querySelector("#friendCount");
const friendCardTemplate = document.querySelector("#friendCardTemplate");
const productSubmitButton = document.querySelector("#productSubmitButton");
const cancelProductEditButton = document.querySelector(
  "#cancelProductEditButton",
);
const productFormFields = {
  name: productNameInput,
  imageInput: productImagesInput,
  description: descriptionInput,
  category: categorySelect,
  categoryCustom: categoryCustomInput,
  price: priceInput,
};
let editingProductId = null;
let retainedImageUrls = [];
let pendingImageFiles = [];
let productImagePreviewObjectUrls = [];
let selectedMarketCategory = "전체";
const loadedCategories = new Set();
// 친구들 탭은 처음 열 때 한 번만 서버에서 참석자 목록을 불러온다
let friendsLoaded = false;

// 관리자 여부는 profiles.is_admin 플래그로 판정한다(닉네임 하드코딩 제거).
function isAdmin(user = state.currentUser) {
  return Boolean(user?.isAdmin);
}

function normalizeProduct(row) {
  const images = getProductImages(row);

  return {
    id: row.id,
    name: row.name,
    images,
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

function getSellerProfile(nickname) {
  const seller = String(nickname || "").trim();
  if (!seller) return null;

  if (state.currentUser?.nickname === seller && state.profile) {
    return {
      nickname: seller,
      avatarUrl: state.profile.avatarUrl || "",
    };
  }

  return state.sellerProfiles?.[seller] || null;
}

function renderSellerThumb(root, nickname) {
  if (!root) return;

  const seller = String(nickname || "").trim();
  const profile = getSellerProfile(seller);
  const avatarUrl = String(profile?.avatarUrl || "").trim();
  const image = root.querySelector(".seller-thumb-image");
  const initials = root.querySelector(".seller-thumb-initials");
  const hasAvatar = Boolean(avatarUrl);

  image?.classList.toggle("hidden", !hasAvatar);
  initials?.classList.toggle("hidden", hasAvatar);

  if (hasAvatar && image) {
    image.src = avatarUrl;
    image.alt = `${seller}의 프로필 사진`;
  } else {
    image?.removeAttribute("src");
    if (image) image.alt = "";
    if (initials) initials.textContent = getInitials(seller);
  }
}

async function loadSellerProfilesForProducts() {
  const client = getClient();
  if (!client) return;

  const nicknames = [
    ...new Set(
      state.products
        .map((product) => String(product.seller || "").trim())
        .filter(Boolean),
    ),
  ];
  if (nicknames.length === 0) return;

  const { data, error } = await client
    .from("profiles")
    .select("nickname, avatar_url")
    .in("nickname", nicknames);

  if (error) {
    console.error("판매자 프로필을 불러오지 못했습니다.", error);
    return;
  }

  state.sellerProfiles = Object.fromEntries(
    (data || []).map((profile) => [
      profile.nickname,
      {
        nickname: profile.nickname,
        avatarUrl: profile.avatar_url || "",
      },
    ]),
  );
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
  await loadSellerProfilesForProducts();
  renderProducts();
  // 상품이 로드된 뒤 프로필 카드의 "올린 상품 수"를 최신값으로 다시 그린다
  renderSession();
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

// 닉네임 앞글자로 아바타 이니셜 플레이스홀더를 만든다 (마이페이지/친구맵과 동일 규칙)
function getInitials(nickname) {
  const text = String(nickname || "").trim();
  if (!text) return "?";
  return Array.from(text)[0];
}

// 현재 로그인 사용자가 올린 상품 수를 센다. 상품은 seller(닉네임)로 소유를 판별한다.
function countMyProducts(nickname) {
  if (!nickname) return 0;
  return state.products.filter((product) => product.seller === nickname).length;
}

// 방문 시간 문자열에서 입장 시각을 뽑아 "오후 N시" 형태로 표시한다(타임라인 뱃지와 동일 규칙).
// 예: "14:00" -> "오후 2시". HH:MM이 없으면 요일만 떼고 원문을 유지한다(레거시 자유 텍스트 대비).
function formatVisitTimeDisplay(visitTime) {
  const text = String(visitTime || "").trim();
  if (!text) return "";
  // 첫 번째 HH:MM 토큰(=입장 시각)을 오전/오후 12시간제로 변환한다
  const match = text.match(/(\d{1,2}):(\d{2})/);
  if (match) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const period = hour < 12 ? "오전" : "오후";
    // 0시·12시는 12로, 그 외 오후 시각은 12를 빼서 1~12 범위로 맞춘다
    const hour12 = hour % 12 === 0 ? 12 : hour % 12;
    const minuteText = minute > 0 ? ` ${minute}분` : "";
    return `${period} ${hour12}시${minuteText}`;
  }
  return text.replace(/^[월화수목금토일](요일)?\s*/, "").trim() || text;
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

  const profile = state.profile || {};
  const avatarUrl = String(profile.avatarUrl || "").trim();
  // 방문 시간은 요일을 떼고 시간만 노출한다
  const visitTime = formatVisitTimeDisplay(profile.visitTime);
  const relationship = String(profile.relationship || "").trim();
  const productCount = countMyProducts(user.nickname);

  // 아바타: 이미지가 있으면 <img>, 없으면 닉네임 이니셜을 보여준다
  const avatarInner = avatarUrl
    ? `<img class="profile-card-avatar-image" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(user.nickname)}의 프로필 사진" />`
    : `<span class="profile-card-avatar-initials">${escapeHtml(getInitials(user.nickname))}</span>`;

  // 관리자만 역할 배지를 노출한다 (닉네임 옆 접미사 대신 별도 pill로 분리)
  const roleBadge = isAdmin(user)
    ? `<span class="profile-card-role">관리자</span>`
    : "";

  // 아바타 옆 한 열에 닉네임 → 주인장과의 관계(얇게) → 방문·올린 상품(한 줄)을 쌓아
  // 카드 높이를 낮추고 구분선 없이 정보를 압축한다.
  // 값 강조는 <strong> 대신 <b>를 써 .session-panel strong{display:block} 충돌을 피한다.
  // 편집(연필) 아이콘만 마이페이지(내 정보 수정) 진입점으로 둔다 — 아이콘 패키지 미사용, 인라인 SVG
  sessionPanel.innerHTML = `
    <div class="profile-card">
      <div class="profile-card-avatar" aria-hidden="true">${avatarInner}</div>
      <div class="profile-card-info">
        <div class="profile-card-nameline">
          <p class="profile-card-name">${escapeHtml(user.nickname)}</p>
          ${roleBadge}
        </div>
        <p class="profile-card-relationship">${escapeHtml(relationship || "주인장과의 관계 미입력")}</p>
        <p class="profile-card-meta">방문 <b>${escapeHtml(visitTime || "미정")}</b> · 올린 상품 <b>${productCount}개</b></p>
      </div>
      <a class="profile-card-edit" href="mypage.html" aria-label="내 정보 수정" title="내 정보 수정">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      </a>
    </div>
  `;
}

function getVisibleProducts() {
  if (selectedMarketCategory === "전체") return [...state.products];

  return state.products.filter(
    (product) => product.category === selectedMarketCategory,
  );
}

function sortProductsByNewest(products) {
  return [...products].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  );
}

function renderEmptyProducts() {
  const empty = document.createElement("p");
  empty.className = "empty-state";
  empty.textContent =
    selectedMarketCategory === "전체"
      ? "아직 등록된 판매 글이 없습니다."
      : "선택한 카테고리에 등록된 판매 글이 없습니다.";
  productGrid.append(empty);
}

function createProductCard(product) {
  const node = productTemplate.content.cloneNode(true);
  const card = node.querySelector(".product-card");
  const image = node.querySelector(".product-image");
  const title = node.querySelector("h3");
  const price = node.querySelector(".price");
  const sellerLine = node.querySelector(".seller-line");
  const seller = node.querySelector(".seller");
  const likeCount = node.querySelector(".like-count");
  const productImages = getProductImages(product);
  const likes = Array.isArray(product.likes) ? product.likes : [];

  image.src = productImages[0];
  image.alt = `${product.name} 사진`;
  title.textContent = product.name;
  price.textContent = formatPrice(product.price);
  seller.textContent = product.seller;
  renderSellerThumb(sellerLine, product.seller);
  likeCount.textContent = likes.length;
  card.addEventListener("click", () => openProductDetail(product));

  return node;
}

function renderProducts() {
  productGrid.innerHTML = "";
  syncMarketCategoryFilterOptions();

  const sortedProducts = sortProductsByNewest(getVisibleProducts());
  marketCount.textContent = `${sortedProducts.length}개 등록`;

  if (sortedProducts.length === 0) {
    renderEmptyProducts();
    return;
  }

  sortedProducts.forEach((product) => {
    productGrid.append(createProductCard(product));
  });
}

function render() {
  renderSession();
  renderProducts();
}

function setView(viewName) {
  tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });

  viewPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.viewPanel === viewName);
  });

  // 판매 글 작성 FAB는 마켓 탭에서만 노출한다
  fabLayer?.classList.toggle("hidden", viewName !== "market");

  // 친구들 탭을 처음 열 때만 참석자 타임라인을 지연 로딩한다
  if (viewName === "friends") ensureFriendsLoaded();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---- 판매 글 작성/수정 시트(모달) ----------------------------------------
// 판매 폼은 별도 탭이 아니라 FAB로 여는 시트형 팝업이다.
function openSellModal() {
  if (!sellModal || sellModal.open) return;
  sellModal.showModal();
}

function closeSellModal() {
  if (sellModal?.open) sellModal.close();
}

// FAB(+)는 항상 "새 글 작성" 상태로 폼을 초기화한 뒤 시트를 연다
function openSellModalForCreate() {
  setProductFormMode();
  openSellModal();
  productFormFields.name.focus();
}

// ---- 친구들 타임라인 (친구맵 통합) ---------------------------------------
// 방문시간 텍스트에서 시작 시각을 뽑아 "분 단위 정수"로 반환한다.
// visit_time은 자유 텍스트라("토14:00-16:00", "오후 3시~" 등) 첫 HH:MM만 정렬 기준으로 쓴다.
// 파싱이 안 되면 null을 돌려줘 "시간 미정"으로 분류되게 한다.
function parseVisitStart(visitTime) {
  const text = String(visitTime || "").trim();
  if (!text) return null;

  const match = text.match(/(\d{1,2})(?::(\d{2}))?/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  // 24시간제 범위를 벗어난 값은 신뢰할 수 없으므로 미정 처리
  if (hour > 23 || minute > 59) return null;

  return hour * 60 + minute;
}

// 정렬용 분(minutes)을 "HH:MM" 뱃지 문구로 변환한다
// 정렬용 분(minutes)을 "오후 N시" 뱃지 문구로 변환한다.
// 12시간제로 오전/오후를 붙이고, 분이 0이 아니면 "오후 N시 M분"까지 표기한다. (예: 840 -> "오후 2시")
function formatTimeBadge(minutes) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const period = hour < 12 ? "오전" : "오후";
  // 0시·12시는 12로, 그 외 오후 시각은 12를 빼서 1~12 범위로 맞춘다
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const minuteText = minute > 0 ? ` ${minute}분` : "";
  return `${period} ${hour12}시${minuteText}`;
}

// 친구 카드 1건을 템플릿에서 복제해 채운다.
// 시각 뱃지는 그룹(같은 시각 묶음) 쪽에서 그리므로 카드는 프로필/소개만 담당한다.
function createFriendCard(friend) {
  const node = friendCardTemplate.content.cloneNode(true);
  const card = node.querySelector(".friend-card");
  const avatarImage = node.querySelector(".friend-avatar-image");
  const avatarInitials = node.querySelector(".friend-avatar-initials");
  const nickname = node.querySelector(".friend-nickname-name");
  const relationship = node.querySelector(".friend-relationship");
  const bio = node.querySelector(".friend-bio");

  // 로그인한 본인 카드는 브랜드 보더로 강조하고 "나" 뱃지를 붙여 한눈에 구분한다.
  // 참석자 목록엔 id가 없어 닉네임으로 본인 여부를 판별한다.
  const isMe = Boolean(
    state.currentUser && friend.nickname === state.currentUser.nickname,
  );
  card.classList.toggle("is-me", isMe);

  const hasImage = Boolean(friend.avatar_url);
  avatarImage.classList.toggle("hidden", !hasImage);
  avatarInitials.classList.toggle("hidden", hasImage);
  if (hasImage) {
    avatarImage.src = friend.avatar_url;
    avatarImage.alt = `${friend.nickname || "참석자"}의 프로필 사진`;
  } else {
    avatarInitials.textContent = getInitials(friend.nickname);
  }

  nickname.textContent = friend.nickname || "이름 없음";

  // 관계는 닉네임 옆에 함께 노출한다. 미입력이면 빈 자리를 남기지 않도록 숨긴다.
  const relationshipText = friend.relationship?.trim();
  if (relationshipText) {
    relationship.textContent = relationshipText;
    relationship.classList.remove("hidden");
  } else {
    relationship.textContent = "";
    relationship.classList.add("hidden");
  }

  // 자기소개는 카드 하단에 최대 두 줄로 노출하고, 넘치면 CSS(line-clamp)로 말줄임 처리한다.
  // 미입력자는 빈칸 대신 "-"로 채워 카드 높이를 일정하게 유지한다.
  const bioText = friend.bio?.trim();
  bio.textContent = bioText || "-";
  bio.classList.toggle("friend-bio-empty", !bioText);

  return node;
}

// 하루 중 시각을 "체감 더위"(0~1)로 환산한다.
// 기온은 보통 오후 3시(15시)에 가장 높고 새벽 3시에 가장 낮으므로 코사인 곡선으로 근사한다.
// 1에 가까울수록 더운 시간, 0에 가까울수록 시원한 시간이다.
function getHeat(minutes) {
  const PEAK_HOUR = 15; // 하루 중 가장 더운 시각
  const angle = ((minutes / 60 - PEAK_HOUR) / 24) * Math.PI * 2;
  return (Math.cos(angle) + 1) / 2;
}

// 더위 정도(0~1)에 따라 시원한 하늘색 ~ 더운 주황색 사이를 보간한 색을 만든다.
// 뱃지/점/레일이 시간대의 체감 온도를 색으로 드러내도록 --slot-color/--slot-soft 값을 돌려준다.
const COOL_COLOR = [45, 178, 240]; // 가장 시원한 시간: 하늘색
const HOT_COLOR = [242, 116, 28]; // 가장 더운 시간: 주황색

function getSlotColors(minutes) {
  const heat = getHeat(minutes);
  // 채널별로 시원한 색 → 더운 색으로 선형 보간한다
  const mix = (cool, hot) => Math.round(cool + (hot - cool) * heat);
  const r = mix(COOL_COLOR[0], HOT_COLOR[0]);
  const g = mix(COOL_COLOR[1], HOT_COLOR[1]);
  const b = mix(COOL_COLOR[2], HOT_COLOR[2]);
  return {
    color: `rgb(${r}, ${g}, ${b})`,
    soft: `rgba(${r}, ${g}, ${b}, 0.16)`,
  };
}

// 같은 시각 참석자들을 한 그룹으로 묶어 시간 뱃지를 한 번만 노출한다.
// colors가 있으면 시간대 온도 색을, 없으면(미정) 중립색 클래스를 쓴다.
// groupFriends가 비어 있으면(아무도 안 고른 시간대) 뱃지만 옅게 노출한다.
function createTimelineGroup(timeLabel, colors, groupFriends) {
  const group = document.createElement("section");
  group.className = "timeline-group";

  // 시간이 있는 그룹은 계산한 온도 색을 CSS 변수로 주입한다 (미정 그룹은 중립색 클래스로 대체)
  if (colors) {
    group.style.setProperty("--slot-color", colors.color);
    group.style.setProperty("--slot-soft", colors.soft);
  } else {
    group.classList.add("time-slot-none");
  }

  // 참석자가 없는 빈 시간대는 흐리게 표시해 "선택된 시간"과 구분한다
  const isEmpty = groupFriends.length === 0;
  group.classList.toggle("is-empty", isEmpty);

  // 레일 위 색점: 시간대의 시작 지점을 표시한다 (CSS에서 그룹 색을 상속)
  const dot = document.createElement("span");
  dot.className = "timeline-dot";
  dot.setAttribute("aria-hidden", "true");
  group.append(dot);

  const timeCol = document.createElement("div");
  timeCol.className = "timeline-time";
  const badge = document.createElement("span");
  badge.className = "time-badge";
  badge.textContent = timeLabel;
  timeCol.append(badge);
  group.append(timeCol);

  // 같은 시각 카드들을 세로로 쌓는다 (빈 시간대는 카드 없이 뱃지만 남는다)
  const cards = document.createElement("div");
  cards.className = "timeline-group-cards";
  groupFriends.forEach((friend) => cards.append(createFriendCard(friend)));
  group.append(cards);

  return group;
}

// 방문 선택지와 동일한 고정 시간대(오후 2시~6시). 아무도 안 골라도 뱃지는 전부 노출한다.
const TIMELINE_HOURS = [14, 15, 16, 17, 18];

// 방문시간이 있는 사람은 해당 시간대에, 없는 사람은 "미정" 그룹으로 하단에 그린다.
// 선택지 시간대(2~6시)는 참석자 유무와 관계없이 항상 뱃지를 보여 준다.
function renderTimeline(friends) {
  timeline.innerHTML = "";
  friendCount.textContent = `${friends.length}명`;

  if (friends.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "아직 등록된 참석자가 없습니다.";
    timeline.append(empty);
    return;
  }

  // 시작 시각을 미리 계산해 두고, 있는 그룹/없는 그룹으로 나눈다
  const withTime = [];
  const withoutTime = [];
  friends.forEach((friend) => {
    const start = parseVisitStart(friend.visit_time);
    if (start === null) {
      withoutTime.push(friend);
    } else {
      withTime.push({ friend, start });
    }
  });

  // 같은 시각(start 분 기준)끼리 묶어 시간이 중복 노출되지 않게 한다
  const grouped = new Map();
  withTime.forEach(({ friend, start }) => {
    if (!grouped.has(start)) grouped.set(start, []);
    grouped.get(start).push(friend);
  });

  // 선택지 시간대(오후 2~6시)를 순서대로 그리고, 해당 시각 참석자가 없으면 빈 뱃지로 둔다
  TIMELINE_HOURS.forEach((hour) => {
    const minutes = hour * 60;
    const groupFriends = grouped.get(minutes) || [];
    // 고정 정시 외의 레거시 시각(예: 14:30)은 아래에서 따로 붙인다
    grouped.delete(minutes);
    timeline.append(
      createTimelineGroup(
        formatTimeBadge(minutes),
        getSlotColors(minutes),
        groupFriends,
      ),
    );
  });

  // 고정 선택지에 없는 시각(레거시 자유 텍스트)은 시각 순으로 이어서 노출한다
  const leftover = [...grouped.entries()].sort((a, b) => a[0] - b[0]);
  leftover.forEach(([minutes, groupFriends]) => {
    timeline.append(
      createTimelineGroup(
        formatTimeBadge(minutes),
        getSlotColors(minutes),
        groupFriends,
      ),
    );
  });

  // 시간 미정 참석자는 중립색 "미정" 그룹으로 맨 아래에 모아 보여준다
  if (withoutTime.length > 0) {
    timeline.append(createTimelineGroup("미정", null, withoutTime));
  }
}

// 친구들 탭 최초 진입 시 참석자 목록을 서버에서 받아 타임라인을 그린다
async function ensureFriendsLoaded() {
  if (friendsLoaded) return;
  friendsLoaded = true;

  const friends = await fetchFriends();
  renderTimeline(friends);
}

function getMarketCategories() {
  const categories = new Set(loadedCategories);

  state.products.forEach((product) => {
    if (product.category && product.category !== "카테고리 없음") {
      categories.add(product.category);
    }
  });

  return [...categories].sort((a, b) => a.localeCompare(b, "ko"));
}

function syncMarketCategoryFilterOptions() {
  if (!marketCategoryFilter) return;

  const categories = getMarketCategories();
  const selectedCategory = categories.includes(selectedMarketCategory)
    ? selectedMarketCategory
    : "전체";

  marketCategoryFilter.replaceChildren();
  const allOption = document.createElement("option");
  allOption.value = "전체";
  allOption.textContent = "전체";
  marketCategoryFilter.append(allOption);

  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    marketCategoryFilter.append(option);
  });

  selectedMarketCategory = selectedCategory;
  marketCategoryFilter.value = selectedMarketCategory;
}

function releaseProductImagePreviewObjectUrls() {
  productImagePreviewObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  productImagePreviewObjectUrls = [];
}

function getEditableImageUrls(images = []) {
  return normalizeImageUrls(images);
}

function getRetainedImageCountForLimit() {
  if (
    retainedImageUrls.length === 1 &&
    retainedImageUrls[0] === DEFAULT_PRODUCT_IMAGE &&
    pendingImageFiles.length > 0
  ) {
    return 0;
  }

  return retainedImageUrls.length;
}

function getProductImageFormCount() {
  return getRetainedImageCountForLimit() + pendingImageFiles.length;
}

function updatePhotoUploadCount() {
  if (!photoUploadCount || !photoUploadButton) return;

  const count = Math.min(getProductImageFormCount(), MAX_PRODUCT_IMAGES);
  const countText = `${count} / ${MAX_PRODUCT_IMAGES}`;
  photoUploadCount.textContent = countText;
  photoUploadButton.setAttribute("aria-label", `사진 추가, 현재 ${countText}`);
}

function renderProductImagePreview() {
  if (!productImagePreview) return;

  releaseProductImagePreviewObjectUrls();
  productImagePreview.replaceChildren();

  const previewItems = [
    ...retainedImageUrls.map((url, index) => ({
      type: "retained",
      index,
      url,
      label: `기존 이미지 ${index + 1}`,
    })),
    ...pendingImageFiles.map((file, index) => {
      const url = URL.createObjectURL(file);
      productImagePreviewObjectUrls.push(url);
      return {
        type: "pending",
        index,
        url,
        label: `새 이미지 ${index + 1}`,
      };
    }),
  ];

  previewItems.forEach((item) => {
    const preview = document.createElement("div");
    preview.className = "product-image-preview-item";

    const image = document.createElement("img");
    image.src = item.url;
    image.alt = item.label;

    const removeButton = document.createElement("button");
    removeButton.className = "remove-image-button";
    removeButton.type = "button";
    removeButton.textContent = "×";
    removeButton.setAttribute("aria-label", `${item.label} 삭제`);
    removeButton.dataset.imageType = item.type;
    removeButton.dataset.imageIndex = String(item.index);

    preview.append(image, removeButton);
    productImagePreview.append(preview);
  });

  updatePhotoUploadCount();
}

function resetProductImageForm(images = []) {
  retainedImageUrls = getEditableImageUrls(images);
  pendingImageFiles = [];
  productFormFields.imageInput.value = "";
  renderProductImagePreview();
}

function getProductFormImagesForSave(uploadedImageUrls) {
  const existingImages =
    retainedImageUrls.length === 1 &&
    retainedImageUrls[0] === DEFAULT_PRODUCT_IMAGE &&
    uploadedImageUrls.length > 0
      ? []
      : retainedImageUrls;
  const images = [...existingImages, ...uploadedImageUrls].slice(
    0,
    MAX_PRODUCT_IMAGES,
  );

  return images.length ? images : [DEFAULT_PRODUCT_IMAGE];
}

function setProductFormMode(product = null) {
  const isEditing = Boolean(product);

  editingProductId = product?.id || null;
  productSubmitButton.textContent = isEditing ? "수정하기" : "등록하기";
  cancelProductEditButton.classList.toggle("hidden", !isEditing);
  productFormFields.imageInput.required = false;

  if (!isEditing) {
    uploadForm.reset();
    resetProductImageForm();
    updateCategoryCustomInputVisibility();
    return;
  }

  productFormFields.name.value = product.name || "";
  productFormFields.description.value = product.description || "";
  const productPrice = Number(product.price);
  productFormFields.price.value = Number.isFinite(productPrice)
    ? formatPrice(productPrice)
    : "";

  const category = product.category || "";
  if (category) appendCustomCategoryOption(category);
  productFormFields.category.value = category || "기타";
  productFormFields.categoryCustom.value = "";
  updateCategoryCustomInputVisibility();
  resetProductImageForm(getProductImages(product));
}

function handleProductImageSelection(event) {
  const selectedFiles = Array.from(event.currentTarget.files || []);
  if (!selectedFiles.length) return;

  if (
    retainedImageUrls.length === 1 &&
    retainedImageUrls[0] === DEFAULT_PRODUCT_IMAGE
  ) {
    retainedImageUrls = [];
  }

  const nextImageCount =
    getRetainedImageCountForLimit() +
    pendingImageFiles.length +
    selectedFiles.length;

  if (nextImageCount > MAX_PRODUCT_IMAGES) {
    showToast("사진은 최대 3장까지 선택할 수 있습니다.", { type: "error" });
    event.currentTarget.value = "";
    renderProductImagePreview();
    return;
  }

  pendingImageFiles = [...pendingImageFiles, ...selectedFiles].slice(
    0,
    MAX_PRODUCT_IMAGES,
  );
  event.currentTarget.value = "";
  renderProductImagePreview();
}

function parseProductPrice(value) {
  const rawPrice = String(value || "")
    .replaceAll(",", "")
    .trim();
  if (rawPrice === "나눔") return 0;

  const numericPriceText = rawPrice.endsWith("원")
    ? rawPrice.slice(0, -1).trim()
    : rawPrice;

  if (!/^\d+$/.test(numericPriceText)) return NaN;

  return Number(numericPriceText);
}

function removeProductImage(type, index) {
  if (type === "retained") {
    retainedImageUrls = retainedImageUrls.filter((_, itemIndex) => {
      return itemIndex !== index;
    });
  } else if (type === "pending") {
    pendingImageFiles = pendingImageFiles.filter((_, itemIndex) => {
      return itemIndex !== index;
    });
  }

  renderProductImagePreview();
}

// 상세 팝업에서 "수정"을 누르면 상세 모듈이 이 콜백을 호출한다(모달은 모듈이 이미 닫음).
// 판매 폼은 index에만 있으므로, 폼을 수정 모드로 채운 뒤 작성 시트를 연다.
function openProductEditForm(product) {
  setProductFormMode(product);
  openSellModal();
  productFormFields.name.focus();
}

// 다른 페이지(마이페이지 등)에서 index.html?edit=<id>로 넘어오면 해당 상품 수정 시트를 자동으로 연다.
function openEditFromQueryParam() {
  const params = new URLSearchParams(window.location.search);
  const editId = params.get("edit");
  if (!editId) return;

  // id 타입(숫자/문자)이 달라도 매칭되도록 문자열로 비교한다
  const product = state.products.find(
    (item) => String(item.id) === String(editId),
  );

  // 잘못된 id거나 내 상품이 아니면 폼을 열지 않고 URL만 정리한다
  if (product && canEditProduct(product)) {
    openProductEditForm(product);
  }

  // 새로고침/뒤로가기 때 수정 시트가 다시 뜨지 않도록 쿼리스트링을 제거한다
  const cleanUrl = window.location.pathname + window.location.hash;
  window.history.replaceState({}, "", cleanUrl);
}

async function createProduct(productPayload) {
  return getClient()
    .from("products")
    .insert({
      ...productPayload,
      seller: state.currentUser.nickname,
    });
}

async function updateProduct(product, productPayload) {
  return getClient()
    .from("products")
    .update(productPayload)
    .eq("id", product.id)
    .eq("seller", state.currentUser.nickname);
}

function getProductFormValues() {
  return {
    name: productFormFields.name.value.trim(),
    description: productFormFields.description.value.trim(),
    price: parseProductPrice(productFormFields.price.value),
    category:
      productFormFields.category?.value === "기타"
        ? productFormFields.categoryCustom?.value.trim()
        : productFormFields.category?.value,
    isCustomCategory: productFormFields.category?.value === "기타",
  };
}

function isValidProductFormValues({ name, price }) {
  return Boolean(name && Number.isFinite(price) && price >= 0);
}

async function uploadPendingProductImages() {
  return Promise.all(pendingImageFiles.map((file) => uploadProductImage(file)));
}

function buildProductPayload(formValues, uploadedImageUrls) {
  return {
    name: formValues.name,
    description: formValues.description,
    price: formValues.price,
    category: formValues.category,
    images: getProductFormImagesForSave(uploadedImageUrls),
  };
}

async function saveProduct(productBeingEdited, productPayload) {
  return productBeingEdited
    ? updateProduct(productBeingEdited, productPayload)
    : createProduct(productPayload);
}

async function saveProductForm() {
  if (!state.currentUser) {
    showToast("로그인 후 판매 글을 등록할 수 있습니다.", { type: "error" });
    return false;
  }

  const productBeingEdited = editingProductId
    ? findProductById(editingProductId)
    : null;
  const formValues = getProductFormValues();

  if (!isValidProductFormValues(formValues)) {
    showToast("판매 글 정보를 모두 입력해주세요.", { type: "error" });
    return false;
  }

  if (!getClient()) {
    showToast("Supabase 연결을 확인해주세요.", { type: "error" });
    return false;
  }

  if (editingProductId && !productBeingEdited) {
    showToast("수정할 상품을 찾지 못했습니다.", { type: "error" });
    return false;
  }

  let uploadedImageUrls = [];
  try {
    uploadedImageUrls = await uploadPendingProductImages();
  } catch (error) {
    console.error("상품 이미지를 업로드하지 못했습니다.", error);
    showToast("상품 이미지를 업로드하지 못했습니다.", { type: "error" });
    return false;
  }

  if (formValues.isCustomCategory) {
    await saveCustomCategory(formValues.category || "");
  }

  const productPayload = buildProductPayload(formValues, uploadedImageUrls);
  const { error } = await saveProduct(productBeingEdited, productPayload);

  if (error) {
    console.error("상품을 저장하지 못했습니다.", error);
    showToast("상품을 저장하지 못했습니다.", { type: "error" });
    return false;
  }

  setProductFormMode();
  await loadCustomCategoryOptions();
  await loadProductsFromSupabase();
  closeSellModal();
  setView("market");
  return true;
}

async function handleProductFormSubmit(event) {
  event.preventDefault();
  await saveProductForm();
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
  if (!productFormFields.category) return;

  const normalizedCategory = category.trim();
  if (!normalizedCategory) return;

  const optionExists = Array.from(productFormFields.category.options).some(
    (option) => option.value === normalizedCategory,
  );

  if (optionExists) return;

  const option = document.createElement("option");
  option.value = normalizedCategory;
  option.textContent = normalizedCategory;

  const otherOption = Array.from(productFormFields.category.options).find(
    (item) => item.value === "기타",
  );

  productFormFields.category.insertBefore(option, otherOption || null);
}

async function loadCustomCategoryOptions() {
  const client = getClient();
  if (!client) return;

  const { data, error } = await client.from("categories").select("name");

  if (error) {
    console.error("카테고리를 불러오지 못했습니다.", error);
    return;
  }

  (data || []).forEach((category) => {
    const categoryName = category.name || "";
    appendCustomCategoryOption(categoryName);
    if (categoryName.trim()) {
      loadedCategories.add(categoryName.trim());
    }
  });

  syncMarketCategoryFilterOptions();
}

function updateCategoryCustomInputVisibility() {
  if (!productFormFields.category || !productFormFields.categoryCustom) return;

  if (productFormFields.category.value === "기타") {
    productFormFields.categoryCustom.classList.remove("hidden");
  } else {
    productFormFields.categoryCustom.classList.add("hidden");
    productFormFields.categoryCustom.value = "";
  }
}

function handleProductImagePreviewClick(event) {
  const button = event.target.closest(".remove-image-button");
  if (!button) return;

  removeProductImage(
    button.dataset.imageType,
    Number(button.dataset.imageIndex),
  );
}

function handleMarketCategoryFilterChange(event) {
  selectedMarketCategory = event.currentTarget.value || "전체";
  renderProducts();
}

function bindProductFormEvents() {
  uploadForm.addEventListener("submit", handleProductFormSubmit);
  cancelProductEditButton.addEventListener("click", () => {
    setProductFormMode();
    closeSellModal();
  });
  photoUploadButton?.addEventListener("click", () => {
    productFormFields.imageInput?.click();
  });
  productFormFields.imageInput?.addEventListener(
    "change",
    handleProductImageSelection,
  );
  productImagePreview?.addEventListener(
    "click",
    handleProductImagePreviewClick,
  );
  updateCategoryCustomInputVisibility();
  productFormFields.category?.addEventListener(
    "change",
    updateCategoryCustomInputVisibility,
  );
}

function bindNavigationEvents() {
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setView(button.dataset.view);
    });
  });

  marketCategoryFilter?.addEventListener(
    "change",
    handleMarketCategoryFilterChange,
  );
}

function bindSellModalEvents() {
  openSellButton?.addEventListener("click", openSellModalForCreate);
  sellCloseButton?.addEventListener("click", closeSellModal);
  // 시트 바깥(배경)을 누르면 닫는다 — 상품 상세 모달과 동일한 UX
  sellModal?.addEventListener("click", (event) => {
    if (event.target === sellModal) closeSellModal();
  });
}

function bindEventListeners() {
  // 상세 팝업(공용 모듈)에 화면별 동작을 주입한다.
  // - onEdit: 수정 시 판매 폼(이 페이지 전용)을 수정 모드로 연다
  // - onChange: 찜/삭제 후 메인피드와 프로필 카드를 다시 그린다
  initProductDetail({
    onEdit: openProductEditForm,
    onChange: () => {
      renderProducts();
      renderSession();
    },
  });
  bindProductFormEvents();
  bindNavigationEvents();
  bindSellModalEvents();
}

async function init() {
  // Supabase 클라이언트를 먼저 준비해야 세션 확인(requireAuth)이 가능하다
  await setupSupabase();

  await loadCustomCategoryOptions();

  // 로그인하지 않은 사용자는 여기서 login.html로 리다이렉트되고 이후 로직은 건너뛴다.
  // requireAuth가 세션을 확인하며 state.currentUser를 채운 뒤 화면을 그린다.
  if (!(await requireAuth())) return;

  render();
  await initNotice();
  await loadProductsFromSupabase();

  // 마이페이지 등에서 index.html?edit=<id>로 넘어온 경우 해당 상품 수정 시트를 연다.
  // 상품 목록이 로드된 뒤에 실행해야 대상 상품을 찾을 수 있다.
  openEditFromQueryParam();
}

bindEventListeners();
init();
