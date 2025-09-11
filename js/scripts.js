// ====== Config ======
const LS_KEY_PRODUCTS = 'admin_products_override'; // donde guarda el panel admin (con versión)

// === API en Apps Script ===
const API_BASE    = 'https://script.google.com/macros/s/AKfycbwcaGIX10Ehl_CA36eyMtTLbeGOtgS6KP8C6w22BBrtf_4c5TFws1QK8ZEy4rzuXwvDlA/exec';
const DATA_URL    = API_BASE + '?route=products';
const VERSION_URL = API_BASE + '?route=version';

const WHATSAPP_PHONE  = '5493563491364';
const SHEETS_ENDPOINT = ''; // opcional

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

// Abrir WhatsApp sin duplicados
function openWhatsApp(url) {
  // abre una sola pestaña; si el navegador bloquea popups, hacemos fallback a location
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

// ====== Fetch utils ======
const fetchJSON = async (url) => {
  const r = await fetch(url, { cache: 'no-store' }); // fuerza red a CDN
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
  return r.json();
};

// ====== Catálogo (con versión + override) ======
let PRODUCTS = [];
let CURRENT_VERSION = '0';

async function loadProducts() {
  if (PRODUCTS.length) return PRODUCTS;

  // 1) traigo versión remota (si falla, uso '0')
  try {
    const v = await fetchJSON(VERSION_URL);
    CURRENT_VERSION = String(v.version || '0');
  } catch(_) {
    CURRENT_VERSION = '0';
  }

  // 2) pido JSON remoto rompiendo caché del CDN
  let remoteProducts = [];
  try {
    const remote = await fetchJSON(`${DATA_URL}?v=${encodeURIComponent(CURRENT_VERSION)}`);
    remoteProducts = normalizeArray(remote);
  } catch (e) {
    console.warn('No pude leer data/products.json:', e);
  }

  // 3) override local del admin
  let override = null;
  try {
    override = JSON.parse(localStorage.getItem(LS_KEY_PRODUCTS) || 'null');
  } catch(_) { override = null; }

  // admite formato { version, products: [...] } o bien un array suelto (legacy)
  const overrideVersion = override && (override.version || '0');
  const overrideList    = override && (Array.isArray(override.products) ? override.products : (Array.isArray(override) ? override : null));
  const normOverride    = normalizeArray(overrideList || []);

  // 4) decido fuente
  const useOverride = normOverride.length > 0 && overrideVersion === CURRENT_VERSION;
  PRODUCTS = (useOverride ? normOverride : remoteProducts).filter(p => p.enabled !== false);

  // 5) si hay override pero de versión distinta, lo limpio
  if (override && overrideVersion !== CURRENT_VERSION) {
    localStorage.removeItem(LS_KEY_PRODUCTS);
  }

  // 6) si no hay nada, muestro error amigable
  if (!PRODUCTS.length) {
    const grid = $('#productGrid');
    if (grid) {
      grid.innerHTML = `
        <div class="col-12">
          <div class="alert alert-danger">
            No pude cargar productos. Probá <a href="?reset=1" class="alert-link">forzar recarga</a>.
          </div>
        </div>`;
    }
  }

  return PRODUCTS;
}

const findProduct = id => PRODUCTS.find(p => p.id === id);

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
               src="${img0}" alt="${title}"
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
}

function bindIndexFilters(){
  $('#searchInput')?.addEventListener('input', e => { FILTERS.q = e.target.value || ''; renderIndex(); });
  $('#leagueSel')?.addEventListener('change', e => { FILTERS.league = e.target.value || ''; renderIndex(); });
  $('#versionSel')?.addEventListener('change', e => { FILTERS.version = e.target.value || ''; renderIndex(); });
  $('#retroChk')?.addEventListener('change', e => { FILTERS.retro = !!e.target.checked; renderIndex(); });
  $('#onlyRetro')?.addEventListener('click', e => { e.preventDefault(); FILTERS.retro = true; const c = $('#retroChk'); if (c) c.checked = true; renderIndex(); });
}

// ====== Detalle ======
function sizePill(size, qty){
  return `<span class="badge bg-light text-dark border me-1 mb-1 ${qty<=0?'text-decoration-line-through opacity-50':''}">
    ${size}: ${qty>0?qty:'sin stock'}
  </span>`;
}

