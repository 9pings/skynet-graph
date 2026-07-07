# Contributing

Thanks for your interest! This repo is the **public sandbox + engine** (AGPL-3.0-or-later). The most
valuable contributions are **grammars** and **sandbox UX**:

- **Share a concept grammar** — export your corpus as `.sgc` from the Studio and open a PR adding it
  under `concepts/<your-set>/` (or attach it to an issue). It must pass `sg validate <dir>` and load in
  the Studio. Domain grammars (logistics, clinical-style, legal, games…) make the gallery.
- **Bugs & fixes** — engine, Studio, CLI. Add/adjust a test (`npm test` must stay green; the paper
  artifacts under `artifact/` must keep replaying bit-for-bit — do not touch their memos).
- **Docs** — the sandbox tour, grammar-authoring guides, translations.

## The rules

1. **CLA**: by submitting a contribution you agree to license it to the project owner under terms that
   permit dual licensing (AGPL + commercial). Sign-off = add `Signed-off-by: Name <email>` to your
   commits (DCO-style). First PR: state "I agree to the CLA" in the description.
2. **No product code**: the managed appliance / catalog service / scaling layer are commercial and out
   of scope here — PRs re-implementing them will be declined (see README « Managed & Pro »).
3. **Style**: match the surrounding code (tabs, JSDoc headers, guard-first). Tests with `node:test`.
4. **Provenance**: never commit third-party data whose license you can't state; grammars must be your
   own or clearly licensed.
