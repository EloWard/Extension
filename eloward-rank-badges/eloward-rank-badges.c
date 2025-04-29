#include <obs-module.h>
#include <obs-frontend-api.h>
#include <util/platform.h>
#include <util/curl/curl.h>
#include <json.h>
#include <pthread.h>
#include <stdio.h>
#include <string.h>

#define SUBSCRIPTION_API_URL "https://eloward-subscription-api.unleashai-inquiries.workers.dev"
#define RANK_API_URL "https://eloward-viewers-api.unleashai-inquiries.workers.dev/api/ranks/lol"
#define POLL_INTERVAL_MS 5000  // 5 seconds
#define JS_FILENAME "eloward-rank-badges.js"

OBS_DECLARE_MODULE()
OBS_MODULE_USE_DEFAULT_LOCALE("eloward-rank-badges", "en-US")

typedef struct {
    bool initialized;
    bool thread_running;
    pthread_t poll_thread;
    os_event_t *stop_event;
    char *js_code;
    char current_streamer[128];
    bool streamer_subscribed;
} eloward_data_t;

static eloward_data_t *plugin_data = NULL;

// Callbacks for CURL
static size_t write_callback(void *contents, size_t size, size_t nmemb, void *userp) {
    size_t realsize = size * nmemb;
    char *mem = (char *)userp;
    
    strncpy(mem, contents, realsize);
    mem[realsize] = '\0';
    
    return realsize;
}

// Check if a streamer is subscribed to EloWard
static bool check_streamer_subscription(const char *streamer_name) {
    if (!streamer_name || !strlen(streamer_name)) return false;
    
    CURL *curl;
    CURLcode res;
    char url[512];
    char response_buffer[2048] = {0};
    bool subscribed = false;
    
    // Format URL to check subscription
    snprintf(url, sizeof(url), "%s/check?username=%s", SUBSCRIPTION_API_URL, streamer_name);
    
    curl = curl_easy_init();
    if (!curl) {
        blog(LOG_ERROR, "EloWard Ranks: Failed to initialize curl");
        return false;
    }
    
    curl_easy_setopt(curl, CURLOPT_URL, url);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_callback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, response_buffer);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 5L);
    
    res = curl_easy_perform(curl);
    
    if (res == CURLE_OK) {
        // Parse JSON response
        json_error_t error;
        json_t *root = json_loads(response_buffer, 0, &error);
        
        if (root) {
            json_t *subscribed_json = json_object_get(root, "subscribed");
            
            if (json_is_boolean(subscribed_json)) {
                subscribed = json_boolean_value(subscribed_json);
            }
            
            json_decref(root);
        } else {
            blog(LOG_ERROR, "EloWard Ranks: Failed to parse subscription JSON: %s", error.text);
        }
    } else {
        blog(LOG_ERROR, "EloWard Ranks: curl_easy_perform() failed: %s", curl_easy_strerror(res));
    }
    
    curl_easy_cleanup(curl);
    return subscribed;
}

// Get current Twitch streamer name from OBS
static bool get_current_streamer(char *streamer_name, size_t size) {
    obs_source_t *source = obs_frontend_get_streaming_output();
    if (!source) {
        // If not streaming, try to get from profile
        const char *profile_name = obs_frontend_get_current_profile_name();
        if (profile_name && strlen(profile_name) > 0 && strlen(profile_name) < size) {
            strncpy(streamer_name, profile_name, size-1);
            streamer_name[size-1] = '\0';
            return true;
        }
        return false;
    }
    
    obs_data_t *settings = obs_source_get_settings(source);
    const char *service_name = obs_data_get_string(settings, "service");
    
    if (service_name && strlen(service_name) > 0 && strlen(service_name) < size) {
        strncpy(streamer_name, service_name, size-1);
        streamer_name[size-1] = '\0';
        obs_data_release(settings);
        obs_source_release(source);
        return true;
    }
    
    obs_data_release(settings);
    obs_source_release(source);
    return false;
}

// Load JavaScript file content
static bool load_js_file() {
    char *js_path = obs_module_file(JS_FILENAME);
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
    
    plugin_data->js_code = js_content;
    return true;
}

