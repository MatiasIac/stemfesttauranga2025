# Browser Console Examples

Copy-paste these snippets in your browser console while the game is running. They assume you are serving the page over HTTP(S) so dynamic `import('./function.js')` works, and that `main.js` has exposed internals on `window.gc` (already added).

## Setup: Load Helpers

```js
// Load helper functions from function.js (idempotent)
const fx = await import('./function.js');
// Quick sanity: ensure internals are exposed
if (!window.gc) throw new Error('window.gc not found — reload the page to pick up the exposure from main.js');
```

## Bouncing Bullets (3 bounces)

```js
// Reflect bullets off walls and arena bounds up to 3 times
fx.enableBouncingBullets(
  gc.Bullet,
  { maze: gc.maze, wallPx: gc.wallPx, segRectIntersects: gc.segRectIntersects, canvas: gc.canvas, spawnExplosion: gc.spawnExplosion, playSFX: gc.playSFX },
  3
);
```

## Faster Bullets (2× speed)

```js
// Newly fired bullets will be 2x faster (player and AI)
fx.increaseBulletSpeed(gc.Tank, 2);
```

## Deadly Walls (outer frame kills on touch)

```js
// DOM score handles
const pScore = document.getElementById('pScore');
const eScore = document.getElementById('eScore');

// Define kill handler compatible with player, built-in enemy, and extra AIs
const onTankKilled = (t) => {
  // Explosion + SFX on death spot
  gc.spawnExplosion(t.x, t.y);
  gc.playSFX('boom');

  // If the player dies, AI score++ and respawn player vs the primary enemy
  if (t === gc.player) {
    gc.scores.e++;
    eScore.textContent = gc.scores.e;
    gc.respawnLoser(gc.player, gc.enemy);
    return;
  }

  // If a non-player dies, player score++
  gc.scores.p++;
  pScore.textContent = gc.scores.p;

  // Primary enemy uses the existing respawn helper
  if (t === gc.enemy) {
    gc.respawnLoser(gc.enemy, gc.player);
    return;
  }

  // Extra AI enemy: respawn farthest from player (simple corner picker)
  if (window.extraAI && window.extraAI.enemies.includes(t)) {
    const W = gc.canvas.clientWidth, H = gc.canvas.clientHeight;
    const corners = [
      { x: 0.15 * W, y: 0.15 * H }, // TL
      { x: 0.85 * W, y: 0.15 * H }, // TR
      { x: 0.85 * W, y: 0.85 * H }, // BR
      { x: 0.15 * W, y: 0.85 * H }, // BL
    ];
    let best = corners[0], bestD2 = -1;
    for (const c of corners) {
      const dx = c.x - gc.player.x, dy = c.y - gc.player.y;
      const d2 = dx*dx + dy*dy;
      if (d2 > bestD2) { bestD2 = d2; best = c; }
    }
    t.x = best.x; t.y = best.y;
    t.angle = gc.angleTo(t.x, t.y, W * 0.5, H * 0.5);
  }
};

// Make the four border walls deadly (maze indices 0..3)
fx.enableDeadlyWalls(
  gc.Tank,
  { maze: gc.maze, wallPx: gc.wallPx, circleRectCollision: gc.circleRectCollision, onTankKilled },
  (m, i) => i < 4
);
```

## More AI Enemies (2 extra tanks)

