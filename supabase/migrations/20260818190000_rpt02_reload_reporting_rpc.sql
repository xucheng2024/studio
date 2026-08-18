-- Reload PostgREST so get_rpt01_reporting_facts is visible to the API.

notify pgrst, 'reload schema';

grant execute on function public.get_rpt01_reporting_facts(uuid, date, date, uuid, boolean, uuid, uuid)
  to service_role;
