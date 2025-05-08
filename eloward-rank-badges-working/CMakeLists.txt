cmake_minimum_required(VERSION 3.16)

project(eloward-rank-badges VERSION 1.0.0)

# Development: include OBS source headers for libobs and frontend API when building locally
include_directories(
    "${CMAKE_SOURCE_DIR}/../obs-studio/libobs"
    "${CMAKE_SOURCE_DIR}/../obs-studio/frontend/api"
)

# Include OBS dependencies
find_package(libobs REQUIRED)
find_package(CURL REQUIRED)
# JSON library (Jansson) via pkg-config
find_package(PkgConfig REQUIRED)
pkg_check_modules(JANSSON REQUIRED jansson)

# Development fallback: if OBS_INCLUDE_DIRS/LIBRARIES are not set, point to local obs-studio clone
if(NOT OBS_INCLUDE_DIRS)
    message(STATUS "OBS_INCLUDE_DIRS not defined; using libobs and frontend/api")
    set(OBS_INCLUDE_DIRS
        "${CMAKE_SOURCE_DIR}/../obs-studio/libobs"
        "${CMAKE_SOURCE_DIR}/../obs-studio/frontend/api"
    )
endif()
if(NOT OBS_LIBRARIES)
    message(STATUS "OBS_LIBRARIES not defined; using ../obs-studio/build/libobs/RelWithDebInfo/libobs.dylib")
    set(OBS_LIBRARIES "${CMAKE_SOURCE_DIR}/../obs-studio/build/libobs/RelWithDebInfo/libobs.dylib")
endif()

set(CMAKE_CXX_STANDARD 11)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Set plugin sources
set(PLUGIN_SOURCES
    eloward-rank-badges.c
)

# Add resource files
set(PLUGIN_RESOURCES
    data/locale/en-US.ini
    eloward-rank-badges.js
)

# Set output directory
set(PLUGIN_OUTPUT_DIR "${CMAKE_BINARY_DIR}/plugins/eloward-rank-badges")

# Add the plugin module
add_library(${PROJECT_NAME} MODULE
    ${PLUGIN_SOURCES}
)

# Include directories
target_include_directories(${PROJECT_NAME} PRIVATE
    ${OBS_INCLUDE_DIRS}
    ${CURL_INCLUDE_DIRS}
    ${JANSSON_INCLUDE_DIRS}
)

# Link libraries
target_link_libraries(${PROJECT_NAME}
    ${OBS_LIBRARIES}
    ${CURL_LIBRARIES}
    ${JANSSON_LIBRARIES}
)

# Copy files to output directory (Development)
add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "${PLUGIN_OUTPUT_DIR}/data/locale"
    COMMAND ${CMAKE_COMMAND} -E copy_directory "${CMAKE_SOURCE_DIR}/data/locale" "${PLUGIN_OUTPUT_DIR}/data/locale"
    COMMAND ${CMAKE_COMMAND} -E copy "${CMAKE_SOURCE_DIR}/eloward-rank-badges.js" "${PLUGIN_OUTPUT_DIR}"
)

# Platform-specific settings
if(APPLE)
    set_target_properties(${PROJECT_NAME} PROPERTIES
        BUNDLE TRUE
    )
elseif(WIN32)
    # Windows-specific settings
endif() 