cmake_minimum_required(VERSION 3.21)
project(DKKinehall VERSION 2.0 LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
find_package(Qt6 6.4 REQUIRED COMPONENTS Widgets OpenGLWidgets OpenGL Network)
find_package(PkgConfig REQUIRED)
pkg_check_modules(MPV REQUIRED IMPORTED_TARGET mpv)
add_executable(dk-kinehall
  src/main.cpp
  src/MainWindow.h src/MainWindow.cpp
  src/MpvWidget.h src/MpvWidget.cpp
  src/EpisodeMetadata.h src/EpisodeMetadata.cpp
)
target_compile_definitions(dk-kinehall PRIVATE
  QT_NO_CAST_FROM_ASCII QT_NO_CAST_TO_ASCII)
target_link_libraries(dk-kinehall PRIVATE
  Qt6::Widgets Qt6::OpenGLWidgets Qt6::OpenGL Qt6::Network PkgConfig::MPV)
set_target_properties(dk-kinehall PROPERTIES
  BUILD_RPATH "$ORIGIN/lib" INSTALL_RPATH "$ORIGIN/lib"
  OUTPUT_NAME "DK Kinehall")
install(TARGETS dk-kinehall RUNTIME DESTINATION .)
