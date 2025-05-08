/*
EloWard Rank Badges OBS Plugin
Copyright (C) 2023 EloWard

This program is free software; you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation; either version 2 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License along
with this program. If not, see <https://www.gnu.org/licenses/>
*/

#include <obs-module.h>
#include <obs-frontend-api.h>
#include <util/platform.h>
#include <curl/curl.h>
#include <jansson.h>
#include <pthread.h>
#include <stdio.h>
#include <string.h>
#include <plugin-support.h>

#define SUBSCRIPTION_API_URL "https://eloward-subscription-api.unleashai-inquiries.workers.dev"
#define RANK_API_URL "https://eloward-viewers-api.unleashai-inquiries.workers.dev/api/ranks/lol"
#define POLL_INTERVAL_MS 5000  // 5 seconds
#define JS_FILENAME "eloward-rank-badges.js"
#define METRICS_ENDPOINT_DB_READ "/metrics/db_read"
#define METRICS_ENDPOINT_SUCCESSFUL_LOOKUP "/metrics/successful_lookup"
#define SUBSCRIPTION_VERIFY_ENDPOINT "/subscription/verify"

OBS_DECLARE_MODULE()
OBS_MODULE_USE_DEFAULT_LOCALE(PLUGIN_NAME, "en-US")

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
    char *plugin_path;
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
        obs_log(LOG_ERROR, "Failed to initialize curl for db_read counter");
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
            obs_log(LOG_ERROR, "Failed to parse db_read response JSON: %s", error.text);
        }
    } else {
        obs_log(LOG_ERROR, "db_read counter curl_easy_perform() failed: %s", curl_easy_strerror(res));
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
        obs_log(LOG_ERROR, "Failed to initialize curl for successful_lookup counter");
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
            obs_log(LOG_ERROR, "Failed to parse successful_lookup response JSON: %s", error.text);
        }
    } else {
        obs_log(LOG_ERROR, "successful_lookup counter curl_easy_perform() failed: %s", curl_easy_strerror(res));
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
        obs_log(LOG_ERROR, "Failed to initialize curl");
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
            obs_log(LOG_ERROR, "Failed to parse subscription JSON: %s", error.text);
        }
    } else {
        obs_log(LOG_ERROR, "curl_easy_perform() failed: %s", curl_easy_strerror(res));
    }
    
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    
    // Log subscription status
    obs_log(LOG_INFO, "%s is %s", streamer_name, subscribed ? "Subscribed ✅" : "Not Subscribed ❌");
    
    return subscribed;
}

// Try multiple methods to get the current streamer name from OBS
static bool get_current_streamer(char *streamer_name, size_t size) {
    // Method 1: Check streaming service settings
    obs_source_t *source = obs_frontend_get_streaming_output();
    if (source) {
        obs_data_t *settings = obs_source_get_settings(source);
        const char *service_name = obs_data_get_string(settings, "service");
        const char *username = obs_data_get_string(settings, "username");
        
        if (username && strlen(username) > 0) {
            strncpy(streamer_name, username, size - 1);
            streamer_name[size - 1] = '\0';
            obs_data_release(settings);
            obs_source_release(source);
            return true;
        }
        
        obs_data_release(settings);
        obs_source_release(source);
    }
    
    // Method 2: Try to get from Twitch Auth
    char *config_path = obs_module_config_path("");
    if (config_path) {
        char twitch_config[512];
        snprintf(twitch_config, sizeof(twitch_config), "%s/../../../config/plugin_config/rtmp-services/twitch_ingests.json", config_path);
        bfree(config_path);
        
        FILE *file = fopen(twitch_config, "r");
        if (file) {
            char buffer[4096] = {0};
            size_t len = fread(buffer, 1, 4096, file);
            fclose(file);
            
            if (len > 0) {
                json_error_t error;
                json_t *root = json_loads(buffer, 0, &error);
                
                if (root) {
                    json_t *identity = json_object_get(root, "identity");
                    if (json_is_object(identity)) {
                        json_t *username = json_object_get(identity, "username");
                        if (json_is_string(username)) {
                            const char *name = json_string_value(username);
                            strncpy(streamer_name, name, size - 1);
                            streamer_name[size - 1] = '\0';
                            json_decref(root);
                            return true;
                        }
                    }
                    json_decref(root);
                }
            }
        }
    }
    
    // Method 3: Check environment variables
    const char *twitch_username = getenv("TWITCH_USERNAME");
    if (twitch_username && strlen(twitch_username) > 0) {
        strncpy(streamer_name, twitch_username, size - 1);
        streamer_name[size - 1] = '\0';
        return true;
    }
    
    return false;
}

