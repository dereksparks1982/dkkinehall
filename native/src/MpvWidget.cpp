#include "MpvWidget.h"
#include <mpv/client.h>
#include <mpv/render_gl.h>
#include <QContextMenuEvent>
#include <QFile>
#include <QMouseEvent>
#include <QOpenGLContext>
#include <QPointer>
#include <QWheelEvent>
#include <QByteArray>
#include <cmath>
#include <cstring>
#include <algorithm>

namespace {
void *glProc(void *, const char *name) {
  auto *context = QOpenGLContext::currentContext();
  return context ? reinterpret_cast<void *>(context->getProcAddress(name)) : nullptr;
}
QString propertyText(mpv_handle *mpv, const char *name) {
  if (!mpv) return {};
  char *value = mpv_get_property_string(mpv, name);
  if (!value) return {};
  const QString output = QString::fromUtf8(value);
  mpv_free(value);
  return output;
}
}

MpvWidget::MpvWidget(QWidget *parent) : QOpenGLWidget(parent) {
  setMouseTracking(true);
  setFocusPolicy(Qt::StrongFocus);
  setMinimumSize(480, 270);
  cursorTimer_.setSingleShot(true);
  cursorTimer_.setInterval(3000);
  connect(&cursorTimer_, &QTimer::timeout, this, [this] {
    if (underMouse()) setCursor(Qt::BlankCursor);
  });

  mpv_ = mpv_create();
  if (!mpv_) return;
  mpv_set_option_string(mpv_, "vo", "libmpv");
  mpv_set_option_string(mpv_, "hwdec", "auto-safe");
  mpv_set_option_string(mpv_, "volume-max", "100");
  mpv_set_option_string(mpv_, "sub-auto", "no");
  mpv_set_option_string(mpv_, "sid", "no");
  mpv_set_option_string(mpv_, "input-default-bindings", "no");
  mpv_set_option_string(mpv_, "osc", "no");
  mpv_set_option_string(mpv_, "ytdl", "no");
  mpv_set_option_string(mpv_, "audio-display", "no");
  if (mpv_initialize(mpv_) < 0) {
    mpv_terminate_destroy(mpv_);
    mpv_ = nullptr;
    return;
  }
  pollTimer_.setInterval(200);
  connect(&pollTimer_, &QTimer::timeout, this, &MpvWidget::poll);
  pollTimer_.start();
}

MpvWidget::~MpvWidget() {
  cursorTimer_.stop();
  pollTimer_.stop();
  if (render_) {
    makeCurrent();
    mpv_render_context_set_update_callback(render_, nullptr, nullptr);
    mpv_render_context_free(render_);
    render_ = nullptr;
    doneCurrent();
  }
  if (mpv_) {
    mpv_terminate_destroy(mpv_);
    mpv_ = nullptr;
  }
}

void MpvWidget::initializeGL() {
  if (!mpv_) return;
  mpv_opengl_init_params gl = {glProc, nullptr};
  mpv_render_param params[] = {
    {MPV_RENDER_PARAM_API_TYPE, const_cast<char *>(MPV_RENDER_API_TYPE_OPENGL)},
    {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl},
    {MPV_RENDER_PARAM_INVALID, nullptr}
  };
  if (mpv_render_context_create(&render_, mpv_, params) < 0) {
    emit playbackError(QStringLiteral("OpenGL video renderer could not start."));
    return;
  }
  mpv_render_context_set_update_callback(render_, [](void *opaque) {
    auto *widget = static_cast<MpvWidget *>(opaque);
    QMetaObject::invokeMethod(widget, "update", Qt::QueuedConnection);
  }, this);
}

void MpvWidget::paintGL() {
  if (!render_) return;
  const qreal scale = devicePixelRatioF();
  mpv_opengl_fbo fbo = {
    static_cast<int>(defaultFramebufferObject()),
    static_cast<int>(std::lround(width() * scale)),
    static_cast<int>(std::lround(height() * scale)), 0
  };
  int flip = 1;
  mpv_render_param params[] = {
    {MPV_RENDER_PARAM_OPENGL_FBO, &fbo},
    {MPV_RENDER_PARAM_FLIP_Y, &flip},
    {MPV_RENDER_PARAM_INVALID, nullptr}
  };
  mpv_render_context_render(render_, params);
}

