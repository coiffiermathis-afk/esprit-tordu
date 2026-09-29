(function () {
  "use strict";
  // ---------- constantes ----------
  const COLORS = ["#F2482C", "#3558F0", "#138F78", "#FFC23D", "#FF6FB5", "#8A5CFF", "#FF9A1F", "#5CC93B", "#1EC8E6", "#A2653E", "#7A8199", "#2D3A8C"];
  const LIGHT = new Set([3, 7, 8]); // couleurs claires : initiale en encre foncée
  const MODES = {
    classique: { label: "🎭 Classique", d: "Des phrases à double sens" },
    absurde: { label: "🤪 Réponses les plus absurdes", d: "Plus c'est tordu, mieux c'est" },
    rapide: { label: "⚡ Rapide", d: "Votes et résultats express" },
  };
  const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
  // Personnages intégrés au jeu : un emoji penché sur un fond coloré rayé.
  const CHARS = [
    ["🦊", "#FF9A1F"], ["🐸", "#5CC93B"], ["🐙", "#FF6FB5"], ["🦄", "#8A5CFF"], ["🐷", "#FFB3C7"], ["🐵", "#A2653E"],
    ["🐔", "#FFC23D"], ["🦖", "#138F78"], ["🐼", "#7A8199"], ["🐨", "#1EC8E6"], ["🦁", "#F2482C"], ["🐯", "#FF9A1F"],
    ["🐰", "#3558F0"], ["🐻", "#A2653E"], ["🐮", "#5CC93B"], ["🐧", "#1EC8E6"], ["🦉", "#2D3A8C"], ["🦩", "#2D3A8C"],
    ["👽", "#138F78"], ["🤡", "#FFC23D"], ["👻", "#8A5CFF"], ["🤖", "#3558F0"], ["🎃", "#2D3A8C"], ["🌚", "#F2482C"],
    ["💀", "#7A8199"], ["🥸", "#FF9A1F"], ["😈", "#8A5CFF"], ["🤠", "#FFC23D"], ["🍕", "#138F78"], ["🌶️", "#FFC23D"],
    ["🍆", "#FFC23D"], ["🍑", "#3558F0"], ["🥑", "#F2482C"], ["🍩", "#1EC8E6"], ["🌭", "#5CC93B"],
  ];
  const tilt = (i) => ((i * 37) % 23) - 11;
  // Pseudos au hasard (bouton 🎲 à côté du champ pseudo), 16 caractères maximum.
  const NICKS = ["Chaud Lapin","Petite Coquine","Gros Coquin","Pervers Pépère","Sexy Raclette","Tonton Gênant","Tata Sulfureuse","Mr Double Sens","Miss Allusion","Le Baron Coquin","Duchesse Olé Olé","Cap'tain Tripote","Bébé Nutella","Sale Gosse","Beau Gosse Raté","Moule à Gaufres","Poule Mouillée","Kiki la Coquine","Madame Sans-Gêne","Monsieur Pas Net","L'Aubergine","La Pêche Juteuse","Banane Sauvage","Saucisse Fumée","Tigre du Canapé","Mamie Twerk","Papy Débauche","Gros Nounours","Coquine Masquée","Le Grand Frisson","Chouchou Chaud","Dieu du Slow","Roi du Malaise","Reine du Malaise","Mains Baladeuses","Œil de Velours","Lèvres Pulpeuses","Bisou Baveux","Crème Fouettée","Nuisette Rose","Caleçon Léopard","Slip Kangourou","Moustache Sexy","Choco Coquin","Popotin d'Or","Gigolo Paresseux","Fessier Royal","Brioche Dorée","Sucre d'Orge","Petit Canaillou"];

  // ---------- outils ----------
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clean = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
  const reduced = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } };
  function sget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function sset(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }
  function randomSecret() {
    const a = new Uint8Array(18);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => (a[i] = Math.random() * 256));
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  let PID = sget("et_secret");
  if (!PID || PID.length < 24) { PID = randomSecret(); sset("et_secret", PID); }

  // ---------- état ----------
  const urlCode = (new URLSearchParams(location.search).get("code") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  const savedPhoto = sget("et_photo");
  const S = {
    view: urlCode ? "join" : "home",
    err: "",
    name: clean(sget("et_name") || "", 16),
    photo: savedPhoto && PHOTO_RE.test(savedPhoto) ? savedPhoto : null,
    charIdx: +(sget("et_char") ?? -1),
    code: null,
    prefill: urlCode,
    G: null,
    deadline: 0,
    pickJ: null,
    pickS: null,
    busy: false,
    cfg: { rounds: 5, max: 8, time: 30, mode: "classique" },
  };
  const AV = {}; // photos des joueurs de la partie : pub -> data URL
  if (urlCode) history.replaceState(null, "", location.pathname);

  // ---------- connexion ----------
  const socket = io({ transports: ["websocket", "polling"] });
  socket.on("connect", () => {
    $("#offline").hidden = true;
    if (S.code && S.view === "game") {
      socket.emit("join", { name: S.name, pid: PID, code: S.code, photo: S.photo }, (res) => {
        if (!res || !res.ok) { S.code = null; S.G = null; S.view = "home"; toast((res && res.err) || "La partie n'existe plus."); renderScreen(true); }
      });
    }
  });
  socket.on("disconnect", () => { if (S.code) $("#offline").hidden = false; });
  socket.on("state", (G) => {
    S.G = G;
    S.deadline = Date.now() + (G.left || 0);
    if (G.ph !== "vote") { S.pickJ = null; S.pickS = null; }
    if (S.view === "connecting") S.view = "game";
    renderScreen(); updateDyn();
  });
  socket.on("avatars", (msg) => {
    if (!msg || typeof msg.m !== "object") return;
    if (msg.full) for (const k in AV) delete AV[k];
    for (const k in msg.m) {
      const v = msg.m[k];
      if (typeof v === "string" && PHOTO_RE.test(v)) AV[k] = v; else delete AV[k];
    }
    paintAvatars();
  });
  socket.on("kicked", () => { S.code = null; S.G = null; S.view = "kicked"; renderScreen(true); });
  socket.on("replaced", () => { S.code = null; S.G = null; S.view = "home"; toast("Tu as ouvert la partie dans un autre onglet."); renderScreen(true); });

  function send(ev, data) {
    return new Promise((resolve) => {
      if (!socket.connected) { toast("Pas de connexion au serveur, réessaie dans un instant."); return resolve({ ok: false }); }
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; resolve({ ok: false, err: "Le serveur ne répond pas." }); } }, 10000);
      socket.emit(ev, data || {}, (res) => { if (done) return; done = true; clearTimeout(t); resolve(res || { ok: false }); });
    });
  }
  let toastT = 0;
  function toast(msg) { const el = $("#toast"); el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 3200); }

  // ---------- photo de profil ----------
  // Recadre au carré (un peu vers le haut, pour garder le visage) et réduit à 192 px.
  async function fileToAvatar(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const W = img.naturalWidth, H = img.naturalHeight;
      if (!W || !H) throw new Error("vide");
      const k = Math.min(W, H), sx = (W - k) / 2, sy = H > W ? (H - k) * 0.3 : (H - k) / 2;
      const c = document.createElement("canvas"); c.width = c.height = 192;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 192, 192);
      ctx.drawImage(img, sx, sy, k, k, 0, 0, 192, 192);
      let q = 0.82, out = c.toDataURL("image/jpeg", q);
      while (out.length > 45000 && q > 0.35) { q -= 0.12; out = c.toDataURL("image/jpeg", q); }
      if (!PHOTO_RE.test(out) || out.length > 58000) throw new Error("trop lourde");
      return out;
    } finally { URL.revokeObjectURL(url); }
  }
  function charAvatar(i) {
    const [emo, bg] = CHARS[i];
    const c = document.createElement("canvas"); c.width = c.height = 192;
    const ctx = c.getContext("2d");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 192, 192);
    ctx.save(); ctx.translate(96, 96); ctx.rotate(-Math.PI / 5); ctx.fillStyle = "rgba(255,255,255,.18)";
    for (let x = -200; x < 200; x += 36) ctx.fillRect(x, -200, 16, 400);
    ctx.restore();
    ctx.save(); ctx.translate(96, 104); ctx.rotate((tilt(i) * Math.PI) / 180);
    ctx.font = '118px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(emo, 0, 0); ctx.restore();
    return c.toDataURL("image/jpeg", 0.86);
  }
  function pickChar(i) {
    S.charIdx = i; sset("et_char", String(i));
    setMyPhoto(charAvatar(i));
  }
  function randomChar() {
    let i; do { i = Math.floor(Math.random() * CHARS.length); } while (CHARS.length > 1 && i === S.charIdx);
    pickChar(i);
  }
  // Le serveur limite à un changement toutes les 2 s : on regroupe les changements rapides.
  let photoSentAt = 0, photoTimer = 0;
  function sendPhotoSoon() {
    if (!S.code) return;
    clearTimeout(photoTimer);
    const wait = Math.max(0, 2100 - (Date.now() - photoSentAt));
    photoTimer = setTimeout(async () => {
      photoSentAt = Date.now();
      const r = await send("photo", { photo: S.photo });
      if (!r.ok && r.err) toast(r.err);
    }, wait);
  }
  async function setMyPhoto(photo) {
    S.photo = photo; sset("et_photo", photo);
    refreshMe();
    sendPhotoSoon();
  }
  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    closeSheet();
    try { S.charIdx = -1; await setMyPhoto(await fileToAvatar(f)); }
    catch (err) { toast("Impossible de lire cette photo, essaie une autre."); }
  };
  $("#photoIn").addEventListener("change", onFile);
  $("#selfieIn").addEventListener("change", onFile);
  function refreshMe() {
    paintAvatars();
    document.querySelectorAll(".avrm").forEach((b) => (b.hidden = !S.photo));
    document.querySelectorAll(".gchar").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.i === S.charIdx && !!S.photo)));
  }

  // Bulle d'avatar : la photo si elle existe, sinon l'initiale sur la couleur du joueur.
  function av(p, size, extra) {
    const c = p ? p.c % 12 : 10;
    const init = p ? (p.b ? "🤖" : (Array.from(p.n || "?")[0] || "?").toUpperCase()) : "?";
    return '<span class="av ' + (size || "m") + (LIGHT.has(c) ? " lt" : "") + (extra ? " " + extra : "") + '" style="--c:' + COLORS[c] + '" data-av="' + esc(p ? p.i : "") + '" data-init="' + esc(init) + '" aria-hidden="true"></span>';
  }
  function meAv(size) {
    const c = 0, init = (Array.from(S.name || "?")[0] || "?").toUpperCase();
    return '<span class="av ' + size + '" style="--c:' + COLORS[c] + '" data-av="@me" data-init="' + esc(init) + '" aria-hidden="true"></span>';
  }
  function paintAvatars() {
    document.querySelectorAll("[data-av]").forEach((el) => {
      const k = el.dataset.av;
      const src = k === "@me" ? S.photo : AV[k];
      const key = src ? "p:" + src.length + src.slice(-24) : "i:" + el.dataset.init;
      if (el._k === key) return;
      el._k = key;
      if (src) { el.textContent = ""; const im = document.createElement("img"); im.alt = ""; im.src = src; el.appendChild(im); el.classList.add("ph"); }
      else { el.textContent = el.dataset.init; el.classList.remove("ph"); }
    });
  }
  // Selfie et Galerie sont des <label> reliés aux champs fichier : c'est la façon la plus fiable
  // d'ouvrir l'appareil photo ou la galerie sur tous les téléphones (Safari, Chrome, navigateurs intégrés).
  const IN_APP = /Instagram|FBAN|FBAV|FB_IAB|Snapchat|TikTok|musical_ly|Line\/|LinkedInApp|Twitter/i.test(navigator.userAgent || "");
  function avOptions() {
    return '<div class="avopts"><label for="selfieIn" class="btn sm" role="button" tabindex="0">📸 Selfie</label><label for="photoIn" class="btn sm" role="button" tabindex="0">🖼️ Galerie</label><button type="button" class="btn sm mustard" data-act="randomAv">🎲 Au hasard</button></div>' +
      (IN_APP ? '<p class="inapp">Tu es dans le navigateur d\'une appli (Instagram, Snapchat…). Si la galerie ne s\'ouvre pas, touche <b>⋯</b> puis <b>Ouvrir dans le navigateur</b>, ou prends un personnage 🎲.</p>' : "");
  }
  function photoPicker() {
    return '<div class="avpick"><button type="button" class="avbtn" data-act="openSheet" aria-label="Choisir ma photo">' + meAv("xl") + '<span class="cam" aria-hidden="true">📷</span></button>' +
      '<div class="avtxt"><span class="flabel">Ta photo</span>' + avOptions() +
      '<div class="row"><button type="button" class="link" data-act="openSheet">Choisir un personnage</button><button type="button" class="link avrm" data-act="rmPhoto"' + (S.photo ? "" : " hidden") + '>Retirer</button></div></div></div>';
  }
  function charGrid() {
    return '<div class="gal">' + CHARS.map(([e, bg], i) => '<button type="button" class="gchar" data-act="pickChar" data-i="' + i + '" style="--c:' + bg + ";--t:" + tilt(i) + 'deg" aria-pressed="' + (i === S.charIdx && !!S.photo) + '" aria-label="Personnage ' + (i + 1) + '"><span>' + e + "</span></button>").join("") + "</div>";
  }
  function openSheet() {
    closeSheet();
    const el = document.createElement("div");
    el.className = "sheet"; el.id = "sheet";
    el.innerHTML = '<div class="sheet-bg" data-act="closeSheet"></div><div class="sheet-panel" role="dialog" aria-modal="true" aria-label="Choisir ma photo">' +
      '<div class="row between"><span class="sheet-title">Ta photo</span><button type="button" class="kick" data-act="closeSheet" aria-label="Fermer">✕</button></div>' +
      '<div class="sheet-me">' + meAv("xl") + avOptions() + "</div>" +
      '<span class="eyebrow">Ou choisis un personnage</span>' + charGrid() +
      '<button type="button" class="link avrm" data-act="rmPhoto"' + (S.photo ? "" : " hidden") + ">Retirer ma photo</button></div>";
    document.body.appendChild(el);
    paintAvatars();
  }
  function closeSheet() { const el = $("#sheet"); if (el) el.remove(); }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSheet();
    if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("label[for][role=button]")) { e.preventDefault(); e.target.click(); }
  });

  // ---------- confettis ----------
  function confetti() {
    if (reduced()) return;
    const cv = document.createElement("canvas");
    cv.className = "confetti"; document.body.appendChild(cv);
    const ctx = cv.getContext("2d"), dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = (cv.width = innerWidth * dpr), H = (cv.height = innerHeight * dpr);
    const cols = ["#F2482C", "#3558F0", "#138F78", "#FFC23D", "#FF6FB5", "#8A5CFF"];
    const parts = Array.from({ length: 140 }, () => ({ x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.35, vx: (Math.random() - 0.5) * 16 * dpr, vy: (-Math.random() * 18 - 6) * dpr, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4, w: (6 + Math.random() * 6) * dpr, h: (8 + Math.random() * 10) * dpr, c: cols[(Math.random() * cols.length) | 0] }));
    const t0 = performance.now();
    (function frame(t) {
      const el = t - t0;
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.vy += 0.45 * dpr; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - el / 3600); ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      }
      if (el < 3600) requestAnimationFrame(frame); else cv.remove();
    })(t0);
  }

  // ---------- actions ----------
  async function createGame() {
    const n = clean($("#nm").value, 16);
    if (!n) { S.err = "Choisis un pseudo pour jouer."; return renderScreen(true); }
    const fd = new FormData($("#cform"));
    S.cfg = { rounds: +fd.get("rounds") || 5, max: S.cfg.max, time: +fd.get("time") || 30, mode: fd.get("mode") || "classique" };
    S.name = n; sset("et_name", n); S.err = ""; S.G = null;
    const res = await send("create", { name: n, pid: PID, cfg: S.cfg, photo: S.photo });
    if (!res.ok) { S.err = res.err || "Impossible de créer la partie."; return renderScreen(true); }
    S.code = res.code; S.view = S.G && S.G.code === res.code ? "game" : "connecting"; renderScreen(true);
  }
  async function joinGame() {
    const n = clean($("#nm").value, 16);
    const code = clean($("#cd").value, 5).toUpperCase();
    if (!n) { S.err = "Choisis un pseudo pour jouer."; return renderScreen(true); }
    if (!/^[A-Z0-9]{5}$/.test(code)) { S.err = "Le code fait 5 caractères, par exemple K7P4X."; S.prefill = code; return renderScreen(true); }
    S.name = n; sset("et_name", n); S.err = ""; S.prefill = code; S.G = null;
    const res = await send("join", { name: n, pid: PID, code, photo: S.photo });
    if (!res.ok) { S.err = res.err || "Impossible de rejoindre la partie."; return renderScreen(true); }
    S.code = res.code; S.view = S.G && S.G.code === res.code ? "game" : "connecting"; renderScreen(true);
  }
  async function leaveGame() {
    if (S.code) await send("leave");
    S.code = null; S.G = null; S.view = "home"; S.err = ""; renderScreen(true);
  }
  const inviteLink = () => location.origin + "/?code=" + S.code;

  const ACT = {
    goCreate() { S.view = "create"; S.err = ""; renderScreen(true); },
    goJoin() { S.view = "join"; S.err = ""; renderScreen(true); },
    home() { leaveGame(); },
    create() { createGame(); },
    join() { joinGame(); },
    pickPhoto() { $("#photoIn").click(); },
    selfie() { $("#selfieIn").click(); },
    randomAv() { randomChar(); },
    randomName() {
      const el = $("#nm"); if (!el) return;
      let n; do { n = NICKS[Math.floor(Math.random() * NICKS.length)]; } while (NICKS.length > 1 && n === el.value);
      el.value = n;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    pickChar(b) { pickChar(+b.dataset.i); setTimeout(closeSheet, 250); },
    openSheet() { openSheet(); },
    closeSheet() { closeSheet(); },
    rmPhoto() { S.charIdx = -1; sset("et_char", null); setMyPhoto(null); },
    maxDec() { S.cfg.max = Math.max(3, S.cfg.max - 1); $("#maxo").value = S.cfg.max; },
    maxInc() { S.cfg.max = Math.min(12, S.cfg.max + 1); $("#maxo").value = S.cfg.max; },
    copy(b) {
      const txt = S.code;
      const ok = () => { b.textContent = "✓ Code copié"; setTimeout(() => (b.textContent = "📋 Copier le code"), 1800); };
      try { navigator.clipboard.writeText(txt).then(ok, () => toast("Code : " + txt)); } catch (e) { toast("Code : " + txt); }
    },
    share() {
      const url = inviteLink();
      const data = { title: "Esprit Tordu", text: "Rejoins ma partie d'Esprit Tordu ! Code : " + S.code, url };
      if (navigator.share) { navigator.share(data).catch(() => {}); return; }
      try { navigator.clipboard.writeText(data.text + " " + url).then(() => toast("Lien d'invitation copié"), () => toast(url)); } catch (e) { toast(url); }
    },
    ready() { send("ready"); },
    addBot() { send("addBot").then((r) => r.err && toast(r.err)); },
    kick(b) { send("kick", { i: b.dataset.i }); },
    launch() { send("start").then((r) => r.err && toast(r.err)); },
    skip() { send("skip"); },
    async submitAns() {
      const el = $("#ans"); if (!el || S.busy) return;
      const t = clean(el.value, 60);
      if (!t) { el.focus(); return; }
      S.busy = true;
      const r = await send("answer", { text: t });
      S.busy = false;
      if (!r.ok && r.err) toast(r.err);
    },
    pickJ(b) { S.pickJ = b.dataset.k; drawCards(); },
    pickS(b) { S.pickS = S.pickS === b.dataset.k ? null : b.dataset.k; drawCards(); },
    async vote() {
      if (!S.pickJ || S.busy) return;
      S.busy = true;
      const r = await send("vote", { j: S.pickJ, s: S.pickS });
      S.busy = false;
      if (!r.ok && r.err) toast(r.err);
    },
    replay() { send("replay"); },
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const f = ACT[b.dataset.act];
    if (f) { e.preventDefault(); f(b); }
  });
  document.addEventListener("submit", (e) => { e.preventDefault(); const a = e.target.dataset.submit; if (a && ACT[a]) ACT[a](); });
  document.addEventListener("input", (e) => {
    if (e.target.id === "ans") { const c = $("#chars"); if (c) c.textContent = e.target.value.length + "/60"; }
    if (e.target.id === "cd") e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (e.target.id === "nm") {
      S.name = clean(e.target.value, 16);
      const m = document.querySelector('[data-av="@me"]');
      if (m) { m.dataset.init = (Array.from(S.name || "?")[0] || "?").toUpperCase(); paintAvatars(); }
    }
  });
  document.addEventListener("keydown", (e) => { if (e.target.id === "ans" && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ACT.submitAns(); } });

  // ---------- rendu ----------
  function logo(small) {
    const words = [["E", "S", "P", "R", "I", "T"], ["T", "O", "R", "D", "U"]];
    const rots = [-7, 5, -3, 8, -5, 4, 6, -8, 3, -6, 9];
    const cols = ["var(--tomato)", "var(--blue)", "var(--teal)", "var(--mustard)"];
    let i = 0;
    return '<h1 class="logo' + (small ? " small" : "") + '" aria-label="Esprit Tordu">' + words.map((w, wi) => '<span class="w" aria-hidden="true">' + w.map((l) => { const k = i++; const c = wi === 1 ? cols[k % 4] : "var(--ink)"; return '<span class="l" style="--rot:' + rots[k % rots.length] + "deg;--i:" + k + ";--c:" + c + '">' + l + "</span>"; }).join("") + "</span>").join("") + "</h1>";
  }
  const label = (t) => '<span class="flabel">' + t + "</span>";
  function seg(name, vals, cur, fmt) {
    return '<div class="seg" role="radiogroup">' + vals.map((v) => { const id = name + "_" + v; return '<input type="radio" name="' + name + '" id="' + id + '" value="' + v + '"' + (String(v) === String(cur) ? " checked" : "") + '><label for="' + id + '">' + fmt(v) + "</label>"; }).join("") + "</div>";
  }

  function vHome() {
    const ex = [["Une enceinte", 0, "A"], ["Un aspirateur", 1, "S"], ["Une fourmi", 2, "L"], ["Une pile", 3, "C"]];
    return logo() +
      '<p class="tag">« Ton cerveau voit-il toujours le mauvais côté des choses ? »</p>' +
      '<div class="stack"><button class="btn big tomato" data-act="goCreate">Créer une partie</button><button class="btn big blue" data-act="goJoin">Rejoindre une partie</button></div>' +
      '<p class="meta">Jeu de soirée · 3–12 joueurs · Parties de 5 à 15 minutes</p>' +
      '<section class="sample" aria-label="Exemple de manche"><span class="eyebrow">Exemple de manche</span><q>Il est petit, mais étonnamment puissant.</q><div class="chips">' +
      ex.map(([t, c, n]) => '<span class="chip"><span class="av s' + (LIGHT.has(c) ? " lt" : "") + '" style="--c:' + COLORS[c] + '" aria-hidden="true">' + n + "</span>" + t + "</span>").join("") + "</div></section>" +
      "<div class=\"steps\"><div><b>1 · Interprète</b>Une phrase ambiguë, chacun écrit ce qu'il y voit.</div><div><b>2 · Vote</b>Réponses dévoilées d'un coup, on vote pour la plus drôle.</div><div><b>3 · Marque</b>+3, +2, +1 et un bonus « coup de génie ».</div></div>";
  }
  function vCreate() {
    const c = S.cfg;
    return '<div class="bar">' + logo(true) + '<button class="link" data-act="home">← Accueil</button></div>' +
      '<form class="card" id="cform" data-submit="create"><h2 class="h2">Créer une partie</h2>' + photoPicker() +
      '<div><label class="f" for="nm">Ton pseudo</label><div class="nmrow"><input class="inp" id="nm" maxlength="16" autocomplete="nickname" placeholder="Alex" value="' + esc(S.name) + '"><button type="button" class="btn sm mustard dice" data-act="randomName" aria-label="Pseudo au hasard" title="Pseudo au hasard">🎲</button></div></div>' +
      "<div>" + label("Nombre de manches") + seg("rounds", [5, 10, 15], c.rounds, (v) => v) + "</div>" +
      "<div>" + label("Joueurs maximum") + '<div class="stepper"><button type="button" class="btn sm" data-act="maxDec" aria-label="Moins de joueurs">−</button><output id="maxo">' + c.max + '</output><button type="button" class="btn sm" data-act="maxInc" aria-label="Plus de joueurs">+</button><span class="summary">de 3 à 12</span></div></div>' +
      "<div>" + label("Temps pour répondre") + seg("time", [15, 30, 60], c.time, (v) => v + " s") + "</div>" +
      "<div>" + label("Mode") + '<div class="seg modes" role="radiogroup">' + Object.keys(MODES).map((k) => '<input type="radio" name="mode" id="mode_' + k + '" value="' + k + '"' + (k === c.mode ? " checked" : "") + '><label for="mode_' + k + '">' + MODES[k].label + "<small>" + MODES[k].d + "</small></label>").join("") + "</div></div>" +
      '<p class="err" role="alert">' + esc(S.err) + '</p><button class="btn big tomato" type="submit">CRÉER LA PARTIE</button></form>';
  }
  function vJoin() {
    return '<div class="bar">' + logo(true) + '<button class="link" data-act="home">← Accueil</button></div>' +
      '<form class="card" data-submit="join"><h2 class="h2">Rejoindre une partie</h2>' + photoPicker() +
      '<div><label class="f" for="nm">Ton pseudo</label><div class="nmrow"><input class="inp" id="nm" maxlength="16" autocomplete="nickname" placeholder="Camille" value="' + esc(S.name) + '"><button type="button" class="btn sm mustard dice" data-act="randomName" aria-label="Pseudo au hasard" title="Pseudo au hasard">🎲</button></div></div>' +
      '<div><label class="f" for="cd">Code de la partie</label><input class="inp code" id="cd" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="K7P4X" value="' + esc(S.prefill) + '"></div>' +
      '<p class="err" role="alert">' + esc(S.err) + '</p><button class="btn big blue" type="submit">REJOINDRE</button></form>';
  }
  const vConnecting = () => '<div class="card center"><p><span class="spin"></span></p><p>Connexion à la partie…</p><button class="link" data-act="home">Annuler</button></div>';
  const vKicked = () => logo(true) + "<div class=\"card center\"><h2 class=\"h2\">Tu as été retiré de la partie</h2><p>Le créateur t'a expulsé du salon.</p><button class=\"btn big blue\" data-act=\"home\">Retour à l'accueil</button></div>";

  const isHost = (G) => G.host === G.me;
  const playerOf = (G, i) => G.pl.find((p) => p.i === i) || null;
  const nameOf = (G, i) => { const x = playerOf(G, i); return x ? x.n : "?"; };
  const remaining = () => Math.max(0, S.deadline - Date.now());

  function topBar(G) {
    const me = playerOf(G, G.me);
    const round = G.ph !== "lobby" && G.ph !== "end" ? '<span class="pill">Manche ' + G.r + "/" + G.cfg.rounds + "</span>" : "";
    return '<div class="bar">' + logo(true) + '<div class="row">' + (me ? av(me, "s") : "") + '<span class="pill">' + esc(G.code) + "</span>" + round + '<button class="link" data-act="home">Quitter</button></div></div>';
  }
  // Photo de la manche (manches image) avec son crédit.
  function photoRound(G, small) {
    if (!G.img || !/^[a-z0-9-]+$/.test(G.img.id)) return "";
    const credit = esc(G.img.by) + " · " + esc(G.img.lic);
    const link = /^https:\/\/commons\.wikimedia\.org\//.test(G.img.page || "") ? '<a href="' + esc(G.img.page) + '" target="_blank" rel="noopener">Wikimedia Commons</a>' : "Wikimedia Commons";
    return '<figure class="pimg' + (small ? " small" : "") + '"><img src="/img/' + G.img.id + '" alt="Photo mystère de la manche"><figcaption>Photo : ' + credit + " · " + link + "</figcaption></figure>";
  }
  const promptCls = (G) => "prompt" + (G.img ? " withimg" : "");
  const timerHTML = () => '<div class="timer" id="timer"><div class="track"><div class="fill"></div></div><span class="sec">–</span></div>';

  function vGame() {
    const G = S.G;
    if (!G) return vConnecting();
    let body;
    if (G.spec) body = '<div class="card"><span class="eyebrow">Spectateur</span><h2 class="h2">Partie en cours</h2><p>Tu rejoindras la prochaine partie de ce salon quand le créateur relancera.</p>' + (G.ph === "write" || G.ph === "vote" ? photoRound(G, true) + '<p class="prompt">« ' + esc(G.prompt) + " »</p>" : "") + rankHTML(G) + "</div>";
    else if (G.ph === "lobby") body = vLobby(G);
    else if (G.ph === "write") body = vWrite(G);
    else if (G.ph === "vote") body = vVote(G);
    else if (G.ph === "res") body = vRes(G);
    else body = vEnd(G);
    return topBar(G) + body;
  }
  function vLobby(G) {
    const c = G.cfg, h = isHost(G);
    return '<section class="card"><div class="codebox"><span class="eyebrow">Code</span><span class="code">' + esc(G.code) + '</span><div class="row" style="justify-content:center"><button class="btn sm" data-act="copy">📋 Copier le code</button><button class="btn sm" data-act="share">🔗 Inviter</button></div></div>' +
      '<p class="summary center">' + c.rounds + " manches · " + c.time + " s pour répondre · " + esc((MODES[c.mode] || MODES.classique).label) + " · " + c.max + " joueurs max</p>" +
      '<div class="seats" id="seats"></div><p class="summary center" id="lobbyhint"></p>' +
      (h ? '<div class="row"><button class="btn sm" data-act="addBot" id="botbtn">+ Ajouter un bot</button><span class="summary">Pratique pour tester seul.</span></div><button class="btn big tomato" data-act="launch" id="launch">LANCER LA PARTIE</button>'
         : '<p class="center wait">En attente du créateur…</p><button class="btn big mustard" data-act="ready" id="ready">PRÊT</button>') + "</section>";
  }
  function progressRow() { return '<div class="prog" id="prog" aria-label="Avancement des joueurs"></div>'; }
  function vWrite(G) {
    const a = G.myAns;
    return '<section class="card">' + timerHTML() + '<span class="eyebrow center">Tour ' + G.r + (G.img ? " · 📸 photo" : "") + "</span>" + photoRound(G) + '<p class="' + promptCls(G) + '">« ' + esc(G.prompt) + " »</p>" +
      (a ? '<div class="locked">Réponse envoyée<b>« ' + esc(a) + ' »</b><span class="summary">On attend les autres…</span></div>'
         : '<form class="stack" data-submit="submitAns"><label class="f" for="ans">Ton interprétation</label><textarea class="inp" id="ans" maxlength="60" placeholder="Écris ton interprétation..."></textarea><div class="row between"><span class="chars" id="chars">0/60</span><button class="btn tomato" type="submit">VALIDER</button></div></form>') +
      progressRow() + '<p class="count" id="count"></p>' + (isHost(G) ? '<button class="link" data-act="skip">Terminer la phase maintenant ⏭</button>' : "") + "</section>";
  }
  const voteWord = (G) => (G.cfg.mode === "absurde" ? "🌀 La plus absurde" : "😂 La plus drôle");
  function vVote(G) {
    const v = G.myVote;
    const nothing = G.an.every((a) => a.mine);
    return '<section class="card">' + timerHTML() + '<span class="eyebrow center">Tour ' + G.r + ' · vote</span>' + photoRound(G, true) + '<p class="' + promptCls(G) + '">« ' + esc(G.prompt) + " »</p>" +
      (v ? "<div class=\"locked\">Vote enregistré ✓<span class=\"summary\" style=\"display:block\">Les auteurs seront dévoilés aux résultats.</span></div><div class=\"acards\">" + G.an.map((a, k) => '<div class="acard"><button class="apick" disabled aria-pressed="' + (a.k === v.j) + '"><span class="dot" style="--c:' + COLORS[k % 12] + '"></span>' + esc(a.t) + (a.k === v.j ? '<span class="mine">ton vote</span>' : a.mine ? '<span class="mine">ta réponse</span>' : "") + "</button></div>").join("") + "</div>"
        : nothing ? '<p class="locked">Rien à voter pour toi cette manche.</p>'
        : '<p class="legend"><b>' + voteWord(G) + "</b> : touche une réponse. ⭐ Coup de génie (facultatif) : +1 pour la réponse la plus étoilée. Tu ne peux pas voter pour ta propre réponse.</p><div class=\"acards\" id=\"cards\"></div><button class=\"btn big tomato\" data-act=\"vote\" id=\"votebtn\" disabled>VOTER</button>") +
      progressRow() + '<p class="count" id="count"></p>' + (isHost(G) ? '<button class="link" data-act="skip">Terminer le vote maintenant ⏭</button>' : "") + "</section>";
  }
  function drawCards() {
    const G = S.G, el = $("#cards");
    if (!G || !el) return;
    el.innerHTML = G.an.map((a, k) => '<div class="acard"><button class="apick" data-act="pickJ" data-k="' + esc(a.k) + '" aria-pressed="' + (S.pickJ === a.k) + '"' + (a.mine ? " disabled" : "") + '><span class="dot" style="--c:' + COLORS[k % 12] + '"></span>' + esc(a.t) + (a.mine ? '<span class="mine">ta réponse</span>' : "") + '</button><button class="star" data-act="pickS" data-k="' + esc(a.k) + '" aria-label="Coup de génie" aria-pressed="' + (S.pickS === a.k) + '"' + (a.mine ? " disabled" : "") + ">⭐</button></div>").join("");
    const b = $("#votebtn"); if (b) b.disabled = !S.pickJ;
  }
  function rankHTML(G, gains) {
    const rows = G.pl.slice().sort((a, b) => (G.sc[b.i] || 0) - (G.sc[a.i] || 0));
    let last = null, rk = 0;
    return '<div><span class="eyebrow">🏆 Classement</span><table class="rank"><tbody>' + rows.map((x, k) => {
      const s = G.sc[x.i] || 0; if (s !== last) { rk = k + 1; last = s; }
      const g = gains && gains[x.i] ? '<span class="gain">+' + gains[x.i] + "</span>" : "";
      return '<tr class="' + (x.i === G.me ? "me" : "") + '"><td>' + rk + '.</td><td class="nm"><span class="who2">' + av(x, "s") + '<span>' + esc(x.n) + (x.i === G.me ? ' <span class="toi">(toi)</span>' : "") + "</span></span></td><td>" + g + s + " pts</td></tr>";
    }).join("") + "</tbody></table></div>";
  }
  function vRes(G) {
    const medals = ["🥇", "🥈", "🥉"];
    const gains = {}; (G.rr || []).forEach((r) => (gains[r.i] = r.p));
    return '<section class="card"><span class="eyebrow center">Tour ' + G.r + ' · résultats</span>' + photoRound(G, true) + '<p class="prompt" style="font-size:1.4rem">« ' + esc(G.prompt) + " »</p>" +
      (G.note ? '<p class="note">' + esc(G.note) + "</p>" : "") +
      '<ul class="rlist">' + (G.rr || []).map((r, k) => {
        const p = playerOf(G, r.i) || { i: r.i, n: "?", c: 10 };
        return '<li class="' + (k === 0 && r.p > 0 ? "top" : "") + '" style="--k:' + k + '">' + av(p, "l") +
          '<span class="rtxt"><span class="ans">' + (r.p > 0 && k < 3 ? medals[k] + " " : "") + esc(r.t) + '</span><span class="who">' + esc(p.n) +
          '<span class="v">· ' + (G.cfg.mode === "absurde" ? "🌀" : "😂") + " " + r.v + (r.s ? " · ⭐ " + r.s : "") + (r.g ? " · coup de génie" : "") + "</span></span></span>" +
          '<span class="pts">+' + r.p + "</span></li>";
      }).join("") + "</ul>" +
      rankHTML(G, gains) + '<div class="row between"><span class="summary" id="nextin"></span>' + (isHost(G) ? '<button class="btn sm" data-act="skip">' + (G.r >= G.cfg.rounds ? "Voir le podium →" : "Manche suivante →") + "</button>" : "") + "</div></section>";
  }
  function vEnd(G) {
    const rows = G.pl.slice().sort((a, b) => (G.sc[b.i] || 0) - (G.sc[a.i] || 0));
    const p = [rows[1], rows[0], rows[2]], cls = ["p2", "p1", "p3"], nums = ["2", "1", "3"], sizes = ["l", "xl", "l"];
    return '<section class="card"><h2 class="h2 center">PARTIE TERMINÉE !</h2><div class="podium">' +
      p.map((x, k) => (x ? '<div class="' + cls[k] + '">' + (k === 1 ? '<span class="crown" aria-hidden="true">👑</span>' : "") + av(x, sizes[k]) + '<span class="pn">' + esc(x.n) + '</span><span class="ps">' + (G.sc[x.i] || 0) + ' pts</span><span class="blk">' + nums[k] + "</span></div>" : "<div></div>")).join("") + "</div>" +
      (rows.length > 3 ? rankHTML(G) : "") +
      ((G.ti || []).length ? '<span class="eyebrow">Titres de la soirée</span><div class="titles">' + G.ti.map((t) => { const x = playerOf(G, t.i) || { i: t.i, n: "?", c: 10 }; return '<div><span class="thead">' + av(x, "m") + '<span class="e">' + t.e + '</span></span><span class="t">' + esc(t.t) + '</span><span class="n">' + esc(x.n) + '</span><span class="d">' + esc(t.d) + "</span></div>"; }).join("") + "</div>" : "") +
      (isHost(G) ? '<button class="btn big tomato" data-act="replay">REJOUER</button>' : '<p class="center summary">Le créateur peut relancer une partie avec le même salon.</p>') +
      '<button class="btn big" data-act="home">NOUVELLE PARTIE</button></section>';
  }

  let screenKey = "";
  function renderScreen(force) {
    const G = S.view === "game" ? S.G : null;
    const key = [S.view, S.err, G ? G.ph : "", G ? G.r : "", G ? G.g : "", G ? G.spec : "", G ? isHost(G) : "", G ? !!G.myAns : "", G ? !!G.myVote : "", G ? G.an.map((a) => a.k).join(",") : ""].join("|");
    if (!force && key === screenKey) return;
    const wasEnd = /\|end\|/.test(screenKey);
    screenKey = key;
    const draft = $("#ans") ? $("#ans").value : "";
    let h;
    if (S.view === "home") h = vHome();
    else if (S.view === "create") h = vCreate();
    else if (S.view === "join") h = vJoin();
    else if (S.view === "connecting") h = vConnecting();
    else if (S.view === "kicked") h = vKicked();
    else h = vGame();
    $("#app").innerHTML = h;
    const ans = $("#ans");
    if (ans) { ans.value = draft; $("#chars").textContent = draft.length + "/60"; }
    drawCards(); updateDyn(); paintAvatars();
    if (G && G.ph === "end" && !G.spec && !wasEnd) confetti();
  }
  function setHTML(el, h) { if (el && el._h !== h) { el._h = h; el.innerHTML = h; return true; } return false; }
  function updateDyn() {
    const G = S.view === "game" ? S.G : null;
    if (!G) return;
    let painted = false;
    const tm = $("#timer");
    if (tm) {
      const rem = remaining(), total = G.total || 1;
      tm.querySelector(".fill").style.width = Math.max(0, Math.min(100, (rem / total) * 100)) + "%";
      tm.querySelector(".sec").textContent = Math.ceil(rem / 1000) + " s";
      tm.classList.toggle("low", rem < 5000);
    }
    const nx = $("#nextin");
    if (nx) nx.textContent = (G.r >= G.cfg.rounds ? "Podium" : "Manche suivante") + " dans " + Math.ceil(remaining() / 1000) + " s";
    const humans = G.pl.filter((p) => !p.b && p.on);
    const cnt = $("#count");
    if (cnt) {
      if (G.ph === "write") {
        const n = humans.filter((p) => p.a).length;
        cnt.textContent = n + "/" + humans.length + " joueur" + (humans.length > 1 ? "s ont" : " a") + " répondu";
      } else if (G.ph === "vote") {
        const n = humans.filter((p) => p.v).length;
        cnt.textContent = n + "/" + humans.length + " vote" + (n > 1 ? "s" : "");
      }
    }
    const prog = $("#prog");
    if (prog) {
      const who = G.pl.filter((p) => p.on);
      painted = setHTML(prog, who.map((p) => {
        const done = G.ph === "write" ? p.a : p.v;
        return '<span class="pchip' + (done ? " done" : "") + '" title="' + esc(p.n) + '">' + av(p, "m") + '<span class="pn2">' + esc(p.n) + "</span>" + (done ? '<span class="tick" aria-label="a fini">✓</span>' : "") + "</span>";
      }).join("")) || painted;
    }
    const seats = $("#seats");
    if (seats) {
      const h = isHost(G);
      const filled = G.pl.map((x) => {
        const isH = x.i === G.host, mine = x.i === G.me;
        const tag = isH ? '<span class="tagx host">Créateur</span>' : x.b ? '<span class="tagx bot">Bot</span>' : !x.on ? '<span class="tagx">Hors ligne</span>' : x.rdy ? '<span class="tagx ok">Prêt</span>' : '<span class="tagx">…</span>';
        const bubble = '<span class="avwrap">' + av(x, "l", x.on ? "" : "off") + (isH ? '<span class="crownS" aria-hidden="true">👑</span>' : "") + (mine ? '<span class="cam s" aria-hidden="true">📷</span>' : "") + "</span>";
        return '<div class="seat' + (mine ? " mine" : "") + '">' + (mine ? '<button type="button" class="seatbtn" data-act="openSheet" aria-label="Changer ma photo">' + bubble + "</button>" : bubble) +
          '<span class="snm">' + esc(x.n) + (mine ? " (toi)" : "") + "</span>" + tag +
          (h && !mine ? '<button class="kick" data-act="kick" data-i="' + esc(x.i) + '" aria-label="Expulser ' + esc(x.n) + '" title="Expulser">✕</button>' : "") + "</div>";
      });
      const empty = Math.max(0, Math.min(G.cfg.max, 12) - G.pl.length);
      for (let k = 0; k < empty; k++) filled.push('<div class="seat empty"><span class="avwrap"><span class="av l hole" aria-hidden="true">+</span></span><span class="snm">Place libre</span></div>');
      painted = setHTML(seats, filled.join("")) || painted;
      const hint = $("#lobbyhint");
      if (hint) hint.textContent = G.pl.length + "/" + G.cfg.max + " joueurs" + (G.pl.length < 3 ? " · il en faut au moins 3 pour lancer" : "") + " · touche ta bulle pour changer ta photo";
      const l = $("#launch"); if (l) l.disabled = G.pl.length < 3;
      const bb = $("#botbtn"); if (bb) bb.disabled = G.pl.length >= G.cfg.max;
      const me = playerOf(G, G.me);
      const rd = $("#ready"); if (rd && me) { rd.textContent = me.rdy ? "✓ PRÊT (annuler)" : "PRÊT"; rd.classList.toggle("mustard", !me.rdy); }
    }
    if (painted) paintAvatars();
  }
  setInterval(updateDyn, 250);
  renderScreen(true);
})();
