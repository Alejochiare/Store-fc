// tools/extract-images.js
const fs = require('fs');
const path = require('path');

const IN = path.resolve('data/products.json');     // JSON actual (con data URLs)
const OUT = path.resolve('data/products.json');    // lo vamos a sobrescribir con rutas limpias
const IMG_ROOT = path.resolve('assets/img/exported');

function slug(s){
  return String(s||'')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}

function dataUrlToBuffer(s){
  const m = String(s).match(/^data:(image\/[\w+.-]+);base64,([\s\S]+)$/i);
  if (!m) return null;
  const mime = m[1];
  const ext  = mime.split('/')[1].replace('jpeg','jpg');
  return { buf: Buffer.from(m[2], 'base64'), ext };
}

function main(){
  const json = JSON.parse(fs.readFileSync(IN, 'utf8'));
  const products = json.products || [];
  fs.mkdirSync(IMG_ROOT, { recursive: true });

  let saved = 0;
  products.forEach((p, pi) => {
    const pid = slug(p.id || `prod-${pi+1}`);
    const dir = path.join(IMG_ROOT, pid);
    fs.mkdirSync(dir, { recursive: true });

    (p.images || []).forEach((src, i) => {
      const parsed = dataUrlToBuffer(src);
      if (!parsed) return; // si ya es URL/ruta, la dejo igual
      const name = `${pid}-${String(i+1).padStart(2,'0')}.${parsed.ext || 'jpg'}`;
      const abs  = path.join(dir, name);
      fs.writeFileSync(abs, parsed.buf);
      // ruta relativa desde /data a /assets
      const rel = path.relative(path.dirname(OUT), abs).replace(/\\/g,'/');
      p.images[i] = rel;
      saved++;
    });
  });

  fs.writeFileSync(OUT, JSON.stringify(json, null, 2), 'utf8');
  console.log(`Listo ✔ Guardé ${saved} imagen(es) en ${IMG_ROOT} y actualicé ${OUT}`);
}

main();
