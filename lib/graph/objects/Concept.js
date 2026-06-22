/**
 * Copyright (C) 2021  Nathanael Braun
 
 * @author Nathanael BRAUN
 *
 * Date: 19/01/2016
 * Time: 18:42
 */
var isArray  = require('is').array;
var debug  = console;
var dmerge = require('deepmerge');
var { compileExpression } = require('../expr');
// var cutils   = require('../../TimingUtils');

var conceptLib = {};

function Concept( _, graph, parent ) {
    this.init(_, graph, parent);
};

// @todo mk a true require-produce mapping


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
            //debug.log(graph.cfg.label + " : Do cast ", me._id, 'on', scope._._id);

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

            // trace context: attributes the mutation(s) this apply produces back to
            // this concept (read by Graph.pushMutation -> cfg.onConceptApply).
            var startTm = Date.now(),
                why     = me._computeWhy(scope),
                mkCtx   = function ( kind, ms ) {
                    return { conceptId: me._id, conceptName: me._name, targetId: scope._._id, kind: kind, why: why, ms: ms };
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
                            debug.error(graph.cfg.label + " : Still waiting provider ", p, 'on', scope._._id)
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
                                e && debug.log("Hum provider ", p, " has failed : \n", e, e.stack);
                                ;// dec async flow
                            });
                    } catch ( e ) {
                        // clearInterval(checkTm);
                        debug.error(graph.cfg.label + " : Fail ! provider %s on %s \n%j\n", p, scope._._id, scope._, e);
                        setTimeout(() => {
                            throw e
                        });
                    }
                    
                }
                else {
                    scope.set(me._name, true, graph);// flagged by default
                    debug.log("Hum provider not found ", p, " :( \n");//@todo : deal with providers errors ?
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
     * return true if applicable (will ask ref with the follow param (so this concept will be retested if some of his
     * require is set)
     * @param obj
     *
     */
    isApplicableTo: function ( scope, graph ) {
        // will test the needed objects asserts
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
            // scope._followStack.push(c, true);
            //console.log(c + " " + scope.getRef(c) );
            var ref = scope.getRef(c, true);
            return (!ref && (ref != 0)) && true || null;
        });

//        var res = !requires.length && this._assertTest(scope, graph) ? " -> YES" : " -> NO";
        //var res = !requires.length ? " -> YES" : " -> NO";
        //debug.log("Is Applicable " + this._name  + " " + res );
        
        return !requires.length
            && this._assertTest(scope, graph);// @optims
    },
    /**
     * Rm scope auto destabilise
     * @param scope
     * @param graph
     */
    unRefRequires : function ( scope, graph ) {//@todo
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