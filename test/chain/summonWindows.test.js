import test from "node:test";

// Official baseline: PSCT Part 5 - Special Summons.
// https://www.yugioh-card.com/en/play/psct/psct-5/

test.todo("[CS-03] Normal Set não abre summon_attempt nem after_summon");
test.todo("[CS-03] Flip Summon abre janela de negação");
test.todo(
  "[CS-03] Tribute Summon negada mantém Tributos pagos e consome a tentativa",
);
test.todo(
  "[CS-03] Invocação produzida durante resolução não abre janela aninhada",
);
