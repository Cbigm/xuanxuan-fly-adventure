(() => {
  "use strict";

  const STATES = Object.freeze({
    LOADING: "LOADING",
    MENU: "MENU",
    PLAYING: "PLAYING",
    PAUSED: "PAUSED",
    GAME_OVER: "GAME_OVER",
  });
  const CHARACTER = Object.freeze({
    NORMAL: "NORMAL",
    HAPPY: "HAPPY",
    EXCITED: "EXCITED",
    WOW: "WOW",
    HURT: "HURT",
    SUPER_HAPPY: "SUPER_HAPPY",
  });
  const DEBUG_HITBOX = false;
  const $ = (id) => document.getElementById(id);
  const canvas = $("game-canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const ui = {
    loading: $("loading"),
    menu: $("menu"),
    hud: $("hud"),
    pause: $("pause-screen"),
    over: $("game-over"),
    score: $("score"),
    best: $("best"),
    menuBest: $("menu-best"),
    hearts: $("hearts"),
    boostFill: $("boost-fill"),
    boostValue: $("boost-value"),
    boostMeter: $("boost-meter"),
    boostButton: $("boost-button"),
    combo: $("combo"),
    toast: $("toast"),
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const random = (a, b) => a + Math.random() * (b - a);

  const PATHS = {
    normal: "./assets/xuanxuan/normal.png",
    happy: "./assets/xuanxuan/happy.png",
    excited: "./assets/xuanxuan/excited.png",
    wow: "./assets/xuanxuan/wow.png",
    hurt: "./assets/xuanxuan/hurt.png",
    superHappy: "./assets/xuanxuan/super-happy.png",
    day: "./assets/backgrounds/day.png",
    sunset: "./assets/backgrounds/sunset.png",
    night: "./assets/backgrounds/night.png",
    far: "./assets/backgrounds/far-clouds.png",
    mid: "./assets/backgrounds/mid-clouds.png",
    foreground: "./assets/backgrounds/foreground-decor.png",
    cloudWall: "./assets/obstacles/cloud-wall.png",
    balloons: "./assets/obstacles/balloons.png",
    rainbowGate: "./assets/obstacles/rainbow-gate.png",
    planet: "./assets/obstacles/planet.png",
    bird: "./assets/obstacles/bird.png",
    star: "./assets/items/star.png",
    bigStar: "./assets/items/big-star.png",
    heart: "./assets/items/heart.png",
    energy: "./assets/items/energy.png",
  };
  const critical = [
    "normal",
    "day",
    "cloudWall",
    "rainbowGate",
    "star",
    "energy",
  ];
  const images = Object.create(null);

  class AssetLoader {
    load(keys, progress) {
      let done = 0;
      return Promise.all(
        keys.map(
          (key) =>
            new Promise((resolve) => {
              const img = new Image();
              images[key] = img;
              const finish = (ok) => {
                img.ok = ok;
                done++;
                progress?.(done / keys.length);
                resolve(ok);
              };
              img.onload = () => finish(true);
              img.onerror = () => finish(false);
              img.src = PATHS[key];
            }),
        ),
      );
    }
  }

  const storage = {
    memory: { best: 0, sound: true },
    get(key, fallback) {
      try {
        const value = localStorage.getItem(`xuanxuan-${key}`);
        return value === null ? fallback : JSON.parse(value);
      } catch {
        return this.memory[key] ?? fallback;
      }
    },
    set(key, value) {
      this.memory[key] = value;
      try {
        localStorage.setItem(`xuanxuan-${key}`, JSON.stringify(value));
      } catch {}
    },
  };

  class AudioSystem {
    constructor() {
      this.enabled = storage.get("sound", true);
      this.ctx = null;
      this.unlocked = false;
      this.lastLaugh = -Infinity;
      this.lastLaughIndex = -1;
      this.laughs = [
        "./assets/audio/baby-laugh-1.mp3",
        "./assets/audio/baby-laugh-2.mp3",
        "./assets/audio/baby-laugh-3.mp3",
      ].map((src) => {
        const a = new Audio(src);
        a.preload = "metadata";
        a.volume = 0.34;
        return a;
      });
      this.boostOsc = null;
    }
    unlock() {
      if (this.unlocked) return;
      this.unlocked = true;
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.ctx.resume();
      } catch {
        this.ctx = null;
      }
    }
    toggle() {
      this.enabled = !this.enabled;
      storage.set("sound", this.enabled);
      if (!this.enabled) {
        this.stopBoost();
        this.laughs.forEach((a) => {
          a.pause();
          a.currentTime = 0;
        });
      }
      updateSoundUI();
    }
    tone(freq, duration = 0.12, type = "sine", gain = 0.05, delay = 0) {
      if (!this.enabled || !this.ctx) return;
      try {
        const now = this.ctx.currentTime + delay,
          o = this.ctx.createOscillator(),
          g = this.ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, now);
        g.gain.setValueAtTime(0.001, now);
        g.gain.exponentialRampToValueAtTime(gain, now + 0.015);
        g.gain.exponentialRampToValueAtTime(0.001, now + duration);
        o.connect(g).connect(this.ctx.destination);
        o.start(now);
        o.stop(now + duration + 0.03);
      } catch {}
    }
    play(kind) {
      if (kind === "star") this.tone(760, 0.12, "sine", 0.045);
      if (kind === "perfect") {
        this.tone(650, 0.16, "sine", 0.045);
        this.tone(940, 0.2, "sine", 0.04, 0.09);
      }
      if (kind === "hit") this.tone(120, 0.25, "triangle", 0.07);
      if (kind === "heart") {
        this.tone(520, 0.14, "sine", 0.04);
        this.tone(680, 0.18, "sine", 0.04, 0.1);
      }
    }
    startBoost() {
      if (!this.enabled || !this.ctx || this.boostOsc) return;
      try {
        const o = this.ctx.createOscillator(),
          g = this.ctx.createGain();
        o.type = "sine";
        o.frequency.value = 82;
        g.gain.value = 0.018;
        o.connect(g).connect(this.ctx.destination);
        o.start();
        this.boostOsc = { o, g };
      } catch {}
    }
    stopBoost() {
      if (!this.boostOsc) return;
      try {
        this.boostOsc.g.gain.exponentialRampToValueAtTime(
          0.001,
          this.ctx.currentTime + 0.08,
        );
        this.boostOsc.o.stop(this.ctx.currentTime + 0.1);
      } catch {}
      this.boostOsc = null;
    }
    maybeLaugh(chance = 0.2) {
      const now = performance.now() / 1000;
      if (
        !this.enabled ||
        !this.unlocked ||
        now - this.lastLaugh < 10 ||
        Math.random() > chance
      )
        return;
      let i = Math.floor(Math.random() * this.laughs.length);
      if (i === this.lastLaughIndex) i = (i + 1) % this.laughs.length;
      this.lastLaughIndex = i;
      this.lastLaugh = now;
      const a = this.laughs[i];
      a.currentTime = 0;
      a.play().catch(() => {});
    }
  }
  const audio = new AudioSystem();

  class ParticleSystem {
    constructor() {
      this.items = [];
      this.max = matchMedia("(pointer:coarse)").matches ? 450 : 700;
    }
    burst(x, y, count, color = "#fff4a8", power = 120, confetti = false) {
      count = Math.min(count, this.max - this.items.length);
      for (let i = 0; i < count; i++) {
        const a = random(0, Math.PI * 2),
          s = random(power * 0.25, power);
        this.items.push({
          x,
          y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s,
          life: random(0.45, 1.1),
          max: 1.1,
          size: random(2, 7),
          color,
          confetti,
          rot: random(0, 6),
        });
      }
    }
    trail(x, y) {
      if (this.items.length < this.max)
        this.items.push({
          x,
          y,
          vx: random(-210, -90),
          vy: random(-20, 20),
          life: 0.35,
          max: 0.35,
          size: random(2, 5),
          color: Math.random() > 0.5 ? "#fff5a5" : "#d7c8ff",
        });
    }
    update(dt) {
      for (const p of this.items) {
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += (p.confetti ? 90 : 12) * dt;
        p.rot = (p.rot || 0) + dt * 4;
      }
      this.items = this.items.filter((p) => p.life > 0);
    }
    draw() {
      for (const p of this.items) {
        ctx.save();
        ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
        ctx.fillStyle = p.color;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot || 0);
        if (p.confetti) ctx.fillRect(-p.size, -p.size / 2, p.size * 2, p.size);
        else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }
    clear() {
      this.items.length = 0;
    }
  }

  let W = innerWidth,
    H = innerHeight,
    dpr = 1,
    state = STATES.LOADING,
    lastTime = performance.now(),
    best = Number(storage.get("best", 0)) || 0;
  const game = {
    elapsed: 0,
    score: 0,
    displayScore: 0,
    health: 3,
    combo: 0,
    boostEnergy: 100,
    boostHeld: false,
    boosting: false,
    worldSpeed: 180,
    shake: 0,
    newRecord: false,
    obstacleTimer: 1.8,
    collectibleTimer: 1,
    parallax: { far: 0, mid: 0, foreground: 0 },
  };
  const player = {
    x: 0,
    y: 0,
    targetY: 0,
    w: 125,
    h: 125,
    vy: 0,
    rotation: 0,
    state: CHARACTER.NORMAL,
    stateUntil: 0,
    scale: 1,
    invincible: 0,
    hitFlash: 0,
  };
  const particles = new ParticleSystem();
  let obstacles = [],
    collectibles = [],
    pointer = { active: false, id: null, lastY: 0 },
    toastTimer = 0,
    comboTimer = 0;

  function resize() {
    W = innerWidth;
    H = innerHeight;
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    player.w = clamp(Math.min(W, H) * 0.19, 92, 138);
    player.h = player.w;
    player.x = W * 0.27;
    player.y = clamp(player.y || H * 0.5, player.h * 0.45, H - player.h * 0.45);
    player.targetY = clamp(
      player.targetY || player.y,
      player.h * 0.4,
      H - player.h * 0.4,
    );
  }
  function showScreen(which) {
    [ui.loading, ui.menu, $("pause-screen"), $("game-over")].forEach((x) =>
      x.classList.remove("active"),
    );
    if (which) which.classList.add("active");
    ui.hud.classList.toggle(
      "active",
      state === STATES.PLAYING || state === STATES.PAUSED,
    );
  }
  function setCharacterState(next, duration = 0) {
    player.state = next;
    player.stateUntil = duration ? game.elapsed + duration : Infinity;
  }
  function characterKey() {
    return {
      NORMAL: "normal",
      HAPPY: "happy",
      EXCITED: "excited",
      WOW: "wow",
      HURT: "hurt",
      SUPER_HAPPY: "superHappy",
    }[player.state];
  }
  function resetGame() {
    Object.assign(game, {
      elapsed: 0,
      score: 0,
      displayScore: 0,
      health: 3,
      combo: 0,
      boostEnergy: 100,
      boostHeld: false,
      boosting: false,
      worldSpeed: 180,
      shake: 0,
      newRecord: false,
      obstacleTimer: 2.5,
      collectibleTimer: 1.1,
      parallax: { far: 0, mid: 0, foreground: 0 },
    });
    obstacles = [];
    collectibles = [];
    particles.clear();
    player.x = W * 0.27;
    player.y = H * 0.5;
    player.targetY = H * 0.5;
    player.vy = 0;
    player.rotation = 0;
    player.invincible = 0;
    player.scale = 1;
    setCharacterState(CHARACTER.NORMAL);
    updateHUD(true);
    audio.stopBoost();
  }
  function startGame() {
    audio.unlock();
    resetGame();
    state = STATES.PLAYING;
    showScreen(null);
    lastTime = performance.now();
  }
  function restartGame() {
    startGame();
  }
  function goHome() {
    state = STATES.MENU;
    game.boostHeld = false;
    audio.stopBoost();
    ui.menuBest.textContent = best;
    showScreen(ui.menu);
  }
  function togglePause() {
    if (state === STATES.PLAYING) {
      state = STATES.PAUSED;
      game.boostHeld = false;
      audio.stopBoost();
      showScreen($("pause-screen"));
    } else if (state === STATES.PAUSED) {
      state = STATES.PLAYING;
      showScreen(null);
      lastTime = performance.now();
    }
  }

  const obstacleConfig = {
    cloudWall: { size: [150, 210], hit: 0.64 },
    balloons: { size: [100, 145], hit: 0.48 },
    rainbowGate: { size: [190, 250], hit: 0.88 },
    planet: { size: [105, 145], hit: 0.52 },
    bird: { size: [72, 94], hit: 0.48 },
  };
  class ObstacleManager {
    spawn() {
      const t = game.elapsed;
      let pool =
        t < 20
          ? ["cloudWall", "rainbowGate"]
          : t < 45
            ? ["cloudWall", "rainbowGate", "balloons", "planet"]
            : ["cloudWall", "rainbowGate", "balloons", "planet", "bird"];
      const type = pool[Math.floor(Math.random() * pool.length)],
        cfg = obstacleConfig[type],
        size = random(...cfg.size) * clamp(H / 720, 0.72, 1.15),
        margin = size * 0.52 + 25;
      let y = random(margin, H - margin);
      if (type === "cloudWall") y = Math.random() > 0.5 ? margin : H - margin;
      if (type === "rainbowGate")
        y = clamp(H * 0.5 + random(-H * 0.1, H * 0.1), margin, H - margin);
      obstacles.push({
        type,
        x: W + Math.max(120, game.worldSpeed * 1.1),
        y,
        baseY: y,
        w: size,
        h: size,
        phase: random(0, 6.28),
        hit: cfg.hit,
        hitPlayer: false,
        near: false,
        perfect: false,
        passed: false,
      });
      const reaction = clamp(2.5 - game.elapsed / 120, 1.45, 2.5);
      game.obstacleTimer = reaction + random(0.5, 1.2);
    }
    update(dt) {
      game.obstacleTimer -= dt;
      if (game.obstacleTimer <= 0) this.spawn();
      for (const o of obstacles) {
        o.x -= game.worldSpeed * dt;
        o.phase += dt;
        if (o.type === "bird")
          o.y = o.baseY + Math.sin(o.phase * 2.5) * H * 0.055;
        if (o.type === "balloons")
          o.y = o.baseY + Math.sin(o.phase * 1.4) * H * 0.025;
        this.check(o);
      }
      obstacles = obstacles.filter((o) => o.x > -o.w);
    }
    hitboxes(o) {
      if (o.type === "rainbowGate") {
        const bar = o.h * 0.2;
        return [
          { x: o.x - o.w * 0.38, y: o.y - o.h * 0.43, w: o.w * 0.76, h: bar },
          { x: o.x - o.w * 0.38, y: o.y + o.h * 0.23, w: o.w * 0.76, h: bar },
        ];
      }
      const k = o.hit;
      return [
        {
          x: o.x - (o.w * k) / 2,
          y: o.y - (o.h * k) / 2,
          w: o.w * k,
          h: o.h * k,
        },
      ];
    }
    check(o) {
      const ph = playerHitbox(),
        near = expand(ph, 24);
      let hit = false,
        close = false;
      for (const box of this.hitboxes(o)) {
        hit ||= ellipseRect(ph, box);
        close ||= ellipseRect(near, box);
      }
      if (hit && !o.hitPlayer && player.invincible <= 0) {
        o.hitPlayer = true;
        takeHit();
      } else if (close && !hit) o.near = true;
      if (!o.passed && o.x + o.w * 0.5 < player.x - player.w * 0.25) {
        o.passed = true;
        if (o.near && !o.hitPlayer && !o.perfect) {
          o.perfect = true;
          perfect();
        }
      }
    }
    draw() {
      for (const o of obstacles) {
        drawImageSafe(
          images[o.type],
          o.x - o.w / 2,
          o.y - o.h / 2,
          o.w,
          o.h,
          "#dccbf2",
        );
        if (DEBUG_HITBOX) {
          ctx.strokeStyle = "red";
          for (const b of this.hitboxes(o)) ctx.strokeRect(b.x, b.y, b.w, b.h);
        }
      }
    }
  }
  const obstacleManager = new ObstacleManager();

  class CollectibleManager {
    spawn() {
      const roll = Math.random();
      let type =
        roll < 0.58
          ? "star"
          : roll < 0.71
            ? "bigStar"
            : roll < 0.84
              ? "energy"
              : "heart";
      if (type === "heart" && game.health === 3 && Math.random() < 0.6)
        type = "star";
      const isLucky = type === "bigStar" && Math.random() < 0.18;
      const size = (type === "bigStar" ? 65 : 50) * clamp(H / 720, 0.8, 1.15),
        y = random(size, H - size);
      collectibles.push({
        type,
        isLucky,
        x: W + 80,
        y,
        w: size,
        h: size,
        phase: random(0, 6.2),
        taken: false,
      });
      game.collectibleTimer = random(1.2, 2.4);
    }
    update(dt) {
      game.collectibleTimer -= dt;
      if (game.collectibleTimer <= 0) this.spawn();
      const ph = playerHitbox();
      for (const c of collectibles) {
        c.x -= game.worldSpeed * dt;
        c.phase += dt;
        c.y += Math.sin(c.phase * 2) * 5 * dt;
        if (
          !c.taken &&
          ellipseRect(ph, {
            x: c.x - c.w * 0.3,
            y: c.y - c.h * 0.3,
            w: c.w * 0.6,
            h: c.h * 0.6,
          })
        ) {
          c.taken = true;
          collect(c);
        }
      }
      collectibles = collectibles.filter((c) => !c.taken && c.x > -c.w);
    }
    draw() {
      for (const c of collectibles) {
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(Math.sin(c.phase) * 0.08);
        const pulse = 1 + Math.sin(c.phase * 3) * 0.05;
        drawImageSafe(
          images[c.type],
          (-c.w * pulse) / 2,
          (-c.h * pulse) / 2,
          c.w * pulse,
          c.h * pulse,
          "#fff19a",
        );
        ctx.restore();
      }
    }
  }
  const collectibleManager = new CollectibleManager();

  function playerHitbox() {
    return {
      x: player.x - player.w * 0.27,
      y: player.y - player.h * 0.22,
      rx: player.w * 0.27,
      ry: player.h * 0.22,
    };
  }
  function expand(e, n) {
    return { x: e.x, y: e.y, rx: e.rx + n, ry: e.ry + n };
  }
  function ellipseRect(e, r) {
    const cx = clamp(e.x, r.x, r.x + r.w),
      cy = clamp(e.y, r.y, r.y + r.h),
      dx = (e.x - cx) / e.rx,
      dy = (e.y - cy) / e.ry;
    return dx * dx + dy * dy < 1;
  }
  function collect(c) {
    const mult = 1 + Math.min(game.combo, 10) * 0.05;
    let points = 0;
    if (c.type === "star") {
      points = 10;
      audio.play("star");
    }
    if (c.type === "bigStar") {
      points = c.isLucky ? 120 : 50;
      game.boostEnergy = clamp(
        game.boostEnergy + (c.isLucky ? 20 : 10),
        0,
        100,
      );
      audio.play("perfect");
    }
    if (c.type === "energy") {
      game.boostEnergy = clamp(game.boostEnergy + 38, 0, 100);
      points = 5;
      audio.play("star");
    }
    if (c.type === "heart") {
      if (game.health < 3) game.health++;
      else points = 35;
      audio.play("heart");
    }
    if (c.type === "star" || c.type === "bigStar") {
      game.combo++;
      checkCombo();
    }
    game.score += points * mult;
    player.scale = 1.1;
    setCharacterState(
      c.isLucky ? CHARACTER.SUPER_HAPPY : CHARACTER.HAPPY,
      c.isLucky ? 1.5 : 0.65,
    );
    particles.burst(
      c.x,
      c.y,
      c.isLucky ? 38 : 16,
      c.isLucky ? "#ffd66e" : "#fff4a1",
      c.isLucky ? 220 : 130,
      c.isLucky,
    );
    if (c.isLucky) {
      toast("LUCKY STAR! +120");
      audio.maybeLaugh(0.32);
    }
  }
  function perfect() {
    game.score += 30 * (1 + Math.min(game.combo, 10) * 0.05);
    game.combo++;
    setCharacterState(CHARACTER.WOW, 0.55);
    particles.burst(player.x + player.w * 0.3, player.y, 22, "#fff1a0", 180);
    audio.play("perfect");
    toast("PERFECT! +30");
    checkCombo();
    setTimeout(() => {
      if (state === STATES.PLAYING && player.state === CHARACTER.WOW)
        setCharacterState(CHARACTER.HAPPY, 0.45);
    }, 550);
  }
  function checkCombo() {
    if (game.combo >= 2) {
      ui.combo.textContent = `COMBO ×${game.combo}`;
      ui.combo.classList.add("show");
      comboTimer = 1.4;
    }
    if (game.combo === 5 || game.combo === 10) {
      particles.burst(
        player.x,
        player.y,
        game.combo === 10 ? 45 : 25,
        "#f8c7e4",
        190,
        true,
      );
      setCharacterState(CHARACTER.SUPER_HAPPY, 1.2);
      audio.maybeLaugh(game.combo === 10 ? 0.42 : 0.22);
    }
  }
  function takeHit() {
    game.health--;
    game.combo = 0;
    ui.combo.classList.remove("show");
    player.invincible = 1;
    player.hitFlash = 1;
    game.shake = 0.28;
    setCharacterState(CHARACTER.HURT, 1);
    particles.burst(player.x, player.y, 20, "#ffffff", 150);
    audio.play("hit");
    if (game.health <= 0) endGame();
  }
  function endGame() {
    state = STATES.GAME_OVER;
    audio.stopBoost();
    const final = Math.floor(game.score),
      previous = best;
    game.newRecord = final > previous;
    if (game.newRecord) {
      best = final;
      storage.set("best", best);
      setCharacterState(CHARACTER.SUPER_HAPPY);
      particles.burst(W * 0.5, H * 0.35, 90, "#ffd87c", 270, true);
      audio.maybeLaugh(0.5);
    } else setCharacterState(CHARACTER.HURT);
    $("final-score").textContent = final;
    $("final-best").textContent = best;
    $("record-badge").classList.toggle("show", game.newRecord);
    ui.menuBest.textContent = best;
    setTimeout(() => {
      if (state === STATES.GAME_OVER) showScreen($("game-over"));
    }, 350);
  }
  function toast(text) {
    ui.toast.textContent = text;
    ui.toast.classList.add("show");
    toastTimer = 1.25;
  }

  function update(dt) {
    game.elapsed += dt;
    game.worldSpeed = 180 + Math.min(game.elapsed, 140) * 1.1;
    const wants = game.boostHeld && game.boostEnergy > 0;
    if (wants) {
      game.boostEnergy = clamp(game.boostEnergy - 22 * dt, 0, 100);
      if (!game.boosting) audio.startBoost();
      game.boosting = true;
      if (
        player.state === CHARACTER.NORMAL ||
        player.state === CHARACTER.EXCITED
      )
        setCharacterState(CHARACTER.EXCITED);
    } else {
      game.boostEnergy = clamp(game.boostEnergy + 10 * dt, 0, 100);
      if (game.boosting) audio.stopBoost();
      game.boosting = false;
      if (player.state === CHARACTER.EXCITED)
        setCharacterState(CHARACTER.NORMAL);
    }
    if (game.boostEnergy <= 0) game.boostHeld = false;
    const base = 180 + Math.min(game.elapsed, 140) * 1.1;
    game.worldSpeed = base * (game.boosting ? 1.5 : 1);
    game.score += dt * 5 * (game.boosting ? 1.5 : 1);
    game.displayScore = lerp(
      game.displayScore,
      game.score,
      1 - Math.exp(-8 * dt),
    );
    const oldY = player.y,
      follow = 1 - Math.exp(-8.5 * dt);
    player.y += (player.targetY - player.y) * follow;
    player.y = clamp(player.y, player.h * 0.34, H - player.h * 0.34);
    player.vy = (player.y - oldY) / Math.max(dt, 0.001);
    player.rotation = lerp(
      player.rotation,
      clamp(player.vy / 900, -0.14, 0.14) + (game.boosting ? -0.04 : 0),
      1 - Math.exp(-9 * dt),
    );
    player.scale = lerp(player.scale, 1, 1 - Math.exp(-7 * dt));
    player.invincible = Math.max(0, player.invincible - dt);
    player.hitFlash = Math.max(0, player.hitFlash - dt);
    game.shake = Math.max(0, game.shake - dt);
    if (player.stateUntil !== Infinity && game.elapsed >= player.stateUntil)
      setCharacterState(game.boosting ? CHARACTER.EXCITED : CHARACTER.NORMAL);
    if (game.boosting && Math.random() < dt * 38)
      particles.trail(player.x - player.w * 0.3, player.y + random(-12, 12));
    obstacleManager.update(dt);
    collectibleManager.update(dt);
    particles.update(dt);
    for (const key of ["far", "mid", "foreground"]) {
      const rate = { far: 0.2, mid: 0.42, foreground: 0.78 }[key];
      game.parallax[key] =
        (game.parallax[key] + game.worldSpeed * rate * dt) % W;
    }
    if (toastTimer > 0 && (toastTimer -= dt) <= 0)
      ui.toast.classList.remove("show");
    if (comboTimer > 0 && (comboTimer -= dt) <= 0)
      ui.combo.classList.remove("show");
    updateHUD();
  }

  function coverImage(img, alpha = 1) {
    if (!img?.ok) return;
    const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight),
      dw = img.naturalWidth * scale,
      dh = img.naturalHeight * scale;
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.globalAlpha = 1;
  }
  function drawBackground() {
    ctx.fillStyle = "#bde9fb";
    ctx.fillRect(0, 0, W, H);
    let aSun = clamp((game.elapsed - 39) / 7, 0, 1),
      aNight = clamp((game.elapsed - 84) / 7, 0, 1);
    coverImage(images.day, 1);
    coverImage(images.sunset, aSun);
    coverImage(images.night, aNight);
    drawParallax("far", images.far);
    drawParallax("mid", images.mid);
  }
  function drawParallax(key, img) {
    if (!img?.ok) return;
    const scale = H / img.naturalHeight,
      dw = img.naturalWidth * scale + 1,
      dh = H,
      off = -(game.parallax[key] % dw);
    for (let x = off - dw; x < W + dw; x += dw - 1)
      ctx.drawImage(img, x, 0, dw, dh);
  }
  function drawImageSafe(img, x, y, w, h, color) {
    if (img?.ok) ctx.drawImage(img, x, y, w, h);
    else {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  function drawPlayer() {
    ctx.save();
    let sx = 0,
      sy = Math.sin(game.elapsed * 2.7) * 3;
    if (game.shake > 0) {
      sx = random(-4, 4);
      sy += random(-3, 3);
    }
    ctx.translate(player.x + sx, player.y + sy);
    ctx.rotate(player.rotation);
    ctx.scale(player.scale, player.scale);
    if (player.invincible > 0 && Math.floor(player.invincible * 12) % 2 === 0)
      ctx.globalAlpha = 0.35;
    drawImageSafe(
      images[characterKey()],
      -player.w / 2,
      -player.h / 2,
      player.w,
      player.h,
      "#fff8dd",
    );
    if (DEBUG_HITBOX) {
      const p = playerHitbox();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = "lime";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawSpeedLines() {
    if (!game.boosting) return;
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = "#fffde2";
    ctx.lineWidth = 2;
    for (let i = 0; i < 13; i++) {
      const y = (i * 71 + game.elapsed * 130) % H,
        x = (i * 137 - game.elapsed * 500) % (W + 220);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + random(70, 170), y);
      ctx.stroke();
    }
    ctx.restore();
  }
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackground();
    if (state !== STATES.MENU && state !== STATES.LOADING) {
      drawSpeedLines();
      collectibleManager.draw();
      obstacleManager.draw();
      drawPlayer();
      particles.draw();
      drawParallax("foreground", images.foreground);
    }
  }
  function updateHUD(force = false) {
    const shown = Math.floor(force ? game.score : game.displayScore);
    ui.score.textContent = shown;
    ui.best.textContent = Math.max(best, shown);
    ui.hearts.textContent =
      "♥ ".repeat(game.health).trim() + " ♡ ".repeat(3 - game.health).trim();
    ui.hearts.setAttribute("aria-label", `剩余 ${game.health} 颗心`);
    ui.boostFill.style.width = game.boostEnergy + "%";
    ui.boostValue.textContent = Math.ceil(game.boostEnergy);
    ui.boostMeter.classList.toggle("on", game.boosting);
    ui.boostMeter.classList.toggle("low", game.boostEnergy < 20);
    ui.boostButton.classList.toggle("pressed", game.boosting);
    ui.boostButton.classList.toggle("empty", game.boostEnergy <= 0);
  }
  function loop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    if (state === STATES.PLAYING) update(dt);
    draw();
    requestAnimationFrame(loop);
  }
  function updateSoundUI() {
    const label = audio.enabled ? "🔊" : "🔇";
    $("sound-button").textContent = label;
    $("menu-sound").textContent =
      `${label} 声音${audio.enabled ? "开启" : "关闭"}`;
  }
  function setBoost(on) {
    if (state === STATES.PLAYING) game.boostHeld = on;
    else if (!on) game.boostHeld = false;
  }

  function bindEvents() {
    addEventListener("resize", resize, { passive: true });
    addEventListener("orientationchange", () => setTimeout(resize, 100), {
      passive: true,
    });
    canvas.addEventListener("pointermove", (e) => {
      if (state !== STATES.PLAYING) return;
      if (pointer.active && e.pointerId === pointer.id) {
        const dy = e.clientY - pointer.lastY;
        player.targetY = clamp(
          player.targetY + dy * 1.15,
          player.h * 0.35,
          H - player.h * 0.35,
        );
        pointer.lastY = e.clientY;
      } else if (e.pointerType === "mouse")
        player.targetY = clamp(e.clientY, player.h * 0.35, H - player.h * 0.35);
    });
    canvas.addEventListener("pointerdown", (e) => {
      if (state !== STATES.PLAYING) return;
      pointer = { active: true, id: e.pointerId, lastY: e.clientY };
      canvas.setPointerCapture?.(e.pointerId);
    });
    const pointerUp = (e) => {
      if (e.pointerId === pointer.id) pointer.active = false;
    };
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);
    addEventListener("keydown", (e) => {
      if (e.code === "Space") {
        e.preventDefault();
        setBoost(true);
      }
      if (
        e.code === "Escape" &&
        (state === STATES.PLAYING || state === STATES.PAUSED)
      )
        togglePause();
    });
    addEventListener("keyup", (e) => {
      if (e.code === "Space") {
        e.preventDefault();
        setBoost(false);
      }
    });
    addEventListener("blur", () => {
      setBoost(false);
      if (state === STATES.PLAYING) togglePause();
    });
    const boost = $("boost-button");
    boost.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      boost.setPointerCapture?.(e.pointerId);
      setBoost(true);
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((name) =>
      boost.addEventListener(name, (e) => {
        e.preventDefault();
        setBoost(false);
      }),
    );
    $("start-button").addEventListener("click", startGame);
    $("pause-button").addEventListener("click", togglePause);
    $("resume-button").addEventListener("click", togglePause);
    $("restart-pause").addEventListener("click", restartGame);
    $("restart-over").addEventListener("click", restartGame);
    $("home-pause").addEventListener("click", goHome);
    $("home-over").addEventListener("click", goHome);
    $("sound-button").addEventListener("click", () => audio.toggle());
    $("menu-sound").addEventListener("click", () => audio.toggle());
  }

  async function init() {
    resize();
    bindEvents();
    updateSoundUI();
    ui.menuBest.textContent = best;
    const loader = new AssetLoader();
    await loader.load(critical, (p) => {
      $("loading-fill").style.width = `${p * 100}%`;
      $("loading-text").textContent =
        `正在准备萱萱的小飞机… ${Math.round(p * 100)}%`;
    });
    state = STATES.MENU;
    showScreen(ui.menu);
    loader.load(Object.keys(PATHS).filter((k) => !critical.includes(k)));
    requestAnimationFrame(loop);
  }
  init();
})();
