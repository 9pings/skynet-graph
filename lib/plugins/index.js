'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * Plugin subsystem — the thin layer that turns self-contained plugin bundles
 * { concepts, providers, JS, .sgc } into a bootable graph config. See
 * `WIP/2026-07-16-design-plugin-architecture.md`. The engine + loaders stay plugin-agnostic; this
 * is the only new surface.
 *   resolvePlugins(pluginObjs) -> { order, conceptMap, conceptSets, providers, combos }
 *   loadPlugin(dir) -> pluginObj      · loadPlugins(dirs) -> resolved config
 */
const { resolvePlugins } = require('./resolve.js');
const { loadPlugin, loadPlugins } = require('./load.js');

module.exports = { resolvePlugins, loadPlugin, loadPlugins };
