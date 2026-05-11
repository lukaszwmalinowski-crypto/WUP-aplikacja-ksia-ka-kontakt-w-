let DATA = null;
const PUBLIC = window.APP_PUBLIC || {};
const ENCRYPTED = window.APP_ENCRYPTED_DATA || {};
const $ = (id) => document.getElementById(id);
let activeView = "search";
let activeQuick = "";
let activeInst = "pup";

const normalize = (v) => String(v || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map(x => x[0] || "").join("").toUpperCase();
const callHref = (phone) => {
  const digits = String(phone || "").replace(/[^0-9+]/g, "");
  return digits ? `tel:${digits}` : "#";
};
const mailHref = (email) => email ? `mailto:${email}` : "#";

function bytesFromBase64(value) {
  return Uint8Array.from(atob(value), ch => ch.charCodeAt(0));
}

async function decryptData(password) {
  const salt = bytesFromBase64(ENCRYPTED.salt);
  const iv = bytesFromBase64(ENCRYPTED.iv);
  const packed = bytesFromBase64(ENCRYPTED.payload);
  const ciphertext = packed.slice(0, packed.length - 16);
  const tag = packed.slice(packed.length - 16);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ENCRYPTED.iterations, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext);
  combined.set(tag, ciphertext.length);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, combined);
  return JSON.parse(new TextDecoder().decode(plain));
}

function setLocked(isLocked) {
  document.body.classList.toggle("locked-state", isLocked);
  $("lockScreen").classList.toggle("unlocked", !isLocked);
  document.querySelector(".app").classList.toggle("locked", isLocked);
  document.querySelector(".bottom-nav").classList.toggle("locked", isLocked);
}

async function unlockApp(event) {
  event.preventDefault();
  const input = $("passwordInput");
  const button = $("unlockButton");
  const error = $("lockError");
  const password = input.value;
  error.textContent = "";
  button.disabled = true;
  button.textContent = "Sprawdzam...";
  try {
    DATA = await decryptData(password);
    setLocked(false);
    input.value = "";
    renderPeople();
    renderTree();
    renderInstitutions();
  } catch (err) {
    error.textContent = "Nieprawidłowy kod dostępu.";
    input.select();
  } finally {
    button.disabled = false;
    button.textContent = "Odblokuj";
  }
}

function personCard(p) {
  return `<article class="card"><div class="person-top"><div class="avatar">${esc(initials(p.name))}</div><div><div class="name">${esc(p.name)}</div>${p.role ? `<div class="role">${esc(p.role)}</div>` : ""}<div class="unit">${esc(p.unit || p.path || "")}</div></div></div><div class="meta">${p.phone ? `<a class="chip" href="${callHref(p.phone)}">tel. ${esc(p.phone)}</a>` : ""}${p.email ? `<a class="chip email" href="${mailHref(p.email)}">${esc(p.email)}</a>` : ""}${p.room ? `<span class="chip">pok. ${esc(p.room)}</span>` : ""}${p.code ? `<span class="chip">${esc(p.code)}</span>` : ""}</div></article>`;
}

function institutionCard(item) {
  const bits = [];
  if (item.adres) bits.push(`<div class="line"><b>Adres:</b> ${esc(item.adres)}</div>`);
  if (item.telefon || item.phone) bits.push(`<div class="line"><b>Telefon:</b> ${esc(item.telefon || item.phone)}</div>`);
  if (item.kontakt) bits.push(`<div class="line"><b>Kontakt:</b> ${esc(item.kontakt)}</div>`);
  if (item.email) bits.push(`<div class="line"><b>E-mail:</b> ${esc(item.email)}</div>`);
  if (item.www) bits.push(`<div class="line"><b>WWW:</b> ${esc(item.www)}</div>`);
  if (item.gminy) bits.push(`<div class="line"><b>Gminy:</b> ${esc(item.gminy)}</div>`);
  if (item.lines) bits.push(item.lines.map(x => `<div class="line">${esc(x)}</div>`).join(""));
  return `<article class="card institution"><div class="person-top"><div class="avatar">${esc((item.kod || item.code || "I").replace("PUP_", "").slice(0, 2))}</div><div><div class="name">${esc(item.nazwa || item.title || item.name)}</div>${item.typ || item.code ? `<div class="role">${esc(item.typ || item.code)}</div>` : ""}</div></div>${bits.join("")}<div class="meta">${(item.telefon || item.phone) ? `<a class="chip" href="${callHref(item.telefon || item.phone)}">Zadzwoń</a>` : ""}${item.email ? `<a class="chip email" href="${mailHref(item.email)}">E-mail</a>` : ""}</div></article>`;
}

function searchableInst() {
  const frsePeople = [...(DATA.frse.ka1 || []), ...(DATA.frse.ka2 || [])].map(p => ({ ...p, nazwa: p.name, typ: "FRSE" }));
  const umslCards = (DATA.umsl.cards || []).map(c => ({ ...c, nazwa: c.title, typ: "UMŚL" }));
  return [...DATA.pups, ...frsePeople, { nazwa: DATA.umsl.name, typ: "UMŚL", adres: DATA.umsl.address, telefon: DATA.umsl.phone, email: DATA.umsl.email }, ...umslCards];
}