bool MpvWidget::openFile(const QString &path) {
  if (!mpv_ || path.isEmpty()) return false;
  const QByteArray local = QFile::encodeName(path);
  // Set the default before loading and once more after FILE_LOADED. libmpv
  // discovers subtitle streams from the MKV without opening a file dialog.
  mpv_set_property_string(mpv_, "sid", "no");
  const char *cmd[] = {"loadfile", local.constData(), "replace", nullptr};
  if (mpv_command(mpv_, cmd) < 0) return false;
  return true;
}
void MpvWidget::play() {
  if (!mpv_) return;
  int flag = 0;
  mpv_set_property(mpv_, "pause", MPV_FORMAT_FLAG, &flag);
}
void MpvWidget::pause() {
  if (!mpv_) return;
  int flag = 1;
  mpv_set_property(mpv_, "pause", MPV_FORMAT_FLAG, &flag);
}
void MpvWidget::togglePause() { if (paused()) play(); else pause(); }
void MpvWidget::stop() { if (mpv_) mpv_command_string(mpv_, "stop"); }
void MpvWidget::seekBy(int seconds) {
  if (!mpv_) return;
  const QByteArray amount = QByteArray::number(seconds);
  const char *cmd[] = {"seek", amount.constData(), "relative", nullptr};
  mpv_command(mpv_, cmd);
}
void MpvWidget::seekTo(double seconds) {
  if (!mpv_ || seconds < 0) return;
  const QByteArray amount = QByteArray::number(seconds, 'f', 3);
  const char *cmd[] = {"seek", amount.constData(), "absolute", nullptr};
  mpv_command(mpv_, cmd);
}
void MpvWidget::setVolume(int percent) {
  if (!mpv_) return;
  double value = qBound(0, percent, 100);
  mpv_set_property(mpv_, "volume", MPV_FORMAT_DOUBLE, &value);
}
void MpvWidget::setHardwareAcceleration(bool enabled) {
  if (mpv_) mpv_set_property_string(mpv_, "hwdec", enabled ? "auto-safe" : "no");
}
void MpvWidget::setPlaybackSpeed(double speed) {
  if (mpv_ && speed >= 0.25 && speed <= 4.0)
    mpv_set_property(mpv_, "speed", MPV_FORMAT_DOUBLE, &speed);
}
void MpvWidget::selectAudio(qint64 id) {
  if (mpv_) {
    int64_t selected = id;
    mpv_set_property(mpv_, "aid", MPV_FORMAT_INT64, &selected);
  }
}
void MpvWidget::selectSubtitles(qint64 id) {
  if (!mpv_) return;
  if (id < 0) mpv_set_property_string(mpv_, "sid", "no");
  else {
    int64_t selected = id;
    mpv_set_property(mpv_, "sid", MPV_FORMAT_INT64, &selected);
  }
}
void MpvWidget::loadExternalSubtitle(const QString &path) {
  if (!mpv_ || path.isEmpty()) return;
  const QByteArray native = QFile::encodeName(path);
  const char *cmd[] = {"sub-add", native.constData(), "select", nullptr};
  mpv_command(mpv_, cmd);
}
QVector<MediaChapter> MpvWidget::chapters() const {
  QVector<MediaChapter> result;
  if (!mpv_) return result;
  mpv_node root{};
  if (mpv_get_property(mpv_, "chapter-list", MPV_FORMAT_NODE, &root)<0)
    return result;
  if (root.format==MPV_FORMAT_NODE_ARRAY && root.u.list) {
    for (int i=0;i<root.u.list->num && i<500;i++) {
      const mpv_node &entry=root.u.list->values[i];
      if (entry.format!=MPV_FORMAT_NODE_MAP || !entry.u.list) continue;
      MediaChapter chapter;
      bool hasTime=false;
      const mpv_node_list *fields=entry.u.list;
      for (int j=0;j<fields->num;j++) {
        const char *key=fields->keys[j];
        if (!key) continue;
        const mpv_node &value=fields->values[j];
        if (std::strcmp(key,"time")==0) {
          if (value.format==MPV_FORMAT_DOUBLE) {
            chapter.time=value.u.double_;
            hasTime=true;
          } else if (value.format==MPV_FORMAT_INT64) {
            chapter.time=static_cast<double>(value.u.int64);
            hasTime=true;
          }
        } else if (std::strcmp(key,"title")==0 &&
                   value.format==MPV_FORMAT_STRING && value.u.string) {
          chapter.title=QString::fromUtf8(value.u.string).trimmed();
        }
      }
      if (!hasTime || !std::isfinite(chapter.time) || chapter.time<0) continue;
      result.push_back(chapter);
    }
  }
  mpv_free_node_contents(&root);
  std::sort(result.begin(),result.end(),
    [](const MediaChapter &a,const MediaChapter &b){return a.time<b.time;});
  return result;
}

