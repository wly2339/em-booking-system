import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const config = window.EM_BOOKING_CONFIG;
const app = document.querySelector("#app");

let supabase = null;
let state = {
  user: null,
  profile: null,
  microscopes: [],
  bookings: [],
  activeTab: "schedule",
  selectedDate: toDateInputValue(new Date()),
  selectedMicroscopeId: "all"
};

function initClient() {
  if (!config || !config.supabaseUrl || !config.supabaseAnonKey || config.supabaseUrl.includes("YOUR_PROJECT_ID")) {
    renderConfigMissing();
    return false;
  }

  supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  return true;
}

async function boot() {
  if (!initClient()) return;

  renderLoading();
  const { data } = await supabase.auth.getSession();
  state.user = data.session?.user ?? null;

  supabase.auth.onAuthStateChange(async (_event, session) => {
    state.user = session?.user ?? null;
    if (state.user) {
      await loadAppData();
    } else {
      state.profile = null;
      state.bookings = [];
      renderAuth();
    }
  });

  if (state.user) {
    await loadAppData();
  } else {
    renderAuth();
  }
}

async function loadAppData() {
  renderLoading();
  await Promise.all([loadProfile(), loadMicroscopes()]);
  await loadBookings();
  renderApp();
}

async function loadProfile() {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", state.user.id)
    .single();

  if (error && error.code !== "PGRST116") {
    toast(error.message, "error");
    return;
  }

  state.profile = data ?? {
    id: state.user.id,
    email: state.user.email,
    full_name: state.user.user_metadata?.full_name ?? "",
    lab: "",
    phone: "",
    role: "user"
  };
}

async function loadMicroscopes() {
  const { data, error } = await supabase
    .from("microscopes")
    .select("*")
    .order("name");

  if (error) {
    toast(error.message, "error");
    return;
  }

  state.microscopes = data ?? [];
  if (state.selectedMicroscopeId !== "all" && !state.microscopes.some((item) => item.id === state.selectedMicroscopeId)) {
    state.selectedMicroscopeId = "all";
  }
}

async function loadBookings() {
  const dateStart = new Date(`${state.selectedDate}T00:00:00`);
  const dateEnd = new Date(dateStart);
  dateEnd.setDate(dateEnd.getDate() + 1);

  let query = supabase
    .from("bookings")
    .select("*, microscopes(name, location), profiles(full_name, lab, email)")
    .gte("start_at", dateStart.toISOString())
    .lt("start_at", dateEnd.toISOString())
    .order("start_at");

  if (state.activeTab === "mine") {
    query = query.eq("user_id", state.user.id);
  }

  if (state.selectedMicroscopeId !== "all") {
    query = query.eq("microscope_id", state.selectedMicroscopeId);
  }

  const { data, error } = await query;

  if (error) {
    toast(error.message, "error");
    return;
  }

  state.bookings = data ?? [];
}

