# Public Registration

YunCMS public registration is disabled by default and is controlled from Studio settings.

## Studio configuration

Open **Settings → Branding & Appearance → Public Registration** as an Administrator.

1. Create or choose a normal authenticated role in **Roles & Permissions**.
2. Select that role as the registered-user role.
3. Enable **Allow public registration** and save.

Administrator roles and the special unauthenticated Public role cannot be selected. The API validates the configured role again for every registration, so a stale or invalid role fails closed.

The public Studio settings response exposes only `public_registration_enabled` so the login screen can decide whether to show the sign-up flow. The configured role id is available only from the administrator settings endpoint.

## API

When enabled, unauthenticated clients may call:

```http
POST /auth/register
Content-Type: application/json

{
  "email": "person@example.com",
  "password": "a-strong-password"
}
```

The endpoint accepts only the account credentials. Role and status are server-controlled. New users are created as active users with the configured registered-user role.

The endpoint uses the existing authentication action rate limiter. When registration is disabled, no role is configured, the configured role is missing, or the configured role becomes Administrator/Public, registration is rejected.

## Persistence

Migration `0018-public-registration-settings` adds these singleton Studio settings:

- `public_registration_enabled` — disabled by default;
- `public_registration_role` — nullable role reference with `ON DELETE SET NULL`.

Existing installations must run the normal YunCMS bootstrap/migration flow before starting code that requires this migration.
