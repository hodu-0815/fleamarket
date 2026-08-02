import { state, saveState } from "./store.js";
import { escapeHtml, formatPrice } from "./utils.js?v=price-free-v2";
import { showToast } from "./toast.js";
import { requireAuth, logout } from "./auth.js";
import {
  setupSupabase,
  getClient,
  updateProductLikes,
} from "./supabase-client.js";
import { initNotice } from "./notice.js";

const PRODUCT_IMAGE_BUCKET = "product-images";
const DEFAULT_PRODUCT_IMAGE = "assets/default_image.png";
const LEGACY_DEFAULT_PRODUCT_IMAGE =
  "https://kqnxnnknexxkstwojwkb.supabase.co/storage/v1/object/public/product-images/default_image.png";
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
let currentProductId = null;
let editingProductId = null;
let retainedImageUrls = [];
let pendingImageFiles = [];
let productImagePreviewObjectUrls = [];
let currentDetailImages = [DEFAULT_PRODUCT_IMAGE];
let currentDetailImageIndex = 0;
let detailImageDragStartX = null;
let detailImageDidSwipe = false;
let currentViewerImageIndex = 0;
let selectedMarketCategory = "전체";
const loadedCategories = new Set();

// 관리자 여부는 profiles.is_admin 플래그로 판정한다(닉네임 하드코딩 제거).
function isAdmin(user = state.currentUser) {
  return Boolean(user?.isAdmin);
}

function normalizeImageUrls(...sources) {
  const urls = sources.flatMap((source) => {
    if (Array.isArray(source)) return source;
    if (typeof source === "string") return [source];
    return [];
  });

  return urls
    .map((url) => String(url || "").trim())
    .filter((url) => url && url !== LEGACY_DEFAULT_PRODUCT_IMAGE);
}

function getProductImages(product = {}) {
  const images = normalizeImageUrls(product.images);
  const legacyImages = normalizeImageUrls(product.image, product.photo);
  const productImages = images.length ? images : legacyImages;

  return productImages.length ? productImages : [DEFAULT_PRODUCT_IMAGE];
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
    <div class="profile">
      <div class="profile-info">
        <div class="nickname">${escapeHtml(user.nickname)}${isAdmin(user) ? " · 관리자" : ""}</div>
        <div class="permission">${isAdmin(user) ? "공지 편집 권한이 있습니다." : "판매 등록과 찜하기가 가능합니다."}</div>
      </div>
      <div class="profile-actions">
        <a class="secondary-button profile-mypage" href="mypage.html">마이페이지</a>
        <button class="profile-logout-link" id="logoutButton" type="button">나가기 &gt;</button>
      </div>
    </div>
  `;

  document.querySelector("#logoutButton").addEventListener("click", () => {
    logout();
  });
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
  const seller = node.querySelector(".seller");
  const likeCount = node.querySelector(".like-count");
  const productImages = getProductImages(product);
  const likes = Array.isArray(product.likes) ? product.likes : [];

  image.src = productImages[0];
  image.alt = `${product.name} 사진`;
  title.textContent = product.name;
  price.textContent = formatPrice(product.price);
  seller.textContent = product.seller;
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

function openProductDetail(product) {
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
  const editableByCurrentUser = canEditProduct(product);
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

  window.scrollTo({ top: 0, behavior: "smooth" });
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

function findProductById(productId) {
  return state.products.find((item) => item.id === productId);
}

function canEditProduct(product) {
  return Boolean(
    product &&
      state.currentUser &&
      product.seller === state.currentUser.nickname,
  );
}

function canDeleteProduct(product) {
  return Boolean(
    product && state.currentUser && (canEditProduct(product) || isAdmin()),
  );
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
  const rawPrice = String(value || "").replaceAll(",", "").trim();
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

function startProductEdit() {
  if (currentProductId === null) return;

  const product = findProductById(currentProductId);
  if (!canEditProduct(product)) return;

  setProductFormMode(product);
  closeProductDetailModal();
  setView("sell");
  productFormFields.name.focus();
}

async function createProduct(productPayload) {
  return getClient().from("products").insert({
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
  if (!window.confirm("이 상품을 삭제할까요?")) return;

  try {
    const result = await deleteProduct(product);
    if (result.ok) {
      closeProductDetailModal();
      renderProducts();
      await loadProductsFromSupabase();
      return;
    }

    console.warn("상품을 삭제하지 못했습니다.", result.error);
  } catch (error) {
    console.warn("상품 삭제 중 오류가 발생했습니다.", error);
  }

  showToast("상품을 삭제하지 못했습니다.", { type: "error" });
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
  setView("market");
  return true;
}

async function handleProductFormSubmit(event) {
  event.preventDefault();
  await saveProductForm();
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

  // 서버가 확정한 likes로 로컬 상태를 맞춘 뒤 다시 그린다
  product.likes = result.likes;
  saveState();
  renderProducts();
  refreshOpenProductDetailLike();
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

async function handleProductDetailLikeClick() {
  if (currentProductId === null) return;

  await toggleLike(currentProductId);
}

function handleProductDetailPointerCancel() {
  detailImageDragStartX = null;
  detailImageDidSwipe = false;
}

function handleProductDetailHeroClick() {
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

function bindProductFormEvents() {
  uploadForm.addEventListener("submit", handleProductFormSubmit);
  cancelProductEditButton.addEventListener("click", () => {
    setProductFormMode();
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

function bindEventListeners() {
  bindProductDetailModalEvents();
  bindImageViewerEvents();
  bindProductFormEvents();
  bindNavigationEvents();
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
}

bindEventListeners();
init();
