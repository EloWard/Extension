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
#define METRICS_ENDPOINT_DB_READ "/metrics/db_read"
#define METRICS_ENDPOINT_SUCCESSFUL_LOOKUP "/metrics/successful_lookup"
#define SUBSCRIPTION_VERIFY_ENDPOINT "/subscription/verify"

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
    unsigned int db_reads;
    unsigned int successful_reads;
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

// Increment db_read counter via the API
static bool increment_db_read_counter(const char *streamer_name) {
    if (!streamer_name || !strlen(streamer_name)) return false;
    
    CURL *curl;
    CURLcode res;
    char url[512];
    char post_data[256];
    char response_buffer[512] = {0};
    bool success = false;
    
    // Format URL to increment db_read counter
    snprintf(url, sizeof(url), "%s%s", SUBSCRIPTION_API_URL, METRICS_ENDPOINT_DB_READ);
    
    // Format post data
    snprintf(post_data, sizeof(post_data), "{\"channel_name\":\"%s\"}", streamer_name);
    
    curl = curl_easy_init();
    if (!curl) {
        blog(LOG_ERROR, "EloWard Ranks: Failed to initialize curl for db_read counter");
        return false;
    }
    
    struct curl_slist *headers = NULL;
    headers = curl_slist_append(headers, "Content-Type: application/json");
    
    curl_easy_setopt(curl, CURLOPT_URL, url);
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, post_data);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_callback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, response_buffer);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 5L);
    
    res = curl_easy_perform(curl);
    
    if (res == CURLE_OK) {
        // Parse JSON response
        json_error_t error;
        json_t *root = json_loads(response_buffer, 0, &error);
        
        if (root) {
            json_t *success_json = json_object_get(root, "success");
            
            if (json_is_boolean(success_json)) {
                success = json_boolean_value(success_json);
            }
            
            json_decref(root);
        } else {
            blog(LOG_ERROR, "EloWard Ranks: Failed to parse db_read response JSON: %s", error.text);
        }
    } else {
        blog(LOG_ERROR, "EloWard Ranks: db_read counter curl_easy_perform() failed: %s", curl_easy_strerror(res));
    }
    
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    
    if (success) {
        plugin_data->db_reads++;
    }
    
    return success;
}

// Increment successful_lookup counter via the API
static bool increment_successful_lookup_counter(const char *streamer_name) {
    if (!streamer_name || !strlen(streamer_name)) return false;
    
    CURL *curl;
    CURLcode res;
    char url[512];
    char post_data[256];
    char response_buffer[512] = {0};
    bool success = false;
    
    // Format URL to increment successful_lookup counter
    snprintf(url, sizeof(url), "%s%s", SUBSCRIPTION_API_URL, METRICS_ENDPOINT_SUCCESSFUL_LOOKUP);
    
    // Format post data
    snprintf(post_data, sizeof(post_data), "{\"channel_name\":\"%s\"}", streamer_name);
    
    curl = curl_easy_init();
    if (!curl) {
        blog(LOG_ERROR, "EloWard Ranks: Failed to initialize curl for successful_lookup counter");
        return false;
    }
    
    struct curl_slist *headers = NULL;
    headers = curl_slist_append(headers, "Content-Type: application/json");
    
    curl_easy_setopt(curl, CURLOPT_URL, url);
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, post_data);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_callback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, response_buffer);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 5L);
    
    res = curl_easy_perform(curl);
    
    if (res == CURLE_OK) {
        // Parse JSON response
        json_error_t error;
        json_t *root = json_loads(response_buffer, 0, &error);
        
        if (root) {
            json_t *success_json = json_object_get(root, "success");
            
            if (json_is_boolean(success_json)) {
                success = json_boolean_value(success_json);
            }
            
            json_decref(root);
        } else {
            blog(LOG_ERROR, "EloWard Ranks: Failed to parse successful_lookup response JSON: %s", error.text);
        }
    } else {
        blog(LOG_ERROR, "EloWard Ranks: successful_lookup counter curl_easy_perform() failed: %s", curl_easy_strerror(res));
    }
    
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    
    if (success) {
        plugin_data->successful_reads++;
    }
    
    return success;
}

