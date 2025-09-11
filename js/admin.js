// ====== Config ======
const LS_KEY_PRODUCTS = 'admin_products_override';
const ADMIN_PASSWORD  = '9/12';

// === API en Apps Script ===
const API_BASE    = 'https://script.google.com/macros/s/AKfycbxczfKfCYqXrZxmSoplqt77Srthibomj6exTfoM7jBBrBCfyRtFXHnSWtCfYfc-8mSdQw/exec';
const DATA_URL    = API_BASE + '?route=products';
const VERSION_URL = API_BASE + '?route=version';

// Publicación (usa el MISMO secreto que en Code.gs)
const SECRET      = 'StoreFC_2025_alejo_4e9c1c6c2f7a48a0';
const PUBLISH_URL = API_BASE + '?key=' + encodeURIComponent(SECRET);

let REMOTE_VERSION = '0';
let CREATING = false; // evita doble submit en "Agregar remera"

// ====== Utils ======
const $ = s => document.querySelector(s);

// ---------- IndexedDB fallback (para data grande) ----------
const IDB_DB = 'storeAdminV1';
const IDB_STORE = 'kv';
const IDB_FLAG = LS_KEY_PRODUCTS + '_idb';
let DATA_CACHE = { version:'0', products: [] }; // estado en memoria (sync)

