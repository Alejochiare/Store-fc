// ====== Config ======
const DATA_URL = 'data/products.json?v=2';
const WHATSAPP_PHONE = '5493563491364'; // 549 + area sin 0 + numero sin 15
const SHEETS_ENDPOINT = ''; // opcional: Apps Script para loguear compras (pedidos/ventas)

// ====== Helpers ======
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const money = n => new Intl.NumberFormat('es-AR', {style:'currency', currency:'ARS', maximumFractionDigits:0}).format(n);
const getCart = () => JSON.parse(localStorage.getItem('cart') || '[]');
const setCart = (c) => (localStorage.setItem('cart', JSON.stringify(c)), updateCartBadge());
const updateCartBadge = () => { const c = getCart(); $('#cartCount') && ($('#cartCount').textContent = c.reduce((a,i)=>a+i.qty,0)); };

// Abrir WhatsApp sin duplicados (evita null por noopener/noreferrer)
function openWhatsApp(url){
  // abrir en nueva pestaña (sin 3er parámetro para no provocar null)
  const win = window.open(url, '_blank');
  if (win && !win.closed) {
    try { win.opener = null; } catch(_) {}
    return; // éxito: no hagas fallback
  }
  // si un bloqueador impide la pestaña, navegar en la misma
  window.location.assign(url);
}

let PRODUCTS = [];
const FILTERS = { q:'', league:'', version:'', retro:false };

// ====== Carga de productos ======
async function loadProducts(){
  if (PRODUCTS.length) return PRODUCTS;
  try {
    const res = await fetch(DATA_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`No se pudo leer ${DATA_URL} (${res.status})`);
    const data = await res.json();
    PRODUCTS = data.products || [];
  } catch (e) {
    console.warn('Error cargando productos:', e);
    PRODUCTS = [];
    const grid = document.querySelector('#productGrid');
    if (grid) grid.innerHTML = `<div class="col-12">
      <div class="alert alert-danger">No pude cargar <code>${DATA_URL}</code>. Verificá la carpeta/archivo.</div>
    </div>`;
  }
  return PRODUCTS;
}
const findProduct = id => PRODUCTS.find(p=>p.id===id);

// ====== Stock efectivo (resta lo que hay en carrito) ======
function reservedQty(productId, size, excludeIndex = null){
  return getCart().reduce((sum, item, idx) => {
    if (idx === excludeIndex) return sum;
    if (item.productId === productId && (!size || item.size === size)) return sum + item.qty;
    return sum;
  }, 0);
}
function effectiveSizes(p){
  const out = {...(p.sizes || {})};
  for (const s in out) out[s] = Math.max(0, out[s] - reservedQty(p.id, s));
  return out;
}
function availableFor(p, size, excludeIndex = null){
  const base = p.sizes?.[size] || 0;
  const reserved = reservedQty(p.id, size, excludeIndex);
  return Math.max(0, base - reserved);
}

// ====== Home (grid + filtros) ======
function applyFilters(list){
  let out = [...list];
  const q = FILTERS.q.trim().toLowerCase();
  if (q) out = out.filter(p => [p.name, p.subtitle, p.league, p.version, ...(p.tags||[])].join(' ').toLowerCase().includes(q));
  if (FILTERS.league) out = out.filter(p => p.league === FILTERS.league);
  if (FILTERS.version) out = out.filter(p => p.version === FILTERS.version);
  if (FILTERS.retro) out = out.filter(p => !!p.retro);
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

  grid.innerHTML = list.map(p => `
    <div class="col mb-5">
      <div class="card h-100">
        ${p.retro ? `<div class="badge bg-dark text-white position-absolute" style="top:.5rem;right:.5rem">Retro</div>` : ''}
        <a class="text-decoration-none" href="product.html?id=${encodeURIComponent(p.id)}">
          <img class="card-img-top" src="${p.images?.[0] || ''}" alt="${p.name}" />
        </a>
        <div class="card-body p-4">
          <div class="text-center">
            <h5 class="fw-bolder">${p.name}</h5>
            ${p.subtitle ? `<div class="text-muted small">${p.subtitle}</div>`:''}
            <div class="mt-2">${money(p.price)}</div>
          </div>
        </div>
        <div class="card-footer p-4 pt-0 border-top-0 bg-transparent">
          <div class="text-center">
            <a class="btn btn-outline-dark mt-auto" href="product.html?id=${encodeURIComponent(p.id)}">Ver más</a>
          </div>
        </div>
      </div>
    </div>
  `).join('');
}
function bindIndexFilters(){
  $('#searchInput')?.addEventListener('input', e => { FILTERS.q = e.target.value || ''; renderIndex(); });
  $('#leagueSel')?.addEventListener('change', e => { FILTERS.league = e.target.value || ''; renderIndex(); });
  $('#versionSel')?.addEventListener('change', e => { FILTERS.version = e.target.value || ''; renderIndex(); });
  $('#retroChk')?.addEventListener('change', e => { FILTERS.retro = !!e.target.checked; renderIndex(); });
  $('#onlyRetro')?.addEventListener('click', e => { e.preventDefault(); FILTERS.retro = true; $('#retroChk').checked = true; renderIndex(); });
}

