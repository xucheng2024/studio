import assert from "node:assert/strict";
import test from "node:test";
import {
  canAccessTreatmentInScopedLocation,
  canMutateTreatmentInScopedLocation,
  deriveAllowedTreatmentIdsByScopedLocationRole,
} from "../../src/lib/salon-treatment-rules.ts";

test("CRM-02 non-instructor role can access location treatment", () => {
  const allowed = deriveAllowedTreatmentIdsByScopedLocationRole({
    scopedRoleByLocationId: {
      "loc-1": "non_instructor",
    },
    relations: [
      { treatment_id: "tx-1", location_id: "loc-1", served_by_actor: false },
    ],
  });

  assert.equal(allowed.has("tx-1"), true);
});

test("CRM-02 instructor only accesses own serviced treatment", () => {
  const allowed = deriveAllowedTreatmentIdsByScopedLocationRole({
    scopedRoleByLocationId: {
      "loc-1": "instructor",
    },
    relations: [
      { treatment_id: "tx-own", location_id: "loc-1", served_by_actor: true },
      { treatment_id: "tx-other", location_id: "loc-1", served_by_actor: false },
    ],
  });

  assert.equal(allowed.has("tx-own"), true);
  assert.equal(allowed.has("tx-other"), false);
});

test("CRM-02 mixed scope: manager at L1 + instructor at L2", () => {
  const allowed = deriveAllowedTreatmentIdsByScopedLocationRole({
    scopedRoleByLocationId: {
      "loc-1": "non_instructor",
      "loc-2": "instructor",
    },
    relations: [
      { treatment_id: "tx-l1", location_id: "loc-1", served_by_actor: false },
      { treatment_id: "tx-l2-own", location_id: "loc-2", served_by_actor: true },
      { treatment_id: "tx-l2-other", location_id: "loc-2", served_by_actor: false },
    ],
  });

  assert.equal(allowed.has("tx-l1"), true);
  assert.equal(allowed.has("tx-l2-own"), true);
  assert.equal(allowed.has("tx-l2-other"), false);
});

test("CRM-02 mutation guard mirrors list/detail guard", () => {
  assert.equal(canAccessTreatmentInScopedLocation({ scopedRole: "instructor", servedByActor: false }), false);
  assert.equal(canMutateTreatmentInScopedLocation({ scopedRole: "instructor", servedByActor: false }), false);
  assert.equal(canAccessTreatmentInScopedLocation({ scopedRole: "non_instructor", servedByActor: false }), true);
  assert.equal(canMutateTreatmentInScopedLocation({ scopedRole: "non_instructor", servedByActor: false }), true);
});
