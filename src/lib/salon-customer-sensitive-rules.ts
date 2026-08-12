export type SensitiveActorRole = "owner" | "manager" | "frontdesk" | "instructor";

export type SalonCustomerRelationRow = {
  id: string;
  user_id: string | null;
};

export type ScopedSensitiveLocationRole = "non_instructor" | "instructor";

export type AppointmentCustomerRelation = {
  salon_customer_id: string;
  location_id: string;
  served_by_actor: boolean;
};

export type ClientLocationRelation = {
  client_id: string;
  location_id: string;
};

export function deriveAllowedSalonCustomerIdsByScopedLocationRole(params: {
  customerRows: SalonCustomerRelationRow[];
  locationRoleById: Record<string, ScopedSensitiveLocationRole>;
  appointmentRelations: AppointmentCustomerRelation[];
  paymentRelations: ClientLocationRelation[];
  bookingRelations: ClientLocationRelation[];
}) {
  const allowedCustomerIds = new Set<string>();

  for (const relation of params.appointmentRelations) {
    const scopedRole = params.locationRoleById[relation.location_id];
    if (!scopedRole) continue;
    if (scopedRole === "non_instructor" || relation.served_by_actor) {
      allowedCustomerIds.add(relation.salon_customer_id);
    }
  }

  const customerIdsByUserId = new Map<string, string[]>();
  for (const customer of params.customerRows) {
    if (!customer.user_id) continue;
    const ids = customerIdsByUserId.get(customer.user_id) ?? [];
    ids.push(customer.id);
    customerIdsByUserId.set(customer.user_id, ids);
  }

  const addClientScopedCustomers = (relation: ClientLocationRelation) => {
    if (params.locationRoleById[relation.location_id] !== "non_instructor") return;
    const customerIds = customerIdsByUserId.get(relation.client_id);
    if (!customerIds?.length) return;
    for (const customerId of customerIds) {
      allowedCustomerIds.add(customerId);
    }
  };

  for (const relation of params.paymentRelations) addClientScopedCustomers(relation);
  for (const relation of params.bookingRelations) addClientScopedCustomers(relation);

  return allowedCustomerIds;
}

export function deriveAllowedSalonCustomerIdsFromRelations(params: {
  role: SensitiveActorRole;
  customerRows: SalonCustomerRelationRow[];
  appointmentCustomerIds: string[];
  paymentClientIds: string[];
  bookingClientIds: string[];
}) {
  const locationRole = params.role === "instructor" ? "instructor" : "non_instructor";
  return deriveAllowedSalonCustomerIdsByScopedLocationRole({
    customerRows: params.customerRows,
    locationRoleById: { __all__: locationRole },
    appointmentRelations: params.appointmentCustomerIds.map((customerId) => ({
      salon_customer_id: customerId,
      location_id: "__all__",
      served_by_actor: true,
    })),
    paymentRelations: params.paymentClientIds.map((clientId) => ({
      client_id: clientId,
      location_id: "__all__",
    })),
    bookingRelations: params.bookingClientIds.map((clientId) => ({
      client_id: clientId,
      location_id: "__all__",
    })),
  });
}
