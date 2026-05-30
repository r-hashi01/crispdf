# Security Policy

## Supported Versions

Security fixes target the latest published `0.0.x` release of `crispdf`.

## Reporting a Vulnerability

Please report security issues privately by opening a GitHub security advisory
for the repository, or by contacting the maintainer directly if advisories are
not available.

Do not open a public issue for a vulnerability before it has been triaged.

## Scope

Vellum runs in the browser and processes DOM/CSS/font/image data already
available to the page. Relevant reports include:

- PDF output that can execute unintended actions in readers.
- Font parsing or embedding behavior that creates malformed or unsafe PDFs.
- Cross-origin data leakage through stylesheet/font/image handling.
- Dependency vulnerabilities that affect the browser runtime.
