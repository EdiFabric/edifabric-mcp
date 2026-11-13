// The Claude Code plugin's settings, which arrive as CLAUDE_PLUGIN_OPTION_<KEY>.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPluginOptions } from '../src/settings.js';

test('plugin options set the EDIFABRIC_* variables', () => {
    const env = applyPluginOptions({ CLAUDE_PLUGIN_OPTION_SERIAL: 'plugin-serial', CLAUDE_PLUGIN_OPTION_ALLOWED_FOLDER: '/edi' });
    assert.equal(env.EDIFABRIC_SERIAL, 'plugin-serial');
    assert.equal(env.EDIFABRIC_ALLOWED_DIRS, '/edi');
});

test('a plugin option takes the place of the variable', () => {
    const env = applyPluginOptions({ CLAUDE_PLUGIN_OPTION_SERIAL: 'plugin-serial', EDIFABRIC_SERIAL: 'shell-serial' });
    assert.equal(env.EDIFABRIC_SERIAL, 'plugin-serial');
});

test('an empty plugin option keeps the variable', () => {
    const env = applyPluginOptions({ CLAUDE_PLUGIN_OPTION_SERIAL: '', CLAUDE_PLUGIN_OPTION_ALLOWED_FOLDER: '', EDIFABRIC_SERIAL: 'shell-serial' });
    assert.equal(env.EDIFABRIC_SERIAL, 'shell-serial');
    assert.equal(env.EDIFABRIC_ALLOWED_DIRS, undefined);
});
