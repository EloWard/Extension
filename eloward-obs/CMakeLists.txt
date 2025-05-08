cmake_minimum_required(VERSION 3.28...3.30)

include("${CMAKE_CURRENT_SOURCE_DIR}/cmake/common/bootstrap.cmake" NO_POLICY_SCOPE)

project(eloward-obs VERSION ${_version})

option(ENABLE_FRONTEND_API "Use obs-frontend-api for UI functionality" ON)
option(ENABLE_QT "Use Qt functionality" OFF)

include(compilerconfig)
include(defaults)
include(helpers)

add_library(${CMAKE_PROJECT_NAME} MODULE)

find_package(libobs REQUIRED)
target_link_libraries(${CMAKE_PROJECT_NAME} PRIVATE OBS::libobs)

# Find CURL
find_package(CURL REQUIRED)
include_directories(${CURL_INCLUDE_DIRS})
target_link_libraries(${CMAKE_PROJECT_NAME} PRIVATE ${CURL_LIBRARIES})

# Find Jansson (JSON library)
find_package(PkgConfig REQUIRED)
pkg_check_modules(JANSSON REQUIRED IMPORTED_TARGET jansson)
target_link_libraries(${CMAKE_PROJECT_NAME} PRIVATE PkgConfig::JANSSON)

if(ENABLE_FRONTEND_API)
  find_package(obs-frontend-api REQUIRED)
  target_link_libraries(${CMAKE_PROJECT_NAME} PRIVATE OBS::obs-frontend-api)
endif()

if(ENABLE_QT)
  find_package(Qt6 COMPONENTS Widgets Core)
  target_link_libraries(${CMAKE_PROJECT_NAME} PRIVATE Qt6::Core Qt6::Widgets)
  target_compile_options(
    ${CMAKE_PROJECT_NAME}
    PRIVATE $<$<C_COMPILER_ID:Clang,AppleClang>:-Wno-quoted-include-in-framework-header -Wno-comma>
  )
  set_target_properties(
    ${CMAKE_PROJECT_NAME}
    PROPERTIES AUTOMOC ON AUTOUIC ON AUTORCC ON
  )
endif()

target_sources(${CMAKE_PROJECT_NAME} PRIVATE src/plugin-main.c)

# Copy data files to output directory
set_target_properties_plugin(${CMAKE_PROJECT_NAME} PROPERTIES OUTPUT_NAME "eloward-rank-badges")

# Configure data file installation
set(PLUGIN_DATA_FILES
  "${CMAKE_CURRENT_SOURCE_DIR}/data/eloward-rank-badges.js"
)

# Copy data files to the build directory
add_custom_command(TARGET ${CMAKE_PROJECT_NAME} POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E make_directory "$<TARGET_FILE_DIR:${CMAKE_PROJECT_NAME}>/data/images/ranks"
  COMMAND ${CMAKE_COMMAND} -E copy_if_different "${CMAKE_CURRENT_SOURCE_DIR}/data/eloward-rank-badges.js" "$<TARGET_FILE_DIR:${CMAKE_PROJECT_NAME}>"
)

# Define installation targets for data files
if(OS_WINDOWS)
  install(FILES ${PLUGIN_DATA_FILES} DESTINATION ".")
  install(DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/data/images" DESTINATION "data")
elseif(OS_MACOS)
  install(FILES ${PLUGIN_DATA_FILES} DESTINATION ".")
  install(DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/data/images" DESTINATION "data")
elseif(OS_LINUX OR OS_FREEBSD)
  install(FILES ${PLUGIN_DATA_FILES} DESTINATION "share/obs/obs-plugins/${CMAKE_PROJECT_NAME}")
  install(DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/data/images" DESTINATION "share/obs/obs-plugins/${CMAKE_PROJECT_NAME}/data")
endif()
