// The Claude Code plugin passes its settings as CLAUDE_PLUGIN_OPTION_<KEY>, the only names the plugin directory
// accepts. They take the place of the EDIFABRIC_* variables that npx, the Claude Desktop bundle and other clients set.
const PLUGIN_OPTIONS = {
    CLAUDE_PLUGIN_OPTION_SERIAL: 'EDIFABRIC_SERIAL',
    CLAUDE_PLUGIN_OPTION_ALLOWED_FOLDER: 'EDIFABRIC_ALLOWED_DIRS',
};

/** Copies the plugin's settings to the EDIFABRIC_* variables. An empty plugin setting keeps the variable as it is. */
export function applyPluginOptions(env) {
    for (const [option, variable] of Object.entries(PLUGIN_OPTIONS)) {
        if (env[option])
            env[variable] = env[option];
    }
    return env;
}