static bool load_js_file() {
    // Get the plugin data directory path
    char *data_path = obs_module_file("eloward-rank-badges.js");
    if (!data_path) {
        obs_log(LOG_ERROR, "Could not find plugin data path");
        return false;
    }
    
    // Open the file
    FILE *file = fopen(data_path, "rb");
    bfree(data_path);
    
    if (!file) {
        obs_log(LOG_ERROR, "Could not open JS file");
        return false;
    }
    
    // Get file size
    fseek(file, 0, SEEK_END);
    long file_size = ftell(file);
    fseek(file, 0, SEEK_SET);
    
    // Allocate memory for the file contents
    char *js_content = bmalloc(file_size + 1);
    size_t read_size = fread(js_content, 1, file_size, file);
    fclose(file);
    
    if (read_size != (size_t)file_size) {
        obs_log(LOG_ERROR, "Could not read JS file");
        bfree(js_content);
        return false;
    }
    
    js_content[file_size] = '\0';
    
    // Free previous JS code if it exists
    if (plugin_data->js_code) {
        bfree(plugin_data->js_code);
    }
    
    plugin_data->js_code = js_content;
    return true;
}

static bool inject_js_to_browser_source(obs_source_t *browser_source) {
    if (!browser_source || !plugin_data->js_code || !plugin_data->streamer_subscribed) {
        return false;
    }
    
    // Check if source is a browser source
    const char *id = obs_source_get_id(browser_source);
    if (strcmp(id, "browser_source") != 0) {
        return false;
    }
    
    // Get browser settings
    obs_data_t *settings = obs_source_get_settings(browser_source);
    const char *url = obs_data_get_string(settings, "url");
    
    // Only inject into Twitch chat browser sources
    if (!url || (!strstr(url, "twitch.tv") && !strstr(url, "twitch-chat") && !strstr(url, "streamelements.com/overlay/chat"))) {
        obs_data_release(settings);
        return false;
    }
    
    // Create config object for the JS
    char config_json[512];
    snprintf(config_json, sizeof(config_json), 
             "window.ELOWARD_CONFIG = {streamerName: '%s', isSubscribed: true, apiUrls: {rank: '%s', subscription: '%s'}};",
             plugin_data->current_streamer, RANK_API_URL, SUBSCRIPTION_API_URL);
    
    // Create resources path for images
    char resources_path[512];
    char *plugin_data_path = obs_module_file("data/images/ranks/");
    if (plugin_data_path) {
        snprintf(resources_path, sizeof(resources_path), 
                 "window.ELOWARD_RESOURCES_PATH = '%s';", 
                 plugin_data_path);
        bfree(plugin_data_path);
    } else {
        resources_path[0] = '\0';
    }
    
    // Create the complete JS to inject
    size_t js_total_len = strlen(config_json) + strlen(resources_path) + strlen(plugin_data->js_code) + 10;
    char *js_to_inject = bmalloc(js_total_len);
    
    snprintf(js_to_inject, js_total_len, "%s\n%s\n%s", config_json, resources_path, plugin_data->js_code);
    
    // Execute the JS in the browser source
    obs_data_t *inject_data = obs_data_create();
    obs_data_set_string(inject_data, "javascript", js_to_inject);
    obs_source_set_private_data(browser_source, inject_data);
    obs_source_call_proc(browser_source, "execute_js", inject_data);
    
    // Cleanup
    obs_data_release(inject_data);
    obs_data_release(settings);
    bfree(js_to_inject);
    
    return true;
}

