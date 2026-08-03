// 상품 상세 팝업 도메인 모듈.
// 이미지 캐러셀 + 전체화면 뷰어 + 찜/수정/삭제까지 "상세 보기" 한 덩어리를 담당한다.
// 메인피드(app.js)와 마이페이지(mypage.js)가 동일한 상세 팝업을 공유하기 위해 app.js에서 분리했다.
// 화면(페이지)마다 다른 부분(수정 진입, 목록 다시 그리기)은 initProductDetail로 콜백을 주입받아 처리한다.
import { state, saveState } from "./store.js";
import { formatPrice } from "./utils.js?v=price-free-v2";
import { showToast } from "./toast.js";
import { showConfirm } from "./confirm.js";
import { getClient, updateProductLikes } from "./supabase-client.js";

const DEFAULT_PRODUCT_IMAGE = "assets/default_image.png";
// 예전 기본 이미지(Supabase 절대경로)는 "이미지 없음"으로 취급해 대표 이미지에서 걸러낸다
const LEGACY_DEFAULT_PRODUCT_IMAGE =
  "https://kqnxnnknexxkstwojwkb.supabase.co/storage/v1/object/public/product-images/default_image.png";

const productDetailModal = document.querySelector("#productDetailModal");
const productDetailHeroImage = document.querySelector(".detail-hero-image");
const productDetailSellerDate = document.querySelector(".detail-seller-date");
const productDetailCategory = document.querySelector(".detail-category");
const productDetailTitle = document.querySelector("#productDetailTitle");
const productDetailPrice = document.querySelector(".detail-price");
const productDetailDescription = document.querySelector(".detail-description");
const productDetailCloseButton = document.querySelector(".dialog-close-button");
const productDetailLikeButton = document.querySelector(".detail-like-button");
const productDetailLikeCount = document.querySelector(".detail-like-count");
const productDetailPrevButton = document.querySelector(".detail-image-prev");
const productDetailNextButton = document.querySelector(".detail-image-next");
const productDetailImageStatus = document.querySelector(".detail-image-status");
const productDetailImageDots = document.querySelector(".detail-image-dots");
const productDetailMoreButton = document.querySelector(".detail-more-button");
const productDetailMorePopover = document.querySelector(".detail-more-popover");
const productDetailEditButton = document.querySelector(".detail-edit-button");
const productDetailDeleteButton = document.querySelector(
  ".detail-delete-button",
);
const imageViewerModal = document.querySelector("#imageViewerModal");
const imageViewerImage = document.querySelector(".image-viewer-image");
const imageViewerCloseButton = document.querySelector(".image-viewer-close");
const imageViewerPrevButton = document.querySelector(".image-viewer-prev");
const imageViewerNextButton = document.querySelector(".image-viewer-next");
const imageViewerStatus = document.querySelector(".image-viewer-status");

// 호스트(페이지)가 주입하는 콜백.
// onEditProduct: 수정 진입 방식(폼 열기/다른 페이지 이동)은 화면마다 달라 콜백으로 위임한다. null이면 수정 버튼을 숨긴다.
// onProductsChanged: 찜/삭제로 목록이 바뀐 뒤 각 화면이 자기 리스트를 다시 그리도록 알린다.
let onEditProduct = null;
let onProductsChanged = () => {};

let currentProductId = null;
let currentDetailImages = [DEFAULT_PRODUCT_IMAGE];
let currentDetailImageIndex = 0;
let detailImageDragStartX = null;
let detailImageDidSwipe = false;
let currentViewerImageIndex = 0;

// 여러 소스(배열/문자열)에 흩어진 이미지 URL을 한 배열로 정리하고, 빈 값과 레거시 기본 이미지는 제외한다
export function normalizeImageUrls(...sources) {
  const urls = sources.flatMap((source) => {
    if (Array.isArray(source)) return source;
    if (typeof source === "string") return [source];
    return [];
  });

  return urls
    .map((url) => String(url || "").trim())
    .filter((url) => url && url !== LEGACY_DEFAULT_PRODUCT_IMAGE);
}

