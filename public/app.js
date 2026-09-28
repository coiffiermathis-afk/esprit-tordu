(function () {
  "use strict";
  // ---------- constantes ----------
  const COLORS = ["#F2482C", "#3558F0", "#138F78", "#FFC23D", "#FF6FB5", "#8A5CFF", "#FF9A1F", "#5CC93B", "#1EC8E6", "#A2653E", "#7A8199", "#2D3A8C"];
  const MODES = {
    classique: { label: "🎭 Classique", d: "Des phrases à double sens" },
    absurde: { label: "🤪 Réponses les plus absurdes", d: "Plus c'est tordu, mieux c'est" },
    rapide: { label: "⚡ Rapide", d: "Votes et résultats express" },
  };

  // ---------- outils ----------
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clean = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
  function sget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function sset(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function randomSecret() {
    const a = new Uint8Array(18);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => (a[i] = Math.random() * 256));
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  let PID = sget("et_secret");
  if (!PID || PID.length < 24) { PID = randomSecret(); sset("et_secret", PID); }

  // ---------- état ----------
  const urlCode = (new URLSearchParams(location.search).get("code") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  const S = {
    view: urlCode ? "join" : "home",
    err: "",
    name: clean(sget("et_name") || "", 16),
    code: null,
    prefill: urlCode,
    G: null,
    deadline: 0,
    pickJ: null,
    pickS: null,
    busy: false,
    cfg: { rounds: 5, max: 8, time: 30, mode: "classique" },
  };
  if (urlCode) history.replaceState(null, "", location.pathname);

  // ---------- connexion ----------
  const socket = io({ transports: ["websocket", "polling"] });
  socket.on("connect", () => {
    $("#offline").hidden = true;
    if (S.code && (S.view === "game")) {
      socket.emit("join", { name: S.name, pid: PID, code: S.code }, (res) => {
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
  socket.on("kicked", () => { S.code = null; S.G = null; S.view = "kicked"; renderScreen(true); });
  socket.on("replaced", () => { S.code = null; S.G = null; S.view = "home"; toast("Tu as ouvert la partie dans un autre onglet."); renderScreen(true); });

  function send(ev, data) {
    return new Promise((resolve) => {
      if (!socket.connected) { toast("Pas de connexion au serveur, réessaie dans un instant."); return resolve({ ok: false }); }
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; resolve({ ok: false, err: "Le serveur ne répond pas." }); } }, 8000);
      socket.emit(ev, data || {}, (res) => { if (done) return; done = true; clearTimeout(t); resolve(res || { ok: false }); });
    });
  }
  let toastT = 0;
  function toast(msg) { const el = $("#toast"); el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 3200); }

  // ---------- actions ----------
  async function createGame() {
    const n = clean($("#nm").value, 16);
    if (!n) { S.err = "Choisis un pseudo pour jouer."; return renderScreen(true); }
    const fd = new FormData($("#cform"));
    S.cfg = { rounds: +fd.get("rounds") || 5, max: S.cfg.max, time: +fd.get("time") || 30, mode: fd.get("mode") || "classique" };
    S.name = n; sset("et_name", n); S.err = ""; S.G = null;
    const res = await send("create", { name: n, pid: PID, cfg: S.cfg });
    if (!res.ok) { S.err = res.err || "Impossible de créer la partie."; return renderScreen(true); }
    S.code = res.code; S.view = S.G && S.G.code === res.code ? "game" : "connecting"; renderScreen(true);
  }
  async function joinGame() {
    const n = clean($("#nm").value, 16);
    const code = clean($("#cd").value, 5).toUpperCase();
    if (!n) { S.err = "Choisis un pseudo pour jouer."; return renderScreen(true); }
    if (!/^[A-Z0-9]{5}$/.test(code)) { S.err = "Le code fait 5 caractères, par exemple K7P4X."; S.prefill = code; return renderScreen(true); }
    S.name = n; sset("et_name", n); S.err = ""; S.prefill = code; S.G = null;
    const res = await send("join", { name: n, pid: PID, code });
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
  const label = (t) => '<span style="font-weight:700;font-size:.9rem;display:block;margin-bottom:6px">' + t + "</span>";
  function seg(name, vals, cur, fmt) {
    return '<div class="seg" role="radiogroup">' + vals.map((v) => { const id = name + "_" + v; return '<input type="radio" name="' + name + '" id="' + id + '" value="' + v + '"' + (String(v) === String(cur) ? " checked" : "") + '><label for="' + id + '">' + fmt(v) + "</label>"; }).join("") + "</div>";
  }

  function vHome() {
    const ex = [["Une enceinte", 0], ["Un aspirateur", 1], ["Une fourmi", 2], ["Une pile", 3]];
    return logo() +
      '<p class="tag">« Ton cerveau voit-il toujours le mauvais côté des choses ? »</p>' +
      '<div class="stack"><button class="btn big tomato" data-act="goCreate">Créer une partie</button><button class="btn big blue" data-act="goJoin">Rejoindre une partie</button></div>' +
      '<p class="meta">Jeu de soirée · 3–12 joueurs · Parties de 5 à 15 minutes</p>' +
      '<section class="sample" aria-label="Exemple de manche"><span class="eyebrow">Exemple de manche</span><q>Il est petit, mais étonnamment puissant.</q><div class="chips">' + ex.map(([t, c]) => '<span class="chip"><span class="dot" style="--c:' + COLORS[c] + '"></span>' + t + "</span>").join("") + "</div></section>" +
      "<div class=\"steps\"><div><b>1 · Interprète</b>Une phrase ambiguë, chacun écrit ce qu'il y voit.</div><div><b>2 · Vote</b>Réponses dévoilées d'un coup, on vote pour la plus drôle.</div><div><b>3 · Marque</b>+3, +2, +1 et un bonus « coup de génie ».</div></div>";
  }
  function vCreate() {
    const c = S.cfg;
    return '<div class="bar">' + logo(true) + '<button class="link" data-act="home">← Accueil</button></div>' +
      '<form class="card" id="cform" data-submit="create"><h2 class="h2">Créer une partie</h2>' +
      '<div><label class="f" for="nm">Ton pseudo</label><input class="inp" id="nm" maxlength="16" autocomplete="nickname" placeholder="Alex" value="' + esc(S.name) + '"></div>' +
      "<div>" + label("Nombre de manches") + seg("rounds", [5, 10, 15], c.rounds, (v) => v) + "</div>" +
      "<div>" + label("Joueurs maximum") + '<div class="stepper"><button type="button" class="btn sm" data-act="maxDec" aria-label="Moins de joueurs">−</button><output id="maxo">' + c.max + '</output><button type="button" class="btn sm" data-act="maxInc" aria-label="Plus de joueurs">+</button><span class="summary">de 3 à 12</span></div></div>' +
      "<div>" + label("Temps pour répondre") + seg("time", [15, 30, 60], c.time, (v) => v + " s") + "</div>" +
      "<div>" + label("Mode") + '<div class="seg modes" role="radiogroup">' + Object.keys(MODES).map((k) => '<input type="radio" name="mode" id="mode_' + k + '" value="' + k + '"' + (k === c.mode ? " checked" : "") + '><label for="mode_' + k + '">' + MODES[k].label + "<small>" + MODES[k].d + "</small></label>").join("") + "</div></div>" +
      '<p class="err" role="alert">' + esc(S.err) + '</p><button class="btn big tomato" type="submit">CRÉER LA PARTIE</button></form>';
  }
  function vJoin() {
    return '<div class="bar">' + logo(true) + '<button class="link" data-act="home">← Accueil</button></div>' +
      '<form class="card" data-submit="join"><h2 class="h2">Rejoindre une partie</h2>' +
      '<div><label class="f" for="nm">Ton pseudo</label><input class="inp" id="nm" maxlength="16" autocomplete="nickname" placeholder="Camille" value="' + esc(S.name) + '"></div>' +
      '<div><label class="f" for="cd">Code de la partie</label><input class="inp code" id="cd" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="K7P4X" value="' + esc(S.prefill) + '"></div>' +
      '<p class="err" role="alert">' + esc(S.err) + '</p><button class="btn big blue" type="submit">REJOINDRE</button></form>';
  }
  const vConnecting = () => '<div class="card center"><p><span class="spin"></span></p><p>Connexion à la partie…</p><button class="link" data-act="home">Annuler</button></div>';
  const vKicked = () => logo(true) + "<div class=\"card center\"><h2 class=\"h2\">Tu as été retiré de la partie</h2><p>Le créateur t'a expulsé du salon.</p><button class=\"btn big blue\" data-act=\"home\">Retour à l'accueil</button></div>";

  const isHost = (G) => G.host === G.me;
  const nameOf = (G, i) => { const x = G.pl.find((p) => p.i === i); return x ? x.n : "?"; };
  const colorOf = (G, i) => { const x = G.pl.find((p) => p.i === i); return COLORS[(x ? x.c : 10) % 12]; };
  const remaining = () => Math.max(0, S.deadline - Date.now());

  function topBar(G) {
    const round = G.ph !== "lobby" && G.ph !== "end" ? '<span class="pill">Manche ' + G.r + "/" + G.cfg.rounds + "</span>" : "";
    return '<div class="bar">' + logo(true) + '<div class="row"><span class="pill">' + esc(G.code) + "</span>" + round + '<button class="link" data-act="home">Quitter</button></div></div>';
  }
  const timerHTML = () => '<div class="timer" id="timer"><div class="track"><div class="fill"></div></div><span class="sec">–</span></div>';

  function vGame() {
    const G = S.G;
    if (!G) return vConnecting();
    let body;
    if (G.spec) body = '<div class="card"><span class="eyebrow">Spectateur</span><h2 class="h2">Partie en cours</h2><p>Tu rejoindras la prochaine partie de ce salon quand le créateur relancera.</p>' + (G.ph === "write" || G.ph === "vote" ? '<p class="prompt">« ' + esc(G.prompt) + " »</p>" : "") + rankHTML(G) + "</div>";
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
      '<ul class="plist" id="plist"></ul><p class="summary center" id="lobbyhint"></p>' +
      (h ? '<div class="row"><button class="btn sm" data-act="addBot" id="botbtn">+ Ajouter un bot</button><span class="summary">Pratique pour tester seul.</span></div><button class="btn big tomato" data-act="launch" id="launch">LANCER LA PARTIE</button>'
         : '<p class="center" style="font-weight:700">En attente du créateur…</p><button class="btn big mustard" data-act="ready" id="ready">PRÊT</button>') + "</section>";
  }
  function vWrite(G) {
    const a = G.myAns;
    return '<section class="card">' + timerHTML() + '<span class="eyebrow center">Tour ' + G.r + '</span><p class="prompt">« ' + esc(G.prompt) + " »</p>" +
      (a ? '<div class="locked">Réponse envoyée<b>« ' + esc(a) + ' »</b><span class="summary">On attend les autres…</span></div>'
         : '<form class="stack" data-submit="submitAns"><label class="f" for="ans">Ton interprétation</label><textarea class="inp" id="ans" maxlength="60" placeholder="Écris ton interprétation..."></textarea><div class="row between"><span class="chars" id="chars">0/60</span><button class="btn tomato" type="submit">VALIDER</button></div></form>') +
      '<p class="count" id="count"></p>' + (isHost(G) ? '<button class="link" data-act="skip">Terminer la phase maintenant ⏭</button>' : "") + "</section>";
  }
  const voteWord = (G) => (G.cfg.mode === "absurde" ? "🌀 La plus absurde" : "😂 La plus drôle");
  function vVote(G) {
    const v = G.myVote;
    const nothing = G.an.every((a) => a.mine);
    return '<section class="card">' + timerHTML() + '<span class="eyebrow center">Tour ' + G.r + ' · vote</span><p class="prompt">« ' + esc(G.prompt) + " »</p>" +
      (v ? "<div class=\"locked\">Vote enregistré ✓<span class=\"summary\" style=\"display:block\">Les auteurs seront dévoilés aux résultats.</span></div><div class=\"acards\">" + G.an.map((a, k) => '<div class="acard"><button class="apick" disabled aria-pressed="' + (a.k === v.j) + '"><span class="dot" style="--c:' + COLORS[k % 12] + '"></span>' + esc(a.t) + (a.k === v.j ? '<span class="mine">ton vote</span>' : a.mine ? '<span class="mine">ta réponse</span>' : "") + "</button></div>").join("") + "</div>"
        : nothing ? '<p class="locked">Rien à voter pour toi cette manche.</p>'
        : '<p class="legend"><b>' + voteWord(G) + "</b> : touche une réponse. ⭐ Coup de génie (facultatif) : +1 pour la réponse la plus étoilée. Tu ne peux pas voter pour ta propre réponse.</p><div class=\"acards\" id=\"cards\"></div><button class=\"btn big tomato\" data-act=\"vote\" id=\"votebtn\" disabled>VOTER</button>") +
      '<p class="count" id="count"></p>' + (isHost(G) ? '<button class="link" data-act="skip">Terminer le vote maintenant ⏭</button>' : "") + "</section>";
  }
  function drawCards() {
    const G = S.G, el = $("#cards");
    if (!G || !el) return;
    el.innerHTML = G.an.map((a, k) => '<div class="acard"><button class="apick" data-act="pickJ" data-k="' + esc(a.k) + '" aria-pressed="' + (S.pickJ === a.k) + '"' + (a.mine ? " disabled" : "") + '><span class="dot" style="--c:' + COLORS[k % 12] + '"></span>' + esc(a.t) + (a.mine ? '<span class="mine">ta réponse</span>' : "") + '</button><button class="star" data-act="pickS" data-k="' + esc(a.k) + '" aria-label="Coup de génie" aria-pressed="' + (S.pickS === a.k) + '"' + (a.mine ? " disabled" : "") + ">⭐</button></div>").join("");
    const b = $("#votebtn"); if (b) b.disabled = !S.pickJ;
  }
  function rankHTML(G) {
    const rows = G.pl.slice().sort((a, b) => (G.sc[b.i] || 0) - (G.sc[a.i] || 0));
    let last = null, rk = 0;
    return '<div><span class="eyebrow">🏆 Classement</span><table class="rank"><tbody>' + rows.map((x, k) => { const s = G.sc[x.i] || 0; if (s !== last) { rk = k + 1; last = s; } return '<tr class="' + (x.i === G.me ? "me" : "") + '"><td>' + rk + '.</td><td class="nm"><span class="dot" style="--c:' + COLORS[x.c % 12] + ';display:inline-block;margin-right:8px;vertical-align:-1px"></span>' + esc(x.n) + "</td><td>" + s + " pts</td></tr>"; }).join("") + "</tbody></table></div>";
  }
  function vRes(G) {
    const medals = ["🥇", "🥈", "🥉"];
    return '<section class="card"><span class="eyebrow center">Tour ' + G.r + ' · résultats</span><p class="prompt" style="font-size:1.4rem">« ' + esc(G.prompt) + " »</p>" +
      (G.note ? '<p class="note">' + esc(G.note) + "</p>" : "") +
      '<ul class="rlist">' + (G.rr || []).map((r, k) => '<li class="' + (k === 0 && r.p > 0 ? "top" : "") + '"><span class="ans">' + (r.p > 0 && k < 3 ? medals[k] + " " : "") + esc(r.t) + '</span><span class="pts">+' + r.p + '</span><span class="who"><span class="dot" style="--c:' + colorOf(G, r.i) + '"></span>' + esc(nameOf(G, r.i)) + '<span class="v">· ' + (G.cfg.mode === "absurde" ? "🌀" : "😂") + " " + r.v + (r.s ? " · ⭐ " + r.s : "") + (r.g ? " · coup de génie" : "") + "</span></span></li>").join("") + "</ul>" +
      rankHTML(G) + '<div class="row between"><span class="summary" id="nextin"></span>' + (isHost(G) ? '<button class="btn sm" data-act="skip">' + (G.r >= G.cfg.rounds ? "Voir le podium →" : "Manche suivante →") + "</button>" : "") + "</div></section>";
  }
  function vEnd(G) {
    const rows = G.pl.slice().sort((a, b) => (G.sc[b.i] || 0) - (G.sc[a.i] || 0));
    const p = [rows[1], rows[0], rows[2]], cls = ["p2", "p1", "p3"], nums = ["2", "1", "3"];
    return '<section class="card"><h2 class="h2 center">PARTIE TERMINÉE !</h2><div class="podium">' + p.map((x, k) => (x ? '<div class="' + cls[k] + '"><span class="pn">' + esc(x.n) + '</span><span class="ps">' + (G.sc[x.i] || 0) + ' pts</span><span class="blk">' + nums[k] + "</span></div>" : "<div></div>")).join("") + "</div>" +
      (rows.length > 3 ? rankHTML(G) : "") +
      ((G.ti || []).length ? '<span class="eyebrow">Titres de la soirée</span><div class="titles">' + G.ti.map((t) => '<div><span class="e">' + t.e + '</span><span class="t">' + esc(t.t) + '</span><span class="n">' + esc(nameOf(G, t.i)) + '</span><span class="d">' + esc(t.d) + "</span></div>").join("") + "</div>" : "") +
      (isHost(G) ? '<button class="btn big tomato" data-act="replay">REJOUER</button>' : '<p class="center summary">Le créateur peut relancer une partie avec le même salon.</p>') +
      '<button class="btn big" data-act="home">NOUVELLE PARTIE</button></section>';
  }

  let screenKey = "";
  function renderScreen(force) {
    const G = S.view === "game" ? S.G : null;
    const key = [S.view, S.err, G ? G.ph : "", G ? G.r : "", G ? G.spec : "", G ? isHost(G) : "", G ? !!G.myAns : "", G ? !!G.myVote : "", G ? G.an.map((a) => a.k).join(",") : ""].join("|");
    if (!force && key === screenKey) return;
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
    drawCards(); updateDyn();
  }
  function setHTML(el, h) { if (el && el._h !== h) { el._h = h; el.innerHTML = h; } }
  function updateDyn() {
    const G = S.view === "game" ? S.G : null;
    if (!G) return;
    const tm = $("#timer");
    if (tm) {
      const rem = remaining(), total = G.total || 1;
      tm.querySelector(".fill").style.width = Math.max(0, Math.min(100, (rem / total) * 100)) + "%";
      tm.querySelector(".sec").textContent = Math.ceil(rem / 1000) + " s";
      tm.classList.toggle("low", rem < 5000);
    }
    const nx = $("#nextin");
    if (nx) nx.textContent = (G.r >= G.cfg.rounds ? "Podium" : "Manche suivante") + " dans " + Math.ceil(remaining() / 1000) + " s";
    const cnt = $("#count");
    if (cnt) {
      const humans = G.pl.filter((p) => !p.b && p.on);
      if (G.ph === "write") {
        const n = humans.filter((p) => p.a).length, bots = G.pl.filter((p) => p.b && !p.a).length;
        cnt.textContent = n + "/" + humans.length + " joueur" + (humans.length > 1 ? "s ont" : " a") + " répondu" + (bots ? " · " + bots + " bot" + (bots > 1 ? "s" : "") + " en réflexion" : "");
      } else if (G.ph === "vote") {
        const n = humans.filter((p) => p.v).length;
        cnt.textContent = n + "/" + humans.length + " vote" + (n > 1 ? "s" : "");
      }
    }
    const pl = $("#plist");
    if (pl) {
      const h = isHost(G);
      setHTML(pl, G.pl.map((x) => {
        const isH = x.i === G.host;
        const tag = isH ? '<span class="tagx host">Créateur</span>' : x.b ? '<span class="tagx bot">Bot</span>' : !x.on ? '<span class="tagx">Hors ligne</span>' : x.rdy ? '<span class="tagx ok">Prêt</span>' : '<span class="tagx">…</span>';
        return '<li><span class="dot" style="--c:' + COLORS[x.c % 12] + '"></span><span class="nm">' + esc(x.n) + (x.i === G.me ? ' <span class="summary">(toi)</span>' : "") + "</span>" + tag +
          (h && x.i !== G.me ? '<button class="kick" data-act="kick" data-i="' + esc(x.i) + '" aria-label="Expulser ' + esc(x.n) + '" title="Expulser">✕</button>' : "") + "</li>";
      }).join(""));
      const hint = $("#lobbyhint");
      if (hint) hint.textContent = G.pl.length + "/" + G.cfg.max + " joueurs" + (G.pl.length < 3 ? " · il en faut au moins 3 pour lancer" : "");
      const l = $("#launch"); if (l) l.disabled = G.pl.length < 3;
      const bb = $("#botbtn"); if (bb) bb.disabled = G.pl.length >= G.cfg.max;
      const me = G.pl.find((p) => p.i === G.me);
      const rd = $("#ready"); if (rd && me) { rd.textContent = me.rdy ? "✓ PRÊT (annuler)" : "PRÊT"; rd.classList.toggle("mustard", !me.rdy); }
    }
  }
  setInterval(updateDyn, 250);
  renderScreen(true);
})();