static void inject_into_chat_sources() {
    struct inject_data {
        int count;
    };
    
    struct inject_data inject_count = { 0 };
    
    // Enumerate all sources and inject into browser sources
    obs_enum_sources(
        [](void *data, obs_source_t *source) {
            struct inject_data *inject_count = data;
            if (inject_js_to_browser_source(source)) {
                inject_count->count++;
            }
            return true;
        }, 
        &inject_count
    );
    
    if (inject_count.count > 0) {
        obs_log(LOG_INFO, "Injected into %d chat browser sources", inject_count.count);
    }
}

static void *poll_thread_func(void *data) {
    UNUSED_PARAMETER(data);
    
    while (os_event_try(plugin_data->stop_event) == EAGAIN) {
        // Poll for subscription status periodically
        if (strlen(plugin_data->current_streamer) > 0) {
            bool was_subscribed = plugin_data->streamer_subscribed;
            plugin_data->streamer_subscribed = check_streamer_subscription(plugin_data->current_streamer);
            
            // If subscription status changed, re-inject
            if (was_subscribed != plugin_data->streamer_subscribed) {
                if (plugin_data->streamer_subscribed) {
                    obs_log(LOG_INFO, "Subscription status changed, re-injecting");
                    inject_into_chat_sources();
                } else {
                    obs_log(LOG_INFO, "Subscription expired");
                }
            }
        }
        
        // Sleep for the polling interval
        os_sleep_ms(POLL_INTERVAL_MS);
    }
    
    return NULL;
}

static void rank_badges_update(void *data, obs_data_t *settings) {
    UNUSED_PARAMETER(data);
    UNUSED_PARAMETER(settings);
    
    if (!plugin_data) return;
    
    // Get the current streamer name
    char streamer_name[128] = {0};
    if (get_current_streamer(streamer_name, sizeof(streamer_name))) {
        // Check if streamer changed
        if (strcmp(plugin_data->current_streamer, streamer_name) != 0) {
            strncpy(plugin_data->current_streamer, streamer_name, sizeof(plugin_data->current_streamer) - 1);
            plugin_data->current_streamer[sizeof(plugin_data->current_streamer) - 1] = '\0';
            
            // Check subscription status for the new streamer
            plugin_data->streamer_subscribed = check_streamer_subscription(plugin_data->current_streamer);
        }
    }
    
    // If subscribed, inject JS into browser sources
    if (plugin_data->streamer_subscribed) {
        inject_into_chat_sources();
    }
}

static void rank_badges_destroy(void *data) {
    UNUSED_PARAMETER(data);
    
    if (plugin_data) {
        if (plugin_data->thread_running) {
            os_event_signal(plugin_data->stop_event);
            pthread_join(plugin_data->poll_thread, NULL);
        }
        
        if (plugin_data->stop_event) {
            os_event_destroy(plugin_data->stop_event);
        }
        
        if (plugin_data->js_code) {
            bfree(plugin_data->js_code);
        }
        
        if (plugin_data->plugin_path) {
            bfree(plugin_data->plugin_path);
        }
        
        bfree(plugin_data);
        plugin_data = NULL;
    }
}

static void rank_badges_get_defaults(obs_data_t *settings) {
    UNUSED_PARAMETER(settings);
}

static obs_properties_t *rank_badges_get_properties(void *data) {
    UNUSED_PARAMETER(data);
    
    obs_properties_t *props = obs_properties_create();
    
    // Add a descriptive text
    obs_properties_add_text(props, "description", 
                           "EloWard Rank Badges for OBS", 
                           OBS_TEXT_INFO);
    
    return props;
}

static struct obs_source_info rank_badges_source_info = {
    .id = "eloward_rank_badges",
    .type = OBS_SOURCE_TYPE_INPUT,
    .output_flags = OBS_SOURCE_CUSTOM_DRAW,
    .get_name = [](void *) { return "EloWard Rank Badges"; },
    .create = [](obs_data_t *settings, obs_source_t *source) {
        UNUSED_PARAMETER(settings);
        UNUSED_PARAMETER(source);
        return (void *)1; // Dummy pointer
    },
    .destroy = rank_badges_destroy,
    .update = rank_badges_update,
    .get_defaults = rank_badges_get_defaults,
    .get_properties = rank_badges_get_properties
};

