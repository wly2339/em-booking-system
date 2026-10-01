const app = document.querySelector("#app");
const config = window.EM_BOOKING_CONFIG || {};
const apiBase = (config.apiBase || "https://em-booking-prod-d9fk1sxd5b3eede0-1328021766.ap-shanghai.app.tcloudbase.com/api").replace(/\/$/, "");
const tokenStorageKey = "em_booking_access_token";

let booted = false;
let state = {
  user: null,
  profile: null,
  userProfiles: [],
  authMode: "signin",
  microscopes: [],
  accessories: [],
  holidays: [],
  bookings: [],
  activeTab: "schedule",
  selectedDate: toDateInputValue(new Date()),
  selectedMicroscopeId: "all",
  scheduleCalendarZoom: 1,
  mineCalendarZoom: 1,
  selectedMicroscopeForEdit: null,
  selectedUserBookingsId: null,
  selectedUserBookings: []
};

async function api(path, options = {}) {
  const token = localStorage.getItem(tokenStorageKey);
  const response = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "X-EM-Session": token } : {}),
      ...(options.headers || {})
    },
    ...options
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || `请求失败（${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function profileFromUser(user) {
  return {
    id: user.id, email: user.email, full_name: user.fullName || "", lab: user.lab || "",
    user_type: user.userType || "internal", organization: user.organization || user.lab || "",
    booking_permission: user.bookingPermission || "none", phone: user.phone || "", role: user.role
  };
}

async function boot() {
  renderLoading();
  try {
    const { user } = await api("/auth/me");
    state.user = user;
    state.profile = profileFromUser(user);
  } catch (error) {
    if (error.status !== 401) console.warn("Session check failed", error);
    if (error.status === 401) localStorage.removeItem(tokenStorageKey);
    state.user = null;
  }

  if (state.user) {
    await loadAppData();
  } else {
    renderAuth();
  }

  booted = true;
}

async function loadAppData() {
  try {
    renderLoading();
    await Promise.all([loadProfile(), loadMicroscopes(), loadAccessories(), loadHolidays()]);
    if (isSuperAdmin()) {
      await loadUserProfiles();
    } else {
      state.userProfiles = [];
    }
    await loadBookings();
    renderApp();
  } catch (error) {
    renderAppError(error);
  }
}

async function loadUserProfiles() {
  const { users } = await api("/admin/users");
  state.userProfiles = users || [];
}

function isAdminRole() {
  return ["admin", "super_admin"].includes(state.profile?.role);
}

function isSuperAdmin() {
  return state.profile?.role === "super_admin";
}

async function loadProfile() {
  const { user } = await api("/auth/me");
  state.user = user;
  state.profile = profileFromUser(user);
}

async function loadMicroscopes() {
  const { microscopes } = await api("/microscopes");
  state.microscopes = microscopes || [];
  if (state.selectedMicroscopeId !== "all" && !state.microscopes.some((item) => item.id === state.selectedMicroscopeId)) {
    state.selectedMicroscopeId = "all";
  }
}

async function loadAccessories() {
  const { accessories } = await api("/booking-accessories");
  state.accessories = accessories || [];
}

async function loadHolidays() {
  const { holidays } = await api("/holidays");
  state.holidays = holidays || [];
}

async function loadBookings() {
  const selectedDate = new Date(`${state.selectedDate}T00:00:00`);
  const usesWeekRange = ["schedule", "mine"].includes(state.activeTab);
  const dateStart = usesWeekRange ? startOfWeek(selectedDate) : selectedDate;
  const dateEnd = usesWeekRange ? addDays(dateStart, 7) : addDays(dateStart, 1);

  const params = new URLSearchParams({ start: dateStart.toISOString(), end: dateEnd.toISOString() });
  if (state.activeTab === "mine") params.set("mine", "true");
  if (state.selectedMicroscopeId !== "all") params.set("microscopeId", state.selectedMicroscopeId);
  const { bookings } = await api(`/bookings?${params}`);
  state.bookings = bookings || [];
}

function renderLoading() {
  app.innerHTML = `
    <main class="shell">
      <section class="boot">
        <h1>电镜预约系统</h1>
        <p>正在载入...</p>
      </section>
    </main>
  `;
}

function renderAppError(error) {
  app.innerHTML = `
    <main class="shell compact">
      <section class="notice-panel">
        <h1>载入失败</h1>
        <p>${escapeHtml(friendlyError(error))}</p>
        <button class="primary" type="button" id="reload-app">重新载入</button>
      </section>
    </main>
  `;

  document.querySelector("#reload-app").addEventListener("click", () => window.location.reload());
}

function renderAuth() {
  const isSignUp = state.authMode === "signup";
  app.innerHTML = `
    <main class="auth-layout">
      <section class="auth-media" aria-label="电镜实验室"></section>
      <section class="auth-panel">
        <div class="brand">
          <span>EM Booking</span>
          <strong>电镜预约系统</strong>
        </div>
        <form class="auth-form" id="auth-form">
          ${isSignUp ? `
            <label>
              姓名
              <input name="full_name" type="text" autocomplete="name" required placeholder="请输入真实姓名">
            </label>
            <label>
              用户类别
              <select name="user_type" required>
                <option value="internal">校内用户</option>
                <option value="external">校外用户</option>
              </select>
            </label>
            <label>
              单位或学院
              <input name="organization" type="text" required maxlength="100" placeholder="如：材料学院 / XX 科技有限公司">
            </label>
          ` : ""}
          <label>
            邮箱
            <input name="email" type="email" autocomplete="email" required>
          </label>
          <label>
            密码
            <input name="password" type="password" autocomplete="${isSignUp ? "new-password" : "current-password"}" minlength="10" required>
          </label>
          ${isSignUp ? `<p class="form-hint">密码至少 10 位。新账号默认仅可查看；提交预约权限申请并获批准后才能预约。</p>` : ""}
          <div class="auth-actions">
            <button class="primary" type="submit" data-auth-mode="${isSignUp ? "signup" : "signin"}">${isSignUp ? "注册并登录" : "登录"}</button>
            <button class="secondary" type="button" data-auth-toggle>${isSignUp ? "返回登录" : "注册账号"}</button>
          </div>
        </form>
      </section>
    </main>
  `;

  document.querySelector("#auth-form").addEventListener("submit", isSignUp ? handleSignUp : handleSignIn);
  document.querySelector("[data-auth-toggle]").addEventListener("click", () => {
    state.authMode = isSignUp ? "signin" : "signup";
    renderAuth();
  });
}

function renderApp() {
  const isAdmin = isAdminRole();
  const superAdmin = isSuperAdmin();

  app.innerHTML = `
    <div class="app-frame">
      <aside class="sidebar">
        <div class="brand">
          <span>EM Booking</span>
          <strong>电镜预约系统</strong>
        </div>
        <nav class="tabs" aria-label="主导航">
          ${tabButton("schedule", "日程")}
          ${tabButton("mine", "我的预约")}
          ${isAdmin ? tabButton("admin", "管理") : ""}
          ${superAdmin ? tabButton("users", "用户管理") : ""}
        </nav>
        <button class="ghost" id="sign-out" type="button">退出登录</button>
      </aside>

      <main class="workspace">
        <header class="topbar">
          <div>
            <p>${dateSummary()}</p>
            <h1>${pageTitle()}</h1>
          </div>
          <div class="filters">
            <label>
              日期
              <input id="date-filter" type="date" value="${state.selectedDate}">
            </label>
            <label>
              设备
              <select id="microscope-filter">
                <option value="all">全部设备</option>
                ${renderMicroscopeFilterOptions(state.microscopes)}
              </select>
            </label>
          </div>
        </header>

        ${state.activeTab === "schedule" ? renderSchedule() : ""}
        ${state.activeTab === "mine" ? renderMine() : ""}
        ${state.activeTab === "admin" && isAdmin ? renderAdmin() : ""}
        ${state.activeTab === "users" && superAdmin ? renderUserAdmin() : ""}
      </main>
    </div>
  `;

  wireAppEvents();
}

function renderSchedule() {
  const selectedDate = new Date(`${state.selectedDate}T00:00:00`);
  const weekStart = startOfWeek(selectedDate);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const visibleBookings = state.bookings.filter((booking) => state.selectedMicroscopeId === "all" || booking.microscope_id === state.selectedMicroscopeId);
  const selectedDayBookings = visibleBookings.filter((booking) => sameDate(new Date(booking.start_at), selectedDate));

  return `
    <section class="panel wide schedule-panel">
      <div class="section-head">
        <h2>周视图</h2>
        <span>${visibleBookings.length} 条预约</span>
      </div>
      <div class="schedule-controls">
        <button type="button" data-week-shift="-7">上一周</button>
        <button class="secondary" type="button" data-week-today>本周</button>
        <button type="button" data-week-shift="7">下一周</button>
      </div>
      ${renderTimeCalendar(weekDays, visibleBookings, state.scheduleCalendarZoom, "schedule")}
    </section>
    <section class="panel wide">
        <div class="section-head">
          <h2>${formatMonthDay(selectedDate)} 预约明细</h2>
          <span>${selectedDayBookings.length} 条</span>
        </div>
        ${renderBookingList(selectedDayBookings, { adminActions: false, ownActions: false })}
    </section>
  `;
}

function renderMine() {
  const selectedDate = new Date(`${state.selectedDate}T00:00:00`);
  const weekStart = startOfWeek(selectedDate);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const selectedDayBookings = state.bookings.filter((booking) => sameDate(new Date(booking.start_at), selectedDate));

  return `
    <section class="content-grid mine-grid">
      ${renderBookingForm()}
      <section class="panel mine-schedule-panel">
        <div class="section-head">
          <h2>我的本周预约</h2>
          <span>${state.bookings.length} 条</span>
        </div>
        <div class="schedule-controls">
          <button type="button" data-week-shift="-7">上一周</button>
          <button class="secondary" type="button" data-week-today>本周</button>
          <button type="button" data-week-shift="7">下一周</button>
        </div>
      ${renderTimeCalendar(weekDays, state.bookings, state.mineCalendarZoom, "mine")}
        <div class="booking-subsection">
          <div class="section-head compact-head">
            <h3>${formatMonthDay(selectedDate)} 我的预约明细</h3>
            <span>${selectedDayBookings.length} 条</span>
          </div>
          ${renderBookingList(selectedDayBookings, { ownActions: true, adminActions: false })}
        </div>
      </section>
    </section>
  `;
}

function renderBookingForm() {
  const availableMicroscopes = state.microscopes.filter((item) => item.status === "available");
  const defaultDate = state.selectedDate;
  const canBook = isAdminRole() || state.profile?.booking_permission === "approved";

  if (!canBook) {
    const permission = state.profile?.booking_permission || "none";
    const awaitingReview = permission === "pending";
    const wasRejected = permission === "rejected";
    return `
      <section class="booking-form permission-panel">
        <h2>预约权限</h2>
        <p class="form-note">${awaitingReview ? "你的预约权限申请正在等待管理员审核。" : wasRejected ? "上一次申请未获批准。你可以补充信息后重新申请。" : "当前账号仅可查看设备日程和预约记录。"}</p>
        <p>用户类别：${userTypeText(state.profile?.user_type)} · 单位或学院：${escapeHtml(state.profile?.organization || "未填写")}</p>
        ${awaitingReview ? `<button class="secondary" type="button" disabled>审核中</button>` : `<button class="primary" type="button" data-request-booking-permission>${wasRejected ? "重新申请预约权限" : "申请预约权限"}</button>`}
      </section>
    `;
  }

  return `
    <form class="booking-form" id="booking-form">
      <header class="booking-form-header">
        <span class="booking-kicker">BOOKING REQUEST</span>
        <h2>提交预约</h2>
        <p class="form-note">填写预约信息后进入审核队列；系统会自动核验时间冲突并计算预估费用。</p>
      </header>
      <section class="booking-section booking-section-device">
        <h3><span>01</span> 人员与设备</h3>
        <label>
          预约人姓名
          <input name="full_name" autocomplete="name" value="${escapeAttr(state.profile?.full_name)}" required>
        </label>
        <label>
          单位或学院
          <input name="organization" value="${escapeAttr(state.profile?.organization || state.profile?.lab || "未填写单位")}" readonly>
          <small>单位信息来自注册资料；如需修改，请在个人资料中更新。</small>
        </label>
        <label>
          设备
          <select name="microscope_id" required ${availableMicroscopes.length ? "" : "disabled"}>
            ${renderMicroscopeOptions(availableMicroscopes)}
          </select>
        </label>
        <label id="pricing-option-field" hidden>
          子项目（该设备有收费子项目时显示）
          <select name="pricing_option_id"></select>
        </label>
        <label id="acceleration-voltage-field" hidden>
          加速电压（双球差电镜专用）
          <select name="acceleration_voltage">
            ${[60, 80, 100, 200, 300].map((voltage) => `<option value="${voltage}" ${voltage === 300 ? "selected" : ""}>${voltage} kV</option>`).join("")}
          </select>
          <small>非 300 kV 的预约会以不同颜色显示在日程表中。</small>
        </label>
        <label id="accessory-field" hidden>
          是否使用原位样品杆
          <select name="accessory_id">
            <option value="">不使用原位样品杆</option>
            ${state.accessories.map((item) => `<option value="${escapeAttr(item.id)}">使用：${escapeHtml(item.name)}</option>`).join("")}
          </select>
        </label>
        <label id="sample-count-field" hidden>
          样品数量
          <input name="sample_count" type="number" min="1" max="1000" step="1" value="1">
          <small>制样设备按样品收费时，此数量会计入预估费用。</small>
        </label>
      </section>
      <section class="booking-section booking-section-time">
        <h3><span>02</span> 预约时段 <small>支持整点与半点</small></h3>
        <div class="two-col">
          <label>
            开始日期
            <input name="start_date" type="date" value="${defaultDate}" required>
          </label>
          <label>
            开始时间
            <select name="start_time" required>
              ${renderHalfHourOptions("09:00")}
            </select>
          </label>
          <label>
            结束日期
            <input name="end_date" type="date" value="${defaultDate}" required>
          </label>
          <label>
            结束时间
            <select name="end_time" required>
              ${renderHalfHourOptions("10:00")}
            </select>
          </label>
        </div>
      </section>
      <section class="booking-section booking-section-service">
        <h3><span>03</span> 测试与附件</h3>
        <label id="service-mode-field" ${state.profile?.user_type === "external" ? "hidden" : ""}>
          测试方式
          <select name="service_mode">
            <option value="self">自主测试</option>
            <option value="delivery">送样测试</option>
          </select>
        </label>
        <label id="analysis-request-field" hidden>
          分析测试需求单（PDF）
          <input name="analysis_request_file" type="file" accept="application/pdf,.pdf">
          <small>送样测试必传，PDF 不超过 4 MB。</small>
        </label>
      </section>
      <section class="fee-preview" aria-live="polite" id="fee-preview"></section>
      <section class="booking-section booking-section-purpose">
        <h3><span>04</span> 样品与实验目的</h3>
        <label>
          请描述测试样品、预期观察内容或分析目标
          <textarea name="purpose" rows="4" placeholder="例如：粉末样品；观察颗粒形貌，需低剂量测试" required></textarea>
        </label>
      </section>
      ${availableMicroscopes.length ? "" : `<div class="empty compact-empty">暂无可预约设备，请联系管理员。</div>`}
      <button class="primary booking-submit" type="submit" ${availableMicroscopes.length ? "" : "disabled"}>提交预约申请 <span>→</span></button>
    </form>
  `;
}

function renderMicroscopeOptions(microscopes) {
  const categories = [
    ["tem", "透射电子显微镜"],
    ["fib_sem", "双束电子显微镜"],
    ["sem", "扫描电子显微镜"],
    ["xray", "X 射线断层扫描"],
    ["preparation", "制样设备"]
  ];
  return categories.map(([category, label]) => {
    const items = microscopes.filter((item) => (item.equipment_category || "preparation") === category);
    if (!items.length) return "";
    return `<optgroup label="${label}">${items.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}${item.location ? ` · ${escapeHtml(item.location)}` : ""}</option>`).join("")}</optgroup>`;
  }).join("");
}

