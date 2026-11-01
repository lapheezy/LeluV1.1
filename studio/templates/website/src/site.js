import {
  PROJECTS,
  confirmationMessage,
  describeCount,
  filterProjects,
  nextTheme,
  themeLabel,
  validateContact,
} from "./logic.js";

const root = document.documentElement;
const nav = document.getElementById("site-nav");
const menuToggle = document.getElementById("menu-toggle");
const themeToggle = document.getElementById("theme-toggle");
const filters = document.getElementById("filters");
const grid = document.getElementById("work-grid");
const resultCount = document.getElementById("result-count");
const emptyState = document.getElementById("empty-state");
const form = document.getElementById("contact-form");
const formStatus = document.getElementById("form-status");
const year = document.getElementById("year");

const STORE_KEY = "aurora.theme";
const cards = [...grid.querySelectorAll(".card")];

if (year) year.textContent = String(new Date().getFullYear());

/* ------------------------------- theme -------------------------------- */

function applyTheme(theme) {
  const value = theme === "day" ? "day" : "night";
  root.dataset.theme = value;
  themeToggle?.setAttribute("aria-pressed", String(value === "day"));
  const label = themeToggle?.querySelector(".theme-label");
  if (label) label.textContent = themeLabel(value);
  try {
    localStorage.setItem(STORE_KEY, value);
  } catch {
    /* storage can be blocked; the theme still applies for this visit */
  }
}

let storedTheme = "night";
try {
  storedTheme = localStorage.getItem(STORE_KEY) || "night";
} catch {
  storedTheme = "night";
}
applyTheme(storedTheme);

themeToggle?.addEventListener("click", () => {
  applyTheme(nextTheme(root.dataset.theme === "day" ? "day" : "night"));
});

/* ----------------------------- mobile nav ------------------------------ */

function closeNav() {
  nav?.classList.remove("is-open");
  menuToggle?.setAttribute("aria-expanded", "false");
}

menuToggle?.addEventListener("click", () => {
  const open = nav?.classList.toggle("is-open") ?? false;
  menuToggle.setAttribute("aria-expanded", String(open));
});

nav?.addEventListener("click", (event) => {
  if (event.target instanceof HTMLAnchorElement) closeNav();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeNav();
});

/* ------------------------------- filters ------------------------------- */

function applyFilter(filter) {
  const visible = filterProjects(PROJECTS, filter).map((project) => project.id);
  for (const card of cards) {
    const id = card.querySelector("h3")?.textContent?.toLowerCase().split(" ")[0] ?? "";
    const match = visible.some((visibleId) => id.startsWith(visibleId));
    card.hidden = !match;
  }
  if (resultCount) resultCount.textContent = describeCount(visible.length, PROJECTS.length);
  if (emptyState) emptyState.hidden = visible.length > 0;
  for (const chip of filters?.querySelectorAll("[data-filter]") ?? []) {
    const active = chip.getAttribute("data-filter") === filter;
    chip.classList.toggle("is-active", active);
    chip.setAttribute("aria-pressed", String(active));
  }
}

filters?.addEventListener("click", (event) => {
  const chip = event.target instanceof Element ? event.target.closest("[data-filter]") : null;
  if (chip) applyFilter(chip.getAttribute("data-filter") || "all");
});

applyFilter("all");

/* -------------------------------- form --------------------------------- */

function setFieldError(name, message) {
  const field = form?.elements.namedItem(name);
  const error = document.getElementById(`${name}-error`);
  if (field instanceof HTMLElement) {
    field.setAttribute("aria-invalid", message ? "true" : "false");
  }
  if (error) {
    error.textContent = message || "";
    error.hidden = !message;
  }
}

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const values = {
    name: String(data.get("name") ?? ""),
    email: String(data.get("email") ?? ""),
    message: String(data.get("message") ?? ""),
  };
  const errors = validateContact(values);
  for (const field of ["name", "email", "message"]) {
    setFieldError(field, errors[field] || "");
  }
  if (formStatus) {
    formStatus.hidden = Object.keys(errors).length > 0;
    formStatus.textContent = Object.keys(errors).length > 0 ? "" : confirmationMessage(values.name);
  }
  if (Object.keys(errors).length === 0) {
    form.reset();
    for (const field of ["name", "email", "message"]) setFieldError(field, "");
  }
});

for (const input of form?.querySelectorAll("input, textarea") ?? []) {
  input.addEventListener("input", () => {
    const name = input.getAttribute("name");
    if (name) setFieldError(name, "");
  });
}
