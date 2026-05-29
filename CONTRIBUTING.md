# Contributing

Thanks for considering a contribution to Vellum.

## Development Setup

```sh
pnpm install
pnpm lint
pnpm --filter @vellum/core typecheck
pnpm --filter @vellum/core test
pnpm --filter @vellum/core build
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

The published package is `@vellum/core`.
