/* Demostración local: las cuentas, OTP y sesiones del navegador no protegen recursos reales.
   En producción, estas operaciones corresponden al servidor de autenticación y correo. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const ACCOUNTS_KEY = 'saulbank.demo.accounts.v2';
  const SESSION_KEY = 'saulbank.demo.session.v1';
  const SESSION_DURATION = 30 * 60 * 1000;
  const OTP_DURATION = 5 * 60 * 1000;
  const RESEND_DELAY = 60 * 1000;
  const DEMO_EMAIL = 'demo@saulbank.com';
  const DEMO_PASSWORD = 'SaulDemo2026!';
  const panels = ['login', 'registration', 'otp', 'recovery', 'reset', 'recovered', 'welcome'];
  const digits = [...document.querySelectorAll('.otp-digit')];
  let memoryAccounts = [];
  let challenge = null;
  let resetGrant = null;
  let currentView = 'login';
  let busy = false;
  let expiryTimer;
  let otpTimer;
  let persistentStorage = true;
  const normalEmail = value => value.trim().toLowerCase();
  const normalIdentity = value => value.replace(/[\s.-]/g, '').toUpperCase();
  const validEmail = value => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const passwordRules = value => ({ length: value.length >= 8 && value.length <= 128, case: /\p{Lu}/u.test(value) && /\p{Ll}/u.test(value), number: /[0-9]/.test(value), special: /[^\p{L}\p{N}\s]/u.test(value) });
  const validPassword = value => Object.values(passwordRules(value)).every(Boolean);

  $('year').textContent = new Date().getFullYear();

  function message(id, text = '', success = false) {
    const element = $(id);
    element.textContent = text;
    element.hidden = !text;
    element.classList.toggle('success', success);
  }
  function fieldError(id, text = '') {
    $(id).setAttribute('aria-invalid', String(Boolean(text)));
    message(id + '-error', text);
    return !text;
  }
  function show(view, focus = true) {
    currentView = view;
    panels.forEach(name => $(name + '-panel').hidden = name !== view);
    $('demo-panel').hidden = view !== 'login';
    document.body.dataset.view = view;
    const titles = { login: 'Banca en Línea', registration: 'Ingreso de Nuevos Clientes', otp: 'Confirmar correo electrónico', recovery: 'Recupera tu acceso', reset: 'Nueva contraseña', recovered: 'Usuario recuperado', welcome: 'Bienvenido' };
    document.title = titles[view] + ' | SAUL S.A.';
    if (focus) {
      window.scrollTo(0, 0);
      const target = view === 'otp' ? digits[0] : view === 'login' ? $('email') : $(view + '-title');
      target?.focus({ preventScroll: true });
    }
  }
  function setBusy(value, form) {
    busy = value;
    document.querySelectorAll('button').forEach(button => {
      if (value) {
        button.dataset.previouslyDisabled = String(button.disabled);
        button.disabled = true;
      } else {
        button.disabled = button.dataset.previouslyDisabled === 'true';
        delete button.dataset.previouslyDisabled;
      }
    });
    if (form) {
      form.setAttribute('aria-busy', String(value));
      form.querySelectorAll('input').forEach(input => input.readOnly = value);
    }
    $('app-status').textContent = value ? 'Procesando, espera un momento.' : '';
    $('submit-label').textContent = value && form === $('login-form') ? 'Validando acceso…' : 'Ingresar a Banca en Línea';
    $('submit-arrow').toggleAttribute('hidden', value && form === $('login-form'));
    $('login-spinner').hidden = !value || form !== $('login-form');
    if (!value && currentView === 'otp') updateCountdown();
  }
  function bindSubmit(id, errorId, action) {
    const form = $(id);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      message(errorId);
      setBusy(true, form);
      try { await action(); }
      catch (error) {
        console.error('No se pudo completar la operación local.', error);
        message(errorId, 'No se pudo completar la operación. Usa un navegador actualizado e inténtalo de nuevo.');
      } finally { setBusy(false, form); }
    });
  }
  function loadAccounts() {
    if (!persistentStorage) return memoryAccounts;
    try {
      const stored = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]');
      if (Array.isArray(stored)) memoryAccounts = stored.filter(account => account && typeof account.email === 'string' && typeof account.firstName === 'string' && account.credential?.hash && account.credential?.salt);
    } catch { persistentStorage = false; $('storage-notice').hidden = false; }
    return memoryAccounts;
  }
  function saveAccount(account) {
    const accounts = loadAccounts().filter(item => item.email !== account.email);
    accounts.push(account);
    memoryAccounts = accounts;
    try {
      if (persistentStorage) localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
    } catch { persistentStorage = false; $('storage-notice').hidden = false; }
  }
  function findAccount(address) {
    const account = loadAccounts().find(item => item.email === address);
    return account || (address === DEMO_EMAIL ? { email: DEMO_EMAIL, firstName: 'Saúl', credential: null } : null);
  }
  const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  async function derivePassword(secret, salt) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
    return hex(new Uint8Array(bits));
  }
  async function createCredential(secret) {
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    return { salt, hash: await derivePassword(secret, salt) };
  }
  async function matchesPassword(account, secret) {
    if (account.email === DEMO_EMAIL && !account.credential) return secret === DEMO_PASSWORD;
    return await derivePassword(secret, account.credential.salt) === account.credential.hash;
  }
  function removeSession() {
    clearTimeout(expiryTimer);
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* Sesión en memoria. */ }
  }
  function clearChallenge() {
    challenge = null;
    clearInterval(otpTimer);
    digits.forEach(input => { input.value = ''; input.setAttribute('aria-invalid', 'false'); });
    $('demo-otp').textContent = '';
  }
  function resetSecrets() {
    ['password', 'register-password', 'confirm-password', 'reset-password', 'reset-confirm'].forEach(id => { $(id).value = ''; $(id).type = 'password'; });
    document.querySelectorAll('[data-toggle], #toggle-password').forEach(button => {
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', 'Mostrar contraseña');
    });
    $('eye-slash').setAttribute('hidden', '');
    updateRequirements();
  }
  function goLogin(text = '', address = '', success = false) {
    clearChallenge();
    resetGrant = null;
    removeSession();
    resetSecrets();
    $('email').value = address;
    fieldError('email'); fieldError('password');
    message('login-message', text, success);
    show('login');
  }
  function showWelcome(session, focus = true) {
    resetSecrets(); clearChallenge(); resetGrant = null;
    $('session-email').textContent = session.email;
    $('welcome-title').textContent = '¡Bienvenido, ' + session.firstName + '!';
    show('welcome', focus);
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => goLogin('Tu sesión expiró. Ingresa de nuevo.'), Math.max(0, session.expiresAt - Date.now()));
  }
  function validateEmailField(id) {
    const input = $(id);
    input.value = input.value.trim();
    return fieldError(id, !input.value ? 'Ingresa tu correo electrónico.' : !validEmail(input.value) ? 'Ingresa un correo válido, por ejemplo nombre@dominio.com.' : '');
  }
  function validatePasswordField(id, confirmationOf) {
    const value = $(id).value;
    return fieldError(id, !value ? 'Ingresa tu contraseña.' : confirmationOf ? value !== $(confirmationOf).value ? 'Las contraseñas no coinciden.' : '' : !validPassword(value) ? 'Usa de 8 a 128 caracteres con mayúsculas, minúsculas, números y un carácter especial.' : '');
  }
  bindSubmit('login-form', 'login-message', async () => {
    const valid = [validateEmailField('email'), fieldError('password', !$('password').value ? 'Ingresa tu contraseña.' : '')];
    if (valid.includes(false)) { (!valid[0] ? $('email') : $('password')).focus(); return; }
    const account = findAccount(normalEmail($('email').value));
    if (!account || !await matchesPassword(account, $('password').value)) {
      message('login-message', 'El correo o la contraseña son incorrectos. Verifica tus credenciales.');
      $('password').value = ''; $('password').focus(); return;
    }
    const session = { email: account.email, firstName: account.firstName, expiresAt: Date.now() + SESSION_DURATION };
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* Acceso hasta recargar. */ }
    showWelcome(session);
  });
  function updateRequirements() {
    const rules = passwordRules($('register-password').value);
    document.querySelectorAll('[data-rule]').forEach(item => {
      item.classList.toggle('met', rules[item.dataset.rule]);
      item.setAttribute('aria-label', item.textContent + (rules[item.dataset.rule] ? ': cumplido' : ': pendiente'));
    });
  }
  bindSubmit('registration-form', 'registration-message', async () => {
    const ids = ['first-name', 'last-name', 'identity', 'phone', 'register-email', 'register-password', 'confirm-password'];
    const checks = ids.map(id => validateRegistrationField(id));
    if (checks.includes(false)) { $(ids[checks.indexOf(false)]).focus(); return; }
    const address = normalEmail($('register-email').value);
    if (findAccount(address)) { fieldError('register-email', 'Este correo ya está registrado. Inicia sesión o recupera tu acceso.'); $('register-email').focus(); return; }
    const identity = normalIdentity($('identity').value);
    if (loadAccounts().some(account => account.identity === identity)) { fieldError('identity', 'Este documento ya está registrado.'); $('identity').focus(); return; }
    const account = { email: address, firstName: $('first-name').value.trim(), lastName: $('last-name').value.trim(), identity, phone: $('phone').value.trim(), credential: await createCredential($('register-password').value) };
    resetSecrets();
    beginChallenge('register', address, account);
  });
  function validateRegistrationField(id) {
    const value = $(id).value.trim();
    if (id === 'register-email') return validateEmailField(id);
    if (id === 'register-password') return validatePasswordField(id);
    if (id === 'confirm-password') return validatePasswordField(id, 'register-password');
    let error = !value ? 'Este campo es obligatorio.' : '';
    if (!error && ['first-name', 'last-name'].includes(id) && !/^[\p{L}\p{M}][\p{L}\p{M} .’'-]{1,69}$/u.test(value)) error = 'Ingresa un nombre válido de 2 a 70 caracteres.';
    if (!error && id === 'identity' && (!/^[\p{L}\p{N} .-]{5,30}$/u.test(value) || !/[\p{L}\p{N}]/u.test(value))) error = 'Ingresa un documento de 5 a 30 caracteres, con letras o números.';
    if (!error && id === 'phone' && (!/^\+?[0-9 ().-]+$/.test(value) || !/^[0-9]{7,15}$/.test(value.replace(/\D/g, '')))) error = 'Ingresa un teléfono válido de 7 a 15 dígitos.';
    return fieldError(id, error);
  }
  function maskEmail(address) {
    const [local, domain] = address.split('@');
    return local.slice(0, 1) + '***@' + domain;
  }
  function issueCode() {
    let value;
    do { value = crypto.getRandomValues(new Uint32Array(1))[0]; } while (value >= 4294000000);
    challenge.code = String(value % 1000000).padStart(6, '0');
    challenge.expiresAt = Date.now() + OTP_DURATION;
    challenge.resendAt = Date.now() + RESEND_DELAY;
    challenge.attempts = 0;
    digits.forEach(input => { input.value = ''; input.setAttribute('aria-invalid', 'false'); });
    $('demo-otp').textContent = challenge.code;
    message('otp-message'); updateCountdown();
  }
  function beginChallenge(kind, address, account = null) {
    clearChallenge();
    challenge = { kind, email: address, account };
    $('otp-destination').textContent = maskEmail(address);
    $('otp-step').textContent = kind === 'register' ? '2 de 2 · Verificación' : 'Verifica tu identidad';
    $('otp-description').textContent = kind === 'register' ? 'Ingresa el código de seguridad de 6 dígitos para confirmar tu nueva cuenta.' : 'Ingresa el código de 6 dígitos para continuar con la recuperación de tu acceso.';
    $('otp-status').textContent = '';
    issueCode(); show('otp');
    otpTimer = setInterval(updateCountdown, 1000);
  }
  function updateCountdown() {
    if (!challenge) return;
    const seconds = Math.max(0, Math.ceil((challenge.resendAt - Date.now()) / 1000));
    $('resend-countdown').textContent = seconds ? 'Reenviar en ' + String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0') : 'Ya puedes reenviarlo.';
    $('resend-otp').disabled = busy || seconds > 0;
    if (Date.now() >= challenge.expiresAt) message('otp-message', 'El código expiró. Solicita uno nuevo para continuar.');
  }
  $('resend-otp').addEventListener('click', () => {
    if (busy || !challenge || Date.now() < challenge.resendAt) return;
    issueCode();
    $('otp-status').textContent = 'Nuevo código de prueba generado. El anterior ya no es válido.';
    digits[0].focus();
  });
  digits.forEach((input, index) => {
    input.addEventListener('focus', () => input.select());
    input.addEventListener('input', () => {
      const value = input.value.replace(/\D/g, '');
      if (value.length > 1) distributeDigits(value);
      else { input.value = value; if (value && index < 5) digits[index + 1].focus(); }
      digits.forEach(digit => digit.setAttribute('aria-invalid', 'false'));
      message('otp-message');
    });
    input.addEventListener('paste', event => {
      event.preventDefault();
      distributeDigits((event.clipboardData?.getData('text') || '').replace(/\D/g, ''));
      message('otp-message');
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Backspace' && !input.value && index > 0) digits[index - 1].focus();
      if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); digits[index - 1].focus(); }
      if (event.key === 'ArrowRight' && index < 5) { event.preventDefault(); digits[index + 1].focus(); }
    });
  });
  function distributeDigits(value) {
    digits.forEach((input, index) => { input.value = value[index] || ''; });
    digits[Math.min(value.length, 5)].focus();
  }
  bindSubmit('otp-form', 'otp-message', async () => {
    if (!challenge) { goLogin('La verificación ya no está disponible. Inicia el proceso de nuevo.'); return; }
    const code = digits.map(input => input.value).join('');
    if (!/^[0-9]{6}$/.test(code)) { message('otp-message', 'Completa los 6 dígitos del código.'); (digits.find(input => !input.value) || digits[0]).focus(); return; }
    if (Date.now() >= challenge.expiresAt) { message('otp-message', 'El código expiró. Solicita uno nuevo.'); return; }
    if (challenge.attempts >= 5) { message('otp-message', 'Alcanzaste 5 intentos. Solicita un nuevo código cuando termine la cuenta regresiva.'); return; }
    if (code !== challenge.code) {
      challenge.attempts++;
      message('otp-message', challenge.attempts >= 5 ? 'Alcanzaste 5 intentos. Solicita un nuevo código.' : 'El código es incorrecto. Te quedan ' + (5 - challenge.attempts) + ' intentos.');
      digits.forEach(input => input.setAttribute('aria-invalid', 'true'));
      digits[0].focus(); return;
    }
    const verified = challenge;
    if (verified.kind === 'register') {
      if (findAccount(verified.email) || loadAccounts().some(account => account.identity === verified.account.identity)) {
        goLogin('El correo o documento ya se registró. Inicia sesión o recupera tu acceso.', verified.email); return;
      }
      saveAccount(verified.account);
      $('registration-form').reset();
      goLogin('Tu correo fue verificado y tu cuenta está creada. Ingresa con tus credenciales.', verified.email, true);
    } else if (verified.kind === 'username') {
      $('recovered-email').textContent = verified.email;
      clearChallenge(); show('recovered');
    } else {
      resetGrant = { email: verified.email, expiresAt: Date.now() + 10 * 60 * 1000 };
      clearChallenge(); $('reset-form').reset();
      message('reset-message'); fieldError('reset-password'); fieldError('reset-confirm');
      show('reset');
    }
  });
  bindSubmit('recovery-form', 'recovery-message', async () => {
    if (!validateEmailField('recovery-email')) { $('recovery-email').focus(); return; }
    const address = normalEmail($('recovery-email').value);
    if (!findAccount(address)) { message('recovery-message', 'No hay una cuenta local con ese correo. Revisa el correo o crea una cuenta de prueba.'); return; }
    const kind = document.querySelector('input[name="recovery-kind"]:checked').value;
    resetGrant = null; beginChallenge(kind, address);
  });
  bindSubmit('reset-form', 'reset-message', async () => {
    if (!resetGrant || Date.now() >= resetGrant.expiresAt) { goLogin('La autorización expiró. Vuelve a recuperar tu contraseña.'); return; }
    const valid = [validatePasswordField('reset-password'), validatePasswordField('reset-confirm', 'reset-password')];
    if (valid.includes(false)) { (!valid[0] ? $('reset-password') : $('reset-confirm')).focus(); return; }
    const account = findAccount(resetGrant.email);
    if (!account) { goLogin('La cuenta ya no está disponible.'); return; }
    if (await matchesPassword(account, $('reset-password').value)) { fieldError('reset-password', 'Elige una contraseña diferente a la anterior.'); $('reset-password').focus(); return; }
    account.credential = await createCredential($('reset-password').value);
    saveAccount(account);
    const address = resetGrant.email;
    goLogin('Tu contraseña fue actualizada. Ya puedes iniciar sesión con la nueva contraseña.', address, true);
  });
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
    if (busy) return;
    const view = button.dataset.view;
    clearChallenge(); resetGrant = null; resetSecrets();
    if (view === 'login') { goLogin(); return; }
    const form = $(view + '-form'); form.reset();
    form.querySelectorAll('[aria-invalid]').forEach(input => fieldError(input.id));
    message(view + '-message'); show(view);
  }));
  $('otp-back').addEventListener('click', () => {
    if (busy || !challenge) return;
    const view = challenge.kind === 'register' ? 'registration' : 'recovery';
    clearChallenge(); resetSecrets(); show(view);
  });
  $('recovered-login').addEventListener('click', () => goLogin('', $('recovered-email').textContent));
  $('logout').addEventListener('click', () => goLogin());
  function togglePassword(input, button) {
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    button.setAttribute('aria-pressed', String(visible));
    button.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
    if (input.id === 'password') $('eye-slash').toggleAttribute('hidden', !visible);
  }
  $('toggle-password').addEventListener('click', () => togglePassword($('password'), $('toggle-password')));
  document.querySelectorAll('[data-toggle]').forEach(button => button.addEventListener('click', () => togglePassword($(button.dataset.toggle), button)));
  $('fill-demo').addEventListener('click', () => {
    $('email').value = DEMO_EMAIL; $('password').value = DEMO_PASSWORD;
    fieldError('email'); fieldError('password'); message('login-message'); $('submit-login').focus();
  });
  document.querySelectorAll('input[aria-describedby]').forEach(input => {
    if (input.classList.contains('otp-digit')) return;
    input.addEventListener('input', () => {
      fieldError(input.id);
      if (input.id === 'register-password') updateRequirements();
      const messageId = currentView + '-message';
      if ($(messageId)) message(messageId);
    });
    input.addEventListener('blur', () => {
      if (busy) return;
      if (['email', 'recovery-email'].includes(input.id)) validateEmailField(input.id);
      else if (currentView === 'registration') validateRegistrationField(input.id);
    });
  });
  $('biometric-login').addEventListener('click', () => {
    $('dialog-title').textContent = 'Acceso con biometría';
    $('dialog-description').textContent = 'Face ID y huella requieren registrar una credencial con un servicio de autenticación compatible. Por ahora, inicia sesión con tu correo y contraseña.';
    $('info-dialog').showModal();
  });
  $('close-dialog').addEventListener('click', () => $('info-dialog').close());
  updateRequirements(); loadAccounts();
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    const account = session && findAccount(session.email);
    if (account && Number.isFinite(session.expiresAt) && session.expiresAt > Date.now() && session.expiresAt <= Date.now() + SESSION_DURATION) {
      showWelcome({ ...session, firstName: account.firstName }, false);
    } else { removeSession(); show('login', false); }
  } catch { removeSession(); show('login', false); }
})();
