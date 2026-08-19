import { generateShareSlugSegment } from "@/lib/shareSlug";
import { createAdminClient } from "@/lib/supabase/admin";

type PackageShareSlugRow = {
  id: string;
  share_slug: string | null;
};

/** Assign a missing public package slug while the package is already being rendered. */
export async function ensurePublicPackageShareSlugs<T extends PackageShareSlugRow>(
  admin: ReturnType<typeof createAdminClient>,
  packages: T[],
): Promise<T[]> {
  return Promise.all(
    packages.map(async (pkg) => {
      if (pkg.share_slug?.trim()) return pkg;

      for (let attempt = 0; attempt < 15; attempt += 1) {
        const candidate = generateShareSlugSegment(10);
        const { data, error } = await admin
          .from("packages")
          .update({ share_slug: candidate })
          .eq("id", pkg.id)
          .is("share_slug", null)
          .select("share_slug")
          .maybeSingle();
        if (!error && data?.share_slug) return { ...pkg, share_slug: data.share_slug };
      }

      return pkg;
    }),
  );
}