function renderMicroscopeFilterOptions(microscopes) {
  const categories = [
    ["tem", "透射电子显微镜"],
    ["fib_sem", "双束电子显微镜"],
    ["sem", "扫描电子显微镜"],
    ["xray", "X 射线断层扫描"],
    ["preparation", "制样设备"]
  ];
  return categories.map(([category, label]) => {
    const items = microscopes.filter((item) => (item.equipment_category || "preparation") === category);
    if (!items.length) return "";
    return `<optgroup label="${label}">${items.map((item) => `
      <option value="${item.id}" ${item.id === state.selectedMicroscopeId ? "selected" : ""}>${escapeHtml(item.name)}${item.location ? ` · ${escapeHtml(item.location)}` : ""}</option>
    `).join("")}</optgroup>`;
  }).join("");
}

function renderTimeCalendar(weekDays, bookings, zoom = state.scheduleCalendarZoom, calendarKey = "schedule") {
  const minZoom = 0.6;
  const maxZoom = 1.6;
  const hourLabels = Array.from({ length: 24 }, (_, hour) => `
    <div class="calendar-hour" style="top:${hour * 60 * zoom}px;height:${60 * zoom}px">${String(hour).padStart(2, "0")}:00–${String(hour + 1).padStart(2, "0")}:00</div>
  `).join("");

  return `
    <div class="calendar-zoom-controls" aria-label="周视图缩放">
      <span>周视图大小</span>
      <button type="button" data-calendar-zoom="${calendarKey}" data-zoom-change="-0.1" ${zoom <= minZoom ? "disabled" : ""}>缩小</button>
      <button type="button" class="secondary" data-calendar-zoom="${calendarKey}" data-zoom-reset>标准</button>
      <span class="calendar-zoom-value">${Math.round(zoom * 100)}%</span>
      <button type="button" data-calendar-zoom="${calendarKey}" data-zoom-change="0.1" ${zoom >= maxZoom ? "disabled" : ""}>放大</button>
    </div>
    <div class="time-calendar-scroll">
      <div class="time-calendar" style="--calendar-hour-height:${60 * zoom}px;--calendar-half-hour-height:${30 * zoom}px;--calendar-height:${1440 * zoom}px">
        <div class="time-calendar-header">
          <div class="calendar-time-heading">时间</div>
          ${weekDays.map((day) => {
            const dateValue = toDateInputValue(day);
            return `<button type="button" class="calendar-day-heading ${dateValue === state.selectedDate ? "selected" : ""}" data-week-date="${dateValue}">
              <strong>${formatWeekday(day)}</strong><span>${formatMonthDay(day)}</span>
            </button>`;
          }).join("")}
        </div>
        <div class="time-calendar-body" style="min-height:${1440 * zoom}px">
          <div class="calendar-time-axis">${hourLabels}</div>
          ${weekDays.map((day) => renderCalendarDay(day, bookings, zoom)).join("")}
        </div>
      </div>
    </div>
  `;
}

