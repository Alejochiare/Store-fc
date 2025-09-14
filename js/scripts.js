// ==============================
// scripts.js  (rápido + listo para Service Worker)
// ==============================

const LS_KEY_PRODUCTS   = 'admin_products_override';      // override local del admin (preview)
const PUBLIC_CACHE_KEY  = 'store_products_cache_v3';      // cache público por versión (rápido)
const API_BASE          = 'https://script.google.com/macros/s/AKfycbwBMAN-2Ejo9-OIltCIWJzK9jiMKLEbug_KJlrpMFQ69xJIjvm5lXOTEi3j9rWWsbjreg/exec';
const DATA_URL          = API_BASE + '?route=products';
const VERSION_URL       = API_BASE + '?route=version';
const WHATSAPP_PHONE    = '5493563491364';
const SHEETS_ENDPOINT   = '';

// ====== Estado global ======
let PRODUCTS = [];
let CURRENT_VERSION = '0';
let _refreshing = false;
let _byId = Object.create(null); // índice por id para resoluciones instantáneas

// ====== Helpers ======
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const money = n => new Intl.NumberFormat('es-AR', {
  style:'currency', currency:'ARS', maximumFractionDigits:0
}).format(Number.isFinite(+n) ? +n : 0);

const getCart = () => JSON.parse(localStorage.getItem('cart') || '[]');
const setCart  = c => { localStorage.setItem('cart', JSON.stringify(c)); updateCartBadge(); };
const updateCartBadge = () => {
  const c = getCart();
  const el = $('#cartCount');
  if (el) el.textContent = c.reduce((a,i)=>a + (i.qty||0), 0);
};

// Debounce para no rerender en cada tecla
const debounce = (fn, ms=200) => {
  let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
};

// Abrir WhatsApp sin duplicados
function openWhatsApp(url) {
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (win && !win.closed) { try { win.opener = null; } catch(_) {} return; }
  window.location.assign(url);
}

// ====== Normalización ======
function normalizeArray(raw) {
  const arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.products) ? raw.products : []);
  return arr.map((p, idx) => ({
    id       : p.id || p.slug || `p_${idx}`,
    name     : p.name || p.title || p.nombre || 'Producto',
    subtitle : p.subtitle || p.sub || '',
    price    : Number(p.price ?? p.precio ?? 0),
    league   : p.league || p.liga || '',
    version  : p.version || '',
    retro    : !!p.retro,
    images   : Array.isArray(p.images) ? p.images : (Array.isArray(p.imgs) ? p.imgs : []),
    sizes    : typeof p.sizes === 'object' && p.sizes ? p.sizes
               : (typeof p.talles === 'object' && p.talles ? p.talles : {}),
    tags     : Array.isArray(p.tags) ? p.tags : [],
    enabled  : p.enabled !== false
  }));
}
function rebuildIndex(list){
  _byId = Object.create(null);
  (list||[]).forEach(p => { if (p?.id) _byId[p.id] = p; });
}

// ====== Fetch utils (deja que el Service Worker maneje la caché) ======
const fetchJSON = async (url, {timeout=7000}={}) => {
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), timeout);
  try{
    const r = await fetch(url, { signal: ctrl.signal }); // sin cache explicita
    if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
    return r.json();
  } finally { clearTimeout(t); }
};

// ====== Carga + cacheo por versión (con soporte de override del admin) ======
function readOverride(){
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY_PRODUCTS) || 'null');
    if (!raw) return null;
    const version  = raw.version || '0';
    const list     = Array.isArray(raw.products) ? raw.products : (Array.isArray(raw) ? raw : []);
    const norm     = normalizeArray(list);
    return { version, products: norm };
  } catch { return null; }
}

function savePublicCache(version, products){
  try {
    localStorage.setItem(PUBLIC_CACHE_KEY, JSON.stringify({ version, products }));
  } catch(e){
    try { localStorage.setItem(PUBLIC_CACHE_KEY, JSON.stringify({ version, products: [] })); } catch(_){}
  }
}

function pickDisplayList(baseList, baseVersion){
  const ov = readOverride();
  if (ov && ov.products?.length && String(ov.version||'0') === String(baseVersion||'0')) {
    return ov.products.filter(p => p.enabled !== false);
  }
  return (baseList || []).filter(p => p.enabled !== false);
}

