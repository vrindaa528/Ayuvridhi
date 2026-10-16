/* Boot. */
'use strict';
(function boot() {
  const gl = document.getElementById('guideLogo');
  if (gl) gl.innerHTML = LOGO;
  S.member = store.get('member', null);
  window.addEventListener('hashchange', render);
  window.addEventListener('scroll', () => { const t = $('#topbar'); if (t) t.classList.toggle('scrolled', window.scrollY > 4); }, { passive: true });
  const startApp = () => render();
  if (window.AY_READY) window.AY_READY.then(startApp, (e) => { document.getElementById('view').innerHTML = `<div class="card alert">Could not start the app: ${esc(e.message)}</div>`; });
  else startApp();
})();
