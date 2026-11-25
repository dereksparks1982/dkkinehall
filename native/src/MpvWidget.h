#pragma once

#include <QOpenGLWidget>
#include <QTimer>
#include <QString>
#include <QVector>
#include <QPoint>
#include <cstdint>

struct mpv_handle;
struct mpv_render_context;

struct MediaTrack {
  qint64 id = -1;
  QString type;
  QString title;
  QString language;
  bool selected = false;
};

class MpvWidget final : public QOpenGLWidget {
  Q_OBJECT
public:
  explicit MpvWidget(QWidget *parent = nullptr);
  ~MpvWidget() override;
  bool ready() const { return mpv_ != nullptr; }
  bool openFile(const QString &path);
  void play();
  void pause();
  void togglePause();
  void stop();
  void seekBy(int seconds);
  void seekTo(double seconds);
  void setVolume(int percent);
  void setHardwareAcceleration(bool enabled);
  void setPlaybackSpeed(double speed);
  void selectAudio(qint64 id);
  void selectSubtitles(qint64 id);
  void loadExternalSubtitle(const QString &path);
  QVector<MediaTrack> tracks(const QString &type) const;
  double duration() const;
  double position() const;
  bool paused() const;
signals:
  void finished();
  void playbackStateChanged(bool playing);
  void positionChanged(double position, double duration);
  void fullscreenRequested();
  void contextRequested(const QPoint &globalPosition);
  void volumeWheel(int delta);
  void fileLoaded();
  void playbackError(const QString &message);
protected:
  void initializeGL() override;
  void paintGL() override;
  void mouseDoubleClickEvent(QMouseEvent *event) override;
  void mouseMoveEvent(QMouseEvent *event) override;
  void leaveEvent(QEvent *event) override;
  void contextMenuEvent(QContextMenuEvent *event) override;
  void wheelEvent(QWheelEvent *event) override;
private:
  void poll();
  mpv_handle *mpv_ = nullptr;
  mpv_render_context *render_ = nullptr;
  QTimer pollTimer_;
  QTimer cursorTimer_;
  bool lastPlaying_ = false;
};