function renderCalendarDay(day, bookings, zoom = 1) {
  const dateValue = toDateInputValue(day);
  const dayBookings = bookings
    .filter((booking) => sameDate(new Date(booking.start_at), day))
    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
  const positionedBookings = positionCalendarBookings(dayBookings);

  return `
    <div class="calendar-day-column ${dateValue === state.selectedDate ? "selected" : ""} ${dateValue === toDateInputValue(new Date()) ? "today" : ""}" data-week-date="${dateValue}">
      ${positionedBookings.map((booking) => renderCalendarBooking({ ...booking, zoom })).join("")}
    </div>
  `;
}

function positionCalendarBookings(bookings) {
  const laneEnds = [];
  const positioned = bookings.map((booking) => {
    const start = new Date(booking.start_at);
    const end = new Date(booking.end_at);
    const startMinutes = Math.max(0, Math.min(1439, start.getHours() * 60 + start.getMinutes()));
    const endMinutes = Math.max(startMinutes + 30, Math.min(1440, end.getHours() * 60 + end.getMinutes()));
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= startMinutes);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = endMinutes;
    return { booking, startMinutes, endMinutes, lane };
  });
  const laneCount = Math.max(1, laneEnds.length);
  return positioned.map((item) => ({ ...item, laneCount }));
}

function renderCalendarBooking({ booking, startMinutes, endMinutes, lane, laneCount, zoom = 1 }) {
  const height = Math.max(30 * zoom, (endMinutes - startMinutes) * zoom);
  const label = `${formatTime(booking.start_at)}–${formatTime(booking.end_at)} ${booking.microscopes?.name ?? ""} ${statusText(booking.status)}`;
  return `
    <article class="calendar-booking status-${booking.status}${Number(booking.acceleration_voltage || 300) !== 300 ? " voltage-non300" : ""}" title="${escapeAttr(label)}"
      style="top:${startMinutes * zoom}px;height:${height}px;left:calc(${lane} * (100% / ${laneCount}) + 3px);width:calc(100% / ${laneCount} - 6px)">
      <strong>${formatTime(booking.start_at)}–${formatTime(booking.end_at)}</strong>
      <span>${escapeHtml(booking.microscopes?.name ?? "未指定设备")}</span>
      <em>${statusText(booking.status)}${Number(booking.acceleration_voltage || 300) !== 300 ? ` · ${booking.acceleration_voltage} kV` : ""}</em>
    </article>
  `;
}

function renderAdmin() {
  const pending = state.bookings.filter((item) => item.status === "pending");
  return `
    <section class="admin-grid">
      <section class="panel wide">
        <div class="section-head">
          <h2>预约审批</h2>
          <span>${pending.length} 条待处理</span>
        </div>
        ${renderBookingList(state.bookings, { adminActions: true, ownActions: false })}
      </section>

      <section class="panel wide">
        <div class="section-head">
          <h2>设备管理</h2>
          <span>${state.microscopes.length} 台设备</span>
        </div>
        ${renderMicroscopeManager()}
      </section>

      <section class="panel wide holiday-panel">
        <div class="section-head">
          <h2>法定节假日计费</h2>
          <span>${state.holidays.length} 天</span>
        </div>
        <p class="panel-note">校内自主测试在节假日按周末计算：白天 5 折、18:00–08:00 为 2.5 折。送样和校外测试不使用此折扣。</p>
        ${renderHolidayManager()}
      </section>
    </section>
  `;
}

function renderHolidayManager() {
  return `
    <form id="holiday-form" class="holiday-form">
      <label>开始日期<input name="start_date" type="date" required></label>
      <label>结束日期<input name="end_date" type="date" required></label>
      <label>名称（可选）<input name="name" maxlength="100" placeholder="例如：国庆节"></label>
      <button class="primary" type="submit">添加节假日</button>
    </form>
    <div class="holiday-list">
      ${state.holidays.length ? state.holidays.map((holiday) => `
        <div class="holiday-item">
          <strong>${escapeHtml(holiday.holiday_date)}</strong>
          <span>${escapeHtml(holiday.name || "法定节假日")}</span>
          <button type="button" class="danger ghost-danger" data-delete-holiday="${escapeAttr(holiday.holiday_date)}">删除</button>
        </div>
      `).join("") : `<div class="empty compact-empty">尚未设置节假日。</div>`}
    </div>
  `;
}

function renderUserAdmin() {
  const adminCount = state.userProfiles.filter((user) => user.role === "admin").length;
  const superAdminCount = state.userProfiles.filter((user) => user.role === "super_admin").length;
  const groups = [
    ["super-admin", "超级管理员", state.userProfiles.filter((user) => user.role === "super_admin")],
    ["admin", "管理员", state.userProfiles.filter((user) => user.role === "admin")],
    ["bookable", "可预约用户", state.userProfiles.filter((user) => user.role === "user" && user.booking_permission === "approved")],
    ["viewer", "只可查看用户", state.userProfiles.filter((user) => user.role === "user" && user.booking_permission !== "approved")]
  ];

  return `
    <section class="panel wide">
      <div class="section-head">
        <h2>用户管理</h2>
        <span>${state.userProfiles.length} 人已注册 · ${adminCount} 名管理员 · ${superAdminCount} 名超级管理员</span>
      </div>
      <div class="user-table">
        ${groups.map(([groupClass, title, users]) => renderUserGroup(groupClass, title, users)).join("")}
      </div>
    </section>
  `;
}

