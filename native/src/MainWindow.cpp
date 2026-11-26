#include "MainWindow.h"
#include "MpvWidget.h"

#include <QAction>
#include <QApplication>
#include <QAbstractItemView>
#include <QRandomGenerator>
#include <QRegularExpression>
#include <QDropEvent>
#include <functional>
#include <QCollator>
#include <QComboBox>
#include <QCoreApplication>
#include <QCryptographicHash>
#include <QDir>
#include <QDirIterator>
#include <QDragEnterEvent>
#include <QDropEvent>
#include <QFileDialog>
#include <QFileInfo>
#include <QFrame>
#include <QFont>
#include <QHBoxLayout>
#include <QIcon>
#include <QKeyEvent>
#include <QLabel>
#include <QListWidget>
#include <QListWidgetItem>
#include <QMenu>
#include <QMimeData>
#include <QPixmap>
#include <QPushButton>
#include <QSettings>
#include <QSignalBlocker>
#include <QSlider>
#include <QSizePolicy>
#include <QToolButton>
#include <QTimer>
#include <QUrl>
#include <QVBoxLayout>
#include <QWidget>
#include <QCloseEvent>
#include <QtGlobal>
#include <algorithm>
#include <cmath>

namespace {
class ReorderListWidget final : public QListWidget {
public:
  using QListWidget::QListWidget;
  std::function<void()> onReordered;
protected:
  void dropEvent(QDropEvent *event) override {
    QListWidget::dropEvent(event);
    if(event->isAccepted() && onReordered) onReordered();
  }
};
struct DisplayMedia {QString name,detail;};
DisplayMedia displayMedia(const QString &path) {
  QString name=QFileInfo(path).completeBaseName();
  name.replace(QRegularExpression(QStringLiteral("[._]+")),QStringLiteral(" "));
  name=name.simplified();
  static const QRegularExpression episode(
    QStringLiteral(R"((?:^|[\s-])(?:S(\d{1,2})\s*E(\d{1,3})|(\d{1,2})\s*x\s*(\d{1,3}))(?=$|[\s-]))"),
    QRegularExpression::CaseInsensitiveOption);
  const auto match=episode.match(name);
  if(match.hasMatch()) {
    const int season=match.captured(1).isEmpty()?match.captured(3).toInt():match.captured(1).toInt();
    const int number=match.captured(2).isEmpty()?match.captured(4).toInt():match.captured(2).toInt();
    const QString series=name.left(match.capturedStart()).trimmed();
    const QString code=QStringLiteral("S%1E%2").arg(season,2,10,QLatin1Char('0'))
      .arg(number,2,10,QLatin1Char('0'));
    QString title=name.mid(match.capturedEnd()).trimmed();
    title.remove(QRegularExpression(QStringLiteral(R"((?:\s|^)(?:2160p|1080p|720p|480p|WEB[- ]?DL|WEB[- ]?Rip|BluRay|HEVC|x264|x265|H264|H265|AC3|AAC|DTS)(?:\s.*)?$)"),
      QRegularExpression::CaseInsensitiveOption));
    title=title.trimmed();
    if(title.startsWith(QLatin1Char('-')))title=title.mid(1).trimmed();
    if(!series.isEmpty())return {series,code+(title.isEmpty()?QString():QStringLiteral(" · ")+title)};
  }
  name.remove(QRegularExpression(QStringLiteral(R"((?:\s+)(?:2160p|1080p|720p|480p|WEB[- ]?DL|WEB[- ]?Rip|BluRay|HEVC|x264|x265)(?:\s.*)?$)"),
    QRegularExpression::CaseInsensitiveOption));
  return {name.trimmed(),QString()};
}
bool isMedia(const QString &path) {
  const QString ext = QFileInfo(path).suffix().toLower();
  return QStringList{
    QStringLiteral("mkv"),QStringLiteral("mp4"),QStringLiteral("m4v"),
    QStringLiteral("mov"),QStringLiteral("avi"),QStringLiteral("webm"),
    QStringLiteral("ts"),QStringLiteral("mpeg"),QStringLiteral("mpg"),
    QStringLiteral("mp3"),QStringLiteral("aac"),QStringLiteral("m4a"),
    QStringLiteral("wav"),QStringLiteral("flac"),QStringLiteral("ogg"),
    QStringLiteral("opus"),QStringLiteral("m2ts"),QStringLiteral("mts"),
    QStringLiteral("m2v"),QStringLiteral("vob"),QStringLiteral("3gp"),
    QStringLiteral("3g2"),QStringLiteral("wmv"),QStringLiteral("asf"),
    QStringLiteral("flv"),QStringLiteral("f4v"),QStringLiteral("ogv"),
    QStringLiteral("dv"),QStringLiteral("divx"),QStringLiteral("rm"),
    QStringLiteral("rmvb"),QStringLiteral("mpv"),QStringLiteral("mxf"),
    QStringLiteral("nut"),QStringLiteral("mka"),QStringLiteral("mp2"),
    QStringLiteral("aiff"),QStringLiteral("aif"),QStringLiteral("ape"),
    QStringLiteral("alac"),QStringLiteral("wma"),QStringLiteral("m4b"),
    QStringLiteral("m4p"),QStringLiteral("caf"),QStringLiteral("dsf"),
    QStringLiteral("dff"),QStringLiteral("amr"),QStringLiteral("ac3"),
    QStringLiteral("dts")
  }.contains(ext);
}
QString clockText(double seconds) {
  const int s = qMax(0, static_cast<int>(seconds));
  const int h = s/3600, m = (s/60)%60;
  if (h) return QStringLiteral("%1:%2:%3").arg(h).arg(m,2,10,QLatin1Char('0')).arg(s%60,2,10,QLatin1Char('0'));
  return QStringLiteral("%1:%2").arg(s/60).arg(s%60,2,10,QLatin1Char('0'));
}
QString iconFile() {
  const QString base = QCoreApplication::applicationDirPath();
  const QStringList paths{
    base+QStringLiteral("/docs/icons/dk-media-player-512.png"),
    base+QStringLiteral("/../docs/icons/dk-media-player-512.png"),
    QDir::currentPath()+QStringLiteral("/docs/icons/dk-media-player-512.png")
  };
  for (const QString &path : paths) if (QFileInfo::exists(path)) return path;
  return {};
}
QPushButton *transportButton(const QString &caption, QWidget *parent) {
  auto *button = new QPushButton(caption,parent);
  button->setFixedSize(46,44);
  button->setCursor(Qt::PointingHandCursor);
  return button;
}
}

