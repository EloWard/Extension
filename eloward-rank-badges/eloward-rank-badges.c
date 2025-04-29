#include <obs-module.h>
#include <obs-frontend-api.h>
#include <util/platform.h>
#include <util/curl/curl.h>
#include <json.h>
#include <pthread.h>
#include <stdio.h>
#include <string.h>

#define RANK_API_URL "https://eloward-viewers-api.unleashai-inquiries.workers.dev/api/ranks/lol"
#define MAX_USERNAME_LEN 128
#define MAX_CHAT_MESSAGES 100
#define POLL_INTERVAL_MS 5000  // 5 seconds

OBS_DECLARE_MODULE()
OBS_MODULE_USE_DEFAULT_LOCALE("eloward-rank-badges", "en-US")

// Forward declarations from rank-badge-injector.c
extern bool injector_init();
extern void injector_free();
extern void inject_into_chat_sources();

typedef struct {
    char tier[32];
    char division[16];
    int lp;
} rank_info_t;

typedef struct {
    char username[MAX_USERNAME_LEN];
    rank_info_t rank;
    bool has_rank;
    uint64_t timestamp;
} user_rank_t;

typedef struct {
    bool initialized;
    bool thread_running;
    pthread_t poll_thread;
    os_event_t *stop_event;
} eloward_plugin_t;

static eloward_plugin_t *plugin_data = NULL;

// Thread function to periodically check for and inject into chat sources
static void *poll_thread_func(void *data) {
    eloward_plugin_t *plugin = (eloward_plugin_t *)data;
    
    while (plugin && plugin->thread_running) {
        // Check for and inject into chat sources
        inject_into_chat_sources();
        
        // Wait for poll interval or stop event
        if (os_event_timedwait(plugin->stop_event, POLL_INTERVAL_MS) == 0) {
            break; // Stop event was triggered
        }
    }
    
    return NULL;
}

// Register a source to render rank badges on chat
static const char *rank_badges_get_name(void *unused) {
    UNUSED_PARAMETER(unused);
    return obs_module_text("EloWard Rank Badges");
}

static void rank_badges_update(void *data, obs_data_t *settings) {
    UNUSED_PARAMETER(data);
    UNUSED_PARAMETER(settings);
    // No settings to update for now
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
    
    // Add a description of the plugin
    obs_properties_add_text(props, "description", 
                          obs_module_text("Description"), 
                          OBS_TEXT_INFO);
    
    // Add an action button to manually inject into chat sources
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
    // No defaults needed for now
}

// Define the source info
static struct obs_source_info rank_badges_source_info = {
    .id = "eloward_rank_badges",
    .type = OBS_SOURCE_TYPE_INPUT,
    .output_flags = OBS_SOURCE_VIDEO | OBS_SOURCE_CUSTOM_DRAW,
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
        
        // Use a simple timer to delay the injection
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
    // Initialize the JavaScript injector
    if (!injector_init()) {
        blog(LOG_ERROR, "EloWard Ranks: Failed to initialize script injector");
        return false;
    }
    
    // Initialize the plugin data
    plugin_data = bzalloc(sizeof(eloward_plugin_t));
    plugin_data->initialized = true;
    plugin_data->thread_running = true;
    
    // Create stop event for the thread
    if (os_event_init(&plugin_data->stop_event, OS_EVENT_TYPE_MANUAL) != 0) {
        blog(LOG_ERROR, "EloWard Ranks: Failed to create stop event");
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
        
        // Free plugin data
        bfree(plugin_data);
        plugin_data = NULL;
    }
    
    // Free JavaScript injector resources
    injector_free();
    
    // Clean up curl
    curl_global_cleanup();
    
    blog(LOG_INFO, "EloWard Rank Badges plugin unloaded");
} 