// 상품이 어떤 필드에 이미지를 담고 있든(images 배열 / 레거시 image·photo) 표시용 이미지 배열로 통일한다
export function getProductImages(product = {}) {
  const images = normalizeImageUrls(product.images);
  const legacyImages = normalizeImageUrls(product.image, product.photo);
  const productImages = images.length ? images : legacyImages;

  return productImages.length ? productImages : [DEFAULT_PRODUCT_IMAGE];
}

export function findProductById(productId) {
  return state.products.find((item) => item.id === productId);
}

// 관리자 여부는 profiles.is_admin 플래그로 판정한다(닉네임 하드코딩 제거)
function isAdmin(user = state.currentUser) {
  return Boolean(user?.isAdmin);
}

// 수정 권한: 본인이 올린 상품만 (seller 닉네임 기준, Phase 1)
export function canEditProduct(product) {
  return Boolean(
    product &&
    state.currentUser &&
    product.seller === state.currentUser.nickname,
  );
}

// 삭제 권한: 본인 상품이거나 관리자
function canDeleteProduct(product) {
  return Boolean(
    product && state.currentUser && (canEditProduct(product) || isAdmin()),
  );
}

function formatProductDate(value) {
  if (!value) return "등록일 없음";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "등록일 없음";

  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function renderProductDetailHeroImage(imageUrl, title) {
  productDetailHeroImage.replaceChildren();

  if (!imageUrl) {
    productDetailHeroImage.setAttribute("aria-label", "대표 이미지 없음");
    return;
  }

  const image = document.createElement("img");
  image.src = imageUrl;
  image.alt = `${title} 대표 이미지`;
  image.style.display = "block";
  image.style.width = "100%";
  image.style.height = "100%";
  image.style.objectFit = "contain";
  productDetailHeroImage.append(image);
  productDetailHeroImage.setAttribute("aria-label", `${title} 대표 이미지`);
}

function updateProductDetailImage(index) {
  const lastIndex = currentDetailImages.length - 1;
  currentDetailImageIndex = Math.min(Math.max(index, 0), lastIndex);
  const imageUrl = currentDetailImages[currentDetailImageIndex];
  const title = productDetailTitle.textContent || "상품";

  renderProductDetailHeroImage(imageUrl, title);
  const hasMultipleImages = currentDetailImages.length > 1;

  productDetailPrevButton?.classList.toggle("hidden", !hasMultipleImages);
  productDetailNextButton?.classList.toggle("hidden", !hasMultipleImages);
  productDetailImageStatus?.classList.toggle("hidden", !hasMultipleImages);
  productDetailImageDots?.classList.toggle("hidden", !hasMultipleImages);

  if (productDetailImageStatus) {
    productDetailImageStatus.textContent = `${currentDetailImageIndex + 1}/${currentDetailImages.length}`;
  }

  if (productDetailImageDots) {
    productDetailImageDots.replaceChildren();
    currentDetailImages.forEach((dotImageUrl, dotIndex) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "detail-image-dot";
      dot.classList.toggle("active", dotIndex === currentDetailImageIndex);
      dot.setAttribute("aria-label", `${dotIndex + 1}번째 이미지 보기`);
      dot.setAttribute(
        "aria-current",
        dotIndex === currentDetailImageIndex ? "true" : "false",
      );
      dot.setAttribute(
        "aria-pressed",
        String(dotIndex === currentDetailImageIndex),
      );
      dot.addEventListener("click", () => updateProductDetailImage(dotIndex));

      const thumbnail = document.createElement("img");
      thumbnail.src = dotImageUrl;
      thumbnail.alt = "";
      thumbnail.setAttribute("aria-hidden", "true");
      dot.append(thumbnail);
      productDetailImageDots.append(dot);
    });
  }
}