function renderUserGroup(groupClass, title, users) {
  return `
    <section class="user-group user-group-${groupClass}">
      <div class="user-group-head">
        <h3>${title}</h3>
        <span>${users.length} 人</span>
      </div>
      <div class="user-group-list">
        ${users.length ? users.map((user) => `
          <article class="user-row">
            <div>
              <strong>${escapeHtml(user.full_name || user.email || "未填写姓名")}</strong>
              <p>${escapeHtml(user.email || "")} · ${userTypeText(user.user_type)} · ${escapeHtml(user.organization || user.lab || "未填写单位")}</p>
              <div class="user-booking-summary">
                <span>预约 ${Number(user.booking_summary?.count || 0)} 次</span>
                <span>已通过 ${Number(user.booking_summary?.approvedCount || 0)} 次</span>
                <strong>已通过预估：${formatCurrency(user.booking_summary?.approvedFee || 0)}</strong>
                ${Number(user.booking_summary?.pendingCount || 0) ? `<span class="pending-fee">待审批预估：${formatCurrency(user.booking_summary?.pendingFee || 0)}</span>` : ""}
              </div>
            </div>
            <div class="row-actions user-actions">
              <span class="role-pill role-${user.role}">${roleText(user.role)}</span>
              <span class="role-pill">${bookingPermissionText(user.booking_permission)}</span>
              <button class="secondary" type="button" data-user-bookings="${user.id}">${state.selectedUserBookingsId === user.id ? "收起记录" : "查看预约记录"}</button>
              ${renderBookingPermissionAction(user)}
              ${renderUserRoleAction(user)}
            </div>
            ${state.selectedUserBookingsId === user.id ? renderUserBookingHistory(user) : ""}
          </article>
        `).join("") : `<div class="empty compact-empty">暂无${title}。</div>`}
      </div>
    </section>
  `;
}

function renderUserBookingHistory(user) {
  const bookings = state.selectedUserBookings;
  return `
    <section class="user-booking-history">
      <div class="section-head compact-head">
        <h3>${escapeHtml(user.full_name || user.email)} 的预约记录</h3>
        <span>${bookings.length} 条</span>
      </div>
      ${bookings.length ? `<div class="user-booking-history-list">
        ${bookings.map((booking) => `
          <div class="user-booking-history-item">
            <div><strong>${escapeHtml(booking.microscopes?.name || booking.title || "设备预约")}</strong><small>${formatDateTime(booking.start_at)} ～ ${formatDateTime(booking.end_at)} · ${serviceModeText(booking.service_mode)}${Number(booking.acceleration_voltage || 300) !== 300 ? ` · ${Number(booking.acceleration_voltage)} kV` : ""}</small></div>
            <div><span class="status-pill status-${booking.status}">${statusText(booking.status)}</span><strong class="history-fee">${formatCurrency(booking.estimated_fee || 0)}</strong></div>
          </div>
        `).join("")}
      </div>` : `<div class="empty compact-empty">该用户暂时没有预约记录。</div>`}
    </section>
  `;
}

function renderUserRoleAction(user) {
  if (user.id === state.user.id || user.role === "super_admin") {
    return "";
  }

  if (user.role === "admin") {
    return `<button class="danger ghost-danger" type="button" data-user-role="${user.id}" data-role="user">移除管理员</button>`;
  }

  return `<button class="secondary" type="button" data-user-role="${user.id}" data-role="admin">设为管理员</button>`;
}

function renderBookingPermissionAction(user) {
  if (user.id === state.user.id || user.role === "super_admin" || user.booking_permission !== "pending") return "";
  return `
    <button class="primary" type="button" data-booking-permission="${user.id}" data-permission="approved">批准预约</button>
    <button class="danger ghost-danger" type="button" data-booking-permission="${user.id}" data-permission="rejected">拒绝</button>
  `;
}

function renderMicroscopeManager() {
  if (state.selectedMicroscopeForEdit) {
    return renderMicroscopeDetail(state.selectedMicroscopeForEdit);
  }

  return `
    <div class="device-grid-header">
      <button class="secondary" type="button" data-new-microscope>+ 新增设备</button>
    </div>
    ${renderMicroscopeCardsGrouped()}
  `;
}

function renderMicroscopeCardsGrouped() {
  const categories = [["tem", "透射电子显微镜"], ["fib_sem", "双束电子显微镜"], ["sem", "扫描电子显微镜"], ["xray", "X 射线断层扫描"], ["preparation", "制样设备"]];
  return categories.map(([category, label]) => {
    const devices = state.microscopes.filter((item) => (item.equipment_category || "preparation") === category);
    if (!devices.length) return "";
    return `<section class="device-category"><h3>${label}</h3><div class="device-grid">${devices.map((microscope) => `
      <article class="device-card status-${microscope.status}" data-edit-microscope="${microscope.id}">
        <div class="device-card-head">
          <h3>${escapeHtml(microscope.name)}</h3>
          <span class="device-status status-${microscope.status}">${deviceStatusText(microscope.status)}</span>
        </div>
        <div class="device-card-meta">
          ${microscope.model ? `<p>型号：${escapeHtml(microscope.model)}</p>` : ""}
          ${microscope.pricing_note ? `<p>收费：${escapeHtml(microscope.pricing_note)}</p>` : ""}
          ${microscope.location ? `<p>位置：${escapeHtml(microscope.location)}</p>` : ""}
        </div>
      </article>
    `).join("")}</div></section>`;
  }).join("");
}

function renderMicroscopeDetail(microscope) {
  const isNewMicroscope = microscope._new === true;
  const formAttribute = isNewMicroscope ? "data-microscope-create" : `data-microscope-form="${microscope.id}"`;

  return `
    <div class="device-detail">
      <div class="device-detail-head">
        <button class="secondary" type="button" data-back-microscope>← 返回设备列表</button>
        <h3>${isNewMicroscope ? "新增设备" : escapeHtml(microscope.name)}</h3>
      </div>
      <form class="device-form" ${formAttribute}>
        <div class="device-fields">
          ${renderMicroscopeFields(microscope)}
        </div>
        <div class="row-actions">
          <button class="primary" type="submit">${isNewMicroscope ? "新增设备" : "保存设备"}</button>
          ${isNewMicroscope ? "" : `<button class="danger" type="button" data-delete-microscope="${microscope.id}">删除设备</button>`}
          <button class="danger ghost-danger" type="button" data-close-microscope>取消</button>
        </div>
      </form>
    </div>
  `;
}

function renderMicroscopeFields(microscope = {}) {
  const currentStatus = microscope.status ?? "available";
  return `
    <label>
      设备名称
      <input name="name" value="${escapeAttr(microscope.name)}" placeholder="如：TEM-01 透射电子显微镜" required>
    </label>
    <label>
      型号
      <input name="model" value="${escapeAttr(microscope.model)}" placeholder="如：Thermo Fisher Talos F200X">
    </label>
    <label>
      位置
      <input name="location" value="${escapeAttr(microscope.location)}" placeholder="如：材料中心 A201">
    </label>
    <label>
      状态
      <select name="status">
        ${["available", "maintenance", "offline"].map((status) => `
          <option value="${status}" ${currentStatus === status ? "selected" : ""}>${deviceStatusText(status)}</option>
        `).join("")}
      </select>
    </label>
    <label>
      设备类别
      <select name="equipment_category">
        ${[["tem", "透射电子显微镜"], ["fib_sem", "双束电子显微镜"], ["sem", "扫描电子显微镜"], ["xray", "X 射线断层扫描"], ["preparation", "制样设备"]].map(([value, label]) => `<option value="${value}" ${(microscope.equipment_category || "preparation") === value ? "selected" : ""}>${label}</option>`).join("")}
      </select>
    </label>
    <label>
      计费单位
      <select name="billing_unit">
        <option value="hour" ${(microscope.billing_unit || "hour") === "hour" ? "selected" : ""}>按小时</option>
        <option value="sample" ${microscope.billing_unit === "sample" ? "selected" : ""}>按样品</option>
      </select>
    </label>
    <label>
      校内送样费率
      <input name="internal_delivery_rate" type="number" min="0" step="0.01" value="${escapeAttr(microscope.internal_delivery_rate ?? microscope.hourly_rate ?? 0)}">
    </label>
    <label>
      校内自主费率
      <input name="internal_self_rate" type="number" min="0" step="0.01" value="${escapeAttr(microscope.internal_self_rate ?? microscope.hourly_rate ?? 0)}">
    </label>
    <label>
      校外费率
      <input name="external_rate" type="number" min="0" step="0.01" value="${escapeAttr(microscope.external_rate ?? microscope.hourly_rate ?? 0)}">
    </label>
    <label>
      兼容费率/小时
      <input name="hourly_rate" type="number" min="0" step="0.01" value="${escapeAttr(microscope.hourly_rate ?? 0)}">
    </label>
    <label class="field-wide">
      收费说明
      <input name="pricing_note" value="${escapeAttr(microscope.pricing_note ?? "")}" placeholder="例如：元/小时；或子项目说明">
    </label>
    <input name="pricing_options" type="hidden" value="${escapeAttr(JSON.stringify(readPricingOptions(microscope)))}">
    <label class="field-wide">
      备注
      <textarea name="notes" rows="3" placeholder="使用范围、限制条件、管理员提醒">${escapeHtml(microscope.notes)}</textarea>
    </label>
  `;
}