double MpvWidget::duration() const {
  double value = 0;
  return mpv_ && mpv_get_property(mpv_, "duration", MPV_FORMAT_DOUBLE, &value) >= 0 ? value : 0;
}
double MpvWidget::position() const {
  double value = 0;
  return mpv_ && mpv_get_property(mpv_, "time-pos", MPV_FORMAT_DOUBLE, &value) >= 0 ? value : 0;
}
bool MpvWidget::paused() const {
  int value = 1;
  return !mpv_ || mpv_get_property(mpv_, "pause", MPV_FORMAT_FLAG, &value) < 0 || value != 0;
}
QVector<MediaTrack> MpvWidget::tracks(const QString &type) const {
  QVector<MediaTrack> out;
  if (!mpv_) return out;
  mpv_node root{};
  if (mpv_get_property(mpv_, "track-list", MPV_FORMAT_NODE, &root) < 0)
    return out;
  if (root.format == MPV_FORMAT_NODE_ARRAY && root.u.list) {
    for (int i = 0; i < root.u.list->num; ++i) {
      const mpv_node &entry = root.u.list->values[i];
      if (entry.format != MPV_FORMAT_NODE_MAP || !entry.u.list) continue;
      MediaTrack track;
      for (int k = 0; k < entry.u.list->num; ++k) {
        const QString key = QString::fromUtf8(entry.u.list->keys[k]);
        const mpv_node &value = entry.u.list->values[k];
        if (key == QStringLiteral("id") && value.format == MPV_FORMAT_INT64)
          track.id = value.u.int64;
        else if (value.format == MPV_FORMAT_STRING && value.u.string) {
          const QString text = QString::fromUtf8(value.u.string);
          if (key == QStringLiteral("type")) track.type = text;
          else if (key == QStringLiteral("title")) track.title = text;
          else if (key == QStringLiteral("lang")) track.language = text;
          else if (key == QStringLiteral("codec")) track.codec = text;
        } else if (key == QStringLiteral("selected") && value.format == MPV_FORMAT_FLAG)
          track.selected = value.u.flag != 0;
        else if (key == QStringLiteral("external") && value.format == MPV_FORMAT_FLAG)
          track.external = value.u.flag != 0;
      }
      if (track.type == type) out.push_back(track);
    }
  }
  mpv_free_node_contents(&root);
  return out;
}
void MpvWidget::poll() {
  if (!mpv_) return;
  while (true) {
    mpv_event *event = mpv_wait_event(mpv_, 0);
    if (!event || event->event_id == MPV_EVENT_NONE) break;
    if (event->event_id == MPV_EVENT_END_FILE && event->data) {
      const auto *end = static_cast<mpv_event_end_file *>(event->data);
      if (end->reason == MPV_END_FILE_REASON_EOF) emit finished();
      else if (end->reason == MPV_END_FILE_REASON_ERROR)
        emit playbackError(QStringLiteral("This media file could not be decoded."));
    } else if (event->event_id == MPV_EVENT_FILE_LOADED) {
      emit fileLoaded();
    } else if (event->event_id == MPV_EVENT_LOG_MESSAGE) {
      // libmpv logs are optional; no browser console or remote service.
    }
  }
  int idle = 1;
  mpv_get_property(mpv_, "idle-active", MPV_FORMAT_FLAG, &idle);
  const bool playing = !paused() && idle == 0;
  if (playing != lastPlaying_) {
    lastPlaying_ = playing;
    emit playbackStateChanged(playing);
  }
  emit positionChanged(position(), duration());
}
void MpvWidget::mouseDoubleClickEvent(QMouseEvent *event) {
  emit fullscreenRequested();
  event->accept();
}
void MpvWidget::mouseMoveEvent(QMouseEvent *event) {
  unsetCursor();
  cursorTimer_.start();
  QOpenGLWidget::mouseMoveEvent(event);
}
void MpvWidget::leaveEvent(QEvent *event) {
  cursorTimer_.stop();
  unsetCursor();
  QOpenGLWidget::leaveEvent(event);
}
void MpvWidget::contextMenuEvent(QContextMenuEvent *event) {
  emit contextRequested(event->globalPos());
  event->accept();
}
void MpvWidget::wheelEvent(QWheelEvent *event) {
  emit volumeWheel(event->angleDelta().y() > 0 ? 5 : -5);
  event->accept();
}
