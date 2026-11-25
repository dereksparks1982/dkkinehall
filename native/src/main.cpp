#include "MainWindow.h"
#include <QApplication>
#include <QCoreApplication>
#include <QFileInfo>
#include <QStringList>
#include <QSurfaceFormat>

int main(int argc,char *argv[]) {
  QCoreApplication::setOrganizationName(QStringLiteral("DK Softworks"));
  QCoreApplication::setApplicationName(QStringLiteral("DK Kinehall"));
  QSurfaceFormat surface;
  surface.setRenderableType(QSurfaceFormat::OpenGL);
  surface.setProfile(QSurfaceFormat::CoreProfile);
  surface.setVersion(3,3);
  QSurfaceFormat::setDefaultFormat(surface);
  QApplication app(argc,argv);
  app.setQuitOnLastWindowClosed(true);
  MainWindow window;
  window.show();
  return app.exec();
}
