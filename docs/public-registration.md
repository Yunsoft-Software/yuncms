# Public Registration

YunCMS public registration is disabled by default and is controlled from Studio settings.

## Studio configuration

Open **Settings → Branding & Appearance → Public Registration** as an Administrator.

1. Create or choose a normal authenticated role in **Roles & Permissions**.
2. Select that role as the registered-user role.
3. Optionally enable **Require email verification**.
4. Enable **Allow public registration** and save.

Administrator roles and the special unauthenticated Public role cannot be selected. The API validates the configured role again for every registration, so a stale or invalid role fails closed.

Email verification is disabled by default. When enabled, SMTP must be configured. New public registrations remain unverified, receive a YunCMS email-verification link and cannot use local email/password sign-in until verification succeeds. When disabled, public registrations are marked verified immediately.

The public Studio settings response exposes only the registration-enabled and email-verification-required booleans needed by the login screen. The configured role id remains available only from the Administrator settings endpoint.

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

The endpoint accepts only account credentials. Role and status are server-controlled. New users are active and receive exactly the configured registered-user role.

A successful response includes `email_verification_required`. If it is `true`, YunCMS sends the verification message before returning success. When SMTP is unavailable, registration fails before creating an account. If delivery fails after creation, YunCMS attempts to remove the partial account and reports cleanup failure without exposing credentials or tokens.

When verification is required, unauthenticated clients may request another message:

```http
POST /auth/email-verification/request
Content-Type: application/json

{
  "email": "person@example.com"
}
```

The resend endpoint remains available for eligible unverified users even if public registration is later disabled. It is rate-limited and returns the same accepted shape for unknown, verified and unverified addresses. A replacement token invalidates older unused verification tokens.

The registration endpoint is also rate-limited. Registration fails closed when it is disabled, no normal role is configured, or the selected role becomes missing, Administrator or Public.

## Upgrades

Existing installations must run the normal `yuncms update` or `yuncms bootstrap` flow so the required registration settings are added with both registration and mandatory email verification disabled by default.

## Related guides

- [Authentication](auth.md)
- [Using Studio](studio.md)
- [Configuration](configuration.md)
- [Roles and permissions](permissions.md)
