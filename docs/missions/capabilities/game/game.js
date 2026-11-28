// game.js – simple canvas game
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = 800;
canvas.height = 600;

let player = { x: canvas.width / 2, y: canvas.height - 50, w: 40, h: 40 };
let left = false, right = false;
let roses = [];
let thorns = [];
let score = 0;
let lives = 3;
let lastSpawn = 0;

function spawnObjects() {
  const now = Date.now();
  if (now - lastSpawn > 800) {
    // 70% rose, 30% thorn
    if (Math.random() < 0.7) {
      roses.push({ x: Math.random() * (canvas.width - 30), y: -30, r: 15, speed: 2 + Math.random() * 2 });
    } else {
      thorns.push({ x: Math.random() * (canvas.width - 30), y: -30, size: 20, speed: 2 + Math.random() * 2 });
    }
    lastSpawn = now;
  }
}

function update() {
  if (left) player.x -= 5;
  if (right) player.x += 5;
  player.x = Math.max(0, Math.min(canvas.width - player.w, player.x));

  roses.forEach(r => r.y += r.speed);
  thorns.forEach(t => t.y += t.speed);

  // collision detection
  roses = roses.filter(r => {
    if (r.y > canvas.height) return false;
    if (r.x < player.x + player.w && r.x + r.r * 2 > player.x && r.y < player.y + player.h && r.y + r.r * 2 > player.y) {
      score += 10;
      document.getElementById('score').textContent = score;
      return false;
    }
    return true;
  });

  thorns = thorns.filter(t => {
    if (t.y > canvas.height) return false;
    if (t.x < player.x + player.w && t.x + t.size > player.x && t.y < player.y + player.h && t.y + t.size > player.y) {
      lives -= 1;
      document.getElementById('lives').textContent = lives;
      if (lives <= 0) {
        alert('Game Over');
        // reset
        score = 0;
        lives = 3;
        document.getElementById('score').textContent = score;
        document.getElementById('lives').textContent = lives;
        roses = [];
        thorns = [];
      }
      return false;
    }
    return true;
  });
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // player – glowing figure
  ctx.fillStyle = 'rgba(0,255,255,0.7)';
  ctx.fillRect(player.x, player.y, player.w, player.h);
  // roses – copper circles
  ctx.fillStyle = '#b87333';
  roses.forEach(r => {
    ctx.beginPath();
    ctx.arc(r.x + r.r, r.y + r.r, r.r, 0, Math.PI * 2);
    ctx.fill();
  });
  // thorns – dark triangles
  ctx.fillStyle = '#333';
  thorns.forEach(t => {
    ctx.beginPath();
    ctx.moveTo(t.x, t.y + t.size);
    ctx.lineTo(t.x + t.size / 2, t.y);
    ctx.lineTo(t.x + t.size, t.y + t.size);
    ctx.closePath();
    ctx.fill();
  });
}

function loop() {
  spawnObjects();
  update();
  draw();
  requestAnimationFrame(loop);
}

// input handling
document.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft') left = true;
  if (e.key === 'ArrowRight') right = true;
});
document.addEventListener('keyup', e => {
  if (e.key === 'ArrowLeft') left = false;
  if (e.key === 'ArrowRight') right = false;
});

loop();