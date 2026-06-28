/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * checkpoint-store — LAYER A of the durable executor (the conception's "execute" half). A THIN durable
 * substrate behind the `CheckpointStore` interface (study `doc/WIP/studies/2026-06-28-rocinante-convergence.md`
 * §5). It holds three things and NOTHING domain-specific:
 *
 *   · the durable MARKING   — tokens(runId, recordId, placeId, status, payload, attempts, leaseUntil): each
 *                             case = a token walked through a workflow-net; its position is durable (C2). >1
 *                             token/record at a fan-out. This generalizes rocinante's entering/processing/
 *                             leaving (one author, n8tz) to named "places".
 *   · the content-addressed MEMO — memo(key=FactsDigest, output): a step replays safely keyed on the canonical
 *                             input digest, NOT positionally (C5 — skynet's K1 barrier; the durable sibling of
 *                             `lib/providers/cache.js`).
 *   · the createdRefs ROLLBACK set — undo a crashed step's partial external effects on resume (rocinante's
 *                             `_createdRefs` orphan-scan, generalized).
 *
 * It is NOT the skynet engine and holds NO belief: it is the durable plumbing UNDER the belief-view (the B4
 * line). Layer B (the token-flow interpreter) walks records through a compiled net VIA this interface; the
 * skynet-native typed routing / JTMS-at-merge live there, not here.
 *
 * Two backends, ONE contract (`tests/_checkpoint-suite.js`): `createMemoryCheckpointStore` (zero-dep, the
 * reference — pure, runs in the unit suite) and `createSqliteCheckpointStore` (the durable default — one file
 * via the built-in `node:sqlite`, lazy-required so the experimental module loads only on opt-in). Both are
 * pluggable to pg-boss/Postgres or BullMQ/Redis at scale behind the same interface.
 *
 * Crash-safety has two paths that converge on "in-flight → ready, undo partial effects":
 *   · LEASE EXPIRY  — automatic, per-token, online: a worker dies, its lease lapses, `claim` re-offers it.
 *   · rollbackInflight(runId) — explicit, on process boot: reset ALL leased tokens at once + return their
 *                               createdRefs for the host to undo (the orphan-scan).
 *
 * `now` is injected (default `Date.now`) so lease-expiry is deterministically testable.
 *
 * STATUSES: ready (claimable) · leased (held, claimable iff lease expired) · done (reached a sink) ·
 *           failed (dead-lettered) · consumed (fired a fan-out transition — kept for the parentId audit trail).
 */

const READY = 'ready', LEASED = 'leased', DONE = 'done', FAILED = 'failed', CONSUMED = 'consumed';

function clone( x ) { return x == null ? x : JSON.parse(JSON.stringify(x)); }

// shape a stored row into the plain token returned to callers (backend-agnostic)
function viewToken( row ) {
	const t = {
		id: row.id, runId: row.runId, recordId: row.recordId, placeId: row.placeId,
		status: row.status, payload: clone(row.payload), attempts: row.attempts, leaseUntil: row.leaseUntil,
	};
	if ( row.parentId != null ) t.parentId = row.parentId;
	if ( row.reason != null ) t.reason = row.reason;
	if ( row.leaseId != null ) t.leaseId = row.leaseId;          // the FENCING token (Kleppmann) — see holds()
	return t;
}

// a writer (move/fail/track) may only mutate a token it currently HOLDS: the row must still be leased AND the
// caller's fencing token must match the row's current lease. This rejects a zombie worker whose lease lapsed
// and was re-claimed by another worker (same token id, bumped leaseId) — no marking corruption.
function holds( row, token ) {
	return !!row && row.status === LEASED && row.leaseId != null && row.leaseId === (token && token.leaseId);
}

// is a row claimable now? ready, or a leased row whose lease has lapsed (the worker is assumed crashed).
function isClaimable( row, now ) {
	return row.status === READY || (row.status === LEASED && (row.leaseUntil == null || row.leaseUntil <= now));
}

// ===========================================================================================================
// MEMORY reference impl — the zero-dep contract reference. Synchronous ⇒ each method is atomic by construction.
// ===========================================================================================================

