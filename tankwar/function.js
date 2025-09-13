// function.js — Modular feature helpers for Tank Combat
// Each helper is designed to be opt-in and patch-like, so you can
// drop it in and call the function from main.js to enable/replace
// the current behavior with minimal edits elsewhere.

/**
 * Increase the speed of bullets produced by Tank.fire without rewriting Tank.fire.
 * Wraps the original fire and multiplies the created bullet's velocity.
 *
 * @param {typeof Tank} TankClass - The Tank class constructor (from main.js).
 * @param {number} factor - Multiplier for bullet velocity (e.g., 1.5, 2).
 */
export function increaseBulletSpeed(TankClass, factor = 2) {
  if (!TankClass || typeof TankClass !== 'function') throw new Error('increaseBulletSpeed: invalid TankClass');
  if (TankClass.__orig_fire_fastpatch) return; // already patched
  const orig = TankClass.prototype.fire;
  TankClass.__orig_fire_fastpatch = orig;
  TankClass.prototype.fire = function (...args) {
    const b = orig.apply(this, args);
    if (b && typeof b.vx === 'number' && typeof b.vy === 'number') {
      b.vx *= factor;
      b.vy *= factor;
    }
    return b;
  };
}

/**
 * Enable bouncing bullets by patching Bullet.update.
 * Reflects velocity on rect and arena bounds; bullet despawns after maxBounces.
 *
 * @param {typeof Bullet} BulletClass - The Bullet class constructor.
 * @param {object} env - Environment bridged from main.js.
 * @param {Array<object>} env.maze - Maze array; deadly flag is ignored here.
 * @param {function} env.wallPx - Converts maze rect to pixel rect.
 * @param {function} env.segRectIntersects - Segment vs rect intersection test.
 * @param {HTMLCanvasElement} env.canvas - Canvas element to get bounds.
 * @param {function} env.spawnExplosion - Optional visual/sfx on bounce point.
 * @param {function} env.playSFX - Optional sfx function; uses 'wall' on bounce.
 * @param {number} [maxBounces=3] - Max bounces before bullet dies.
 */
export function enableBouncingBullets(
  BulletClass,
  { maze, wallPx, segRectIntersects, canvas, spawnExplosion, playSFX },
  maxBounces = 3
) {
  if (!BulletClass || typeof BulletClass !== 'function') throw new Error('enableBouncingBullets: invalid BulletClass');
  if (BulletClass.__orig_update_bouncepatch) return; // already patched
  const orig = BulletClass.prototype.update;
  BulletClass.__orig_update_bouncepatch = orig;
  BulletClass.prototype.update = function (dt) {
    if (!this.alive) return;
    // Initialize per-bullet bounce counter
    if (typeof this._bounces !== 'number') this._bounces = 0;

    let nx = this.x + this.vx * dt;
    let ny = this.y + this.vy * dt;
    const p0 = { x: this.x, y: this.y };
    const p1 = { x: nx, y: ny };
    let bounced = false;

    // Check walls — reflect on first hit
    for (const m of maze) {
      const { x, y, w, h } = wallPx(m);
      if (segRectIntersects(p0, p1, x, y, w, h)) {
        // Determine side: compare distances to rect sides from previous pos
        const cx = clamp(this.x, x, x + w);
        const cy = clamp(this.y, y, y + h);
        const hitVertical = Math.abs(cx - this.x) > Math.abs(cy - this.y);
        if (hitVertical) this.vx = -this.vx; else this.vy = -this.vy;
        if (spawnExplosion) spawnExplosion(this.x, this.y);
        if (playSFX) playSFX('wall');
        this._bounces += 1;
        bounced = true;
        break;
      }
    }

    // Arena bounds reflection
    if (!bounced) {
      if (nx < 0 || nx > canvas.clientWidth) { this.vx = -this.vx; bounced = true; }
      if (ny < 0 || ny > canvas.clientHeight) { this.vy = -this.vy; bounced = true; }
      if (bounced && playSFX) playSFX('wall');
    }

    if (bounced) {
      // After reflection, advance with new velocity from current position
      nx = this.x + this.vx * dt;
      ny = this.y + this.vy * dt;
    }

    this.x = nx; this.y = ny;
    this.life -= dt;
    if (this.life <= 0 || this._bounces >= maxBounces) this.alive = false;
  };
}

