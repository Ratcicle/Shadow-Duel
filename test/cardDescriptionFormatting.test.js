import assert from "node:assert/strict";
import test from "node:test";

import {
  formatCardPreviewDescriptionHtml,
  getLocale,
  setLocale,
} from "../src/core/i18n.js";
import { cardDatabase } from "../src/data/cards.js";

test("blank lines render as compact semantic effect paragraphs", () => {
  const html = formatCardPreviewDescriptionHtml({
    id: 99001,
    description: "First effect.\n\nSecond effect.\n\nUsage restriction.",
  });

  assert.equal(
    html,
    '<span class="card-description-text"><span class="card-effect-paragraph">First effect.</span><span class="card-effect-paragraph">Second effect.</span><span class="card-effect-paragraph">Usage restriction.</span></span>',
  );
});

test("a single line break remains a simple break inside the description", () => {
  const html = formatCardPreviewDescriptionHtml({
    id: 99002,
    description: "Materials: 1 Tuner + 1+ non-Tuners\nFirst effect.",
  });

  assert.equal(
    html,
    "Materials: 1 Tuner + 1+ non-Tuners<br>First effect.",
  );
});

test("Extra Deck materials always occupy an exclusive compact first line", () => {
  const html = formatCardPreviewDescriptionHtml({
    id: 99004,
    monsterType: "synchro",
    description:
      "1 EARTH Tuner + 1+ non-Tuner monsters. You can activate this effect.",
  });

  assert.equal(
    html,
    '<span class="card-description-text"><span class="card-effect-paragraph">1 EARTH Tuner + 1+ non-Tuner monsters</span><span class="card-effect-paragraph">You can activate this effect.</span></span>',
  );
});

test("all Extra Deck cards expose their material or procedure as the first compact paragraph", () => {
  const previousLocale = getLocale();
  try {
    for (const locale of ["en", "pt-br"]) {
      setLocale(locale);
      for (const card of cardDatabase.filter(({ monsterType }) =>
        ["fusion", "synchro", "ascension"].includes(monsterType),
      )) {
        const html = formatCardPreviewDescriptionHtml(card);
        assert.equal(
          html.startsWith(
            '<span class="card-description-text"><span class="card-effect-paragraph">',
          ),
          true,
          `${card.name} must have an exclusive material line in ${locale}.`,
        );
        assert.equal(
          (html.match(/class="card-effect-paragraph"/g) || []).length >= 2,
          true,
          `${card.name} must separate materials from effects in ${locale}.`,
        );
      }
    }
  } finally {
    setLocale(previousLocale);
  }
});

test("paragraph formatting continues to escape card text", () => {
  const html = formatCardPreviewDescriptionHtml({
    id: 99003,
    description: '<script>alert("x")</script>\n\nSafe effect.',
  });

  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("&lt;script&gt;"), true);
  assert.equal(html.includes('class="card-effect-paragraph"'), true);
});
