# PushPress Platform API Skill

Use this skill when interacting with the PushPress Platform API — querying customers, checkins, enrollments, classes, appointments, reservations, messaging, and webhooks.

## Base URL & Auth

```
Base URL: https://api.pushpress.com/v3
```

Every request needs these headers:

```
API-KEY: <api_key>
company-id: <pushpress_company_id>
Content-Type: application/json
```

- `API-KEY` is the primary auth mechanism (NOT `Authorization: Bearer`)
- `company-id` is lowercase (NOT `X-Company-ID` or `x-company-id`)
- Both headers are required for multi-tenant API keys

## Quick Reference — Endpoints

### Customers

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/customers` | List customers (paginated) |
| `GET` | `/customers/{uuid}` | Get customer details |
| `POST` | `/customers` | Create a new customer |

**Customer fields:** `id`, `companyId`, `name`, `gender`, `dob`, `address`, `assignedToStaffId`, `account` (with `email`, `phone`), `profileImage`, `role`, `status`, `createdAt`

**Query params for list:** `limit`, `page`, `status` (active/inactive/lead/deleted), `query` (search name/email)

### Checkins

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/checkins/class` | List class checkins |
| `GET` | `/checkins/class/{uuid}` | Get class checkin details |
| `GET` | `/checkins/appointment` | List appointment checkins |
| `GET` | `/checkins/event` | List event checkins |
| `GET` | `/checkins/open` | List open/facility checkins |
| `GET` | `/checkins/count` | Get checkin count |

**Checkin fields:** `id`, `customer`, `company`, `timestamp` (unix ms), `enrollmentId`, `name`, `kind` (class/appointment/event/open), `role`, `result` (success/failure), `source`

**Query params:** `customer` (uuid), `from`/`to` (unix timestamp), `limit`, `page`

### Classes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/classes` | List classes |
| `GET` | `/classes/{id}` | Get class details |
| `GET` | `/classes/types` | List class types |
| `GET` | `/classes/types/{id}` | Get class type |

**Class fields:** `id`, `coachUuid`, `company`, `title`, `classTypeName`, `location`, `startTimestamp`, `endTimestamp`, `registeredCount`, `waitlistCount`, `limit`

### Enrollments (Plans)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/enrollments` | List plan enrollments |
| `GET` | `/enrollments/{uuid}` | Get enrollment details |
| `GET` | `/plans/{id}` | Get plan details |

**Enrollment fields:** `id`, `customerId`, `companyId`, `planId`, `billingSchedule`, `status` (active/canceled/completed/...), `startDate`, `endDate`

### Appointments

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/appts/{id}` | Get appointment details |

**Appointment fields:** `id`, `type`, `companyId`, `customerId`, `startTimestamp`, `staffId`, `isLateCancel`

### Reservations

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/reservations` | List reservations |
| `GET` | `/reservations/{id}` | Get reservation details |

**Reservation fields:** `id`, `reservedId`, `customerId`, `companyId`, `registrationTimestamp`, `status`, `checkin`, `templateId`

### Messaging

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/messages/email/send` | Send email to a customer |
| `POST` | `/messages/sms/send` | Send SMS |
| `POST` | `/messages/push/send` | Send push notification |
| `POST` | `/messages/notification/send` | Send realtime event |

**Email body:** `{ customer, subject, text, html, from, replyTo }`
**SMS body:** `{ to, message }` (to = E.164 phone number)

### Webhooks

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks` | Create a webhook |
| `GET` | `/webhooks` | List webhooks |
| `GET` | `/webhooks/{uuid}` | Get webhook details |
| `PATCH` | `/webhooks/{uuid}` | Update a webhook |
| `DELETE` | `/webhooks/{uuid}` | Delete a webhook |
| `PATCH` | `/webhooks/{uuid}/activate` | Activate a webhook |
| `PATCH` | `/webhooks/{uuid}/deactivate` | Deactivate a webhook |
| `POST` | `/webhooks/{uuid}/rotate-signing-secret` | Rotate signing secret |