// Check if a streamer is subscribed to EloWard
static bool check_streamer_subscription(const char *streamer_name) {
    if (!streamer_name || !strlen(streamer_name)) return false;
    
    CURL *curl;
    CURLcode res;
    char url[512];
    char post_data[256];
    char response_buffer[2048] = {0};
    bool subscribed = false;
    
    // Increment db_read counter for subscription check
    increment_db_read_counter(streamer_name);
    
    // Format URL to check subscription
    snprintf(url, sizeof(url), "%s%s", SUBSCRIPTION_API_URL, SUBSCRIPTION_VERIFY_ENDPOINT);
    
    // Format post data
    snprintf(post_data, sizeof(post_data), "{\"channel_name\":\"%s\"}", streamer_name);
    
    curl = curl_easy_init();
    if (!curl) {
        blog(LOG_ERROR, "EloWard Ranks: Failed to initialize curl");
        return false;
    }
    
    struct curl_slist *headers = NULL;
    headers = curl_slist_append(headers, "Content-Type: application/json");
    
    curl_easy_setopt(curl, CURLOPT_URL, url);
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, post_data);
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
    
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    
    // Log subscription status
    blog(LOG_INFO, "EloWard Ranks: %s is %s", streamer_name, subscribed ? "Subscribed ✅" : "Not Subscribed ❌");
    
    return subscribed;
}