/**
 * Mark some walls as deadly and patch Tank.updateMovement to detect lethal contact.
 * When a tank overlaps a deadly wall, onTankKilled(tank) is called.
 *
 * @param {typeof Tank} TankClass - The Tank class constructor.
 * @param {object} env - Environment bridged from main.js.
 * @param {Array<object>} env.maze - Maze array with rects; will be mutated with m.deadly = true.
 * @param {function} env.wallPx - Converts maze rect to pixel rect.
 * @param {function} env.circleRectCollision - Collision test.
 * @param {function} env.onTankKilled - Callback(tank) to handle explosion/score/respawn.
 * @param {Array<number>|function(object,number):boolean} deadly - Indices or predicate to mark deadly walls.
 */
export function enableDeadlyWalls(
  TankClass,
  { maze, wallPx, circleRectCollision, onTankKilled },
  deadly
) {
  if (!TankClass || typeof TankClass !== 'function') throw new Error('enableDeadlyWalls: invalid TankClass');
  // Tag deadly flags
  if (Array.isArray(deadly)) {
    deadly.forEach((i) => { if (maze[i]) maze[i].deadly = true; });
  } else if (typeof deadly === 'function') {
    maze.forEach((m, i) => { if (deadly(m, i)) m.deadly = true; });
  }
  // Patch movement to detect lethal overlaps post-move
  if (TankClass.__orig_update_move_deadlypatch) return;
  const orig = TankClass.prototype.updateMovement;
  TankClass.__orig_update_move_deadlypatch = orig;
  TankClass.prototype.updateMovement = function (...args) {
    orig.apply(this, args);
    for (const m of maze) {
      if (!m.deadly) continue;
      const { x, y, w, h } = wallPx(m);
      if (circleRectCollision(this.x, this.y, this.radius, x, y, w, h)) {
        if (typeof onTankKilled === 'function') onTankKilled(this);
        break;
      }
    }
  };
}

/**
 * Spawn additional AI enemies and provide a per-frame updater to control them.
 * Uses a parameterized version of the existing updateAI logic.
 *
 * @param {number} count - How many extra enemies to add.
 * @param {typeof Tank} TankClass - The Tank class constructor.
 * @param {object} env - Environment bridged from main.js.
 * @param {HTMLCanvasElement} env.canvas
 * @param {object} env.player
 * @param {function} env.angleTo
 * @param {function} env.angDiff
 * @param {function} env.hasLineOfSight
 * @param {function} env.ensureNav
 * @param {function} env.navWaypoint
 * @param {function} env.distanceToWall
 * @param {function} [env.canOccupy]
 * @param {string|string[]} [color] - Hex color or list of colors to cycle.
 * @returns {{enemies: any[], updateAllAI: (dt:number)=>void}}
 */
