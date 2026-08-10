import assert from "node:assert/strict";
import test from "node:test";

import ChainSystem from "../../src/core/ChainSystem.js";
import NullChainSystem from "../../src/core/NullChainSystem.js";
import {
  hasChainFastEffectTransitionCapability,
  hasChainLinkMutationCapability,
  hasChainSourceMovementCapability,
  hasChainTurnPlayerCapability,
  isFullChainHost,
} from "../../src/core/contracts/chainRuntime.js";

test("capability guards distinguish the full and Null Chain facades", () => {
  const chain = new ChainSystem(null);
  const nullChain = new NullChainSystem(null);

  assert.equal(hasChainSourceMovementCapability(chain), true);
  assert.equal(hasChainFastEffectTransitionCapability(chain), true);
  assert.equal(hasChainTurnPlayerCapability(chain), true);
  assert.equal(hasChainLinkMutationCapability(chain), true);
  assert.equal(isFullChainHost(chain), true);

  assert.equal(hasChainSourceMovementCapability(nullChain), false);
  assert.equal(hasChainFastEffectTransitionCapability(nullChain), false);
  assert.equal(hasChainTurnPlayerCapability(nullChain), false);
  assert.equal(hasChainLinkMutationCapability(nullChain), false);
  assert.equal(isFullChainHost(nullChain), false);
});

test("capability guards require callable members and their full keysets", () => {
  for (const absent of [null, undefined, false, 0, "chain", {}, []]) {
    assert.equal(hasChainSourceMovementCapability(absent), false);
    assert.equal(hasChainFastEffectTransitionCapability(absent), false);
    assert.equal(hasChainTurnPlayerCapability(absent), false);
    assert.equal(hasChainLinkMutationCapability(absent), false);
    assert.equal(isFullChainHost(absent), false);
  }

  assert.equal(
    hasChainSourceMovementCapability({ recordChainSourceMovement() {} }),
    true,
  );
  assert.equal(
    hasChainSourceMovementCapability({ recordChainSourceMovement: true }),
    false,
  );
  assert.equal(
    hasChainFastEffectTransitionCapability({ transitionFastEffectState() {} }),
    true,
  );
  assert.equal(
    hasChainTurnPlayerCapability({ getCurrentTurnPlayer() {} }),
    true,
  );
  assert.equal(
    hasChainLinkMutationCapability({
      markChainLinkActivationNegated() {},
    }),
    false,
  );
  assert.equal(
    hasChainLinkMutationCapability({
      markChainLinkEffectNegated() {},
    }),
    false,
  );
  assert.equal(
    hasChainLinkMutationCapability({
      markChainLinkActivationNegated() {},
      markChainLinkEffectNegated() {},
    }),
    true,
  );
});

test("the full-host guard excludes disabled coordinators", () => {
  const capabilities = {
    createChainLink() {},
    resolveChainLink() {},
    buildTriggerOpportunity() {},
  };

  assert.equal(isFullChainHost(capabilities), true);
  assert.equal(isFullChainHost({ ...capabilities, chainsDisabled: true }), false);
  assert.equal(
    isFullChainHost({
      ...capabilities,
      resolveChainLink: null,
    }),
    false,
  );
});