function moveProductDetailImage(step) {
  if (currentDetailImages.length <= 1) return;

  const nextIndex =
    (currentDetailImageIndex + step + currentDetailImages.length) %
    currentDetailImages.length;
  updateProductDetailImage(nextIndex);
}

function updateImageViewer(index) {
  if (!imageViewerImage || currentDetailImages.length === 0) return;

  const lastIndex = currentDetailImages.length - 1;
  currentViewerImageIndex = Math.min(Math.max(index, 0), lastIndex);
  const imageUrl = currentDetailImages[currentViewerImageIndex];
  const title = productDetailTitle.textContent || "상품";
  const hasMultipleImages = currentDetailImages.length > 1;

  imageViewerImage.src = imageUrl;
  imageViewerImage.alt = `${title} 확대 이미지`;
  imageViewerPrevButton?.classList.toggle("hidden", !hasMultipleImages);
  imageViewerNextButton?.classList.toggle("hidden", !hasMultipleImages);
  imageViewerStatus?.classList.toggle("hidden", !hasMultipleImages);

  if (imageViewerStatus) {
    imageViewerStatus.textContent = `${currentViewerImageIndex + 1}/${currentDetailImages.length}`;
  }
}

function moveImageViewer(step) {
  if (currentDetailImages.length <= 1) return;

  const nextIndex =
    (currentViewerImageIndex + step + currentDetailImages.length) %
    currentDetailImages.length;
  updateImageViewer(nextIndex);
}

function openImageViewer() {
  if (!imageViewerModal || currentDetailImages.length === 0) return;

  updateImageViewer(currentDetailImageIndex);

  if (!imageViewerModal.open) {
    imageViewerModal.showModal();
  }
}

function closeImageViewer() {
  if (!imageViewerModal?.open) return;

  imageViewerModal.close();
}

function renderProductDetailImages(images) {
  const productImages = normalizeImageUrls(images);
  currentDetailImages = productImages.length
    ? productImages
    : [DEFAULT_PRODUCT_IMAGE];

  updateProductDetailImage(0);
}

function updateProductDetailLikeState(likeCount, likedByCurrentUser) {
  productDetailLikeCount.textContent = likeCount;
  productDetailLikeButton?.classList.toggle("active", likedByCurrentUser);
  productDetailLikeButton?.setAttribute(
    "aria-pressed",
    String(likedByCurrentUser),
  );
  productDetailLikeButton?.setAttribute(
    "aria-label",
    likedByCurrentUser
      ? `찜 취소, 현재 ${likeCount}개`
      : `찜하기, 현재 ${likeCount}개`,
  );
  productDetailLikeButton?.setAttribute(
    "title",
    likedByCurrentUser ? "찜 취소" : "찜하기",
  );
}

// 상품 하나를 상세 팝업에 채워 넣고 모달을 연다. 목록 카드 클릭 시 이 함수를 호출한다.
export function openProductDetail(product) {
  if (!productDetailModal) return;

  currentProductId = product.id;
  const title = product.name || "상품명 없음";
  const numericPrice = Number(product.price);
  const price = Number.isFinite(numericPrice) ? numericPrice : 0;
  const images = getProductImages(product);
  const likes = Array.isArray(product.likes) ? product.likes : [];
  const likeCount = likes.length;
  const likedByCurrentUser = Boolean(
    state.currentUser && likes.includes(state.currentUser.nickname),
  );
  // 수정 콜백이 주입된 화면(폼이 있는 index)에서만 수정 버튼을 노출한다
  const editableByCurrentUser =
    canEditProduct(product) && typeof onEditProduct === "function";
  const deletableByCurrentUser = canDeleteProduct(product);

  productDetailCategory.textContent = product.category || "카테고리 없음";
  productDetailTitle.textContent = title;
  productDetailPrice.textContent = formatPrice(price);
  renderProductDetailImages(images);
  productDetailDescription.textContent =
    product.description || "상품 설명이 없습니다.";
  productDetailSellerDate.textContent = `${product.seller || "알 수 없음"} · ${formatProductDate(product.createdAt)}`;
  updateProductDetailLikeState(likeCount, likedByCurrentUser);
  productDetailEditButton?.classList.toggle("hidden", !editableByCurrentUser);
  productDetailDeleteButton?.classList.toggle(
    "hidden",
    !deletableByCurrentUser,
  );
  productDetailMoreButton?.classList.toggle(
    "hidden",
    !(editableByCurrentUser || deletableByCurrentUser),
  );
  closeProductDetailMoreMenu();
  productDetailModal.showModal();
}

