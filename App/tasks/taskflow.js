/**
 * Promise / semaphore manager & task sequencer.
 *
 * Vendored, zero-dependency drop-in for the `taskflows` package (originally by
 * Nathanael Braun). Behaviour-preserving: the engine's stabilize loop relies on
 * the exact lock/release + followers semantics (see App/Graph.js `_loopTF`,
 * `pushMutation`, and the #11.a re-entrancy guard). The only change vs the
 * published lib is that the unused `require()`s (isfunction/isnumber/merge/
 * slice/splice) are dropped and `isArray`/`isString` are inlined.
 *
 * @class TaskFlow
 */
"use strict";

var isArray  = Array.isArray,
    isString = function ( s ) { return typeof s === 'string'; };

/**
 * TaskFlow
 * @param todo      {fn|fn[]}  task(s) to run (string => method name on scope)
 * @param scope     {object}   execution context passed to tasks
 * @param followers {fn|fn[]}  one-shot callback(s) fired when locks reach 0
 * @param name      {string}
 * @constructor
 */
var TaskFlow = function ( todo, scope, followers, name ) {
	this.scope       = scope || {};
	this.todo        = isArray(todo) ? todo : todo && [todo] || [];
	this.doAfter     = [];
	this.locks       = 0;
	this.fails       = 0;
	this._complete   = false;
	this._followers  = followers instanceof Array ? followers : [followers];
	this._onfail     = null;
	this.displayName = name;

	this.release   = this.success   = this.release.bind(this);
	this.asyncFail = this.fail.bind(this);
};

module.exports = TaskFlow;

TaskFlow.prototype = {
	kill : function () {
		this.doAfter = this.scope = this._onfail = this._followers = 0;
		this.dead    = true;
	},
	reset : function () {
		if ( this.dead ) return;
		this._complete = false;
		this._pos      = 0;
	},
	/**
	 * Add one-shot success callback / TaskFlow.
	 * A passed TaskFlow is released (so it starts running if it holds no other locks).
	 * @param cb {function|TaskFlow}
	 * @returns {TaskFlow}
	 */
	then : function () {
		if ( this.dead ) return;
		this._followers = (this._followers instanceof Array) && this._followers || [];
		for ( var i = 0, ln = arguments.length ; i < ln ; i++ ) {
			if ( arguments[i] instanceof Array ) this.then.apply(this, arguments[i]);
			else {
				this._followers.push(arguments[i]);
				if ( arguments[i] instanceof TaskFlow )
					arguments[i].locks++;
			}
		}
		if ( this._complete ) {
			this.locks++;
			this.release();
		}
		return this;
	},
	/**
	 * Add one-shot fail callback.
	 * @param cb {function|TaskFlow|array}
	 * @returns {TaskFlow}
	 */
	catchFail : function () {
		if ( this.dead ) return;
		var done     = this.fails && this._complete;
		this._onfail = this._onfail || [];
		for ( var i = 0, ln = arguments.length ; i < ln ; i++ ) {
			if ( arguments[i] instanceof Array ) this.catchFail.apply(this, arguments[i]);
			else {
				if ( !done ) this._onfail.push(arguments[i]);
				else arguments[i]();
			}
		}
		return this;
	},
	/**
	 * Make this flow fall into failure, triggering one-shot callbacks.
	 * @param cause
	 */
	fail : function ( cause ) {
		if ( this.dead ) return;
		var tmp, i = 0;
		this._fail = cause;
		if ( this._onfail )
			while ( i < this._onfail.length ) {
				tmp = this._onfail[i++];
				if ( tmp instanceof Function ) tmp(this.scope, cause, this);
				else if ( tmp instanceof TaskFlow ) tmp.release();
			}
	},
	/**
	 * Push a task & (re)start running the flow if no remaining locks.
	 * @returns {TaskFlow}
	 */
	push : function () {
		if ( this.dead ) return;
		this.locks++;
		this._complete = false;
		this.todo.push.apply(this.todo, arguments);
		this.release();
		return this;
	},
	/**
	 * Add a lock (optionally waiting on a previous flow).
	 * @param previous {TaskFlow|TaskFlow[]} optional flow(s) to wait on
	 * @returns {TaskFlow}
	 */
	wait : function ( previous ) {
		if ( this.dead ) return;
		if ( isArray(previous) )
			return previous.map(this.wait.bind(this));
		if ( previous ) previous.then(this);
		else this.locks++;
		return this;
	},
	/**
	 * Decrease locks; at 0, run pending tasks else fire `then` followers.
	 * @param desync
	 * @returns {*}
	 */
	release : function ( desync ) {
		if ( this.dead ) return;
		if ( desync && this.locks > 0 ) return setTimeout(this.success) && this;
		var tmp;

		if ( !--this.locks ) {
			if ( this.doAfter.length || this.todo.length > this._pos ) {
				this.run(tmp);
				return;
			}
			this._complete = true;
			this.running   = false;

			if ( this._followers instanceof Array ) {
				while ( this._followers.length ) {
					tmp = this._followers.shift();
					if ( tmp instanceof Function ) tmp(this.scope, this);
					else if ( tmp instanceof TaskFlow ) tmp.release();
				}
			} else {
				tmp = this._followers;
				if ( tmp instanceof Function ) tmp(this.scope, this);
				else if ( tmp instanceof TaskFlow ) tmp.release();
			}
		}
		return this;
	},
	_pos      : 0,
	_nextTask : 0,
	pushSubTask : function ( task ) {
		if ( this.dead ) return;
		this.doAfter.push(task);
	},
	/**
	 * Start this flow's execution.
	 * @returns {*}
	 */
	run : function ( step, force, releaseAfter ) {
		if ( this.dead ) return;
		if ( !step && !this.locks && !this.doAfter.length && (this._pos >= this.todo.length) ) {
			this.locks++;
			this.running = false;
			this.release();
			return this;
		}
		if ( !force && this.locks ) return step && this.pushSubTask(step);

		this.running = true;

		step = step || this.doAfter.length && this.doAfter.shift() || this.todo[this._pos++];

		this.locks++;
		if ( isString(step) ) {
			if ( this.scope[step] instanceof Function )
				step = this.scope[step](null, this.scope, this);
			else step = this.scope[step];
		} else if ( step instanceof Function ) {
			this._succesfull = true;
			step             = step(this.scope, this);
			this._succesfull = false;
		} else if ( step instanceof TaskFlow ) { // sync wf
			step.then(this);
			step = null;
		} else if ( step instanceof Array ) { // async pool
			this.locks++;
			for ( var i = 0 ; i < step.length ; i++, this.locks++ )
				setTimeout(this.run.bind(this, step[i], true, true));
			setTimeout(this.success);
			step = null;
		} else {
			step = null;
		}

		!step && releaseAfter && this.release();
		this.run(step, step && force, step && releaseAfter);
		this.release();

		return this;
	}
};
