'use strict';
/**
 * The CheckpointStore CONTRACT, run against the MEMORY reference impl (pure, zero-dep). The SAME contract runs
 * against the SQLite impl in tests/integration/checkpoint-store-sqlite.test.js — so both backends are pinned to
 * one behaviour (Layer A of the durable executor; convergence study §5).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryCheckpointStore } = require('../../plugins/durable/lib/checkpoint-store.js');
const { runCheckpointContract } = require('../_checkpoint-suite.js');

runCheckpointContract('memory', ( o ) => createMemoryCheckpointStore(o), { test, assert });
