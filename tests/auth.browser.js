/* Se ejecuta únicamente en el HTML de prueba generado por verify.ps1. */
window.addEventListener('load', async () => {
  const $ = id => document.getElementById(id);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const results = JSON.parse(sessionStorage.getItem('qa.results') || '[]');
  const assert = (condition, description) => {
    if (!condition) throw new Error(description);
    results.push(description);
  };
  const input = (id, value) => {
    $(id).value = value;
    $(id).dispatchEvent(new Event('input', { bubbles: true }));
  };
  const view = name => document.body.dataset.view === name;
  const submit = async id => {
    $(id).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    for (let i = 0; i < 1000 && $(id).getAttribute('aria-busy') === 'true'; i++) await pause(20);
    assert($(id).getAttribute('aria-busy') === 'false', 'Finaliza ' + id);
  };
  const go = name => document.querySelector('[data-view="' + name + '"]').click();
  const code = value => input('otp-1', value || $('demo-otp').textContent);
  const noOverflow = () => assert(document.documentElement.scrollWidth <= innerWidth, 'Sin desbordamiento: ' + document.body.dataset.view);
  const fillRegistration = (address = 'qa.auth@example.com', identity = 'QA-123456') => {
    Object.entries({ 'first-name': 'María', 'last-name': 'González', identity, phone: '+593 99 123 4567', 'register-email': address, 'register-password': 'Prueba2026!', 'confirm-password': 'Prueba2026!' }).forEach(([id, value]) => input(id, value));
  };
  const finish = () => {
    document.body.dataset.testResult = 'PASS: ' + results.length + ' comprobaciones. ' + results.join(' | ');
    sessionStorage.removeItem('qa.phase'); sessionStorage.removeItem('qa.results');
  };
  try {
    if (sessionStorage.getItem('qa.phase') === 'reload') {
      assert(view('welcome'), 'Sesion restaurada al recargar');
      assert($('welcome-title').textContent.includes('María'), 'Nombre restaurado');
      $('logout').click();
      assert(view('login') && sessionStorage.getItem('saulbank.demo.session.v1') === null, 'Cerrar sesion elimina acceso');
      finish(); return;
    }
    if (view('welcome')) $('logout').click();
    await submit('login-form');
    assert(!$('email-error').hidden && !$('password-error').hidden, 'Login obligatorio');
    noOverflow(); go('registration'); noOverflow();
    await submit('registration-form');
    assert(!$('first-name-error').hidden, 'Registro obligatorio');
    fillRegistration(); input('phone', '123'); input('register-password', 'abc'); input('confirm-password', 'distinta');
    await submit('registration-form');
    assert(!$('phone-error').hidden && !$('register-password-error').hidden && !$('confirm-password-error').hidden, 'Telefono, fuerza y confirmacion');
    fillRegistration();
    assert(document.querySelectorAll('[data-rule].met').length === 4, 'Requisitos de seguridad reactivos');
    document.querySelector('[data-toggle="register-password"]').click();
    assert($('register-password').type === 'text', 'Mostrar contrasena de registro');
    await submit('registration-form');
    assert(view('otp'), 'Registro conduce a OTP'); noOverflow();
    assert(!JSON.parse(localStorage.getItem('saulbank.demo.accounts.v2') || '[]').some(a => a.email === 'qa.auth@example.com'), 'Cuenta pendiente no puede ingresar');
    assert($('otp-destination').textContent === 'q***@example.com', 'Correo enmascarado');
    assert($('resend-otp').disabled, 'Espera para reenvio');
    await submit('otp-form');
    assert(!$('otp-message').hidden, 'OTP incompleto rechazado');
    const originalCode = $('demo-otp').textContent;
    const wrong = originalCode === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 5; attempt++) { code(wrong); await submit('otp-form'); }
    code(originalCode); await submit('otp-form');
    assert(view('otp') && $('otp-message').textContent.includes('5 intentos'), 'Bloqueo despues de cinco intentos');
    const originalNow = Date.now;
    let offset = 61000;
    Date.now = () => originalNow() + offset;
    await pause(1100);
    assert(!$('resend-otp').disabled, 'Reenvio disponible tras espera');
    $('resend-otp').click();
    assert($('otp-status').textContent.includes('anterior'), 'Reenvio reinicia verificacion');
    code(); offset += 301000;
    await submit('otp-form');
    assert(view('otp') && $('otp-message').textContent.includes('expir'), 'OTP vencido rechazado');
    await pause(1100); $('resend-otp').click();
    code(); await submit('otp-form');
    Date.now = originalNow;
    assert(view('login') && $('login-message').classList.contains('success'), 'Registro verificado vuelve al login');
    const account = JSON.parse(localStorage.getItem('saulbank.demo.accounts.v2')).find(a => a.email === 'qa.auth@example.com');
    assert(account && account.credential.hash && !JSON.stringify(account).includes('Prueba2026!'), 'Cuenta guardada sin contrasena en texto');
    go('registration'); fillRegistration(); await submit('registration-form');
    assert(view('registration') && !$('register-email-error').hidden, 'Correo duplicado rechazado');
    fillRegistration('qa.other@example.com'); await submit('registration-form');
    assert(!$('identity-error').hidden, 'Documento duplicado rechazado');
    go('login'); input('email', 'qa.auth@example.com'); input('password', 'Incorrecta1!'); await submit('login-form');
    assert(view('login') && !$('login-message').hidden, 'Credenciales incorrectas rechazadas');
    input('password', 'Prueba2026!'); await submit('login-form');
    assert(view('welcome') && $('welcome-title').textContent.includes('María'), 'Ingreso con cuenta creada');
    assert($('password').value === '', 'Contrasena borrada al ingresar'); noOverflow(); $('logout').click();
    go('recovery'); noOverflow(); input('recovery-email', 'no-existe@example.com'); await submit('recovery-form');
    assert(view('recovery') && !$('recovery-message').hidden, 'Recuperacion exige correo registrado');
    input('recovery-email', 'qa.auth@example.com');
    document.querySelector('[value="username"]').checked = true;
    await submit('recovery-form'); code(); await submit('otp-form');
    assert(view('recovered') && $('recovered-email').textContent === 'qa.auth@example.com', 'Usuario recuperado tras OTP');
    $('recovered-login').click(); go('recovery'); input('recovery-email', 'qa.auth@example.com');
    await submit('recovery-form'); code(); await submit('otp-form');
    assert(view('reset'), 'OTP habilita cambio de contrasena'); noOverflow();
    input('reset-password', 'Nueva2026!'); input('reset-confirm', 'Otra2026!'); await submit('reset-form');
    assert(!$('reset-confirm-error').hidden, 'Cambio exige contrasenas iguales');
    input('reset-confirm', 'Nueva2026!'); await submit('reset-form');
    assert(view('login') && $('login-message').textContent.includes('actualizada'), 'Cambio completado');
    input('password', 'Prueba2026!'); await submit('login-form');
    assert(view('login') && !$('login-message').hidden, 'Contrasena anterior invalidada');
    input('password', 'Nueva2026!'); await submit('login-form');
    assert(view('welcome'), 'Nueva contrasena permite acceso');
    sessionStorage.setItem('qa.results', JSON.stringify(results)); sessionStorage.setItem('qa.phase', 'reload');
    location.reload();
  } catch (error) {
    document.body.dataset.testResult = 'FAIL: ' + error.message + '. Completadas: ' + results.join(' | ');
  }
});
