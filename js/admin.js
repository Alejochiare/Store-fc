// ====== Config ======
const LS_KEY_PRODUCTS = 'admin_products_override';
const ADMIN_PASSWORD  = '9/12'; 
let CREATING = false; // evita doble submit en "Agregar remera"

// ====== Utils ======
const $ = s => document.querySelector(s);
function saveData(obj){ localStorage.setItem(LS_KEY_PRODUCTS, JSON.stringify(obj)); }
function getData(){ return JSON.parse(localStorage.getItem(LS_KEY_PRODUCTS) || '{"products":[]}'); }
async function loadBaseData(){
  const ls = localStorage.getItem(LS_KEY_PRODUCTS);
  if (ls) return JSON.parse(ls);
  try {
    const r = await fetch('data/products.json', {cache:'no-store'});
    if (r.ok) return await r.json();
  } catch(e){}
  return { products: [] };
}
// Normaliza IDs: minúsculas, sin tildes, solo [a-z0-9-]
function slugId(s){
  return String(s||'')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'') // saca tildes
    .replace(/[^a-z0-9]+/g,'-')                      // todo lo raro -> guion
    .replace(/^-+|-+$/g,'')                          // saca guiones al borde
    .slice(0, 80);                                   // largo máximo
}

// --- imágenes: leer y redimensionar a dataURL ---
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

$('#formCreate').addEventListener('submit', async (ev)=>{
  ev.preventDefault();
  if (CREATING) return;                // <- candado anti doble submit
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
    const dup = data.products.find(p => slugId(p.id) === id);
    if (dup) throw new Error(`El ID ya existe: ${dup.id}`);

    const prod = {
      id,
      name: f.get('name').trim(),
      subtitle: f.get('subtitle').trim(),
      price: Number(f.get('price')||0),
      league: f.get('league').trim(),
      version: f.get('version').trim(),
      retro: (f.get('retro') === 'true'),
      images: imgs,
      sizes: {
        S:+(f.get('S')||0), M:+(f.get('M')||0), L:+(f.get('L')||0),
        XL:+(f.get('XL')||0), XXL:+(f.get('XXL')||0),
      },
      tags: (f.get('tags')||'').split(',').map(s=>s.trim()).filter(Boolean),
      enabled: true
    };

    data.products.push(prod);
    saveData(data);

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


// ====== Login ======
$('#btnLogin').addEventListener('click', async ()=>{
  const p = $('#adminPass').value.trim();
  if (p !== ADMIN_PASSWORD) { alert('Contraseña incorrecta'); return; }
  $('#loginBox').classList.add('d-none');
  $('#adminUI').classList.remove('d-none');
  if (!localStorage.getItem(LS_KEY_PRODUCTS)) saveData(await loadBaseData());
  render();
});
$('#btnReload').addEventListener('click', render);

// ====== Export / Import / Clear ======
$('#btnExport').addEventListener('click', ()=>{
  const blob = new Blob([JSON.stringify(getData(), null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'products.json'; a.click();
  URL.revokeObjectURL(url);
});
$('#fileImport').addEventListener('change', async (ev)=>{
  const file = ev.target.files[0]; if(!file) return;
  try{
    const obj = JSON.parse(await file.text());
    if(!obj || !Array.isArray(obj.products)) throw new Error('formato inválido');
    saveData(obj); render(); alert('Importado ✔');
  }catch(e){ alert('No se pudo importar: ' + e.message); }
  finally { ev.target.value=''; }
});
$('#btnClear').addEventListener('click', ()=>{
  if(!confirm('¿Borrar override y volver al products.json del repo?')) return;
  localStorage.removeItem(LS_KEY_PRODUCTS); render(true); alert('Listo ✔');
});

// ====== Alta (solo archivos locales) ======
$('#formCreate').addEventListener('submit', async (ev)=>{
  ev.preventDefault();
  const f = new FormData(ev.currentTarget);

  const imgs = await filesToDataUrls($('#fileImages').files, 8); // hasta 8
  if (imgs.length === 0) { alert('Subí al menos una foto'); return; }

  const prod = {
    id: f.get('id').trim(),
    name: f.get('name').trim(),
    subtitle: f.get('subtitle').trim(),
    price: Number(f.get('price')||0),
    league: f.get('league').trim(),
    version: f.get('version').trim(),
    retro: (f.get('retro') === 'true'),
    images: imgs, // solo de la PC
    sizes: {
      S: Number(f.get('S')||0), M: Number(f.get('M')||0), L: Number(f.get('L')||0),
      XL:Number(f.get('XL')||0), XXL:Number(f.get('XXL')||0),
    },
    tags: (f.get('tags')||'').split(',').map(s=>s.trim()).filter(Boolean),
    enabled: true
  };

  const data = getData();
  if(!prod.id || !prod.name){ alert('ID y Nombre son obligatorios'); return; }
  if (data.products.some(x=>x.id===prod.id)) { alert('El ID ya existe'); return; }

  data.products.push(prod); saveData(data);
  ev.currentTarget.reset(); $('#filePreview').innerHTML = ''; alert('Agregada ✔'); render();
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
      btn.addEventListener('click', ()=>{
        const i = +btn.dataset.delimg;
        const d = getData();
        d.products[idx].images.splice(i,1);
        saveData(d); render();
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
        saveData(d); render(); input.remove();
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
        const d = getData(); d.products[idx].images = arr; saveData(d); render(); input.remove();
      }, { once:true });
      input.click();
    });

    // guardar fila
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

    // borrar producto
    tr.querySelector('[data-act="delete"]').addEventListener('click', ()=>{
      if(!confirm(`Eliminar "${p.name}" del override?`)) return;
      const d = getData(); d.products.splice(idx,1); saveData(d); tr.remove();
    });

    $('#tbody').appendChild(tr);
  });
}
