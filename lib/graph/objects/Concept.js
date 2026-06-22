/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <@pp9ping@gmail.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

var isArray  = require('is').array;
var debug  = require('../log').defaultLogger;// module fallback; applyTo rebinds to graph._log
var dmerge = require('deepmerge');
var { compileExpression } = require('../expr');

function Concept( _, graph, parent ) {
    this.init(_, graph, parent);
};

Concept.prototype = {
    _static       : Concept,
    /**
     * Init & mount child concepts
     * @param record
     * @param graph
     * @param parent
     */
    init          : function ( record, graph, parent ) {
        var me      = this,
            cKeys   = record.childConcepts && Object.keys(record.childConcepts) || [];

        me._schema                    = record;
        graph._conceptLib[record._id] = this;
        if ( cKeys.length ) {
            this._openConcepts         = {};
            this._openConceptsRequires = {};

            cKeys.map(
                function ( v ) {
                    me._openConcepts[v]         = new Concept(record.childConcepts[v], graph, me);
                    me._openConceptsRequires[v] =
                        isArray(record.childConcepts[v].require) ? record.childConcepts[v].require
                            : record.childConcepts[v].require && [record.childConcepts[v].require] || [];
                }
            );
        }
        else
            this.isLeaf = true;

        // generate the assert fn (asserts + ensure, &&-joined)
        this._compileAssert();
        this._id         = record._id;
        this._name       = record._name;
        this._parent     = parent;


    },
    /**
     * (Re)compile this concept's applicability test from its current `_schema`
     * (assert + ensure expressions, &&-joined). Called at init and again by
     * `patch()` so a hot-patched assert takes effect immediately.
     */
    _compileAssert: function () {
        var record  = this._schema,
            asserts = isArray(record.assert) && record.assert
                || record.assert && [record.assert]
                || [],
            ensure  = isArray(record.ensure) && record.ensure
                || record.ensure && [record.ensure]
                || [];

        asserts = asserts.concat(ensure);

        var _assertFn    = compileExpression(asserts, { empty: true });
        this._assertTest = function ( scope, graph ) {
            return _assertFn(function ( ref ) { return scope.getRef(ref); });
        };
        return this;
    },
    /**
     * Hot-patch this expert: deep-merge `updates` into `_schema` and recompile
     * the applicability test. Arrays (assert/ensure/require/provider) are
     * REPLACED, not concatenated, so patching an assert overrides the old one.
     * Re-evaluating live objects against the patched expert is the graph's job
     * (see Graph.patchConcept).
     * @param updates partial concept schema
     */
    patch         : function ( updates ) {
        this._schema = dmerge(this._schema, updates, { arrayMerge: function ( dest, src ) { return src; } });
        this._compileAssert();
        return this;
    },
    /**
     * Apply-correlated context logger for a provider: ctx {concept,target,type,applyId}.
     * A METHOD (not a stored property) because a Concept instance is shared across many
     * scopes and concurrent async applies would race a mutable field. `applyId` is read
     * from `scope._applyId` (set by applyTo for the duration of the apply). A provider
     * that logs asynchronously should capture `const log = concept.log(scope)` EARLY so
     * the child snapshots the right applyId. Used to later retrieve a concept's apply-logs
     * via graph.logger.tail(n, {concept|applyId}) — without storing anything on the graph.
     */
    log           : function ( scope ) {
        var graph = scope._graph,
            t     = scope._ && (scope._.Node ? 'node' : scope._.Segment ? 'segment' : 'object');
        return graph._log.child({
            concept: this._name, conceptId: this._id,
            target : scope._ && scope._._id, type: t, applyId: scope._applyId
        });
    },
    /**
     * Search Parent concept by name
     * @param parent [Concept|undefined]
     */
    hasParent     : function ( cn ) {
        var c = this;
        while ( c = c._parent )
            if ( c._name === cn )
                return c;
    },
    /**
     * Search Parent concept by id
     * @param parent [Concept|undefined]
     */
    hasParentId   : function ( cid ) {
        var c = this;
        while ( c = c._parent )
            if ( c._id === cid )
                return c;
    },
    /**
     * Return an async task that will cast the applicable concepts
     * @param scope
     * @param graph
     * @returns {Function}
     */
    applyTo       : function ( scope, graph ) {
        var me                          = this;
        // will push or return task (or just inc some sema)
        scope._mappedConcepts[me._name] = me;
        
        
        return function ( graph, flow ) {
            var debug = graph._log;// route the engine's own provider diagnostics per-graph

            // oscillation backstop (#11.c.1): bound how many times this (target, concept)
            // applies within an episode (the tally resets on each healthy settle). Over the
            // ceiling -> record WHY in the `divergent` array fact + skip this apply; that
            // fact is a non-cast condition (Concept.isApplicableTo) so the concept de-casts.
            if ( graph._applyCount ) {
                var _ck = scope._._id + '/' + me._name;
                graph._applyCount[_ck] = (graph._applyCount[_ck] || 0) + 1;
                if ( graph._applyCount[_ck] > graph._applyCap ) {
                    graph._markDivergent && graph._markDivergent(scope, me, graph._applyCount[_ck]);
                    return;
                }
            }

            // Mint a per-apply id and expose it on the Entity (NOT on `scope._`, so it is
            // never serialized) for the duration of this apply. It tags both the trace
            // record (mkCtx below) and any logs the provider emits via concept.log(scope),
            // so an apply's logs and its trace can be joined afterwards by applyId.
            var applyId = ++graph._applyId;
            scope._applyId = applyId;
            var dlog    = me.log(scope);// apply-correlated logger for the engine's own diagnostics

            // trace context: attributes the mutation(s) this apply produces back to
            // this concept (read by Graph.pushMutation -> cfg.onConceptApply).
            var startTm = Date.now(),
                why     = me._computeWhy(scope),
                mkCtx   = function ( kind, ms ) {
                    return { conceptId: me._id, conceptName: me._name, targetId: scope._._id, kind: kind, why: why, ms: ms, applyId: applyId };
                };

            if ( me._schema.provider ) {// call the concept data provider
                var p         = isArray(me._schema.provider) ? me._schema.provider[0] : me._schema.provider,
                    argz      = isArray(me._schema.provider) && me._schema.provider.slice(1),
                    providers = graph.static._providers, checkTm;
                
                // stats
                
                let execTm = Date.now();
                
                p = p.split("::");
                if ( providers[p[0]] && providers[p[0]][p[1]] ) {
                    
                    flow.wait();// inc async flow
                    
                    //debug.info(graph.cfg.label + " : Do provider ", p, 'on', scope._._id);
                    try {
                        checkTm = setTimeout(() => {
                            dlog.warn("still waiting on provider %s (25s)", p.join('::'))
                        }, 25000)
                        providers[p[0]][p[1]](
                            graph, me, scope, argz,
                            function ( e, r ) {
                                clearTimeout(checkTm);
                                
                                // stats
                                graph._statsByProvider[p] = graph._statsByProvider[p] || 0;
                                graph._statsByProvider[p] += (Date.now() - execTm);
                                
                                //debug.info(graph.cfg.label + " : Done provider ", p, 'on', scope._._id);
                                r && graph.pushMutation(r, scope._._id, 0, 0, 0, refs => {
                                    //debug.info(graph.cfg.label + " : Done provider ", p, 'on', scope._._id);
                                    flow.release()// w8 bagrefs b4 next cycle
                                }, mkCtx('provider', Date.now() - execTm));// so bagrefs will be w8 before the graph restart ... :/
                                e && dlog.warn("provider %s failed", p.join('::'), e);
                            });
                    } catch ( e ) {
                        dlog.error("provider %s threw on %s", p.join('::'), scope._._id, e);
                        setTimeout(() => {
                            throw e
                        });
                    }

                }
                else {
                    scope.set(me._name, true, graph);// no provider wired -> flag the concept true so the graph can still settle
                    dlog.log("provider not found: %s", p.join('::'));
                }
                
            }
            else if ( me._schema.type == "enum" ) {// enum are not used for now
                graph.pushMutation(
                    {
                        $_id      : "_parent",
                        [me._name]: me.isLeaf && [] || Object.keys(me._openConcepts)
                    },
                    scope._._id, 0, 0, 0, 0, mkCtx('enum', Date.now() - startTm)
                );
            }
            else {
                // scope.set(me._name, true, graph);
                graph.pushMutation(
                    {
                        $_id      : "_parent",
                        [me._name]: me._schema.defaultValue || true
                    },
                    scope._._id, 0, 0, 0, 0, mkCtx('default', Date.now() - startTm)
                );
            }

            // if there a tpl in the concept definition apply it
            if ( me._schema.applyMutations ) {
                graph.pushMutation(me._schema.applyMutations, scope._._id, 0, 0, 0, 0, mkCtx('applyMutations', Date.now() - startTm));
            }
            // if the concept implies a graph sync (allowing concepts to be applied on server )
            if ( me._schema.syncAfter ) {
                // graph.stabilize(()=>graph.sync());
            }
        };
    },
    /**
     * "Why it fired": for each `require`, the resolved value and the revision of
     * the object that holds it (object-granular — the _rev of the last mutation
     * that touched that object, not necessarily the specific key). Used by the
     * trace (cfg.onConceptApply). Resolves without `follow` so it adds no watchers.
     * @param scope the Entity the concept is being cast on
     */
    _computeWhy   : function ( scope ) {
        var requires = isArray(this._schema.require) && this._schema.require
            || this._schema.require && [this._schema.require]
            || [];
        return requires.map(function ( c ) {
            var value = scope.getRef(c), producedAtRev = null;
            try {
                if ( c.indexOf(':') !== -1 ) {
                    var box       = scope.getRef(c.slice(0, c.lastIndexOf(':') + 1));// trailing-colon -> the object
                    producedAtRev = box && box._ ? box._._rev : (box && box._rev) || null;
                }
                else producedAtRev = scope._ && scope._._rev;
            } catch ( e ) { producedAtRev = null; }
            return { require: c, value: value, producedAtRev: producedAtRev };
        });
    },
    /**
     * Side-effect-free applicability gate — true iff this concept should cast on
     * `scope`. A GATE, not a trigger: it only runs when the object is (re)tested.
     * Checked in order:
     *   1. autoCast:false  → never auto-casts (manual/triggered only).
     *   2. divergent       → if the object carries a divergent record for this concept
     *                        (blew the apply ceiling), refuse to (re)cast (#11.c.1).
     *   3. require         → every `require` ref must resolve; getRef(c, true) installs
     *                        a FOLLOW watcher so the object is re-tested when a missing
     *                        require later appears (this is how casting waits on inputs).
     *   4. assert/ensure   → the compiled _assertTest must be true.
     * @param {Entity} scope
     * @param {Graph}  graph
     * @returns {boolean}
     */
    isApplicableTo: function ( scope, graph ) {
        if ( this._schema.autoCast === false ) {
            return;
        }

        // divergent fact = non-cast condition (#11.c.1): a (target, concept) that blew the
        // apply ceiling carries a reason record in `divergent`; it must not (re)cast.
        var _dv = scope._ && scope._.divergent;
        if ( _dv && _dv.length )
            for ( var _i = 0; _i < _dv.length; _i++ )
                if ( _dv[_i] && _dv[_i].concept === this._name ) return false;

        var me       = this,
            requires = isArray(me._schema.require) && me._schema.require
                || me._schema.require && [me._schema.require]
                || [];
        requires     = requires.filter(function ( c ) {
            // getRef(c, true): read the require AND install a follow-watcher, so the
            // object is re-tested if this require is produced later. Keep the UNRESOLVED
            // ones (0 is a valid value, not "missing").
            var ref = scope.getRef(c, true);
            return (!ref && (ref != 0)) && true || null;
        });

        // applicable iff no require is still unresolved AND the assert/ensure test holds
        return !requires.length
            && this._assertTest(scope, graph);
    },
    /**
     * Remove the follow-watchers this concept's requires installed on `scope`
     * (the inverse of the getRef(c, true) calls in isApplicableTo) — used when the
     * concept is retracted so a defunct cast no longer destabilizes the object.
     * @param scope
     * @param graph
     */
    unRefRequires : function ( scope, graph ) {
        var me       = this,
            requires = isArray(me._schema.require) && me._schema.require
                || me._schema.require && [me._schema.require]
                || [];
        requires     = requires.filter(function ( c ) {
            return !graph.getRef(c, scope, true, true) && true || null;
        });
    }
};
module.exports    = Concept;