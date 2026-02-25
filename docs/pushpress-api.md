# PushPress Platform API Reference

**Version:** 3.0.0  
**Base URL:** `https://api.pushpress.com/v3`  
**OpenAPI Spec:** [pushpress-openapi.json](./pushpress-openapi.json)

## Authentication

| Method | Header | Description |
|--------|--------|-------------|
| API Key | `API-KEY: <key>` | Primary auth |
| Bearer | `Authorization: Bearer <jwt>` | JWT provisioning |

For multi-tenant keys, include `company-id: <uuid>` header.

## Endpoints

- **`GET /appts/{id}`** — Get details for an appointment
- **`POST /attributions/attributions`** — Create a customer attribution
- **`GET /attributions/attributions`** — List customer attributions
- **`GET /attributions/attributions/{uuid}`** — Get a customer attribution
- **`GET /checkins/appointment`** — List Appointment Checkins
- **`GET /checkins/appointment/{uuid}`** — Get Appointment Checkin Details
- **`GET /checkins/class`** — List Class Checkins
- **`GET /checkins/class/{uuid}`** — Get Class Checkin Details
- **`GET /checkins/count`** — Get Checkin Count
- **`GET /checkins/event`** — List Event Checkins
- **`GET /checkins/event/{uuid}`** — Get Event Checkin Details
- **`GET /checkins/open`** — List Open Checkins
- **`GET /checkins/open/{uuid}`** — Get Open Facility Details
- **`GET /classes`** — List Classes
- **`GET /classes/types`** — List class types for the given gym
- **`GET /classes/types/{id}`** — Get a class type
- **`GET /classes/{id}`** — Get Details for a Class
- **`GET /company`** — Get Company Details
- **`POST /customers`** — Create a new Customer
- **`GET /customers`** — List Customers
- **`GET /customers/{uuid}`** — Get Customer Details
- **`GET /enrollments`** — List Plan Enrollments
- **`GET /enrollments/{uuid}`** — Get Plan Enrollment Details
- **`GET /events`** — List Events
- **`GET /events/{id}`** — Get details for an event
- **`GET /invitations`** — List Invitations
- **`POST /invitations`** — Create Invitations
- **`GET /invitations/{id}`** — Get an invitation
- **`DELETE /invitations/{id}`** — Delete an invitation
- **`POST /keys`** — Create a new API Key
- **`GET /keys`** — List API Keys
- **`GET /keys/{id}`** — Get API Key
- **`DELETE /keys/{id}`** — Delete an API Key
- **`PATCH /keys/{id}/revoke`** — Revoke an API Key
- **`POST /messages/email/send`** — Send an Email
- **`POST /messages/notification/send`** — Send Ably Realtime Event
- **`POST /messages/push/send`** — Send Push Notification
- **`POST /messages/sms/send`** — Send an SMS
- **`GET /plans/{id}`** — Get Plan details
- **`GET /reservations`** — List Reservations
- **`GET /reservations/{id}`** — Get Details for a Reservation
- **`POST /webhooks`** — Create a Webhook
- **`GET /webhooks`** — List Webhooks
- **`GET /webhooks/{uuid}`** — Get Webhook Details
- **`PATCH /webhooks/{uuid}`** — Update a Webhook
- **`DELETE /webhooks/{uuid}`** — Delete a Webhook
- **`PATCH /webhooks/{uuid}/activate`** — Activate a Webhook
- **`PATCH /webhooks/{uuid}/deactivate`** — Deactivate a Webhook
- **`POST /webhooks/{uuid}/rotate-signing-secret`** — Rotate a Webhook Signing Secret

### Appts

#### `GET /appts/{id}`

**Get details for an appointment**

Get details for an appointment

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `id` | path | string | Yes |  |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

### Attributions

#### `POST /attributions/attributions`

**Create a customer attribution**

Create a new customer attribution record

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

**Request Body:**

| Field | Type | Description |
|-------|------|-------------|
| `customerId` | string |  |
| `event` | string |  |
| `referer` | string/null | Referer URL |
| `utmSource` | string/null | UTM source |
| `utmMedium` | string/null | UTM medium |
| `utmCampaign` | string/null | UTM campaign |
| `utmContent` | string/null | UTM content |
| `utmTerm` | string/null | UTM term |
| `rawUrl` | string/null | Raw URL |
| `url` | string/null | Normalized URL |
| `fbclid` | string/null | Facebook click identifier |
| `gclid` | string/null | Google Ads click identifier |
| `msclkid` | string/null | Microsoft Ads click identifier |
| `dclid` | string/null | DoubleClick click identifier |
| `userAgent` | string/null | User agent |
| `ipAddress` | string/null | IP address |