**Create webhook body:** `{ url, eventTypes: string[] }`
**Response uses `id` field** (not `uuid`)

### Company

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/company` | Get company details |

### Attributions

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/attributions/attributions` | Create attribution |
| `GET` | `/attributions/attributions` | List attributions |
| `GET` | `/attributions/attributions/{uuid}` | Get attribution |

### Invitations

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/invitations` | List invitations |
| `POST` | `/invitations` | Create invitations |
| `GET` | `/invitations/{id}` | Get invitation |
| `DELETE` | `/invitations/{id}` | Delete invitation |

## Webhook Event Types

All available events that can be subscribed to:

### Customer Events
- `customer.created` — New customer added (data: `Customer`)
- `customer.details.changed` — Name, email, phone etc updated (data: `Customer`)
- `customer.status.changed` — Status changed (active→inactive, etc) (data: `Customer`)
- `customer.deleted` — Customer removed (data: `Customer`)

### Enrollment Events
- `enrollment.created` — New plan enrollment (data: `Enrollment`)
- `enrollment.status.changed` — Enrollment status changed (data: `Enrollment`)
- `enrollment.deleted` — Enrollment removed (data: `Enrollment`)

### Checkin Events
- `checkin.created` — New checkin recorded (data: `Checkin`)
- `checkin.updated` — Checkin modified (data: `Checkin`)
- `checkin.failed` — Checkin attempt failed (data: `Checkin`)
- `checkin.deleted` — Checkin removed (data: `Checkin`)

### Appointment Events
- `appointment.scheduled` — New appointment booked (data: `Appointment`)
- `appointment.rescheduled` — Appointment time changed (data: `Appointment`)
- `appointment.canceled` — Appointment cancelled (data: `Appointment`)
- `appointment.noshowed` — Client didn't show up (data: `Appointment`)

### Reservation Events
- `reservation.created` — New class reservation (data: `Reservation`)
- `reservation.waitlisted` — Added to waitlist (data: `Reservation`)
- `reservation.canceled` — Reservation cancelled (data: `Reservation`)
- `reservation.noshowed` — No-show for reservation (data: `Reservation`)

### Class Events
- `class.canceled` — Class cancelled by gym (data: `Class`)

### App Events
- `app.installed` — App installed on a location (data: `AppInstall`)
- `app.uninstalled` — App removed from location (data: `AppInstall`)

## Webhook Payload Structure

```json
{
  "event": "customer.created",
  "created": 1672531200000,
  "data": {
    "id": "usr_12345",
    "companyId": "cli_12345",
    "name": "John Doe",
    "...": "..."
  }
}
```

**CRITICAL:** The company identifier is INSIDE the `data` object:
- `data.company` — for checkins, classes, events
- `data.companyId` — for customers, enrollments, appointments, reservations

It is NOT at the top level of the payload. Extract it like:
```typescript
const companyId = data.companyId ?? data.company ?? payload.companyId ?? ''
```

## Entity ID Prefixes

PushPress uses prefixed UUIDs:
- `usr_` — Customers
- `cli_` — Companies
- `chk_` — Checkins
- `cit_` — Class types
- `cal_item_` — Calendar items (classes)

## Common Patterns

### Pagination
Most list endpoints support `limit` and `page` query params. Response includes `total` in meta.

### Timestamps
- API uses **Unix millisecond timestamps** (e.g., `1672531200000`)
- Date fields like `startDate`, `endDate` use ISO format (`2024-01-15`)

### Customer Status Values
- `active` — Current member
- `inactive` — Cancelled/paused
- `lead` — Prospect, hasn't enrolled
- `deleted` — Soft-deleted

### Enrollment Status Values
- `active` — Currently enrolled
- `canceled` — Cancelled by member/staff
- `completed` — Plan finished naturally
- `past_due` — Payment failed
- `suspended` — Temporarily suspended

## Full OpenAPI Spec

The complete OpenAPI 3.1.0 specification is at `docs/pushpress-openapi.json` in the repo.
