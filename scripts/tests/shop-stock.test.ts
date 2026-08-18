import assert from "node:assert/strict";
import test from "node:test";
import { isShopStockLow } from "../../src/lib/shop-stock.ts";

test("flags stock at or below restock level", () => {
  assert.equal(isShopStockLow(5, 5), true);
  assert.equal(isShopStockLow(4, 5), true);
  assert.equal(isShopStockLow(0, 1), true);
});

test("ignores unlimited stock or unset restock level", () => {
  assert.equal(isShopStockLow(6, 5), false);
  assert.equal(isShopStockLow(null, 5), false);
  assert.equal(isShopStockLow(3, null), false);
  assert.equal(isShopStockLow(null, null), false);
});
