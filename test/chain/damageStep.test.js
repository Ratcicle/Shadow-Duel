import test from "node:test";

// Official baseline: Damage Step Rules.
// https://www.yugioh-card.com/eu/play/damage-step-rules/

test.todo("[CS-10] combate percorre as cinco subetapas do Damage Step");
test.todo(
  "[CS-10] categorias de ativação são filtradas pela subetapa exata",
);
test.todo("[CS-10] ataque direto percorre o mesmo pipeline de Damage Step");
test.todo(
  "[CS-10] Flip, dano, destruição e envio ao Cemitério ocorrem nas etapas corretas",
);
