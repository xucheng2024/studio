const normalizeEmail = (email) => email?.trim().toLowerCase() ?? "";

export async function listAllAuthUsers(admin) {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

export async function ensureLocalAuthIdentities(admin, identities, label) {
  let users = await listAllAuthUsers(admin);
  for (const identity of identities) {
    const sameId = users.find((user) => user.id === identity.id);
    const sameEmail = users.find((user) => normalizeEmail(user.email) === normalizeEmail(identity.email));
    if (sameId && normalizeEmail(sameId.email) !== normalizeEmail(identity.email)) throw new Error(`${label} Auth UUID collision for ${identity.id}`);
    if (sameEmail && sameEmail.id !== identity.id) throw new Error(`${label} Auth email collision for ${identity.email}`);
    if (sameId || sameEmail) continue;
    const { data, error } = await admin.auth.admin.createUser({ id: identity.id, email: identity.email, email_confirm: true });
    if (!error && data.user?.id === identity.id && normalizeEmail(data.user.email) === normalizeEmail(identity.email)) {
      users.push(data.user);
      continue;
    }
    users = await listAllAuthUsers(admin);
    const recovered = users.find((user) => user.id === identity.id || normalizeEmail(user.email) === normalizeEmail(identity.email));
    if (!recovered) throw error ?? new Error(`${label} Auth provisioning failed for ${identity.email}`);
    if (recovered.id !== identity.id || normalizeEmail(recovered.email) !== normalizeEmail(identity.email)) throw new Error(`${label} Auth identity collision for ${identity.email}`);
  }
}