function renderConfigMissing() {
  app.innerHTML = `
    <main class="shell compact">
      <section class="notice-panel">
        <h1>需要配置 Supabase</h1>
        <p>请复制 <code>public/config.example.js</code> 为 <code>public/config.js</code>，并填入 Supabase 项目的 URL 和 anon key。</p>
      </section>
    </main>
  `;
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

function renderAuth() {
  app.innerHTML = `
    <main class="auth-layout">
      <section class="auth-media" aria-label="电镜实验室"></section>
      <section class="auth-panel">
        <div class="brand">
          <span>EM Booking</span>
          <strong>电镜预约系统</strong>
        </div>
        <form class="auth-form" id="auth-form">
          <label>
            邮箱
            <input name="email" type="email" autocomplete="email" required>
          </label>
          <label>
            密码
            <input name="password" type="password" autocomplete="current-password" minlength="6" required>
          </label>
          <label>
            姓名
            <input name="full_name" autocomplete="name" placeholder="注册时填写">
          </label>
          <div class="auth-actions">
            <button class="primary" type="submit" data-auth-mode="signin">登录</button>
            <button class="secondary" type="button" data-auth-mode="signup">注册</button>
          </div>
          <p class="form-note">注册后如果无法登录，请先检查 Supabase 是否开启了邮箱确认。</p>
        </form>
      </section>
    </main>
  `;

  document.querySelector("#auth-form").addEventListener("submit", handleSignIn);
  document.querySelector("[data-auth-mode='signup']").addEventListener("click", handleSignUp);
}

function renderApp() {
  const isAdmin = state.profile?.role === "admin";

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
          ${isAdmin ? tabButton("admin", "审批") : ""}
        </nav>
        <form class="profile-form" id="profile-form">
          <h2>个人信息</h2>
          <label>
            姓名
            <input name="full_name" value="${escapeAttr(state.profile?.full_name)}" required>
          </label>
          <label>
            课题组
            <input name="lab" value="${escapeAttr(state.profile?.lab)}">
          </label>
          <label>
            手机
            <input name="phone" value="${escapeAttr(state.profile?.phone)}">
          </label>
          <button type="submit">保存</button>
        </form>
        <button class="ghost" id="sign-out" type="button">退出登录</button>
      </aside>

      <main class="workspace">
        <header class="topbar">
          <div>
            <p>${new Intl.DateTimeFormat("zh-CN", { weekday: "long", month: "long", day: "numeric" }).format(new Date(`${state.selectedDate}T00:00:00`))}</p>
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
                ${state.microscopes.map((item) => `
                  <option value="${item.id}" ${item.id === state.selectedMicroscopeId ? "selected" : ""}>${escapeHtml(item.name)}</option>
                `).join("")}
              </select>
            </label>
          </div>
        </header>

        ${state.activeTab === "schedule" ? renderSchedule() : ""}
        ${state.activeTab === "mine" ? renderMine() : ""}
        ${state.activeTab === "admin" && isAdmin ? renderAdmin() : ""}
      </main>
    </div>
  `;

  wireAppEvents();
}

function renderSchedule() {
  return `
    <section class="content-grid">
      <form class="booking-form" id="booking-form">
        <h2>提交预约</h2>
        <p class="form-note">提交后默认进入待审批状态；若时间段已被占用，系统会阻止重复预约。</p>
        <label>
          设备
          <select name="microscope_id" required>
            ${state.microscopes.map((item) => `
              <option value="${item.id}">${escapeHtml(item.name)} · ${escapeHtml(item.location)}</option>
            `).join("")}
          </select>
        </label>
        <label>
          实验名称
          <input name="title" placeholder="如：纳米颗粒 TEM 表征" required>
        </label>
        <div class="two-col">
          <label>
            开始
            <input name="start_at" type="datetime-local" required>
          </label>
          <label>
            结束
            <input name="end_at" type="datetime-local" required>
          </label>
        </div>
        <label>
          样品类型
          <input name="sample_type" placeholder="粉末 / 薄膜 / 截面样">
        </label>
        <label>
          实验目的
          <textarea name="purpose" rows="4" placeholder="测试内容、测试条件、特殊注意事项"></textarea>
        </label>
        <button class="primary" type="submit">提交申请</button>
      </form>
      <section class="panel">
        <div class="section-head">
          <h2>当天日程</h2>
          <span>${state.bookings.length} 条</span>
        </div>
        ${renderBookingList(state.bookings, { adminActions: false, ownActions: false })}
      </section>
    </section>
  `;
}

function renderMine() {
  return `
    <section class="panel wide">
      <div class="section-head">
        <h2>我的预约</h2>
        <span>${state.bookings.length} 条</span>
      </div>
      ${renderBookingList(state.bookings, { ownActions: true, adminActions: false })}
    </section>
  `;
}

function renderAdmin() {
  const pending = state.bookings.filter((item) => item.status === "pending");
  return `
    <section class="panel wide">
      <div class="section-head">
        <h2>待审批</h2>
        <span>${pending.length} 条</span>
      </div>
      ${renderBookingList(state.bookings, { adminActions: true, ownActions: false })}
    </section>
  `;
}

function renderBookingList(bookings, options) {
  if (!bookings.length) {
    return `<div class="empty">暂无预约</div>`;
  }

  return `
    <div class="booking-list">
      ${bookings.map((booking) => `
        <article class="booking-item status-${booking.status}">
          <div class="booking-time">
            <strong>${formatTime(booking.start_at)}</strong>
            <span>${formatTime(booking.end_at)}</span>
          </div>
          <div class="booking-main">
            <div class="booking-title">
              <h3>${escapeHtml(booking.title)}</h3>
              <span class="status-pill status-${booking.status}">${statusText(booking.status)}</span>
            </div>
            <p>${escapeHtml(booking.microscopes?.name ?? "")} · ${escapeHtml(booking.microscopes?.location ?? "")}</p>
            <p>${escapeHtml(booking.profiles?.full_name ?? "")} ${booking.profiles?.lab ? `· ${escapeHtml(booking.profiles.lab)}` : ""}</p>
            ${booking.sample_type ? `<p>样品：${escapeHtml(booking.sample_type)}</p>` : ""}
            ${booking.purpose ? `<p>${escapeHtml(booking.purpose)}</p>` : ""}
            ${booking.operator_notes ? `<p>备注：${escapeHtml(booking.operator_notes)}</p>` : ""}
            ${renderActions(booking, options)}
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderActions(booking, options) {
  if (options.adminActions && booking.status === "pending") {
    return `
      <div class="row-actions">
        <button class="primary" type="button" data-approve="${booking.id}">通过</button>
        <button class="danger" type="button" data-reject="${booking.id}">拒绝</button>
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
      await loadBookings();
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

  document.querySelector("#profile-form").addEventListener("submit", handleProfileSave);
  document.querySelector("#sign-out").addEventListener("click", () => supabase.auth.signOut());

  const bookingForm = document.querySelector("#booking-form");
  if (bookingForm) bookingForm.addEventListener("submit", handleBookingCreate);

  document.querySelectorAll("[data-approve]").forEach((button) => {
    button.addEventListener("click", () => updateBookingStatus(button.dataset.approve, "approved"));
  });

  document.querySelectorAll("[data-reject]").forEach((button) => {
    button.addEventListener("click", () => updateBookingStatus(button.dataset.reject, "rejected"));
  });

  document.querySelectorAll("[data-cancel]").forEach((button) => {
    button.addEventListener("click", () => updateBookingStatus(button.dataset.cancel, "cancelled"));
  });
}

async function handleSignIn(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const button = formElement.querySelector("[data-auth-mode='signin']");
  setButtonBusy(button, "正在登录...");
  toast("正在登录，请稍候。", "info");
  const form = new FormData(event.currentTarget);
  const { error } = await supabase.auth.signInWithPassword({
    email: form.get("email"),
    password: form.get("password")
  });
  setButtonBusy(button);
  if (error) {
    toast(friendlyError(error), "error");
    return;
  }
  toast("登录成功，正在进入预约系统。");
}

async function handleSignUp(event) {
  const formElement = event.currentTarget.closest(".auth-panel").querySelector("form");
  const button = event.currentTarget;
  setButtonBusy(button, "正在注册...");
  toast("正在创建账号，请稍候。", "info");
  const form = new FormData(formElement);
  const { data, error } = await supabase.auth.signUp({
    email: form.get("email"),
    password: form.get("password"),
    options: {
      data: {
        full_name: form.get("full_name")
      }
    }
  });

  setButtonBusy(button);
  if (error) {
    toast(friendlyError(error), "error");
  } else {
    const needsEmailConfirm = !data.session;
    const message = needsEmailConfirm
      ? "注册成功，请先打开邮箱完成确认，然后再登录。"
      : "注册成功，已自动登录。";
    toast(message);
  }
}

async function handleProfileSave(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type='submit']");
  setButtonBusy(button, "保存中...");
  const form = new FormData(event.currentTarget);
  const payload = {
    id: state.user.id,
    email: state.user.email,
    full_name: form.get("full_name"),
    lab: form.get("lab"),
    phone: form.get("phone")
  };

  const { error } = await supabase.from("profiles").upsert(payload);
  if (error) {
    setButtonBusy(button);
    toast(friendlyError(error), "error");
    return;
  }

  await loadProfile();
  renderApp();
  toast("个人信息已保存，后续预约会使用这份资料。");
}

async function handleBookingCreate(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const button = formElement.querySelector("button[type='submit']");
  setButtonBusy(button, "提交中...");
  const form = new FormData(event.currentTarget);
  const startAt = new Date(form.get("start_at"));
  const endAt = new Date(form.get("end_at"));

  if (endAt <= startAt) {
    setButtonBusy(button);
    toast("结束时间必须晚于开始时间。", "error");
    return;
  }

  const { error } = await supabase.from("bookings").insert({
    microscope_id: form.get("microscope_id"),
    user_id: state.user.id,
    title: form.get("title"),
    purpose: form.get("purpose"),
    sample_type: form.get("sample_type"),
    start_at: startAt.toISOString(),
    end_at: endAt.toISOString()
  });

  if (error) {
    const message = error.message.includes("bookings_no_time_overlap")
      ? "该时间段已经被预约，请换一个时间。"
      : friendlyError(error);
    setButtonBusy(button);
    toast(message, "error");
    return;
  }

  const microscope = state.microscopes.find((item) => item.id === form.get("microscope_id"));
  event.currentTarget.reset();
  await loadBookings();
  renderApp();
  toast(`预约已提交：${microscope?.name ?? "所选设备"}，${formatDateTime(startAt)} 至 ${formatDateTime(endAt)}，等待管理员审批。`);
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
  const { error } = await supabase
    .from("bookings")
    .update({ status, operator_notes: operatorNotes })
    .eq("id", id);

  if (error) {
    toast(friendlyError(error), "error");
    return;
  }

  await loadBookings();
  renderApp();
  toast(`预约已${actionText}。`);
}

function tabButton(id, label) {
  return `<button type="button" data-tab="${id}" class="${state.activeTab === id ? "active" : ""}">${label}</button>`;
}

function pageTitle() {
  if (state.activeTab === "mine") return "我的预约";
  if (state.activeTab === "admin") return "预约审批";
  return "设备日程";
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

function formatTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(value);
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
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
