export function getSuperAdminEmails() {
  const raw = process.env.SUPER_ADMIN_EMAILS ?? "";
  return raw
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

export function isSuperAdminEmail(email: string | null | undefined) {
  if (!email) return false;
  return getSuperAdminEmails().includes(email.trim().toLowerCase());
}

