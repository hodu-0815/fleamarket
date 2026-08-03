import { state } from "./store.js";
import { escapeHtml } from "./utils.js";
import { requireAuth, logout } from "./auth.js";
import { setupSupabase, fetchFriends } from "./supabase-client.js";

const sessionPanel = document.querySelector("#friendmapSessionPanel");
const timeline = document.querySelector("#timeline");
const friendCount = document.querySelector("#friendCount");
const friendCardTemplate = document.querySelector("#friendCardTemplate");

// 방문시간 텍스트에서 시작 시각을 뽑아 "분 단위 정수"로 반환한다.
// visit_time은 자유 텍스트라("토14:00-16:00", "오후 3시~" 등) 첫 HH:MM만 정렬 기준으로 쓴다.
// 분까지 있으면 반영하고, 파싱이 안 되면 null을 돌려줘 "시간 미정"으로 분류되게 한다.
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

// 닉네임 첫 글자로 이니셜 플레이스홀더를 만든다 (마이페이지와 동일 규칙)
function getInitials(nickname) {
  const text = String(nickname || "").trim();
  if (!text) return "?";
  return Array.from(text)[0];
}

function renderSession() {
  const user = state.currentUser;
  if (!user) return;

  sessionPanel.innerHTML = `
    <strong>${escapeHtml(user.nickname)}</strong>
    <p>파티에 누가 언제 오는지 살펴보세요.</p>
    <div class="session-actions">
      <a class="secondary-button session-link" href="index.html">마켓으로</a>
      <a class="secondary-button session-link" href="mypage.html">마이페이지</a>
      <button class="secondary-button" id="friendmapLogoutButton" type="button">로그아웃</button>
    </div>
  `;

  document
    .querySelector("#friendmapLogoutButton")
    .addEventListener("click", () => {
      logout();
    });
}

// 친구 카드 1건을 템플릿에서 복제해 채운다.
// timeLabel이 없으면(시간 미정) 뱃지 자리를 "미정"으로 표시한다.
function createFriendCard(friend, timeLabel) {
  const node = friendCardTemplate.content.cloneNode(true);
  const card = node.querySelector(".friend-card");
  const badge = node.querySelector(".time-badge");
  const avatarImage = node.querySelector(".friend-avatar-image");
  const avatarInitials = node.querySelector(".friend-avatar-initials");
  const nickname = node.querySelector(".friend-nickname");
  const relationship = node.querySelector(".friend-relationship");

  badge.textContent = timeLabel || "미정";

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
  // 본인 카드에는 닉네임 옆에 "나" 뱃지를 덧붙인다
  if (isMe) {
    const meBadge = document.createElement("span");
    meBadge.className = "friend-me-badge";
    meBadge.textContent = "나";
    nickname.append(" ", meBadge);
  }

  // 관계 미입력자는 빈칸 대신 안내 문구로 채워 카드 높이를 일정하게 유지한다
  relationship.textContent = friend.relationship?.trim()
    ? friend.relationship.trim()
    : "-";

  return node;
}

function renderEmpty() {
  const empty = document.createElement("p");
  empty.className = "empty-state";
  empty.textContent = "아직 등록된 참석자가 없습니다.";
  timeline.append(empty);
}

// 방문시간이 있는 사람은 시각 오름차순으로, 없는 사람은 "시간 미정" 그룹으로 하단에 그린다
function renderTimeline(friends) {
  timeline.innerHTML = "";
  friendCount.textContent = `${friends.length}명`;

  if (friends.length === 0) {
    renderEmpty();
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

  withTime.sort((a, b) => a.start - b.start);

  withTime.forEach(({ friend, start }) => {
    timeline.append(createFriendCard(friend, formatTimeBadge(start)));
  });

  // 시간 미정 그룹은 구분 헤더를 붙여 하단에 모아 보여준다
  if (withoutTime.length > 0) {
    const divider = document.createElement("p");
    divider.className = "timeline-divider";
    divider.textContent = "시간 미정";
    timeline.append(divider);

    withoutTime.forEach((friend) => {
      timeline.append(createFriendCard(friend, ""));
    });
  }
}

async function boot() {
  await setupSupabase();
  // requireAuth → getSession이 currentUser를 채우고, 미로그인 시 login.html로 보낸다
  if (!(await requireAuth())) return;

  renderSession();
  const friends = await fetchFriends();
  renderTimeline(friends);
}

boot();
