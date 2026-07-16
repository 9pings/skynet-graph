# analogical

Analogical reasoning as a **Tier-0** [skynet-graph](../../README.md) plugin — pure grammar, zero JS —
built on [reason-kernel](../reason-kernel/README.md) (this is the client that grew the kernel's
generic **`Relation`** node). A mapping is a `maps-to` Relation between a **source** case and a
**target**; the **transfer license** (`Grounded`) casts only while the source is live and resolved,
tallies on the kernel ledger, and — the point — is **defeasible**: retract the source (an erratum, a
drifted fact) and the license **uncasts in cascade**, the retraction appended to the audit trail. The
same JTMS machinery the C9 witness gate runs on, reused verbatim.

| Concept | Role | Kernel piece |
|---|---|---|
| `Mapping` | a `maps-to` Relation (any other relKind never casts — the enum routes) | `require Relation` (the new brick) |
| `Mapping/Grounded` | the transfer license: `$from:live && $from:resolved` (hop-watched) + audit tally + retraction cleaner | `Ledger::tally/untally grounded` |

Seed shape:

```js
// { _id:'src', isThought:true, live:true, resolved:true, text:'the solved source case' }
// { _id:'tgt', isThought:true, text:'the open target' }
// { _id:'m1',  isRelation:true, relKind:'maps-to', from:'src', to:'tgt' }
// { _id:'ledger', grounded: [] }   — the host reads `Grounded` as "the transfer may be used"
```

The host finds the analogues and writes the transferred content; this plugin is the deposited
admission + maintenance. Proven by `tests/unit/analogical.test.js` (0-model: grounding, THE
retraction cascade, negative controls). See [`doc/plugins.md`](../../doc/plugins.md).
