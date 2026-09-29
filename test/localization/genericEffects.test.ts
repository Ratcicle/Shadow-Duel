import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { handleOptionalTargetActions } from "../../src/core/actionHandlers/conditional.js";
import type { ActionHandlerEnginePort } from "../../src/core/contracts/actionRuntime.js";
import type { SelectionSessionInput } from "../../src/core/contracts/selection.js";
import { getCardDisplayDescription, getCardDisplayName, setLocale } from "../../src/core/i18n.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

test("generated token display follows the current locale without changing canonical identity", async t => {
  const game = createRuntimeGame({ disableChains: true, laboratoryMode: true });
  t.after(() => { game.dispose(); setLocale("en"); });
  game.player.controllerType = "ai";
  const source = new Card(cardDefinition(4), "player");
  const effect = required(required(source.effects)[0]);
  setLocale("pt-br");
  await game.effectEngine.applyActions(required(effect.actions), {
    player: game.player, opponent: game.bot, source, effect,
  }, {});
  const token = required(game.player.field[0]);
  assert.equal(getCardDisplayName(token), "Ficha de Esqueleto Invocado");
  assert.equal(getCardDisplayDescription(token), "Uma Ficha de Esqueleto Invocada por Invocação-Especial por necromancia.");
  assert.equal(token.id, undefined);
  assert.equal(token.name, "Summoned Skeleton Token");
  assert.equal(token.description, "A Skeleton Token Special Summoned by necromancy.");
  setLocale("en");
  assert.equal(getCardDisplayName(token), token.name);
  assert.equal(getCardDisplayDescription(token), token.description);
  const custom = { name: "Custom token", description: "Custom description", nameKey: "missing.name", descriptionKey: "missing.description" };
  setLocale("pt-br");
  assert.equal(getCardDisplayName(token), "Ficha de Esqueleto Invocado");
  assert.equal(getCardDisplayName(custom), custom.name);
  assert.equal(getCardDisplayDescription(custom), custom.description);
});

for (const id of [19, 20] as const) {
  for (const locale of ["en", "pt-br"] as const) {
    for (const custom of [false, true]) {
      test(`${id} confirmation displays ${locale} ${custom ? "custom fallback" : "translated"} text and labels`, async t => {
        const game = createRuntimeGame({ disableChains: true, laboratoryMode: true, laboratoryUseBot: false });
        t.after(() => { game.dispose(); setLocale("en"); });
        setLocale(locale);
        game.player.controllerType = "human";
        game.disablePresentationDelays = true;
        game.waitForBoardPresentation = async () => {};
        const source = new Card(cardDefinition(id), "player");
        const effect = required(required(source.effects)[0]);
        const material = new Card(cardDefinition(1), "player");
        game.player.graveyard.push(material);
        const synchro = new Card(cardDefinition(31), "player");
        synchro.synchroMaterials = [{ instanceId: material.instanceId, name: material.name, level: material.level, isTuner: false, cardId: material.id ?? null, ownerId: "player", controllerId: "player", usedOnTurn: 2 }];
        placeFieldCards(game.player.field, synchro);
        let called = 0;
        let message: string | undefined;
        let options: Parameters<typeof game.ui.showConfirmPrompt>[1];
        game.ui.showConfirmPrompt = async (text, settings) => {
          called++; message = text; options = settings; return false;
        };
        const actions = required(effect.actions).map(action => {
          if (!custom || (action.type !== "de_synchro" && action.type !== "optional_target_actions")) return action;
          return { ...action, promptMessageKey: "missing.message", promptTitleKey: "missing.title",
            confirmLabelKey: "missing.confirm", cancelLabelKey: "missing.cancel",
            promptMessage: "Custom question", promptTitle: "Custom title", confirmLabel: "Custom yes", cancelLabel: "Custom no" };
        });
        await game.effectEngine.applyActions(actions, { player: game.player, opponent: game.bot, source, effect }, {
          [id === 19 ? "de_synchro_target" : "fusion_recycle_target"]: [id === 19 ? synchro : material],
        });
        assert.equal(called, 1);
        assert.equal(message, custom ? "Custom question" : id === 19
            ? locale === "en" ? `Special Summon the Synchro Materials used for ${getCardDisplayName(synchro)}?` : `Invocar por Invocação-Especial os Materiais Sincro usados para ${getCardDisplayName(synchro)}?`
            : locale === "en" ? "Special Summon the added monster in Defense Position?" : "Invocar por Invocação-Especial o monstro adicionado em Posição de Defesa?");
        assert.equal(options?.title, custom ? "Custom title" : locale === "en" ? "Confirm" : "Confirmar");
        assert.equal(options?.confirmLabel, custom ? "Custom yes" : locale === "en" ? "Special Summon" : "Invocar por Invocação-Especial");
        assert.equal(options?.cancelLabel, custom ? "Custom no" : id === 19 ? locale === "en" ? "Cancel" : "Cancelar" : locale === "en" ? "Keep in hand" : "Manter na mão");

      });
    }
  }
}

for (const translated of [true, false]) {
  test(`optional selection uses ${translated ? "translated" : "custom fallback"} confirmation text and stable choice keys`, async t => {
    setLocale("pt-br");
    const game = createRuntimeGame({ laboratoryMode: true });
    t.after(() => { game.dispose(); setLocale("en"); });
    game.player.controllerType = "human";
    let session: SelectionSessionInput | undefined;
    const engine = unsafeFixture<ActionHandlerEnginePort>({ game: {
      ui: {},
      startTargetSelectionSession: (input: SelectionSessionInput) => {
        session = input;
        input.onCancel?.();
      },
    } }, "Legacy UI host without showConfirmPrompt exercises the alternative selection path; cancellation requires no action execution.");
    const source = new Card(cardDefinition(20), "player");
    const effect = required(required(source.effects)[0]);
    const declared = required(required(effect.actions)[1]);
    assert.equal(declared.type, "optional_target_actions");
    if (declared.type !== "optional_target_actions") return;
    await handleOptionalTargetActions({ ...declared, conditions: [],
      promptMessageKey: translated ? "ui.genericEffects.fusionRecycleSummon" : "missing.message",
      confirmLabelKey: translated ? "ui.genericEffects.specialSummon" : "missing.confirm",
      cancelLabelKey: translated ? "ui.genericEffects.keepInHand" : "missing.cancel",
      promptMessage: "Custom question", confirmLabel: "Custom yes", cancelLabel: "Custom no",
    }, { source, effect, player: game.player, opponent: game.bot }, {}, engine);
    const shown = required(session);
    assert.equal(shown.message, translated ? "Invocar por Invocação-Especial o monstro adicionado em Posição de Defesa?" : "Custom question");
    const requirements = shown.selectionContract.requirements;
    assert.ok(Array.isArray(requirements));
    const candidates = required(requirements[0]).candidates;
    assert.deepEqual(candidates?.map(candidate => [candidate.key, candidate.name, candidate.label]), [
      ["yes", translated ? "Invocar por Invocação-Especial" : "Custom yes", translated ? "Invocar por Invocação-Especial" : "Custom yes"],
      ["no", translated ? "Manter na mão" : "Custom no", translated ? "Manter na mão" : "Custom no"],
    ]);
  });
}