function createMemoryCheckpointStore( opts ) {
	opts = opts || {};
	const now = opts.now || Date.now;
	const defaults = { startPlace: opts.startPlace || 'start', failPlace: opts.failPlace || 'failed' };

	const runs = new Map();             // runId -> { start, sinks:Set, fail }
	const rows = new Map();             // tokenId -> row
	const byRun = new Map();            // runId -> Set<tokenId>  (claim/marking locality)
	const memo = new Map();             // key -> output
	let seq = 0, leaseSeq = 0;
	const nextId = () => 't' + (++seq);

	function runOf( runId ) {
		let r = runs.get(runId);
		if ( !r ) { r = { start: defaults.startPlace, sinks: new Set(), fail: defaults.failPlace }; runs.set(runId, r); byRun.set(runId, new Set()); }
		return r;
	}
	function rowsOf( runId ) {
		const out = [], ids = byRun.get(runId);
		if ( ids ) for ( const id of ids ) out.push(rows.get(id));
		return out;
	}
	function add( row ) { rows.set(row.id, row); byRun.get(row.runId).add(row.id); return row; }

	return {
		ensureRun( runId, def ) {
			def = def || {};
			const r = runOf(runId);
			if ( def.start ) r.start = def.start;
			if ( def.fail ) r.fail = def.fail;
			if ( def.sinks ) r.sinks = new Set(def.sinks);
			r.def = clone(def);
			return this;
		},

		inject( runId, records ) {
			const r = runOf(runId);
			return (records || []).map(( rec ) => {
				const rid = rec && (rec.recordId != null ? rec.recordId : rec.id);
				const recordId = rid == null ? null : String(rid);   // an opaque STRING handle (consistent across backends)
				const payload = rec && rec.payload !== undefined ? rec.payload : rec;
				return viewToken(add({ id: nextId(), runId, recordId, placeId: r.start, status: READY,
					payload: clone(payload), attempts: 0, leaseUntil: null, leaseId: null, parentId: null, created: [], reason: null }));
			});
		},

		claim( runId, o ) {
			o = o || {};
			const lease = o.lease || 30000, limit = o.limit || 1, maxAttempts = o.maxAttempts || Infinity;
			const t = now(), out = [];
			const ids = byRun.get(runId);
			if ( !ids ) return out;
			for ( const id of ids ) {                              // insertion order ⇒ FIFO (no priority; v0)
				if ( out.length >= limit ) break;
				const row = rows.get(id);
				if ( !isClaimable(row, t) ) continue;
				if ( row.attempts >= maxAttempts ) {               // poison token → dead-letter, don't re-lease
					row.status = FAILED; row.placeId = runOf(runId).fail; row.reason = 'max-attempts'; row.leaseUntil = null; row.leaseId = null;
					continue;
				}
				row.status = LEASED; row.leaseUntil = t + lease; row.attempts += 1; row.leaseId = ++leaseSeq;
				out.push(viewToken(row));
			}
			return out;
		},

		move( token, toPlace, o ) {
			o = o || {};
			const row = rows.get(token && token.id);
			if ( !holds(row, token) ) return null;                 // stale / re-claimed / unknown → reject (no corruption)
			const r = runOf(row.runId);
			if ( o.created ) row.created = (row.created || []).concat(o.created);
			if ( o.payload ) row.payload = Object.assign({}, row.payload, o.payload);

			if ( Array.isArray(toPlace) ) {                        // FAN-OUT 1->N: consume the source, spawn children
				row.status = CONSUMED; row.leaseUntil = null; row.leaseId = null;
				const pl = o.payloads;                             // optional per-child payloads (the map elem case); else clone the parent
				return toPlace.map(( place, i ) => viewToken(add({ id: nextId(), runId: row.runId, recordId: row.recordId,
					placeId: place, status: r.sinks.has(place) ? DONE : READY, payload: clone(pl ? pl[i] : row.payload),
					attempts: 0, leaseUntil: null, leaseId: null, parentId: row.id, created: [], reason: null })));
			}
			row.placeId = toPlace;                                 // 1->1: relabel (identity walks the net)
			row.status = r.sinks.has(toPlace) ? DONE : READY;
			row.leaseUntil = null; row.leaseId = null;
			return viewToken(row);
		},

		fail( token, reason ) {
			const row = rows.get(token && token.id);
			if ( !holds(row, token) ) return null;                 // only the lease holder may dead-letter
			row.status = FAILED; row.placeId = runOf(row.runId).fail; row.reason = reason == null ? null : String(reason);
			row.leaseUntil = null; row.leaseId = null;
			return viewToken(row);
		},

		track( token, refs ) {
			const row = rows.get(token && token.id);
			if ( holds(row, token) && refs ) row.created = (row.created || []).concat(refs);
			return this;
		},

		memoGet( key ) { return memo.has(key) ? clone(memo.get(key)) : undefined; },
		memoSet( key, output ) { memo.set(key, clone(output)); return this; },

		rollbackInflight( runId ) {
			const reset = [], created = [];
			for ( const row of rowsOf(runId) ) {
				if ( row.status !== LEASED ) continue;             // only IN-FLIGHT (mid-step crash); done/failed/consumed untouched
				if ( row.created && row.created.length ) created.push.apply(created, row.created);
				row.created = []; row.status = READY; row.leaseUntil = null; row.leaseId = null;  // fence out the crashed holder
				reset.push(row.id);
			}
			return { reset, created };
		},

		marking( runId ) {
			const m = {};
			for ( const row of rowsOf(runId) ) (m[row.placeId] = m[row.placeId] || []).push(viewToken(row));
			return m;
		},

		stats( runId ) {
			const s = { ready: 0, leased: 0, done: 0, failed: 0, consumed: 0, total: 0 };
			for ( const row of rowsOf(runId) ) { s[row.status] = (s[row.status] || 0) + 1; s.total++; }
			return s;
		},

		close() {},
	};
}

