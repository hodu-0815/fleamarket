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

function renderEmpty() {
  const empty = document.createElement("p");
  empty.className = "empty-state";
  empty.textContent = "아직 등록된 참석자가 없습니다.";
  timeline.append(empty);
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

async function boot() {
  await setupSupabase();
  // requireAuth → getSession이 currentUser를 채우고, 미로그인 시 login.html로 보낸다
  if (!(await requireAuth())) return;

  renderSession();
  const friends = await fetchFriends();
  renderTimeline(friends);
}

boot();
