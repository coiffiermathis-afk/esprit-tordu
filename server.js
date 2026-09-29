"use strict";
// Esprit Tordu — serveur de jeu (Express + Socket.IO).
// Le serveur est la seule autorité : il garde l'état des parties en mémoire,
// fait avancer les phases, valide les réponses et les votes, et calcule les scores.

const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const { Server } = require("socket.io");
const C = require("./content");

const PORT = process.env.PORT || 3000;
const MAX_ROOMS = 3000;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans 0/O ni 1/I
const MODES = ["classique", "absurde", "rapide"];
const LOBBY_DROP_MS = 30_000; // joueur déconnecté retiré du salon après 30 s
const HOST_HANDOFF_MS = 8_000; // créateur déconnecté remplacé après 8 s
const ROOM_IDLE_MS = 10 * 60_000; // salon vide supprimé après 10 min
const IMAGE_RATE = process.env.IMAGE_RATE != null ? +process.env.IMAGE_RATE : 0.2; // ≈ 1 manche sur 5 en photo

// ---------- utilitaires ----------
const rand = (a, b) => Math.floor(a + Math.random() * Math.max(1, b - a));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const id = (n = 8) => crypto.randomBytes(n).toString("base64url").slice(0, n);
function clean(s, n) {
  return String(s == null ? "" : s)
    .replace(/[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁤﻿]/g, "")
    .replace(/\s+/g, " ").trim().slice(0, n);
}
// photo de profil : image JPEG/PNG/WebP déjà réduite par le navigateur (≈ 192 px)
const PHOTO_MAX = 60_000;
function validPhoto(s) {
  return typeof s === "string" && s.length <= PHOTO_MAX && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(s) ? s : null;
}
function genCode() {
  for (let t = 0; t < 50; t++) {
    let c = "";
    for (let i = 0; i < 5; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}

// ---------- état ----------
/** @type {Map<string, any>} */
const rooms = new Map();

function newPlayer({ secret, name, bot = false, spec = false }) {
  return { pub: id(8), secret, name, photo: null, photoAt: 0, color: 0, bot, spec, sockId: null, rdy: false, ans: null, disconnectedAt: 0, botAt: 0, botAns: null, botVote: null };
}
function humans(room) { return room.order.map((p) => room.players.get(p)).filter((p) => p && !p.bot); }
function active(room) { return room.order.map((p) => room.players.get(p)).filter((p) => p && (p.bot || p.sockId)); }
function freeColor(room) {
  const used = new Set(room.order.map((p) => room.players.get(p)?.color));
  for (let c = 0; c < 12; c++) if (!used.has(c)) return c;
  return 0;
}
const voteMs = (room) => (room.cfg.mode === "rapide" ? 15_000 : 30_000);
const resMs = (room) => (room.cfg.mode === "rapide" ? 6_000 : 11_000);

// ---------- déroulement ----------
function startRound(room, now) {
  room.r++;
  const abs = room.cfg.mode === "absurde";
  const bank = abs ? C.PROMPTS_ABSURDE : C.PROMPTS_CLASSIQUE;
  const pre = abs ? "a" : "c";
  let idx = bank.map((_, i) => i).filter((i) => !room.used.includes(pre + i));
  if (!idx.length) { room.used = []; idx = bank.map((_, i) => i); }
  const k = pick(idx);
  room.used.push(pre + k);
  if (room.used.length > 40) room.used.shift();
  room.prompt = bank[k];
  room.img = null;
  // de temps en temps, une photo à double sens à la place de la phrase (pas en mode absurde)
  if (!abs && C.IMAGES.length && Math.random() < IMAGE_RATE) {
    let ids = C.IMAGES.map((_, i) => i).filter((i) => !room.used.includes("i" + i));
    if (!ids.length) { room.used = room.used.filter((u) => u[0] !== "i"); ids = C.IMAGES.map((_, i) => i); }
    const n = pick(ids), im = C.IMAGES[n];
    room.used.push("i" + n);
    room.img = { id: im.id, by: im.by, lic: im.lic, page: im.page };
    room.prompt = pick(C.IMAGE_CAPTIONS);
  }
  room.ph = "write";
  room.endsAt = now + room.cfg.time * 1000;
  room.total = room.cfg.time * 1000;
  room.an = []; room.rr = []; room.note = ""; room.votes = new Map();
  for (const p of room.players.values()) {
    p.ans = null;
    if (p.bot) { p.botAt = now + rand(2500, Math.min(room.cfg.time * 600, 14_000)); p.botAns = pick(abs ? C.BOT_ABSURD : C.BOT_ANSWERS); p.botVote = null; }
  }
}

function toVote(room, now) {
  const an = [];
  for (const pub of room.order) {
    const p = room.players.get(pub);
    if (!p) continue;
    const t = p.bot ? p.botAns : p.ans;
    if (t) an.push({ k: id(6), pub, t });
  }
  shuffle(an);
  room.votes = new Map();
  if (an.length < 2) {
    room.an = [];
    room.rr = an.map((a) => ({ i: a.pub, t: a.t, v: 0, s: 0, p: 0, g: 0 }));
    room.note = "Pas assez de réponses pour voter cette manche. Aucun point distribué.";
    room.ph = "res"; room.endsAt = now + resMs(room); room.total = resMs(room);
    return;
  }
  room.an = an; room.note = "";
  room.ph = "vote"; room.endsAt = now + voteMs(room); room.total = voteMs(room);
  for (const pub of room.order) {
    const p = room.players.get(pub);
    if (!p || !p.bot) continue;
    const opts = an.filter((a) => a.pub !== pub);
    if (!opts.length) continue;
    p.botAt = now + rand(1500, Math.min(voteMs(room) * 0.5, 8000));
    p.botVote = { j: pick(opts).k, s: Math.random() < 0.6 ? pick(opts).k : null };
  }
}

function tally(room, now) {
  const byKey = new Map(room.an.map((a) => [a.k, a]));
  const v = {}, s = {};
  for (const a of room.an) { v[a.pub] = 0; s[a.pub] = 0; }
  const ballots = [];
  for (const pub of room.order) {
    const p = room.players.get(pub);
    if (!p) continue;
    const b = p.bot ? p.botVote : room.votes.get(pub);
    if (b) ballots.push([pub, b]);
  }
  for (const [pub, b] of ballots) {
    const j = byKey.get(b.j); if (j && j.pub !== pub) v[j.pub]++;
    const st = byKey.get(b.s); if (st && st.pub !== pub) s[st.pub]++;
  }
  const levels = [...new Set(Object.values(v).filter((n) => n > 0))].sort((a, b) => b - a);
  const maxS = Math.max(0, ...Object.values(s));
  const rr = room.an.map((a) => {
    const rk = levels.indexOf(v[a.pub]);
    let pts = rk === 0 ? 3 : rk === 1 ? 2 : rk === 2 ? 1 : 0;
    const genius = maxS > 0 && s[a.pub] === maxS;
    if (genius) pts += 1;
    return { i: a.pub, t: a.t, v: v[a.pub], s: s[a.pub], p: pts, g: genius ? 1 : 0, w: rk === 0 ? 1 : 0 };
  });
  rr.sort((a, b) => b.p - a.p || b.v - a.v || b.s - a.s);
  for (const r of rr) {
    room.sc[r.i] = (room.sc[r.i] || 0) + r.p;
    const st = room.st[r.i] || (room.st[r.i] = { v: 0, w: 0, s: 0 });
    st.v += r.v; st.w += r.w; st.s += r.s;
    const k = r.v + r.s;
    if (k > 0 && (!room.best || k > room.best.k)) room.best = { i: r.i, t: r.t, k };
  }
  room.rr = rr; room.an = [];
  room.ph = "res"; room.endsAt = now + resMs(room); room.total = resMs(room);
}

function titles(room) {
  const T = [];
  const top = (f) => { let b = null; for (const pub of room.order) { const st = room.st[pub]; const val = st ? f(st) : 0; if (val > 0 && (!b || val > b.val)) b = { i: pub, val }; } return b; };
  const pl = (n, w) => n + " " + w + (n > 1 ? "s" : "");
  const a = top((s) => s.v); if (a) T.push({ e: "🧠", t: "Esprit le plus tordu", i: a.i, d: pl(a.val, "vote") + " reçu" + (a.val > 1 ? "s" : "") + " au total" });
  const b = top((s) => s.w); if (b) T.push({ e: "😂", t: "Roi/Reine de la punchline", i: b.i, d: pl(b.val, "manche") + " remportée" + (b.val > 1 ? "s" : "") });
  const c = top((s) => s.s); if (c) T.push({ e: "🌀", t: "Maître de l'absurde", i: c.i, d: pl(c.val, "coup") + " de génie" });
  if (room.best) T.push({ e: "🎯", t: "Réponse la plus inattendue", i: room.best.i, d: "« " + room.best.t + " »" });
  return T;
}

function nextRound(room, now) {
  if (room.r >= room.cfg.rounds) { room.ph = "end"; room.endsAt = 0; room.rr = []; room.ti = titles(room); }
  else startRound(room, now);
}

function phaseDone(room, now) {
  const act = active(room);
  if (room.ph === "write") return act.length > 0 && act.every((p) => (p.bot ? now >= p.botAt : !!p.ans));
  if (room.ph === "vote") {
    const voters = act.filter((p) => room.an.some((a) => a.pub !== p.pub));
    return voters.every((p) => (p.bot ? now >= p.botAt : room.votes.has(p.pub)));
  }
  return false;
}

// Une étape de la boucle : renvoie true si l'état a changé.
function step(room, now) {
  let ch = false;
  // retirer les déconnectés du salon
  if (room.ph === "lobby") {
    for (const pub of room.order.slice()) {
      const p = room.players.get(pub);
      if (p && !p.bot && !p.sockId && now - p.disconnectedAt > LOBBY_DROP_MS) { removePlayer(room, pub); ch = true; }
    }
  }
  // passer la main si le créateur est parti
  const host = room.players.get(room.hostId);
  if (!host || (!host.sockId && now - host.disconnectedAt > HOST_HANDOFF_MS)) {
    const next = humans(room).find((p) => p.sockId);
    if (next && next.pub !== room.hostId) { room.hostId = next.pub; ch = true; }
  }
  if (room.ph === "write" || room.ph === "vote") {
    if (now >= room.endsAt || phaseDone(room, now)) { room.ph === "write" ? toVote(room, now) : tally(room, now); ch = true; }
  } else if (room.ph === "res" && now >= room.endsAt) { nextRound(room, now); ch = true; }
  return ch;
}

function removePlayer(room, pub) {
  room.order = room.order.filter((p) => p !== pub);
  room.players.delete(pub);
  delete room.sc[pub];
}

// ---------- vue envoyée à chaque joueur ----------
function view(room, me, now) {
  const inRound = room.ph === "write" || room.ph === "vote";
  return {
    code: room.code,
    me: me.pub,
    spec: !!me.spec,
    host: room.hostId,
    cfg: room.cfg,
    ph: room.ph,
    r: room.r,
    prompt: room.prompt,
    img: room.ph === "write" || room.ph === "vote" || room.ph === "res" ? room.img || null : null,
    left: room.endsAt ? Math.max(0, room.endsAt - now) : 0,
    total: room.total || 0,
    note: room.note,
    pl: room.order.map((pub) => {
      const p = room.players.get(pub);
      return { i: p.pub, n: p.name, c: p.color, b: p.bot ? 1 : 0, rdy: p.rdy ? 1 : 0, on: p.bot || p.sockId ? 1 : 0,
        a: inRound && room.ph === "write" ? (p.bot ? (now >= p.botAt ? 1 : 0) : p.ans ? 1 : 0) : 0,
        v: room.ph === "vote" ? (p.bot ? (now >= p.botAt ? 1 : 0) : room.votes.has(p.pub) ? 1 : 0) : 0 };
    }),
    specs: [...room.players.values()].filter((p) => p.spec).length,
    sc: room.sc,
    myAns: room.ph === "write" || room.ph === "vote" ? me.ans : null,
    myVote: room.ph === "vote" ? room.votes.get(me.pub) || null : null,
    an: room.ph === "vote" ? room.an.map((a) => ({ k: a.k, t: a.t, mine: a.pub === me.pub ? 1 : 0 })) : [],
    rr: room.ph === "res" ? room.rr : [],
    ti: room.ph === "end" ? room.ti : null,
  };
}

// Photos envoyées à part (lourdes) : la liste complète au joueur qui arrive,
// seulement la photo qui change aux autres.
function photoMap(room) {
  const m = {};
  for (const p of room.players.values()) if (p.photo) m[p.pub] = p.photo;
  return m;
}
function pushPhotos(room, pub, joiningSocket) {
  if (joiningSocket) joiningSocket.emit("avatars", { full: 1, m: photoMap(room) });
  const p = room.players.get(pub);
  const delta = { [pub]: (p && p.photo) || null };
  for (const x of room.players.values()) {
    if (x.bot || !x.sockId || (joiningSocket && x.sockId === joiningSocket.id)) continue;
    io.to(x.sockId).emit("avatars", { m: delta });
  }
}

function broadcast(room) {
  const now = Date.now();
  for (const p of room.players.values()) {
    if (p.bot || !p.sockId) continue;
    io.to(p.sockId).emit("state", view(room, p, now));
  }
}

// ---------- serveur HTTP ----------
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
// maxAge 0 : le navigateur revérifie à chaque visite (réponse 304 légère), donc les mises à jour arrivent tout de suite.
app.use(express.static(path.join(__dirname, "public"), { maxAge: 0, index: "index.html" }));
app.get("/health", (_req, res) => res.type("text").send("ok"));

// Photos des manches image : téléchargées une fois depuis Wikimedia Commons, gardées en mémoire.
const imgCache = new Map(); // id -> { type, buf } ou une promesse en cours
const IMG_UA = "EspritTordu/1.0 (jeu de soiree; https://github.com/coiffiermathis-afk/esprit-tordu)";
function loadImage(im) {
  const c = imgCache.get(im.id);
  if (c) return c instanceof Promise ? c : Promise.resolve(c);
  const p = fetch(im.src, { headers: { "User-Agent": IMG_UA } })
    .then(async (r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      const v = { type: r.headers.get("content-type") || "image/jpeg", buf: Buffer.from(await r.arrayBuffer()) };
      imgCache.set(im.id, v);
      return v;
    })
    .catch((e) => { imgCache.delete(im.id); throw e; });
  imgCache.set(im.id, p);
  return p;
}
app.get("/img/:id", async (req, res) => {
  const im = C.IMAGES.find((x) => x.id === req.params.id);
  if (!im) return res.status(404).end();
  try {
    const v = await loadImage(im);
    res.set("Content-Type", v.type).set("Cache-Control", "public, max-age=86400").send(v.buf);
  } catch (e) { console.error("image", im.id, e.message); res.status(502).end(); }
});
// préchargement doux au démarrage (une photo toutes les 2 s)
C.IMAGES.forEach((im, i) => setTimeout(() => loadImage(im).catch(() => {}), 3000 + i * 2000).unref());

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 96 * 1024, pingInterval: 20_000, pingTimeout: 25_000 });