// ===========================================================================================================
// SQLite impl — the DURABLE DEFAULT. One file via the built-in `node:sqlite` (Node 22+; lazy-required so the
// experimental module + its warning load ONLY when a host opts into durability). Mirrors the memory contract
// row-for-row; the marking + content-memo + a lease/claim queue all live in the one transactional file (best
// C6: zero server). Pluggable to pg-boss/Postgres or BullMQ/Redis at scale behind this same interface.
// ===========================================================================================================

const DDL = [
	'CREATE TABLE IF NOT EXISTS runs (runId TEXT PRIMARY KEY, def TEXT, startPlace TEXT, failPlace TEXT, sinks TEXT)',
	'CREATE TABLE IF NOT EXISTS tokens (' +
		'id INTEGER PRIMARY KEY AUTOINCREMENT, runId TEXT, recordId TEXT, placeId TEXT, status TEXT, ' +
		'payload TEXT, attempts INTEGER, leaseUntil INTEGER, leaseId INTEGER, parentId TEXT, created TEXT, reason TEXT)',
	'CREATE INDEX IF NOT EXISTS tokens_run_status ON tokens(runId, status)',
	'CREATE TABLE IF NOT EXISTS memo (key TEXT PRIMARY KEY, output TEXT)',
	'CREATE TABLE IF NOT EXISTS seqs (name TEXT PRIMARY KEY, val INTEGER)',
].join(';');

// a DB row (JSON columns are strings) → the canonical row shape `viewToken`/`holds`/`isClaimable` expect.
function parseRow( r ) {
	if ( !r ) return null;
	return {
		id: String(r.id), runId: r.runId, recordId: r.recordId, placeId: r.placeId, status: r.status,
		payload: r.payload == null ? null : JSON.parse(r.payload), attempts: r.attempts,
		leaseUntil: r.leaseUntil == null ? null : r.leaseUntil, leaseId: r.leaseId == null ? null : r.leaseId,
		parentId: r.parentId == null ? null : r.parentId, created: r.created == null ? [] : JSON.parse(r.created),
		reason: r.reason == null ? null : r.reason,
	};
}

