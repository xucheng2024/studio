const identities = {
  owner: {
    id: "d1000000-0000-4000-8000-000000000101",
    email: "com01-local-owner@example.com",
  },
  manager: {
    id: "d1000000-0000-4000-8000-000000000102",
    email: "com01-local-manager@example.com",
  },
  frontdeskL1: {
    id: "d1000000-0000-4000-8000-000000000103",
    email: "com01-local-frontdesk-l1@example.com",
  },
  frontdeskL2: {
    id: "d1000000-0000-4000-8000-000000000104",
    email: "com01-local-frontdesk-l2@example.com",
  },
  instructor: {
    id: "d1000000-0000-4000-8000-000000000105",
    email: "com01-local-instructor@example.com",
  },
  otherOwner: {
    id: "d2000000-0000-4000-8000-000000000101",
    email: "com01-local-other-owner@example.com",
  },
};

export const COM01_LOCAL_IDENTITIES = Object.freeze(
  Object.fromEntries(Object.entries(identities).map(([name, identity]) => [name, Object.freeze(identity)])),
);

export const COM01_LOCAL_IDENTITY_LIST = Object.freeze(Object.values(COM01_LOCAL_IDENTITIES));

export function normalizeEmail(email) {
  return email?.trim().toLowerCase() ?? "";
}

export function assertCom01LocalIdentityManifest() {
  const ids = new Set();
  const emails = new Set();
  for (const identity of COM01_LOCAL_IDENTITY_LIST) {
    if (!identity.id || !normalizeEmail(identity.email)) {
      throw new Error("COM-01 local identity manifest contains an incomplete identity");
    }
    if (ids.has(identity.id) || emails.has(normalizeEmail(identity.email))) {
      throw new Error("COM-01 local identity manifest contains a duplicate UUID or email");
    }
    ids.add(identity.id);
    emails.add(normalizeEmail(identity.email));
  }
}

assertCom01LocalIdentityManifest();