async function renderProduct(){
  const view = $('#productView'); if (!view) return;
  await loadProducts();
  const id = new URLSearchParams(location.search).get('id');
  const p = findProduct(id);
  if (!p){ view.innerHTML = `<p>No se encontró el producto.</p>`; return; }

  const eff = effectiveSizes(p);
  const sizesHtml = Object.entries(eff).map(([s,q]) => sizePill(s,q)).join(' ');
  const firstAvail = Object.keys(eff).find(k => eff[k] > 0) || Object.keys(eff)[0] || 'M';
  const options = Object.entries(eff).map(([s,q]) =>
    `<option value="${s}" ${s===firstAvail?'selected':''} ${q<=0?'disabled':''}>${s} ${q<=0?'(sin stock)':''}</option>`
  ).join('');

  const mainImg = (p.images && p.images[0]) || 'assets/img/placeholder.jpg';

  view.innerHTML = `
    <div class="col-md-6">
      <div class="d-flex flex-column gap-3">
        <img id="mainImg" class="img-fluid rounded"
             src="${mainImg}" alt="${p.name || 'Producto'}"
             onerror="this.onerror=null;this.src='assets/img/placeholder.jpg'">
        <div class="d-flex flex-wrap gap-2">
          ${(p.images||[]).map((src,i)=>`<img class="rounded border" style="width:82px;height:82px;object-fit:cover;cursor:pointer"
             data-src="${src}" src="${src}" alt="${(p.name||'Producto')} ${i+1}"
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

  // thumbs -> main
  $$('#productView [data-src]').forEach(t => t.addEventListener('click', e => {
    $('#mainImg').src = e.currentTarget.dataset.src;
  }));

  // add to cart (valida stock efectivo)
  $('#addBtn').addEventListener('click', () => {
    const size = $('#sizeSel').value;
    let qty = Math.max(1, parseInt($('#qtySel').value || '1', 10));
    const avail = availableFor(p, size);
    if (avail <= 0) return alert('No hay stock de ese talle.');
    if (qty > avail) { qty = avail; alert(`Solo quedan ${avail} en talle ${size}.`); }
    addToCart(p.id, size, qty);
    renderProduct();
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
  const p = PRODUCTS.find(x=>x.id===productId);
  if (!p) return;
  const avail = availableFor(p, size);
  if (avail <= 0) { alert('No hay stock de ese talle.'); return; }

  const idx = cart.findIndex(i => i.productId===productId && i.size===size);
  if (idx>=0){
    const newQty = Math.min(cart[idx].qty + qty, availableFor(p, size, idx));
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
  const p = PRODUCTS.find(x=>x.id===cart[i].productId) || {};
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
    $('#cartTotal') && ($('#cartTotal').textContent = money(0));
    return;
  }

  wrap.innerHTML = `
    <div class="table-responsive">
      <table class="table align-middle">
        <thead><tr>
          <th>Producto</th><th class="text-center">Talle</th>
          <th style="width:130px;">Cantidad</th><th>Subtotal</th><th></th>
        </tr></thead>
        <tbody>
          ${cart.map((i,idx)=> {
            const p = PRODUCTS.find(x=>x.id===i.productId) || {};
            const max = availableFor(p, i.size, idx);
            const name = i.name || p.name || 'Producto';
            const price = i.price ?? p.price ?? 0;
            return `
              <tr>
                <td>${name}</td>
                <td class="text-center">${i.size}</td>
                <td>
                  <input type="number" min="1" max="${Math.max(1,max)}"
                         class="form-control form-control-sm qty" data-idx="${idx}" value="${i.qty||1}">
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

  $('#cartTotal') && ($('#cartTotal').textContent = money(cartTotal()));
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
  // Atajo de emergencia: ?reset=1 limpia override local
  if (new URLSearchParams(location.search).has('reset')) {
    localStorage.removeItem(LS_KEY_PRODUCTS);
  }

  updateCartBadge();
  const page = document.body.dataset.page || '';

  if (page === 'index'){ bindIndexFilters(); renderIndex(); bindRequestForm(); }
  if (page === 'product'){ renderProduct(); }
  if (page === 'cart'){ await renderCart(); $('#checkoutBtn')?.addEventListener('click', checkout); }

  bindQuickOrderForm(); // modal "Hacé tu pedido"
});
