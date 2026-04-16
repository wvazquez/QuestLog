import './styles/landing.scss'

// ═══════════════════════════════
// PARTICLE SYSTEM
// ═══════════════════════════════
const canvas = document.getElementById('particles');
const ctx = canvas.getContext('2d');
let W, H, particles = [];

function resize() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
}

function makeParticle() {
  return {
    x: Math.random() * W,
    y: Math.random() * H,
    vx: (Math.random() - 0.5) * 0.35,
    vy: (Math.random() - 0.5) * 0.35,
    r: Math.random() * 1.8 + 0.4,
    alpha: Math.random() * 0.5 + 0.1,
  };
}

function initParticles() {
  const count = Math.min(80, Math.floor(W * H / 14000));
  particles = Array.from({ length: count }, makeParticle);
}

function drawParticles() {
  ctx.clearRect(0, 0, W, H);
  // Draw connecting lines
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const dx = particles[i].x - particles[j].x;
      const dy = particles[i].y - particles[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 110) {
        ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        ctx.strokeStyle = `rgba(124,108,252,${0.08 * (1 - dist / 110)})`;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }
  }
  // Draw dots
  particles.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(124,108,252,${p.alpha})`;
    ctx.fill();
  });
}

function tickParticles() {
  particles.forEach(p => {
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < -10) p.x = W + 10;
    if (p.x > W + 10) p.x = -10;
    if (p.y < -10) p.y = H + 10;
    if (p.y > H + 10) p.y = -10;
  });
}

function animateParticles() {
  tickParticles();
  drawParticles();
  requestAnimationFrame(animateParticles);
}

window.addEventListener('resize', () => { resize(); initParticles(); });
resize();
initParticles();
animateParticles();

// ═══════════════════════════════
// COUNTER ANIMATION
// ═══════════════════════════════
function animateCounter(el, target, duration) {
  let start = 0;
  const step = target / (duration / 16);
  const tick = () => {
    start = Math.min(start + step, target);
    el.textContent = Math.floor(start).toLocaleString();
    if (start < target) requestAnimationFrame(tick);
  };
  tick();
}

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const target = parseInt(entry.target.dataset.target);
      animateCounter(entry.target, target, 1400);
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.5 });

document.querySelectorAll('[data-target]').forEach(el => observer.observe(el));

// ═══════════════════════════════
// PREVIEW CARD ANIMATION
// ═══════════════════════════════
const previewTasks = [
  { el: document.getElementById('pt0'), xp: 15, gold: 8 },
  { el: document.getElementById('pt1'), xp: 10, gold: 5 },
  { el: document.getElementById('pt2'), xp: 20, gold: 10 },
];

let previewXPTotal = 0;
let previewGoldTotal = 0;
let previewIdx = 0;
const previewXPEl = document.getElementById('previewXP');
const previewGoldEl = document.getElementById('previewGold');
const previewNameEl = document.getElementById('previewName');
const names = ['Hero', 'Champion', 'Legend'];
previewNameEl.textContent = names[0];

function completePreviewTask(task) {
  task.el.classList.add('done');
  const check = task.el.querySelector('.preview-check');
  check.textContent = '✓';

  // XP popup
  const pop = document.createElement('div');
  pop.className = 'preview-xp-pop';
  pop.textContent = '+' + task.xp + ' XP';
  const rect = task.el.getBoundingClientRect();
  const previewRect = document.getElementById('heroPreview').getBoundingClientRect();
  pop.style.left = (rect.right - previewRect.left - 40) + 'px';
  pop.style.top = (rect.top - previewRect.top) + 'px';
  document.getElementById('heroPreview').appendChild(pop);
  setTimeout(() => pop.remove(), 950);

  previewXPTotal += task.xp;
  previewGoldTotal += task.gold;
  previewXPEl.textContent = previewXPTotal;
  previewGoldEl.textContent = previewGoldTotal;
}

function resetPreview() {
  previewTasks.forEach(t => {
    t.el.classList.remove('done');
    t.el.querySelector('.preview-check').textContent = '';
  });
  previewIdx = 0;
  previewXPTotal = 0;
  previewGoldTotal = 0;
  previewXPEl.textContent = '0';
  previewGoldEl.textContent = '0';
}

function runPreviewAnimation() {
  if (previewIdx < previewTasks.length) {
    setTimeout(() => {
      completePreviewTask(previewTasks[previewIdx]);
      previewIdx++;
      runPreviewAnimation();
    }, previewIdx === 0 ? 1200 : 900);
  } else {
    // Pause then reset
    setTimeout(() => {
      resetPreview();
      setTimeout(runPreviewAnimation, 800);
    }, 2800);
  }
}

// Start preview animation after a short delay
setTimeout(runPreviewAnimation, 1500);
