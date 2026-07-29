# Linkout documentation

This repository contains the public documentation site for Linkout and
`linkout-scraper`, published at [docs.linkout.space](https://docs.linkout.space).

## Development

Use Node.js 22 or newer and install the locked dependencies:

```sh
npm ci
```

Start the local development server with `npm start`. To test the production
site locally, run `npm run build` followed by `npm run serve`.

## Checks

- `npm run check:local` checks the working-tree diff, types, tests, and
  production build.
- `npm run check:source` checks live source contracts against the public
  `linkout-scraper` repository.
- `npm run check:deps` checks the patched dependency tree and production audit.
- `npm run check:deploy` checks the live deployment and its TLS certificate.
- `npm run check` is the complete repository gate: local, dependency, and live
  source checks. Deployment health remains a separate operational check.

The live source contract check fetches public files from the public
`linkoutapp/linkout-scraper` repository's `main` branch. It retries transient
network, timeout, rate-limit, and server failures; a persistent fetch failure or
contract drift fails the check.

## Contributions and operations

Contributions are accepted only through pull requests. CI runs for pull requests
and updates to `main`.

The documentation targets a dedicated Vercel project serving
`docs.linkout.space`. Repository changes do not mutate that project or DNS.
Maintainers can run the manual **Deployment health** GitHub Actions workflow to
check the deployed endpoints and TLS certificate outside the normal repository
gate.