function renderBookingList(bookings, options) {
  if (!bookings.length) {
    return `<div class="empty">暂无预约</div>`;
  }

  return `
    <div class="booking-list">
      ${bookings.map((booking) => `
        ${(() => {
          const inlineOwnAction = options.ownActions && ["pending", "approved"].includes(booking.status)
            ? `<button class="danger ghost-danger compact-cancel" type="button" data-cancel="${booking.id}">取消预约</button>`
            : "";
          const organization = booking.profiles?.organization || booking.profiles?.lab || "未填写单位";
          return `
        <article class="booking-item status-${booking.status}">
          <div class="booking-time">
            <strong>${formatWeekday(booking.start_at)} ${formatMonthDay(booking.start_at)}</strong>
            <span>${formatTime(booking.start_at)} ~ ${formatTime(booking.end_at)}</span>
          </div>
          <div class="booking-main">
            <div class="booking-title">
              <h3>${escapeHtml(booking.title)}</h3>
              <div class="booking-title-actions">
                <span class="status-pill status-${booking.status}">${statusText(booking.status)}</span>
                ${inlineOwnAction}
              </div>
            </div>
            <div class="booking-info-stack">
              <div class="booking-info-row person-row">
                <span class="booking-info-chip person">姓名：${escapeHtml(booking.profiles?.full_name || "未填写姓名")}</span>
                <span class="booking-info-chip organization">单位：${escapeHtml(organization)}</span>
              </div>
              <div class="booking-info-row test-row">
                <span class="booking-info-chip service">测试方式：${serviceModeText(booking.service_mode)}${Number(booking.acceleration_voltage || 300) !== 300 ? ` · ${Number(booking.acceleration_voltage)} kV` : ""}</span>
                ${booking.purpose ? `<span class="booking-info-chip purpose">样品与实验目的：${escapeHtml(booking.purpose)}</span>` : ""}
              </div>
              ${Number(booking.estimated_fee) > 0 ? `<div class="booking-info-row fee-row"><span class="booking-info-chip fee">预计费用：${formatCurrency(booking.estimated_fee)}${booking.accessory_id ? "（含原位样品杆）" : ""}</span></div>` : ""}
              ${booking.analysis_request_file_name || booking.operator_notes ? `<div class="booking-info-row auxiliary-row">
                ${booking.analysis_request_file_name ? `<span class="booking-info-chip attachment">需求单：${escapeHtml(booking.analysis_request_file_name)}（已上传）${options.adminActions ? ` <button class="link-button" type="button" data-download-analysis-request="${booking.id}">下载 PDF</button>` : ""}</span>` : ""}
                ${booking.operator_notes ? `<span class="booking-info-chip notes">备注：${escapeHtml(booking.operator_notes)}</span>` : ""}
              </div>` : ""}
            </div>
            ${renderActions(booking, { ...options, ownActions: false })}
          </div>
        </article>
          `;
        })()}
      `).join("")}
    </div>
  `;
}

function renderActions(booking, options) {
  if (options.adminActions) {
    return `
      <div class="row-actions">
        ${booking.status === "pending" ? `<button class="primary" type="button" data-approve="${booking.id}">通过</button><button class="danger" type="button" data-reject="${booking.id}">拒绝</button>` : ""}
        <button class="danger ghost-danger" type="button" data-delete-booking="${booking.id}">删除记录</button>
      </div>
    `;
  }

  if (options.ownActions && ["pending", "approved"].includes(booking.status)) {
    return `
      <div class="row-actions">
        <button class="danger ghost-danger" type="button" data-cancel="${booking.id}">取消预约</button>
      </div>
    `;
  }

  return "";
}

function wireAppEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.activeTab = button.dataset.tab;
      if (state.activeTab === "users") {
        await loadUserProfiles();
      } else {
        await loadBookings();
      }
      renderApp();
    });
  });

  document.querySelector("#date-filter").addEventListener("change", async (event) => {
    state.selectedDate = event.target.value;
    await loadBookings();
    renderApp();
  });

  document.querySelector("#microscope-filter").addEventListener("change", async (event) => {
    state.selectedMicroscopeId = event.target.value;
    await loadBookings();
    renderApp();
  });

  const profileForm = document.querySelector("#profile-form");
  if (profileForm) profileForm.addEventListener("submit", handleProfileSave);
  document.querySelector("#sign-out").addEventListener("click", async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch (error) { console.warn(error); }
    localStorage.removeItem(tokenStorageKey);
    state.user = null;
    state.profile = null;
    state.bookings = [];
    state.authMode = "signin";
    renderAuth();
  });

  const bookingForm = document.querySelector("#booking-form");
  if (bookingForm) {
    bookingForm.addEventListener("submit", handleBookingCreate);
    bookingForm.querySelectorAll("select, input").forEach((field) => {
      field.addEventListener("change", () => updateBookingPricingForm(bookingForm));
      field.addEventListener("input", () => updateBookingPricingForm(bookingForm));
    });
    updateBookingPricingForm(bookingForm);
  }

  const permissionRequest = document.querySelector("[data-request-booking-permission]");
  if (permissionRequest) permissionRequest.addEventListener("click", requestBookingPermission);

  document.querySelectorAll("[data-approve]").forEach((button) => {
    button.addEventListener("click", () => updateBookingStatus(button.dataset.approve, "approved"));
  });

  document.querySelectorAll("[data-reject]").forEach((button) => {
    button.addEventListener("click", () => updateBookingStatus(button.dataset.reject, "rejected"));
  });

  document.querySelectorAll("[data-cancel]").forEach((button) => {
    button.addEventListener("click", () => updateBookingStatus(button.dataset.cancel, "cancelled"));
  });

  document.querySelectorAll("[data-delete-booking]").forEach((button) => {
    button.addEventListener("click", () => deleteBooking(button.dataset.deleteBooking));
  });

  document.querySelectorAll("[data-download-analysis-request]").forEach((button) => {
    button.addEventListener("click", () => downloadAnalysisRequest(button.dataset.downloadAnalysisRequest));
  });

  document.querySelectorAll("[data-user-role]").forEach((button) => {
    button.addEventListener("click", () => updateUserRole(button.dataset.userRole, button.dataset.role));
  });

  document.querySelectorAll("[data-booking-permission]").forEach((button) => {
    button.addEventListener("click", () => updateBookingPermission(button.dataset.bookingPermission, button.dataset.permission));
  });

  document.querySelectorAll("[data-user-bookings]").forEach((button) => {
    button.addEventListener("click", () => toggleUserBookings(button.dataset.userBookings));
  });

  const holidayForm = document.querySelector("#holiday-form");
  if (holidayForm) holidayForm.addEventListener("submit", handleHolidayCreate);
  document.querySelectorAll("[data-delete-holiday]").forEach((button) => {
    button.addEventListener("click", () => deleteHoliday(button.dataset.deleteHoliday));
  });

  document.querySelectorAll("[data-week-date]").forEach((day) => {
    day.addEventListener("click", async () => {
      state.selectedDate = day.dataset.weekDate;
      await loadBookings();
      renderApp();
    });
  });

  document.querySelectorAll("[data-week-shift]").forEach((button) => {
    button.addEventListener("click", async () => {
      const nextDate = addDays(new Date(`${state.selectedDate}T00:00:00`), Number(button.dataset.weekShift));
      state.selectedDate = toDateInputValue(nextDate);
      await loadBookings();
      renderApp();
    });
  });

  document.querySelectorAll("[data-calendar-zoom]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.calendarZoom;
      const currentZoom = key === "mine" ? state.mineCalendarZoom : state.scheduleCalendarZoom;
      const zoom = button.hasAttribute("data-zoom-reset")
        ? 1
        : Math.max(0.6, Math.min(1.6, Math.round((currentZoom + Number(button.dataset.zoomChange || 0)) * 10) / 10));
      if (key === "mine") state.mineCalendarZoom = zoom;
      else state.scheduleCalendarZoom = zoom;
      renderApp();
    });
  });

  const todayButton = document.querySelector("[data-week-today]");
  if (todayButton) {
    todayButton.addEventListener("click", async () => {
      state.selectedDate = toDateInputValue(new Date());
      await loadBookings();
      renderApp();
    });
  }

  // 设备管理：新增设备
  document.querySelectorAll("[data-new-microscope]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedMicroscopeForEdit = { _new: true, name: "", model: "", location: "", status: "available", equipment_category: "preparation", billing_unit: "hour", hourly_rate: 0, internal_delivery_rate: 0, internal_self_rate: 0, external_rate: 0, pricing_options: [], notes: "" };
      renderApp();
    });
  });

  // 设备管理：点击卡片进入详情
  document.querySelectorAll("[data-edit-microscope]").forEach((card) => {
    card.addEventListener("click", () => {
      const id = card.dataset.editMicroscope;
      state.selectedMicroscopeForEdit = state.microscopes.find((item) => item.id === id) ?? null;
      renderApp();
    });
  });

  // 设备管理：返回列表
  document.querySelectorAll("[data-back-microscope], [data-close-microscope]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedMicroscopeForEdit = null;
      renderApp();
    });
  });

  document.querySelectorAll("[data-microscope-form]").forEach((form) => {
    form.addEventListener("submit", handleMicroscopeUpdate);
  });

  document.querySelectorAll("[data-microscope-create]").forEach((form) => {
    form.addEventListener("submit", handleMicroscopeCreate);
  });

  document.querySelectorAll("[data-delete-microscope]").forEach((button) => {
    button.addEventListener("click", () => handleMicroscopeDelete(button.dataset.deleteMicroscope));
  });
}

