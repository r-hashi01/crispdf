# Contributing

Thanks for considering a contribution to Vellum.

## Development Setup

```sh
pnpm install
pnpm lint
pnpm --filter @astlide/crispdf typecheck
pnpm --filter @astlide/crispdf test
pnpm --filter @astlide/crispdf build
```

Use `pnpm example` for manual browser checks.

## Pull Requests

- Keep changes focused and explain the behavior change.
- Add or update tests for renderer behavior, font handling, or PDF output.
- Run lint, typecheck, tests, and build before opening a PR.
- Do not commit generated PDFs or screenshots unless they are explicit fixtures.

## Compatibility Expectations

Vellum cares about PDF reader compatibility, especially Adobe Acrobat/Reader.
Font changes should preserve these invariants:

- Do not embed raw WOFF/WOFF2 containers.
- Embedded web fonts must be SFNT/OTF/TTF bytes.
- CID fonts should keep `/ToUnicode` maps for copy/paste.
- Missing selectable text should produce a warning instead of silent corruption.

## Releases

The published package is `@astlide/crispdf`. **It is published only by CI** — never run
`npm publish` / `pnpm publish` locally.

To cut a release:

1. Bump the version in `packages/core/package.json` (the exported `VERSION` is
   injected from it — no other file to edit).
2. Update `CHANGELOG.md`.
3. Commit, then tag and push:
   ```sh
   git tag v0.0.1
   git push origin v0.0.1
   ```

The `release.yml` workflow verifies the tag matches the package version, runs
the full quality gate, and builds and packs the package in a job without
publishing rights. The run's summary shows the tarball's sha256 and contents.
Publishing waits for a maintainer's approval (Actions → the run → *Review
deployments* → `npm-publish`), then publishes that exact tarball with
provenance. The publishing job runs none of the repository's code.

No npm token is stored: the package trusts this workflow through npm Trusted
Publishing, in the `npm-publish` environment only (one-time setup):

```sh
npm trust github @astlide/crispdf --file release.yml --repo r-hashi01/crispdf --env npm-publish --allow-publish
```
