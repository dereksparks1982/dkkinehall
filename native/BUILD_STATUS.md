# Native executable build
Result: failure
Run: https://github.com/dereksparks1982/dkkinehall/actions/runs/45644082460
Archive: DK-Kinehall-native-linux-x86_64
Date: 2026-11-25
-- The CXX compiler identification is GNU 13.3.0
-- Detecting CXX compiler ABI info
-- Detecting CXX compiler ABI info - done
-- Check for working CXX compiler: /usr/bin/c++ - skipped
-- Detecting CXX compile features
-- Detecting CXX compile features - done
-- Performing Test CMAKE_HAVE_LIBC_PTHREAD
-- Performing Test CMAKE_HAVE_LIBC_PTHREAD - Success
-- Found Threads: TRUE
-- Performing Test HAVE_STDATOMIC
-- Performing Test HAVE_STDATOMIC - Success
-- Found WrapAtomic: TRUE
-- Found OpenGL: /usr/lib/x86_64-linux-gnu/libOpenGL.so
-- Found WrapOpenGL: TRUE
-- Found XKB: /usr/lib/x86_64-linux-gnu/libxkbcommon.so (found suitable version "1.6.0", minimum required is "0.5.0")
-- Found WrapVulkanHeaders: /usr/include
-- Found PkgConfig: /usr/bin/pkg-config (found version "1.8.1")
-- Checking for module 'mpv'
--   Found mpv, version 2.2.0
-- Configuring done (4.3s)
-- Generating done (0.1s)
-- Build files have been written to: /home/runner/work/dkkinehall/dkkinehall/build-native
[  0%] Built target dk-kinehall_autogen_timestamp_deps
[ 16%] Automatic MOC for target dk-kinehall
[ 16%] Built target dk-kinehall_autogen
[ 33%] Building CXX object CMakeFiles/dk-kinehall.dir/dk-kinehall_autogen/mocs_compilation.cpp.o
[ 50%] Building CXX object CMakeFiles/dk-kinehall.dir/src/main.cpp.o
[ 66%] Building CXX object CMakeFiles/dk-kinehall.dir/src/MainWindow.cpp.o
[ 83%] Building CXX object CMakeFiles/dk-kinehall.dir/src/MpvWidget.cpp.o
/home/runner/work/dkkinehall/dkkinehall/native/src/MpvWidget.cpp: In member function ‘virtual void MpvWidget::initializeGL()’:
/home/runner/work/dkkinehall/dkkinehall/native/src/MpvWidget.cpp:77:56: error: too many initializers for ‘mpv_opengl_init_params’
   77 |   mpv_opengl_init_params gl = {glProc, nullptr, nullptr};
      |                                                        ^