---

#### `GET /attributions/attributions`

**List customer attributions**

List customer attributions, optionally filtering by customer id and/or attribution event

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `customer` | query | string | No | Filter by Customer ID |
| `attributionEvent` | query | string | No | Filter by Attribution Event |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

#### `GET /attributions/attributions/{uuid}`

**Get a customer attribution**

Get a customer attribution by UUID

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `uuid` | path | string | Yes |  |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

### Checkins

#### `GET /checkins/appointment`

**List Appointment Checkins**

list appointment checkins. Includes details about the appointment, customer and staff

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `next` | query | string | No | next cursor |
| `customer` | query | string | No |  |
| `before` | query | number | No | Get all checkins before this unix timestamp (seconds) |
| `after` | query | number | No | Get all checkins after this unix timestamp (seconds) |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

#### `GET /checkins/appointment/{uuid}`

**Get Appointment Checkin Details**

Get the checkin details for appointment including appointment details and checkin time

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `uuid` | path | string | Yes |  |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

#### `GET /checkins/class`

**List Class Checkins**

list event checkins

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `page` | query | integer | No | page number |
| `limit` | query | integer | No | limit |
| `customer` | query | string | No |  |
| `before` | query | number | No | Get all checkins before this unix timestamp (seconds) |
| `after` | query | number | No | Get all checkins after this unix timestamp (seconds) |
| `result` | query | string | No | Filter checkins by result status (success or failure) |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

#### `GET /checkins/class/{uuid}`

**Get Class Checkin Details**

Get the checkin details for class including class details and checkin time

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `uuid` | path | string | Yes |  |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

#### `GET /checkins/count`

**Get Checkin Count**

Get a count of checkins based on filter criteria, including event, customer and time range

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `include` | query | string | No | When defined only include checkins for these categories |
| `type` | query |  | No | When defined only include sub categories of classes/appointments/events with thi |
| `customer` | query | string | No |  |
| `includeHistoricalCheckins` | query | string | No | whether to include checkins that happened outside of pushpress, currently defaul |
| `before` | query | number | No | Checkins before this unix timestamp |
| `after` | query | number | No | Checkins after this unix timestamp |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

#### `GET /checkins/event`

**List Event Checkins**

List event checkins. Includes details about the event

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `page` | query | integer | No | page number |
| `limit` | query | integer | No | limit |
| `customer` | query | string | No |  |
| `before` | query | number | No | Get all checkins before this unix timestamp (seconds) |
| `after` | query | number | No | Get all checkins after this unix timestamp (seconds) |
| `result` | query | string | No | Filter checkins by result status (success or failure) |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

#### `GET /checkins/event/{uuid}`

**Get Event Checkin Details**

Get the checkin details for event including event details and checkin time

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `uuid` | path | string | Yes |  |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

#### `GET /checkins/open`

**List Open Checkins**

List open facility checkins

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `page` | query | integer | No | page number |
| `limit` | query | integer | No | limit |
| `customer` | query | string | No |  |
| `before` | query | number | No | Get all checkins before this unix timestamp (seconds) |
| `after` | query | number | No | Get all checkins after this unix timestamp (seconds) |
| `result` | query | string | No | Filter checkins by result status (success or failure) |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

#### `GET /checkins/open/{uuid}`

**Get Open Facility Details**

Get the checkin details for an open facility checkin

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `uuid` | path | string | Yes |  |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

### Classes

#### `GET /classes`

**List Classes**

Get a paginated list of classes

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `page` | query | integer | No | page number |
| `limit` | query | integer | No | limit |
| `startsAfter` | query | number | No | Filter by classes that start after this timestamp (Unix Seconds) |
| `access` | query | string | No | Some events require an invitation for signup, most invites and all classes are o |
| `order` | query | string | No | sort classes by start timestamp |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

#### `GET /classes/types`

**List class types for the given gym**

Get Class type details

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

#### `GET /classes/types/{id}`

**Get a class type**

Get Class type details

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `id` | path | string | Yes |  |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

#### `GET /classes/{id}`

**Get Details for a Class**

Get details for a class

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `expand` | query | array | No |  |
| `id` | path | string | Yes |  |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

