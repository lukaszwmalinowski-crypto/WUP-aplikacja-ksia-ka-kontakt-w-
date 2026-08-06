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

function currentPeopleList() {
  if (!DATA) return [];
  const q = normalize($("search").value);
  let list = DATA.people;
  if (q) list = list.filter(p => normalize([p.name, p.email, p.phone, p.room, p.role, p.unit, p.path, p.code].join(" ")).includes(q));
  if (activeQuick === "inst") list = [];
  return list;
}

function renderPeople() {
  if (!DATA) return;
  const list = currentPeopleList();
  $("peopleCount").textContent = `${list.length} / ${DATA.people.length}`;
  $("peopleResults").innerHTML = list.slice(0, 80).map(personCard).join("") || `<div class="empty">Brak wyników. Spróbuj wpisać samo nazwisko albo numer telefonu.</div>`;
  updateSignListScopeNote();
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


function openSignListModal() {
  if (!DATA) return;
  const modal = $("signListModal");
  const today = new Date();
  const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (!$("signListDate").value) $("signListDate").value = localDate;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  updateSignListScopeNote();
  setTimeout(() => $("signListHeading").focus(), 30);
}

function closeSignListModal() {
  $("signListModal").hidden = true;
  document.body.style.overflow = "";
}

function personKey(person) {
  return [person.name, person.phone, person.room, person.code, person.unit, person.path].map(normalize).join("|");
}

function personIdentityKey(person) {
  return normalize(person.name).replace(/ł/g, "l").replace(/[^a-z0-9]+/g, " ").trim();
}

function uniquePeople(list) {
  const seen = new Set();
  return list.filter(person => {
    const key = personIdentityKey(person) || personKey(person);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeOrgLocation(value) {
  return normalize(value).replace(/ł/g, "l");
}

function isBielskoPerson(person) {
  const path = normalizeOrgLocation(person.path || person.unit || "");
  return person.code === "BBI" || path.includes("filia wup w bielsku-bialej");
}

function isCzestochowaPerson(person) {
  const path = normalizeOrgLocation(person.path || person.unit || "");
  return person.code === "BCZ" || path.includes("filia wup w czestochowie");
}

function peopleForSignListScope(scope) {
  if (!DATA) return [];
  let list;
  if (scope === "all") list = [...DATA.people];
  else if (scope === "central") list = DATA.people.filter(person => !isBielskoPerson(person) && !isCzestochowaPerson(person));
  else if (scope === "branches") list = DATA.people.filter(person => isBielskoPerson(person) || isCzestochowaPerson(person));
  else if (scope === "bielsko") list = DATA.people.filter(isBielskoPerson);
  else if (scope === "czestochowa") list = DATA.people.filter(isCzestochowaPerson);
  else list = [...currentPeopleList()];
  return uniquePeople(list);
}

function signListScopeLabel(scope) {
  return ({
    filtered: "aktualne wyniki wyszukiwania",
    all: "wszyscy pracownicy WUP",
    central: "centrala WUP - bez filii",
    branches: "obie filie WUP",
    bielsko: "Filia WUP w Bielsku-Białej",
    czestochowa: "Filia WUP w Częstochowie"
  })[scope] || "wybrani pracownicy";
}

function updateSignListScopeNote() {
  const note = $("signListScopeNote");
  if (!note || !DATA) return;
  const scope = $("signListScope") ? $("signListScope").value : "filtered";
  const list = peopleForSignListScope(scope);
  if (scope === "filtered") {
    const query = $("search").value.trim();
    note.textContent = query
      ? `Lista obejmie ${list.length} osób pasujących do wyszukiwania: „${query}”. Możesz wydrukować je alfabetycznie albo według schematu organizacyjnego. Każda osoba pojawi się tylko raz.`
      : `Lista obejmie aktualne wyniki: ${list.length} osób. Wybierz układ według schematu, aby lista została podzielona na piony, zespoły i filie. Każda osoba pojawi się tylko raz.`;
    return;
  }
  note.textContent = `Zakres: ${signListScopeLabel(scope)} - ${list.length} osób. Układ według schematu zachowa podział na komórki organizacyjne i filie. Każda osoba pojawi się tylko raz.`;
}

function formatPolishDate(value) {
  if (!value) return "";
  const parts = value.split("-");
  if (parts.length !== 3) return value;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

function printableUnit(person) {
  const role = String(person.role || "").trim();
  const unit = String(person.unit || person.path || "").trim();
  if (role && unit) return `${esc(role)}<br><span>${esc(unit)}</span>`;
  return esc(role || unit || "—");
}

function flattenOrgRecords() {
  const records = [];
  const walk = (node, trail = []) => {
    const nextTrail = [...trail, node.name];
    (node.people || []).forEach(person => records.push({
      person,
      top: nextTrail[1] || node.name,
      unit: node.name
    }));
    (node.children || []).forEach(child => walk(child, nextTrail));
  };
  walk(DATA.org);
  return records;
}

function branchSchemeRecords(branch) {
  const isBielsko = branch === "bielsko";
  const branchName = isBielsko ? "Filia WUP w Bielsku-Białej" : "Filia WUP w Częstochowie";
  const managerCode = isBielsko ? "BBI" : "BCZ";
  const belongs = isBielsko ? isBielskoPerson : isCzestochowaPerson;
  const records = flattenOrgRecords();
  const managerRecords = records
    .filter(record => record.person.code === managerCode)
    .map(record => ({ ...record, top: branchName, unit: "Kierownictwo filii" }));
  const branchRecords = records
    .filter(record => belongs(record.person) && record.person.code !== managerCode)
    .map(record => ({ ...record, top: branchName }));
  return [...managerRecords, ...branchRecords];
}

function recordsForScheme(scope, allowedPeople) {
  const allowed = new Set(allowedPeople.map(personKey));
  let records;
  if (scope === "bielsko") records = branchSchemeRecords("bielsko");
  else if (scope === "czestochowa") records = branchSchemeRecords("czestochowa");
  else if (scope === "branches") records = [...branchSchemeRecords("bielsko"), ...branchSchemeRecords("czestochowa")];
  else records = flattenOrgRecords();
  const seen = new Set();
  return records.filter(record => {
    if (!allowed.has(personKey(record.person))) return false;
    const identity = personIdentityKey(record.person) || personKey(record.person);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function schemeSections(scope, allowedPeople) {
  const sections = [];
  recordsForScheme(scope, allowedPeople).forEach(record => {
    let section = sections.find(item => item.name === record.top);
    if (!section) {
      section = { name: record.top, groups: [] };
      sections.push(section);
    }
    let group = section.groups.find(item => item.name === record.unit);
    if (!group) {
      group = { name: record.unit, people: [] };
      section.groups.push(group);
    }
    group.people.push(record.person);
  });
  return sections;
}

function regularRows(list) {
  return list.map((person, index) => `
    <tr>
      <td class="number">${index + 1}</td>
      <td class="person-name">${esc(person.name)}</td>
      <td class="person-unit">${printableUnit(person)}</td>
      <td class="signature"></td>
    </tr>`).join("");
}

function schemePrintContent(scope, list) {
  let rowNumber = 0;
  const sections = schemeSections(scope, list);
  return sections.map((section, sectionIndex) => {
    const groups = section.groups.map(group => {
      const rows = group.people.map(person => {
        rowNumber += 1;
        return `<tr>
          <td class="number">${rowNumber}</td>
          <td class="person-name">${esc(person.name)}</td>
          <td class="person-unit">${printableUnit(person)}</td>
          <td class="signature"></td>
        </tr>`;
      }).join("");
      return `<tr class="unit-row"><td colspan="4">${esc(group.name)}</td></tr>${rows}`;
    }).join("");
    const isBranch = normalize(section.name).startsWith("filia wup");
    const pageBreak = isBranch && sectionIndex > 0 ? " page-break" : "";
    return `<section class="org-section${pageBreak}">
      <h2 class="section-title">${esc(section.name)}</h2>
      <table>
        <thead><tr><th>Lp.</th><th>Imię i nazwisko</th><th>Komórka / stanowisko</th><th>Podpis</th></tr></thead>
        <tbody>${groups}</tbody>
      </table>
    </section>`;
  }).join("");
}

function generateSignList(event) {
  event.preventDefault();
  if (!DATA) return;
  const scope = $("signListScope").value;
  const layout = $("signListSort").value;
  let list = peopleForSignListScope(scope);
  if (!list.length) {
    alert("Brak osób do umieszczenia na liście. Zmień zakres albo wyszukiwanie.");
    return;
  }
  if (layout === "alpha") {
    list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pl", { sensitivity: "base" }));
  }

  const heading = $("signListHeading").value.trim() || "Lista do podpisu";
  const purpose = $("signListPurpose").value.trim();
  const date = formatPolishDate($("signListDate").value);
  const layoutLabel = layout === "scheme" ? "według schematu organizacyjnego" : layout === "alpha" ? "alfabetycznie" : "bez grupowania";
  const content = layout === "scheme"
    ? schemePrintContent(scope, list)
    : `<table class="plain-list">
        <thead><tr><th>Lp.</th><th>Imię i nazwisko</th><th>Komórka / stanowisko</th><th>Podpis</th></tr></thead>
        <tbody>${regularRows(list)}</tbody>
      </table>`;

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Przeglądarka zablokowała okno wydruku. Zezwól aplikacji na otwieranie nowych okien i spróbuj ponownie.");
    return;
  }

  const logo = PUBLIC.logo ? `<img src="${esc(PUBLIC.logo)}" alt="Logo WUP Katowice">` : "";
  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(heading)}</title>
<style>
  @page{size:A4 portrait;margin:13mm 12mm 14mm}
  *{box-sizing:border-box}
  body{margin:0;color:#111;background:#eef1f5;font-family:Arial,Helvetica,sans-serif}
  .print-controls{position:sticky;top:0;z-index:5;display:flex;justify-content:center;gap:10px;padding:12px;background:#0b1728;box-shadow:0 3px 14px rgba(0,0,0,.2)}
  .print-controls button{border:0;border-radius:9px;padding:10px 16px;font:700 14px Arial;cursor:pointer}
  .print-btn{background:#2563eb;color:#fff}.close-btn{background:#fff;color:#111}
  .sheet{width:210mm;min-height:297mm;margin:18px auto;background:#fff;padding:13mm 12mm 14mm;box-shadow:0 12px 40px rgba(0,0,0,.18)}
  .document-head{display:grid;grid-template-columns:43mm 1fr;gap:10mm;align-items:center;border-bottom:2px solid #111;padding-bottom:7mm;margin-bottom:6mm}
  .logo{height:24mm;display:flex;align-items:center}.logo img{max-width:42mm;max-height:23mm;object-fit:contain}
  h1{margin:0;font-size:19pt;line-height:1.15;text-transform:uppercase;letter-spacing:.2px}
  .purpose{margin-top:3mm;font-size:10pt;line-height:1.35}
  .meta{display:flex;justify-content:space-between;gap:6mm;flex-wrap:wrap;margin:0 0 5mm;font-size:9.5pt}.meta strong{font-weight:700}
  table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:9pt}
  thead{display:table-header-group}
  tr{break-inside:avoid;page-break-inside:avoid}
  th,td{border:1px solid #222;padding:2.2mm 2mm;vertical-align:middle}
  th{background:#e9edf2;text-align:center;font-size:8.5pt;text-transform:uppercase;letter-spacing:.15px}
  th:nth-child(1){width:9mm}th:nth-child(2){width:51mm}th:nth-child(3){width:70mm}th:nth-child(4){width:auto}
  td.number{text-align:center}.person-name{font-weight:700}.person-unit{font-size:8.4pt;line-height:1.25}.person-unit span{font-weight:400;color:#333}.signature{height:12mm}
  .org-section{margin-top:7mm}.org-section:first-of-type{margin-top:0}.section-title{margin:0 0 2.5mm;padding:2.5mm 3mm;background:#111;color:#fff;font-size:11.5pt;line-height:1.25;text-transform:uppercase}
  .unit-row td{background:#dfe6ee;font-weight:700;font-size:8.7pt;padding:2mm 2.2mm}
  .footer-note{margin-top:5mm;font-size:8pt;color:#555;display:flex;justify-content:space-between;gap:8mm}
  @media print{body{background:#fff}.print-controls{display:none}.sheet{width:auto;min-height:auto;margin:0;padding:0;box-shadow:none}.document-head{margin-top:0}.page-break{break-before:page;page-break-before:always}}
  @media screen and (max-width:900px){.sheet{width:calc(100% - 20px);min-height:0;margin:10px;padding:20px}.document-head{grid-template-columns:1fr}.logo{height:auto}.meta{flex-direction:column;gap:4px}table{font-size:8px}th,td{padding:5px}.signature{height:34px}.section-title{font-size:12px}}
</style>
</head>
<body>
<div class="print-controls">
  <button class="print-btn" onclick="window.print()">Drukuj / zapisz jako PDF</button>
  <button class="close-btn" onclick="window.close()">Zamknij</button>
</div>
<main class="sheet">
  <header class="document-head">
    <div class="logo">${logo}</div>
    <div>
      <h1>${esc(heading)}</h1>
      ${purpose ? `<div class="purpose"><strong>Temat / cel:</strong> ${esc(purpose)}</div>` : ""}
    </div>
  </header>
  <div class="meta">
    <div><strong>Zakres:</strong> ${esc(signListScopeLabel(scope))}</div>
    <div><strong>Układ:</strong> ${esc(layoutLabel)}</div>
    <div><strong>Liczba osób:</strong> ${list.length}</div>
    ${date ? `<div><strong>Data:</strong> ${esc(date)}</div>` : ""}
  </div>
  ${content}
  <div class="footer-note"><span>Wojewódzki Urząd Pracy w Katowicach</span><span>Lista wygenerowana w aplikacji WUP Kontakty</span></div>
</main>
</body>
</html>`);
  printWindow.document.close();
  closeSignListModal();
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
  $("openSignList").addEventListener("click", openSignListModal);
  $("closeSignList").addEventListener("click", closeSignListModal);
  $("cancelSignList").addEventListener("click", closeSignListModal);
  $("signListForm").addEventListener("submit", generateSignList);
  $("signListScope").addEventListener("change", updateSignListScopeNote);
  $("signListModal").addEventListener("click", event => { if (event.target === $("signListModal")) closeSignListModal(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !$("signListModal").hidden) closeSignListModal(); });
  $("collapseTree").addEventListener("click", () => document.querySelectorAll("#orgTree details").forEach((d, i) => d.open = i === 0));
  $("expandTree").addEventListener("click", () => document.querySelectorAll("#orgTree details").forEach((d, i) => { if (i < 8) d.open = true; }));
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  setTimeout(() => $("passwordInput").focus(), 150);
}

document.addEventListener("DOMContentLoaded", init);
