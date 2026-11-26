#include "EpisodeMetadata.h"

#include <QCryptographicHash>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QRegularExpression>
#include <QSaveFile>
#include <QSettings>
#include <QStandardPaths>
#include <QTimer>
#include <QUrl>
#include <QUrlQuery>

namespace {
QString hashOf(const QString &value) {
  return QString::fromLatin1(QCryptographicHash::hash(
    value.toUtf8(), QCryptographicHash::Sha256).toHex());
}
bool trustedArtwork(const QUrl &url) {
  const QString host=url.host().toLower();
  return url.scheme()==QStringLiteral("https") &&
    (host==QStringLiteral("tvmaze.com") ||
     host.endsWith(QStringLiteral(".tvmaze.com")));
}
}

EpisodeMetadata::EpisodeMetadata(QObject *parent)
  : QObject(parent), network_(new QNetworkAccessManager(this)) {}

EpisodeLookup EpisodeMetadata::parse(const QString &filePath) {
  QString text=QFileInfo(filePath).completeBaseName();
  text.replace(QRegularExpression(QStringLiteral("[._]+")),QStringLiteral(" "));
  text=text.simplified();
  static const QRegularExpression marker(
    QStringLiteral(R"((?:^|[\s-])(?:S(\d{1,2})\s*E(\d{1,3})|(\d{1,2})\s*x\s*(\d{1,3}))(?=$|[\s-]))"),
    QRegularExpression::CaseInsensitiveOption);
  const auto match=marker.match(text);
  EpisodeLookup result;
  if(!match.hasMatch())return result;
  result.series=text.left(match.capturedStart()).trimmed();
  result.season=(match.captured(1).isEmpty()?match.captured(3):match.captured(1)).toInt();
  result.number=(match.captured(2).isEmpty()?match.captured(4):match.captured(2)).toInt();
  if(result.series.length()<2 || result.season<1 || result.season>99 ||
     result.number<1 || result.number>999)return {};
  result.filenameTitle=text.mid(match.capturedEnd()).trimmed();
  if(result.filenameTitle.startsWith(QLatin1Char('-')))
    result.filenameTitle=result.filenameTitle.mid(1).trimmed();
  result.filenameTitle.remove(QRegularExpression(
    QStringLiteral(R"((?:\s|^)(?:2160p|1080p|720p|480p|4k|uhd|hdr|WEB[- ]?DL|WEB[- ]?Rip|BluRay|HEVC|x264|x265|H264|H265|AC3|AAC|DTS|REMUX)(?:\s.*)?$)"),
    QRegularExpression::CaseInsensitiveOption));
  result.filenameTitle=result.filenameTitle.trimmed().left(140);
  return result;
}

QString EpisodeMetadata::localCachePath(const QString &cacheKey) const {
  const QString base=QStandardPaths::writableLocation(QStandardPaths::CacheLocation);
  return base+QStringLiteral("/episode-stills/")+cacheKey+QStringLiteral(".jpg");
}
QByteArray EpisodeMetadata::cachedArtwork(const QString &cacheKey) const {
  QFile stored(localCachePath(cacheKey));
  if(!stored.exists()||stored.size()>3*1024*1024||!stored.open(QIODevice::ReadOnly))
    return {};
  return stored.readAll();
}
void EpisodeMetadata::storeArtwork(const QString &cacheKey,const QByteArray &bytes) {
  if(bytes.isEmpty()||bytes.size()>3*1024*1024)return;
  const QString target=localCachePath(cacheKey);
  QDir().mkpath(QFileInfo(target).absolutePath());
  QSaveFile file(target);
  if(file.open(QIODevice::WriteOnly)) {
    if(file.write(bytes)!=bytes.size())file.cancelWriting();
    else file.commit();
  }
}
QNetworkReply *EpisodeMetadata::getJson(const QString &url) {
  QNetworkRequest request{QUrl(url)};
  request.setRawHeader("Accept","application/json");
  request.setRawHeader("User-Agent","DK-Kinehall/1.0 (local episode metadata)");
  request.setTransferTimeout(10000);
  return network_->get(request);
}