// Try multiple methods to get the current streamer name from OBS
static bool get_current_streamer(char *streamer_name, size_t size) {
    // Method 1: Check streaming service settings
    obs_source_t *source = obs_frontend_get_streaming_output();
    if (source) {
        obs_data_t *settings = obs_source_get_settings(source);
        const char *service_name = obs_data_get_string(settings, "service");
        
        // This might be the service name, not the username, but try it
        if (service_name && strlen(service_name) > 0 && strlen(service_name) < size) {
            strncpy(streamer_name, service_name, size-1);
            streamer_name[size-1] = '\0';
            obs_data_release(settings);
            obs_source_release(source);
            return true;
        }
        
        // Try to get username from stream settings
        const char *username = obs_data_get_string(settings, "username");
        if (username && strlen(username) > 0 && strlen(username) < size) {
            strncpy(streamer_name, username, size-1);
            streamer_name[size-1] = '\0';
            obs_data_release(settings);
            obs_source_release(source);
            return true;
        }
        
        obs_data_release(settings);
        obs_source_release(source);
    }
    
    // Method 2: Check profile name (might be the streamer's name)
    const char *profile_name = obs_frontend_get_current_profile_name();
    if (profile_name && strlen(profile_name) > 0 && strlen(profile_name) < size) {
        strncpy(streamer_name, profile_name, size-1);
        streamer_name[size-1] = '\0';
        return true;
    }
    
    // Method 3: Check global settings for a specified streamer name
    obs_data_t *global_settings = obs_frontend_get_global_config();
    if (global_settings) {
        const char *global_name = obs_data_get_string(global_settings, "ElowardStreamerName");
        if (global_name && strlen(global_name) > 0 && strlen(global_name) < size) {
            strncpy(streamer_name, global_name, size-1);
            streamer_name[size-1] = '\0';
            obs_data_release(global_settings);
            return true;
        }
        obs_data_release(global_settings);
    }
    
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

// Inject the JavaScript into a browser source with updated parameters
static bool inject_js_to_browser_source(obs_source_t *browser_source) {
    if (!browser_source || !plugin_data->js_code) return false;
    
    // Create the injection script with streamer name parameter for the JS
    char inject_script[65536]; // Large enough buffer for the script
    
    snprintf(inject_script, sizeof(inject_script),
             "(function() {\n"
             "    try {\n"
             "        const script = document.createElement('script');\n"
             "        script.text = `\n"
             "            window.ELOWARD_CONFIG = {\n"
             "                streamerName: '%s',\n"
             "                isSubscribed: %s,\n"
             "                apiUrls: {\n"
             "                    rank: '%s',\n"
             "                    subscription: '%s'\n"
             "                }\n"
             "            };\n"
             "            %s\n"
             "        `;\n"
             "        document.head.appendChild(script);\n"
             "        return 'EloWard rank badges script injected';\n"
             "    } catch (err) {\n"
             "        return 'Error injecting EloWard script: ' + err.message;\n"
             "    }\n"
             "})();", 
             plugin_data->current_streamer,
             plugin_data->streamer_subscribed ? "true" : "false",
             RANK_API_URL,
             SUBSCRIPTION_API_URL,
             plugin_data->js_code);
    
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
                    // Look for browser sources that might be showing chat
                    if (strstr(name, "chat") || strstr(name, "Chat") || 
                        strstr(name, "twitch") || strstr(name, "Twitch")) {
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

static void *rank_badges_create(obs_data_t *settings, obs_source_t *source) {
    UNUSED_PARAMETER(settings);
    UNUSED_PARAMETER(source);
    
    // Return plugin_data which will be initialized in obs_module_load
    return plugin_data;
}

static void rank_badges_update(void *data, obs_data_t *settings) {
    UNUSED_PARAMETER(data);
    UNUSED_PARAMETER(settings);
    
    // Store streamer name if provided in settings
    const char *streamer_setting = obs_data_get_string(settings, "streamer_name");
    if (streamer_setting && strlen(streamer_setting) > 0) {
        // Store in global config for persistence
        obs_data_t *global_config = obs_frontend_get_global_config();
        if (global_config) {
            obs_data_set_string(global_config, "ElowardStreamerName", streamer_setting);
            obs_data_release(global_config);
        }
        
        // Update current streamer and check subscription right away
        if (strcmp(streamer_setting, plugin_data->current_streamer) != 0) {
            strncpy(plugin_data->current_streamer, streamer_setting, sizeof(plugin_data->current_streamer)-1);
            plugin_data->current_streamer[sizeof(plugin_data->current_streamer)-1] = '\0';
            plugin_data->streamer_subscribed = check_streamer_subscription(streamer_setting);
            
            blog(LOG_INFO, "EloWard Ranks: Streamer set to %s (Subscribed: %s)",
                 streamer_setting, plugin_data->streamer_subscribed ? "Yes" : "No");
        }
    }
}

static void rank_badges_destroy(void *data) {
    UNUSED_PARAMETER(data);
    // Actual cleanup is done in obs_module_unload
}

static void rank_badges_get_defaults(obs_data_t *settings) {
    // Set default values for settings
    obs_data_set_default_string(settings, "streamer_name", "");
}

static obs_properties_t *rank_badges_get_properties(void *data) {
    UNUSED_PARAMETER(data);
    
    obs_properties_t *props = obs_properties_create();
    
    // Add streamer name input
    obs_properties_add_text(props, "streamer_name", 
                            obs_module_text("Streamer Name"), OBS_TEXT_DEFAULT);
    
    // Add status info
    obs_properties_add_text(props, "subscription_status", 
                            obs_module_text("Subscription Status"), OBS_TEXT_INFO);
    
    // Add DB read counter info
    obs_properties_add_text(props, "db_reads_info", 
                            obs_module_text("Database Reads"), OBS_TEXT_INFO);
    
    // Add successful reads counter info
    obs_properties_add_text(props, "successful_reads_info", 
                            obs_module_text("Successful Lookups"), OBS_TEXT_INFO);
    
    return props;
}

static void rank_badges_show_properties(void *data, bool visible) {
    UNUSED_PARAMETER(data);
    UNUSED_PARAMETER(visible);
    
    // Update property values if visible
    if (visible && plugin_data) {
        obs_source_t *source = obs_get_source_by_name("EloWard Rank Badges");
        if (source) {
            obs_data_t *settings = obs_source_get_settings(source);
            
            // Update subscription status
            char status_text[128];
            snprintf(status_text, sizeof(status_text), 
                     "%s %s", 
                     plugin_data->current_streamer,
                     plugin_data->streamer_subscribed ? "(Subscribed)" : "(Not Subscribed)");
            obs_data_set_string(settings, "subscription_status", status_text);
            
            // Update counter values
            char db_reads_text[64];
            snprintf(db_reads_text, sizeof(db_reads_text), 
                     "DB Reads: %u", plugin_data->db_reads);
            obs_data_set_string(settings, "db_reads_info", db_reads_text);
            
            char successful_reads_text[64];
            snprintf(successful_reads_text, sizeof(successful_reads_text), 
                     "Successful Lookups: %u", plugin_data->successful_reads);
            obs_data_set_string(settings, "successful_reads_info", successful_reads_text);
            
            obs_source_update(source, settings);
            obs_data_release(settings);
            obs_source_release(source);
        }
    }
}

static struct obs_source_info rank_badges_source_info = {
    .id = "eloward_rank_badges",
    .type = OBS_SOURCE_TYPE_INPUT,
    .output_flags = OBS_SOURCE_CAP_DISABLED,
    .get_name = rank_badges_get_name,
    .create = rank_badges_create,
    .destroy = rank_badges_destroy,
    .get_defaults = rank_badges_get_defaults,
    .get_properties = rank_badges_get_properties,
    .update = rank_badges_update,
    .show_properties = rank_badges_show_properties
};

// Handle frontend events
static void on_scene_change(enum obs_frontend_event event, void *data) {
    UNUSED_PARAMETER(data);
    
    switch (event) {
        case OBS_FRONTEND_EVENT_SCENE_CHANGED:
        case OBS_FRONTEND_EVENT_TRANSITION_STOPPED:
            // Inject on scene change if initialized and subscribed
            if (plugin_data && plugin_data->initialized && plugin_data->streamer_subscribed) {
                inject_into_chat_sources();
            }
            break;
            
        case OBS_FRONTEND_EVENT_STREAMING_STARTED:
            // Check/update streamer name when streaming starts
            if (plugin_data && plugin_data->initialized) {
                char streamer_name[128] = {0};
                if (get_current_streamer(streamer_name, sizeof(streamer_name))) {
                    if (strcmp(streamer_name, plugin_data->current_streamer) != 0) {
                        strncpy(plugin_data->current_streamer, streamer_name, sizeof(plugin_data->current_streamer)-1);
                        plugin_data->current_streamer[sizeof(plugin_data->current_streamer)-1] = '\0';
                        plugin_data->streamer_subscribed = check_streamer_subscription(streamer_name);
                        
                        blog(LOG_INFO, "EloWard Ranks: Streaming started as %s (Subscribed: %s)",
                            streamer_name, plugin_data->streamer_subscribed ? "Yes" : "No");
                    }
                }
            }
            break;
            
        default:
            break;
    }
}

bool obs_module_load(void) {
    blog(LOG_INFO, "EloWard Rank Badges plugin loaded");
    
    // Initialize plugin data
    plugin_data = bzalloc(sizeof(eloward_data_t));
    plugin_data->initialized = false;
    plugin_data->thread_running = false;
    plugin_data->js_code = NULL;
    plugin_data->current_streamer[0] = '\0';
    plugin_data->streamer_subscribed = false;
    plugin_data->db_reads = 0;
    plugin_data->successful_reads = 0;
    
    // Create stop event for the polling thread
    os_event_init(&plugin_data->stop_event, OS_EVENT_TYPE_MANUAL);
    
    // Register the OBS source
    obs_register_source(&rank_badges_source_info);
    
    // Register frontend event callback
    obs_frontend_add_event_callback(on_scene_change, NULL);
    
    // Try to load JavaScript file
    if (!load_js_file()) {
        blog(LOG_ERROR, "EloWard Ranks: Failed to load JavaScript file");
    }
    
    // Get initial streamer name
    char streamer_name[128] = {0};
    if (get_current_streamer(streamer_name, sizeof(streamer_name))) {
        strncpy(plugin_data->current_streamer, streamer_name, sizeof(plugin_data->current_streamer)-1);
        plugin_data->current_streamer[sizeof(plugin_data->current_streamer)-1] = '\0';
        
        // Check if streamer is subscribed
        plugin_data->streamer_subscribed = check_streamer_subscription(streamer_name);
        
        blog(LOG_INFO, "EloWard Ranks: Initial streamer set to %s (Subscribed: %s)",
             streamer_name, plugin_data->streamer_subscribed ? "Yes" : "No");
    }
    
    // Start polling thread
    plugin_data->thread_running = true;
    pthread_create(&plugin_data->poll_thread, NULL, poll_thread_func, plugin_data);
    
    plugin_data->initialized = true;
    
    return true;
}

void obs_module_unload(void) {
    if (plugin_data) {
        // Stop polling thread
        if (plugin_data->thread_running) {
            plugin_data->thread_running = false;
            os_event_signal(plugin_data->stop_event);
            pthread_join(plugin_data->poll_thread, NULL);
        }
        
        // Clean up stop event
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
    
    blog(LOG_INFO, "EloWard Rank Badges plugin unloaded");
} 