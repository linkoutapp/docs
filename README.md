# Linkout documentation

Setup, API, and operating guides for [linkout-scraper](https://github.com/linkoutapp/linkout-scraper). The site targets [docs.linkout.space](https://docs.linkout.space).

## Development

Use Node.js 22 or newer and install the locked dependencies:

```sh
npm ci
npm start
```

For a local production preview, run `npm run build`, then `npm run serve`.

## Checks

| Command | Purpose |
| --- | --- |
| `npm run check:local` | Checks the working-tree diff, types, tests, and production build |
| `npm run check:source` | Checks live source contracts against the public scraper repository |
| `npm run check:deps` | Checks the pinned dependency tree and production audit |
| `npm run check:deploy` | Checks the live deployment and TLS certificate |
| `npm run check` | Runs local, dependency, and live source checks |

The live source contract checker fetches files from the public `linkoutapp/linkout-scraper` repository's `main` branch. It retries transient network, timeout, rate-limit, and server failures. A persistent fetch failure or source drift fails the check.

Deployment health is a separate operational check. Run deployment health manually with `npm run check:deploy`; it is not part of the normal repository gate.

## Contributions and operations

Changes are accepted only through pull requests. Run `npm run check` before opening or updating one, and explain any known failure in the pull request.

The deployment target is a dedicated Vercel project serving `docs.linkout.space`. Repository changes do not mutate that project or DNS.

## Dependency advisory still open

The current Docusaurus/SVGR dependency tree includes `deepmerge@4.3.1`. GHSA-gcqx-w48m-w2h4 has no patched upstream release. Five low-severity npm audit records refer to this one advisory and its parent packages. `npm run check:deps` intentionally continues to fail until the dependency can be patched or removed; its audit threshold has not been relaxed. Do not feed untrusted configuration objects into this build pipeline.
