# Security

BYOND holds Emirates ID numbers, IBANs, salaries, and GPS coordinates captured
at clock-in. We would rather hear about a problem than not.

## Reporting a vulnerability

Email **security@byondhr.com** with enough detail to reproduce it. Please do
not open a public issue for a security report.

What helps: the affected endpoint, table or screen; what you did; what happened
that should not have. A proof of concept against your own workspace is welcome.
A proof of concept against someone else's data is not.

We aim to acknowledge within three working days.

## Scope

In scope: the web app, the mobile app, the Supabase database and its RLS
policies, and the CI configuration in this repository.

Out of scope: reports generated solely by automated scanners with no
demonstrated impact, missing headers with no exploit path, and anything
requiring physical access to an unlocked device.

## Please do not

- Access, modify or delete data belonging to anyone other than yourself
- Run denial-of-service or load tests against production
- Use social engineering against BYOND staff or customers

Acting in good faith within this policy, we will not pursue action against you.

## Repository confidentiality

This repository is private and must stay private. Beyond the source itself, it
contains material that is useful to an attacker:

- `docs/database-security-snapshot.md` — RLS policy and function inventory,
  including which functions are `SECURITY DEFINER` and what they expose
- `supabase/migrations-applied/` — the complete schema
- Commit messages and pull request bodies describing weaknesses that were found
  and how they were demonstrated

None of this contains credentials, and none of it should ever be published.
Before making any part of this repository public, that material has to be
removed from the working tree **and from history** — a private note in a public
repository's git history is a public note.
