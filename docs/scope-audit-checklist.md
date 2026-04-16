# Scope Audit Checklist

Scope standard: every staff/owner operation must validate `studio_id` and, when applicable, `location_id` membership. Cross-studio access must return `403`.

## API Routes

- `POST /api/checkin` - PASS
  - Role gate (`owner/manager/frontdesk/instructor`)
  - Instructor limited to own session
  - Final authorization enforced in `checkin_booking` RPC
- `POST /api/checkin/bulk` - PASS
  - Role gate + per-item RPC authorization
  - Returns per-row errors for forbidden/not_found/not_booked
- `POST /api/book/cancel` - PASS
  - Authorization enforced in `cancel_booking_with_rules` RPC (client ownership or scoped staff)
- `POST /api/payment/mark` - PASS
  - Uses `requireStaffScope(studio_id, location_id)`
- `POST /api/payment/match` - PASS
  - Uses `requireStaffScope(studio_id, location_id)`
  - Verifies payment studio matches booking studio
- `POST /api/frontdesk/walkin` - PASS
  - Uses `requireStaffScope(studio_id, location_id)`
- `GET /api/frontdesk/search` - PASS
  - Uses `requireStaffScope(studio_id, location_id)`
- `POST /api/book/package` - PASS
  - Scoped by RPC `create_package_booking` (studio/location/package ownership)
- `POST /api/book/create` - PASS
  - Scoped by RPC `create_pending_booking` + session studio/slug checks

## Server Actions

- `updateStudioSlug` - PASS (`owner` scoped by studio)
- `createInstructor` - PASS (`owner/manager` + location-in-studio validation)
- `createClassTemplate` - PASS (`owner/manager` + instructor scope validation)
- `createSession` - PASS (`owner/manager/frontdesk` + class/location scope validation)
- `createPackage` - PASS (`owner/manager` + location-in-studio validation)
- `createRecurringRule` - PASS (`owner/manager` + class/location scope validation)
- `saveBookingRules` - PASS (`owner/manager` + location-in-studio validation)
- `createStaffMembership` - PASS (`owner` check + location-in-studio validation)
- `toggleStaffMembership` - PASS (`owner` check)

## Dashboard Pages (explicit scope behavior)

- Multi-studio users must select `studio_id` before core operations:
  - `dashboard`, `classes`, `clients`, `packages`, `reports`, `payments`, `schedule`, `frontdesk`, `qr`
- Scope persistence:
  - Query params: `studio_id`, `location_id`
  - Cookies: `last_studio_id`, `last_location_id`

## Remaining follow-up tests to add

- Cross-studio write attempts should return `403` for:
  - payment mark/match
  - frontdesk walk-in/search
  - bulk check-in
- Cross-location constrained staff should return `403` on out-of-scope records.
