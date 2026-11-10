import assert from "node:assert/strict";
import { test } from "node:test";
import { carimbo, classificar } from "../lib/repo.js";

const TS = "2026-11-10T17-03-22-123Z";

test("classifica trabalhos e excluídos válidos", () => {
  const { trabalhos, excluidos, ignorados } = classificar([
    "build.mjs",
    "trabalhos/História - Michelangelo.pdf",
    "trabalhos/Prova.PDF",
    `excluidos/${TS}/Geografia - Relevo.pdf`,
  ]);
  assert.deepEqual(trabalhos, [
    { caminho: "trabalhos/História - Michelangelo.pdf", arquivo: "História - Michelangelo.pdf", nome: "História - Michelangelo", slug: "historia-michelangelo" },
    { caminho: "trabalhos/Prova.PDF", arquivo: "Prova.PDF", nome: "Prova", slug: "prova" },
  ]);
  assert.deepEqual(excluidos, [
    {
      caminho: `excluidos/${TS}/Geografia - Relevo.pdf`,
      arquivo: "Geografia - Relevo.pdf",
      nome: "Geografia - Relevo",
      ts: TS,
      id: "2026-11-10t17-03-22-123z-geografia-relevo",
    },
  ]);
  assert.deepEqual(ignorados, []);
});

test("ignora caminhos fora do padrão", () => {
  const { trabalhos, excluidos, ignorados } = classificar([
    "Trabalhos/X.pdf",
    "trabalhos/X.pdf.txt",
    "trabalhos/sub/X.pdf",
    "trabalhos/slides.pptx",
    "excluidos/solto.pdf",
    "excluidos/2026-11-10/X.pdf",
    `excluidos/${TS}/sub/X.pdf`,
    `excluidos/${TS}/X.docx`,
  ]);
  assert.deepEqual(trabalhos, []);
  assert.deepEqual(excluidos, []);
  assert.equal(ignorados.length, 7);
  assert.ok(!ignorados.includes("Trabalhos/X.pdf"));
});

test("slug ou id repetido lança erro com code duplicado", () => {
  assert.throws(() => classificar(["trabalhos/História.pdf", "trabalhos/Historia.pdf"]), { code: "duplicado" });
  assert.throws(() => classificar([`excluidos/${TS}/História.pdf`, `excluidos/${TS}/Historia.pdf`]), { code: "duplicado" });
});

test("o mesmo nome pode estar em trabalhos e em várias pastas de excluídos", () => {
  const { trabalhos, excluidos } = classificar([
    "trabalhos/X.pdf",
    `excluidos/${TS}/X.pdf`,
    "excluidos/2026-11-11T08-00-00-000Z/X.pdf",
  ]);
  assert.equal(trabalhos.length, 1);
  assert.equal(excluidos.length, 2);
});

test("carimbo troca : e . por -", () => {
  assert.equal(carimbo(new Date("2026-11-10T17:03:22.123Z")), TS);
});