function renderPeople() {
  if (!DATA) return;
  const q = normalize($("search").value);
  let list = DATA.people;
  if (q) list = list.filter(p => normalize([p.name, p.email, p.phone, p.room, p.role, p.unit, p.path, p.code].join(" ")).includes(q));
  if (activeQuick === "inst") list = [];
  $("peopleCount").textContent = `${list.length} / ${DATA.people.length}`;
  $("peopleResults").innerHTML = list.slice(0, 80).map(personCard).join("") || `<div class="empty">Brak wyników. Spróbuj wpisać samo nazwisko albo numer telefonu.</div>`;
}

function renderTreeNode(node, depth = 0) {
  const count = (node.people || []).length;
  const children = (node.children || []).map(ch => renderTreeNode(ch, depth + 1)).join("");
  const people = (node.people || []).map(personCard).join("");
  const cls = children || people ? "node" : "node leaf";
  const open = depth === 0 ? " open" : "";
  return `<details class="${cls}"${open}><summary>${esc(node.name)}${node.code ? ` <small>${esc(node.code)} · ${count} osób</small>` : count ? ` <small>${count} osób</small>` : ""}</summary><div class="children">${people}${children}</div></details>`;
}

function renderTree() {
  if (!DATA) return;
  $("orgCount").textContent = `${DATA.stats.people} osób`;
  $("orgTree").innerHTML = renderTreeNode(DATA.org);
}

function renderInstitutions() {
  if (!DATA) return;
  const q = normalize($("search").value);
  const filter = (arr) => q ? arr.filter(x => normalize(JSON.stringify(x)).includes(q)) : arr;
  const pups = filter(DATA.pups);
  $("inst-pup").innerHTML = pups.map(institutionCard).join("") || `<div class="empty">Brak PUP dla tego wyszukiwania.</div>`;
  const frseItems = [{ nazwa: DATA.frse.nazwa, typ: "FRSE", adres: DATA.frse.adres, telefon: DATA.frse.telefon }, ...(DATA.frse.ka1 || []).map(p => ({ ...p, nazwa: p.name, typ: "FRSE KA1" })), ...(DATA.frse.ka2 || []).map(p => ({ ...p, nazwa: p.name, typ: "FRSE KA2" }))];
  $("inst-frse").innerHTML = filter(frseItems).map(institutionCard).join("") || `<div class="empty">Brak kontaktów FRSE.</div>`;
  const umslItems = [{ nazwa: DATA.umsl.name, typ: "UMŚL", adres: DATA.umsl.address, telefon: DATA.umsl.phone, email: DATA.umsl.email }, ...(DATA.umsl.cards || []).map(c => ({ ...c, nazwa: c.title, typ: c.code }))];
  $("inst-umsl").innerHTML = filter(umslItems).map(institutionCard).join("") || `<div class="empty">Brak kontaktów UMŚL.</div>`;
  const total = searchableInst().filter(x => !q || normalize(JSON.stringify(x)).includes(q)).length;
  $("instCount").textContent = `${total} pozycji`;
}

function switchView(view) {
  activeView = view;
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  $(`view-${view}`).classList.add("active");
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  if (view === "org") renderTree();
  if (view === "inst") renderInstitutions();
}

function applySearch() {
  if (activeView === "inst" || activeQuick === "inst") renderInstitutions();
  renderPeople();
}

function init() {
  $("brandLogo").src = PUBLIC.logo || "";
  $("lockLogo").src = PUBLIC.logo || "";
  setLocked(true);
  $("unlockForm").addEventListener("submit", unlockApp);
  $("search").addEventListener("input", applySearch);
  document.querySelectorAll(".nav-btn").forEach(b => b.addEventListener("click", () => switchView(b.dataset.view)));
  document.querySelectorAll("[data-quick]").forEach(b => b.addEventListener("click", () => {
    activeQuick = b.dataset.quick;
    document.querySelectorAll("[data-quick]").forEach(x => x.classList.toggle("active", x === b));
    if (activeQuick === "inst") switchView("inst");
    else switchView("search");
    applySearch();
  }));
  document.querySelectorAll("[data-inst]").forEach(b => b.addEventListener("click", () => {
    activeInst = b.dataset.inst;
    document.querySelectorAll("[data-inst]").forEach(x => x.classList.toggle("active", x === b));
    document.querySelectorAll(".inst-group").forEach(g => g.classList.toggle("active", g.id === `inst-${activeInst}`));
  }));
  $("collapseTree").addEventListener("click", () => document.querySelectorAll("#orgTree details").forEach((d, i) => d.open = i === 0));
  $("expandTree").addEventListener("click", () => document.querySelectorAll("#orgTree details").forEach((d, i) => { if (i < 8) d.open = true; }));
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  setTimeout(() => $("passwordInput").focus(), 150);
}

document.addEventListener("DOMContentLoaded", init);