async function handleSignIn(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const button = formElement.querySelector("[data-auth-mode='signin']");
  setButtonBusy(button, "正在登录...");
  toast("正在登录，请稍候。", "info");
  const form = new FormData(event.currentTarget);
  setButtonBusy(button);
  try {
    const { user, token } = await api("/auth/login", { method: "POST", body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
    localStorage.setItem(tokenStorageKey, token);
    state.user = user;
    await loadAppData();
    toast("登录成功，正在进入预约系统。");
  } catch (error) { toast(friendlyError(error), "error"); }
}

async function handleSignUp(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const button = formElement.querySelector("[data-auth-mode='signup']");
  setButtonBusy(button, "正在注册...");
  const form = new FormData(formElement);
  setButtonBusy(button);
  const fullName = String(form.get("full_name") ?? "").trim();
  if (!fullName) return toast("注册时需要填写姓名。", "error");
  try {
    const organization = String(form.get("organization") ?? "").trim();
    const userType = String(form.get("user_type") ?? "");
    if (!organization || !["internal", "external"].includes(userType)) return toast("请选择用户类别并填写单位或学院。", "error");
    const { user, token } = await api("/auth/register", { method: "POST", body: JSON.stringify({ fullName, userType, organization, email: form.get("email"), password: form.get("password") }) });
    localStorage.setItem(tokenStorageKey, token);
    state.user = user;
    await loadAppData();
    toast("注册成功，已登录。", "success");
  } catch (error) { toast(friendlyError(error), "error"); }
}

async function handleProfileSave(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type='submit']");
  setButtonBusy(button, "保存中...");
  const form = new FormData(event.currentTarget);
  try {
    const { user } = await api("/profile", { method: "PATCH", body: JSON.stringify({ fullName: form.get("full_name"), lab: form.get("lab"), phone: form.get("phone") }) });
    state.user = user;
    state.profile = profileFromUser(user);
    renderApp();
    toast("个人信息已保存，后续预约会使用这份资料。");
  } catch (error) { setButtonBusy(button); toast(friendlyError(error), "error"); }
}

function readPricingOptions(microscope) {
  if (Array.isArray(microscope?.pricing_options)) return microscope.pricing_options;
  if (typeof microscope?.pricing_options === "string") {
    try { return JSON.parse(microscope.pricing_options); } catch (_error) { return []; }
  }
  return [];
}

function supportsAccelerationVoltage(microscope) {
  return [
    "Spectra Ultra 双球差校正透射电子显微镜",
    "Spectra 300 双球差校正透射电子显微镜"
  ].includes(String(microscope?.name || ""));
}

function priceRate(item, serviceMode = "self") {
  if (state.profile?.user_type === "external" || serviceMode === "external") return Number(item?.external_rate ?? item?.externalRate) || 0;
  if (serviceMode === "delivery") return Number(item?.internal_delivery_rate ?? item?.internalDeliveryRate) || 0;
  return Number(item?.internal_self_rate ?? item?.internalSelfRate) || 0;
}

function localTimeMultiplier(date) {
  const day = date.getDay();
  const night = date.getHours() < 8 || date.getHours() >= 18;
  const dateKey = toDateInputValue(date);
  const isHoliday = state.holidays.some((item) => item.holiday_date === dateKey);
  if (day === 0 || day === 6 || isHoliday) return night ? 0.25 : 0.5;
  return night ? 0.5 : 1;
}

function timedEstimate(startAt, endAt, rate, applySelfServiceDiscount = true) {
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) return 0;
  let total = 0;
  for (let cursor = new Date(startAt); cursor < endAt; cursor = new Date(cursor.getTime() + 30 * 60 * 1000)) {
    total += rate * 0.5 * (applySelfServiceDiscount ? localTimeMultiplier(cursor) : 1);
  }
  return Math.round((total + Number.EPSILON) * 100) / 100;
}

