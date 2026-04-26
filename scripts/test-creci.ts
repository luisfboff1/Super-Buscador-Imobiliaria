import { extractCreciRS } from "@/lib/creci/extractor";

async function main() {
  const cidade = process.argv[2] || "Caxias do Sul";
  console.time("extractCreciRS");
  const lista = await extractCreciRS(cidade);
  console.timeEnd("extractCreciRS");

  const comUrl = lista.filter((i) => !!i.url);
  console.log(`\n=== ${cidade} ===`);
  console.log(`Total ativas: ${lista.length}`);
  console.log(`Com URL: ${comUrl.length} (${Math.round((comUrl.length / lista.length) * 100)}%)`);

  console.log("\n--- Primeiras 15 ---");
  for (const i of lista.slice(0, 15)) {
    const display = i.nomeFantasia || i.nome;
    console.log(
      `${(i.creci ?? "").padEnd(10)} ${(i.url ?? "(sem URL)").padEnd(50)} ${display}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
