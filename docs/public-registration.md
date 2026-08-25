# Public Registration

YunCMS public registration is disabled by default and is controlled from Studio settings.

## Studio configuration

Open **Settings → Branding & Appearance → Public Registration** as an Administrator.

1. Create or choose a normal authenticated role in **Roles & Permissions**.
2. Select that role as the registered-user role.
3. Optionally enable **Require email verification**.
4. Enable **Allow public registration** and save.

Administrator roles and the special unauthenticated Public role cannot be selected. The API validates the configured role again for every registration, so a stale or invalid role fails closed.

Email verification is disabled by default to preserve the existing registration behavior. When it is enabled, SMTP mail delivery must be configured. New public registrations are created with `email_verified_at = NULL`, receive the existing YunCMS email-verification token by email, and cannot use local email/password sign-in until that token is confirmed. When the option is disabled, public registrations are marked verified immediately as before.

The public Studio settings response exposes `public_registration_enabled` and `public_registration_require_email_verification` so the login screen can decide whether to show sign-up and verification/resend UI. The configured role id remains available only from the administrator settings endpoint.

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

A successful registration response also includes `email_verification_required`. If it is `true`, YunCMS sends the verification email before returning success. SMTP must be configured before such a registration can create an account. If verification mail delivery fails during initial registration, YunCMS attempts to remove the just-created account instead of leaving a knowingly unusable partial registration.

When verification is required, unauthenticated clients may safely request another verification email:

```http
POST /auth/email-verification/request
Content-Type: application/json

{
  "email": "person@example.com"
}
```

The resend endpoint uses the existing auth action rate limiter and returns the same accepted response whether or not the email maps to an eligible unverified account, avoiding account enumeration. Issuing the replacement token invalidates older unused verification tokens through the existing auth-token lifecycle.

The registration endpoint also uses the existing authentication action rate limiter. When registration is disabled, no role is configured, the configured role is missing, or the configured role becomes Administrator/Public, registration is rejected.

## Persistence

Migration `0018-public-registration-settings` adds:

- `public_registration_enabled` — disabled by default;
- `public_registration_role` — nullable role reference with `ON DELETE SET NULL`.

Migration `0019-public-registration-email-verification` adds:

- `public_registration_require_email_verification` — disabled by default.

Existing installations must run the normal YunCMS bootstrap/migration flow before starting code that requires these migrations.
