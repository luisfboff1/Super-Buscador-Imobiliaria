const html = await fetch('https://www.antonellaimoveis.com.br/imoveis/venda/-/-/-/-').then(r => r.text());
const m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
if (!m) { console.log('no __NEXT_DATA__'); process.exit(1); }
const json = JSON.parse(m[1]);

// Recursively find the biggest array of objects
function findArrays(obj, path = '', results = []) {
  if (Array.isArray(obj)) {
    if (obj.length > 0 && typeof obj[0] === 'object') {
      results.push({ path, len: obj.length, sample: obj[0] });
    }
    obj.forEach((item, i) => findArrays(item, `${path}[${i}]`, results));
  } else if (obj && typeof obj === 'object') {
    Object.entries(obj).forEach(([k, v]) => findArrays(v, `${path}.${k}`, results));
  }
  return results;
}

const arrays = findArrays(json).sort((a, b) => b.len - a.len);
console.log('=== TOP ARRAYS BY SIZE ===');
arrays.slice(0, 5).forEach(a => {
  console.log(`\nPath: ${a.path}  (${a.len} items)`);
  console.log('Sample keys:', Object.keys(a.sample || {}).join(', '));
});

// Print the biggest array's first item in full
const biggest = arrays[0];
if (biggest) {
  console.log('\n=== FIRST ITEM (full) ===');
  console.log(JSON.stringify(biggest.sample, null, 2).slice(0, 3000));
}
