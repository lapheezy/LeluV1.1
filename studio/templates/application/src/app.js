/**
 * Pulse Board frontend. Every number on screen comes from the backend:
 * no optimistic local counters, so a failed request is visible instead of
 * being hidden by a UI that already moved.
 */

const API = "/api";
const LANES = ["todo", "doing", "done"];
const NEXT_LANE = { todo: "doing", doing: "done", done: "todo" };

const connection = document.getElementById("connection");
const form = document.getElementById("task-form");
const titleInput = document.getElementById("task-title");
const laneInput = document.getElementById("task-lane");
const composerError = document.getElementById("composer-error");
const boardError = document.getElementById("board-error");
const resetButton = document.getElementById("reset-demo");

let state = { tasks: [], stats: { total: 0, byLane: { todo: 0, doing: 0, done: 0 }, donePercent: 0 } };

function setError(element, message) {
  if (!element) return;
  element.textContent = message || "";
  element.hidden = !message;
}

function setConnection(mode, text) {
  if (!connection) return;
  connection.textContent = text;
  connection.classList.toggle("is-live", mode === "live");
  connection.classList.toggle("is-down", mode === "down");
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(Array.isArray(data.errors) ? data.errors.join(" ") : `HTTP ${response.status}`);
  }
  return data;
}

function countTasks(tasks) {
  const byLane = { todo: 0, doing: 0, done: 0 };
  for (const task of tasks) byLane[task.lane] += 1;
  const donePercent = tasks.length === 0 ? 0 : Math.round((byLane.done / tasks.length) * 100);
  return { total: tasks.length, byLane, donePercent };
}

function taskElement(task) {
  const item = document.createElement("li");
  item.className = "task";
  item.dataset.taskId = String(task.id);

  const title = document.createElement("p");
  title.className = "task-title";
  title.textContent = task.title;

  const meta = document.createElement("div");
  meta.className = "task-meta";

  const move = document.createElement("button");
  move.type = "button";
  move.dataset.action = "move";
  move.textContent = task.lane === "done" ? "Reopen" : `Move to ${NEXT_LANE[task.lane]}`;
  meta.append(move);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.dataset.action = "delete";
  remove.className = "danger";
  remove.textContent = "Delete";
  meta.append(remove);

  item.append(title, meta);
  return item;
}

function render() {
  for (const lane of LANES) {
    const list = document.querySelector(`[data-list="${lane}"]`);
    const empty = document.querySelector(`[data-empty="${lane}"]`);
    const count = document.querySelector(`[data-count="${lane}"]`);
    if (!list) continue;
    list.replaceChildren(...state.tasks.filter((task) => task.lane === lane).map(taskElement));
    if (empty) empty.hidden = state.tasks.some((task) => task.lane === lane);
    if (count) count.textContent = String(state.stats.byLane[lane] ?? 0);
  }
  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value);
  };
  setText("stat-total", state.stats.total);
  setText("stat-doing", state.stats.byLane.doing);
  setText("stat-done", state.stats.byLane.done);
  setText("stat-percent", `${state.stats.donePercent}%`);
}

function recalculate() {
  state.stats = countTasks(state.tasks);
  render();
}

async function refresh() {
  try {
    const data = await api("/tasks");
    state.tasks = data.tasks ?? [];
    recalculate();
    setConnection("live", `Live · ${state.tasks.length} stored`);
    setError(boardError, "");
  } catch (error) {
    setConnection("down", "Backend unreachable");
    setError(
      boardError,
      `The backend could not be reached (${error.message}). Nothing shown here is cached.`,
    );
  }
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError(composerError, "");
  try {
    await api("/tasks", {
      method: "POST",
      body: JSON.stringify({ title: titleInput?.value ?? "", lane: laneInput?.value ?? "todo" }),
    });
    if (titleInput) titleInput.value = "";
    await refresh();
    titleInput?.focus();
  } catch (error) {
    setError(composerError, error.message);
  }
});

document.querySelector(".board")?.addEventListener("click", async (event) => {
  const button = event.target instanceof Element ? event.target.closest("button[data-action]") : null;
  if (!button) return;
  const item = button.closest("[data-task-id]");
  const task = state.tasks.find((candidate) => String(candidate.id) === item?.getAttribute("data-task-id"));
  if (!task) return;
  try {
    if (button.dataset.action === "delete") {
      await api(`/tasks/${task.id}`, { method: "DELETE" });
    } else {
      await api(`/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ lane: NEXT_LANE[task.lane] }),
      });
    }
    await refresh();
  } catch (error) {
    setError(boardError, error.message);
  }
});

resetButton?.addEventListener("click", async () => {
  try {
    await api("/tasks", { method: "DELETE" });
    await refresh();
  } catch (error) {
    setError(boardError, error.message);
  }
});

refresh();