function updateBookingPricingForm(formElement) {
  const form = new FormData(formElement);
  const microscope = state.microscopes.find((item) => item.id === form.get("microscope_id"));
  const optionField = formElement.querySelector("#pricing-option-field");
  const optionSelect = formElement.querySelector("[name='pricing_option_id']");
  const voltageField = formElement.querySelector("#acceleration-voltage-field");
  const voltageSelect = formElement.querySelector("[name='acceleration_voltage']");
  const serviceModeField = formElement.querySelector("#service-mode-field");
  const serviceModeSelect = formElement.querySelector("[name='service_mode']");
  const analysisRequestField = formElement.querySelector("#analysis-request-field");
  const analysisRequestInput = formElement.querySelector("[name='analysis_request_file']");
  const accessoryField = formElement.querySelector("#accessory-field");
  const sampleCountField = formElement.querySelector("#sample-count-field");
  const sampleCountInput = formElement.querySelector("[name='sample_count']");
  const preview = formElement.querySelector("#fee-preview");
  if (!microscope || !optionSelect || !preview) return;

  const options = readPricingOptions(microscope);
  const previousOption = optionSelect.value;
  optionSelect.innerHTML = options.map((item) => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.name)}</option>`).join("");
  if (options.some((item) => item.id === previousOption)) optionSelect.value = previousOption;
  optionField.hidden = options.length === 0;
  optionSelect.required = options.length > 0;
  const supportsVoltage = supportsAccelerationVoltage(microscope);
  voltageField.hidden = !supportsVoltage;
  voltageSelect.required = supportsVoltage;
  if (!supportsVoltage) voltageSelect.value = "300";

  const selectedOption = options.find((item) => item.id === optionSelect.value) || null;
  const priceSource = selectedOption || microscope;
  const billingUnit = selectedOption?.billingUnit || microscope.billing_unit || "hour";
  const serviceMode = state.profile?.user_type === "external" ? "external" : serviceModeSelect.value;
  serviceModeField.hidden = state.profile?.user_type === "external";
  const isDelivery = serviceMode === "delivery";
  analysisRequestField.hidden = !isDelivery;
  analysisRequestInput.required = isDelivery;
  const isTem = microscope.equipment_category === "tem";
  accessoryField.hidden = !isTem;
  const accessorySelect = formElement.querySelector("[name='accessory_id']");
  if (!isTem) accessorySelect.value = "";
  const isPreparation = microscope.equipment_category === "preparation";
  sampleCountField.hidden = !isPreparation;
  sampleCountInput.required = isPreparation;
  if (!isPreparation) sampleCountInput.value = "1";

  const startAt = parseFormDateTime(form.get("start_date"), form.get("start_time"));
  const endAt = parseFormDateTime(form.get("end_date"), form.get("end_time"));
  const sampleCount = isPreparation ? Math.max(1, Math.floor(Number(form.get("sample_count")) || 1)) : 1;
  const mainRate = priceRate(priceSource, serviceMode);
  const mainFee = billingUnit === "sample" ? mainRate * sampleCount : timedEstimate(startAt, endAt, mainRate, serviceMode === "self");
  const accessory = state.accessories.find((item) => item.id === accessorySelect.value);
  const accessoryRate = accessory ? priceRate(accessory, serviceMode) : 0;
  const accessoryFee = accessory ? timedEstimate(startAt, endAt, accessoryRate, serviceMode === "self") : 0;
  const total = Math.round((mainFee + accessoryFee + Number.EPSILON) * 100) / 100;
  const unitText = billingUnit === "sample" ? "元/样品" : "元/小时";
  const modeText = serviceMode === "delivery" ? "校内送样测试" : serviceMode === "external" ? "校外测试" : "校内自主测试";
  const discountHint = billingUnit === "sample" ? "按单个样品计算" : serviceMode === "self" ? "已按工作日、晚间及周末时段的自主测试折扣预估" : "送样或校外测试按标准时长预估";
  preview.innerHTML = `
    <strong>预计费用：${formatCurrency(total)}</strong>
    <span>${modeText} · 主设备：${formatCurrency(mainFee)}（${formatCurrency(mainRate)} ${unitText}${billingUnit === "sample" ? ` × ${sampleCount} 个样品` : ""}）</span>
    ${accessory ? `<span>原位样品杆：${formatCurrency(accessoryFee)}（${escapeHtml(accessory.name)}，${formatCurrency(accessoryRate)} 元/小时）</span>` : ""}
    <small>${discountHint}；实际结算以中心审核为准。</small>
  `;
}

async function readAnalysisRequestFile(file) {
  if (!(file instanceof File)) return null;
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("分析测试需求单必须是 PDF 文件。");
  }
  if (file.size > 4 * 1024 * 1024) throw new Error("分析测试需求单不能超过 4 MB。");
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("读取分析测试需求单失败。"));
    reader.readAsDataURL(file);
  });
  return { name: file.name, dataUrl };
}

async function handleBookingCreate(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const button = formElement.querySelector("button[type='submit']");
  setButtonBusy(button, "提交中...");
  const form = new FormData(event.currentTarget);
  const startAt = parseFormDateTime(form.get("start_date"), form.get("start_time"));
  const endAt = parseFormDateTime(form.get("end_date"), form.get("end_time"));
  const microscope = state.microscopes.find((item) => item.id === form.get("microscope_id"));
  const fullName = String(form.get("full_name") ?? "").trim();
  const purpose = String(form.get("purpose") ?? "").trim();
  const serviceMode = state.profile?.user_type === "external" ? "external" : String(form.get("service_mode") ?? "self");

  if (!fullName) {
    setButtonBusy(button);
    toast("请填写预约人姓名。", "error");
    return;
  }

  if (!isHalfHourSlot(startAt) || !isHalfHourSlot(endAt)) {
    setButtonBusy(button);
    toast("预约时间只能选择整点或半点，例如 09:00 或 09:30。", "error");
    return;
  }

  if (endAt <= startAt) {
    setButtonBusy(button);
    toast("结束时间必须晚于开始时间。", "error");
    return;
  }

  if (!microscope || microscope.status !== "available") {
    setButtonBusy(button);
    toast("请选择一台当前可预约的设备。", "error");
    return;
  }

  try {
    const analysisRequestFile = serviceMode === "delivery" ? await readAnalysisRequestFile(form.get("analysis_request_file")) : null;
    if (serviceMode === "delivery" && !analysisRequestFile) {
      setButtonBusy(button);
      toast("送样测试必须上传 PDF 分析测试需求单。", "error");
      return;
    }
    await api("/profile", { method: "PATCH", body: JSON.stringify({ fullName, lab: state.profile?.lab ?? "", phone: state.profile?.phone ?? "" }) });
    await api("/bookings", { method: "POST", body: JSON.stringify({ microscopeId: form.get("microscope_id"), pricingOptionId: form.get("pricing_option_id"), accessoryId: form.get("accessory_id"), sampleCount: Number(form.get("sample_count") || 1), accelerationVoltage: Number(form.get("acceleration_voltage") || 300), serviceMode, analysisRequestFile, purpose, startAt: startAt.toISOString(), endAt: endAt.toISOString() }) });
    // `event.currentTarget` is cleared by the browser after an async await.
    // Keep using the captured form element so a successful booking does not
    // incorrectly show a reset-related error.
    formElement.reset();
    await loadProfile();
    await loadBookings();
    renderApp();
    toast(`预约已提交：${microscope?.name ?? "所选设备"}，${formatDateTime(startAt)} 至 ${formatDateTime(endAt)}，等待管理员审批。`);
  } catch (error) { setButtonBusy(button); toast(friendlyError(error), "error"); }
}

async function updateBookingStatus(id, status) {
  const actionText = {
    approved: "通过",
    rejected: "拒绝",
    cancelled: "取消"
  }[status] ?? "更新";

  if (status === "cancelled" && !window.confirm("确定要取消这条预约吗？")) return;

  const operatorNotes = status === "rejected" ? window.prompt("拒绝原因", "") ?? "" : "";
  toast(`正在${actionText}预约...`, "info");
  try {
    await api(`/bookings/${id}/status`, { method: "PATCH", body: JSON.stringify({ status, operatorNotes }) });
    await loadBookings();
    renderApp();
    toast(`预约已${actionText}。`);
  } catch (error) { toast(friendlyError(error), "error"); }
}

async function deleteBooking(id) {
  if (!isAdminRole()) return;
  if (!window.confirm("确定要永久删除这条预约记录吗？删除后无法恢复。")) return;
  try {
    await api(`/admin/bookings/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadBookings();
    if (isSuperAdmin()) await loadUserProfiles();
    renderApp();
    toast("预约记录已删除。");
  } catch (error) {
    toast(friendlyError(error), "error");
  }
}