async function loadProducts() {
  if (PRODUCTS.length) return PRODUCTS;

  // 0) Cache público inmediato
  try {
    const cached = JSON.parse(localStorage.getItem(PUBLIC_CACHE_KEY) || 'null');
    if (cached && (Array.isArray(cached.products) || cached.version)) {
      CURRENT_VERSION = String(cached.version || '0');
      PRODUCTS = pickDisplayList(cached.products || [], CURRENT_VERSION);
      rebuildIndex(PRODUCTS);
      // refrescar en background
      requestIdleCallback?.(refreshFromServer) ?? setTimeout(refreshFromServer, 0);
      return PRODUCTS;
    }
  } catch(_) {}

  // 1) Sin cache: traemos versión + productos lo más rápido posible
  await refreshFromServer(true);
  return PRODUCTS;
}

async function refreshFromServer(force = false){
  if (_refreshing) return;
  _refreshing = true;
  try {
    // pedir versión remota
    let remoteVersion = CURRENT_VERSION;
    try {
      const v = await fetchJSON(VERSION_URL, {timeout:4000});
      remoteVersion = String(v.version || '0');
    } catch(_) {}

    if (!force && remoteVersion === CURRENT_VERSION && PRODUCTS.length) return;

    // traer productos remotos (rompemos cache con ?v=version — clave para SW)
    const remoteRaw = await fetchJSON(`${DATA_URL}?v=${encodeURIComponent(remoteVersion)}`, {timeout:7000});
    const remoteList = normalizeArray(remoteRaw);

    // cache público + estado actual
    savePublicCache(remoteVersion, remoteList);
    CURRENT_VERSION = remoteVersion;
    PRODUCTS = pickDisplayList(remoteList, CURRENT_VERSION);
    rebuildIndex(PRODUCTS);

    rerender();
  } catch (e) {
    console.warn('refreshFromServer error', e);
  } finally {
    _refreshing = false;
  }
}

function rerender(){
  const page = document.body.dataset.page || '';
  if (page === 'index')   renderIndex();
  if (page === 'product') renderProduct();
  if (page === 'cart')    renderCart();
}

const findProduct = id => _byId[id];

// ====== Stock efectivo (resta lo que hay en carrito) ======
function reservedQty(productId, size, excludeIndex = null){
  return getCart().reduce((sum, item, idx) => {
    if (idx === excludeIndex) return sum;
    if (item.productId === productId && (!size || item.size === size)) return sum + (item.qty||0);
    return sum;
  }, 0);
}
function effectiveSizes(p){
  const out = {...(p.sizes || {})};
  for (const s in out) out[s] = Math.max(0, (out[s]||0) - reservedQty(p.id, s));
  return out;
}
function availableFor(p, size, excludeIndex = null){
  const base = p?.sizes?.[size] || 0;
  const pid  = p?.id;
  const reserved = reservedQty(pid, size, excludeIndex);
  return Math.max(0, base - reserved);
}

// ====== Lazy images ======
function setupLazyImages(rootEl){
  const imgs = (rootEl || document).querySelectorAll('img[data-src]');
  if (!imgs.length) return;
  const io = new IntersectionObserver(entries=>{
    entries.forEach(en=>{
      if (en.isIntersecting) {
        const img = en.target;
        img.src = img.dataset.src;
        img.decoding = 'async';
        img.removeAttribute('data-src');
        io.unobserve(img);
      }
    });
  }, { rootMargin: '200px' });
  imgs.forEach(img => io.observe(img));
}

// ====== Home (grid + filtros) ======
const FILTERS = { q:'', league:'', version:'', retro:false };

function applyFilters(list){
  let out = list.filter(p => p.enabled !== false);
  const q = FILTERS.q.trim().toLowerCase();
  if (q) out = out.filter(p =>
    [p.name, p.subtitle, p.league, p.version, ...(p.tags||[])].join(' ').toLowerCase().includes(q)
  );
  if (FILTERS.league)  out = out.filter(p => p.league  === FILTERS.league);
  if (FILTERS.version) out = out.filter(p => p.version === FILTERS.version);
  if (FILTERS.retro)   out = out.filter(p => !!p.retro);
  return out;
}

