// Campus Wellbeing: ink painting on xuan paper, after the spirit of Bada Shanren.
//
// Everything decorative is painted here with Canvas2D and handed to the page as a
// finished canvas or image. Nothing in this file touches the app's state or the server.
//
// Design rule: every mark is INK at some alpha. Seal red belongs to the stylesheet.
// Blurs are made by shrinking a layer and stretching it back, not with ctx.filter,
// because Safari does not support ctx.filter and this must run on any computer.

const Ink = (() => {
  const INK = '20,17,14';          // #14110e, the only ink
  const TAU = Math.PI * 2;

  // ---------- fixed randomness: the same seed paints the same picture on every refresh ----------

  function hashSeed(text) {
    let h = 2166136261;
    for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
  }

  function random(seed) {
    let s = hashSeed(seed);
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Smooth 1D noise from 0 to 1. It decides where a bristle skips on the paper.
  function noise(x, seed) {
    const lump = (i) => {
      const v = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
      return v - Math.floor(v);
    };
    const i = Math.floor(x), f = x - i, e = f * f * (3 - 2 * f);
    return lump(i) * (1 - e) + lump(i + 1) * e;
  }

  function newCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    return canvas;
  }

  // ---------- paths ----------

  // Round the corners of a hand-placed path (Catmull-Rom), so a stroke never looks ruled.
  function smooth(points, closed = false) {
    const n = points.length;
    const at = (i) => (closed ? points[(i + n) % n] : points[Math.max(0, Math.min(n - 1, i))]);
    const out = [];
    const spans = closed ? n : n - 1;
    for (let i = 0; i < spans; i++) {
      const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
      for (let k = 0; k < 10; k++) {
        const t = k / 10, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map((a) => 0.5 * (2 * p1[a] + (p2[a] - p0[a]) * t
          + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2
          + (3 * p1[a] - p0[a] - 3 * p2[a] + p3[a]) * t3)));
      }
    }
    if (!closed) out.push(points[n - 1]);
    return out;
  }

  // Walk a path and return evenly spaced points, so bristles move at a steady speed.
  function resample(points, step) {
    const out = [points[0]];
    let left = step;
    for (let i = 1; i < points.length; i++) {
      let [ax, ay] = points[i - 1];
      const [bx, by] = points[i];
      let length = Math.hypot(bx - ax, by - ay);
      while (length >= left && length > 0) {
        const t = left / length;
        ax += (bx - ax) * t;
        ay += (by - ay) * t;
        out.push([ax, ay]);
        length = Math.hypot(bx - ax, by - ay);
        left = step;
      }
      left -= length;
    }
    return out;
  }

  // Brush pressure along a stroke: a slightly heavy start, a steady middle, a thin lift.
  function pressure(s) {
    if (s < 0.08) return 0.75 + (s / 0.08) * 0.35;
    if (s < 0.7) return 1.1 - ((s - 0.08) / 0.62) * 0.2;
    return 0.9 - ((s - 0.7) / 0.3) * 0.65;
  }

  // ---------- the three brushes ----------

  // brushStroke: requirement 1. N bristles each draw their own line; each runs out of
  // ink along the way and skips with noise, so the end of a stroke opens into white
  // threads of bare paper: flying white.
  function brushStroke(ctx, points, options = {}) {
    const width = options.width ?? 6;
    const alpha = options.alpha ?? 0.9;
    const dry = options.dry ?? 0.4;
    const press = options.press ?? pressure;
    const seed = options.seed ?? 'stroke';
    const rand = random(seed);
    const path = resample(options.raw ? points : smooth(points), 1.1);
    const count = path.length;
    if (count < 2) return;

    const bristles = Math.max(6, Math.min(64, Math.round(width * 1.7 + 4)));
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgb(${INK})`;

    for (let b = 0; b < bristles; b++) {
      const across = ((b + 0.5) / bristles) * 2 - 1 + (rand() - 0.5) * (1.2 / bristles);
      const edge = Math.abs(across);
      const start = 1 - 0.45 * edge * edge + (rand() - 0.5) * 0.25;  // the edges hold less ink
      const fade = dry * (0.5 + rand() * 1.2) * (0.7 + 0.6 * edge);
      const bristleSeed = rand() * 1000;
      const clumpSeed = Math.floor(b / 4) * 7.3;                      // bristles part in clumps
      ctx.lineWidth = Math.max(0.35, (width / bristles) * 1.6 * (0.8 + rand() * 0.4));
      const strength = alpha * (0.84 + rand() * 0.16);

      let open = false;
      let wasFaint = false;
      for (let i = 0; i < count; i++) {
        const s = i / (count - 1);
        const before = path[Math.max(0, i - 1)], after = path[Math.min(count - 1, i + 1)];
        const dx = after[0] - before[0], dy = after[1] - before[1];
        const length = Math.hypot(dx, dy) || 1;
        const reach = (across * width * press(s)) / 2;
        const x = path[i][0] - (dy / length) * reach;
        const y = path[i][1] + (dx / length) * reach;

        const ink = start - fade * Math.pow(s, 1.3) * 2.1
          + (noise(i / 9, bristleSeed) - 0.5) * (0.1 + dry)
          + (noise(i / 26, clumpSeed) - 0.5) * dry * 1.6;
        const touches = ink > 0.12;
        const faint = ink < 0.32;

        if (touches && (!open || faint !== wasFaint)) {
          if (open) { ctx.lineTo(x, y); ctx.stroke(); }
          ctx.globalAlpha = Math.min(1, strength * (faint ? 0.55 : 1));
          ctx.beginPath();
          ctx.moveTo(x, y);
          open = true;
        } else if (touches) {
          ctx.lineTo(x, y);
        } else if (open) {
          ctx.stroke();
          open = false;
        }
        wasFaint = faint;
      }
      if (open) ctx.stroke();
    }
    ctx.restore();
  }

  // wash: requirement 2. A soft pale pool of ink. The edge is a little darker, where
  // ink gathers as it dries, and noise lifts patches out so it looks mottled.
  function wash(ctx, polygon, options = {}) {
    const alpha = options.alpha ?? 0.25;
    const soft = Math.max(2, options.soft ?? 6);
    const rand = random(options.seed ?? 'wash');
    const target = ctx.canvas;
    const small = newCanvas(target.width / soft, target.height / soft);
    const paint = small.getContext('2d');
    const m = ctx.getTransform();
    paint.setTransform(m.a / soft, m.b / soft, m.c / soft, m.d / soft, m.e / soft, m.f / soft);

    const outline = new Path2D();
    smooth(polygon, true).forEach(([x, y], i) => (i ? outline.lineTo(x, y) : outline.moveTo(x, y)));
    outline.closePath();
    paint.fillStyle = `rgba(${INK},${alpha})`;
    paint.fill(outline);
    if (options.edge !== false) {
      paint.strokeStyle = `rgba(${INK},${Math.min(1, alpha * 1.1)})`;
      paint.lineWidth = soft * 0.8;
      paint.stroke(outline);
    }

    // Mottling: bare patches lifted out of the pool
    paint.setTransform(1, 0, 0, 1, 0, 0);
    paint.globalCompositeOperation = 'destination-out';
    const patches = Math.round(small.width * small.height * 0.012);
    for (let i = 0; i < patches; i++) {
      paint.globalAlpha = 0.1 + rand() * 0.3;
      paint.beginPath();
      paint.arc(rand() * small.width, rand() * small.height, 1 + rand() * rand() * 7, 0, TAU);
      paint.fill();
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, target.width, target.height);
    ctx.restore();
  }

  // bleed: requirement 3. A blurred copy goes down first and the sharp painting on top,
  // so the ink seems to have soaked into the paper fibres.
  function bleed(ctx, canvas, options = {}) {
    const soft = options.soft ?? 5;
    const small = newCanvas(canvas.width / soft, canvas.height / soft);
    const paint = small.getContext('2d');
    paint.imageSmoothingQuality = 'high';
    paint.drawImage(canvas, 0, 0, small.width, small.height);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = options.alpha ?? 0.3;
    ctx.drawImage(small, 0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.globalAlpha = 1;
    ctx.drawImage(canvas, 0, 0);
    ctx.restore();
  }

  // ---------- paintings ----------

  // A sheet at CSS size width x height, sharp on high-density screens.
  function sheet(width, height) {
    const scale = Math.min(2.5, Math.max(1.5, window.devicePixelRatio || 1));
    const canvas = newCanvas(width * scale, height * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    return { canvas, ctx };
  }

  // Finish a painting: lay it down again on a fresh sheet with its bleed underneath.
  function soaked(layer, width, height) {
    const done = sheet(width, height);
    bleed(done.ctx, layer.canvas);
    return done.canvas;
  }

  // The lotus for the welcome and Today pages: requirement "bent stem, drooping leaf".
  // The stem and leaf are separate so that only the leaf can sway.
  const LOTUS = { width: 320, height: 520, joint: [132, 150] };

  function paintLotusStem() {
    const { width, height } = LOTUS;
    const layer = sheet(width, height);
    const stem = [[236, 520], [250, 430], [240, 330], [208, 240], [168, 178], [132, 150]];
    brushStroke(layer.ctx, stem, { width: 6, alpha: 0.9, dry: 0.5, seed: 'stem', press: (s) => 1 - s * 0.25 });

    // Small dark thorns, pressed on with the tip of the brush
    const rand = random('thorns');
    const path = smooth(stem);
    for (let k = 0; k < 11; k++) {
      const p = path[Math.floor(path.length * (0.1 + k * 0.075))];
      const side = k % 2 ? 1 : -1;
      const angle = 0.5 + rand() * 0.6;
      brushStroke(layer.ctx, [p, [p[0] + side * 4, p[1] - 3 * angle]],
        { width: 2, alpha: 0.8, dry: 0.15, seed: 'thorn' + k, raw: true });
    }
    return soaked(layer, width, height);
  }

  function paintLotusLeaf() {
    const { width, height } = LOTUS;
    const layer = sheet(width, height);
    const ctx = layer.ctx;
    const [jx, jy] = LOTUS.joint;
    // The whole leaf, hanging from the joint like a collapsed umbrella
    wash(ctx, [[jx, jy - 4], [166, 184], [156, 252], [128, 276], [90, 262], [58, 284], [26, 258], [16, 208], [44, 164], [92, 144]],
      { alpha: 0.26, soft: 5, seed: 'leaf' });
    // Broad side-brush strokes: a dark flank, a pale dry middle, a broken edge
    brushStroke(ctx, [[jx - 6, jy], [78, 168], [38, 206], [22, 262]], { width: 34, alpha: 0.92, dry: 0.5, seed: 'leaf-dark' });
    brushStroke(ctx, [[jx - 2, jy + 6], [108, 196], [88, 240], [78, 276]], { width: 36, alpha: 0.42, dry: 0.85, seed: 'leaf-pale' });
    brushStroke(ctx, [[jx + 6, jy + 4], [152, 186], [160, 226], [150, 262]], { width: 22, alpha: 0.78, dry: 0.65, seed: 'leaf-flank' });
    // Two thin veins, added once the leaf was half dry
    brushStroke(ctx, [[jx, jy + 2], [104, 196], [70, 236], [50, 270]], { width: 2.2, alpha: 0.9, dry: 0.45, seed: 'vein-a' });
    brushStroke(ctx, [[jx, jy + 2], [132, 202], [128, 246], [122, 272]], { width: 2, alpha: 0.85, dry: 0.5, seed: 'vein-b' });
    // The torn hem
    brushStroke(ctx, [[20, 258], [46, 276], [66, 270], [92, 258], [122, 272], [150, 256]], { width: 6, alpha: 0.85, dry: 0.75, seed: 'hem' });
    return soaked(layer, width, height);
  }

  // A white eye: bare paper inside one thin ring of ink. The pupil is not painted
  // here; it is a small element on the page, so that it can turn.
  function whiteEye(canvas, x, y, radius, seed) {
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, radius + 1, 0, TAU);
    ctx.fill();
    ctx.restore();
    const ring = [];
    for (let k = 0; k <= 26; k++) {
      const a = -2 + (k / 26) * 6.7;
      ring.push([x + Math.cos(a) * radius, y + Math.sin(a) * radius]);
    }
    brushStroke(ctx, ring, { width: 1.5, alpha: 0.95, dry: 0.08, seed, raw: true, press: () => 1 });
  }

  // Thin at both ends and full in the middle: the stroke of an orchid leaf or a feather.
  const leafPress = (s) => 0.15 + Math.sin(s * Math.PI) * 0.95;
  const taper = (s) => 1.05 - s * 0.95;

  // Sign-in page: a top-heavy rock with a one-legged bird glaring from the top of it.
  const BIRD = { width: 420, height: 400, eye: [244, 44, 7] };

  function paintBird() {
    const { width, height, eye } = BIRD;
    const layer = sheet(width, height);
    const ctx = layer.ctx;
    const stroke = (points, options, name) => brushStroke(ctx, points, { seed: 'rock-' + name, ...options });

    // The rock: rough and top-heavy, a pale mottled wash. The outline never closes:
    // it breaks and dries out, so the foot of the rock dissolves into the paper.
    wash(ctx, [[52, 214], [74, 170], [128, 160], [168, 146], [232, 152], [286, 142], [344, 176], [362, 222], [330, 250], [302, 246],
      [276, 286], [262, 332], [238, 378], [196, 388], [152, 372], [158, 330], [128, 300], [84, 272], [60, 250]],
      { alpha: 0.13, soft: 6, seed: 'rock' });
    // Shadow scumbled in with a nearly dry brush
    stroke([[150, 186], [136, 238], [168, 292], [176, 344]], { width: 30, alpha: 0.34, dry: 1.05 }, 'scumble-a');
    stroke([[326, 196], [290, 240], [252, 294]], { width: 32, alpha: 0.38, dry: 1.05 }, 'scumble-b');
    // The silhouette in three side-brush strokes, the darkest along the top
    stroke([[360, 216], [344, 176], [286, 144], [232, 154], [168, 148], [128, 162], [74, 172], [52, 216]], { width: 17, alpha: 0.92, dry: 0.58 }, 'top');
    stroke([[54, 218], [60, 252], [86, 274], [130, 302], [158, 332], [150, 374]], { width: 12, alpha: 0.8, dry: 0.86 }, 'left');
    stroke([[360, 222], [330, 252], [302, 248], [276, 288], [262, 334], [236, 382]], { width: 15, alpha: 0.84, dry: 0.76 }, 'right');
    // Two dry folds on the face, and a few moss dots along the top
    stroke([[246, 176], [212, 216], [192, 262], [200, 314]], { width: 8, alpha: 0.56, dry: 0.95 }, 'fold-a');
    stroke([[304, 188], [286, 226], [272, 262]], { width: 6, alpha: 0.5, dry: 0.95 }, 'fold-b');
    [[112, 158], [158, 146], [272, 140], [326, 162]].forEach(([x, y], k) => {
      stroke([[x - 4, y], [x + 5, y - 1]], { width: 7, alpha: 0.92, dry: 0.1, raw: true }, 'moss' + k);
    });

    // The bird, facing right towards the form
    const feather = (points, options, name) => brushStroke(ctx, points, { seed: 'bird-' + name, ...options });
    feather([[186, 92], [160, 66], [136, 36]], { width: 11, alpha: 0.95, dry: 0.45, press: taper }, 'tail-a');
    feather([[184, 98], [154, 80], [122, 62]], { width: 9, alpha: 0.9, dry: 0.55, press: taper }, 'tail-b');
    wash(ctx, [[176, 110], [190, 78], [224, 64], [256, 72], [258, 104], [230, 128], [196, 130]], { alpha: 0.52, soft: 2, seed: 'body' });
    feather([[250, 64], [214, 62], [186, 82], [172, 108]], { width: 20, alpha: 0.96, dry: 0.34 }, 'back');
    feather([[250, 92], [232, 118], [204, 128], [182, 120]], { width: 12, alpha: 0.6, dry: 0.68 }, 'belly');
    feather([[222, 86], [204, 98], [186, 112]], { width: 7, alpha: 0.85, dry: 0.6 }, 'wing');
    wash(ctx, [[232, 46], [244, 28], [264, 30], [272, 46], [264, 62], [242, 66]], { alpha: 0.95, soft: 2, seed: 'head' });
    feather([[268, 40], [282, 40], [298, 42]], { width: 5.5, alpha: 0.96, dry: 0.12, press: taper }, 'beak-a');
    feather([[268, 50], [282, 48], [296, 43]], { width: 4, alpha: 0.94, dry: 0.15, press: taper }, 'beak-b');
    // One leg and three claws gripping the rock
    feather([[214, 126], [216, 138], [218, 150]], { width: 3, alpha: 0.92, dry: 0.4, press: () => 1 }, 'leg');
    feather([[218, 150], [228, 151], [236, 155]], { width: 2.4, alpha: 0.9, dry: 0.3, press: taper }, 'claw-a');
    feather([[218, 150], [223, 156], [226, 161]], { width: 2.2, alpha: 0.85, dry: 0.3, press: taper }, 'claw-b');
    feather([[218, 150], [209, 152], [202, 156]], { width: 2.2, alpha: 0.85, dry: 0.3, press: taper }, 'claw-c');

    const done = soaked(layer, width, height);
    whiteEye(done, eye[0], eye[1], eye[2], 'bird-eye');
    return done;
  }

  // Check-in page: one small fish adrift in the air, in a few strokes.
  const FISH = { width: 260, height: 130, eye: [52, 62, 6] };

  function paintFish() {
    const { width, height, eye } = FISH;
    const layer = sheet(width, height);
    const ctx = layer.ctx;
    const stroke = (points, options, name) => brushStroke(ctx, points, { seed: 'fish-' + name, ...options });
    wash(ctx, [[36, 66], [76, 46], [130, 44], [176, 60], [130, 76], [74, 80]], { alpha: 0.4, soft: 2, seed: 'fish' });
    stroke([[34, 66], [66, 46], [118, 40], [160, 50], [182, 62]], { width: 9, alpha: 0.95, dry: 0.42 }, 'back');
    stroke([[38, 72], [76, 86], [122, 86], [160, 74], [180, 66]], { width: 3, alpha: 0.6, dry: 0.6 }, 'belly');
    stroke([[178, 62], [204, 46], [230, 28]], { width: 9, alpha: 0.95, dry: 0.4, press: taper }, 'tail-a');
    stroke([[178, 66], [204, 80], [226, 100]], { width: 8, alpha: 0.92, dry: 0.45, press: taper }, 'tail-b');
    stroke([[104, 42], [118, 26], [138, 28]], { width: 5, alpha: 0.9, dry: 0.4, press: taper }, 'fin-top');
    stroke([[84, 84], [94, 98], [108, 104]], { width: 4, alpha: 0.82, dry: 0.4, press: taper }, 'fin-low');
    stroke([[72, 50], [68, 64], [74, 78]], { width: 2.2, alpha: 0.72, dry: 0.4, press: () => 1 }, 'gill');
    const done = soaked(layer, width, height);
    whiteEye(done, eye[0], eye[1], eye[2], 'fish-eye');
    return done;
  }

  // Learned page: a small rock and a few blades of orchid.
  const ORCHID = { width: 300, height: 280 };

  function paintOrchid() {
    const { width, height } = ORCHID;
    const layer = sheet(width, height);
    const ctx = layer.ctx;
    const stroke = (points, options, name) => brushStroke(ctx, points, { seed: 'orchid-' + name, ...options });
    // Blades first, sweeping up out of the rock with thin tips
    stroke([[126, 222], [96, 150], [60, 92], [14, 62]], { width: 7, alpha: 0.92, dry: 0.45, press: leafPress }, 'blade-a');
    stroke([[136, 220], [146, 136], [176, 62], [214, 24]], { width: 7, alpha: 0.9, dry: 0.5, press: leafPress }, 'blade-b');
    stroke([[148, 222], [186, 170], [234, 136], [282, 132]], { width: 6, alpha: 0.88, dry: 0.55, press: leafPress }, 'blade-c');
    stroke([[118, 224], [104, 180], [110, 120], [136, 84]], { width: 4.5, alpha: 0.8, dry: 0.6, press: leafPress }, 'blade-d');
    // One flower: three short dabs on a thin stem
    stroke([[156, 220], [170, 176], [190, 148]], { width: 1.8, alpha: 0.75, dry: 0.4, press: () => 1 }, 'stem');
    stroke([[190, 148], [204, 134]], { width: 7, alpha: 0.62, dry: 0.3, raw: true, press: taper }, 'petal-a');
    stroke([[190, 148], [210, 150]], { width: 6, alpha: 0.56, dry: 0.3, raw: true, press: taper }, 'petal-b');
    stroke([[190, 148], [186, 130]], { width: 5, alpha: 0.5, dry: 0.3, raw: true, press: taper }, 'petal-c');
    // The rock, small and low
    wash(ctx, [[64, 236], [104, 212], [160, 208], [204, 228], [196, 264], [120, 276], [70, 264]], { alpha: 0.24, soft: 5, seed: 'small-rock' });
    stroke([[204, 230], [160, 208], [104, 212], [64, 238]], { width: 10, alpha: 0.86, dry: 0.55 }, 'rock-top');
    stroke([[64, 238], [70, 264], [120, 276], [196, 264], [204, 230]], { width: 7, alpha: 0.7, dry: 0.75 }, 'rock-foot');
    return soaked(layer, width, height);
  }

  // ---------- pieces of brushwork the stylesheet uses as images ----------

  // One long dry stroke as a picture, used for dividers and underlines.
  function strokeImage(width, height, options) {
    const { canvas, ctx } = sheet(width, height);
    brushStroke(ctx, options.path, { ...options, raw: false });
    return `url("${canvas.toDataURL('image/png')}")`;
  }

  // The score line: pale at the left and dense at the right, drawn as one pull of the brush.
  function scoreLine() {
    const { canvas, ctx } = sheet(420, 12);
    for (let i = 0; i < 6; i++) {
      const from = (420 / 6) * i, to = from + 420 / 6 + 6;
      brushStroke(ctx, [[from, 6], [(from + to) / 2, 6 + (i % 2 ? 0.5 : -0.5)], [to, 6]],
        { width: 5, alpha: 0.2 + i * 0.14, dry: 0.3, seed: 'score' + i, press: () => 0.7 + i * 0.06 });
    }
    return `url("${canvas.toDataURL('image/png')}")`;
  }

  // A very pale pool of ink to sit behind a block of content.
  function washImage() {
    const { canvas, ctx } = sheet(420, 420);
    // A wide blur and no pooled edge: behind text it must read as a tone, not as a shape
    wash(ctx, [[110, 130], [210, 100], [310, 130], [340, 210], [300, 300], [210, 325], [120, 290], [85, 210]],
      { alpha: 0.08, soft: 42, seed: 'block', edge: false });
    return `url("${canvas.toDataURL('image/png')}")`;
  }

  // Hand the brushwork to the stylesheet once, when the page loads.
  function preparePage() {
    const root = document.documentElement.style;
    root.setProperty('--dry-line', strokeImage(900, 14, {
      path: [[6, 7], [240, 6], [520, 8], [894, 7]], width: 7, alpha: 0.78, dry: 0.62, seed: 'rule',
    }));
    root.setProperty('--dry-line-pale', strokeImage(900, 10, {
      path: [[6, 5], [320, 4], [894, 5]], width: 4, alpha: 0.5, dry: 0.7, seed: 'rule-pale',
    }));
    // Short words get their own short strokes: squeezing a long stroke turns it to mud
    root.setProperty('--dry-line-short', strokeImage(320, 12, {
      path: [[5, 6], [120, 5], [315, 6]], width: 6, alpha: 0.82, dry: 0.68, seed: 'rule-short',
    }));
    root.setProperty('--dry-line-pale-short', strokeImage(160, 8, {
      path: [[4, 4], [70, 4], [156, 4]], width: 3.5, alpha: 0.55, dry: 0.6, seed: 'rule-pale-short',
    }));
    root.setProperty('--dry-line-tall', strokeImage(10, 900, {
      path: [[5, 6], [4, 320], [6, 620], [5, 894]], width: 4, alpha: 0.32, dry: 0.45, seed: 'side',
    }));
    root.setProperty('--score-line', scoreLine());
    root.setProperty('--ink-wash', washImage());
    startGlancing();
  }

  // ---------- putting a painting on the page ----------

  // Each picture is painted only once. render() rebuilds the page often, so the finished
  // canvases are kept here and moved into the new page. The bird and fish also say
  // where the eye is, as a share of the picture.
  const painted = {};

  function lotus() {
    const stem = paintLotusStem();
    const leaf = paintLotusLeaf();
    leaf.className = 'sway';
    leaf.style.transformOrigin = `${(LOTUS.joint[0] / LOTUS.width) * 100}% ${(LOTUS.joint[1] / LOTUS.height) * 100}%`;
    return { layers: [stem, leaf] };
  }

  const shareOf = (art) => ({ x: art.eye[0] / art.width, y: art.eye[1] / art.height, size: (art.eye[2] * 1.15) / art.width });
  const PAINTERS = {
    lotus,
    bird: () => ({ layers: [paintBird()], eye: shareOf(BIRD) }),
    fish: () => ({ layers: [paintFish()], eye: shareOf(FISH) }),
    orchid: () => ({ layers: [paintOrchid()] }),
  };

  // Fill every empty art frame on the page.
  function mount(root) {
    root.querySelectorAll('[data-art]').forEach((frame) => {
      const name = frame.dataset.art;
      if (!painted[name]) painted[name] = PAINTERS[name]();
      const art = painted[name];
      const painting = frame.querySelector('.painting');
      art.layers.forEach((layer) => painting.append(layer));
      if (art.eye) {
        const pupil = document.createElement('span');
        pupil.className = 'pupil';
        pupil.style.left = `${art.eye.x * 100}%`;
        pupil.style.top = `${art.eye.y * 100}%`;
        pupil.style.width = `${art.eye.size * 100}%`;
        painting.append(pupil);
      }
    });
  }

  // ---------- the sideways glance ----------

  // Requirement: every few seconds the eye slowly turns on the visitor, or on the main
  // button, then turns away again. It rests looking up and aside, the Bada white eye.
  const REST_MS = 7000;
  const STARE_MS = 2600;
  let mouse = null;

  function aim(pupil, x, y) {
    pupil.style.setProperty('--look-x', `${x}px`);
    pupil.style.setProperty('--look-y', `${y}px`);
  }

  function glance() {
    if (!window.matchMedia('(prefers-reduced-motion: no-preference)').matches) return;
    document.querySelectorAll('.pupil').forEach((pupil) => {
      const box = pupil.getBoundingClientRect();
      const button = document.querySelector('#view .button.primary');
      const buttonBox = button ? button.getBoundingClientRect() : null;
      const target = mouse || (buttonBox && [buttonBox.left + buttonBox.width / 2, buttonBox.top + buttonBox.height / 2]);
      if (!target) return;
      const dx = target[0] - (box.left + box.width / 2);
      const dy = target[1] - (box.top + box.height / 2);
      const distance = Math.hypot(dx, dy) || 1;
      const reach = box.width * 0.42;
      aim(pupil, (dx / distance) * reach, (dy / distance) * reach);
      setTimeout(() => {
        pupil.style.removeProperty('--look-x');
        pupil.style.removeProperty('--look-y');
      }, STARE_MS);
    });
  }

  function startGlancing() {
    window.addEventListener('mousemove', (event) => { mouse = [event.clientX, event.clientY]; }, { passive: true });
    setInterval(glance, REST_MS);
  }

  return { brushStroke, wash, bleed, preparePage, mount };
})();