### Company

#### `GET /company`

**Get Company Details**

Fetch the company details associated with the currently authenticated user.

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

### Customers

#### `POST /customers`

**Create a new Customer**

Create a new customer in the platform. Note that this endpoint only supports creating leads at this time

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

**Request Body:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | A unique identifier assigned to each customer |
| `assignedToStaffId` | string/null | The UUID of the assigned staff member |
| `address` | object | Customer address. Defaults to an empty string if no value is set. |
| `name` | object |  |
| `email` | string | The email address of the customer |
| `phone` | string/null | The phone number of the customer |
| `emergencyContact` | object |  |
| `dob` | string/null | The customer's date of birth, null if not provided, formatted YYYY-MM-DD |
| `gender` | string/null | The customer's gender, null if unknown or other |
| `account` |  |  |
| `source` | string | The source of the lead |

---

#### `GET /customers`

**List Customers**

Get a list of customers in the current company

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `page` | query | integer | No | page number |
| `limit` | query | integer | No | limit |
| `role` | query | string | No | Filter by role such as admin, frontdesk, or member |
| `email` | query | string | No | optional filter by email |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

#### `GET /customers/{uuid}`

**Get Customer Details**

Get individual customer information, including profile image, primary image, and other profile information.

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `uuid` | path | string | Yes |  |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

### Enrollments

#### `GET /enrollments`

**List Plan Enrollments**

Get a list of enrollments in the current company

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `page` | query | integer | No | page number |
| `limit` | query | integer | No | limit |
| `customerId` | query | string | No |  |
| `status` | query | string | No |  |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

#### `GET /enrollments/{uuid}`

**Get Plan Enrollment Details**

Get the enrollment details for the provided enrollment

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `uuid` | path | string | Yes |  |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

### Events

#### `GET /events`

**List Events**

Get a paginated list of events

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `page` | query | integer | No | page number |
| `limit` | query | integer | No | limit |
| `startsAfter` | query | number | No | Filter by events that start after this timestamp (Unix Seconds) |
| `access` | query | string | No | Some events require an invitation for signup, most invites and all classes are o |
| `order` | query | string | No | sort events by start timestamp |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

#### `GET /events/{id}`

**Get details for an event**

Get details for an event

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `expand` | query |  | No |  |
| `id` | path | string | Yes |  |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

### Invitations

#### `GET /invitations`

**List Invitations**

Get a list of invitations in the current company

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `page` | query | integer | No | page number |
| `limit` | query | integer | No | limit |
| `eventId` | query | string | Yes |  |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

#### `POST /invitations`

**Create Invitations**

Invite a list of customers to an event

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

**Request Body:**

| Field | Type | Description |
|-------|------|-------------|
| `eventId` | string |  |
| `customerIds` | array |  |

---

#### `GET /invitations/{id}`

**Get an invitation**

Get an invitation for an event by its id

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `id` | path | string | Yes | Invitation id |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

#### `DELETE /invitations/{id}`

**Delete an invitation**

Delete an invitation by its id

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `id` | path | string | Yes | Invitation id |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

### Keys

#### `POST /keys`

**Create a new API Key**

Creates a new API key for authenticating requests. Admins in your account can create and view API keys.Consider implementing key rotation policies for enhanced security.

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

**Request Body:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string |  |
| `description` | string |  |
| `expiresAt` | number | expiration unix timestamp in milliseconds |

---

#### `GET /keys`

**List API Keys**

Retrieves a list of all active API keys associated with your account. The response includes metadata such as creation date, last used timestamp, and current status, helping you monitor key usage and manage access.

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `limit` | query | number | No |  |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

#### `GET /keys/{id}`

**Get API Key**

Fetches detailed information about a specific API key and associated metadata

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `id` | path | string | Yes |  |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

#### `DELETE /keys/{id}`

**Delete an API Key**

Immediately invalidates an active API key, preventing any further authentication attempts using this key. This is useful when a key may have been compromised or is no longer needed. This action cannot be undone - a new key must be generated if access is needed again.

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `id` | path | string | Yes |  |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

#### `PATCH /keys/{id}/revoke`

**Revoke an API Key**

Immediately invalidates an active API key, preventing any further authentication attempts using this key. This is useful when a key may have been compromised or is no longer needed. This action cannot be undone - a new key must be generated if access is needed again.

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `id` | path | string | Yes |  |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

### Messages

