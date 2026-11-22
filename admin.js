(() => {
  "use strict";
  const $ = selector => document.querySelector(selector);
  const loginPanel = $("#loginPanel"), dashboard = $("#dashboard"), loginStatus = $("#loginStatus"), dashboardStatus = $("#dashboardStatus");
  let products = [], announcements = [], selectedProduct = "", selectedAnnouncement = "", toastTimer;

  async function api(path, options = {}) {
    const response = await fetch(path, { credentials: "same-origin", ...options, headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
    return data;
  }
  function message(node, text, isError = false) { node.textContent = text; node.classList.toggle("error", isError); }
  function toast(text) {
    const node = $("#toast"); node.textContent = text; node.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove("show"), 2600);
  }
  const SETUP = { database: "Base de données D1 liée au Worker (nom de la liaison : DB)", migrations: "Migrations appliquées (0001, 0002 et 0003)", adminUsername: "Secret ADMIN_USERNAME", adminPasswordHash: "Secret ADMIN_PASSWORD_HASH", sessionSecret: "Secret ADMIN_SESSION_SECRET (32 caractères minimum)" };
  async function checkSetup() {
    const box = $("#setupBox"), list = $("#setupList");
    try {
      const res = await fetch("/api/health", { credentials: "same-origin" });
      const data = await res.json();
      list.replaceChildren();
      if (data.status === "ok") { box.hidden = true; return; }
      Object.entries(data.checks || {}).forEach(([key, ok]) => { const li = document.createElement("li"); li.textContent = (ok ? "✓ " : "✗ ") + (SETUP[key] || key); li.className = ok ? "ok" : "ko"; list.append(li); });
      box.hidden = false;
    } catch {
      list.replaceChildren(); const li = document.createElement("li"); li.className = "ko"; li.textContent = "✗ API introuvable (404) ou indisponible : le Worker complet doit être publié avec son routage /api/*, la base D1 et les secrets. Pour ce projet : wrangler deploy --config wrangler.worker.toml. Un simple téléversement des fichiers statiques n’active pas l’API."; list.append(li); box.hidden = false;
    }
  }
  function showLogin(text = "") {
    checkSetup();
    loginPanel.hidden = false; dashboard.hidden = true; $("#logoutButton").hidden = true;
    message(loginStatus, text, Boolean(text));
  }
  async function showDashboard() {
    loginPanel.hidden = true; dashboard.hidden = false; $("#logoutButton").hidden = false;
    await Promise.all([loadStats(), loadVisitors(), loadProducts(), loadAnnouncements(), loadSettings()]);
  }
  function listInto(sel, rows, key, unit) {
    const ol = $(sel); ol.replaceChildren();
    if (!rows.length) { const li = document.createElement("li"); li.textContent = "Pas encore de données."; ol.append(li); return; }
    rows.forEach(r => { const li = document.createElement("li"), em = document.createElement("em"); li.textContent = r[key] || "Accès direct"; em.textContent = r[unit] + (unit === "views" ? " vues" : " visites"); li.append(em); ol.append(li); });
  }
  function drawTrend(days) {
    const host = $("#trend"), W = 640, H = 150, P = 24, max = Math.max(1, ...days.map(d => d.views)), step = (W - 2 * P) / days.length, NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg"); svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    days.forEach((d, i) => {
      const h = Math.round((d.views / max) * (H - 2 * P)), r = document.createElementNS(NS, "rect");
      r.setAttribute("x", P + i * step + 3); r.setAttribute("y", H - P - h); r.setAttribute("width", Math.max(4, step - 6)); r.setAttribute("height", Math.max(h, 2)); r.setAttribute("rx", 3); r.setAttribute("fill", "#52d998"); r.setAttribute("opacity", d.views ? ".9" : ".25");
      const t = document.createElementNS(NS, "title"); t.textContent = `${d.day} : ${d.views} vues, ${d.visitors} visiteurs`; r.append(t); svg.append(r);
      if (i % 3 === 0 || i === days.length - 1) { const x = document.createElementNS(NS, "text"); x.setAttribute("x", P + i * step + step / 2); x.setAttribute("y", H - 6); x.setAttribute("text-anchor", "middle"); x.textContent = d.day.slice(5).split("-").reverse().join("/"); svg.append(x); }
    });
    host.replaceChildren(svg);
  }
  async function loadStats() {
    try {
      const s = await api("/api/admin/stats"), k = $("#kpis"); k.replaceChildren();
      [["Visiteurs aujourd’hui", s.visitors.today], ["Visiteurs (7 jours)", s.visitors.week], ["Pages vues (30 jours)", s.views.month], ["Visiteurs au total", s.visitors.total]].forEach(([label, value]) => {
        const d = document.createElement("div"), b = document.createElement("b"), sp = document.createElement("span"); d.className = "kpi"; b.textContent = Number(value).toLocaleString("fr-FR"); sp.textContent = label; d.append(b, sp); k.append(d);
      });
      drawTrend(s.days || []); listInto("#topPages", s.pages || [], "path", "views"); listInto("#topRefs", s.referrers || [], "domain", "visits");
    } catch (error) { message(dashboardStatus, error.message, true); }
  }
  async function loadVisitors() {
    const body = $("#visitorsBody"), empty = $("#visitorsEmpty");
    try {
      const data = await api("/api/admin/visitors");
      body.replaceChildren();
      for (const visitor of data.visitors || []) {
        const row = document.createElement("tr");
        const values = [visitor.visitorId ? visitor.visitorId.slice(0, 8) : "—", formatDate(visitor.firstSeen), formatDate(visitor.lastSeen), String(visitor.viewCount || 0), visitor.lastPage || "/", visitor.referrerDomain || "Accès direct"];
        values.forEach((value, i) => { const cell = document.createElement("td"); cell.textContent = value; if (i === 0) cell.className = "visitor-key"; row.append(cell); });
        body.append(row);
      }
      empty.hidden = (data.visitors || []).length > 0;
    } catch (error) { message(dashboardStatus, error.message, true); }
  }
  function formatDate(timestamp) {
    if (!timestamp) return "—";
    const value = new Date(Number(timestamp) * 1000);
    return Number.isNaN(value.getTime()) ? "—" : new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(value);
  }
  async function loadProducts() {
    const data = await api("/api/admin/products"); products = data.products || [];
    const select = $("#productSelect"), previous = selectedProduct;
    select.replaceChildren(new Option("Choisir un produit", ""));
    products.forEach(product => select.add(new Option(`${product.active ? "●" : "○"} ${product.name}`, product.id)));
    if (previous && products.some(product => product.id === previous)) select.value = previous;
    selectedProduct = select.value;
    if (selectedProduct) fillProduct(products.find(product => product.id === selectedProduct)); else clearProduct();
  }
  function fillProduct(product) {
    if (!product) return clearProduct();
    const form = $("#productForm");
    for (const key of ["id", "name", "placement", "category", "description", "price", "oldPrice", "currency", "externalUrl"]) form.elements[key].value = product[key] ?? "";
    form.elements.featured.checked = Boolean(product.featured); form.elements.active.checked = Boolean(product.active);
    $("#deleteProduct").disabled = false;
  }
  function clearProduct() {
    const form = $("#productForm"); form.reset(); form.elements.id.value = ""; form.elements.active.checked = true;
    selectedProduct = ""; $("#deleteProduct").disabled = true;
  }
  function renderAnnouncements() {
    const list = $("#announcementList"); list.replaceChildren();
    announcements.forEach(item => {
      const row = document.createElement("li"), label = document.createElement("span"), edit = document.createElement("button");
      label.textContent = `${item.active ? "●" : "○"} ${item.title}`; edit.type = "button"; edit.textContent = "Modifier"; edit.addEventListener("click", () => fillAnnouncement(item));
      row.append(label, edit); list.append(row);
    });
  }
  async function loadAnnouncements() { const data = await api("/api/admin/announcements"); announcements = data.announcements || []; renderAnnouncements(); }
  function fillAnnouncement(item) {
    const form = $("#announcementForm"); selectedAnnouncement = item?.id || "";
    if (!item) { form.reset(); form.elements.id.value = ""; form.elements.active.checked = true; $("#deleteAnnouncement").disabled = true; return; }
    for (const key of ["id", "title", "message", "externalUrl"]) form.elements[key].value = item[key] ?? "";
    form.elements.active.checked = Boolean(item.active); $("#deleteAnnouncement").disabled = false;
  }
  async function loadSettings() {
    const data = await api("/api/admin/settings"); $("#backgroundForm").elements.backgroundUrl.value = data.backgroundUrl || ""; setPreview(data.backgroundUrl || "");
  }
  function setPreview(value) {
    const image = $("#backgroundPreview"), fallback = $("#previewFallback");
    fallback.hidden = true; image.hidden = false;
    image.onload = () => { fallback.hidden = true; image.hidden = false; };
    image.onerror = () => { image.hidden = true; fallback.hidden = false; };
    image.src = value;
  }

  $("#loginForm").addEventListener("submit", async event => {
    event.preventDefault(); message(loginStatus, "Connexion en cours…");
    const form = event.currentTarget;
    try { await api("/api/admin/login", { method: "POST", body: JSON.stringify({ username: form.elements.username.value, password: form.elements.password.value }) }); form.reset(); await showDashboard(); }
    catch (error) { message(loginStatus, error.message, true); }
  });
  $("#logoutButton").addEventListener("click", async () => { try { await api("/api/admin/logout", { method: "POST", body: "{}" }); } catch {} showLogin("Session terminée."); });
  $("#productSelect").addEventListener("change", event => { selectedProduct = event.target.value; fillProduct(products.find(item => item.id === selectedProduct)); });
  $("#newProduct").addEventListener("click", () => { $("#productSelect").value = ""; clearProduct(); $("#productForm").elements.name.focus(); });
  $("#productForm").addEventListener("submit", async event => {
    event.preventDefault(); const form = event.currentTarget;
    const body = { id: form.elements.id.value || undefined, name: form.elements.name.value, placement: form.elements.placement.value, category: form.elements.category.value, description: form.elements.description.value, price: form.elements.price.value, oldPrice: form.elements.oldPrice.value || null, currency: form.elements.currency.value, externalUrl: form.elements.externalUrl.value, featured: form.elements.featured.checked, active: form.elements.active.checked };
    try { const result = await api("/api/admin/products", { method: "POST", body: JSON.stringify(body) }); selectedProduct = result.id; await loadProducts(); toast("Produit enregistré."); }
    catch (error) { message(dashboardStatus, error.message, true); }
  });
  $("#deleteProduct").addEventListener("click", async () => {
    if (!selectedProduct || !confirm("Supprimer définitivement ce produit ?")) return;
    try { await api("/api/admin/products", { method: "DELETE", body: JSON.stringify({ id: selectedProduct }) }); selectedProduct = ""; await loadProducts(); toast("Produit supprimé."); }
    catch (error) { message(dashboardStatus, error.message, true); }
  });
  $("#newAnnouncement").addEventListener("click", () => { fillAnnouncement(null); $("#announcementForm").elements.title.focus(); });
  $("#announcementForm").addEventListener("submit", async event => {
    event.preventDefault(); const form = event.currentTarget;
    const body = { id: form.elements.id.value || undefined, title: form.elements.title.value, message: form.elements.message.value, externalUrl: form.elements.externalUrl.value, active: form.elements.active.checked };
    try { await api("/api/admin/announcements", { method: "POST", body: JSON.stringify(body) }); fillAnnouncement(null); await loadAnnouncements(); toast("Annonce enregistrée."); }
    catch (error) { message(dashboardStatus, error.message, true); }
  });
  $("#deleteAnnouncement").addEventListener("click", async () => {
    if (!selectedAnnouncement || !confirm("Supprimer définitivement cette annonce ?")) return;
    try { await api("/api/admin/announcements", { method: "DELETE", body: JSON.stringify({ id: selectedAnnouncement }) }); selectedAnnouncement = ""; fillAnnouncement(null); await loadAnnouncements(); toast("Annonce supprimée."); }
    catch (error) { message(dashboardStatus, error.message, true); }
  });
  $("#backgroundForm").elements.backgroundUrl.addEventListener("input", event => { if (event.target.value.length < 2048) setPreview(event.target.value); });
  $("#backgroundForm").addEventListener("submit", async event => {
    event.preventDefault();
    try { const result = await api("/api/admin/settings", { method: "POST", body: JSON.stringify({ backgroundUrl: event.currentTarget.elements.backgroundUrl.value }) }); setPreview(result.backgroundUrl); toast("Photo d’arrière-plan enregistrée."); }
    catch (error) { message(dashboardStatus, error.message, true); }
  });
  $("#refreshStats").addEventListener("click", loadStats);
  $("#backgroundFile").addEventListener("change", async event => {
    const file = event.target.files[0]; event.target.value = ""; if (!file) return;
    try {
      message(dashboardStatus, "Préparation de l’image…");
      const bmp = await createImageBitmap(file), scale = Math.min(1, 1920 / Math.max(bmp.width, bmp.height)), canvas = document.createElement("canvas");
      canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale); canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
      let blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", .82));
      if (blob && blob.size > 1100000) blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", .6));
      if (!blob || blob.size > 1100000) throw new Error("Image trop lourde, choisissez-en une plus petite.");
      const up = await fetch("/api/admin/upload", { method: "POST", credentials: "same-origin", headers: { "content-type": "image/jpeg" }, body: blob }), data = await up.json().catch(() => ({}));
      if (!up.ok) throw new Error(data.error || "Envoi impossible.");
      const saved = await api("/api/admin/settings", { method: "POST", body: JSON.stringify({ backgroundUrl: data.url }) });
      $("#backgroundForm").elements.backgroundUrl.value = saved.backgroundUrl; setPreview(saved.backgroundUrl); message(dashboardStatus, ""); toast("Photo importée et appliquée.");
    } catch (error) { message(dashboardStatus, error.message || "Image illisible.", true); }
  });
  $("#refreshVisitors").addEventListener("click", loadVisitors);
  api("/api/admin/products").then(async () => showDashboard()).catch(error => {
    if (/Connexion administrateur/.test(error.message)) return showLogin();
    if (/403|Origine/.test(error.message)) return showLogin();
    showLogin(error.message);
  });
})();