void EpisodeMetadata::request(const QString &filePath) {
  const EpisodeLookup episode=parse(filePath);
  if(!episode.valid()||seenPaths_.contains(filePath))return;
  seenPaths_.insert(filePath);
  const QString fingerprint=hashOf(episode.series.toCaseFolded()+
    QStringLiteral(":")+QString::number(episode.season)+
    QStringLiteral(":")+QString::number(episode.number));
  QSettings settings(QStringLiteral("DK Softworks"),QStringLiteral("DK Kinehall"));
  const QString saved=settings.value(QStringLiteral("episode-titles/")+fingerprint).toString();
  if(!saved.isEmpty()) {
    const QByteArray image=cachedArtwork(fingerprint);
    QTimer::singleShot(0,this,[this,filePath,saved,image]{
      emit metadataReady(filePath,saved,image);
    });
    return;
  }
  if(pending_.size()>=500)return;
  pending_.enqueue({filePath,episode,fingerprint});
  next();
}

void EpisodeMetadata::next() {
  if(busy_||pending_.isEmpty())return;
  busy_=true;
  const Job job=pending_.dequeue();
  const QString name=job.episode.series.toCaseFolded();
  if(showIds_.contains(name)) {
    fetchEpisode(job,showIds_.value(name));
    return;
  }
  QUrl url(QStringLiteral("https://api.tvmaze.com/singlesearch/shows"));
  QUrlQuery query;
  query.addQueryItem(QStringLiteral("q"),job.episode.series);
  url.setQuery(query);
  QNetworkReply *reply=getJson(url.toString());
  connect(reply,&QNetworkReply::finished,this,[this,reply,job,name]{
    const auto data=reply->readAll();
    const bool success=reply->error()==QNetworkReply::NoError && data.size()<256*1024;
    reply->deleteLater();
    const QJsonObject show=success?QJsonDocument::fromJson(data).object():QJsonObject();
    const int id=show.value(QStringLiteral("id")).toInt();
    if(id>0) {
      showIds_.insert(name,id);
      fetchEpisode(job,id);
    }else finish();
  });
}

void EpisodeMetadata::fetchEpisode(const Job &job,int showId) {
  QUrl url(QStringLiteral("https://api.tvmaze.com/shows/%1/episodebynumber")
    .arg(showId));
  QUrlQuery query;
  query.addQueryItem(QStringLiteral("season"),QString::number(job.episode.season));
  query.addQueryItem(QStringLiteral("number"),QString::number(job.episode.number));
  url.setQuery(query);
  QNetworkReply *reply=getJson(url.toString());
  connect(reply,&QNetworkReply::finished,this,[this,reply,job]{
    const QByteArray data=reply->readAll();
    const bool success=reply->error()==QNetworkReply::NoError &&
      data.size()<256*1024;
    reply->deleteLater();
    const QJsonObject episode=success?QJsonDocument::fromJson(data).object():QJsonObject();
    const QString title=episode.value(QStringLiteral("name")).toString().trimmed().left(180);
    if(title.isEmpty()) {finish();return;}
    QSettings settings(QStringLiteral("DK Softworks"),QStringLiteral("DK Kinehall"));
    settings.setValue(QStringLiteral("episode-titles/")+job.cacheKey,title);
    const QJsonObject image=episode.value(QStringLiteral("image")).toObject();
    const QString url=image.value(QStringLiteral("medium")).toString(
      image.value(QStringLiteral("original")).toString());
    if(!trustedArtwork(QUrl(url))) {
      emit metadataReady(job.path,title,{});
      finish();
      return;
    }
    fetchArtwork(job,title,url);
  });
}

void EpisodeMetadata::fetchArtwork(const Job &job,const QString &title,
                                   const QString &imageUrl) {
  QNetworkRequest request{QUrl(imageUrl)};
  request.setTransferTimeout(10000);
  QNetworkReply *reply=network_->get(request);
  connect(reply,&QNetworkReply::finished,this,[this,reply,job,title]{
    QByteArray data;
    if(reply->error()==QNetworkReply::NoError && reply->bytesAvailable()<=3*1024*1024)
      data=reply->readAll();
    reply->deleteLater();
    if(!data.isEmpty())storeArtwork(job.cacheKey,data);
    emit metadataReady(job.path,title,data);
    finish();
  });
}

void EpisodeMetadata::finish() {
  busy_=false;
  // Keep API calls spaced out. In-flight lookups share the single queue.
  QTimer::singleShot(750,this,[this]{next();});
}
