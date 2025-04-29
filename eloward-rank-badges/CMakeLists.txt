cmake_minimum_required(VERSION 3.16)

project(eloward-rank-badges VERSION 1.0.0)

# Include OBS dependencies
find_package(libobs REQUIRED)
find_package(CURL REQUIRED)
find_package(JANSSON REQUIRED)

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
    libobs
    ${CURL_LIBRARIES}
    ${JANSSON_LIBRARIES}
)

# Set up install locations
set_target_properties(${PROJECT_NAME} PROPERTIES
    PREFIX ""
    FOLDER "plugins"
)

# Define the installation target
install(TARGETS ${PROJECT_NAME}
    LIBRARY DESTINATION "${OBS_PLUGIN_DESTINATION}"
)

# Install data files
install(DIRECTORY data/
    DESTINATION "${OBS_DATA_DESTINATION}/obs-plugins/${PROJECT_NAME}"
)

# Install JavaScript file
install(FILES eloward-rank-badges.js
    DESTINATION "${OBS_DATA_DESTINATION}/obs-plugins/${PROJECT_NAME}"
)

# Copy files to output directory
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