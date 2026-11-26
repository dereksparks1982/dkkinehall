/* DK Kinehall Russian interface: Cyrillic-only visible text.
   Only presentation is localized; media files, links and APIs are not modified. */
(() => {
  "use strict";
  const key = "dkmedia.web.language.v1";
  const translations = {
    "DK KINEHALL":"ДК КИНЕХОЛЛ",
    "DK Softworks":"ДК Софтворкс",
    "Artwork:":"Изображения:",
    "TVmaze":"ТВмейз",
    "TMDb":"ТМДБ",
    "Artwork data from":"Изображения предоставлены",
    "(CC BY-SA) and optional":"(на условиях свободной лицензии с указанием авторства) и при необходимости",
    ". This product is not endorsed or certified by TMDb.":". Создатели ТМДБ не поддерживают и не сертифицируют этот проигрыватель.",
    "For locally selected files containing season and episode numbers (such as S01E02), the player automatically searches TVmaze for matching episode images. Only the show title, season and episode numbers are sent, never your file or full local path. When no suitable artwork exists the play icon remains. For movies and additional TV artwork, you may optionally enter your own TMDb API Read Access Token.":"Для местных файлов, в имени которых указаны сезон и номер серии, проигрыватель ищет изображения в ТВмейз. Сервис получает только название сериала и номера сезона и серии. Сам файл и полный путь не передаются. Если подходящего изображения нет, остаётся значок воспроизведения. Для поиска изображений фильмов и дополнительных изображений сериалов можно ввести собственный ключ доступа ТМДБ.",
    "No saved links yet.":"Пока нет сохранённых ссылок.",
    "Use your TMDb Read Access Token.":"Введите ключ доступа ТМДБ.",
    "Episode artwork":"Изображение серии",
    "Movie posters require an optional TMDb token":"Для обложек фильмов необходим ключ ТМДБ",
    "DK Kinehall home":"Главная страница ДК Кинехолл",
    "Player":"Плеер", "Library":"Медиатека", "Help":"Справка",
    "＋ Open media":"＋ Открыть медиа", "Open media":"Открыть медиа",
    "Interface language":"Язык интерфейса",
    "Playback settings":"Настройки воспроизведения",
    "Original mode skips conversion and keeps the local source unchanged.":"Оригинальный режим не изменяет файл.",
    "Supported MKV files can be remuxed without re-encoding. Full transcoding and GPU switching are not installed.":"Совместимые файлы МКВ можно перепаковать без перекодирования. Полное перекодирование и переключение видеоускорения не установлены.",
    "This video format is not supported by the current playback engine.":"Текущий проигрыватель не поддерживает этот формат видео.",
    "Included audio tracks":"Встроенные звуковые дорожки",
    "Preparing video with included codecs…":"Подготовка видео встроенными кодеками…",
    "Playing with included codecs.":"Воспроизведение со встроенными кодеками.",
    "Included decoder output could not be played.":"Не удалось воспроизвести результат встроенного декодера.",
    "This media format could not be decoded.":"Не удалось декодировать этот формат медиа.",
    "Bundled native decoder":"Встроенный декодер",
    "Preparing included codecs":"Подготовка встроенных кодеков",
    "Requested playback format":"Выбранный формат воспроизведения",
    "Actual playback method":"Применённый способ воспроизведения",
    "MP4 included audio track":"Аудиодорожка в МП4",
    "Original-only MKV tracks":"Дорожки только в исходном МКВ",
    "Embedded MKV subtitles":"Встроенные субтитры МКВ",
    "Available from original file, not copied into MP4":"Доступны из исходного файла, не копируются в МП4",
    "No soundtrack":"Без звуковой дорожки",

    "Hardware acceleration preference":"Предпочтение аппаратного ускорения",
    "Original source":"Исходный файл",
    "Cached lossless remux":"Сохранённая перепаковка без потерь",
    "WebM lossless remux":"Перепаковка в ВебМ без потерь",
    "MP4 lossless remux":"Перепаковка в МП4 без потерь",
    "Unsupported conversion":"Неподдерживаемое преобразование",
    "Enabled (actual GPU use is controlled by Chromium)":"Включено (видеоускорением управляет Хромиум)",
    "Disabled preference (Chromium controls GPU use)":"Выключено (видеоускорением управляет Хромиум)",

    "Playback format":"Формат воспроизведения",
    "Automatic":"Автоматически",
    "Original (no conversion)":"Оригинал (без преобразования)",
    "MP4 (H.264/AAC)":"МП4 (АШ.264/ААС)",
    "WebM (VP9/Opus)":"ВебМ (ВП9/Опус)",
    "Prefer hardware acceleration":"Предпочитать аппаратное ускорение",
    "Remember format preference":"Запомнить выбранный формат",
    "Remove watched videos from Up Next":"Удалять просмотренные видео из очереди",
    "MP4 and WebM currently use compatible MKV remuxing, not full transcoding. Changes apply to the next opened file.":"МП4 и ВебМ пока доступны только при совместимых кодеках МКВ, без полного перекодирования. Настройки применяются к следующему файлу.",
    "Original playback skips remuxing. Changes apply to the next opened file.":"Оригинальное воспроизведение исключает перепаковку. Настройки применяются к следующему файлу.",
    "MP4/WebM require compatible codecs; full transcoding and GPU switching are not implemented. Changes apply to the next opened file.":"Для МП4 и ВебМ требуются совместимые кодеки. Полное перекодирование и переключение видеоускорения ещё не реализованы. Настройки применяются к следующему файлу.",
    "Checking MKV for the requested format…":"Проверка МКВ для выбранного формата…",
    "Requested format is not available for this file. It has not been converted.":"Выбранный формат недоступен для этого файла. Преобразование не выполнено.",
    "MP4 requires transcoding for this source; unavailable in this build.":"Для получения МП4 требуется перекодирование, пока недоступное.",
    "WebM requires transcoding for this source; unavailable in this build.":"Для получения ВебМ требуется перекодирование, пока недоступное.",

    "Main navigation":"Основная навигация",
    "Episode and movie artwork":"Изображения серий и фильмов",
    "Automatically find episode artwork":"Автоматически искать изображения серий",
    "Optional TMDb Read Access Token (this browser tab only)":"Необязательный ключ ТМДБ (только для этой вкладки)",
    "TMDb Read Access Token":"Ключ доступа ТМДБ",
    "TMDb token (optional)":"Ключ ТМДБ (необязательно)",
    "Apply token":"Применить ключ", "Clear token":"Очистить ключ",
    // The illustrative URL is interface copy. Actual URLs and user input are never changed.
    "https://example.com/movie.mp4":"Введите адрес медиафайла",
    "Size":"Размер", "Format":"Формат", "Direct stream URL":"Прямая ссылка на поток",
    "Remote media":"Удалённый медиафайл",
    "Remove from queue":"Удалить из очереди",
    "Drag to reorder":"Перетащите для изменения порядка",
    "Move queued video":"Переместить видео в очереди",
    "Shuffle":"Перемешать", "Loop: Off":"Повтор: выкл.", "Loop: One":"Повтор: один", "Loop: All":"Повтор: все",
    "Shuffle upcoming videos":"Перемешать следующие видео", "Queue playback order":"Порядок воспроизведения",
    "Shuffle enabled.":"Перемешивание включено.", "Shuffle disabled.":"Перемешивание выключено.",
    "Repeat mode: Off":"Режим повтора: выкл.", "Repeat mode: One":"Режим повтора: один",
    "Repeat mode: All":"Режим повтора: все",
    "Chapters":"Главы", "Select chapters":"Выбрать главы", "Close chapters":"Закрыть главы",
    "No chapters available":"Главы не найдены", "Float":"Отделить", "Dock":"Закрепить",
    "Float player":"Отделить окно", "Drag to move":"Перетащите для перемещения",
    "Drag floating player to move it":"Перетащите плавающее окно",
    "Drag to resize player":"Перетащите для изменения размера",
    "Float or dock the video":"Отделить или закрепить видео",
    "Move player into floating mode":"Отделить окно проигрывателя",
    "Dock player back into page":"Вернуть проигрыватель на страницу",
    "Chapter":"Глава", "Subtitle":"Субтитры",
    "Audio track":"Аудиодорожка",
    "Subtitle track":"Дорожка субтитров",
    "Media player and file drop area":"Проигрыватель и область перетаскивания файлов",
    "Selected video":"Выбранное видео", "Video options":"Настройки видео",
    "Media information":"Информация о файле", "Close media information":"Закрыть информацию",
    "Ready when you are":"Готово к просмотру",
    "Choose a video or music file from this device.":"Выберите видео или музыку на этом устройстве.",
    "Open files":"Открыть файлы", "Restore last file":"Восстановить последний файл",
    "You can also drag media files onto this window.":"Файлы также можно перетащить в окно.",
    "Playback controls":"Управление воспроизведением", "Playback position":"Позиция воспроизведения",
    "Previous media":"Предыдущий файл", "Previous":"Предыдущий", "Next media":"Следующий файл", "Next":"Следующий",
    "Rewind 10 seconds":"Назад на 10 секунд", "Forward 10 seconds":"Вперёд на 10 секунд",
    "Play":"Воспроизвести", "Pause":"Пауза", "Stop":"Стоп", "Play or pause":"Воспроизвести или приостановить",
    "Mute":"Выключить звук", "Unmute":"Включить звук", "Volume":"Громкость",
    "Playback speed":"Скорость воспроизведения", "Picture in picture":"Картинка в картинке",
    "Fullscreen":"На весь экран", "Exit fullscreen":"Выйти из полноэкранного режима",
    "Nothing playing":"Ничего не воспроизводится", "Select media to get started":"Выберите медиафайл",
    "Ready":"Готово", "LOCAL":"ЛОКАЛЬНЫЙ", "STREAM":"ПОТОК",
    "＋ Subtitles":"＋ Субтитры", "Subtitles off":"Субтитры выключены",
     "Turn subtitles on":"Включить субтитры", "Turn subtitles off":"Выключить субтитры",
     "Turn embedded subtitles on":"Включить встроенные субтитры",
    "No external subtitles":"Нет внешних субтитров",
    "Finding episode title…":"Поиск названия серии…",
    "Episode title unavailable":"Название серии недоступно",
    "Subtitle delay":"Задержка субтитров", "Delay":"Задержка",
    "Show subtitles 0.25 seconds earlier":"Показать субтитры на 0,25 секунды раньше",
    "Show subtitles 0.25 seconds later":"Показать субтитры на 0,25 секунды позже",
    "Reset subtitle delay":"Сбросить задержку субтитров", "Reset":"Сброс",
    "Local device":"Устройство",
    "Automatic artwork is available for TV episodes":"Автоматические изображения доступны для серий",
    "Open a direct media URL":"Открыть прямую ссылку на медиа",
    "Use a direct HTTPS/HTTP video or audio link, such as MP4, MP3, WebM, or an HLS stream on supported browsers. Video website pages are not media files.":"Укажите прямую ссылку на видео или аудиофайл. Поддерживаемые форматы зависят от браузера. Ссылки на страницы видеосайтов не подходят.",
    "Media address":"Адрес медиафайла", "Optional title":"Название (необязательно)",
    "Title (optional)":"Название (необязательно)", "Play URL":"Воспроизвести ссылку",
    "Playlist":"Плейлист", "Up Next":"Далее", "0 items":"0 файлов",
    "Your playlist is empty. Add a file to begin.":"Список воспроизведения пуст. Добавьте файл.",
    "＋ Add files":"＋ Добавить файлы", "Clear queue":"Очистить очередь",
    "Media folder access":"Доступ к папке с медиафайлами",
    "Choose a media folder":"Выберите папку с медиафайлами",
    "Choose folder":"Выбрать папку",
    "Reopen folder":"Открыть папку снова",
    "Forget folder":"Забыть папку",
    "No folder selected":"Папка не выбрана",
    "Folder contains no supported media files.":"В папке нет поддерживаемых медиафайлов.",
    "Folder available for this session. Choose it again next time.":"Папка доступна только в этом сеансе. В следующий раз выберите её снова.",
    "Folder access failed. Choose or reconnect the folder.":"Не удалось открыть папку. Выберите её заново или восстановите доступ.",
    "Folder access needs permission. Reopen to grant access.":"Для доступа к папке нужно разрешение. Откройте её снова.",
    "Folder is already in Up Next.":"Файлы этой папки уже находятся в очереди.",
    "Folder forgotten. Queued movies remain available this session.":"Папка забыта. Фильмы в очереди останутся до конца сеанса.",
    "Your collection":"Ваша коллекция",
    "Saved direct media links live in this browser.":"Сохранённые прямые ссылки хранятся в этом браузере.",
    "Saved streams and media links":"Сохранённые потоки и ссылки",
    "Play or remove your saved URLs. Local device files are never uploaded to GitHub.":"Воспроизводите или удаляйте сохранённые ссылки. Местные файлы остаются на вашем устройстве и не передаются на сервер.",
    "Clear saved links":"Очистить ссылки", "No saved media links yet.":"Пока нет сохранённых ссылок.",
    "Using the web player":"Как пользоваться веб-плеером",
    "Play files on this device":"Воспроизведение файлов на устройстве",
    "Choose one or several local media files in Chromium. They are never uploaded. After you approve file access, Kinehall can remember the selected file handle and restore playback. If permission expires, use Restore last file to grant access again or reselect the file.":"Выберите один или несколько местных медиафайлов в Хромиуме. Они никуда не загружаются. После разрешения доступа проигрыватель может запомнить файл и восстановить воспроизведение. Если разрешение истекло, воспользуйтесь восстановлением последнего файла и снова разрешите доступ или выберите файл.",
    "Play remote video":"Воспроизведение удалённого видео",
    "Paste a direct, publicly reachable media URL. The server must permit streaming, and the file must use a codec your browser understands. GitHub Pages does not host or expose videos on your Linux computer.":"Вставьте прямую общедоступную ссылку на медиафайл. Сервер должен разрешать потоковую передачу, а браузер должен поддерживать формат. Страницы Гитхаба не публикуют видео с вашего компьютера.",
    "Library and resume":"Медиатека и продолжение просмотра",
    "Save direct URLs to the Library to reopen later. Watched positions and saved links are stored only in this browser. They do not automatically sync to your other devices.":"Сохраняйте прямые ссылки в Медиатеке для повторного просмотра. Позиции воспроизведения и ссылки хранятся только в этом браузере и не синхронизируются с другими устройствами.",
    "Subtitles":"Субтитры",
    "Subtitles are off by default. Select a browser-supported subtitle track in the right-click menu or load SRT/VTT manually. Subtitle language preferences are remembered. For local MKV files, the player detects embedded subtitle track metadata, but the browser must still be able to decode the tracks. Full MKV subtitle playback is planned for DK Browser.":"По умолчанию субтитры выключены. Выберите поддерживаемую браузером дорожку в контекстном меню либо вручную загрузите файл субтитров. Языковые настройки запоминаются. Для местных файлов МКВ проигрыватель определяет встроенные дорожки, но их воспроизведение зависит от возможностей браузера. Полная поддержка встроенных субтитров планируется в ДК Браузере.",
    "On-screen controls":"Управление воспроизведением",
    "Stop displays the golden emblem again and Play restarts the same movie from the beginning. Move the pointer over the movie to reveal the seek bar and playback controls, YouTube-style. Hover or focus the timeline for a timestamp preview and a video frame when supported for a local file. They fade while playing and stay visible when paused. Double-click the picture for fullscreen; Esc exits. Right-click the video to open playback speed, subtitles, available audio tracks and chapters, aspect ratio, fullscreen, and media information. Unavailable browser track options are labeled rather than simulated. Space/K: play/pause; arrows: seek or volume; F: fullscreen; M: mute.":"Кнопка «Стоп» возвращает золотую эмблему, а «Воспроизвести» запускает тот же фильм с начала. Наведите указатель на видео, чтобы показать полосу перемотки и кнопки управления. При наведении на шкалу времени может появиться изображение кадра. Во время просмотра элементы управления скрываются, а на паузе остаются видимыми. Двойной щелчок переключает полный экран, а клавиша выхода закрывает его. Правый щелчок открывает скорость, субтитры, аудиодорожки, главы, формат изображения и сведения о файле. Недоступные возможности отмечены как недоступные. Пробел включает и приостанавливает воспроизведение, стрелки управляют перемоткой и громкостью.",
    "Chromium only":"Только Хромиум",
    "DK Kinehall is built exclusively for the Chromium engine. Its local-file permissions and playback capabilities follow Chromium; unrelated browser engines are not development targets.":"ДК Кинехолл предназначен исключительно для движка Хромиум. Разрешения на доступ к местным файлам и воспроизведение зависят от Хромиума. Другие браузерные движки не поддерживаются.",
    "DK Kinehall is free software. This web player runs independently in your browser, using video formats supported by that browser.":"ДК Кинехолл распространяется бесплатно. Веб-плеер работает непосредственно в браузере и поддерживает доступные ему видеоформаты.",
    "DK Kinehall · DK Softworks":"ДК Кинехолл · ДК Софтворкс",
    "Private local playback · No media uploads":"Локальное воспроизведение · Без загрузки файлов",
    "Choose media files":"Выберите медиафайлы", "Choose subtitle file":"Выберите файл субтитров",
    "Playback":"Воспроизведение", "Speed":"Скорость", "Audio tracks":"Аудиодорожки",
    "Browser audio tracks":"Аудиодорожки браузера",
    "Detected MKV audio (information only)":"Обнаруженные аудиодорожки МКВ (только сведения)",
    "Checking MKV audio tracks…":"Поиск аудиодорожек МКВ…",
    "Browser audio-track switching unavailable":"Переключение аудиодорожек недоступно",
    "This browser does not expose switchable audio streams.":"Этот браузер не предоставляет переключаемые аудиодорожки.",
    "MKV metadata alone cannot switch audio; use browser-exposed audio tracks above.":"Одних сведений о дорожках МКВ недостаточно для переключения звука. Выберите доступную аудиодорожку браузера выше.",
    "Browser audio-track selection is unavailable.":"Выбор аудиодорожек браузером недоступен.",
    "The browser did not activate that audio track.":"Браузер не включил эту аудиодорожку.",
    "The browser rejected audio-track switching.":"Браузер отклонил переключение аудиодорожки.",
    "Picture":"Изображение", "Chapters":"Главы",
    "▶  Play":"▶  Воспроизвести", "⏸  Pause":"⏸  Пауза",
    "⏹  Stop":"⏹  Стоп", "⏮  Previous":"⏮  Предыдущий",
    "⏭  Next":"⏭  Следующий", "↶  Back 10 seconds":"↶  Назад на 10 секунд",
    "↷  Forward 10 seconds":"↷  Вперёд на 10 секунд",
    "MKV embedded tracks (file header)":"Встроенные дорожки МКВ (заголовок файла)",
    "MKV embedded subtitles":"Встроенные субтитры МКВ",
    "Reading embedded MKV subtitles…":"Чтение встроенных субтитров МКВ…",
    "Reading embedded PGS graphics…":"Чтение встроенных графических субтитров ПГС…",
    "PGS subtitles loaded.":"Графические субтитры ПГС загружены.",
    "Couldn't display PGS subtitles.":"Не удалось показать субтитры ПГС.",
    "Reading embedded VobSub graphics…":"Чтение встроенных графических субтитров ВобСаб…",
    "Embedded VobSub subtitles loaded locally.":"Встроенные субтитры ВобСаб загружены с устройства.",
    "Couldn't decode VobSub subtitles:":"Не удалось декодировать субтитры ВобСаб:",
    "This subtitle codec is not yet supported by the player.":"Этот формат субтитров пока не поддерживается проигрывателем.",
    "VobSub":"ВобСаб",
    "Detected MKV video codec":"Обнаруженный видеокодек МКВ",
    "Checking MKV container compatibility…":"Проверка совместимости контейнера МКВ…",
    "Playing MKV using compatible WebM container.":"Воспроизведение МКВ через совместимый контейнер ВебМ.",
    "Preparing H.264 and AAC video for Chromium…":"Подготовка видео Эйч.264 и звука ААС для Хромиум…",
    "Playing H.264/AAC MKV through an MP4 container.":"Воспроизведение МКВ Эйч.264/ААС через контейнер МП4.",
    "This MKV video codec or container is not supported.":"Этот видеокодек или контейнер МКВ не поддерживается.",
    "This MKV file could not be inspected.":"Не удалось проверить файл МКВ.",
    "This format is not supported by the included Chromium audio decoder.":"Этот формат не поддерживается встроенным аудиодекодером Хромиум.",
    "PGS bitmap subtitle track":"Графическая дорожка ПГС",
    "This subtitle codec still requires a decoder (for example VobSub).":"Для этого формата субтитров по-прежнему необходим декодер.",
    "Codec unsupported":"Неподдерживаемый кодек",
    "This subtitle codec requires a decoder (for example PGS/VobSub).":"Для этого формата субтитров необходим декодер.",
    "This subtitle track could not be displayed.":"Не удалось показать эту дорожку субтитров.",
    "Embedded MKV text subtitles loaded.":"Встроенные текстовые субтитры МКВ загружены.",
    "Unknown format":"Неизвестный формат",
    "Couldn't read PGS subtitles":"Не удалось прочитать субтитры ПГС",
    "Checking MKV subtitle tracks…":"Поиск субтитров МКВ…",
    "＋ Load SRT / VTT…":"＋ Загрузить файл субтитров…",
    "Track selection not exposed by this browser":"Браузер не предоставляет выбор дорожки",
    "Fit full picture":"Показать всё изображение",
    "Fill frame (crop edges)":"Заполнить экран (обрезать края)",
    "Media information":"Сведения о файле",
    "Title":"Название", "Source":"Источник", "Resolution":"Разрешение",
    "Duration":"Продолжительность", "Browser subtitle tracks":"Дорожки субтитров браузера",
    "Detected MKV audio tracks":"Обнаруженные аудиодорожки МКВ",
    "Detected MKV subtitle tracks":"Обнаруженные субтитры МКВ",
    "Live / unknown":"Прямой эфир / неизвестно",
    "Remote URL":"Удалённая ссылка",
    "Local device · Not uploaded":"Локальное устройство · Без загрузки",
    "None in inspected header":"Не найдены в заголовке",
    "Scanning…":"Поиск…", "On":"Вкл.", "Off":"Выкл.",
    "Stopped":"Остановлено", "Press the red Play button to restart this movie.":"Нажмите красную кнопку воспроизведения, чтобы начать фильм сначала.",
    "No supported media file selected. Choose a video or audio file.":"Поддерживаемый файл не выбран. Выберите видео или аудио.",
    "Open a media file or paste a direct video link first.":"Сначала откройте медиафайл или вставьте прямую ссылку.",
    "Tap Play to start playback on this device.":"Нажмите «Воспроизвести» для запуска на этом устройстве.",
    "Couldn't start this media. Check its format or source.":"Не удалось запустить файл. Проверьте формат или источник.",
    "No readable video or audio file was selected.":"Не выбран доступный для чтения видео- или аудиофайл.",
    "The Chromium file picker could not open. Try dragging a file onto the player.":"Не удалось открыть выбор файлов Хромиума. Попробуйте перетащить файл в проигрыватель.",
    "Last stream restored. Press Play to resume.":"Последний поток восстановлен. Нажмите «Воспроизвести», чтобы продолжить.",
    "Last file restored. Press Play to resume.":"Последний файл восстановлен. Нажмите «Воспроизвести», чтобы продолжить.",
    "File restored. Press Play to resume.":"Файл восстановлен. Нажмите «Воспроизвести», чтобы продолжить.",
    "Choose the same file again to resume where you stopped.":"Выберите тот же файл, чтобы продолжить просмотр.",
    "Allow access or select the same file again to resume.":"Разрешите доступ или повторно выберите тот же файл.",
    "The saved file could not be reopened. Select it again.":"Не удалось повторно открыть сохранённый файл. Выберите его ещё раз.",
    "Choose your previously opened file to restore its saved position.":"Выберите ранее открытый файл для восстановления позиции.",
    "Enter a direct HTTP or HTTPS link to a media file.":"Введите прямую веб-ссылку на медиафайл.",
    "Direct media URL added. If playback fails, check the source and format.":"Прямая ссылка добавлена. Если воспроизведение не начнётся, проверьте источник и формат.",
    "No saved links yet. Play a media URL, then choose 'Save URL to Library'.":"Пока нет сохранённых ссылок. Добавьте ссылку на медиафайл.",
    "Remove":"Удалить",
    "Remove all saved links from this browser?":"Удалить все сохранённые ссылки из этого браузера?",
    "Up Next cleared.":"Очередь воспроизведения очищена.",
    "This file or stream isn't supported by your browser, or the URL isn't direct media.":"Этот файл или поток не поддерживается браузером либо ссылка не ведёт непосредственно к медиафайлу.",
    "Network error: the remote media couldn't be reached.":"Ошибка сети: удалённый файл недоступен.",
    "The browser couldn't decode this media format.":"Браузер не может декодировать этот формат.",
    "Unable to play this media source.":"Не удалось воспроизвести источник.",
    "Picture in picture isn't available for this video or browser.":"Режим «Картинка в картинке» недоступен для этого видео или браузера.",
    "Fullscreen isn't available in this browser.":"Полноэкранный режим недоступен в этом браузере.",
    "Fullscreen isn't available for this video.":"Полноэкранный режим недоступен для этого видео.",
    "Not available for this media":"Недоступно для данного файла",
    "MKV subtitle track is detected but not exposed for playback by this browser.":"Дорожка МКВ обнаружена, но браузер не позволяет её воспроизвести.",
    "Requires a browser audio track API or future DK Browser support":"Для выбора требуется поддержка аудиодорожек браузером или будущим ДК Браузером.",
    "Choose a .vtt or .srt subtitle file.":"Выберите файл субтитров поддерживаемого формата.",
    "Subtitle track loaded.":"Дорожка субтитров загружена.",
    "Couldn't read that subtitle file.":"Не удалось прочитать файл субтитров.",
    "LIVE":"ЭФИР",
    "Save URL to Library":"Сохранить ссылку в медиатеку"
  };
  const exact = text => Object.prototype.hasOwnProperty.call(translations, text) ?
    translations[text] : null;
  const russianPlural = (number, one, few, many) => {
    const n = Math.abs(Number(number));
    if (n % 10 === 1 && n % 100 !== 11) return one;
    if (n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14)) return few;
    return many;
  };
  function cyrillicDisplay(value) {
    // Translate known names first; transliterate unknown *visible* text only.
    // The real file names, URL values, API identifiers and media data are unchanged.
    const words = String(value)
      .replace(/TVmaze/gi, "ТВмейз")
      .replace(/TMDb/gi, "ТМДБ")
      .replace(/DK Softworks/gi, "ДК Софтворкс")
      .replace(/GitHub/gi, "Гитхаб")
      .replace(/Chromium/gi, "Хромиум")
      .replace(/WebM/gi, "ВебМ")
      .replace(/MKV/gi, "МКВ")
      .replace(/(\d+) channels\b/gi, "$1 каналов")
      .replace(/(\d+) channel\b/gi, "$1 канал")
      .replace(/ · default\b/gi, " · по умолчанию")
      .replace(/\bHz\b/gi, "Гц")
      .replace(/\bbit\b/gi, "бит")
      .replace(/PGS/gi, "ПГС")
      .replace(/SRT/gi, "СРТ")
      .replace(/VTT/gi, "ВТТ")
      .replace(/MiB/g, "МиБ");
    const digraphs = [["shch","щ"],["sch","щ"],["zh","ж"],
      ["ch","ч"],["sh","ш"],["kh","х"],["th","т"],
      ["ph","ф"],["qu","кв"],["ck","к"],["oo","у"],["ee","и"]];
    let result=words.replace(/[A-Za-z]+/g, word => {
      let out=word.toLowerCase();
      for (const [en,ru] of digraphs) out=out.replaceAll(en,ru);
      const letter={a:"а",b:"б",c:"к",d:"д",e:"е",f:"ф",g:"г",h:"х",
        i:"и",j:"дж",k:"к",l:"л",m:"м",n:"н",o:"о",p:"п",q:"к",
        r:"р",s:"с",t:"т",u:"у",v:"в",w:"в",x:"кс",y:"й",z:"з"};
      return out.replace(/[a-z]/g, c => letter[c]);
    });
    return result;
  }
  function translate(input) {
    const text = String(input);
    const plain = text.trim();
    let translated = exact(plain);
    let m;
    // Subtitle delay labels also update while switching English/Russian.
    if (translated === null && /^[+−-]?\d+(?:\.\d+)? s$/.test(plain))
      translated = plain.replace(/ s$/, " с");
    if (translated === null && (m = /^(\d+) items?$/.exec(plain)))
      translated = m[1] + " " + russianPlural(m[1], "файл", "файла", "файлов");
    if (translated === null && (m = /^Added (\d+) files? to the queue\.$/.exec(plain)))
      translated = "Добавлено " + m[1] + " " + russianPlural(m[1], "файл", "файла", "файлов") + " в очередь.";
    if (translated === null && (m = /^Added (\d+) files? from folder\.$/.exec(plain)))
      translated = "Из папки добавлено " + m[1] + " " + russianPlural(m[1], "файл", "файла", "файлов") + ".";
    if (translated === null && (m = /^Folder scan limited to (\d+) files\.$/.exec(plain)))
      translated = "Показано не более " + m[1] + " файлов из папки.";
    if (translated === null && (m = /^Saved folder: (.+)$/.exec(plain)))
      translated = "Сохранённая папка: " + m[1];
    if (translated === null && (m = /^Folder: (.+)$/.exec(plain)))
      translated = "Папка: " + m[1];
    if (translated === null && (m = /^Session folder: (.+)$/.exec(plain)))
      translated = "Папка текущего сеанса: " + m[1];
    if (translated === null && (m = /^Scanning folder: (.+)$/.exec(plain)))
      translated = "Поиск файлов в папке: " + m[1];
    if (translated === null && (m = /^Subtitles: (.+)$/.exec(plain)))
      translated = "Субтитры: " + m[1];
    if (translated === null && (m = /^Subtitles off · (\d+) embedded MKV tracks? found$/.exec(plain)))
      translated = "Субтитры выключены · Найдено " + m[1] + " " + russianPlural(m[1], "дорожка", "дорожки", "дорожек") + " МКВ";
    if (translated === null && (m = /^Preparing MP4: (\d+)% scanned…$/.exec(plain)))
      translated = "Подготовка МП4: " + m[1] + "% проверено…";
    if (translated === null && (m = /^Original MKV track (\d+)$/.exec(plain)))
      translated = "Исходная дорожка МКВ " + m[1];
    if (translated === null && (m = /^Volume (\d+)%$/.exec(plain)))
      translated = "Громкость " + m[1] + "%";
    if (translated === null && (m = /^Restore (.+)$/.exec(plain)))
      translated = "Восстановить " + m[1];
    if (translated === null && (m = /^Play (.+)$/.exec(plain)))
      translated = "Воспроизвести " + m[1];
    if (translated === null && (m = /^Remove (.+)$/.exec(plain)))
      translated = "Удалить " + m[1];
    if (translated === null && (m = /^Subtitle track (\d+)$/.exec(plain)))
      translated = "Дорожка субтитров " + m[1];
    if (translated === null && (m = /^Audio track (\d+)$/.exec(plain)))
      translated = "Аудиодорожка " + m[1];
    if (translated === null && (m = /^Audio track selected: (.+)$/.exec(plain)))
      translated = "Выбрана аудиодорожка: " + m[1];
    if (translated === null && (m = /^H\.264\/AAC container fallback unavailable: (.+)$/.exec(plain)))
      translated = "Не удалось использовать контейнер МП4 для Эйч.264/ААС: " + m[1];
    if (translated === null && (m = /^MKV container fallback failed: (.+)$/.exec(plain)))
      translated = "Не удалось применить совместимый контейнер МКВ: " + m[1];
    if (translated === null && (m = /^Included codec playback failed: (.+)$/.exec(plain)))
      translated = "Не удалось воспроизвести встроенным декодером: " + m[1];
    if (translated === null && (m = /^This MKV video codec is not supported: (.+)\.$/.exec(plain)))
      translated = "Этот видеокодек МКВ не поддерживается: " + m[1] + ".";
    if (translated === null && (m = /^Couldn't decode VobSub subtitles: (.+)$/.exec(plain)))
      translated = "Не удалось декодировать субтитры ВобСаб: " + m[1];
    if (translated === null && (m = /^Couldn't read PGS subtitles: (.+)$/.exec(plain)))
      translated = "Не удалось прочитать субтитры ПГС: " + m[1];
    if (translated === null && (m = /^Couldn't read embedded MKV subtitles: (.+)$/.exec(plain)))
      translated = "Не удалось прочитать встроенные субтитры МКВ: " + m[1];
    if (translated === null && (m = /^(.+) · Needs DK Browser$/.exec(plain)))
      translated = m[1] + " · Нужен ДК Браузер";
    // A defensive display-only fallback prevents new text, provider titles,
    // metadata labels and filenames from leaking Latin letters into Russian UI.
    const shown = translated === null ? text : text.replace(plain, translated);
    return cyrillicDisplay(shown);
  }
  function readLanguage() {
    try { return localStorage.getItem(key) === "ru" ? "ru" : "en"; }
    catch (_) { return "en"; }
  }
  let language = typeof document === "undefined" ? "en" : readLanguage();
  const texts = new WeakMap();
  const attrs = new WeakMap();
  const attrNames = ["aria-label", "title", "placeholder", "alt"];
  function renderText(node) {
    if (!node || node.nodeType !== 3 || !node.parentElement ||
        ["SCRIPT", "STYLE", "OPTION"].includes(node.parentElement.tagName)) return;
    const before = node.nodeValue;
    const previous = texts.get(node);
    const original = previous && previous.rendered === before ? previous.original : before;
    const after = language === "ru" ? translate(original) : original;
    texts.set(node, {original, rendered: after});
    if (before !== after) node.nodeValue = after;
  }
  function renderAttributes(element) {
    if (!element || element.nodeType !== 1) return;
    let saved = attrs.get(element);
    if (!saved) { saved = {}; attrs.set(element, saved); }
    for (const attr of attrNames) {
      const before = element.getAttribute(attr);
      if (before === null) continue;
      const previous = saved[attr];
      const original = previous && previous.rendered === before ? previous.original : before;
      const after = language === "ru" ? translate(original) : original;
      saved[attr] = {original, rendered:after};
      if (before !== after) element.setAttribute(attr, after);
    }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { renderText(root); return; }
    if (root.nodeType !== 1) return;
    renderAttributes(root);
    const nodes = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    while (nodes.nextNode()) {
      const node = nodes.currentNode;
      if (node.nodeType === 3) renderText(node);
      else renderAttributes(node);
    }
  }
  function apply() {
    document.documentElement.lang = language;
    // Shared interface, different packaging: don't label the local Chromium
    // desktop application "Web". Only the hosted website uses that title.
    const standalone = typeof window.DKStandalone?.setFullscreen === "function";
    document.title = standalone ?
      (language === "ru" ? "ДК Кинехолл" : "DK Kinehall") :
      (language === "ru" ? "ДК Кинехолл | Веб" : "DK Kinehall | Web");
    const manifest = document.querySelector('link[rel="manifest"]');
    if (manifest) manifest.href =
      language === "ru" ? "./manifest-ru.webmanifest?v=20261117-3" :
      "./manifest.webmanifest?v=20261117-3";
    const appTitle = document.querySelector('meta[name="application-name"]');
    if (appTitle) appTitle.content = language === "ru" ? "ДК Кинехолл" : "DK Kinehall";
    const selector = document.getElementById("languageSelect");
    if (selector) {
      selector.value = language;
      const englishOption = selector.querySelector('option[value="en"]');
      if (englishOption) englishOption.textContent =
        language === "ru" ? "Английский" : "English";
    }
    const formatSelect = document.getElementById("playbackFormat");
    if (formatSelect) {
      const names = {
        auto:["Automatic","Автоматически"],
        original:["Original (no conversion)","Оригинал (без преобразования)"],
        mp4:["MP4 (H.264/AAC)","МП4 (АШ.264/ААС)"],
        webm:["WebM (VP9/Opus)","ВебМ (ВП9/Опус)"]
      };
      for (const option of formatSelect.options) {
        const pair = names[option.value];
        if (pair) option.textContent = pair[language === "ru" ? 1 : 0];
      }
    }
    walk(document.body);
  }
  function setLanguage(next) {
    language = next === "ru" ? "ru" : "en";
    try { localStorage.setItem(key, language); } catch (_) {}
    apply();
  }
  if (typeof document === "undefined") {
    if (typeof module !== "undefined") module.exports = {translate, translations, russianPlural};
    return;
  }
  window.DKLocale = {t: value => language === "ru" ? translate(value) : String(value),
    get: () => language, set: setLanguage, apply};
  apply();
  const select = document.getElementById("languageSelect");
  if (select) select.addEventListener("change", event => setLanguage(event.target.value));
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "characterData") renderText(record.target);
      else if (record.type === "attributes") renderAttributes(record.target);
      else for (const node of record.addedNodes) walk(node);
    }
  });
  observer.observe(document.body, {subtree:true, childList:true, characterData:true,
    attributes:true, attributeFilter:attrNames});
})();