#### `POST /messages/email/send`

**Send an Email**

Send an email from the PushPress platform. Note that only first party apps can send emails

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

**Request Body:**

| Field | Type | Description |
|-------|------|-------------|
| `customer` | string | Uuid of the customer recipient |
| `subject` | string |  |
| `text` | string | The text email body |
| `html` | string | The HTML email body |
| `from` | string | The email sender name |
| `replyTo` |  | One or more reply-to addresses |
| `type` | string | Optional email type  |

---

#### `POST /messages/notification/send`

**Send Ably Realtime Event**

Send an event to a websocket channel via Ably Realtime. Note that only first party apps can send realtime notifications

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

**Request Body:**

| Field | Type | Description |
|-------|------|-------------|
| `channel` | string | Ably channel to send the event to. This is the name of the channel that the clie |
| `event` | string | event to send |
| `data` |  | Optional metadata to attach to the event |

---

#### `POST /messages/push/send`

**Send Push Notification**

Send a push notification message from the PushPress platform. Note that only first party apps can send push notifications

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

**Request Body:**

| Field | Type | Description |
|-------|------|-------------|
| `customers` | array | customer ids to notify |
| `message` | string | message to send |
| `type` | string | type of message |
| `data` |  | Optional metadata to attach to the message |

---

#### `POST /messages/sms/send`

**Send an SMS**

Send an SMS message from the PushPress platform. Note that only first party apps can send SMS messages

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

**Request Body:**

| Field | Type | Description |
|-------|------|-------------|
| `message` | string | Message body, maximum 160 characters |
| `to` | string | Phone number, e.g. +18005555555 or 555-555-5555 |

---

### Plans

#### `GET /plans/{id}`

**Get Plan details**

Get Plan details

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `id` | path | string | Yes |  |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

### Reservations

#### `GET /reservations`

**List Reservations**

Get a paginated list of reservations for a scheduled calendar event

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `page` | query | integer | No | page number |
| `limit` | query | integer | No | limit |
| `calendarItemId` | query | string | Yes | Unique identifier for the scheduled calendar event |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

#### `GET /reservations/{id}`

**Get Details for a Reservation**

Get details for a reservation by its UUID

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `id` | path | string | Yes | Unique identifier for the reservation |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

### Webhooks

#### `POST /webhooks`

**Create a Webhook**

Create a platform webhook that can be used to listen for events on the pushpress platform at a given URL

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

**Request Body:**