// limitation du spam : seau de jetons par connexion + créations par adresse IP
const createLog = new Map(); // ip -> [timestamps]
function ipOf(socket) {
  const fwd = socket.handshake.headers["x-forwarded-for"];
  return (typeof fwd === "string" && fwd.split(",")[0].trim()) || socket.handshake.address || "?";
}
function allowCreate(ip) {
  const now = Date.now();
  const arr = (createLog.get(ip) || []).filter((t) => now - t < 10 * 60_000);
  if (arr.length >= 10) { createLog.set(ip, arr); return false; }
  arr.push(now); createLog.set(ip, arr); return true;
}

io.on("connection", (socket) => {
  const bucket = { tokens: 15, at: Date.now() };
  const limited = () => {
    const now = Date.now();
    bucket.tokens = Math.min(15, bucket.tokens + ((now - bucket.at) / 1000) * 6);
    bucket.at = now;
    if (bucket.tokens < 1) return true;
    bucket.tokens -= 1; return false;
  };
  const ctx = () => {
    const room = rooms.get(socket.data.code);
    const me = room && room.players.get(socket.data.pub);
    if (!room || !me || me.sockId !== socket.id) return {};
    return { room, me, isHost: room.hostId === me.pub };
  };
  // enregistre un gestionnaire protégé (anti-spam + ack sûr + erreurs isolées)
  const on = (ev, fn) => socket.on(ev, (data, ack) => {
    const reply = typeof ack === "function" ? ack : () => {};
    if (limited()) return reply({ ok: false, err: "Doucement ! Trop d'actions d'un coup." });
    try { fn(data && typeof data === "object" ? data : {}, reply); } catch (e) { console.error(ev, e); reply({ ok: false, err: "Erreur du serveur." }); }
  });

  function attach(room, p) {
    if (p.sockId && p.sockId !== socket.id) {
      const old = io.sockets.sockets.get(p.sockId);
      if (old) { old.emit("replaced"); old.data.code = null; old.leave(room.code); }
    }
    p.sockId = socket.id; p.disconnectedAt = 0;
    socket.data.code = room.code; socket.data.pub = p.pub;
    socket.join(room.code);
  }
  function detach() {
    const { room, me } = ctx();
    if (room && me) { me.sockId = null; me.disconnectedAt = Date.now(); socket.leave(room.code); broadcast(room); }
    socket.data.code = null; socket.data.pub = null;
  }

  on("create", (d, reply) => {
    const name = clean(d.name, 16);
    const secret = clean(d.pid, 40);
    if (!name) return reply({ ok: false, err: "Choisis un pseudo pour jouer." });
    if (secret.length < 12) return reply({ ok: false, err: "Identifiant invalide, recharge la page." });
    if (rooms.size >= MAX_ROOMS) return reply({ ok: false, err: "Le serveur est plein, réessaie dans quelques minutes." });
    if (!allowCreate(ipOf(socket))) return reply({ ok: false, err: "Trop de parties créées. Attends quelques minutes." });
    const c = d.cfg || {};
    const cfg = {
      rounds: [5, 10, 15].includes(+c.rounds) ? +c.rounds : 5,
      max: Math.min(12, Math.max(3, Math.round(+c.max) || 8)),
      time: [15, 30, 60].includes(+c.time) ? +c.time : 30,
      mode: MODES.includes(c.mode) ? c.mode : "classique",
    };
    const code = genCode();
    if (!code) return reply({ ok: false, err: "Impossible de créer un code, réessaie." });
    detach();
    const host = newPlayer({ secret, name });
    host.photo = validPhoto(d.photo);
    const room = { code, cfg, hostId: host.pub, ph: "lobby", r: 0, prompt: "", endsAt: 0, total: 0, players: new Map([[host.pub, host]]), order: [host.pub], kicked: new Set(), used: [], an: [], votes: new Map(), rr: [], note: "", sc: { [host.pub]: 0 }, st: {}, best: null, ti: null, emptySince: 0 };
    rooms.set(code, room);
    attach(room, host);
    reply({ ok: true, code });
    broadcast(room);
    pushPhotos(room, host.pub, socket);
  });

  on("join", (d, reply) => {
    const name = clean(d.name, 16);
    const secret = clean(d.pid, 40);
    const code = clean(d.code, 5).toUpperCase();
    if (!name) return reply({ ok: false, err: "Choisis un pseudo pour jouer." });
    if (secret.length < 12) return reply({ ok: false, err: "Identifiant invalide, recharge la page." });
    const room = rooms.get(code);
    if (!room) return reply({ ok: false, err: "Aucune partie avec le code " + (code || "…") + ". Vérifie le code auprès du créateur." });
    if (room.kicked.has(secret)) return reply({ ok: false, err: "Le créateur t'a retiré de cette partie." });
    detach();
    let p = [...room.players.values()].find((x) => !x.bot && x.secret === secret);
    if (p) { p.name = name; if (d.photo !== undefined) p.photo = validPhoto(d.photo); }
    else if (room.ph === "lobby") {
      if (room.order.length >= room.cfg.max) return reply({ ok: false, err: "Le salon est complet (" + room.cfg.max + " joueurs)." });
      p = newPlayer({ secret, name });
      p.photo = validPhoto(d.photo);
      p.color = freeColor(room);
      room.players.set(p.pub, p); room.order.push(p.pub); room.sc[p.pub] = 0;
    } else {
      if ([...room.players.values()].filter((x) => x.spec).length >= 20) return reply({ ok: false, err: "Trop de spectateurs dans cette partie." });
      p = newPlayer({ secret, name, spec: true });
      p.photo = validPhoto(d.photo);
      room.players.set(p.pub, p);
    }
    attach(room, p);
    reply({ ok: true, code });
    broadcast(room);
    pushPhotos(room, p.pub, socket);
  });

  on("photo", (d, reply) => {
    const { room, me } = ctx(); if (!room) return reply({ ok: false });
    const now = Date.now();
    if (now - me.photoAt < 2000) return reply({ ok: false, err: "Attends deux secondes avant de changer encore." });
    const photo = d.photo == null ? null : validPhoto(d.photo);
    if (d.photo != null && !photo) return reply({ ok: false, err: "Cette photo n'est pas valide." });
    me.photo = photo; me.photoAt = now;
    pushPhotos(room, me.pub, null);
    reply({ ok: true });
  });

  on("ready", (_d, reply) => {
    const { room, me } = ctx(); if (!room) return reply({ ok: false });
    me.rdy = !me.rdy; broadcast(room); reply({ ok: true });
  });

  on("addBot", (_d, reply) => {
    const { room, isHost } = ctx();
    if (!room || !isHost || room.ph !== "lobby") return reply({ ok: false });
    if (room.order.length >= room.cfg.max) return reply({ ok: false, err: "Salon complet." });
    const used = new Set(room.order.map((p) => room.players.get(p).name));
    const bot = newPlayer({ secret: "bot-" + id(12), name: C.BOT_NAMES.find((n) => !used.has(n)) || "Bot " + id(3), bot: true });
    bot.color = freeColor(room);
    room.players.set(bot.pub, bot); room.order.push(bot.pub); room.sc[bot.pub] = 0;
    broadcast(room); reply({ ok: true });
  });

  on("kick", (d, reply) => {
    const { room, me, isHost } = ctx();
    if (!room || !isHost) return reply({ ok: false });
    const target = room.players.get(clean(d.i, 12));
    if (!target || target.pub === me.pub) return reply({ ok: false });
    if (!target.bot) room.kicked.add(target.secret);
    if (target.sockId) {
      const s = io.sockets.sockets.get(target.sockId);
      if (s) { s.emit("kicked"); s.data.code = null; s.leave(room.code); }
    }
    removePlayer(room, target.pub);
    room.votes.delete(target.pub);
    broadcast(room); reply({ ok: true });
  });

  on("start", (_d, reply) => {
    const { room, isHost } = ctx();
    if (!room || !isHost || room.ph !== "lobby") return reply({ ok: false });
    if (room.order.length < 3) return reply({ ok: false, err: "Il faut au moins 3 joueurs." });
    room.r = 0; startRound(room, Date.now());
    broadcast(room); reply({ ok: true });
  });

  on("answer", (d, reply) => {
    const { room, me } = ctx();
    if (!room || me.spec || room.ph !== "write" || !room.order.includes(me.pub)) return reply({ ok: false, err: "Trop tard pour répondre." });
    if (me.ans) return reply({ ok: false, err: "Tu as déjà répondu." });
    const t = clean(d.text, 60);
    if (!t) return reply({ ok: false, err: "Ta réponse est vide." });
    me.ans = t;
    if (phaseDone(room, Date.now())) step(room, Date.now());
    broadcast(room); reply({ ok: true });
  });

  on("vote", (d, reply) => {
    const { room, me } = ctx();
    if (!room || me.spec || room.ph !== "vote" || !room.order.includes(me.pub)) return reply({ ok: false, err: "Le vote est terminé." });
    if (room.votes.has(me.pub)) return reply({ ok: false, err: "Tu as déjà voté." });
    const j = room.an.find((a) => a.k === d.j);
    const s = d.s == null ? null : room.an.find((a) => a.k === d.s);
    if (!j || j.pub === me.pub) return reply({ ok: false, err: "Tu ne peux pas voter pour ta propre réponse." });
    if (s && s.pub === me.pub) return reply({ ok: false, err: "Pas de coup de génie pour toi-même !" });
    room.votes.set(me.pub, { j: j.k, s: s ? s.k : null });
    if (phaseDone(room, Date.now())) step(room, Date.now());
    broadcast(room); reply({ ok: true });
  });

  on("skip", (_d, reply) => {
    const { room, isHost } = ctx();
    if (!room || !isHost || !["write", "vote", "res"].includes(room.ph)) return reply({ ok: false });
    room.endsAt = Date.now(); step(room, Date.now());
    broadcast(room); reply({ ok: true });
  });

  on("replay", (_d, reply) => {
    const { room, isHost } = ctx();
    if (!room || !isHost || room.ph !== "end") return reply({ ok: false });
    room.ph = "lobby"; room.r = 0; room.endsAt = 0; room.rr = []; room.an = []; room.st = {}; room.best = null; room.ti = null; room.note = "";
    for (const p of room.players.values()) {
      p.ans = null; p.rdy = false;
      if (p.spec) {
        if (room.order.length < room.cfg.max && p.sockId) { p.spec = false; p.color = freeColor(room); room.order.push(p.pub); }
        else room.players.delete(p.pub);
      }
    }
    room.sc = Object.fromEntries(room.order.map((p) => [p, 0]));
    broadcast(room); reply({ ok: true });
  });

  on("leave", (_d, reply) => {
    const { room, me } = ctx();
    if (room && me) {
      if (room.ph === "lobby" || me.spec) removePlayer(room, me.pub);
      else { me.sockId = null; me.disconnectedAt = Date.now(); }
      socket.leave(room.code);
      if (room.hostId === me.pub) { const next = humans(room).find((p) => p.sockId && p.pub !== me.pub); if (next) room.hostId = next.pub; }
      broadcast(room);
    }
    socket.data.code = null; socket.data.pub = null;
    reply({ ok: true });
  });

  socket.on("disconnect", () => { try { detach(); } catch (e) { console.error(e); } });
});

// boucle de jeu : fait avancer les chronos, nettoie les salons vides
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    try {
      const anyone = humans(room).some((p) => p.sockId) || [...room.players.values()].some((p) => p.spec && p.sockId);
      if (!anyone) { room.emptySince = room.emptySince || now; if (now - room.emptySince > ROOM_IDLE_MS) { rooms.delete(room.code); continue; } }
      else room.emptySince = 0;
      if (step(room, now)) broadcast(room);
    } catch (e) { console.error("room", room.code, e); }
  }
  for (const [ip, arr] of createLog) if (!arr.some((t) => now - t < 10 * 60_000)) createLog.delete(ip);
}, 250);

server.listen(PORT, () => console.log("Esprit Tordu en ligne sur le port " + PORT));
module.exports = { server };