function closeProductDetailModal() {
  currentProductId = null;
  closeImageViewer();
  closeProductDetailMoreMenu();
  productDetailModal.close();
}

function closeProductDetailMoreMenu() {
  productDetailMorePopover?.classList.add("hidden");
  productDetailMoreButton?.setAttribute("aria-expanded", "false");
}

function toggleProductDetailMoreMenu() {
  if (!productDetailMorePopover || !productDetailMoreButton) return;

  const isOpening = productDetailMorePopover.classList.contains("hidden");
  productDetailMorePopover.classList.toggle("hidden", !isOpening);
  productDetailMoreButton.setAttribute("aria-expanded", String(isOpening));
}

function handleDetailImageDragStart(event) {
  if (currentDetailImages.length <= 1) return;

  detailImageDidSwipe = false;
  detailImageDragStartX = event.clientX;
}

function handleDetailImageDragEnd(event) {
  if (detailImageDragStartX === null) return;

  const dragDistance = event.clientX - detailImageDragStartX;
  detailImageDragStartX = null;

  if (Math.abs(dragDistance) < 48) return;

  detailImageDidSwipe = true;
  moveProductDetailImage(dragDistance > 0 ? -1 : 1);
}

// 팝업이 열려 있는 동안 찜 상태가 바뀌면(내 찜 토글/서버 응답) 좋아요 표시만 다시 그린다
function refreshOpenProductDetailLike() {
  if (currentProductId === null || !productDetailModal.open) return;

  const product = findProductById(currentProductId);
  if (!product) return;

  const likeCount = Array.isArray(product.likes) ? product.likes.length : 0;
  const likedByCurrentUser = Boolean(
    state.currentUser && product.likes.includes(state.currentUser.nickname),
  );

  updateProductDetailLikeState(likeCount, likedByCurrentUser);
}

// 수정 버튼: 실제 진입 방식은 화면마다 다르므로(폼 열기 vs 페이지 이동) 주입된 콜백에 위임한다
function startProductEdit() {
  if (currentProductId === null) return;

  const product = findProductById(currentProductId);
  if (!canEditProduct(product)) return;
  if (typeof onEditProduct !== "function") return;

  closeProductDetailModal();
  onEditProduct(product);
}

async function deleteProduct(product) {
  const { data, error } = await getClient()
    .from("products")
    .delete()
    .eq("id", product.id)
    .select("id");

  if (error || !data?.length) {
    return { ok: false, error: error || new Error("삭제된 행이 없습니다.") };
  }

  state.products = state.products.filter((item) => item.id !== product.id);
  return { ok: true };
}

async function deleteCurrentProduct() {
  if (currentProductId === null) return;

  const product = findProductById(currentProductId);
  if (!canDeleteProduct(product)) return;

  // 실수 삭제를 막기 위해 공통 확인 팝업으로 한 번 더 확인받는다
  const confirmed = await showConfirm("상품을 삭제하시겠어요?", {
    confirmText: "확인",
    cancelText: "취소",
    tone: "danger",
  });
  if (!confirmed) return;

  try {
    const result = await deleteProduct(product);
    if (result.ok) {
      closeProductDetailModal();
      // 삭제 후 목록 다시 그리기는 화면별 콜백에 맡긴다
      onProductsChanged();
      return;
    }

    console.warn("상품을 삭제하지 못했습니다.", result.error);
  } catch (error) {
    console.warn("상품 삭제 중 오류가 발생했습니다.", error);
  }

  showToast("상품을 삭제하지 못했습니다.", { type: "error" });
}

