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

Contributions are accepted only through pull requests. Run `npm run check`
before opening or updating one.

The documentation targets a dedicated Vercel project serving
`docs.linkout.space`. Repository changes do not mutate that project or DNS.
Run deployment health manually with `npm run check:deploy` to check the deployed
endpoints and TLS certificate outside the normal repository gate.

## AppSumo setup session

Linkout’s $29 offer includes one 30-minute session with Sai to set up `linkout-scraper` on your Mac. The code is free under the MIT license. The deal is in AppSumo review and is not available to buy yet.

[AppSumo deal status](https://www.linkout.space/appsumo.html)


## Dependency advisory still open

The current Docusaurus/SVGR dependency tree includes `deepmerge@4.3.1`. GHSA-gcqx-w48m-w2h4 has no patched upstream release. Five low-severity npm audit records refer to this one advisory and its parent packages. `npm run check:deps` intentionally continues to fail until the dependency can be patched or removed; its audit threshold has not been relaxed. Do not feed untrusted configuration objects into this build pipeline.