// Inject the JavaScript into a browser source
static bool inject_js_to_browser_source(obs_source_t *browser_source) {
    if (!browser_source || !plugin_data->js_code) return false;
    
    // Create the injection script
    char inject_script[65536]; // Large enough buffer for the script
    
    snprintf(inject_script, sizeof(inject_script),
             "(function() {\n"
             "    try {\n"
             "        const script = document.createElement('script');\n"
             "        script.text = `%s`;\n"
             "        document.head.appendChild(script);\n"
             "        return 'EloWard rank badges script injected';\n"
             "    } catch (err) {\n"
             "        return 'Error injecting EloWard script: ' + err.message;\n"
             "    }\n"
             "})();", plugin_data->js_code);
    
    // Execute in browser source
    calldata_t cd;
    calldata_init(&cd);
    calldata_set_string(&cd, "script", inject_script);
    
    proc_handler_t *ph = obs_source_get_proc_handler(browser_source);
    const char *result = NULL;
    
    if (ph) {
        proc_handler_call(ph, "execute_js", &cd, &result);
    }
    
    calldata_free(&cd);
    
    if (result) {
        blog(LOG_INFO, "EloWard Ranks: %s", result);
        return true;
    }
    
    return false;
}

// Find and inject into browser sources that might be showing chat
static void inject_into_chat_sources() {
    if (!plugin_data->js_code && !load_js_file()) {
        blog(LOG_ERROR, "EloWard Ranks: Failed to load JavaScript file");
        return;
    }
    
    // Only proceed if streamer is subscribed
    if (!plugin_data->streamer_subscribed) {
        blog(LOG_INFO, "EloWard Ranks: Streamer is not subscribed, not injecting");
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

// Thread function to check subscription and inject script
static void *poll_thread_func(void *data) {
    eloward_data_t *plugin = (eloward_data_t *)data;
    
    while (plugin && plugin->thread_running) {
        // Get current streamer
        char streamer_name[128] = {0};
        if (get_current_streamer(streamer_name, sizeof(streamer_name))) {
            // Check if streamer changed
            if (strcmp(streamer_name, plugin->current_streamer) != 0) {
                strncpy(plugin->current_streamer, streamer_name, sizeof(plugin->current_streamer)-1);
                plugin->current_streamer[sizeof(plugin->current_streamer)-1] = '\0';
                
                // Check if new streamer is subscribed
                plugin->streamer_subscribed = check_streamer_subscription(streamer_name);
                
                blog(LOG_INFO, "EloWard Ranks: Streamer changed to %s (Subscribed: %s)",
                     streamer_name, plugin->streamer_subscribed ? "Yes" : "No");
            }
            
            // Inject into chat sources if subscribed
            if (plugin->streamer_subscribed) {
                inject_into_chat_sources();
            }
        }
        
        // Wait for poll interval or stop event
        if (os_event_timedwait(plugin->stop_event, POLL_INTERVAL_MS) == 0) {
            break; // Stop event was triggered
        }
    }
    
    return NULL;
}

// Plugin source interface
static const char *rank_badges_get_name(void *unused) {
    UNUSED_PARAMETER(unused);
    return obs_module_text("EloWard Rank Badges");
}

static void rank_badges_update(void *data, obs_data_t *settings) {
    UNUSED_PARAMETER(data);
    UNUSED_PARAMETER(settings);
    // No settings to update
}

static void *rank_badges_create(obs_data_t *settings, obs_source_t *source) {
    UNUSED_PARAMETER(settings);
    UNUSED_PARAMETER(source);
    
    // Try injecting when a new instance is created
    inject_into_chat_sources();
    
    return plugin_data;
}

static void rank_badges_destroy(void *data) {
    UNUSED_PARAMETER(data);
    // Nothing to do here - cleanup happens in module unload
}

static obs_properties_t *rank_badges_properties(void *data) {
    UNUSED_PARAMETER(data);
    
    obs_properties_t *props = obs_properties_create();
    
    // Add a description 
    obs_properties_add_text(props, "description", 
                          obs_module_text("Description"), 
                          OBS_TEXT_INFO);
    
    // Add a button to check subscription
    obs_properties_add_button(props, "check_button", 
                            "Check Subscription", 
                            [](obs_properties_t *props, obs_property_t *property, void *data) {
                                UNUSED_PARAMETER(props);
                                UNUSED_PARAMETER(property);
                                UNUSED_PARAMETER(data);
                                
                                char streamer_name[128] = {0};
                                if (get_current_streamer(streamer_name, sizeof(streamer_name))) {
                                    plugin_data->streamer_subscribed = check_streamer_subscription(streamer_name);
                                    blog(LOG_INFO, "EloWard Ranks: Checked subscription for %s: %s",
                                         streamer_name, plugin_data->streamer_subscribed ? "Subscribed" : "Not Subscribed");
                                }
                                
                                return true;
                            });
    
    // Add a button to manually inject
    obs_properties_add_button(props, "inject_button", 
                            "Inject into Chat Sources", 
                            [](obs_properties_t *props, obs_property_t *property, void *data) {
                                UNUSED_PARAMETER(props);
                                UNUSED_PARAMETER(property);
                                UNUSED_PARAMETER(data);
                                
                                inject_into_chat_sources();
                                return true;
                            });
    
    return props;
}

static void rank_badges_defaults(obs_data_t *settings) {
    UNUSED_PARAMETER(settings);
    // No defaults needed
}

// Define the source info
static struct obs_source_info rank_badges_source_info = {
    .id = "eloward_rank_badges",
    .type = OBS_SOURCE_TYPE_INPUT,
    .output_flags = OBS_SOURCE_CUSTOM_DRAW,
    .get_name = rank_badges_get_name,
    .create = rank_badges_create,
    .destroy = rank_badges_destroy,
    .update = rank_badges_update,
    .get_properties = rank_badges_properties,
    .get_defaults = rank_badges_defaults,
};

// Called when a scene is changed
static void on_scene_change(enum obs_frontend_event event, void *data) {
    if (event == OBS_FRONTEND_EVENT_SCENE_CHANGED || 
        event == OBS_FRONTEND_EVENT_PREVIEW_SCENE_CHANGED) {
        // Wait a bit for browser sources to load
        blog(LOG_INFO, "EloWard Ranks: Scene changed, will inject after delay");
        
        // Use a simple timer
        pthread_t delay_thread;
        pthread_create(&delay_thread, NULL, [](void *) -> void* {
            os_sleep_ms(2000); // 2 second delay
            inject_into_chat_sources();
            return NULL;
        }, NULL);
        pthread_detach(delay_thread);
    }
}

// Initialize the plugin
bool obs_module_load(void) {
    // Initialize the plugin data
    plugin_data = bzalloc(sizeof(eloward_data_t));
    plugin_data->initialized = true;
    plugin_data->thread_running = true;
    plugin_data->streamer_subscribed = false;
    plugin_data->current_streamer[0] = '\0';
    plugin_data->js_code = NULL;
    
    // Load the JS file
    if (!load_js_file()) {
        blog(LOG_ERROR, "EloWard Ranks: Failed to load JavaScript file");
        bfree(plugin_data);
        plugin_data = NULL;
        return false;
    }
    
    // Create stop event for the thread
    if (os_event_init(&plugin_data->stop_event, OS_EVENT_TYPE_MANUAL) != 0) {
        blog(LOG_ERROR, "EloWard Ranks: Failed to create stop event");
        bfree(plugin_data->js_code);
        bfree(plugin_data);
        plugin_data = NULL;
        return false;
    }
    
    // Start the polling thread
    pthread_create(&plugin_data->poll_thread, NULL, poll_thread_func, plugin_data);
    
    // Register the source
    obs_register_source(&rank_badges_source_info);
    
    // Register for frontend events
    obs_frontend_add_event_callback(on_scene_change, NULL);
    
    // Initialize curl
    curl_global_init(CURL_GLOBAL_ALL);
    
    blog(LOG_INFO, "EloWard Rank Badges plugin loaded successfully");
    return true;
}

// Unload the plugin
void obs_module_unload(void) {
    if (plugin_data) {
        // Stop the polling thread
        plugin_data->thread_running = false;
        os_event_signal(plugin_data->stop_event);
        pthread_join(plugin_data->poll_thread, NULL);
        
        // Destroy the event
        os_event_destroy(plugin_data->stop_event);
        
        // Free JS code
        if (plugin_data->js_code) {
            bfree(plugin_data->js_code);
            plugin_data->js_code = NULL;
        }
        
        // Free plugin data
        bfree(plugin_data);
        plugin_data = NULL;
    }
    
    // Clean up curl
    curl_global_cleanup();
    
    blog(LOG_INFO, "EloWard Rank Badges plugin unloaded");
} 