async function toggleLike(productId) {
  if (!state.currentUser) {
    showToast("로그인 후 찜할 수 있습니다.", { type: "error" });
    return;
  }

  const product = findProductById(productId);
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
    refreshOpenProductDetailLike();
    return;
  }

  // 서버가 확정한 likes로 로컬 상태를 맞춘 뒤 화면별 목록을 다시 그린다
  product.likes = result.likes;
  saveState();
  onProductsChanged();
  refreshOpenProductDetailLike();
}

async function handleProductDetailLikeClick() {
  if (currentProductId === null) return;

  await toggleLike(currentProductId);
}

function handleProductDetailPointerCancel() {
  detailImageDragStartX = null;
  detailImageDidSwipe = false;
}

function handleProductDetailHeroClick() {
  // 스와이프로 이미지를 넘긴 직후의 클릭은 확대 열기로 오인하지 않도록 무시한다
  if (detailImageDidSwipe) {
    detailImageDidSwipe = false;
    return;
  }

  openImageViewer();
}

function handleProductDetailModalClick(event) {
  if (event.target === productDetailModal) {
    closeProductDetailModal();
    return;
  }

  if (!event.target.closest(".detail-more-menu")) {
    closeProductDetailMoreMenu();
  }
}

function handleImageViewerModalClick(event) {
  if (
    event.target === imageViewerModal ||
    event.target.classList.contains("image-viewer-panel") ||
    event.target.classList.contains("image-viewer-stage")
  ) {
    closeImageViewer();
  }
}

function handleImageViewerKeydown(event) {
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    moveImageViewer(-1);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    moveImageViewer(1);
  }
}

function bindProductDetailModalEvents() {
  productDetailCloseButton.addEventListener("click", closeProductDetailModal);
  productDetailLikeButton?.addEventListener(
    "click",
    handleProductDetailLikeClick,
  );
  productDetailEditButton?.addEventListener("click", startProductEdit);
  productDetailDeleteButton?.addEventListener("click", deleteCurrentProduct);
  productDetailMoreButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleProductDetailMoreMenu();
  });
  productDetailPrevButton?.addEventListener("click", () => {
    moveProductDetailImage(-1);
  });
  productDetailNextButton?.addEventListener("click", () => {
    moveProductDetailImage(1);
  });
  productDetailHeroImage?.addEventListener(
    "pointerdown",
    handleDetailImageDragStart,
  );
  productDetailHeroImage?.addEventListener(
    "pointerup",
    handleDetailImageDragEnd,
  );
  productDetailHeroImage?.addEventListener(
    "pointercancel",
    handleProductDetailPointerCancel,
  );
  productDetailHeroImage?.addEventListener(
    "click",
    handleProductDetailHeroClick,
  );
  productDetailModal.addEventListener("click", handleProductDetailModalClick);
}

function bindImageViewerEvents() {
  imageViewerCloseButton?.addEventListener("click", closeImageViewer);
  imageViewerPrevButton?.addEventListener("click", () => {
    moveImageViewer(-1);
  });
  imageViewerNextButton?.addEventListener("click", () => {
    moveImageViewer(1);
  });
  imageViewerModal?.addEventListener("click", handleImageViewerModalClick);
  imageViewerModal?.addEventListener("keydown", handleImageViewerKeydown);
}

// 상세 팝업을 사용할 화면에서 한 번 호출한다.
// 이 페이지에 상세 모달 마크업이 없으면(모달을 안 쓰는 화면) 조용히 건너뛴다.
export function initProductDetail({ onEdit = null, onChange = () => {} } = {}) {
  if (!productDetailModal) return;

  onEditProduct = onEdit;
  onProductsChanged = onChange;
  bindProductDetailModalEvents();
  bindImageViewerEvents();
}