// ====== Detalle ======
function sizePill(size, qty){
  return `<span class="badge bg-light text-dark border me-1 mb-1 ${qty<=0?'text-decoration-line-through opacity-50':''}">${size}: ${qty>0?qty:'sin stock'}</span>`;
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

  view.innerHTML = `
    <div class="col-md-6">
      <div class="d-flex flex-column gap-3">
        <img id="mainImg" class="img-fluid rounded" src="${p.images?.[0] || ''}" alt="${p.name}">
        <div class="d-flex flex-wrap gap-2">
          ${(p.images||[]).map((src,i)=>`<img class="rounded border" style="width:82px;height:82px;object-fit:cover;cursor:pointer"
             data-src="${src}" src="${src}" alt="${p.name} ${i+1}">`).join('')}
        </div>
      </div>
    </div>
    <div class="col-md-6">
      <h3 class="mb-1">${p.name}</h3>
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
    const line = `• ${qty}× ${p.name} (talle ${size}) — ${money(p.price*qty)}`;
    const msg = `Hola! Quiero comprar:%0A${line}%0A%0ATotal: ${encodeURIComponent(money(p.price*qty))}`;
    const url = `https://wa.me/${WHATSAPP_PHONE}?text=${msg}`;
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
    cart.push({ productId, name:p.name, price:p.price, size, qty: pushQty });
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
  const p = PRODUCTS.find(x=>x.id===cart[i].productId);
  const max = availableFor(p, cart[i].size, i);
  cart[i].qty = Math.max(1, Math.min(q|0, Math.max(1, max)));
  setCart(cart);
  renderCart();
}
const cartTotal = () => getCart().reduce((a,i)=>a + i.price*i.qty, 0);

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
          <th>Producto</th><th class="text-center">Talle</th><th style="width:130px;">Cantidad</th>
          <th>Subtotal</th><th></th>
        </tr></thead>
        <tbody>
          ${cart.map((i,idx)=> {
            const p = PRODUCTS.find(x=>x.id===i.productId);
            const max = availableFor(p, i.size, idx);
            return `
              <tr>
                <td>${i.name}</td>
                <td class="text-center">${i.size}</td>
                <td>
                  <input type="number" min="1" max="${Math.max(1,max)}"
                         class="form-control form-control-sm qty" data-idx="${idx}" value="${i.qty}">
                  <div class="form-text">Disp.: ${max}</div>
                </td>
                <td>${money(i.price*i.qty)}</td>
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
  const lines = cart.map(i => `• ${i.qty}× ${i.name} (talle ${i.size}) — ${money(i.price*i.qty)}`).join('%0A');
  const msg = `Hola! Quiero comprar:%0A${lines}%0A%0ATotal: ${encodeURIComponent(money(total))}%0A%0ANombre:%0ADirección/Localidad:%0AMétodo de envío (Retiro/Envío):`;
  const url = `https://wa.me/${WHATSAPP_PHONE}?text=${msg}`;

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
  if (form.dataset.bound) return; // evita doble-bindeo
  form.dataset.bound = '1';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (form.dataset.sending === '1') return;
    form.dataset.sending = '1';

    try {
      const data = Object.fromEntries(new FormData(form).entries());
      const text =
        `Hola! Quiero pedir una camiseta que no veo en stock:%0A` +
        `• Equipo: ${data.equipo}%0A• Liga: ${data.liga||'-'}%0A• Temporada: ${data.temporada||'-'}%0A` +
        `• Versión: ${data.version||'-'}%0A• Talle: ${data.talle||'-'}%0A` +
        `• Comentarios: ${data.comentarios||'-'}%0A%0A` +
        `Mis datos:%0A• Nombre: ${data.nombre}%0A• Localidad: ${data.localidad||'-'}%0A• Contacto: ${data.contacto||'-'}`;
      const url = `https://wa.me/${WHATSAPP_PHONE}?text=${text}`;

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
  if (form.dataset.bound) return; // evita doble-bindeo
  form.dataset.bound = '1';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (form.dataset.sending === '1') return; // evita doble-submit
    form.dataset.sending = '1';

    try {
      const data = Object.fromEntries(new FormData(form).entries());

      const dorsal  = (data.dorsal  || '').trim();
      const numero  = (data.numero  || '').trim();
      const parches = (data.parches || '').trim();

      const msg =
`Pedido de remera
Club: ${data.club}
Año/Temporada: ${data.anio}
Titular/Suplente: ${data.modelo}
Versión: ${data.version}
Dorsal: ${dorsal || 'sin dorsal'}
Número: ${numero || '-'}
Parches: ${parches || 'sin parches'}

(Nota: si la querés sin dorsal/ni número/ni parches, dejá esos campos vacíos)`;

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
  updateCartBadge();
  const page = document.body.dataset.page || '';

  if (page === 'index'){ bindIndexFilters(); renderIndex(); bindRequestForm(); }
  if (page === 'product'){ renderProduct(); }
  if (page === 'cart'){ await renderCart(); $('#checkoutBtn')?.addEventListener('click', checkout); }

  // IMPORTANTE: habilita el modal "Hacé tu pedido"
  bindQuickOrderForm();
});
