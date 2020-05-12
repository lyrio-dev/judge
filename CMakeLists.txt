project(builtin_checkers)
cmake_minimum_required(VERSION 3.0)

set(CMAKE_CXX_STANDARD 17)

include_directories(${CMAKE_JS_INC})
file(GLOB SOURCE_FILES "native/builtin_checkers.cc" "native/builtin_checkers/*.h")
add_library(${PROJECT_NAME} SHARED ${SOURCE_FILES} ${CMAKE_JS_SRC})
set_target_properties(${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")

set(JSON_BuildTests OFF CACHE INTERNAL "")

# Include N-API wrappers
target_include_directories(${PROJECT_NAME} PRIVATE 
    ${CMAKE_SOURCE_DIR}/node_modules/node-addon-api 
    ${CMAKE_SOURCE_DIR}/node_modules/node-addon-api/src
    ${CMAKE_JS_INC}
    "vendor/testlib")
target_link_libraries(${PROJECT_NAME} PRIVATE ${CMAKE_JS_LIB})
