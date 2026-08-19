# Third-party notices

OpenClaw Desktop is MIT-licensed. Its dependencies remain covered by their own licenses; the project license does not replace those terms.

The direct runtime dependency set was reviewed on 2026-08-19. It uses permissive licenses:

| License | Direct runtime packages |
| --- | --- |
| MIT | electron-updater, KaTeX, Mermaid, React, React DOM, React Markdown, rehype-katex, remark-gfm, remark-math, ws |
| BSD-3-Clause | highlight.js |
| ISC | lucide-react |

Build and test tools use MIT, Apache-2.0, BSD, and ISC-compatible licenses. `sharp` is build-time only; its prebuilt libvips distribution carries separate LGPL-related terms documented by that package and is not shipped as an OpenClaw Desktop runtime dependency.

Transitive packages retain their copyright and license notices in the installed dependency tree and packaged application where applicable. Run `npm query "*" --json` after dependency changes to re-audit the resolved license metadata.