MainWindow::MainWindow(QWidget *parent)
  : QMainWindow(parent),
    settings_(QStringLiteral("DK Softworks"),QStringLiteral("DK Kinehall")) {
  setObjectName(QStringLiteral("dkMainWindow"));
  setWindowTitle(QStringLiteral("DK Kinehall"));
  setAcceptDrops(true);
  resize(1420,880);
  setMinimumSize(900,580);
  if (!iconFile().isEmpty()) setWindowIcon(QIcon(iconFile()));
  russian_=settings_.value(QStringLiteral("language"),QStringLiteral("en")).toString()==QStringLiteral("ru");

  setStyleSheet(QStringLiteral(R"DK(
    QMainWindow, QWidget#root { background:#0b0d12; color:#f2f5f9; }
    QWidget { font-size:13px; color:#f2f5f9; }
    QFrame#playerPanel, QFrame#queuePanel {
      background:#131720; border:1px solid #2b3444; border-radius:14px;
    }
    QPushButton, QToolButton {
      min-height:32px; border:1px solid #2b3444; border-radius:8px;
      background:#1b2130; color:#f2f5f9; padding:4px 10px;
    }
    QPushButton:hover, QToolButton:hover { background:#273042; }
    QPushButton#playPause { background:#df4147; border-color:#df4147;
      font-weight:800; padding:4px; }
    QPushButton#playPause:hover { background:#fa535b; }
    QPushButton#subtitles { border:1px solid #69343d; background:#27202a; }
    QPushButton:disabled { color:#77808d; border-color:#232935; }
    QListWidget {
      background:#131720; border:0; outline:0; color:#f2f5f9;
      padding:4px; }
    QListWidget::item {
      border-radius:9px; padding:5px; margin-bottom:3px; }
    QListWidget::item:selected {
      background:#39222f; border:1px solid #df4147; }
    QSlider::groove:horizontal { background:#2b3444;
      height:5px; border-radius:2px; }
    QSlider::sub-page:horizontal { background:#df4147; border-radius:2px; }
    QSlider::handle:horizontal {
      background:#f2656b; width:13px; margin:-5px 0; border-radius:6px; }
    QLabel#brand { font-size:20px; font-weight:800; letter-spacing:2px; }
    QLabel#queueHeading { font-size:17px; font-weight:700; }
    QLabel#nowTitle { font-size:15px; font-weight:700; }
    QLabel#muted { color:#9aa8b8; }
    QComboBox {
      background:#1b2130; color:#f2f5f9; border:1px solid #2b3444;
      border-radius:7px; padding:6px 8px; }
    QMenu { background:#171d28; color:#f2f5f9;
      border:1px solid #374051; padding:5px; }
    QMenu::item { padding:7px 24px; }
    QMenu::item:selected { background:#39222f; }
    QMenu::item:disabled { color:#798391; }
  )DK"));

  auto *root=new QWidget(this);
  root->setObjectName(QStringLiteral("root"));
  auto *page=new QVBoxLayout(root);
  page->setContentsMargins(20,17,20,12);
  page->setSpacing(12);

  auto *header=new QHBoxLayout;
  header->setSpacing(10);
  logo_=new QLabel(root);
  logo_->setFixedSize(46,46);
  const QPixmap emblem(iconFile());
  if (!emblem.isNull()) logo_->setPixmap(emblem.scaled(46,46,Qt::KeepAspectRatio,Qt::SmoothTransformation));
  header->addWidget(logo_);
  brand_=new QLabel(root);
  brand_->setObjectName(QStringLiteral("brand"));
  header->addWidget(brand_);
  header->addStretch(1);
  open_=new QPushButton(root);
  header->addWidget(open_);

  auto *settingsButton=new QToolButton(root);
  settingsButton->setText(QStringLiteral("⚙"));
  settingsButton->setToolTip(QStringLiteral("Playback settings"));
  settingsButton->setPopupMode(QToolButton::InstantPopup);
  auto *settingsMenu=new QMenu(settingsButton);
  removeWatched_=settingsMenu->addAction(QString());
  removeWatched_->setCheckable(true);
  removeWatched_->setChecked(settings_.value(QStringLiteral("removeWatched"),true).toBool());
  hardware_=settingsMenu->addAction(QString());
  hardware_->setCheckable(true);
  hardware_->setChecked(settings_.value(QStringLiteral("hardware"),true).toBool());
  settingsButton->setMenu(settingsMenu);
  header->addWidget(settingsButton);

  language_=new QComboBox(root);
  language_->addItem(QStringLiteral("English"),QStringLiteral("en"));
  language_->addItem(QStringLiteral("Русский"),QStringLiteral("ru"));
  language_->setCurrentIndex(russian_?1:0);
  header->addWidget(language_);
  page->addLayout(header);

  auto *columns=new QHBoxLayout;
  columns->setSpacing(18);
  auto *left=new QFrame(root);
  left->setObjectName(QStringLiteral("playerPanel"));
  auto *leftLayout=new QVBoxLayout(left);
  leftLayout->setContentsMargins(0,0,0,12);
  leftLayout->setSpacing(10);

  player_=new MpvWidget(left);
  player_->setSizePolicy(QSizePolicy::Expanding,QSizePolicy::Expanding);
  leftLayout->addWidget(player_,1);

  auto *seekRow=new QHBoxLayout;
  seekRow->setContentsMargins(14,0,14,0);
  clock_=new QLabel(QStringLiteral("0:00"),left);
  duration_=new QLabel(QStringLiteral("0:00"),left);
  seek_=new QSlider(Qt::Horizontal,left);
  seek_->setRange(0,1000);
  seek_->setEnabled(false);
  seekRow->addWidget(clock_);
  seekRow->addWidget(seek_,1);
  seekRow->addWidget(duration_);
  leftLayout->addLayout(seekRow);

  auto *controls=new QHBoxLayout;
  controls->setContentsMargins(14,0,14,0);
  controls->setSpacing(6);
  previous_=transportButton(QStringLiteral("⏮"),left);
  rewind_=transportButton(QStringLiteral("↶10"),left);
  playPause_=transportButton(QStringLiteral("▶"),left);
  playPause_->setObjectName(QStringLiteral("playPause"));
  forward_=transportButton(QStringLiteral("10↷"),left);
  stop_=transportButton(QStringLiteral("■"),left);
  next_=transportButton(QStringLiteral("⏭"),left);
  for (auto *button:{previous_,rewind_,playPause_,forward_,stop_,next_})
    controls->addWidget(button);
  controls->addStretch(1);
  volumeLabel_=new QLabel(QStringLiteral("100%"),left);
  volume_=new QSlider(Qt::Horizontal,left);
  volume_->setFixedWidth(95);
  volume_->setRange(0,100);
  volume_->setValue(qBound(0,settings_.value(QStringLiteral("volume"),100).toInt(),100));
  controls->addWidget(new QLabel(QStringLiteral("◖))"),left));
  controls->addWidget(volume_);
  controls->addWidget(volumeLabel_);
  rate_=new QComboBox(left);
  for (const double value:{0.5,0.75,1.0,1.25,1.5,2.0})
    rate_->addItem(QString::number(value,'f',value==1.25||value==0.75?2:1)+QStringLiteral("×"),value);
  rate_->setCurrentIndex(2);
  controls->addWidget(rate_);
  chapters_=new QPushButton(left);
  controls->addWidget(chapters_);
  fullscreen_=transportButton(QStringLiteral("⛶"),left);
  controls->addWidget(fullscreen_);
  leftLayout->addLayout(controls);

  auto *now=new QHBoxLayout;
  now->setContentsMargins(14,0,14,0);
  auto *titles=new QVBoxLayout;
  title_=new QLabel(left);
  title_->setObjectName(QStringLiteral("nowTitle"));
  title_->setWordWrap(true);
  source_=new QLabel(left);
  source_->setObjectName(QStringLiteral("muted"));
  titles->addWidget(title_);
  titles->addWidget(source_);
  now->addLayout(titles,1);
  leftLayout->addLayout(now);

  auto *subrow=new QHBoxLayout;
  subrow->setContentsMargins(14,0,14,0);
  subrow->setSpacing(12);
  subtitles_=new QPushButton(left);
  subtitles_->setObjectName(QStringLiteral("subtitles"));
  subrow->addWidget(subtitles_);
  subtitleLabel_=new QLabel(left);
  subtitleLabel_->setObjectName(QStringLiteral("muted"));
  subrow->addWidget(subtitleLabel_,1);
  leftLayout->addLayout(subrow);
  status_=new QLabel(left);
  status_->setObjectName(QStringLiteral("muted"));
  status_->setWordWrap(true);
  auto *statusRow=new QHBoxLayout;
  statusRow->setContentsMargins(14,0,14,0);
  statusRow->addWidget(status_);
  leftLayout->addLayout(statusRow);
  columns->addWidget(left,1);

  auto *right=new QFrame(root);
  right->setObjectName(QStringLiteral("queuePanel"));
  right->setFixedWidth(300);
  auto *rightLayout=new QVBoxLayout(right);
  rightLayout->setContentsMargins(10,15,10,10);
  rightLayout->setSpacing(10);
  auto *queueHeading=new QLabel(right);
  queueHeading->setObjectName(QStringLiteral("queueHeading"));
  queueHeading->setText(QStringLiteral("Up Next"));
  rightLayout->addWidget(queueHeading);
  auto *queueButtons=new QHBoxLayout;
  addQueue_=new QPushButton(right);
  clear_=new QPushButton(right);
  queueButtons->addWidget(addQueue_,1);
  queueButtons->addWidget(clear_,1);
  rightLayout->addLayout(queueButtons);
  auto *orderControls=new QHBoxLayout;
  shuffle_=new QPushButton(right);
  shuffle_->setCheckable(true);
  shuffle_->setChecked(settings_.value(QStringLiteral("shuffle"),false).toBool());
  loop_=new QPushButton(right);
  loopMode_=qBound(0,settings_.value(QStringLiteral("loopMode"),0).toInt(),2);
  orderControls->addWidget(shuffle_,1);
  orderControls->addWidget(loop_,1);
  rightLayout->addLayout(orderControls);
  queue_=new ReorderListWidget(right);
  queue_->setDragEnabled(true);
  queue_->setAcceptDrops(true);
  queue_->setDragDropMode(QAbstractItemView::InternalMove);
  queue_->setDefaultDropAction(Qt::MoveAction);
  queue_->setDropIndicatorShown(true);
  static_cast<ReorderListWidget *>(queue_)->onReordered=
    [this]{applyQueueReorder();};
  queue_->setIconSize(QSize(88,126));
  queue_->setSpacing(6);
  queue_->setVerticalScrollMode(QAbstractItemView::ScrollPerPixel);
  queue_->setContextMenuPolicy(Qt::CustomContextMenu);
  rightLayout->addWidget(queue_,1);
  openFolder_=new QPushButton(right);
  rightLayout->addWidget(openFolder_);
  columns->addWidget(right);
  page->addLayout(columns,1);
  auto *footer=new QLabel(QStringLiteral("DK Kinehall · DK Softworks"),root);
  footer->setAlignment(Qt::AlignCenter);
  footer->setObjectName(QStringLiteral("muted"));
  page->addWidget(footer);
  setCentralWidget(root);

  connect(open_,&QPushButton::clicked,this,[this]{openFiles(false);});
  connect(addQueue_,&QPushButton::clicked,this,[this]{openFiles(true);});
  connect(openFolder_,&QPushButton::clicked,this,&MainWindow::openFolder);
  connect(shuffle_,&QPushButton::clicked,this,[this](bool active){
    settings_.setValue(QStringLiteral("shuffle"),active);
    if(active)shuffleUpcoming();
    rebuildQueue();
  });
  connect(loop_,&QPushButton::clicked,this,[this]{
    loopMode_=(loopMode_+1)%3;
    settings_.setValue(QStringLiteral("loopMode"),loopMode_);
    updateLoopButton();
  });
  connect(chapters_,&QPushButton::clicked,this,&MainWindow::openChapterMenu);
  connect(clear_,&QPushButton::clicked,this,[this] {
    // Clearing Up Next never interrupts the selected movie.
    if (current_<0) paths_.clear();
    else {const QString active=currentPath_;paths_={active};current_=0;}
    rebuildQueue();
  });
  connect(queue_,&QListWidget::itemClicked,this,[this](QListWidgetItem *item){
    if(item)openIndex(queue_->row(item),true);
  });
  connect(queue_,&QListWidget::customContextMenuRequested,this,[this](const QPoint &pos){
    const int index=queue_->indexAt(pos).row();
    if(index<0)return;
    QMenu menu(this);
    QAction *remove=menu.addAction(t("Remove from queue","Удалить из очереди"));
    connect(remove,&QAction::triggered,this,[this,index]{removeIndex(index);});
    menu.exec(queue_->viewport()->mapToGlobal(pos));
  });
  connect(playPause_,&QPushButton::clicked,this,[this]{
    if(current_<0){openFiles(false);return;}
    player_->togglePause();
  });
  connect(stop_,&QPushButton::clicked,this,[this] {
    if(current_<0)return;
    savePosition();
    suppressCompletion_=true;
    player_->stop();
    player_->seekTo(0);
    showStatus(t("Stopped","Остановлено"));
    suppressCompletion_=false;
  });
  connect(previous_,&QPushButton::clicked,this,&MainWindow::previous);
  connect(next_,&QPushButton::clicked,this,&MainWindow::next);
  connect(rewind_,&QPushButton::clicked,this,[this]{player_->seekBy(-10);});
  connect(forward_,&QPushButton::clicked,this,[this]{player_->seekBy(10);});
  connect(fullscreen_,&QPushButton::clicked,this,&MainWindow::toggleFullscreen);
  connect(subtitles_,&QPushButton::clicked,this,[this]{
    openSubtitleMenu(subtitles_->mapToGlobal(QPoint(0,subtitles_->height())));
  });
  connect(seek_,&QSlider::sliderPressed,this,[this]{userSeeking_=true;});
  connect(seek_,&QSlider::sliderReleased,this,[this]{
    userSeeking_=false;
    if(player_->duration()>0)
      player_->seekTo(player_->duration()*seek_->value()/1000.);
  });
  connect(volume_,&QSlider::valueChanged,this,[this](int value){
    player_->setVolume(value);
    volumeLabel_->setText(QString::number(value)+QStringLiteral("%"));
    settings_.setValue(QStringLiteral("volume"),value);
  });
  player_->setVolume(volume_->value());
  connect(rate_,QOverload<int>::of(&QComboBox::currentIndexChanged),
    this,[this](int index){player_->setPlaybackSpeed(rate_->itemData(index).toDouble());});
  connect(language_,QOverload<int>::of(&QComboBox::currentIndexChanged),
    this,&MainWindow::changeLanguage);
  connect(removeWatched_,&QAction::toggled,this,[this](bool value){
    settings_.setValue(QStringLiteral("removeWatched"),value);
  });
  connect(hardware_,&QAction::toggled,this,[this](bool value){
    player_->setHardwareAcceleration(value);
    settings_.setValue(QStringLiteral("hardware"),value);
  });
  player_->setHardwareAcceleration(hardware_->isChecked());
  connect(player_,&MpvWidget::finished,this,&MainWindow::completed);
  connect(player_,&MpvWidget::playbackStateChanged,this,&MainWindow::updatePlayback);
  connect(player_,&MpvWidget::positionChanged,this,&MainWindow::updateTime);
  connect(player_,&MpvWidget::fileLoaded,this,[this]{
    selectedSubtitle_=-1;
    player_->selectSubtitles(-1);
    restorePosition();
    refreshTrackIndicator();
    refreshChapterButton();
  });
  connect(player_,&MpvWidget::fullscreenRequested,this,&MainWindow::toggleFullscreen);
  connect(player_,&MpvWidget::contextRequested,this,&MainWindow::openContextMenu);
  connect(player_,&MpvWidget::volumeWheel,this,[this](int delta){
    volume_->setValue(qBound(0,volume_->value()+delta,100));
  });
  connect(player_,&MpvWidget::playbackError,this,&MainWindow::showStatus);
  auto *saveTimer=new QTimer(this);
  saveTimer->setInterval(5000);
  connect(saveTimer,&QTimer::timeout,this,&MainWindow::savePosition);
  saveTimer->start();
  rebuildLanguage();
  rebuildQueue();
  if(!player_->ready())
    showStatus(t("Native libmpv could not initialize","Не удалось запустить встроенный проигрыватель"));
  restoreLastFile();
}

QString MainWindow::t(const char *english,const char *russian) const {
  return QString::fromUtf8(russian_?russian:english);
}
void MainWindow::rebuildLanguage() {
  brand_->setText(russian_?QStringLiteral("ДК КИНЕХОЛЛ"):QStringLiteral("DK KINEHALL"));
  open_->setText(t("Open files","Открыть файлы"));
  addQueue_->setText(t("+ Add files","+ Добавить файлы"));
  clear_->setText(t("Clear queue","Очистить очередь"));
  openFolder_->setText(t("Choose folder","Выбрать папку"));
  subtitles_->setText(t("Subtitles ▾","Субтитры ▾"));
  removeWatched_->setText(t("Remove watched videos","Удалять просмотренные видео"));
  hardware_->setText(t("Hardware acceleration","Аппаратное ускорение"));
  fullscreen_->setToolTip(t("Fullscreen","Полный экран"));
  chapters_->setText(t("Chapters","Главы"));
  chapters_->setToolTip(t("Select chapters","Выбрать главы"));
  shuffle_->setText(t("Shuffle","Перемешать"));
  updateLoopButton();
  rewind_->setToolTip(t("Rewind 10 seconds","Назад на 10 секунд"));
  forward_->setToolTip(t("Forward 10 seconds","Вперёд на 10 секунд"));
  const DisplayMedia display=displayMedia(currentPath_);
  title_->setText(current_<0?t("Nothing playing","Нет воспроизведения"):display.name);
  source_->setText(current_<0?t("Choose a video or music file from this device.","Выберите видео или музыку на этом устройстве."):
    display.detail);
  refreshChapterButton();
  refreshTrackIndicator();
  rebuildQueue();
}
void MainWindow::changeLanguage(int index) {
  russian_=language_->itemData(index).toString()==QStringLiteral("ru");
  settings_.setValue(QStringLiteral("language"),russian_?QStringLiteral("ru"):QStringLiteral("en"));
  rebuildLanguage();
}
void MainWindow::rebuildQueue() {
  if (!queue_) return;
  QSignalBlocker block(queue_);
  queue_->clear();
  for (int index=0; index<paths_.size(); ++index) {
    const DisplayMedia display=displayMedia(paths_.at(index));
    const QString label=display.name+
      (display.detail.isEmpty()?QString():QStringLiteral("\n")+display.detail);
    auto *item=new QListWidgetItem(label,queue_);
    item->setData(Qt::UserRole,paths_.at(index));
    item->setSizeHint(QSize(272,140));
    const QString image=resolvePoster(paths_.at(index));
    if(!image.isEmpty()) {
      const QPixmap poster(image);
      if(!poster.isNull())
        item->setIcon(QIcon(poster.scaled(88,126,Qt::KeepAspectRatio,Qt::SmoothTransformation)));
    }
    item->setToolTip(QFileInfo(paths_.at(index)).fileName());
    if(index==current_) {
      QFont font=item->font();
      font.setBold(true);
      item->setFont(font);
    }
  }
  if(current_>=0&&current_<queue_->count())queue_->setCurrentRow(current_);
  clear_->setEnabled(!paths_.isEmpty());
}
QString MainWindow::resolvePoster(const QString &path) const {
  const QFileInfo video(path);
  const QDir dir=video.dir();
  const QStringList stems{video.completeBaseName(),
    QStringLiteral("poster"),QStringLiteral("folder"),
    QStringLiteral("cover"),QStringLiteral("front")};
  for(const QString &stem:stems)
    for(const QString &ext:QStringList{QStringLiteral(".jpg"),QStringLiteral(".jpeg"),
                            QStringLiteral(".png"),QStringLiteral(".webp")}) {
      const QString artwork=dir.absoluteFilePath(stem+ext);
      if(QFileInfo::exists(artwork))return artwork;
    }
  return {};
}
void MainWindow::openFiles(bool queueOnly) {
  const QStringList selected=QFileDialog::getOpenFileNames(this,
    t("Open media files","Открыть медиафайлы"),
    settings_.value(QStringLiteral("lastFolder"),QDir::homePath()).toString(),
    t("Media files","Медиафайлы")+QStringLiteral(" (*.mkv *.mp4 *.m4v *.avi *.webm *.mov *.ts *.mpeg *.mpg *.flac *.mp3 *.wav *.ogg *.opus);;")
    +t("All files","Все файлы")+QStringLiteral(" (*)"));
  if(selected.isEmpty())return;
  settings_.setValue(QStringLiteral("lastFolder"),QFileInfo(selected.first()).absolutePath());
  addPaths(selected,queueOnly);
}
void MainWindow::addPaths(const QStringList &paths,bool queueOnly) {
  // Opening a media file is an explicit Play Now action. Only the
  // separate + Add files and Choose folder actions are queue-only.
  const bool shouldStart=!queueOnly;
  int first=-1;
  for (const QString &candidate:paths) {
    const QFileInfo info(candidate);
    // Accept explicit user-chosen files regardless of extension: libmpv
    // can probe supported containers even with unusual file suffixes.
    if(!info.isFile() || !info.isReadable())continue;
    const QString absolute=info.absoluteFilePath();
    if(paths_.contains(absolute)) {
      if(first<0)first=paths_.indexOf(absolute);
      continue;
    }
    if(first<0)first=paths_.size();
    paths_.append(absolute);
  }
  rebuildQueue();
  if(shouldStart && first>=0)openIndex(first,true);
  else if(first>=0)showStatus(t("Added to Up Next","Добавлено в очередь"));
}
void MainWindow::openFolder() {
  const QString folder=QFileDialog::getExistingDirectory(this,
    t("Choose a media folder","Выберите папку"),
    settings_.value(QStringLiteral("lastFolder"),QDir::homePath()).toString());
  if(folder.isEmpty())return;
  settings_.setValue(QStringLiteral("lastFolder"),folder);
  QStringList found;
  QDirIterator iter(folder,QDir::Files|QDir::Readable|QDir::NoSymLinks,
    QDirIterator::Subdirectories);
  while(iter.hasNext() && found.size()<500) {
    const QString path=iter.next();
    if(isMedia(path))found.append(path);
  }
  QCollator collator;
  collator.setNumericMode(true);
  std::sort(found.begin(),found.end(),[&](const QString &a,const QString &b){
    return collator.compare(a,b)<0;
  });
  addPaths(found,true);
}
void MainWindow::openIndex(int index,bool autoplay) {
  if(index<0 || index>=paths_.size())return;
  savePosition();
  starting_=true;
  current_=index;
  currentPath_=paths_.at(index);
  selectedSubtitle_=-1;
  if(!player_->openFile(currentPath_)) {
    showStatus(t("Could not open this file","Не удалось открыть файл"));
    starting_=false;
    return;
  }
  if(autoplay)player_->play();
  else player_->pause();
  settings_.setValue(QStringLiteral("lastFile"),currentPath_);
  rebuildQueue();
  const DisplayMedia display=displayMedia(currentPath_);
  title_->setText(display.name);
  source_->setText(display.detail);
  refreshTrackIndicator();
  refreshChapterButton();
  starting_=false;
}
void MainWindow::removeIndex(int index) {
  if(index<0||index>=paths_.size())return;
  const bool active=index==current_;
  paths_.removeAt(index);
  if(active) {
    player_->stop();
    current_=-1;
    currentPath_.clear();
    if(index<paths_.size())openIndex(index,false);
    else {title_->setText(t("Nothing playing","Нет воспроизведения"));
          source_->setText(t("Choose a video or music file from this device.",
            "Выберите видео или музыку на этом устройстве."));}
  } else if(index<current_) --current_;
  rebuildQueue();
  refreshTrackIndicator();
}
void MainWindow::next() {
  if(current_<0||paths_.isEmpty())return;
  if(current_+1<paths_.size())openIndex(current_+1,true);
  else if(loopMode_==2 && paths_.size()>1)openIndex(0,true);
}
void MainWindow::previous() {
  if(current_<0||paths_.isEmpty())return;
  if(current_>0)openIndex(current_-1,true);
  else if(loopMode_==2 && paths_.size()>1)openIndex(paths_.size()-1,true);
  else player_->seekTo(0);
}
void MainWindow::completed() {
  if(suppressCompletion_||starting_||current_<0)return;
  const QString finished=currentPath_;
  settings_.remove(resumeKey(finished));
  if(loopMode_==1) {
    player_->seekTo(0);
    player_->play();
    return;
  }
  if(loopMode_==2 && !paths_.isEmpty()) {
    openIndex((current_+1)%paths_.size(),true);
    return;
  }
  if(removeWatched_->isChecked()) {
    paths_.removeAt(current_);
    const int nextIndex=current_;
    current_=-1;
    currentPath_.clear();
    if(nextIndex<paths_.size())openIndex(nextIndex,true);
    else {rebuildQueue(); title_->setText(t("Nothing playing","Нет воспроизведения"));
          source_->setText(t("Choose a video or music file from this device.",
            "Выберите видео или музыку на этом устройстве."));}
  } else if(current_+1<paths_.size())openIndex(current_+1,true);
  else showStatus(t("Finished playing","Воспроизведение завершено"));
}
void MainWindow::updatePlayback(bool playing) {
  playPause_->setText(playing?QStringLiteral("⏸"):QStringLiteral("▶"));
}
void MainWindow::updateTime(double pos,double length) {
  if(!userSeeking_)clock_->setText(clockText(pos));
  duration_->setText(clockText(length));
  if(!userSeeking_) {
    QSignalBlocker block(seek_);
    seek_->setValue(length>0?static_cast<int>(qBound(0.,pos/length,1.)*1000.):0);
  }
  seek_->setEnabled(length>0 && current_>=0);
}
void MainWindow::updateLoopButton() {
  const QStringList english{QStringLiteral("Loop: Off"),QStringLiteral("Loop: One"),QStringLiteral("Loop: All")};
  const QStringList russian{QStringLiteral("Повтор: выкл."),QStringLiteral("Повтор: один"),QStringLiteral("Повтор: все")};
  loop_->setText((russian_?russian:english).at(qBound(0,loopMode_,2)));
  loop_->setProperty("active",loopMode_!=0);
}

void MainWindow::shuffleUpcoming() {
  // Fisher-Yates in the pending section only: current playback never reloads.
  const int start=qMax(0,current_+1);
  for(int i=paths_.size()-1;i>start;--i) {
    const int j=start+QRandomGenerator::global()->bounded(i-start+1);
    paths_.swapItemsAt(i,j);
  }
  rebuildQueue();
}

void MainWindow::applyQueueReorder() {
  if(!queue_||queue_->count()!=paths_.size())return;
  QStringList reordered;
  for(int i=0;i<queue_->count();++i)
    reordered<<queue_->item(i)->data(Qt::UserRole).toString();
  if(reordered.size()!=paths_.size())return;
  for(const QString &path:reordered)
    if(!paths_.contains(path))return;
  paths_=reordered;
  if(!currentPath_.isEmpty())current_=paths_.indexOf(currentPath_);
  rebuildQueue();
}

void MainWindow::refreshChapterButton() {
  if(chapters_)chapters_->setEnabled(current_>=0&&!player_->chapters().isEmpty());
}

void MainWindow::openChapterMenu() {
  if(current_<0)return;
  const auto found=player_->chapters();
  if(found.isEmpty())return;
  QMenu menu(this);
  int index=0;
  for(const MediaChapter &chapter:found) {
    const QString title=chapter.title.isEmpty()?
      t("Chapter","Глава")+QStringLiteral(" ")+QString::number(++index):
      (index++,chapter.title);
    QAction *entry=menu.addAction(clockText(chapter.time)+QStringLiteral(" · ")+title);
    connect(entry,&QAction::triggered,this,[this,chapter]{
      player_->seekTo(chapter.time);
    });
  }
  menu.exec(chapters_->mapToGlobal(QPoint(0,chapters_->height())));
}

void MainWindow::populateSubtitleMenu(QMenu *menu) {
  menu->clear();
  QAction *off=menu->addAction(t("Off","Выключены"));
  off->setCheckable(true);
  off->setChecked(selectedSubtitle_<0);
  connect(off,&QAction::triggered,this,[this]{
    selectedSubtitle_=-1;
    player_->selectSubtitles(-1);
    refreshTrackIndicator();
  });
  menu->addSeparator();
  const auto allTracks=player_->tracks(QStringLiteral("sub"));
  QVector<MediaTrack> embedded;
  QVector<MediaTrack> external;
  for(const MediaTrack &track:allTracks)
    if(track.external)external.push_back(track);
    else embedded.push_back(track);
  if(embedded.isEmpty()) {
    QAction *none=menu->addAction(t("No embedded subtitles detected",
      "Встроенные субтитры не найдены"));
    none->setEnabled(false);
  } else {
    for(const MediaTrack &track:embedded) {
      const QString description=
        (track.language.isEmpty()?QString():track.language+QStringLiteral(" · "))+
        (track.title.isEmpty()?t("Track","Дорожка")+QStringLiteral(" ")+QString::number(track.id):track.title)+
        (track.codec.isEmpty()?QString():QStringLiteral(" · ")+track.codec);
      QAction *item=menu->addAction(description);
      item->setCheckable(true);
      item->setChecked(track.id==selectedSubtitle_);
      const qint64 id=track.id;
      connect(item,&QAction::triggered,this,[this,id]{
        player_->selectSubtitles(id);
        selectedSubtitle_=id;
        refreshTrackIndicator();
      });
    }
  }
  if(!external.isEmpty()){
    menu->addSeparator();
    QAction *heading=menu->addAction(t("Previously added external tracks",
      "Ранее добавленные внешние дорожки"));
    heading->setEnabled(false);
    for(const MediaTrack &track:external) {
      QAction *item=menu->addAction(track.title.isEmpty()?
        t("External track","Внешняя дорожка")+QStringLiteral(" ")+
        QString::number(track.id):track.title);
      item->setCheckable(true);
      item->setChecked(track.id==selectedSubtitle_);
      const qint64 id=track.id;
      connect(item,&QAction::triggered,this,[this,id]{
        player_->selectSubtitles(id);
        selectedSubtitle_=id;
        refreshTrackIndicator();
      });
    }
  }
  menu->addSeparator();
  QAction *externalAction=menu->addAction(t("Add external subtitle file…",
    "Добавить внешний файл субтитров…"));
  // This is deliberately the ONLY subtitle action that opens QFileDialog.
  connect(externalAction,&QAction::triggered,this,&MainWindow::addExternalSubtitle);
}
void MainWindow::openSubtitleMenu(const QPoint &pos) {
  QMenu menu(this);
  populateSubtitleMenu(&menu);
  menu.exec(pos);
}
void MainWindow::populateAudioMenu(QMenu *menu) {
  menu->clear();
  const auto audios=player_->tracks(QStringLiteral("audio"));
  if(audios.isEmpty()) {
    auto *none=menu->addAction(t("No audio tracks detected","Аудиодорожки не найдены"));
    none->setEnabled(false);
    return;
  }
  for(const MediaTrack &track:audios) {
    const QString label=(track.title.isEmpty()?
      t("Track","Дорожка")+QStringLiteral(" ")+QString::number(track.id):track.title)+
      (track.language.isEmpty()?QString():QStringLiteral(" · ")+track.language);
    QAction *choice=menu->addAction(label);
    choice->setCheckable(true);
    choice->setChecked(track.selected);
    const qint64 id=track.id;
    connect(choice,&QAction::triggered,this,[this,id]{
      player_->selectAudio(id);
    });
  }
}
void MainWindow::openContextMenu(const QPoint &pos) {
  QMenu menu(this);
  menu.addAction(player_->paused()?t("Play","Воспроизвести"):t("Pause","Пауза"),
    this,[this]{player_->togglePause();});
  menu.addAction(t("Stop","Стоп"),this,[this]{stop_->click();});
  menu.addAction(t("Back 10 seconds","Назад на 10 секунд"),
    this,[this]{player_->seekBy(-10);});
  menu.addAction(t("Forward 10 seconds","Вперёд на 10 секунд"),
    this,[this]{player_->seekBy(10);});
  menu.addSeparator();
  QMenu *sub=menu.addMenu(t("Subtitles","Субтитры"));
  populateSubtitleMenu(sub);
  QMenu *audio=menu.addMenu(t("Audio tracks","Аудиодорожки"));
  populateAudioMenu(audio);
  menu.addSeparator();
  menu.addAction(t("Fullscreen","Полный экран"),this,&MainWindow::toggleFullscreen);
  menu.exec(pos);
}
void MainWindow::addExternalSubtitle() {
  if(current_<0)return;
  const QString file=QFileDialog::getOpenFileName(this,
    t("Add external subtitle file","Добавить внешний файл субтитров"),
    QFileInfo(currentPath_).absolutePath(),
    t("Subtitle files","Файлы субтитров")+
    QStringLiteral(" (*.srt *.ass *.ssa *.vtt *.sub *.idx *.sup);;")+
    t("All files","Все файлы")+QStringLiteral(" (*)"));
  if(file.isEmpty())return;
  player_->loadExternalSubtitle(file);
  // The user's explicit external selection is handled by libmpv.
  showStatus(t("External subtitles selected","Выбраны внешние субтитры"));
}
void MainWindow::refreshTrackIndicator() {
  const auto tracks=player_->tracks(QStringLiteral("sub"));
  int embeddedCount=0;
  for(const MediaTrack &track:tracks)
    if(!track.external)++embeddedCount;
  if(current_<0) {
    subtitleLabel_->setText(t("No movie selected","Фильм не выбран"));
    return;
  }
  if(selectedSubtitle_>=0) {
    subtitleLabel_->setText(t("Subtitle track selected","Выбрана дорожка субтитров"));
    return;
  }
  subtitleLabel_->setText(embeddedCount==0?
    t("No embedded subtitle tracks","Встроенные субтитры не найдены"):
    t("Subtitles off · ","Субтитры выключены · ")+
      QString::number(embeddedCount)+
      t(" embedded track(s)"," встроенных дорожек"));
}
void MainWindow::toggleFullscreen() {
  if(isFullScreen())showNormal();
  else showFullScreen();
}
QString MainWindow::resumeKey(const QString &path) const {
  const QByteArray digest=QCryptographicHash::hash(path.toUtf8(),
    QCryptographicHash::Sha256).toHex();
  return QStringLiteral("resume/")+QString::fromLatin1(digest);
}
void MainWindow::savePosition() {
  if(currentPath_.isEmpty()||player_->duration()<4)return;
  const double pos=player_->position(),length=player_->duration();
  if(pos>2 && pos<length-4)settings_.setValue(resumeKey(currentPath_),pos);
  else if(pos>=length-4)settings_.remove(resumeKey(currentPath_));
}
void MainWindow::restorePosition() {
  if(currentPath_.isEmpty())return;
  const double saved=settings_.value(resumeKey(currentPath_),0).toDouble();
  if(saved>2 && player_->duration()>saved+4)player_->seekTo(saved);
}
void MainWindow::restoreLastFile() {
  const QString file=settings_.value(QStringLiteral("lastFile")).toString();
  if(file.isEmpty()||!QFileInfo(file).isReadable())return;
  paths_.append(file);
  openIndex(0,false);
}
void MainWindow::showStatus(const QString &message) {status_->setText(message);}
void MainWindow::closeEvent(QCloseEvent *event) {
  savePosition();
  settings_.sync();
  QMainWindow::closeEvent(event);
}
void MainWindow::keyPressEvent(QKeyEvent *event) {
  if(event->key()==Qt::Key_Escape&&isFullScreen()){showNormal();return;}
  if(event->modifiers()&Qt::ControlModifier) {
    if(event->key()==Qt::Key_O){openFiles(false);return;}
  }
  switch(event->key()){
    case Qt::Key_Space:
    case Qt::Key_K: if(current_>=0)player_->togglePause();break;
    case Qt::Key_F: toggleFullscreen();break;
    case Qt::Key_Left: player_->seekBy(-10);break;
    case Qt::Key_Right: player_->seekBy(10);break;
    case Qt::Key_S:
      openSubtitleMenu(subtitles_->mapToGlobal(QPoint(0,subtitles_->height())));
      break;
    default: QMainWindow::keyPressEvent(event); return;
  }
  event->accept();
}
void MainWindow::dragEnterEvent(QDragEnterEvent *event) {
  if(event->mimeData()->hasUrls())event->acceptProposedAction();
}
void MainWindow::dropEvent(QDropEvent *event) {
  QStringList local;
  for(const QUrl &url:event->mimeData()->urls())
    if(url.isLocalFile())local<<url.toLocalFile();
  addPaths(local,false);
  event->acceptProposedAction();
}
