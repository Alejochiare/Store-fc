// ====== Config ======
const LS_KEY_PRODUCTS = 'admin_products_override';
const ADMIN_PASSWORD  = '9/12';

// === API en Apps Script ===
// REEMPLAZÁ ESTO por tu NUEVA URL que termina en /exec:
const API_BASE    = 'https://script.google.com/macros/s/AKfycbwBMAN-2Ejo9-OIltCIWJzK9jiMKLEbug_KJlrpMFQ69xJIjvm5lXOTEi3j9rWWsbjreg/exec';
const DATA_URL    = API_BASE + '?route=products';
const VERSION_URL = API_BASE + '?route=version';

// Publicación (usa el MISMO secreto que en Code.gs)
const SECRET      = 'StoreFC_2025_alejo_4e9c1c6c2f7a48a0';
const PUBLISH_URL = API_BASE + '?key=' + encodeURIComponent(SECRET);

let REMOTE_VERSION = '0';
let CREATING = false; // evita doble submit en "Agregar remera"

// ====== Utils ======
const $ = s => document.querySelector(s);

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

function saveData(obj){
  const version  = obj.version || REMOTE_VERSION || '0';
  const products = Array.isArray(obj.products) ? obj.products
                   : (Array.isArray(obj) ? obj : []);
  localStorage.setItem(LS_KEY_PRODUCTS, JSON.stringify({ version, products }));
}

function getData(){
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY_PRODUCTS) || 'null');
    if (raw && Array.isArray(raw.products)) return raw;
    if (raw && Array.isArray(raw)) return { version: REMOTE_VERSION, products: raw };
  } catch {}
  return { version: REMOTE_VERSION, products: [] };
}

function slugId(s){
  return String(s||'')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'')
    .slice(0, 80);
}

// --- imágenes ---
function readFileAsImage(file){
  return new Promise((resolve, reject)=>{
    const fr = new FileReader();
    fr.onerror = reject;
    fr.onload = () => { const img = new Image(); img.onload = ()=>resolve(img); img.onerror = reject; img.src = fr.result; };
    fr.readAsDataURL(file);
  });
}
async function resizeToDataURL(file, maxW=1200, maxH=1200, quality=0.85){
  const img = await readFileAsImage(file);
  const ratio = Math.min(maxW/img.width, maxH/img.height, 1);
  const w = Math.round(img.width*ratio), h = Math.round(img.height*ratio);
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}
async function filesToDataUrls(fileList, max=8){
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

  if (!localStorage.getItem(LS_KEY_PRODUCTS)) {
    const base = await loadBaseData();
    saveData(base);
  }

  $('#loginBox').classList.add('d-none');
  $('#adminUI').classList.remove('d-none');

  $('#fileImages')?.addEventListener('change', async (ev)=>{
    const urls = await filesToDataUrls(ev.target.files, 8);
    const wrap = $('#filePreview');
    wrap.innerHTML = urls.map(u=>`<img class="img-thumb me-1 mb-1" src="${u}">`).join('');
  });

  render();
});

$('#btnReload').addEventListener('click', async ()=>{
  REMOTE_VERSION = await getRemoteVersion();
  const base = await loadBaseData();
  saveData(base);
  render();
});

// ====== Export / Import / Clear ======
$('#btnExport').addEventListener('click', ()=>{
  const data = getData();
  const blob1 = new Blob([JSON.stringify({ products: data.products }, null, 2)], {type:'application/json'});
  const a1 = document.createElement('a'); a1.href = URL.createObjectURL(blob1); a1.download = 'products.json'; a1.click();
  URL.revokeObjectURL(a1.href);

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
    saveData({ version: REMOTE_VERSION, products: normalizeArray(list) });
    render();
    alert('Importado ✔');
  }catch(e){ alert('No se pudo importar: ' + e.message); }
  finally { ev.target.value=''; }
});

$('#btnClear').addEventListener('click', async ()=>{
  if(!confirm('¿Borrar override y volver a lo online?')) return;
  localStorage.removeItem(LS_KEY_PRODUCTS);
  const base = await loadBaseData();
  saveData(base);
  render(true);
  alert('Listo ✔');
});

// ====== Alta ======
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
    const imgs = await filesToDataUrls($('#fileImages').files, 8);
    if (imgs.length === 0) throw new Error('Subí al menos una foto');

    let id = slugId(f.get('id') || f.get('name'));
    if (!id) throw new Error('Poné un ID o un Nombre');

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
    saveData({ version: REMOTE_VERSION, products: next.products });

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

// ====== Render tabla ======
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

    tr.querySelectorAll('[data-delimg]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const d = getData();
        d.products[idx].images.splice(+btn.dataset.delimg,1);
        saveData(d); render();
      });
    });

    tr.querySelector('[data-act="add"]').addEventListener('click', ()=>{
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.multiple = true; input.hidden = true;
      document.body.appendChild(input);
      input.addEventListener('change', async ()=>{
        const arr = await filesToDataUrls(input.files, 8);
        const d = getData();
        d.products[idx].images = [...(d.products[idx].images||[]), ...arr];
        saveData(d); render(); input.remove();
      }, { once:true });
      input.click();
    });

    tr.querySelector('[data-act="replace"]').addEventListener('click', ()=>{
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.multiple = true; input.hidden = true;
      document.body.appendChild(input);
      input.addEventListener('change', async ()=>{
        const arr = await filesToDataUrls(input.files, 8);
        if (!arr.length) return;
        const d = getData(); d.products[idx].images = arr; saveData(d); render(); input.remove();
      }, { once:true });
      input.click();
    });

    tr.querySelector('[data-act="save"]').addEventListener('click', ()=>{
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
      saveData(d); alert('Guardado ✔');
    });

    tr.querySelector('[data-act="delete"]').addEventListener('click', ()=>{
      if(!confirm(`Eliminar "${p.name}" del override?`)) return;
      const d = getData(); d.products.splice(idx,1); saveData(d); tr.remove();
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
    const data = getData();
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
    saveData({ version: REMOTE_VERSION, products: data.products });
    alert('Publicado ✔ – versión: ' + j.version);
  } catch (e) {
    alert('No se pudo publicar: ' + (e.message || e));
  } finally {
    btn?.removeAttribute('disabled');
  }
}
$('#btnPublish')?.addEventListener('click', publishNow);
