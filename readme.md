<h1 align="center">skynet graph</h1>

( not a ready to run instance — a rule-driven knowledge-graph **library** to embed )

A host app embeds the engine, supplies concept definitions (the experts) and provider
functions, and drives the graph through mutations; concepts cast/uncast automatically as
the graph stabilizes to a fixpoint.

**Public API reference: [`doc/API.md`](doc/API.md).** Concept-schema & DSL spec: `doc/doc.md`.
Quick start: `node _lab/run-basic.js`.