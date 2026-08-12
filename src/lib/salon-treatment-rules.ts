export type TreatmentScopedRole = "non_instructor" | "instructor";

export type TreatmentAccessRelation = {
  treatment_id: string;
  location_id: string;
  served_by_actor: boolean;
};

export function canAccessTreatmentInScopedLocation(params: {
  scopedRole: TreatmentScopedRole | null | undefined;
  servedByActor: boolean;
}) {
  if (!params.scopedRole) return false;
  if (params.scopedRole === "non_instructor") return true;
  return params.servedByActor;
}

export function canMutateTreatmentInScopedLocation(params: {
  scopedRole: TreatmentScopedRole | null | undefined;
  servedByActor: boolean;
}) {
  return canAccessTreatmentInScopedLocation(params);
}

export function deriveAllowedTreatmentIdsByScopedLocationRole(params: {
  relations: TreatmentAccessRelation[];
  scopedRoleByLocationId: Record<string, TreatmentScopedRole>;
}) {
  const allowedTreatmentIds = new Set<string>();

  for (const relation of params.relations) {
    const scopedRole = params.scopedRoleByLocationId[relation.location_id] ?? null;
    if (canAccessTreatmentInScopedLocation({ scopedRole, servedByActor: relation.served_by_actor })) {
      allowedTreatmentIds.add(relation.treatment_id);
    }
  }

  return allowedTreatmentIds;
}