| Field | Type | Description |
|-------|------|-------------|
| `appId` | string | Webhooks for application lifecycle events must be created with an app ID |
| `url` | string | The URL to send the webhook to |
| `eventTypes` |  | Webhooks registration must either apply to a set application events (e.g app.ins |

---

#### `GET /webhooks`

**List Webhooks**

List platform webhooks for the current customer, including the signing secret and event subscriptions

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

#### `GET /webhooks/{uuid}`

**Get Webhook Details**

Get the details for a platform webhook including the signing secret and event subscriptions

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `uuid` | path | string | Yes |  |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

#### `PATCH /webhooks/{uuid}`

**Update a Webhook**

Update the details for a platform webhook including the signing secret an event subscriptions

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `uuid` | path | string | Yes |  |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

**Request Body:**

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | The URL to send the webhook to |
| `eventTypes` | array | The event types to listen for, valid event types include check |

---

#### `DELETE /webhooks/{uuid}`

**Delete a Webhook**

Fully delete a platform webhook. If you want to unsubscribe to a webhook without fully deleting it, use the deactivate method instead

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `uuid` | path | string | Yes |  |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

#### `PATCH /webhooks/{uuid}/activate`

**Activate a Webhook**

Activate a deleted platform webhook

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `uuid` | path | string | Yes |  |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

#### `PATCH /webhooks/{uuid}/deactivate`

**Deactivate a Webhook**

deactivate a platform webhook. If you want to fully delete a webhook use the delete method

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `uuid` | path | string | Yes |  |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

#### `POST /webhooks/{uuid}/rotate-signing-secret`

**Rotate a Webhook Signing Secret**

Rotate a platform webhook's signing secret

**Parameters:**

| Name | In | Type | Required | Description |
|------|-----|------|----------|-------------|
| `uuid` | path | string | Yes |  |
| `company-id` | header | string | No | When using multitenant API keys, specify the company |

---

## Schemas

### ApiKey

Platform API key

| Field | Type | Req | Description |
|-------|------|-----|-------------|
| `keyUuid` | string | ✓ |  |
| `companyId` | string | ✓ |  |
| `name` | string | ✓ |  |
| `description` | string | ✓ |  |
| `createdAt` | number | ✓ |  |
| `lastUsedAt` | number/null |  | Unix timestamp in milliseconds |
| `expiresAt` | number/null |  | Unix timestamp in milliseconds |

### AppInstall

Information about the app

| Field | Type | Req | Description |
|-------|------|-----|-------------|
| `clientUuid` | string | ✓ | The company uuid in which the app is installed |
| `appId` | string | ✓ | The app id |
| `installationId` | string | ✓ | The installation id of the app |

### Appointment

Schema for representing a Regsitration for some scheduled event

| Field | Type | Req | Description |
|-------|------|-----|-------------|
| `id` | string | ✓ | unique identifier for the appointment |
| `type` | object{...} | ✓ |  |
| `companyId` | string | ✓ | unique identifier for the company |
| `isLateCancel` | boolean |  | True when the appointment was canceled late |
| `customerId` | string | ✓ | unique identifier for the customer |
| `startTimestamp` | number | ✓ | Unix timestamp for the start time of the appointment |
| `staffId` | string | ✓ | unique identifier for the staff member, corresponding to a customer with a staff role |

### AppointmentCheckin

Schema for checking in to an appointment, including relevant details such as customer and company information

| Field | Type | Req | Description |
|-------|------|-----|-------------|
| `id` | string | ✓ | Unique identifier for the checkin record |
| `customer` | string | ✓ | UUID of the customer who checked in |
| `company` | string | ✓ | UUID of the company |
| `timestamp` | number | ✓ | Unix timestamp representing the time of checkin |
| `enrollmentId` | string/null |  | UUID of the enrollment record, null if the checkin is not associated with a plan enrollment |
| `name` | string |  | The name or title of the appointment, if available |
| `kind` | string | ✓ | A constant value indicating the type of check-in, which is 'appointment' |
| `appointmentId` | string | ✓ | UUID for the checked in appointment |
| `typeId` | string | ✓ | The UUID representing the type or category of the appointment |
| `staffId` | string | ✓ | unique identifier for the staff member, corresponding to a customer with a staff role |

### Checkin

Checkin for a class, event, appointment or an open facility

One of: `ClassCheckin`, `AppointmentCheckin`, `EventCheckin`, `OpenCheckin`

### Class

Schema for representing a scheduled class

| Field | Type | Req | Description |
|-------|------|-----|-------------|
| `id` | string | ✓ | Unique identifier for the class |
| `coachUuid` | string/null |  | Unique identifier for the coach |
| `assistantCoachUuid` | string/null | ✓ | Unique identifier for the assistant coach, if any |
| `company` | string/null |  | Unique identifier for the client |
| `title` | string/null | ✓ | Title of the calendar event |
| `classTypeName` | string/null |  | Name of the class type |
| `locationUuid` | string/null |  | Unique identifier for the location, if any |
| `location` | object{...} |  | Location information about where the class took place |
| `reservations` | array |  |  |
| `start` | number | ✓ | Start time of the event as a Unix timestamp in seconds |
| `end` | number | ✓ | End time of the event as a Unix timestamp in seconds |

### ClassCheckin

Schema representing a checkin for a class

| Field | Type | Req | Description |
|-------|------|-----|-------------|
| `id` | string | ✓ | Unique identifier for the checkin record |
| `customer` | string | ✓ | UUID of the customer who checked in |
| `company` | string | ✓ | UUID of the company |
| `timestamp` | number | ✓ | Unix timestamp representing the time of checkin |
| `enrollmentId` | string/null |  | UUID of the enrollment record, null if the checkin is not associated with a plan enrollment |
| `name` | string | ✓ | Name of the class that the customer checked into |
| `typeId` | string | ✓ | UUID of the class type |
| `classId` | string | ✓ | UUID of the class |
| `source` | string | ✓ | Source of the checkin provided at checkin time, (e.g kiosk, staff app), will be an empty string when |
| `result` | string | ✓ | Indicates if the customer was permitted to check into the class, for details about any failures, see |
| `failureReason` | string/null |  | Only populated when a checkin fails, a message containing details about why the failure occurred |
| `type` | object{...} | ✓ | Detailed information about the type of the class |
| `kind` | string | ✓ | Indicates that this checkin is for a class |
| `role` | string | ✓ | Role of the customer in the class |

<details><summary>Example</summary>

```json
{
  "id": "chk_12345",
  "name": "My Class",
  "customer": "usr_12345",
  "company": "cli_12345",
  "kind": "class",
  "timestamp": 1672531200000,
  "source": "staff app",
  "role": "attendee",
  "typeId": "cit_12345",
  "classId": "cal_item_12345",
  "result": "success",
  "type": {
    "id": "cit_12345",
    "name": "Group HIIT Training"
  }
}
```
</details>

### Company

Represents an entity with one or more PushPress accounts, such as a gym, martial arts studio, or mermaid swim school

| Field | Type | Req | Description |
|-------|------|-----|-------------|
| `id` | string | ✓ | A unique identifier for the company |
| `name` | string | ✓ | The name of the company |
| `subdomain` | string | ✓ | The subdomain associated with the company |
| `address` | object{...} | ✓ |  |
| `defaultTimezone` | string | ✓ | The default timezone of the company |
| `phone` | string/null |  | The contact phone number of the company |
| `email` | string | ✓ | The contact email address of the company |
| `url` | string |  | The website URL of the company |

### Customer

Schema representing a customer, former customer, or lead served by the company

| Field | Type | Req | Description |
|-------|------|-----|-------------|
| `id` | string | ✓ | A unique identifier assigned to each customer |
| `companyId` | string | ✓ | The unique identifier of the company the customer belongs to |
| `name` | object{...} | ✓ |  |
| `gender` | string/null | ✓ | The customer's gender, null if unknown or other |
| `dob` | string/null | ✓ | The customer's date of birth, null if not provided, formatted YYYY-MM-DD |
| `address` | object{...} | ✓ | Customer address. Defaults to an empty string if no value is set. |
| `assignedToStaffId` | string/null |  | The UUID of the assigned staff member |
| `account` |  | ✓ |  |
| `profileImage` | string/null |  | A URL pointing to the customer's profile image |
| `emergencyContact` | object{...} |  |  |
| `membershipDetails` | object/null | ✓ |  |
| `email` | string | ✓ | The email address of the customer |
| `phone` | string/null |  | The phone number of the customer |
| `role` | string/null |  | The role of the customer within the company (e.g., admin, coach, member) |

### Enrollment

Schema representing a subscription that a customer has to a plan

| Field | Type | Req | Description |
|-------|------|-----|-------------|
| `id` | string | ✓ | Unique identifier for the subscription |
| `customerId` | string | ✓ | Unique identifier for the customer |
| `companyId` | string | ✓ | Unique identifier for the company |
| `planId` | string/null |  | Unique identifier for the plan |
| `billingSchedule` | object{...} | ✓ |  |
| `status` | string | ✓ |  |
| `startDate` | string/null |  | Date format string of start date |
| `endDate` | string/null |  | Date format string of end date e.g. 2022-01-01 |
| `lastCharge` | string/null |  | Date format string of last charge date e.g. 2022-01-01 |
| `nextCharge` | string/null |  | Date format string of next charge date e.g. 2022-01-01 |
| `paidUntil` | string/null |  | Date format string of paid until date e.g. 2022-01-01 |
| `checkinDetails` | object{...} | ✓ |  |
| `entitlements` | array | ✓ |  |

### Event

Schema for representing a scheduled class

| Field | Type | Req | Description |
|-------|------|-----|-------------|
| `id` | string | ✓ | Unique identifier for the event |
| `coachUuid` | string/null |  | Unique identifier for the coach |
| `access` | string | ✓ | an invite_only event restricts registration to people who have been invited |
| `assistantCoachUuid` | string/null | ✓ | Unique identifier for the assistant coach, if any |
| `company` | string/null |  | Unique identifier for the company |
| `title` | string/null | ✓ | Title of the calendar event |
| `locationUuid` | string/null |  | Unique identifier for the location, if any |
| `location` | object{...} |  | Location information about where the event took place |
| `reservations` | array |  |  |
| `start` | number | ✓ | Start time of the event as a Unix timestamp in seconds |
| `end` | number | ✓ | End time of the event as a Unix timestamp in seconds |
| `isAllDay` | boolean | ✓ | Whether the event is an all-day event |

### EventCheckin

Details of a customer's check-in for an event

| Field | Type | Req | Description |
|-------|------|-----|-------------|
| `id` | string | ✓ | Unique identifier for the checkin record |
| `customer` | string | ✓ | UUID of the customer who checked in |
| `company` | string | ✓ | UUID of the company |
| `timestamp` | number | ✓ | Unix timestamp representing the time of checkin |
| `enrollmentId` | string/null |  | UUID of the enrollment record, null if the checkin is not associated with a plan enrollment |
| `name` | string | ✓ | Name of the event being checked into |
| `kind` | string | ✓ | Type of check-in, which is always 'event' |
| `role` | string | ✓ | Role of the customer at the event |
| `typeId` | string | ✓ | UUID of the event type |
| `eventId` | string | ✓ | UUID of the event |
| `type` | object{...} | ✓ | Information about the type of the event |

### Invitation

Schema for invitations

| Field | Type | Req | Description |
|-------|------|-----|-------------|
| `id` | string | ✓ |  |
| `eventId` | string | ✓ |  |
| `customerId` | string | ✓ |  |

### OpenCheckin

Schema representing an open facility checkin

| Field | Type | Req | Description |
|-------|------|-----|-------------|
| `id` | string | ✓ | Unique identifier for the checkin record |
| `customer` | string | ✓ | UUID of the customer who checked in |
| `company` | string | ✓ | UUID of the company |
| `timestamp` | number | ✓ | Unix timestamp representing the time of checkin |
| `enrollmentId` | string/null |  | UUID of the enrollment record, null if the checkin is not associated with a plan enrollment |
| `kind` | string | ✓ | Indicates that this checkin is for an open facility |

### Plan

Schema representing a plan that a customer can purchase for access to a set of products/services

| Field | Type | Req | Description |
|-------|------|-----|-------------|
| `id` | string | ✓ | Unique identifier for the plan |
| `name` | string | ✓ | Display name for the plan |
| `companyId` | string | ✓ | unique identifier for the company |
| `recurrenceDetails` |  | ✓ |  |
| `policies` | object{...} | ✓ |  |
| `category` | object{...} | ✓ |  |

### Reservation

Schema for representing a reservation for a class or event

| Field | Type | Req | Description |
|-------|------|-----|-------------|
| `id` | string | ✓ | Unique identifier for the reservation |
| `reservedId` | string | ✓ | Unique identifier for the scheduled calendar event the registration is for |
| `customerId` | string/null |  | Unique identifier for the customer |
| `companyId` | string/null |  | Unique identifier for the company |
| `registrationTimestamp` | number | ✓ | Unix timestamp of when the registration was made |
| `status` | string | ✓ | Current status of the reservation |
| `checkin` | Checkin |  |  |
| `templateId` | string/null |  | Unique identifier for the recurring reservation template |

## Webhook Events

Payload structure:
```json
{
  "event": "<event_type>",
  "created": 1672531200000,
  "data": { "...entity..." }
}
```

**Note:** Company ID is inside `data.company` or `data.companyId`, NOT at the top level.

| Event Type | Data Schema |
|-----------|-------------|
| `App Installed` | `AppInstall` |
| `App Uninstalled` | `AppInstall` |
| `Appointment Canceled` | `Appointment` |
| `Appointment No Show` | `Appointment` |
| `Appointment Rescheduled` | `Appointment` |
| `Appointment Scheduled` | `Appointment` |
| `Checkin Created` | `Checkin` |
| `Checkin Deleted` | `` |
| `Checkin Failed` | `Checkin` |
| `Checkin Updated` | `Checkin` |
| `Class Canceled` | `Class` |
| `Customer Created` | `Customer` |
| `Customer Deleted` | `` |
| `Customer Details Changed` | `Customer` |
| `Customer Status Changed` | `Customer` |
| `Enrollment Created` | `Enrollment` |
| `Enrollment Status Changed` | `Enrollment` |
| `Enrollment Status Deleted` | `` |
| `Reservation Canceled` | `Reservation` |
| `Reservation Created` | `Reservation` |
| `Reservation Waitlisted` | `Reservation` |

## GymAgents Integration Notes

### Required Headers
```
API-KEY: <key>
company-id: <pushpress_company_id>
Content-Type: application/json
```

### Webhook Company ID Extraction

Real PushPress webhooks have company ID inside `data`:
- `data.company` — checkins, classes
- `data.companyId` — customers, enrollments, appointments

The webhook handler must check `payload.data.companyId || payload.data.company || payload.companyId`.
