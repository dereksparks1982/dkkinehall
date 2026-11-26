#pragma once

#include <QObject>
#include <QByteArray>
#include <QHash>
#include <QQueue>
#include <QSet>
#include <QString>

// Only a series title and season/episode numbers leave the device.
// Never send full source paths, video bytes or release filenames.
struct EpisodeLookup {
  QString series;
  QString filenameTitle;
  int season = 0;
  int number = 0;
  bool valid() const { return !series.isEmpty() && season>0 && number>0; }
};

class QNetworkAccessManager;
class QNetworkReply;

class EpisodeMetadata final : public QObject {
  Q_OBJECT
public:
  explicit EpisodeMetadata(QObject *parent = nullptr);
  static EpisodeLookup parse(const QString &filePath);
  void request(const QString &filePath);
signals:
  void metadataReady(const QString &filePath,
                     const QString &episodeTitle,
                     const QByteArray &imageBytes);
private:
  struct Job {
    QString path;
    EpisodeLookup episode;
    QString cacheKey;
  };
  QNetworkAccessManager *network_ = nullptr;
  QQueue<Job> pending_;
  QSet<QString> seenPaths_;
  QHash<QString,int> showIds_;
  bool busy_ = false;

  void next();
  void fetchEpisode(const Job &job, int showId);
  void fetchArtwork(const Job &job, const QString &title,
                    const QString &imageUrl);
  void finish();
  QString localCachePath(const QString &cacheKey) const;
  QByteArray cachedArtwork(const QString &cacheKey) const;
  void storeArtwork(const QString &cacheKey, const QByteArray &image);
  QNetworkReply *getJson(const QString &url);
};
