const test = require("node:test");
const assert = require("node:assert/strict");
const { totalCost, START_COST } = require("../services/randomTalkWallet");
const { cleanDisplayName } = require("../services/guestSessionService");

test("a successful match always reserves the connection fee and first started minute", () => {
  assert.equal(START_COST, 80);
  assert.equal(totalCost(1), 80);
  assert.equal(totalCost(59), 80);
});

test("five minutes costs exactly 160 credits", () => {
  assert.equal(totalCost(5 * 60), 160);
});

test("started-minute billing rounds upward", () => {
  assert.equal(totalCost(61), 100);
  assert.equal(totalCost(10 * 60), 260);
});

test("guest display names are sanitized and cannot imitate staff", () => {
  assert.equal(cleanDisplayName("  Sunny   Day  "), "Sunny Day");
  assert.throws(() => cleanDisplayName("admin helper"), /does not imitate/i);
  assert.throws(() => cleanDisplayName("x"), /3–18/);
});