static void on_scene_change(enum obs_frontend_event event, void *data) {
    UNUSED_PARAMETER(data);
    
    if (!plugin_data || !plugin_data->initialized) {
        return;
    }
    
    switch (event) {
        case OBS_FRONTEND_EVENT_SCENE_CHANGED:
        case OBS_FRONTEND_EVENT_PREVIEW_SCENE_CHANGED:
        case OBS_FRONTEND_EVENT_STUDIO_MODE_ENABLED:
        case OBS_FRONTEND_EVENT_STUDIO_MODE_DISABLED:
        case OBS_FRONTEND_EVENT_SCENE_COLLECTION_CHANGED:
        case OBS_FRONTEND_EVENT_SCENE_COLLECTION_CLEANUP:
            // Re-inject into sources when scene changes
            if (plugin_data->streamer_subscribed) {
                inject_into_chat_sources();
            }
            break;
            
        case OBS_FRONTEND_EVENT_STREAMING_STARTED:
            // Reset counters when streaming starts
            plugin_data->db_reads = 0;
            plugin_data->successful_reads = 0;
            
            // Check streamer and subscription
            char streamer_name[128] = {0};
            if (get_current_streamer(streamer_name, sizeof(streamer_name))) {
                strncpy(plugin_data->current_streamer, streamer_name, sizeof(plugin_data->current_streamer) - 1);
                plugin_data->current_streamer[sizeof(plugin_data->current_streamer) - 1] = '\0';
                plugin_data->streamer_subscribed = check_streamer_subscription(plugin_data->current_streamer);
                
                if (plugin_data->streamer_subscribed) {
                    inject_into_chat_sources();
                }
            }
            break;
            
        default:
            break;
    }
}

bool obs_module_load(void) {
	obs_log(LOG_INFO, "plugin loaded successfully (version %s)", PLUGIN_VERSION);

    // Initialize libcurl
    curl_global_init(CURL_GLOBAL_DEFAULT);
    
    // Register frontend event callback
    obs_frontend_add_event_callback(on_scene_change, NULL);
    
    // Create plugin data structure
    plugin_data = bzalloc(sizeof(eloward_data_t));
    plugin_data->initialized = false;
    plugin_data->thread_running = false;
    plugin_data->js_code = NULL;
    plugin_data->current_streamer[0] = '\0';
    plugin_data->streamer_subscribed = false;
    plugin_data->db_reads = 0;
    plugin_data->successful_reads = 0;
    
    // Get plugin path for resources
    plugin_data->plugin_path = bstrdup(obs_module_file(""));
    
    // Load JS code
    if (!load_js_file()) {
        obs_log(LOG_ERROR, "Failed to load JS file");
        rank_badges_destroy(NULL);
        return false;
    }
    
    // Create stop event for thread
    if (os_event_init(&plugin_data->stop_event, OS_EVENT_TYPE_MANUAL) != 0) {
        obs_log(LOG_ERROR, "Failed to create thread stop event");
        rank_badges_destroy(NULL);
        return false;
    }
    
    // Register the source
    obs_register_source(&rank_badges_source_info);
    
    // Create and start the poll thread
    if (pthread_create(&plugin_data->poll_thread, NULL, poll_thread_func, NULL) != 0) {
        obs_log(LOG_ERROR, "Failed to create poll thread");
        rank_badges_destroy(NULL);
        return false;
    }
    
    plugin_data->thread_running = true;
    plugin_data->initialized = true;
    
    obs_log(LOG_INFO, "Plugin initialized successfully");
    
	return true;
}

void obs_module_unload(void) {
	obs_log(LOG_INFO, "plugin unloaded");
    
    // Clean up
    if (plugin_data) {
        rank_badges_destroy(NULL);
    }
    
    // Remove frontend event callback
    obs_frontend_remove_event_callback(on_scene_change, NULL);
    
    // Clean up libcurl
    curl_global_cleanup();
}
