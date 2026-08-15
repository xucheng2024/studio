import {
  COM01_LOCAL_IDENTITY_LIST,
  assertCom01LocalIdentityManifest,
  normalizeEmail,
} from "../fixtures/com01-local-identities.mjs";

export async function listAllAuthUsers(admin) {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

function assertNoIdentityCollision(users, identity) {
  const sameId = users.find((user) => user.id === identity.id);
  const sameEmail = users.find((user) => normalizeEmail(user.email) === normalizeEmail(identity.email));
  if (sameId && normalizeEmail(sameId.email) !== normalizeEmail(identity.email)) {
    throw new Error(`COM-01 Auth UUID collision for ${identity.id}`);
  }
  if (sameEmail && sameEmail.id !== identity.id) {
    throw new Error(`COM-01 Auth email collision for ${identity.email}`);
  }
  return sameId ?? sameEmail;
}

export async function ensureCom01LocalAuthIdentities(admin) {
  assertCom01LocalIdentityManifest();
  let users = await listAllAuthUsers(admin);
  for (const identity of COM01_LOCAL_IDENTITY_LIST) {
    const existing = assertNoIdentityCollision(users, identity);
    if (existing) continue;

    const { data, error } = await admin.auth.admin.createUser({
      id: identity.id,
      email: identity.email,
      email_confirm: true,
      user_metadata: { full_name: `COM01 ${identity.email.split("@")[0]}` },
    });
    if (!error && data.user?.id === identity.id && normalizeEmail(data.user.email) === normalizeEmail(identity.email)) {
      users.push(data.user);
      continue;
    }

    // A concurrent local run may have created the identity. Re-read and only accept an exact match.
    users = await listAllAuthUsers(admin);
    const recovered = assertNoIdentityCollision(users, identity);
    if (!recovered) throw error ?? new Error(`COM-01 Auth provisioning returned an unexpected identity for ${identity.email}`);
  }
  return users;
}