function idbOpen(){
  return new Promise((res, rej)=>{
    const req = indexedDB.open(IDB_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function idbSet(key, value){
  const db = await idbOpen();
  return new Promise((res, rej)=>{
    const tx = db.transaction(IDB_STORE,'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = ()=>res();
    tx.onerror = ()=>rej(tx.error);
  });
}
async function idbGet(key){
  const db = await idbOpen();
  return new Promise((res, rej)=>{
    const tx = db.transaction(IDB_STORE,'readonly');
    const rq = tx.objectStore(IDB_STORE).get(key);
    rq.onsuccess = ()=>res(rq.result || null);
    rq.onerror = ()=>rej(rq.error);
  });
}
async function idbDel(key){
  const db = await idbOpen();
  return new Promise((res, rej)=>{
    const tx = db.transaction(IDB_STORE,'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = ()=>res();
    tx.onerror = ()=>rej(tx.error);
  });
}

// Carga inicial desde IDB o localStorage al cache en memoria (sync para el resto del código)
async function storageLoad(){
  let data = null;
  try{
    if (localStorage.getItem(IDB_FLAG) === '1') {
      data = await idbGet('override');
    }
    if (!data) {
      const raw = JSON.parse(localStorage.getItem(LS_KEY_PRODUCTS) || 'null');
      if (raw && Array.isArray(raw.products)) data = raw;
      else if (raw && Array.isArray(raw)) data = { version: REMOTE_VERSION, products: raw };
    }
  }catch{}
  DATA_CACHE = data || { version: REMOTE_VERSION, products: [] };
  return DATA_CACHE;
}

// Guarda al cache + intenta localStorage; si explota la cuota, guarda en IDB
async function saveData(obj){
  const version  = obj.version || REMOTE_VERSION || '0';
  const products = Array.isArray(obj.products) ? obj.products
                   : (Array.isArray(obj) ? obj : []);
  DATA_CACHE = { version, products };

  try{
    localStorage.setItem(LS_KEY_PRODUCTS, JSON.stringify(DATA_CACHE));
    localStorage.removeItem(IDB_FLAG);
    // opcional: borrar copia vieja en IDB para liberar
    try{ await idbDel('override'); }catch{}
  }catch(e){
    // QuotaExceeded -> guardo en IDB y dejo un "puntero" mínimo en LS
    await idbSet('override', DATA_CACHE);
    localStorage.setItem(IDB_FLAG, '1');
    try{ localStorage.setItem(LS_KEY_PRODUCTS, JSON.stringify({ version, products: [] })); }catch{}
  }
}

function getData(){ return DATA_CACHE; }

// ---------- fetch/json helpers ----------
async function fetchJSON(url){
  const r = await fetch(url, { cache:'no-store' });
  if(!r.ok) throw new Error('HTTP '+r.status+' en '+url);
  return r.json();
}

async function getRemoteVersion(){
  try {
    const v = await fetchJSON(VERSION_URL);
    return String(v.version || '0');
  } catch { return '0'; }
}

async function loadBaseData(){
  try {
    const v = await getRemoteVersion();
    const data = await fetchJSON(`${DATA_URL}?v=${encodeURIComponent(v)}`);
    return { version: v, products: normalizeArray(data) };
  } catch {
    return { version: '0', products: [] };
  }
}

// Normaliza IDs: minúsculas, sin tildes, solo [a-z0-9-]
function slugId(s){
  return String(s||'')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'') // saca tildes
    .replace(/[^a-z0-9]+/g,'-')                      // raro -> guion
    .replace(/^-+|-+$/g,'')                          // guiones borde
    .slice(0, 80);
}

// --- imágenes: leer y redimensionar a dataURL (WebP, más chico) ---
function readFileAsImage(file){
  return new Promise((resolve, reject)=>{
    const fr = new FileReader();
    fr.onerror = reject;
    fr.onload = () => { const img = new Image(); img.onload = ()=>resolve(img); img.onerror = reject; img.src = fr.result; };
    fr.readAsDataURL(file);
  });
}
async function resizeToDataURL(file, maxW=1000, maxH=1000, quality=0.75){
  const img = await readFileAsImage(file);
  const ratio = Math.min(maxW/img.width, maxH/img.height, 1);
  const w = Math.round(img.width*ratio), h = Math.round(img.height*ratio);
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
  try { return canvas.toDataURL('image/webp', quality); }
  catch { return canvas.toDataURL('image/jpeg', quality); }
}
async function filesToDataUrls(fileList, max=6){
  const files = [...(fileList||[])].slice(0, max);
  const out = [];
  for (const f of files){
    if (!/^image\//i.test(f.type)) continue;
    out.push(await resizeToDataURL(f));
  }
  return out;
}

function normalizeArray(raw){
  const arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.products) ? raw.products : []);
  return arr.map((p, idx) => ({
    id: p.id || p.slug || `p_${idx}`,
    name: p.name || p.title || p.nombre || 'Producto',
    subtitle: p.subtitle || p.sub || '',
    price: Number(p.price ?? p.precio ?? 0),
    league: p.league || p.liga || '',
    version: p.version || '',
    retro: !!p.retro,
    images: Array.isArray(p.images) ? p.images : (Array.isArray(p.imgs) ? p.imgs : []),
    sizes: typeof p.sizes==='object' && p.sizes ? p.sizes : (typeof p.talles==='object' && p.talles ? p.talles : {}),
    tags: Array.isArray(p.tags) ? p.tags : [],
    enabled: p.enabled !== false
  }));
}

// ====== Login ======
$('#btnLogin').addEventListener('click', async ()=>{
  const p = $('#adminPass').value.trim();
  if (p !== ADMIN_PASSWORD) { alert('Contraseña incorrecta'); return; }

  REMOTE_VERSION = await getRemoteVersion();

  // cargar override desde storage (IDB/LS)
  await storageLoad();

  // si no hay override, traigo base online para editar
  if (!getData().products.length) {
    const base = await loadBaseData();
    await saveData(base);
  }

  $('#loginBox').classList.add('d-none');
  $('#adminUI').classList.remove('d-none');

  // Preview de imágenes al seleccionar en el alta
  $('#fileImages')?.addEventListener('change', async (ev)=>{
    const urls = await filesToDataUrls(ev.target.files, 8);
    $('#filePreview').innerHTML = urls.map(u=>`<img class="img-thumb me-1 mb-1" src="${u}">`).join('');
  });

  render();
});

$('#btnReload').addEventListener('click', async ()=>{
  REMOTE_VERSION = await getRemoteVersion();
  const base = await loadBaseData();
  await saveData(base);
  render();
});

// ====== Export / Import / Clear ======
$('#btnExport').addEventListener('click', ()=>{
  const data = getData();
  // 1) products.json
  const blob1 = new Blob([JSON.stringify({ products: data.products }, null, 2)], {type:'application/json'});
  const a1 = document.createElement('a'); a1.href = URL.createObjectURL(blob1); a1.download = 'products.json'; a1.click();
  URL.revokeObjectURL(a1.href);
  // 2) version.json (timestamp nuevo)
  const newVersion = new Date().toISOString().replace(/[:.]/g,'-');
  const blob2 = new Blob([JSON.stringify({ version: newVersion }, null, 2)], {type:'application/json'});
  const a2 = document.createElement('a'); a2.href = URL.createObjectURL(blob2); a2.download = 'version.json'; a2.click();
  URL.revokeObjectURL(a2.href);
  alert('Descargados products.json y version.json.\nSumalos al repo si querés backup.');
});

$('#fileImport').addEventListener('change', async (ev)=>{
  const file = ev.target.files[0]; if(!file) return;
  try{
    const obj = JSON.parse(await file.text());
    const list = Array.isArray(obj.products) ? obj.products : (Array.isArray(obj) ? obj : []);
    await saveData({ version: REMOTE_VERSION, products: normalizeArray(list) });
    render();
    alert('Importado ✔');
  }catch(e){ alert('No se pudo importar: ' + e.message); }
  finally { ev.target.value=''; }
});

$('#btnClear').addEventListener('click', async ()=>{
  if(!confirm('¿Borrar override y volver a lo online?')) return;
  localStorage.removeItem(LS_KEY_PRODUCTS);
  localStorage.removeItem(IDB_FLAG);
  try{ await idbDel('override'); }catch{}
  const base = await loadBaseData();
  await saveData(base);
  render(true);
  alert('Listo ✔');
});

// ====== Alta (único handler) ======
$('#formCreate').addEventListener('submit', async (ev)=>{
  ev.preventDefault();
  if (CREATING) return;
  CREATING = true;

  const form = ev.currentTarget;
  const btn  = form.querySelector('button[type="submit"]');
  btn?.setAttribute('disabled','');
  if (btn) btn.textContent = 'Agregando...';

  try {
    const f = new FormData(form);

    // imágenes locales (múltiples)
    const imgs = await filesToDataUrls($('#fileImages').files, 8);
    if (imgs.length === 0) throw new Error('Subí al menos una foto');

    // ID slug (desde el campo o desde el nombre)
    let id = slugId(f.get('id') || f.get('name'));
    if (!id) throw new Error('Poné un ID o un Nombre');

    // refresco el estado justo antes de chequear duplicado
    const data = getData();
    if (data.products.find(p => slugId(p.id) === id)) {
      throw new Error(`El ID ya existe: ${id}`);
    }

    const prod = {
      id,
      name: (f.get('name')||'').trim(),
      subtitle: (f.get('subtitle')||'').trim(),
      price: Number(f.get('price')||0),
      league: (f.get('league')||'').trim(),
      version: (f.get('version')||'').trim(),
      retro: (f.get('retro') === 'true'),
      images: imgs,
      sizes: {
        S:+(f.get('S')||0), M:+(f.get('M')||0), L:+(f.get('L')||0),
        XL:+(f.get('XL')||0), XXL:+(f.get('XXL')||0),
      },
      tags: (f.get('tags')||'').split(',').map(s=>s.trim()).filter(Boolean),
      enabled: true
    };

    const next = getData();
    next.products.push(prod);
    await saveData({ version: REMOTE_VERSION, products: next.products });

    // limpieza + refresh UI
    form.reset();
    $('#filePreview').innerHTML = '';
    render();
    alert('Agregada ✔');
  } catch (err) {
    alert(err.message || 'No se pudo agregar');
  } finally {
    CREATING = false;
    btn?.removeAttribute('disabled');
    if (btn) btn.textContent = 'Agregar';
  }
});

// ====== Render tabla (gestión de fotos locales) ======
function render(skipCount){
  const data = getData();
  if(!skipCount) $('#count').textContent = data.products.length;
  const tb = $('#tbody'); tb.innerHTML = '';

  data.products.forEach((p, idx)=>{
    const tr = document.createElement('tr');

    const thumbs = (p.images||[]).map((src,i)=>`
      <span class="thumb">
        <img class="img-thumb" src="${src}">
        <button class="btn btn-sm btn-danger x" data-delimg="${i}">&times;</button>
      </span>`).join('');

    tr.innerHTML = `
      <td>
        <div class="mb-2">${thumbs || '<span class="text-secondary">Sin fotos</span>'}</div>
        <div class="d-flex gap-2">
          <button class="btn btn-sm btn-outline-light" data-act="add">Agregar fotos</button>
          <button class="btn btn-sm btn-outline-light" data-act="replace">Reemplazar</button>
        </div>
      </td>
      <td><code>${p.id}</code></td>
      <td>
        <input class="form-control form-control-sm mb-1" value="${p.name||''}" data-k="name">
        <input class="form-control form-control-sm" value="${p.subtitle||''}" data-k="subtitle">
      </td>
      <td><input class="form-control form-control-sm" type="number" min="0" value="${p.price||0}" data-k="price"></td>
      <td><input class="form-control form-control-sm" value="${p.league||''}" data-k="league"></td>
      <td><input class="form-control form-control-sm" value="${p.version||''}" data-k="version"></td>
      <td>
        <select class="form-select form-select-sm" data-k="retro">
          <option value="false" ${!p.retro?'selected':''}>No</option>
          <option value="true" ${p.retro?'selected':''}>Sí</option>
        </select>
      </td>
      <td>
        <select class="form-select form-select-sm" data-k="enabled">
          <option value="true" ${p.enabled!==false?'selected':''}>Sí</option>
          <option value="false" ${p.enabled===false?'selected':''}>No</option>
        </select>
      </td>
      ${['S','M','L','XL','XXL'].map(t=>{
        const val = p.sizes?.[t] ?? 0;
        return `<td class="text-center"><input class="form-control form-control-sm text-center" type="number" min="0" value="${val}" data-size="${t}"></td>`;
      }).join('')}
      <td>
        <div class="d-flex flex-column gap-2">
          <button class="btn btn-success btn-sm" data-act="save">Guardar</button>
          <button class="btn btn-outline-danger btn-sm" data-act="delete">Borrar</button>
        </div>
      </td>
    `;

    // eliminar una foto
    tr.querySelectorAll('[data-delimg]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const d = getData();
        d.products[idx].images.splice(+btn.dataset.delimg,1);
        await saveData(d); render();
      });
    });

    // agregar fotos (append)
    tr.querySelector('[data-act="add"]').addEventListener('click', ()=>{
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.multiple = true; input.hidden = true;
      document.body.appendChild(input);
      input.addEventListener('change', async ()=>{
        const arr = await filesToDataUrls(input.files, 8);
        const d = getData();
        d.products[idx].images = [...(d.products[idx].images||[]), ...arr];
        await saveData(d); render(); input.remove();
      }, { once:true });
      input.click();
    });

    // reemplazar fotos (set)
    tr.querySelector('[data-act="replace"]').addEventListener('click', ()=>{
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.multiple = true; input.hidden = true;
      document.body.appendChild(input);
      input.addEventListener('change', async ()=>{
        const arr = await filesToDataUrls(input.files, 8);
        if (!arr.length) return;
        const d = getData(); d.products[idx].images = arr; await saveData(d); render(); input.remove();
      }, { once:true });
      input.click();
    });

    // guardar fila
    tr.querySelector('[data-act="save"]').addEventListener('click', async ()=>{
      const d = getData();
      const row = d.products[idx];
      row.name     = tr.querySelector('[data-k="name"]').value.trim();
      row.subtitle = tr.querySelector('[data-k="subtitle"]').value.trim();
      row.price    = Number(tr.querySelector('[data-k="price"]').value||0);
      row.league   = tr.querySelector('[data-k="league"]').value.trim();
      row.version  = tr.querySelector('[data-k="version"]').value.trim();
      row.retro    = tr.querySelector('[data-k="retro"]').value === 'true';
      row.enabled  = tr.querySelector('[data-k="enabled"]').value === 'true';
      row.sizes    = {
        S:+tr.querySelector('[data-size="S"]').value||0,
        M:+tr.querySelector('[data-size="M"]').value||0,
        L:+tr.querySelector('[data-size="L"]').value||0,
        XL:+tr.querySelector('[data-size="XL"]').value||0,
        XXL:+tr.querySelector('[data-size="XXL"]').value||0,
      };
      await saveData(d); alert('Guardado ✔');
    });

    // borrar producto
    tr.querySelector('[data-act="delete"]').addEventListener('click', async ()=>{
      if(!confirm(`Eliminar "${p.name}" del override?`)) return;
      const d = getData(); d.products.splice(idx,1); await saveData(d); tr.remove();
      $('#count').textContent = d.products.length;
    });

    $('#tbody').appendChild(tr);
  });
}

// ====== Publicar en servidor (Apps Script) ======
async function publishNow(){
  const btn = $('#btnPublish');
  btn?.setAttribute('disabled','');
  try {
    const data = getData(); // { version, products }
    const fd = new FormData();
    fd.append('payload', JSON.stringify({ products: data.products }));

    const resp = await fetch(PUBLISH_URL, { method:'POST', body: fd });
    const text = await resp.text();
    let j = {};
    try { j = JSON.parse(text); } catch(_){ throw new Error('respuesta inválida: ' + text.slice(0,120)); }
    if (!j.ok) {
      if ((j.error||'').includes('forbidden')) throw new Error('forbidden (la clave del admin NO coincide con la de Code.gs)');
      throw new Error(j.error || 'Error publicando');
    }
    REMOTE_VERSION = j.version;
    await saveData({ version: REMOTE_VERSION, products: data.products });
    alert('Publicado ✔ – versión: ' + j.version);
  } catch (e) {
    alert('No se pudo publicar: ' + (e.message || e));
  } finally {
    btn?.removeAttribute('disabled');
  }
}
$('#btnPublish')?.addEventListener('click', publishNow);