async function renderIndex(){
  const list = applyFilters(await loadProducts());
  const grid = $('#productGrid');
  if (!grid) return;

  if (!list.length){
    grid.innerHTML = `<div class="col-12"><div class="alert alert-secondary">No se encontraron productos.</div></div>`;
    return;
  }

  grid.innerHTML = list.map(p => {
    const title = p.name || 'Producto';
    const sub   = p.subtitle || '';
    const price = Number.isFinite(+p.price) ? +p.price : 0;
    const img0  = (p.images && p.images[0]) || 'assets/img/placeholder.jpg';
    return `
    <div class="col mb-5">
      <div class="card h-100">
        ${p.retro ? `<div class="badge bg-dark text-white position-absolute" style="top:.5rem;right:.5rem">Retro</div>` : ''}
        <a class="text-decoration-none" href="product.html?id=${encodeURIComponent(p.id)}">
          <img class="card-img-top"
               loading="lazy"
               data-src="${img0}"
               src="assets/img/placeholder.jpg"
               alt="${title}"
               onerror="this.onerror=null;this.src='assets/img/placeholder.jpg'">
        </a>
        <div class="card-body p-4">
          <div class="text-center">
            <h5 class="fw-bolder">${title}</h5>
            ${sub ? `<div class="text-muted small">${sub}</div>`:''}
            <div class="mt-2">${money(price)}</div>
          </div>
        </div>
        <div class="card-footer p-4 pt-0 border-top-0 bg-transparent">
          <div class="text-center">
            <a class="btn btn-outline-dark mt-auto" href="product.html?id=${encodeURIComponent(p.id)}">Ver más</a>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  setupLazyImages(grid);
}

function bindIndexFilters(){
  $('#searchInput')?.addEventListener('input', debounce(e => { FILTERS.q = e.target.value || ''; renderIndex(); }, 180));
  $('#leagueSel')?.addEventListener('change', e => { FILTERS.league = e.target.value || ''; renderIndex(); });
  $('#versionSel')?.addEventListener('change', e => { FILTERS.version = e.target.value || ''; renderIndex(); });
  $('#retroChk')?.addEventListener('change', e => { FILTERS.retro = !!e.target.checked; renderIndex(); });
  $('#onlyRetro')?.addEventListener('click', e => { e.preventDefault(); FILTERS.retro = true; const c = $('#retroChk'); if (c) c.checked = true; renderIndex(); });
}

// ====== Loader para product.html (controlado desde acá para evitar parpadeos) ======
function setProductStatus(mode){
  const box = $('#product-status');
  if (!box) return;
  if (mode === 'hide'){ box.style.display='none'; return; }
  if (mode === 'error'){ box.className='status status--error'; box.textContent='No encontramos ese producto.'; box.style.display='flex'; return; }
  // loading
  box.className='status status--loading';
  box.innerHTML='<span class="spinner" aria-hidden="true"></span><span>Cargando producto…</span>';
  box.style.display='flex';
}

// ====== Detalle ======
const productCacheKey = id => `p_cache_${id}`; // cache rápido por pestaña

function sizePill(size, qty){
  return `<span class="badge bg-light text-dark border me-1 mb-1 ${qty<=0?'text-decoration-line-through opacity-50':''}">
    ${size}: ${qty>0?qty:'sin stock'}
  </span>`;
}

async function renderProduct(){
  const view = $('#productView'); if (!view) return;

  const id = new URLSearchParams(location.search).get('id') || '';
  if (!id) { setProductStatus('error'); view.innerHTML = ''; return; }

  // 0) Loader visible y prueba de caché de esta pestaña
  setProductStatus('loading');

  const cached = sessionStorage.getItem(productCacheKey(id));
  if (cached){
    const p = JSON.parse(cached);
    renderProductInner(p);
    setProductStatus('hide');
    // warm-up en idle
    requestIdleCallback?.(()=>loadProducts()) ?? setTimeout(loadProducts, 0);
    return;
  }

  // 1) Carga global (rápida si hay cache por versión)
  await loadProducts();

  const p = findProduct(id);
  if (!p){ setProductStatus('error'); view.innerHTML = ''; return; }

  // 2) Render + cache por pestaña
  sessionStorage.setItem(productCacheKey(id), JSON.stringify(p));
  renderProductInner(p);
  setProductStatus('hide');
}

function renderProductInner(p){
  const view = $('#productView'); if (!view) return;

  const eff = effectiveSizes(p);
  const sizesHtml = Object.entries(eff).map(([s,q]) => sizePill(s,q)).join(' ');
  const firstAvail = Object.keys(eff).find(k => eff[k] > 0) || Object.keys(eff)[0] || 'M';
  const options = Object.entries(eff).map(([s,q]) =>
    `<option value="${s}" ${s===firstAvail?'selected':''} ${q<=0?'disabled':''}>${s} ${q<=0?'(sin stock)':''}</option>`
  ).join('');

  const mainImg = (p.images && p.images[0]) || 'assets/img/placeholder.jpg';

  view.innerHTML = `
    <div class="col-md-6">
      <div class="d-flex flex-column gap-3 product-hero">
        <img id="mainImg" class="img-fluid rounded"
             src="${mainImg}" alt="${p.name || 'Producto'}"
             decoding="async"
             onerror="this.onerror=null;this.src='assets/img/placeholder.jpg'">
        <div class="d-flex flex-wrap gap-2">
          ${(p.images||[]).map((src,i)=>`<img class="rounded border" style="width:82px;height:82px;object-fit:cover;cursor:pointer"
             loading="lazy" data-src="${src}" src="assets/img/placeholder.jpg"
             alt="${(p.name||'Producto')} ${i+1}"
             onerror="this.onerror=null;this.src='assets/img/placeholder.jpg'">`).join('')}
        </div>
      </div>
    </div>
    <div class="col-md-6">
      <h3 class="mb-1">${p.name || 'Producto'}</h3>
      ${p.subtitle ? `<div class="text-muted mb-2">${p.subtitle}</div>`:''}
      <div class="h4 mb-3">${money(p.price)}</div>

      <div class="mb-2">Liga: <strong>${p.league || '-'}</strong> · Versión: <strong>${p.version || '-'}</strong> ${p.retro?'· <strong>Retro</strong>':''}</div>
      <div class="mb-3">Stock por talle:<br>${sizesHtml}</div>

      <div class="row g-2 align-items-end mb-3">
        <div class="col-6">
          <label class="form-label">Talle</label>
          <select id="sizeSel" class="form-select">${options}</select>
        </div>
        <div class="col-6">
          <label class="form-label">Cantidad</label>
          <input id="qtySel" type="number" class="form-control" value="1" min="1">
        </div>
      </div>

      <div class="d-flex gap-2">
        <button id="addBtn" class="btn btn-dark"><i class="bi bi-bag-plus me-1"></i> Agregar al carrito</button>
        <button id="buyBtn" class="btn btn-outline-dark"><i class="bi bi-whatsapp me-1"></i> Comprar por WhatsApp</button>
      </div>
    </div>
  `;

  // lazy thumbs
  setupLazyImages(view);

  // thumbs -> main
  $$('#productView [data-src]').forEach(t => t.addEventListener('click', e => {
    const src = e.currentTarget.dataset.src || e.currentTarget.src;
    const main = $('#mainImg'); if (main) { main.src = src; main.decoding='async'; }
  }));

  // add to cart (valida stock efectivo)
  $('#addBtn').addEventListener('click', () => {
    const size = $('#sizeSel').value;
    let qty = Math.max(1, parseInt($('#qtySel').value || '1', 10));
    const avail = availableFor(p, size);
    if (avail <= 0) return alert('No hay stock de ese talle.');
    if (qty > avail) { qty = avail; alert(`Solo quedan ${avail} en talle ${size}.`); }
    addToCart(p.id, size, qty);
    renderProductInner(p); // refresca stock mostrado
  });

  // compra directa por whatsapp
  $('#buyBtn').addEventListener('click', () => {
    const size = $('#sizeSel').value;
    const qty = Math.max(1, parseInt($('#qtySel').value || '1', 10));
    const avail = availableFor(p, size);
    if (avail <= 0 || qty > avail) return alert('Cantidad supera el stock disponible.');
    const line = `• ${qty}× ${p.name || 'Producto'} (talle ${size}) — ${money(p.price*qty)}`;
    const msg = `Hola! Quiero comprar:\n${line}\n\nTotal: ${money(p.price*qty)}`;
    const url = `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(msg)}`;
    openWhatsApp(url);
  });
}

// ====== Carrito ======
function addToCart(productId, size, qty=1){
  const cart = getCart();
  const p = _byId[productId];
  if (!p) return;
  const avail = availableFor(p, size);
  if (avail <= 0) { alert('No hay stock de ese talle.'); return; }

  const idx = cart.findIndex(i => i.productId===productId && i.size===size);
  if (idx>=0){
    const newQty = Math.min((cart[idx].qty||0) + qty, availableFor(p, size, idx));
    cart[idx].qty = newQty;
  } else {
    const pushQty = Math.min(qty, avail);
    cart.push({ productId, name: p.name || 'Producto', price: p.price || 0, size, qty: pushQty });
  }
  setCart(cart);
}

function removeFromCart(i){
  const cart = getCart();
  cart.splice(i,1);
  setCart(cart);
  renderCart();
}
function updateQty(i, q){
  const cart = getCart();
  const p = _byId[cart[i].productId] || {};
  const max = availableFor(p, cart[i].size, i);
  cart[i].qty = Math.max(1, Math.min(q|0, Math.max(1, max)));
  setCart(cart);
  renderCart();
}
const cartTotal = () => getCart().reduce((a,i)=>a + (i.price||0)*(i.qty||0), 0);

async function renderCart(){
  const wrap = $('#cartView'); if (!wrap) return;
  await loadProducts();
  const cart = getCart();

  if (!cart.length){
    wrap.innerHTML = `<p class="text-muted">Tu carrito está vacío.</p>`;
    if ($('#cartTotal')) $('#cartTotal').textContent = money(0);
    return;
  }

  wrap.innerHTML = `
    <div class="table-responsive">
      <table class="table align-middle">
        <thead>
          <tr>
            <th>Producto</th>
            <th class="text-center">Talle</th>
            <th style="width:130px;">Cantidad</th>
            <th>Subtotal</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${cart.map((i,idx)=> {
            const p = _byId[i.productId] || {};
            const max = availableFor(p, i.size, idx);
            const name = i.name || p.name || 'Producto';
            const price = i.price ?? p.price ?? 0;
            return `
              <tr>
                <td>${name}</td>
                <td class="text-center">${i.size}</td>
                <td>
                  <input type="number" min="1" max="${Math.max(1,max)}"
                         class="form-control form-control-sm qty"
                         data-idx="${idx}" value="${i.qty||1}">
                  <div class="form-text">Disp.: ${max}</div>
                </td>
                <td>${money((price||0)*(i.qty||0))}</td>
                <td class="text-end">
                  <button class="btn btn-sm btn-outline-danger del" data-idx="${idx}">
                    <i class="bi bi-trash"></i>
                  </button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  $$('#cartView .qty').forEach(inp => inp.addEventListener('input', e => {
    const idx = +e.target.dataset.idx;
    let val = parseInt(e.target.value||'1',10);
    if (isNaN(val) || val<1) val = 1;
    updateQty(idx, val);
  }));
  $$('#cartView .del').forEach(btn => btn.addEventListener('click', e => {
    removeFromCart(+e.currentTarget.dataset.idx);
  }));

  if ($('#cartTotal')) $('#cartTotal').textContent = money(cartTotal());
}

// ====== Checkout (WhatsApp + opcional Sheets) ======
async function checkout(){
  const cart = getCart();
  if (!cart.length) return alert('El carrito está vacío.');
  const total = cartTotal();
  const lines = cart.map(i => `• ${i.qty}× ${i.name} (talle ${i.size}) — ${money(i.price*i.qty)}`).join('\n');
  const msg = `Hola! Quiero comprar:\n${lines}\n\nTotal: ${money(total)}\n\nNombre:\nDirección/Localidad:\nMétodo de envío (Retiro/Envío):`;
  const url = `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(msg)}`;

  if (SHEETS_ENDPOINT) {
    try {
      await fetch(SHEETS_ENDPOINT, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ type:'venta', timestamp:new Date().toISOString(), total, items: cart, source:'web' })
      });
    } catch(e){ console.warn('Sheets error', e); }
  }
  openWhatsApp(url);
}

// ====== Pedidos (form sección -> WhatsApp) ======
function bindRequestForm(){
  const form = $('#requestForm'); if (!form) return;
  if (form.dataset.bound) return;
  form.dataset.bound = '1';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (form.dataset.sending === '1') return;
    form.dataset.sending = '1';

    try {
      const data = Object.fromEntries(new FormData(form).entries());
      const msg =
        `Hola! Quiero pedir una camiseta que no veo en stock:\n` +
        `• Equipo: ${data.equipo}\n• Liga: ${data.liga||'-'}\n• Temporada: ${data.temporada||'-'}\n` +
        `• Versión: ${data.version||'-'}\n• Talle: ${data.talle||'-'}\n` +
        `• Comentarios: ${data.comentarios||'-'}\n\n` +
        `Mis datos:\n• Nombre: ${data.nombre}\n• Localidad: ${data.localidad||'-'}\n• Contacto: ${data.contacto||'-'}`;

      const url = `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(msg)}`;

      if (SHEETS_ENDPOINT) {
        try {
          await fetch(SHEETS_ENDPOINT, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ type:'pedido', ...data, timestamp:new Date().toISOString() })
          });
        } catch(e){ console.warn('Sheets error', e); }
      }
      openWhatsApp(url);
      form.reset();
    } finally {
      setTimeout(()=>{ form.dataset.sending = '0'; }, 600);
    }
  });
}

// === Pedido rápido (modal) -> WhatsApp ===
function bindQuickOrderForm(){
  const form = $('#quickOrderForm');
  if (!form) return;
  if (form.dataset.bound) return;
  form.dataset.bound = '1';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (form.dataset.sending === '1') return;
    form.dataset.sending = '1';

    try {
      const data = Object.fromEntries(new FormData(form).entries());
      const dorsal  = (data.dorsal  || '').trim();
      const numero  = (data.numero  || '').trim();
      const parches = (data.parches || '').trim();

      const msg = [
        'Pedido de remera',
        `Club: ${data.club}`,
        `Año/Temporada: ${data.anio}`,
        `Titular/Suplente: ${data.modelo}`,
        `Versión: ${data.version}`,
        `Dorsal: ${dorsal || 'sin dorsal'}`,
        `Número: ${numero || '-'}`,
        `Parches: ${parches || 'sin parches'}`,
        '',
        '(Nota: si la querés sin dorsal/ni número/ni parches, dejá esos campos vacíos)'
      ].join('\n');

      const url = `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(msg)}`;

      if (typeof SHEETS_ENDPOINT === 'string' && SHEETS_ENDPOINT) {
        try {
          await fetch(SHEETS_ENDPOINT, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ type:'pedido-rapido', ...data, timestamp:new Date().toISOString() })
          });
        } catch(e){ console.warn('Sheets error', e); }
      }

      openWhatsApp(url);

      try {
        const m = bootstrap.Modal.getInstance(document.getElementById('pedidoModal'));
        m && m.hide();
      } catch(_) {}
      form.reset();
    } finally {
      setTimeout(()=>{ form.dataset.sending = '0'; }, 600);
    }
  });
}

// ====== Init ======
document.addEventListener('DOMContentLoaded', async () => {
  // Registrar Service Worker (para cache de JSON/imágenes y SWR)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  }

  // Atajo de emergencia: ?reset=1 limpia override local y cache público
  if (new URLSearchParams(location.search).has('reset')) {
    localStorage.removeItem(LS_KEY_PRODUCTS);
    localStorage.removeItem(PUBLIC_CACHE_KEY);
    sessionStorage.clear();
  }

  updateCartBadge();
  const page = document.body.dataset.page || '';

  if (page === 'index'){ bindIndexFilters(); renderIndex(); bindRequestForm(); }
  if (page === 'product'){ renderProduct(); }
  if (page === 'cart'){ await renderCart(); $('#checkoutBtn')?.addEventListener('click', checkout); }

  bindQuickOrderForm(); // modal "Hacé tu pedido"

  // Optimización global: imágenes existentes -> async decode + lazy por default
  document.querySelectorAll('img').forEach(img=>{
    if(!img.closest('.product-hero')) img.loading = img.loading || 'lazy';
    img.decoding = 'async';
  });
});
