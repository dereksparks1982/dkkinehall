cmake_minimum_required(VERSION 3.21)
project(DKKinehall VERSION 2.0 LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
find_package(Qt6 6.4 REQUIRED COMPONENTS Widgets OpenGLWidgets OpenGL Network)
# A maintainer can supply the LGPL libmpv SDK produced by the pinned
# third_party/mpv-prebuilt source. End users never install it themselves.
set(DK_LIBMPV_SDK_DIR "" CACHE PATH "Bundled LGPL libmpv SDK root")
if(DK_LIBMPV_SDK_DIR)
  if(NOT EXISTS "${DK_LIBMPV_SDK_DIR}/lib/libmpv.so" OR
     NOT EXISTS "${DK_LIBMPV_SDK_DIR}/include/mpv/client.h")
    message(FATAL_ERROR "Bundled libmpv SDK is incomplete")
  endif()
  add_library(DKKinehallMpv SHARED IMPORTED GLOBAL)
  set_target_properties(DKKinehallMpv PROPERTIES
    IMPORTED_LOCATION "${DK_LIBMPV_SDK_DIR}/lib/libmpv.so"
    INTERFACE_INCLUDE_DIRECTORIES "${DK_LIBMPV_SDK_DIR}/include")
  set(DK_MPV_TARGET DKKinehallMpv)
else()
  find_package(PkgConfig REQUIRED)
  pkg_check_modules(MPV REQUIRED IMPORTED_TARGET mpv)
  set(DK_MPV_TARGET PkgConfig::MPV)
endif()
add_executable(dk-kinehall
  src/main.cpp
  src/MainWindow.h src/MainWindow.cpp
  src/MpvWidget.h src/MpvWidget.cpp
  src/EpisodeMetadata.h src/EpisodeMetadata.cpp
)
target_compile_definitions(dk-kinehall PRIVATE
  QT_NO_CAST_FROM_ASCII QT_NO_CAST_TO_ASCII)
target_link_libraries(dk-kinehall PRIVATE
  Qt6::Widgets Qt6::OpenGLWidgets Qt6::OpenGL Qt6::Network ${DK_MPV_TARGET})
set_target_properties(dk-kinehall PROPERTIES
  BUILD_RPATH "$ORIGIN/lib" INSTALL_RPATH "$ORIGIN/lib"
  OUTPUT_NAME "DK Kinehall")
install(TARGETS dk-kinehall RUNTIME DESTINATION .)
