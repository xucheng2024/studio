import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveAllowedSalonCustomerIdsByScopedLocationRole,
  deriveAllowedSalonCustomerIdsFromRelations,
} from "../../src/lib/salon-customer-sensitive-rules.ts";

test("CRM-01 relation scope: booking-only customer is allowed for manager/frontdesk", () => {
  const customerId = "f0000000-0000-0000-0000-00000000a001";
  const linkedUserId = "a0000000-0000-0000-0000-00000000a001";

  const allowedForManager = deriveAllowedSalonCustomerIdsFromRelations({
    role: "manager",
    customerRows: [{ id: customerId, user_id: linkedUserId }],
    appointmentCustomerIds: [],
    paymentClientIds: [],
    bookingClientIds: [linkedUserId],
  });
  assert.equal(allowedForManager.has(customerId), true);

  const allowedForFrontdesk = deriveAllowedSalonCustomerIdsFromRelations({
    role: "frontdesk",
    customerRows: [{ id: customerId, user_id: linkedUserId }],
    appointmentCustomerIds: [],
    paymentClientIds: [],
    bookingClientIds: [linkedUserId],
  });
  assert.equal(allowedForFrontdesk.has(customerId), true);
});

test("CRM-01 relation scope: instructor cannot use booking/payment of unrelated customer", () => {
  const customerId = "f0000000-0000-0000-0000-00000000b001";
  const linkedUserId = "a0000000-0000-0000-0000-00000000b001";

  const denied = deriveAllowedSalonCustomerIdsFromRelations({
    role: "instructor",
    customerRows: [{ id: customerId, user_id: linkedUserId }],
    appointmentCustomerIds: [],
    paymentClientIds: [linkedUserId],
    bookingClientIds: [linkedUserId],
  });
  assert.equal(denied.has(customerId), false);
});

test("CRM-01 relation scope: instructor can access own serviced appointment customer", () => {
  const customerId = "f0000000-0000-0000-0000-00000000c001";

  const allowed = deriveAllowedSalonCustomerIdsFromRelations({
    role: "instructor",
    customerRows: [{ id: customerId, user_id: "a0000000-0000-0000-0000-00000000c001" }],
    appointmentCustomerIds: [customerId],
    paymentClientIds: [],
    bookingClientIds: [],
  });
  assert.equal(allowed.has(customerId), true);
});

test("CRM-01 mixed role: L1 manager + L2 instructor denies L2 booking/payment/other-appointment", () => {
  const l1 = "c0000000-0000-0000-0000-00000000d001";
  const l2 = "c0000000-0000-0000-0000-00000000d002";
  const l2BookingCustomer = { id: "f0000000-0000-0000-0000-00000000d101", user_id: "a0000000-0000-0000-0000-00000000d101" };
  const l2OtherAppointmentCustomer = { id: "f0000000-0000-0000-0000-00000000d102", user_id: "a0000000-0000-0000-0000-00000000d102" };

  const allowed = deriveAllowedSalonCustomerIdsByScopedLocationRole({
    customerRows: [l2BookingCustomer, l2OtherAppointmentCustomer],
    locationRoleById: {
      [l1]: "non_instructor",
      [l2]: "instructor",
    },
    appointmentRelations: [
      {
        salon_customer_id: l2OtherAppointmentCustomer.id,
        location_id: l2,
        served_by_actor: false,
      },
    ],
    paymentRelations: [{ client_id: l2BookingCustomer.user_id!, location_id: l2 }],
    bookingRelations: [{ client_id: l2BookingCustomer.user_id!, location_id: l2 }],
  });

  assert.equal(allowed.has(l2BookingCustomer.id), false);
  assert.equal(allowed.has(l2OtherAppointmentCustomer.id), false);
});

test("CRM-01 mixed role: L1 manager + L2 instructor allows L2 own appointment", () => {
  const l1 = "c0000000-0000-0000-0000-00000000e001";
  const l2 = "c0000000-0000-0000-0000-00000000e002";
  const l2OwnAppointmentCustomer = { id: "f0000000-0000-0000-0000-00000000e101", user_id: "a0000000-0000-0000-0000-00000000e101" };

  const allowed = deriveAllowedSalonCustomerIdsByScopedLocationRole({
    customerRows: [l2OwnAppointmentCustomer],
    locationRoleById: {
      [l1]: "non_instructor",
      [l2]: "instructor",
    },
    appointmentRelations: [
      {
        salon_customer_id: l2OwnAppointmentCustomer.id,
        location_id: l2,
        served_by_actor: true,
      },
    ],
    paymentRelations: [],
    bookingRelations: [],
  });

  assert.equal(allowed.has(l2OwnAppointmentCustomer.id), true);
});

test("CRM-01 mixed role: L1 manager + L2 instructor allows L1 booking-only", () => {
  const l1 = "c0000000-0000-0000-0000-00000000f001";
  const l2 = "c0000000-0000-0000-0000-00000000f002";
  const l1BookingCustomer = { id: "f0000000-0000-0000-0000-00000000f101", user_id: "a0000000-0000-0000-0000-00000000f101" };

  const allowed = deriveAllowedSalonCustomerIdsByScopedLocationRole({
    customerRows: [l1BookingCustomer],
    locationRoleById: {
      [l1]: "non_instructor",
      [l2]: "instructor",
    },
    appointmentRelations: [],
    paymentRelations: [],
    bookingRelations: [{ client_id: l1BookingCustomer.user_id!, location_id: l1 }],
  });

  assert.equal(allowed.has(l1BookingCustomer.id), true);
});
