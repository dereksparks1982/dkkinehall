#pragma once

#include <QMainWindow>
#include <QStringList>
#include <QSettings>
#include <QVector>

class MpvWidget;
class QToolButton;
class QPushButton;
class QSlider;
class QLabel;
class QComboBox;
class QListWidget;
class QAction;
class QKeyEvent;
class QMenu;
class QCloseEvent;
class QDragEnterEvent;
class QDropEvent;
struct MediaTrack;

class MainWindow final : public QMainWindow {
  Q_OBJECT
public:
  explicit MainWindow(QWidget *parent = nullptr);
protected:
  void closeEvent(QCloseEvent *event) override;
  void keyPressEvent(QKeyEvent *event) override;
  void dragEnterEvent(QDragEnterEvent *event) override;
  void dropEvent(QDropEvent *event) override;
private:
  QString t(const char *english, const char *russian) const;
  void rebuildLanguage();
  void rebuildQueue();
  void openFiles(bool queueOnly);
  void addPaths(const QStringList &paths, bool queueOnly);
  void openFolder();
  void openIndex(int index, bool autoplay = true);
  void removeIndex(int index);
  void next();
  void previous();
  void completed();
  void updatePlayback(bool playing);
  void updateTime(double position, double duration);
  void openSubtitleMenu(const QPoint &globalPos);
  void populateSubtitleMenu(QMenu *menu);
  void populateAudioMenu(QMenu *menu);
  void openContextMenu(const QPoint &globalPos);
  void addExternalSubtitle();
  void refreshTrackIndicator();
  void refreshChapterButton();
  void openChapterMenu();
  void updateLoopButton();
  void shuffleUpcoming();
  void applyQueueReorder();
  void toggleFullscreen();
  void changeLanguage(int index);
  void savePosition();
  void restorePosition();
  void restoreLastFile();
  QString resumeKey(const QString &path) const;
  QString resolvePoster(const QString &path) const;
  void showStatus(const QString &message);

  MpvWidget *player_ = nullptr;
  QLabel *logo_ = nullptr;
  QLabel *brand_ = nullptr;
  QLabel *title_ = nullptr;
  QLabel *source_ = nullptr;
  QLabel *artworkAttribution_ = nullptr;
  QLabel *subtitleLabel_ = nullptr;
  QLabel *clock_ = nullptr;
  QLabel *duration_ = nullptr;
  QLabel *volumeLabel_ = nullptr;
  QLabel *status_ = nullptr;
  QPushButton *open_ = nullptr;
  QPushButton *addQueue_ = nullptr;
  QPushButton *openFolder_ = nullptr;
  QPushButton *subtitles_ = nullptr;
  QPushButton *playPause_ = nullptr;
  QPushButton *stop_ = nullptr;
  QPushButton *previous_ = nullptr;
  QPushButton *next_ = nullptr;
  QPushButton *rewind_ = nullptr;
  QPushButton *forward_ = nullptr;
  QPushButton *fullscreen_ = nullptr;
  QPushButton *chapters_ = nullptr;
  QPushButton *shuffle_ = nullptr;
  QPushButton *loop_ = nullptr;
  QPushButton *remove_ = nullptr;
  QPushButton *clear_ = nullptr;
  QComboBox *language_ = nullptr;
  QComboBox *rate_ = nullptr;
  QSlider *seek_ = nullptr;
  QSlider *volume_ = nullptr;
  QListWidget *queue_ = nullptr;
  QAction *removeWatched_ = nullptr;
  QAction *hardware_ = nullptr;
  QStringList paths_;
  int current_ = -1;
  int loopMode_ = 0; // 0: off, 1: one, 2: all
  QString currentPath_;
  QString lastFinishedPath_;
  bool russian_ = false;
  bool userSeeking_ = false;
  bool starting_ = false;
  bool suppressCompletion_ = false;
  qint64 selectedSubtitle_ = -1;
  QSettings settings_;
};
