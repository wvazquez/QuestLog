import './styles/auth.scss'
import { sb } from './lib/supabase.js'

// ── READ MODE FROM URL ──────────────────────────────────────
const urlParams = new URLSearchParams(window.location.search);
const initMode = urlParams.get('mode');
if (initMode === 'signup') showTab('signup');
else if (initMode === 'forgot') showForgot();

// ── CHECK IF ALREADY SIGNED IN ──────────────────────────────
(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    window.location.href = 'index.html';
  }
})();

// Listen for OAuth / email-link callbacks
sb.auth.onAuthStateChange((event, session) => {
  if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
    window.location.href = 'index.html';
  }
});

// ── TAB SWITCHING ───────────────────────────────────────────
function showTab(tab) {
  ['signin','signup','forgot','emailSent','resetSent'].forEach(t => {
    document.getElementById('form' + capitalise(t)).classList.remove('active');
  });
  // Update tab buttons
  document.getElementById('authTabs').style.display = (tab === 'forgot' || tab === 'emailSent' || tab === 'resetSent') ? 'none' : 'flex';
  document.getElementById('tabSignin').classList.toggle('active', tab === 'signin');
  document.getElementById('tabSignup').classList.toggle('active', tab === 'signup');

  const formId = 'form' + capitalise(tab);
  const el = document.getElementById(formId);
  if (el) el.classList.add('active');
  clearMessages();
}

function showForgot() {
  showTab('forgot');
}

function capitalise(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function clearMessages() {
  document.querySelectorAll('.form-msg').forEach(el => {
    el.classList.remove('show','error','success','info');
    el.textContent = '';
  });
}

function showMsg(id, text, type) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = 'form-msg show ' + type;
}

// ── PASSWORD VISIBILITY ─────────────────────────────────────
function togglePw(inputId, btn) {
  const input = document.getElementById(inputId);
  input.type = input.type === 'password' ? 'text' : 'password';
  btn.textContent = input.type === 'password' ? '👁' : '🙈';
}

// ── PASSWORD STRENGTH ───────────────────────────────────────
function checkStrength(pw) {
  const bars = [0,1,2,3].map(i => document.getElementById('bar' + i));
  const hint = document.getElementById('pwHint');
  bars.forEach(b => { b.className = 'pw-bar'; });

  if (!pw) { hint.textContent = 'Use 8+ characters with letters and numbers'; return; }

  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  const cls = score <= 1 ? 'weak' : score <= 2 ? 'ok' : 'strong';
  for (let i = 0; i < score; i++) bars[i].classList.add(cls);
  hint.textContent = score === 4 ? '✓ Strong password' : score <= 1 ? 'Add uppercase, numbers, symbols' : score <= 2 ? 'Getting better — add more variety' : 'Good password';
}

// ── SET BUTTON LOADING STATE ────────────────────────────────
function setBtnLoading(id, loading, text) {
  const btn = document.getElementById(id);
  btn.disabled = loading;
  btn.innerHTML = loading
    ? '<div class="spinner"></div>'
    : text;
}

// ── SIGN IN ─────────────────────────────────────────────────
async function handleSignin() {
  const email = document.getElementById('signinEmail').value.trim();
  const pw    = document.getElementById('signinPw').value;
  clearMessages();

  if (!email || !pw) {
    showMsg('signinMsg', 'Please fill in all fields.', 'error');
    return;
  }

  setBtnLoading('btnSignin', true);
  const { error } = await sb.auth.signInWithPassword({ email, password: pw });
  setBtnLoading('btnSignin', false, 'Enter Your Quest');

  if (error) {
    const msg = error.message.includes('Invalid') ? 'Incorrect email or password.' :
                error.message.includes('Email not confirmed') ? 'Please verify your email first. Check your inbox.' :
                error.message;
    showMsg('signinMsg', msg, 'error');
  }
  // Success handled by onAuthStateChange → redirect
}

// ── SIGN UP ─────────────────────────────────────────────────
async function handleSignup() {
  const name  = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const pw    = document.getElementById('signupPw').value;
  const terms = document.getElementById('termsCheck').checked;
  clearMessages();

  if (!name)  { showMsg('signupMsg', 'Please enter your hero name.', 'error'); return; }
  if (!email) { showMsg('signupMsg', 'Please enter your email.', 'error'); return; }
  if (pw.length < 8) { showMsg('signupMsg', 'Password must be at least 8 characters.', 'error'); return; }
  if (!terms) { showMsg('signupMsg', 'You must accept the terms to begin your quest.', 'error'); return; }

  setBtnLoading('btnSignup', true);
  const { data, error } = await sb.auth.signUp({
    email,
    password: pw,
    options: {
      data: { display_name: name },
      emailRedirectTo: window.location.origin + (window.location.pathname.replace('auth.html', 'auth.html'))
    }
  });
  setBtnLoading('btnSignup', false, 'Create My Character');

  if (error) {
    const msg = error.message.includes('already registered') ? 'This email is already in use. Try signing in.' : error.message;
    showMsg('signupMsg', msg, 'error');
    return;
  }

  // Show email verification state
  document.getElementById('sentEmailDisplay').textContent = email;
  showTab('emailSent');
  document.getElementById('authTabs').style.display = 'none';
}

// ── RESEND VERIFICATION ─────────────────────────────────────
async function handleResend() {
  const email = document.getElementById('sentEmailDisplay').textContent;
  if (!email || email === 'your email') return;
  setBtnLoading('btnResend', true);
  await sb.auth.resend({ type: 'signup', email });
  setBtnLoading('btnResend', false, 'Resend Email');
  showMsg('forgotMsg', 'Email resent! Check your inbox.', 'success');
}

// ── FORGOT PASSWORD ─────────────────────────────────────────
async function handleForgot() {
  const email = document.getElementById('forgotEmail').value.trim();
  clearMessages();

  if (!email) { showMsg('forgotMsg', 'Please enter your email.', 'error'); return; }

  setBtnLoading('btnForgot', true);
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname
  });
  setBtnLoading('btnForgot', false, 'Send Reset Link');

  if (error) {
    showMsg('forgotMsg', error.message, 'error');
    return;
  }

  document.getElementById('resetEmailDisplay').textContent = email;
  showTab('resetSent');
  document.getElementById('authTabs').style.display = 'none';
}

// ── OAUTH ───────────────────────────────────────────────────
async function handleOAuth(provider) {
  const { error } = await sb.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: window.location.origin + '/auth.html'
    }
  });
  if (error) showMsg('signinMsg', error.message, 'error');
}

// ── ENTER KEY SUPPORT ───────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const active = document.querySelector('.auth-form.active');
  if (!active) return;
  const id = active.id;
  if (id === 'formSignin')  handleSignin();
  else if (id === 'formSignup')  handleSignup();
  else if (id === 'formForgot')  handleForgot();
});

// ── EXPOSE GLOBALS for inline onclick handlers ──────────────
Object.assign(window, {
  showTab,
  showForgot,
  togglePw,
  checkStrength,
  handleSignin,
  handleSignup,
  handleResend,
  handleForgot,
  handleOAuth,
});
