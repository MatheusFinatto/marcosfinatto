import assert from "node:assert/strict";
import { test } from "node:test";
import { slugify } from "../lib/slug.js";

test("slugify mantém os links atuais", () => {
  assert.equal(slugify("História - Independência do Brasil"), "historia-independencia-do-brasil");
  assert.equal(slugify("História - Michelangelo"), "historia-michelangelo");
});

test("slugify tira acento, símbolo e hífen das pontas", () => {
  assert.equal(slugify("  Ação & Reação!  "), "acao-reacao");
  assert.equal(slugify("!!!"), "");
});
