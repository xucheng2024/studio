import { renderAppointmentsPage } from "@/app/me/_shared/appointments-page";

type Props = {
  searchParams?: Promise<{
    ok?: string;
    error?: string;
  }>;
};

export default async function MyAppointmentsPage({ searchParams }: Props) {
  const sp = (await searchParams) ?? {};
  return renderAppointmentsPage(undefined, {
    ok: typeof sp.ok === "string" ? sp.ok : undefined,
    error: typeof sp.error === "string" ? sp.error : undefined,
  });
}