async function downloadAnalysisRequest(bookingId) {
  try {
    const token = localStorage.getItem(tokenStorageKey);
    const response = await fetch(`${apiBase}/admin/bookings/${encodeURIComponent(bookingId)}/analysis-request-file`, {
      credentials: "include",
      headers: token ? { "X-EM-Session": token } : {}
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error || `附件下载失败（${response.status}）`);
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error("附件内容为空。");
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = "analysis-request.pdf";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (error) {
    toast(friendlyError(error), "error");
  }
}

async function updateUserRole(id, role) {
  if (!isSuperAdmin()) return;

  const actionText = role === "admin" ? "设为管理员" : "移除管理员";
  if (!window.confirm(`确定要${actionText}吗？`)) return;

  toast(`正在${actionText}...`, "info");
  try {
    await api(`/admin/users/${id}/role`, { method: "PATCH", body: JSON.stringify({ role }) });
    await loadUserProfiles();
    renderApp();
    toast(`已${actionText}。`);
  } catch (error) { toast(friendlyError(error), "error"); }
}

async function toggleUserBookings(id) {
  if (!isSuperAdmin()) return;
  if (state.selectedUserBookingsId === id) {
    state.selectedUserBookingsId = null;
    state.selectedUserBookings = [];
    renderApp();
    return;
  }

  try {
    const { bookings } = await api(`/admin/users/${encodeURIComponent(id)}/bookings`);
    state.selectedUserBookingsId = id;
    state.selectedUserBookings = bookings || [];
    renderApp();
  } catch (error) {
    toast(friendlyError(error), "error");
  }
}

async function handleHolidayCreate(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  setButtonBusy(button, "添加中...");
  try {
    await api("/holidays", { method: "POST", body: JSON.stringify({ startDate: form.elements.start_date.value, endDate: form.elements.end_date.value, name: form.elements.name.value }) });
    await loadHolidays();
    renderApp();
    toast("节假日区间已添加，后续预约会按节假日规则预估费用。");
  } catch (error) {
    setButtonBusy(button);
    toast(friendlyError(error), "error");
  }
}

async function deleteHoliday(date) {
  if (!window.confirm(`确认删除 ${date} 的节假日设置吗？`)) return;
  try {
    await api(`/holidays/${encodeURIComponent(date)}`, { method: "DELETE" });
    await loadHolidays();
    renderApp();
    toast("节假日设置已删除。");
  } catch (error) {
    toast(friendlyError(error), "error");
  }
}

async function requestBookingPermission() {
  if (!window.confirm("确认提交预约权限申请吗？管理员会根据你的用户类别和单位信息审核。")) return;
  try {
    await api("/booking-permission/request", { method: "POST" });
    await loadProfile();
    renderApp();
    toast("预约权限申请已提交，请等待管理员审核。");
  } catch (error) { toast(friendlyError(error), "error"); }
}

async function updateBookingPermission(id, bookingPermission) {
  if (!isSuperAdmin()) return;
  const actionText = bookingPermission === "approved" ? "批准该用户的预约权限" : "拒绝该用户的预约权限申请";
  if (!window.confirm(`确定要${actionText}吗？`)) return;
  try {
    await api(`/admin/users/${id}/booking-permission`, { method: "PATCH", body: JSON.stringify({ bookingPermission }) });
    await loadUserProfiles();
    renderApp();
    toast(`已${bookingPermission === "approved" ? "批准" : "拒绝"}预约权限申请。`);
  } catch (error) { toast(friendlyError(error), "error"); }
}

async function handleMicroscopeCreate(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type='submit']");
  setButtonBusy(button, "新增中...");

  try {
    await api("/microscopes", { method: "POST", body: JSON.stringify(microscopePayload(event.currentTarget)) });
    await loadMicroscopes();
    state.selectedMicroscopeForEdit = null;
    renderApp();
    toast("设备已新增，用户现在可以在预约表单中选择它。");
  } catch (error) { setButtonBusy(button); toast(friendlyError(error), "error"); }
}

async function handleMicroscopeUpdate(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id = form.dataset.microscopeForm;
  const button = form.querySelector("button[type='submit']");
  setButtonBusy(button, "保存中...");

  try {
    await api(`/microscopes/${id}`, { method: "PATCH", body: JSON.stringify(microscopePayload(form)) });
    await loadMicroscopes();
    await loadBookings();
    renderApp();
    toast("设备信息已保存。");
  } catch (error) { setButtonBusy(button); toast(friendlyError(error), "error"); }
}

async function handleMicroscopeDelete(id) {
  const microscope = state.microscopes.find((item) => item.id === id);
  const name = microscope?.name ?? "该设备";

  if (!window.confirm(`确定要删除「${name}」吗？如果已有预约记录，系统会阻止删除。`)) return;

  toast("正在删除设备...", "info");
  try {
    await api(`/microscopes/${id}`, { method: "DELETE" });
    await loadMicroscopes();
    await loadBookings();
    state.selectedMicroscopeForEdit = null;
    renderApp();
    toast("设备已删除。");
  } catch (error) { toast(friendlyError(error), "error"); }
}

function microscopePayload(formElement) {
  const form = new FormData(formElement);
  return {
    name: form.get("name"),
    model: form.get("model") ?? "",
    location: form.get("location") ?? "",
    status: form.get("status") ?? "available",
    equipment_category: form.get("equipment_category") ?? "preparation",
    billing_unit: form.get("billing_unit") ?? "hour",
    hourly_rate: Number(form.get("hourly_rate") || 0),
    internal_delivery_rate: Number(form.get("internal_delivery_rate") || 0),
    internal_self_rate: Number(form.get("internal_self_rate") || 0),
    external_rate: Number(form.get("external_rate") || 0),
    pricing_note: form.get("pricing_note") ?? "",
    pricing_options: (() => { try { return JSON.parse(String(form.get("pricing_options") || "[]")); } catch (_error) { return []; } })(),
    notes: form.get("notes") ?? ""
  };
}

function tabButton(id, label) {
  return `<button type="button" data-tab="${id}" class="${state.activeTab === id ? "active" : ""}">${label}</button>`;
}

function pageTitle() {
  if (state.activeTab === "mine") return "我的预约";
  if (state.activeTab === "admin") return "后台管理";
  if (state.activeTab === "users") return "用户管理";
  return "设备日程";
}

function dateSummary() {
  const selectedDate = new Date(`${state.selectedDate}T00:00:00`);
  if (state.activeTab === "schedule") {
    const weekStart = startOfWeek(selectedDate);
    const weekEnd = addDays(weekStart, 6);
    return `${formatMonthDay(weekStart)} 至 ${formatMonthDay(weekEnd)}`;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(selectedDate);
}

function statusText(status) {
  const map = {
    pending: "待审批",
    approved: "已通过",
    rejected: "已拒绝",
    cancelled: "已取消"
  };
  return map[status] ?? status;
}

function deviceStatusText(status) {
  const map = {
    available: "可预约",
    maintenance: "维护中",
    offline: "已停用"
  };
  return map[status] ?? status;
}

function roleText(role) {
  const map = {
    user: "普通用户",
    admin: "管理员",
    super_admin: "超级管理员"
  };
  return map[role] ?? role;
}

function userTypeText(userType) {
  return userType === "external" ? "校外用户" : "校内用户";
}

function bookingPermissionText(permission) {
  const map = {
    none: "仅可查看",
    pending: "预约申请审核中",
    approved: "可预约",
    rejected: "预约申请被拒绝"
  };
  return map[permission] ?? "仅可查看";
}

function serviceModeText(mode) {
  return { self: "校内自主测试", delivery: "校内送样测试", external: "校外测试" }[mode] ?? "校内自主测试";
}

function formatTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatWeekday(value) {
  return new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(new Date(value));
}

function formatMonthDay(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "时间待确认";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatCurrency(value) {
  return `¥${Number(value || 0).toFixed(2)}`;
}

function renderHalfHourOptions(selectedValue = "") {
  const options = [];
  for (let hour = 0; hour < 24; hour += 1) {
    for (const minute of ["00", "30"]) {
      const value = `${String(hour).padStart(2, "0")}:${minute}`;
      options.push(`<option value="${value}" ${value === selectedValue ? "selected" : ""}>${value}</option>`);
    }
  }
  return options.join("");
}

function parseFormDateTime(dateValue, timeValue) {
  if (!dateValue || !timeValue) return new Date(NaN);
  return new Date(`${dateValue}T${timeValue}:00`);
}

function isHalfHourSlot(date) {
  return !Number.isNaN(date.getTime()) && date.getSeconds() === 0 && date.getMilliseconds() === 0 && [0, 30].includes(date.getMinutes());
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeek(date) {
  const result = new Date(date);
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function sameDate(left, right) {
  return toDateInputValue(left) === toDateInputValue(right);
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value = "") {
  return escapeHtml(value);
}

function setButtonBusy(button, label) {
  if (!button) return;

  if (label) {
    button.dataset.idleText = button.textContent;
    button.textContent = label;
    button.disabled = true;
    return;
  }

  button.textContent = button.dataset.idleText ?? button.textContent;
  button.disabled = false;
  delete button.dataset.idleText;
}

function friendlyError(error) {
  const message = error?.message ?? String(error);
  const lower = message.toLowerCase();

  if (lower.includes("invalid login credentials")) return "邮箱或密码不正确，请检查后重试。";
  if (lower.includes("email not confirmed")) return "邮箱还没有确认，请先打开邮件完成确认。";
  if (lower.includes("user already registered") || lower.includes("already registered")) return "这个邮箱已经注册过，请直接登录。";
  if (lower.includes("password")) return "密码不符合要求，请至少输入 6 位。";
  if (lower.includes("failed to fetch") || lower.includes("network")) return "网络连接失败，请检查 Supabase 配置或稍后重试。";
  if (lower.includes("row-level security")) return "当前账号没有权限执行这个操作，请确认已登录或联系管理员。";
  if (lower.includes("duplicate key") || lower.includes("bookings_no_time_overlap")) return "该时间段已经被预约，请换一个时间。";
  if (lower.includes("not available for booking")) return "该设备当前不可预约，请先将设备状态改为可预约。";

  return message;
}

function toast(message, type = "success") {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const element = document.createElement("div");
  element.className = `toast ${type}`;
  element.textContent = message;
  document.body.append(element);
  window.setTimeout(() => element.remove(), 3600);
}

boot();