function createSqliteCheckpointStore( opts ) {
	opts = opts || {};
	const now = opts.now || Date.now;
	const file = opts.file || ':memory:';
	const startDefault = opts.startPlace || 'start', failDefault = opts.failPlace || 'failed';

	const { DatabaseSync } = require('node:sqlite');                // lazy: loads the experimental module on opt-in only
	const db = new DatabaseSync(file);
	db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON');
	db.exec(DDL);
	db.exec("INSERT OR IGNORE INTO seqs(name, val) VALUES ('lease', 0)");

	const q = {
		getRun: db.prepare('SELECT * FROM runs WHERE runId = ?'),
		putRun: db.prepare('INSERT INTO runs(runId, def, startPlace, failPlace, sinks) VALUES (?,?,?,?,?) ' +
			'ON CONFLICT(runId) DO UPDATE SET def=excluded.def, startPlace=excluded.startPlace, failPlace=excluded.failPlace, sinks=excluded.sinks'),
		insTok: db.prepare('INSERT INTO tokens(runId, recordId, placeId, status, payload, attempts, leaseUntil, leaseId, parentId, created, reason) ' +
			'VALUES (?,?,?,?,?,?,?,?,?,?,?)'),
		byId: db.prepare('SELECT * FROM tokens WHERE id = ?'),
		claimable: db.prepare('SELECT * FROM tokens WHERE runId = ? AND (status = \'ready\' OR (status = \'leased\' AND (leaseUntil IS NULL OR leaseUntil <= ?))) ORDER BY id LIMIT ?'),
		lease: db.prepare('UPDATE tokens SET status=\'leased\', leaseUntil=?, attempts=attempts+1, leaseId=? WHERE id=?'),
		deadLetter: db.prepare('UPDATE tokens SET status=\'failed\', placeId=?, reason=?, leaseUntil=NULL, leaseId=NULL WHERE id=?'),
		relabel: db.prepare('UPDATE tokens SET placeId=?, status=?, leaseUntil=NULL, leaseId=NULL, payload=?, created=? WHERE id=?'),
		consume: db.prepare('UPDATE tokens SET status=\'consumed\', leaseUntil=NULL, leaseId=NULL, payload=?, created=? WHERE id=?'),
		setCreated: db.prepare('UPDATE tokens SET created=? WHERE id=?'),
		failTok: db.prepare('UPDATE tokens SET status=\'failed\', placeId=?, reason=?, leaseUntil=NULL, leaseId=NULL WHERE id=?'),
		inflight: db.prepare('SELECT * FROM tokens WHERE runId = ? AND status = \'leased\''),
		resetTok: db.prepare('UPDATE tokens SET status=\'ready\', leaseUntil=NULL, leaseId=NULL, created=\'[]\' WHERE id=?'),
		allOf: db.prepare('SELECT * FROM tokens WHERE runId = ?'),
		statsOf: db.prepare('SELECT status, COUNT(*) n FROM tokens WHERE runId = ? GROUP BY status'),
		bumpLease: db.prepare('UPDATE seqs SET val = val + 1 WHERE name = \'lease\''),
		getLease: db.prepare('SELECT val FROM seqs WHERE name = \'lease\''),
		memoGet: db.prepare('SELECT output FROM memo WHERE key = ?'),
		memoSet: db.prepare('INSERT INTO memo(key, output) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET output=excluded.output'),
	};

	function getRunCfg( runId, create ) {
		const r = q.getRun.get(runId);
		if ( r ) return { start: r.startPlace || startDefault, fail: r.failPlace || failDefault, sinks: new Set(JSON.parse(r.sinks || '[]')) };
		if ( create ) { q.putRun.run(runId, '{}', startDefault, failDefault, '[]'); return { start: startDefault, fail: failDefault, sinks: new Set() }; }
		return { start: startDefault, fail: failDefault, sinks: new Set() };
	}
	function nextLease() { q.bumpLease.run(); return q.getLease.get().val; }
	function tx( fn ) { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch ( e ) { db.exec('ROLLBACK'); throw e; } }
	function insert( runId, recordId, placeId, status, payload, parentId ) {
		const info = q.insTok.run(runId, recordId, placeId, status, JSON.stringify(payload == null ? null : payload),
			0, null, null, parentId == null ? null : String(parentId), '[]', null);
		return viewToken(parseRow(q.byId.get(info.lastInsertRowid)));
	}

	return {
		ensureRun( runId, def ) {
			def = def || {};
			q.putRun.run(runId, JSON.stringify(def), def.start || startDefault, def.fail || failDefault, JSON.stringify(def.sinks || []));
			return this;
		},

		inject( runId, records ) {
			const cfg = getRunCfg(runId, true);
			return tx(() => (records || []).map(( rec ) => {
				const rid = rec && (rec.recordId != null ? rec.recordId : rec.id);
				const recordId = rid == null ? null : String(rid);   // a numeric id bound to a TEXT column else coerces to '0.0'
				const payload = rec && rec.payload !== undefined ? rec.payload : rec;
				return insert(runId, recordId, cfg.start, READY, payload, null);
			}));
		},

		claim( runId, o ) {
			o = o || {};
			const lease = o.lease || 30000, limit = o.limit || 1, maxAttempts = o.maxAttempts || Infinity;
			const t = now(), cfg = getRunCfg(runId, false);
			return tx(() => {
				const cand = q.claimable.all(runId, t, limit);
				const out = [];
				for ( const dbRow of cand ) {
					if ( dbRow.attempts >= maxAttempts ) { q.deadLetter.run(cfg.fail, 'max-attempts', dbRow.id); continue; }
					const lid = nextLease();
					q.lease.run(t + lease, lid, dbRow.id);
					out.push(viewToken(parseRow(q.byId.get(dbRow.id))));
				}
				return out;
			});
		},

		move( token, toPlace, o ) {
			o = o || {};
			return tx(() => {
				const row = parseRow(q.byId.get(token && token.id));
				if ( !holds(row, token) ) return null;
				const cfg = getRunCfg(row.runId, false);
				const created = o.created ? row.created.concat(o.created) : row.created;
				const payload = o.payload ? Object.assign({}, row.payload, o.payload) : row.payload;
				if ( Array.isArray(toPlace) ) {
					q.consume.run(JSON.stringify(payload == null ? null : payload), JSON.stringify(created), token.id);
					const pl = o.payloads;                           // optional per-child payloads (the map elem case)
					return toPlace.map(( place, i ) => insert(row.runId, row.recordId, place, cfg.sinks.has(place) ? DONE : READY, pl ? pl[i] : payload, row.id));
				}
				const status = cfg.sinks.has(toPlace) ? DONE : READY;
				q.relabel.run(toPlace, status, JSON.stringify(payload == null ? null : payload), JSON.stringify(created), token.id);
				return viewToken(parseRow(q.byId.get(token.id)));
			});
		},

		fail( token, reason ) {
			return tx(() => {
				const row = parseRow(q.byId.get(token && token.id));
				if ( !holds(row, token) ) return null;
				q.failTok.run(getRunCfg(row.runId, false).fail, reason == null ? null : String(reason), token.id);
				return viewToken(parseRow(q.byId.get(token.id)));
			});
		},

		track( token, refs ) {
			tx(() => {
				const row = parseRow(q.byId.get(token && token.id));
				if ( holds(row, token) && refs ) q.setCreated.run(JSON.stringify(row.created.concat(refs)), token.id);
			});
			return this;
		},

		memoGet( key ) { const r = q.memoGet.get(key); return r ? JSON.parse(r.output) : undefined; },
		memoSet( key, output ) { q.memoSet.run(key, JSON.stringify(output == null ? null : output)); return this; },

		rollbackInflight( runId ) {
			return tx(() => {
				const reset = [], created = [];
				for ( const dbRow of q.inflight.all(runId) ) {
					const row = parseRow(dbRow);
					if ( row.created && row.created.length ) created.push.apply(created, row.created);
					q.resetTok.run(row.id);                          // ready, leaseId/leaseUntil null, created cleared
					reset.push(row.id);
				}
				return { reset, created };
			});
		},

		marking( runId ) {
			const m = {};
			for ( const dbRow of q.allOf.all(runId) ) { const tk = viewToken(parseRow(dbRow)); (m[tk.placeId] = m[tk.placeId] || []).push(tk); }
			return m;
		},

		stats( runId ) {
			const s = { ready: 0, leased: 0, done: 0, failed: 0, consumed: 0, total: 0 };
			for ( const r of q.statsOf.all(runId) ) { s[r.status] = r.n; s.total += r.n; }
			return s;
		},

		close() { try { db.close(); } catch ( e ) {} },
	};
}

module.exports = { createMemoryCheckpointStore, createSqliteCheckpointStore, statuses: { READY, LEASED, DONE, FAILED, CONSUMED } };
