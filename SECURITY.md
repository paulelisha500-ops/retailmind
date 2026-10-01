# Security

## Reporting a vulnerability

Please report it privately through GitHub: **Security -> Report a vulnerability** on this repository (a private
security advisory). Do not open a public issue for a security problem. You can expect an acknowledgement within a
few days and a fix or a written assessment within a couple of weeks.

## What is in scope

- The browser edition's in-page backend: authentication, session tokens, role and responsibility checks, input
  validation, and what it stores in the browser.
- The server edition (`backend/`): the FastAPI application, its authentication and its database access.
- The build and deployment scripts and workflows.

## How it is protected

- Passwords are hashed with PBKDF2-SHA256 (150,000 rounds, per-account salt) in the browser edition and bcrypt on
  the server; sessions are signed JWTs; failed sign-ins are rate limited per email and per client.
- Every route checks the caller's role and responsibility before it reads or validates anything else.
- The built-in workspace accounts and their shared password exist so the app can be tried without sign-up. In the
  browser edition they live only in the visitor's own browser; for a server deployment, change or remove them.
- CI runs CodeQL on every push and weekly, and Dependabot proposes dependency updates.

The browser edition keeps its data in the visitor's browser and sends nothing anywhere; there is no server to attack
and no shared data to leak.
