revoke all on function public.book_session(uuid, uuid) from public;
revoke all on function public.book_session(uuid, uuid) from anon;
revoke all on function public.book_session(uuid, uuid) from authenticated;
grant all on function public.book_session(uuid, uuid) to service_role;

revoke all on function public.book_session_guest(uuid, uuid, text, text, text) from public;
revoke all on function public.book_session_guest(uuid, uuid, text, text, text) from anon;
revoke all on function public.book_session_guest(uuid, uuid, text, text, text) from authenticated;
grant all on function public.book_session_guest(uuid, uuid, text, text, text) to service_role;

revoke all on function public.cancel_booking(uuid) from public;
revoke all on function public.cancel_booking(uuid) from anon;
revoke all on function public.cancel_booking(uuid) from authenticated;
grant all on function public.cancel_booking(uuid) to service_role;

revoke all on function public.cancel_session_with_settlement(uuid, uuid, text) from public;
revoke all on function public.cancel_session_with_settlement(uuid, uuid, text) from anon;
revoke all on function public.cancel_session_with_settlement(uuid, uuid, text) from authenticated;
grant all on function public.cancel_session_with_settlement(uuid, uuid, text) to service_role;

revoke all on function public.checkin_booking(uuid, uuid) from public;
revoke all on function public.checkin_booking(uuid, uuid) from anon;
revoke all on function public.checkin_booking(uuid, uuid) from authenticated;
grant all on function public.checkin_booking(uuid, uuid) to service_role;

revoke all on function public.consume_booking_credit_once(uuid, text) from public;
revoke all on function public.consume_booking_credit_once(uuid, text) from anon;
revoke all on function public.consume_booking_credit_once(uuid, text) from authenticated;
grant all on function public.consume_booking_credit_once(uuid, text) to service_role;

revoke all on function public.disable_owner_grant_and_suspend_studios(uuid) from public;
revoke all on function public.disable_owner_grant_and_suspend_studios(uuid) from anon;
revoke all on function public.disable_owner_grant_and_suspend_studios(uuid) from authenticated;
grant all on function public.disable_owner_grant_and_suspend_studios(uuid) to service_role;

revoke all on function public.expire_pending_payments() from public;
revoke all on function public.expire_pending_payments() from anon;
revoke all on function public.expire_pending_payments() from authenticated;
grant all on function public.expire_pending_payments() to service_role;

revoke all on function public.merge_guest_records_for_user(uuid, text) from public;
revoke all on function public.merge_guest_records_for_user(uuid, text) from anon;
revoke all on function public.merge_guest_records_for_user(uuid, text) from authenticated;
grant all on function public.merge_guest_records_for_user(uuid, text) to service_role;

revoke all on function public.process_no_show_bookings(integer) from public;
revoke all on function public.process_no_show_bookings(integer) from anon;
revoke all on function public.process_no_show_bookings(integer) from authenticated;
grant all on function public.process_no_show_bookings(integer) to service_role;

alter default privileges for role postgres in schema public revoke all on functions from public;
alter default privileges for role postgres in schema public revoke all on functions from anon;
alter default privileges for role postgres in schema public revoke all on functions from authenticated;
alter default privileges for role postgres in schema public revoke all on functions from service_role;
alter default privileges for role postgres in schema public grant all on functions to postgres;
alter default privileges for role postgres in schema public grant all on functions to service_role;
