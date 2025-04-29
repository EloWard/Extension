#include <obs-module.h>
#include <obs-frontend-api.h>
#include <util/platform.h>
#include <util/dstr.h>

#define SCRIPT_NAME "eloward-rank-badges.js"

static const char *js_code = NULL;

// Load the JavaScript file content
static bool load_js_file() {
    char *js_path = obs_module_file(SCRIPT_NAME);
    if (!js_path) {
        blog(LOG_ERROR, "EloWard Ranks: Could not find JavaScript file");
        return false;
    }
    
    char *js_content = os_quick_read_utf8_file(js_path);
    bfree(js_path);
    
    if (!js_content) {
        blog(LOG_ERROR, "EloWard Ranks: Could not read JavaScript file");
        return false;
    }
    
    js_code = js_content;
    return true;
}

// Free the JavaScript code memory
static void free_js_code() {
    if (js_code) {
        bfree((void *)js_code);
        js_code = NULL;
    }
}

// Inject the JavaScript code into a browser source
static bool inject_js_to_browser_source(obs_source_t *browser_source) {
    if (!browser_source || !js_code) return false;
    
    // Create injector script which creates a script element with our code
    struct dstr injector = {0};
    dstr_cat(&injector, 
             "(function() {\n"
             "    try {\n"
             "        const script = document.createElement('script');\n"
             "        script.text = `");
    
    // Escape backticks, backslashes and line breaks in the JavaScript code
    for (const char *c = js_code; *c; c++) {
        if (*c == '`') dstr_cat(&injector, "\\`");
        else if (*c == '\\') dstr_cat(&injector, "\\\\");
        else if (*c == '\n') dstr_cat(&injector, "\\n");
        else dstr_catchar(&injector, *c);
    }
    
    dstr_cat(&injector, 
             "`;\n"
             "        document.head.appendChild(script);\n"
             "        return 'EloWard rank badges script injected';\n"
             "    } catch (err) {\n"
             "        return 'Error injecting EloWard script: ' + err.message;\n"
             "    }\n"
             "})();");
    
    // Execute JavaScript in browser source
    calldata_t cd = {0};
    proc_handler_t *ph = obs_source_get_proc_handler(browser_source);
    const char *result = NULL;
    
    if (ph) {
        proc_handler_call(ph, "javascript", &cd, &result);
    }
    
    dstr_free(&injector);
    
    if (result) {
        blog(LOG_INFO, "EloWard Ranks: %s", result);
        return true;
    }
    
    return false;
}

// Find and inject into all browser sources that might be showing chat
void inject_into_chat_sources() {
    if (!js_code && !load_js_file()) {
        blog(LOG_ERROR, "EloWard Ranks: Failed to load JavaScript file");
        return;
    }
    
    obs_source_t *scene_source = obs_frontend_get_current_scene();
    if (scene_source) {
        obs_source_enum_active_sources(scene_source, 
            [](obs_source_t *parent, obs_source_t *child, void *) {
                const char *id = obs_source_get_id(child);
                if (strcmp(id, "browser_source") == 0) {
                    const char *name = obs_source_get_name(child);
                    if (strstr(name, "chat") || strstr(name, "Chat")) {
                        blog(LOG_INFO, "EloWard Ranks: Injecting into browser source '%s'", name);
                        inject_js_to_browser_source(child);
                    }
                }
                return true;
            }, NULL);
        
        obs_source_release(scene_source);
    }
}

// Initialize injector
bool injector_init() {
    return load_js_file();
}

// Cleanup injector
void injector_free() {
    free_js_code();
} 