gmake[2]: *** [CMakeFiles/dk-kinehall.dir/build.make:121: CMakeFiles/dk-kinehall.dir/src/MpvWidget.cpp.o] Error 1
gmake[2]: *** Waiting for unfinished jobs....
/home/runner/work/dkkinehall/dkkinehall/native/src/MainWindow.cpp: In member function ‘void MainWindow::populateSubtitleMenu(QMenu*)’:
/home/runner/work/dkkinehall/dkkinehall/native/src/MainWindow.cpp:625:12: error: conflicting declaration ‘QAction* external’
  625 |   QAction *external=menu->addAction(t("Add external subtitle file…",
      |            ^~~~~~~~
/home/runner/work/dkkinehall/dkkinehall/native/src/MainWindow.cpp:580:23: note: previous declaration as ‘QVector<MediaTrack> external’
  580 |   QVector<MediaTrack> external;
      |                       ^~~~~~~~
/home/runner/work/dkkinehall/dkkinehall/native/src/MainWindow.cpp:628:10: error: no matching function for call to ‘MainWindow::connect(QVector<MediaTrack>&, void (QAction::*)(bool), MainWindow*, void (MainWindow::*)())’
  628 |   connect(external,&QAction::triggered,this,&MainWindow::addExternalSubtitle);
      |   ~~~~~~~^~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
In file included from /usr/include/x86_64-linux-gnu/qt6/QtWidgets/qwidget.h:9,
                 from /usr/include/x86_64-linux-gnu/qt6/QtWidgets/qmainwindow.h:8,
                 from /usr/include/x86_64-linux-gnu/qt6/QtWidgets/QMainWindow:1,
                 from /home/runner/work/dkkinehall/dkkinehall/native/src/MainWindow.h:3,
                 from /home/runner/work/dkkinehall/dkkinehall/native/src/MainWindow.cpp:1:
/usr/include/x86_64-linux-gnu/qt6/QtCore/qobject.h:201:43: note: candidate: ‘static QMetaObject::Connection QObject::connect(const typename QtPrivate::FunctionPointer<Func>::Object*, Func1, const typename QtPrivate::FunctionPointer<Func2>::Object*, Func2, Qt::ConnectionType) [with Func1 = void (QAction::*)(bool); Func2 = void (MainWindow::*)(); typename QtPrivate::FunctionPointer<Func>::Object = QAction; typename QtPrivate::FunctionPointer<Func2>::Object = MainWindow]’
  201 |     static inline QMetaObject::Connection connect(const typename QtPrivate::FunctionPointer<Func1>::Object *sender, Func1 signal,
      |                                           ^~~~~~~
/usr/include/x86_64-linux-gnu/qt6/QtCore/qobject.h:201:109: note:   no known conversion for argument 1 from ‘QVector<MediaTrack>’ {aka ‘QList<MediaTrack>’} to ‘const QtPrivate::FunctionPointer<void (QAction::*)(bool)>::Object*’ {aka ‘const QAction*’}
  201 |     static inline QMetaObject::Connection connect(const typename QtPrivate::FunctionPointer<Func1>::Object *sender, Func1 signal,
      |                                                   ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~^~~~~~
/usr/include/x86_64-linux-gnu/qt6/QtCore/qobject.h:233:13: note: candidate: ‘template<class Func1, class Func2> static typename std::enable_if<((int)(QtPrivate::FunctionPointer<Func2>::ArgumentCount) >= 0), QMetaObject::Connection>::type QObject::connect(const typename QtPrivate::FunctionPointer<Func>::Object*, Func1, Func2)’
  233 |             connect(const typename QtPrivate::FunctionPointer<Func1>::Object *sender, Func1 signal, Func2 slot)
      |             ^~~~~~~
/usr/include/x86_64-linux-gnu/qt6/QtCore/qobject.h:233:13: note:   template argument deduction/substitution failed:
/home/runner/work/dkkinehall/dkkinehall/native/src/MainWindow.cpp:628:10: note:   candidate expects 3 arguments, 4 provided
  628 |   connect(external,&QAction::triggered,this,&MainWindow::addExternalSubtitle);
      |   ~~~~~~~^~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
/usr/include/x86_64-linux-gnu/qt6/QtCore/qobject.h:242:13: note: candidate: ‘template<class Func1, class Func2> static typename std::enable_if<(((int)(QtPrivate::FunctionPointer<Func2>::ArgumentCount) >= 0) && (! QtPrivate::FunctionPointer<Func2>::IsPointerToMemberFunction)), QMetaObject::Connection>::type QObject::connect(const typename QtPrivate::FunctionPointer<Func>::Object*, Func1, const QObject*, Func2, Qt::ConnectionType)’
  242 |             connect(const typename QtPrivate::FunctionPointer<Func1>::Object *sender, Func1 signal, const QObject *context, Func2 slot,
      |             ^~~~~~~
/usr/include/x86_64-linux-gnu/qt6/QtCore/qobject.h:242:13: note:   template argument deduction/substitution failed:
/usr/include/x86_64-linux-gnu/qt6/QtCore/qobject.h: In substitution of ‘template<class Func1, class Func2> static typename std::enable_if<(((int)(QtPrivate::FunctionPointer<Func2>::ArgumentCount) >= 0) && (! QtPrivate::FunctionPointer<Func2>::IsPointerToMemberFunction)), QMetaObject::Connection>::type QObject::connect(const typename QtPrivate::FunctionPointer<Func>::Object*, Func1, const QObject*, Func2, Qt::ConnectionType) [with Func1 = void (QAction::*)(bool); Func2 = void (MainWindow::*)()]’:
/home/runner/work/dkkinehall/dkkinehall/native/src/MainWindow.cpp:628:10:   required from here
/usr/include/x86_64-linux-gnu/qt6/QtCore/qobject.h:242:13: error: no type named ‘type’ in ‘struct std::enable_if<false, QMetaObject::Connection>’
/usr/include/x86_64-linux-gnu/qt6/QtCore/qobject.h:276:13: note: candidate: ‘template<class Func1, class Func2> static typename std::enable_if<((QtPrivate::FunctionPointer<Func2>::ArgumentCount == -1) && (! is_convertible_v<Func2, const char*>)), QMetaObject::Connection>::type QObject::connect(const typename QtPrivate::FunctionPointer<Func>::Object*, Func1, Func2)’
  276 |             connect(const typename QtPrivate::FunctionPointer<Func1>::Object *sender, Func1 signal, Func2 slot)
      |             ^~~~~~~
/usr/include/x86_64-linux-gnu/qt6/QtCore/qobject.h:276:13: note:   template argument deduction/substitution failed:
/home/runner/work/dkkinehall/dkkinehall/native/src/MainWindow.cpp:628:10: note:   candidate expects 3 arguments, 4 provided
  628 |   connect(external,&QAction::triggered,this,&MainWindow::addExternalSubtitle);
      |   ~~~~~~~^~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
/usr/include/x86_64-linux-gnu/qt6/QtCore/qobject.h:287:13: note: candidate: ‘template<class Func1, class Func2> static typename std::enable_if<((QtPrivate::FunctionPointer<Func2>::ArgumentCount == -1) && (! is_convertible_v<Func2, const char*>)), QMetaObject::Connection>::type QObject::connect(const typename QtPrivate::FunctionPointer<Func>::Object*, Func1, const QObject*, Func2, Qt::ConnectionType)’
  287 |             connect(const typename QtPrivate::FunctionPointer<Func1>::Object *sender, Func1 signal, const QObject *context, Func2 slot,
      |             ^~~~~~~
/usr/include/x86_64-linux-gnu/qt6/QtCore/qobject.h:287:13: note:   template argument deduction/substitution failed:
/usr/include/x86_64-linux-gnu/qt6/QtCore/qobject.h: In substitution of ‘template<class Func1, class Func2> static typename std::enable_if<((QtPrivate::FunctionPointer<Func2>::ArgumentCount == -1) && (! is_convertible_v<Func2, const char*>)), QMetaObject::Connection>::type QObject::connect(const typename QtPrivate::FunctionPointer<Func>::Object*, Func1, const QObject*, Func2, Qt::ConnectionType) [with Func1 = void (QAction::*)(bool); Func2 = void (MainWindow::*)()]’:
/home/runner/work/dkkinehall/dkkinehall/native/src/MainWindow.cpp:628:10:   required from here
/usr/include/x86_64-linux-gnu/qt6/QtCore/qobject.h:287:13: error: no type named ‘type’ in ‘struct std::enable_if<false, QMetaObject::Connection>’
/usr/include/x86_64-linux-gnu/qt6/QtCore/qobject.h:181:36: note: candidate: ‘static QMetaObject::Connection QObject::connect(const QObject*, const char*, const QObject*, const char*, Qt::ConnectionType)’
  181 |     static QMetaObject::Connection connect(const QObject *sender, const char *signal,
      |                                    ^~~~~~~
/usr/include/x86_64-linux-gnu/qt6/QtCore/qobject.h:181:59: note:   no known conversion for argument 1 from ‘QVector<MediaTrack>’ {aka ‘QList<MediaTrack>’} to ‘const QObject*’
  181 |     static QMetaObject::Connection connect(const QObject *sender, const char *signal,
      |                                            ~~~~~~~~~~~~~~~^~~~~~
/usr/include/x86_64-linux-gnu/qt6/QtCore/qobject.h:184:36: note: candidate: ‘static QMetaObject::Connection QObject::connect(const QObject*, const QMetaMethod&, const QObject*, const QMetaMethod&, Qt::ConnectionType)’
  184 |     static QMetaObject::Connection connect(const QObject *sender, const QMetaMethod &signal,
      |                                    ^~~~~~~
/usr/include/x86_64-linux-gnu/qt6/QtCore/qobject.h:184:59: note:   no known conversion for argument 1 from ‘QVector<MediaTrack>’ {aka ‘QList<MediaTrack>’} to ‘const QObject*’
  184 |     static QMetaObject::Connection connect(const QObject *sender, const QMetaMethod &signal,
      |                                            ~~~~~~~~~~~~~~~^~~~~~
/usr/include/x86_64-linux-gnu/qt6/QtCore/qobject.h:432:32: note: candidate: ‘QMetaObject::Connection QObject::connect(const QObject*, const char*, const char*, Qt::ConnectionType) const’
  432 | inline QMetaObject::Connection QObject::connect(const QObject *asender, const char *asignal,
      |                                ^~~~~~~
/usr/include/x86_64-linux-gnu/qt6/QtCore/qobject.h:432:64: note:   no known conversion for argument 1 from ‘QVector<MediaTrack>’ {aka ‘QList<MediaTrack>’} to ‘const QObject*’
  432 | inline QMetaObject::Connection QObject::connect(const QObject *asender, const char *asignal,
      |                                                 ~~~~~~~~~~~~~~~^~~~~~~
gmake[2]: *** [CMakeFiles/dk-kinehall.dir/build.make:107: CMakeFiles/dk-kinehall.dir/src/MainWindow.cpp.o] Error 1
gmake[1]: *** [CMakeFiles/Makefile2:90: CMakeFiles/dk-kinehall.dir/all] Error 2
gmake: *** [Makefile:136: all] Error 2