export function spawnMoreEnemies(
  count,
  TankClass,
  { canvas, player, angleTo, angDiff, hasLineOfSight, ensureNav, navWaypoint, distanceToWall, canOccupy },
  color = ['#f472b6', '#f59e0b', '#60a5fa', '#a78bfa']
) {
  const colors = Array.isArray(color) ? color : [color];
  const enemies = [];

  // Pick spawn points around corners and edges, avoiding the player.
  const W = canvas.clientWidth, H = canvas.clientHeight;
  const spawns = [
    { x: 0.85 * W, y: 0.15 * H },
    { x: 0.85 * W, y: 0.85 * H },
    { x: 0.15 * W, y: 0.15 * H },
    { x: 0.15 * W, y: 0.85 * H },
    { x: 0.50 * W, y: 0.15 * H },
    { x: 0.85 * W, y: 0.50 * H },
    { x: 0.50 * W, y: 0.85 * H },
    { x: 0.15 * W, y: 0.50 * H },
  ];
  let si = 0;
  for (let i = 0; i < count; i++) {
    const c = colors[i % colors.length];
    let s = spawns[si % spawns.length]; si++;
    // If occupied or unsafe, try next
    if (typeof canOccupy === 'function') {
      let tries = 0;
      while (!canOccupy(s.x, s.y, 20) && tries++ < spawns.length) {
        s = spawns[si++ % spawns.length];
      }
    }
    const t = new TankClass(s.x, s.y, c);
    t.turnSpeed = 1.8;
    t.angle = angleTo(t.x, t.y, W * 0.5, H * 0.5);
    enemies.push(t);
  }

  // Individual AI state per enemy
  const state = new Map();
  const getState = (e) => {
    let st = state.get(e);
    if (!st) { st = { hasSight: false, holdFire: 0, unstick: 0, unstickDir: 0, progress: 0, lastX: e.x, lastY: e.y }; state.set(e, st); }
    return st;
  };

  function updateOne(dt, enemy) {
    const st = getState(enemy);
    const targetAng = angleTo(enemy.x, enemy.y, player.x, player.y);
    const diff = angDiff(enemy.angle, targetAng);
    const sight = hasLineOfSight(enemy.x, enemy.y, player.x, player.y);
    if (sight && !st.hasSight) st.holdFire = 0.9 + Math.random() * 0.7;
    st.hasSight = sight;
    if (st.holdFire > 0) st.holdFire -= dt;

    const leftFeel = distanceToWall(enemy.x, enemy.y, enemy.angle - 0.8, 180);
    const rightFeel = distanceToWall(enemy.x, enemy.y, enemy.angle + 0.8, 180);
    const fwdFeel = distanceToWall(enemy.x, enemy.y, enemy.angle, 160);

    let steerTargetAng = targetAng;
    if (!sight) {
      ensureNav(dt);
      const wp = navWaypoint(enemy.x, enemy.y);
      if (wp) steerTargetAng = angleTo(enemy.x, enemy.y, wp.x, wp.y);
    }
    let steer = clamp(angDiff(enemy.angle, steerTargetAng), -0.8, 0.8);
    const avoid = clamp((rightFeel - leftFeel) * 0.005, -0.7, 0.7);
    const panic = fwdFeel < 40 ? (leftFeel < rightFeel ? 0.7 : -0.7) : 0;
    steer += avoid + panic;

    const turnLeft = steer < -0.06;
    const turnRight = steer > 0.06;
    let goForward = fwdFeel > 24;
    let goBackward = false;

    const moved = Math.hypot(enemy.x - st.lastX, enemy.y - st.lastY);
    if (goForward && moved < 8 * dt && fwdFeel < 50) st.progress += dt; else st.progress = 0;
    if (st.progress > 0.6) {
      st.unstick = 0.5;
      st.unstickDir = (leftFeel < rightFeel) ? 1 : -1;
      st.progress = 0;
    }
    if (st.unstick > 0) {
      st.unstick -= dt;
      enemy.updateMovement(dt, st.unstickDir < 0, st.unstickDir > 0, fwdFeel > 30, fwdFeel <= 20);
    } else {
      enemy.updateMovement(dt, turnLeft, turnRight, goForward, goBackward);
    }
    st.lastX = enemy.x; st.lastY = enemy.y;

    if (sight && st.holdFire <= 0 && enemy.canFire()) {
      if (Math.abs(diff) < 0.15) enemy.fire();
    }
  }

  function updateAllAI(dt) {
    for (const e of enemies) updateOne(dt, e);
  }

  return { enemies, updateAllAI };
}

/**
 * Utility helpers to run the game at a speed multiplier.
 * Choose the variant that fits how you compute dt or drive RAF.
 */
export function scaleDt(dt, multiplier = 2) { return dt * multiplier; }

/**
 * Wrap a RAF frame callback so that time deltas are scaled by multiplier.
 * Usage: requestAnimationFrame(wrapFrameWithSpeed(frame, 2))
 */
export function wrapFrameWithSpeed(frameFn, multiplier = 2) {
  let last = undefined;
  return function wrapped(t) {
    if (last === undefined) last = t;
    const scaled = last + (t - last) * multiplier;
    return frameFn(scaled);
  };
}

// Local helpers mirrored from main.js to avoid importing internals.
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

