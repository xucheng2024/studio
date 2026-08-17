import { createAdminClient } from "@/lib/supabase/admin";
import { isAllowedMarketingCtaUrl } from "@/lib/marketing-url";

type Props = { params: Promise<{ token: string }> };

export async function GET(_request: Request, { params }: Props) {
  const { token } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    return new Response("Not found", { status: 404 });
  }
  const { data, error } = await createAdminClient().rpc("mkt02_record_click", { p_token: token });
  const result = data as { ok?: boolean; target_url?: string } | null;
  if (error || !result?.ok || !result.target_url) return new Response("Not found", { status: 404 });
  if (!isAllowedMarketingCtaUrl(result.target_url)) return new Response("Not found", { status: 404 });
  return Response.redirect(result.target_url, 302);
}