```js
// Spawn 2 additional AI enemies using the enemy color so their shots count as enemy shots
window.extraAI = fx.spawnMoreEnemies(
  2,
  gc.Tank,
  {
    canvas: gc.canvas,
    player: gc.player,
    angleTo: gc.angleTo,
    angDiff: gc.angDiff,
    hasLineOfSight: gc.hasLineOfSight,
    ensureNav: gc.ensureNav,
    navWaypoint: gc.navWaypoint,
    distanceToWall: gc.distanceToWall,
    canOccupy: (x, y, r) => true, // keep simple in console
  },
  gc.enemy.color
);

// Install a lightweight per-frame overlay to update and draw the extra AIs
(function installExtraAIOverlay(){
  if (window.__extraAIOverlay) return; // idempotent
  window.__extraAIOverlay = true;
  const rafPrev = window.requestAnimationFrame.bind(window);
  let last = performance.now();

  // Helper for player bullet vs extra AI hit test (segment-circle)
  function segCircle(p0, p1, cx, cy, r) {
    const vx = p1.x - p0.x, vy = p1.y - p0.y;
    const wx = cx - p0.x, wy = cy - p0.y;
    const vv = vx*vx + vy*vy || 1;
    const t = Math.max(0, Math.min(1, (wx*vx + wy*vy) / vv));
    const px = p0.x + vx*t, py = p0.y + vy*t;
    const dx = cx - px, dy = cy - py;
    return dx*dx + dy*dy <= r*r;
  }

  window.requestAnimationFrame = (cb) => rafPrev((t) => {
    const dt = Math.min(0.033, (t - last) / 1000);
    last = t;
    cb(t); // let the original game run first

    if (window.extraAI) {
      // Drive extra AI and render them
      window.extraAI.updateAllAI(dt);
      for (const e of window.extraAI.enemies) e.draw();

      // Optional: allow player bullets to destroy extra AIs
      const remap = [];
      for (const b of gc.bullets) {
        if (!b.alive || b.color !== gc.player.color) { remap.push(b); continue; }
        const p0 = { x: b.x - b.vx * dt, y: b.y - b.vy * dt };
        const p1 = { x: b.x, y: b.y };
        let hit = false;
        for (const e of window.extraAI.enemies) {
          if (segCircle(p0, p1, e.x, e.y, e.radius)) {
            // Score, effects, respawn similar to onTankKilled
            gc.scores.p++; document.getElementById('pScore').textContent = gc.scores.p;
            gc.spawnExplosion(e.x, e.y); gc.playSFX('boom');
            // Respawn far from player
            const W = gc.canvas.clientWidth, H = gc.canvas.clientHeight;
            const corners = [
              { x: 0.15 * W, y: 0.15 * H },
              { x: 0.85 * W, y: 0.15 * H },
              { x: 0.85 * W, y: 0.85 * H },
              { x: 0.15 * W, y: 0.85 * H },
            ];
            let best = corners[0], bestD2 = -1;
            for (const c of corners) { const dx = c.x - gc.player.x, dy = c.y - gc.player.y; const d2 = dx*dx + dy*dy; if (d2 > bestD2) { bestD2 = d2; best = c; } }
            e.x = best.x; e.y = best.y; e.angle = gc.angleTo(e.x, e.y, W * 0.5, H * 0.5);
            hit = true; break;
          }
        }
        if (!hit) remap.push(b); else b.alive = false;
      }
      // Keep bullets array consistent if we removed some on hit
      gc.bullets = remap.filter(b => b.alive);
    }
  });
})();
```

## Double Game Speed

```js
// Install a RAF time scaler (run once). Call setGameSpeed(2) to double.
(function installSpeedScaler(){
  if (window.__speedScaler) return; // idempotent
  window.__speedScaler = true;
  const rafPrev = window.requestAnimationFrame.bind(window);
  let factor = 2, t0;
  window.setGameSpeed = (f) => { factor = Math.max(0.1, f || 1); };
  window.requestAnimationFrame = (cb) => rafPrev((t) => {
    t0 ??= t;
    cb(t0 + (t - t0) * factor);
  });
})();

// Usage examples:
// setGameSpeed(2);   // 2x speed
// setGameSpeed(1);   // normal speed
// setGameSpeed(0.5); // half speed (slow-mo)
```


### Extra Walls

More walls

```js
gc.maze.push({ x: 0.40, y: 0.35, w: 0.20, h: 0.02 });
gc.maze.push({ x: 0.40, y: 0.35, w: 0.02, h: 0.20 });
gc.maze.push({ x: 0.58, y: 0.35, w: 0.02, h: 0.20 });
gc.maze.push({ x: 0.40, y: 0.53, w: 0.20, h: 0.02 });

```

---

Tips:
- Run the speed scaler before or after the Extra AI overlay — both wrappers compose by chaining the current requestAnimationFrame.
- You can re-run any snippet; the guards (idempotent flags) prevent duplicate installation.
