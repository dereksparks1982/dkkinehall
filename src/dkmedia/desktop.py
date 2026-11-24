"""DK Kinehall standalone desktop player, using the existing libVLC controller.

This is a native Tk interface, not a browser wrapper. Portable distribution
must bundle Python/Tk, Pillow, python-vlc, libVLC and its codec plugins.
"""
from __future__ import annotations

import argparse
import sys
import tkinter as tk
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

try:
    from tkinterdnd2 import DND_FILES, TkinterDnD
    NativeTk = TkinterDnD.Tk
except ImportError:
    DND_FILES = None
    NativeTk = tk.Tk

from .artwork import artwork_for
from .library import MediaState
from .paths import is_media_file
from .player import VLCMediaController, VLCUnavailable

BG = "#16090c"
PANEL = "#251317"
PANEL2 = "#361c22"
RED = "#bb2434"
RED_HOVER = "#d33845"
GOLD = "#eacb8d"
TEXT = "#f5e5df"
DIM = "#bda7a6"
BLACK = "#000000"
BORDER = "#64313b"
WHITE = "#ffffff"

TRANSLATIONS = {
    "en": {
        "app": "DK KINEHALL", "open": "Open files", "restore": "Restore last file",
        "prompt": "Choose a video or music file from this device.",
        "queue": "Up Next", "empty_queue": "Your queue is empty",
        "playing": "Now playing", "local": "Local file", "remove": "Remove",
        "stop": "Stop", "previous": "Previous", "next": "Next",
        "back": "Back 10 seconds", "forward": "Forward 10 seconds",
        "play": "Play", "pause": "Pause", "mute": "Mute", "volume": "Volume",
        "fullscreen": "Fullscreen", "pip": "Picture in picture",
        "subtitles": "Subtitles", "off": "Off", "external": "Load SRT / VTT…",
        "audio": "Audio tracks", "speed": "Speed", "picture": "Picture",
        "fit": "Fit full picture", "crop": "Fill frame (crop edges)",
        "info": "Media information", "no_tracks": "No selectable tracks",
        "ready": "Ready", "file_missing": "This local file could not be found.",
        "could_not_play": "Unable to play this media file.",
        "language": "Language", "exit_pip": "Return video to player",
        "unknown": "Unknown", "source": "Source", "duration": "Duration",
        "resolution": "Resolution", "size": "Size", "rate": "Playback speed",
        "tracks": "Audio tracks", "sub_tracks": "Subtitle tracks",
        "stopped": "Stopped", "choose": "Choose media files",
        "no_video": "Open a video first", "tvmaze": "Episode artwork: TVmaze",
    },
    "ru": {
        "app": "ДК КИНЕХОЛЛ", "open": "Открыть файлы", "restore": "Открыть последний файл",
        "prompt": "Выберите видео или музыкальный файл на устройстве.",
        "queue": "Далее", "empty_queue": "Список воспроизведения пуст",
        "playing": "Сейчас играет", "local": "Локальный файл",
        "remove": "Удалить", "stop": "Стоп", "previous": "Предыдущее",
        "next": "Следующее", "back": "Назад на 10 секунд",
        "forward": "Вперёд на 10 секунд", "play": "Воспроизвести",
        "pause": "Пауза", "mute": "Без звука", "volume": "Громкость",
        "fullscreen": "Полный экран", "pip": "Окно поверх всех",
        "subtitles": "Субтитры", "off": "Выключить",
        "external": "Загрузить субтитры…", "audio": "Звуковые дорожки",
        "speed": "Скорость", "picture": "Изображение",
        "fit": "Показать полностью", "crop": "Заполнить экран",
        "info": "Сведения о файле", "no_tracks": "Нет доступных дорожек",
        "ready": "Готово", "file_missing": "Локальный файл не найден.",
        "could_not_play": "Не удалось воспроизвести файл.",
        "language": "Язык", "exit_pip": "Вернуть видео в проигрыватель",
        "unknown": "Неизвестно", "source": "Источник",
        "duration": "Длительность", "resolution": "Разрешение",
        "size": "Размер", "rate": "Скорость воспроизведения",
        "tracks": "Звуковые дорожки", "sub_tracks": "Дорожки субтитров",
        "stopped": "Остановлено", "choose": "Выберите файлы",
        "no_video": "Сначала откройте видео",
        "tvmaze": "Изображения серий: ТВмейз",
    },
}


def resource(relative: str) -> Path:
    """Find assets beside a source checkout or inside the frozen application."""
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS")) / relative
    return Path(__file__).resolve().parents[2] / relative


def formatted(ms: int) -> str:
    seconds = max(0, int(ms) // 1000)
    if seconds >= 3600:
        return f"{seconds // 3600}:{seconds // 60 % 60:02}:{seconds % 60:02}"
    return f"{seconds // 60}:{seconds % 60:02}"


class Kinehall(NativeTk):
    def __init__(self, first_file: str | None = None):
        super().__init__()
        self.data = MediaState()
        self.lang = self.data.setting("kinehall_language", "en")
        if self.lang not in TRANSLATIONS:
            self.lang = "en"
        self.title(self.tr("app"))
        self.configure(bg=BG)
        self.geometry("1300x805")
        self.minsize(940, 610)
        self.controller: VLCMediaController | None = None
        self.queue: list[str] = []
        self.current_index = -1
        self.current_file: str | None = None
        self.stopped = True
        self.playing = False
        self.handled_end = False
        self.seek_dragging = False
        self.fullscreen = False
        self.pip_window: tk.Toplevel | None = None
        self.pip_host: tk.Frame | None = None
        self._thumbs: dict[str, object] = {}
        self._art_pending: set[str] = set()
        self._workers = ThreadPoolExecutor(max_workers=2, thread_name_prefix="kinehall-art")
        self._cursor_job: str | None = None
        self._controls_job: str | None = None
        self._resume_job: str | None = None
        self._last_resume_ms = -1
        self._saved_volume = max(0, min(100, int(self.data.volume())))
        self.volume = tk.IntVar(value=self._saved_volume)
        self.muted = False
        self.speed = tk.StringVar(value="1")
        self.status = tk.StringVar(value=self.tr("ready"))
        self._make_ui()
        self.protocol("WM_DELETE_WINDOW", self._close)
        self.bind_all("<F11>", lambda e: self._key_fullscreen())
        self.bind_all("<Escape>", self._escape)
        self.bind_all("<KeyPress-f>", lambda e: self._key_fullscreen())
        self.bind_all("<KeyPress-k>", lambda e: self._key_play())
        self.bind_all("<space>", lambda e: self._key_play())
        self.bind_all("<Left>", lambda e: self._key_seek(-5))
        self.bind_all("<Right>", lambda e: self._key_seek(5))
        self.bind_all("<Up>", lambda e: self._key_volume(5))
        self.bind_all("<Down>", lambda e: self._key_volume(-5))
        self.bind_all("<KeyPress-m>", lambda e: self._key_mute())
        self.after(350, self._tick)
        if first_file and Path(first_file).is_file():
            self.after(200, lambda: self.add_files([first_file]))
        self._refresh_restore()

    def tr(self, key: str) -> str:
        return TRANSLATIONS[self.lang].get(key, key)

    def _button(self, parent, text: str, command, *, prominent=False, width=None):
        return tk.Button(parent, text=text, command=command, bg=RED if prominent else PANEL2,
            fg=TEXT, activebackground=RED_HOVER, activeforeground=WHITE, relief="flat",
            bd=0, font=("DejaVu Sans", 10, "bold"), cursor="hand2", pady=8,
            padx=10, width=width, highlightthickness=0)

    def _image(self, path: Path, width: int, height: int):
        try:
            from PIL import Image, ImageOps, ImageTk
            with Image.open(path) as original:
                rgba = ImageOps.fit(original.convert("RGB"), (width, height),
                    method=Image.Resampling.LANCZOS)
                return ImageTk.PhotoImage(rgba)
        except (ImportError, OSError, ValueError):
            return None

    def _make_ui(self):
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)
        self.header = tk.Frame(self, bg=BG, height=65)
        self.header.grid(row=0, column=0, sticky="ew", padx=22, pady=(9, 4))
        self.header.grid_columnconfigure(1, weight=1)
        icon = resource("assets/images/dk-media-player-64.png")
        self.app_icon = None
        if icon.is_file():
            try:
                self.app_icon = tk.PhotoImage(file=str(icon))
                self.iconphoto(True, self.app_icon)
                tk.Label(self.header, image=self.app_icon, bg=BG).grid(row=0,column=0,padx=(0,12))
            except tk.TclError:
                pass
        self.brand = tk.Label(self.header, text=self.tr("app"), bg=BG, fg=GOLD,
            font=("DejaVu Sans", 19, "bold"))
        self.brand.grid(row=0,column=1,sticky="w")
        self.language_button = self._button(self.header, "Русский" if self.lang=="en" else "English",
            self._change_language)
        self.language_button.grid(row=0,column=2)

        self.body = tk.Frame(self, bg=BG)
        self.body.grid(row=1,column=0,sticky="nsew",padx=16,pady=(2,10))
        self.body.grid_rowconfigure(0, weight=1)
        self.body.grid_columnconfigure(0, weight=1)
        self.left = tk.Frame(self.body,bg=BG)
        self.left.grid(row=0,column=0,sticky="nsew",padx=(0,12))
        self.left.grid_rowconfigure(0,weight=1)
        self.left.grid_columnconfigure(0,weight=1)
        self.video = tk.Frame(self.left,bg=BLACK,highlightbackground=BORDER,
            highlightthickness=1,cursor="arrow")
        self.video.grid(row=0,column=0,sticky="nsew")
        self.video.grid_propagate(False)
        self.video.bind("<Double-Button-1>",lambda e:self._double_click())
        self.video.bind("<Button-3>",self._context_menu)
        self.video.bind("<Motion>",self._video_motion)
        self.video.bind("<Enter>",self._video_motion)
        self.video.bind("<Leave>",self._cursor_visible)
        self.video.bind("<MouseWheel>",self._wheel)
        self.video.bind("<Button-4>",lambda e:self._wheel_step(5))
        self.video.bind("<Button-5>",lambda e:self._wheel_step(-5))

        self.welcome = tk.Frame(self.video,bg=BLACK)
        self.welcome.place(relx=.5,rely=.5,anchor="center")
        emblem = resource("docs/images/golden-emblem.png")
        self.welcome_emblem = self._image(emblem,240,134) if emblem.is_file() else None
        if self.welcome_emblem:
            tk.Label(self.welcome,image=self.welcome_emblem,bg=BLACK).pack(pady=(0,12))
        self.welcome_message = tk.Label(self.welcome,text=self.tr("prompt"),bg=BLACK,
            fg=TEXT,font=("DejaVu Sans",12),wraplength=440)
        self.welcome_message.pack(pady=(0,12))
        self.welcome_open = self._button(self.welcome,self.tr("open"),self._choose_files,
            prominent=True)
        self.welcome_open.pack(pady=(0,6))
        self.welcome_restore = self._button(self.welcome,self.tr("restore"),
            self._restore_last)
        self.welcome_restore.pack()

        self.controls = tk.Frame(self.left,bg=PANEL,highlightbackground=BORDER,
            highlightthickness=1)
        self.controls.grid(row=1,column=0,sticky="ew")
        self.controls.grid_columnconfigure(0,weight=1)
        self.timeline = ttk.Scale(self.controls,from_=0,to=1000,orient="horizontal")
        self.timeline.grid(row=0,column=0,sticky="ew",padx=(12,8),pady=(10,2))
        self.timeline.bind("<ButtonPress-1>",lambda e:setattr(self,"seek_dragging",True))
        self.timeline.bind("<ButtonRelease-1>",self._seek_released)
        self.time_label = tk.Label(self.controls,text="0:00 / 0:00",bg=PANEL,fg=TEXT,
            font=("DejaVu Sans",10))
        self.time_label.grid(row=0,column=1,padx=(0,12))
        self.buttons = tk.Frame(self.controls,bg=PANEL)
        self.buttons.grid(row=1,column=0,columnspan=2,sticky="ew",padx=7,pady=7)
        for char, func, key, strong in [
            ("⏮",self._previous,"previous",False),("↶ 10",lambda:self._seek(-10),"back",False),
            ("▶",self._play_pause,"play",True),("■",self._stop,"stop",False),
            ("10 ↷",lambda:self._seek(10),"forward",False),("⏭",self._next,"next",False)]:
            button=self._button(self.buttons,char,func,prominent=strong,width=5)
            button.pack(side="left",padx=2)
            setattr(self,key+"_button",button)
        self.volume_label = tk.Label(self.buttons,text="100%",bg=PANEL,fg=GOLD)
        self.volume_label.pack(side="right",padx=(2,7))
        self.volume_slider = ttk.Scale(self.buttons,from_=0,to=100,orient="horizontal",
            variable=self.volume,command=self._volume_changed,length=85)
        self.volume_slider.pack(side="right",padx=4)
        self.mute_button=self._button(self.buttons,"◖))",self._toggle_mute,width=3)
        self.mute_button.pack(side="right",padx=2)
        self.fullscreen_button=self._button(self.buttons,"⛶",self._fullscreen,width=3)
        self.fullscreen_button.pack(side="right",padx=2)
        self.pip_button=self._button(self.buttons,"▣",self._pip,width=3)
        self.pip_button.pack(side="right",padx=2)
        self.rate_button=self._button(self.buttons,"1×",self._rate_menu,width=3)
        self.rate_button.pack(side="right",padx=2)

        self.sidebar=tk.Frame(self.body,bg=PANEL,width=310,highlightbackground=BORDER,
            highlightthickness=1)
        self.sidebar.grid(row=0,column=1,sticky="nsew")
        self.sidebar.grid_propagate(False)
        self.sidebar.grid_rowconfigure(1,weight=1)
        self.sidebar.grid_columnconfigure(0,weight=1)
        toolbar=tk.Frame(self.sidebar,bg=PANEL)
        toolbar.grid(row=0,column=0,sticky="ew",padx=10,pady=10)
        self.queue_label=tk.Label(toolbar,text=self.tr("queue"),bg=PANEL,
            fg=GOLD,font=("DejaVu Sans",14,"bold"))
        self.queue_label.pack(side="left")
        self.open_button=self._button(toolbar,self.tr("open"),self._choose_files,
            prominent=True)
        self.open_button.pack(side="right")
        list_host=tk.Frame(self.sidebar,bg=PANEL)
        list_host.grid(row=1,column=0,sticky="nsew")
        self.queue_canvas=tk.Canvas(list_host,bg=PANEL,highlightthickness=0,width=300)
        scroll=tk.Scrollbar(list_host,orient="vertical",command=self.queue_canvas.yview)
        self.queue_canvas.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right",fill="y")
        self.queue_canvas.pack(side="left",fill="both",expand=True)
        self.queue_items=tk.Frame(self.queue_canvas,bg=PANEL)
        self.queue_window=self.queue_canvas.create_window((0,0),window=self.queue_items,
            anchor="nw")
        self.queue_items.bind("<Configure>",self._queue_height)
        self.queue_canvas.bind("<Configure>",self._queue_width)
        self.queue_canvas.bind("<MouseWheel>",self._queue_wheel)
        if DND_FILES is not None:
            for target in (self.video, self.queue_canvas):
                target.drop_target_register(DND_FILES)
                target.dnd_bind("<<Drop>>",self._drop_files)
        self.footer=tk.Label(self,textvariable=self.status,bg=BG,fg=DIM,
            anchor="w",font=("DejaVu Sans",9))
        self.footer.grid(row=2,column=0,sticky="ew",padx=20,pady=(0,7))
        self._render_queue()

    def _queue_height(self,_event=None):
        self.queue_canvas.configure(scrollregion=self.queue_canvas.bbox("all"))

    def _queue_width(self,event):
        self.queue_canvas.itemconfig(self.queue_window,width=event.width)

    def _queue_wheel(self,event):
        self.queue_canvas.yview_scroll(-1 if event.delta>0 else 1,"units")
        return "break"

    def _image_label(self,parent,path):
        label=tk.Label(parent,text="▶",bg=BLACK,fg=GOLD,width=20,height=6)
        label.pack(side="left",padx=(4,8))
        if path in self._thumbs:
            label.configure(image=self._thumbs[path],text="",width=170,height=96)
        elif path not in self._art_pending:
            self._art_pending.add(path)
            try:
                future=self._workers.submit(artwork_for,path)
                future.add_done_callback(lambda task, name=path:
                    self._art_ready(name,task))
            except RuntimeError:
                pass
        return label

    def _art_ready(self,path,future):
        try:
            result=future.result()
        except Exception:
            result=None
        try:
            self.after(0,lambda:self._set_art(path,result))
        except (RuntimeError,tk.TclError):
            pass

    def _set_art(self,path,result):
        self._art_pending.discard(path)
        if result is not None:
            image=self._image(result,170,96)
            if image is not None:
                self._thumbs[path]=image
        if path in self.queue:
            self._render_queue()

    def _render_queue(self):
        for widget in self.queue_items.winfo_children():
            widget.destroy()
        if not self.queue:
            tk.Label(self.queue_items,text=self.tr("empty_queue"),bg=PANEL,
                fg=DIM,pady=28).pack(fill="x")
            return
        for index,path in enumerate(self.queue):
            active=index==self.current_index
            row=tk.Frame(self.queue_items,bg=RED if active else PANEL2,
                highlightbackground=RED if active else BORDER,highlightthickness=2 if active else 1)
            row.pack(fill="x",padx=6,pady=5)
            play=tk.Frame(row,bg=RED if active else PANEL2,cursor="hand2")
            play.pack(side="left",fill="both",expand=True)
            picture=self._image_label(play,path)
            title=tk.Label(play,text=Path(path).name,bg=RED if active else PANEL2,
                fg=TEXT,font=("DejaVu Sans",9,"bold"),anchor="w",justify="left",
                wraplength=90)
            title.pack(side="left",fill="x",expand=True)
            for widget in (play,picture,title):
                widget.bind("<Button-1>",lambda e,i=index:self._load(i))
            remove=self._button(row,"×",lambda i=index:self._remove(i),width=2)
            remove.pack(side="right",padx=(2,3))

    def _refresh_restore(self):
        last=self.data.setting("kinehall_last_file",None)
        if last and Path(str(last)).is_file():
            self.welcome_restore.pack(pady=5)
        else:
            self.welcome_restore.pack_forget()

    def _choose_files(self):
        selected=filedialog.askopenfilenames(
            parent=self,title=self.tr("choose"),
            initialdir=self.data.last_directory("last_media_dir"),
            filetypes=[("Media files","*.mkv *.mp4 *.avi *.m4v *.mov *.ts *.mp3 *.flac *.ogg *.opus *.wav *.webm *.wmv"),("All files","*")])
        if selected:
            self.data.remember_directory("last_media_dir",selected[0])
            self.add_files(selected)

    def _drop_files(self,event):
        self.add_files(self.tk.splitlist(event.data))
        return "copy"

    def add_files(self,items):
        new=[]
        for entry in items:
            p=Path(entry).expanduser().resolve()
            if is_media_file(p):
                new.append(str(p))
        if not new:
            return
        was_empty=self.current_index<0
        self.queue.extend(new)
        self._render_queue()
        if was_empty:
            self._load(len(self.queue)-len(new))

    def _restore_last(self):
        last=self.data.setting("kinehall_last_file","")
        if last and Path(str(last)).is_file():
            self.add_files([last])
        else:
            self.status.set(self.tr("file_missing"))
            self._refresh_restore()

    def _controller(self):
        if self.controller is None:
            try:
                self.controller=VLCMediaController()
                self.controller.set_volume(self._saved_volume)
            except VLCUnavailable as exc:
                messagebox.showerror(self.tr("app"),str(exc),parent=self)
                return None
        return self.controller

    def _remember(self):
        if self.controller and self.current_file and not self.stopped:
            pos=self.controller.get_time_ms()
            if pos>=0:
                self.data.remember(self.current_file,pos)
                self._last_resume_ms=pos

    def _load(self,index:int):
        if not 0<=index<len(self.queue):
            return
        path=self.queue[index]
        if not Path(path).is_file():
            self.status.set(self.tr("file_missing"))
            return
        controller=self._controller()
        if controller is None:
            return
        self._remember()
        self.current_index=index
        self.current_file=path
        self.stopped=False
        self.handled_end=False
        self.video.update_idletasks()
        try:
            controller.load(path,self.video.winfo_id(),autoplay=True)
            controller.set_volume(0 if self.muted else self.volume.get())
            self.welcome.place_forget()
            self.data.set_setting("kinehall_last_file",path)
            self.data.remember(path)
            self.status.set(Path(path).name)
            self._last_resume_ms=-1
            resume=self.data.resume_position(path)
            self.after(850,lambda expected=path,ms=resume:
                self._after_load(expected,ms))
            self._render_queue()
            self._video_motion()
        except Exception as exc:
            self.status.set(self.tr("could_not_play"))
            messagebox.showerror(self.tr("app"),str(exc),parent=self)

    def _after_load(self,path:str,resume:int):
        if path!=self.current_file or self.stopped or not self.controller:
            return
        self.controller.set_subtitle_track(-1)  # Embedded subtitles default OFF.
        mode=self.data.media_preference(path,"subtitle_mode","off")
        if mode=="track":
            saved=self.data.media_preference(path,"subtitle_track_id",-1)
            self.controller.set_subtitle_track(int(saved))
        elif mode=="external":
            saved=self.data.media_preference(path,"subtitle_external_path","")
            if saved and Path(saved).is_file():
                self.controller.add_subtitle(saved)
        saved_audio=self.data.media_preference(path,"audio_track_id",None)
        if saved_audio is not None:
            self.controller.set_audio_track(int(saved_audio))
        if resume>2000 and self.controller.get_length_ms()>resume+4000:
            self.controller.set_time_ms(resume)

    def _remove(self,index):
        if not 0<=index<len(self.queue):
            return
        current=index==self.current_index
        if current:
            self._remember()
        self.queue.pop(index)
        if current:
            if self.queue:
                self.current_index=-1
                self._load(min(index,len(self.queue)-1))
            else:
                self._stop()
                self.current_index=-1
                self.current_file=None
                self.data.set_setting("kinehall_last_file",None)
                self._refresh_restore()
        elif index<self.current_index:
            self.current_index-=1
        self._render_queue()

    def _previous(self):
        self._load(self.current_index-1)

    def _next(self):
        self._load(self.current_index+1)

    def _play_pause(self):
        if self.controller is None:
            self._choose_files()
            return
        if self.stopped and self.current_file:
            self._load(self.current_index)
            return
        self.controller.pause_toggle()
        self._video_motion()

    def _stop(self):
        if self.controller:
            self._remember()
            self.controller.stop()
        self.stopped=True
        self.playing=False
        self.handled_end=False
        self.timeline.set(0)
        self.time_label.configure(text="0:00 / 0:00")
        self.welcome_message.configure(text=self.tr("stopped"))
        self.welcome.place(relx=.5,rely=.5,anchor="center")
        self.status.set(self.tr("stopped"))

    def _seek(self,seconds):
        if self.controller and not self.stopped:
            self.controller.seek_relative(seconds)

    def _seek_released(self,_event):
        if self.controller and not self.stopped:
            length=self.controller.get_length_ms()
            if length>0:
                self.controller.set_time_ms(int(length*float(self.timeline.get())/1000))
        self.seek_dragging=False

    def _volume_changed(self,_value=None):
        value=max(0,min(100,int(round(float(self.volume.get())))))
        self.volume_label.configure(text=f"{0 if self.muted else value}%")
        if self.controller:
            self.controller.set_volume(0 if self.muted else value)
        self.data.set_volume(value)

    def _wheel_step(self,step):
        self.muted=False
        self.volume.set(max(0,min(100,self.volume.get()+step)))
        self._volume_changed()
        return "break"

    def _wheel(self,event):
        return self._wheel_step(5 if event.delta>0 else -5)

    def _toggle_mute(self):
        self.muted=not self.muted
        self._volume_changed()
        self.mute_button.configure(text="×" if self.muted else "◖))")

    def _rate_menu(self):
        menu=tk.Menu(self,tearoff=False,bg=PANEL2,fg=TEXT,activebackground=RED,
            activeforeground=WHITE)
        for speed in (.5,.75,1,1.25,1.5,2):
            menu.add_radiobutton(label=f"{speed:g}×",variable=self.speed,value=str(speed),
                command=self._set_speed)
        menu.tk_popup(self.rate_button.winfo_rootx(),
            self.rate_button.winfo_rooty()-menu.winfo_reqheight())

    def _set_speed(self):
        try:
            speed=float(self.speed.get())
            if self.controller:
                self.controller.set_rate(speed)
            self.rate_button.configure(text=f"{speed:g}×")
        except (TypeError,ValueError):
            pass

    def _fullscreen(self):
        self.fullscreen=not self.fullscreen
        self.attributes("-fullscreen",self.fullscreen)
        if self.fullscreen:
            self.header.grid_remove()
            self.sidebar.grid_remove()
            self.footer.grid_remove()
            self.body.grid_configure(padx=0,pady=0)
            self.left.grid_configure(padx=0)
            self.video.configure(highlightthickness=0)
        else:
            self.header.grid()
            self.sidebar.grid()
            self.footer.grid()
            self.body.grid_configure(padx=16,pady=(2,10))
            self.left.grid_configure(padx=(0,12))
            self.video.configure(highlightthickness=1)
            self.controls.grid()
        self._video_motion()

    def _double_click(self):
        self._fullscreen()
        return "break"

    def _escape(self,_event=None):
        if self.pip_window:
            self._close_pip()
        elif self.fullscreen:
            self._fullscreen()
        return "break"

    def _pip(self):
        if self.pip_window:
            self._close_pip()
            return
        if not self.controller or self.stopped:
            return
        window=tk.Toplevel(self)
        window.title(self.tr("app"))
        window.geometry("520x315")
        window.configure(bg=BLACK)
        window.attributes("-topmost",True)
        host=tk.Frame(window,bg=BLACK)
        host.pack(fill="both",expand=True)
        host.update_idletasks()
        self.pip_window=window
        self.pip_host=host
        self.controller.set_output_window(host.winfo_id())
        window.protocol("WM_DELETE_WINDOW",self._close_pip)
        window.bind("<Double-Button-1>",lambda e:self._close_pip())

    def _close_pip(self):
        if not self.pip_window:
            return
        try:
            if self.controller:
                self.video.update_idletasks()
                self.controller.set_output_window(self.video.winfo_id())
            self.pip_window.destroy()
        finally:
            self.pip_window=None
            self.pip_host=None

    def _context_menu(self,event):
        if not self.controller or not self.current_file:
            return
        menu=tk.Menu(self,tearoff=False,bg=PANEL2,fg=TEXT,activebackground=RED,
            activeforeground=WHITE)
        menu.add_command(label=self.tr("play") if not self.playing else self.tr("pause"),
            command=self._play_pause)
        menu.add_command(label=self.tr("stop"),command=self._stop)
        subtitle=tk.Menu(menu,tearoff=False,bg=PANEL2,fg=TEXT,activebackground=RED)
        subtitle.add_command(label=self.tr("off"),command=self._subtitles_off)
        try:
            tracks=self.controller.subtitle_tracks()
        except Exception:
            tracks=[]
        for track_id,name in tracks:
            if track_id>=0:
                subtitle.add_command(label=name,
                    command=lambda t=track_id:self._subtitle_select(t))
        subtitle.add_separator()
        subtitle.add_command(label=self.tr("external"),command=self._subtitle_file)
        menu.add_cascade(label=self.tr("subtitles"),menu=subtitle)
        audio=tk.Menu(menu,tearoff=False,bg=PANEL2,fg=TEXT,activebackground=RED)
        try:
            audio_tracks=self.controller.audio_tracks()
        except Exception:
            audio_tracks=[]
        if not audio_tracks:
            audio.add_command(label=self.tr("no_tracks"),state="disabled")
        for track_id,name in audio_tracks:
            if track_id>=0:
                audio.add_command(label=name,command=lambda t=track_id:self._audio_select(t))
        menu.add_cascade(label=self.tr("audio"),menu=audio)
        menu.add_command(label=self.tr("info"),command=self._info)
        menu.add_command(label=self.tr("pip"),command=self._pip)
        menu.add_command(label=self.tr("fullscreen"),command=self._fullscreen)
        menu.tk_popup(event.x_root,event.y_root)

    def _audio_select(self,track_id):
        if self.controller and self.current_file and self.controller.set_audio_track(track_id):
            self.data.set_media_preference(self.current_file,"audio_track_id",track_id)

    def _subtitles_off(self):
        if self.controller:
            self.controller.set_subtitle_track(-1)
        if self.current_file:
            self.data.set_media_preference(self.current_file,"subtitle_mode","off")

    def _subtitle_select(self,track_id):
        if self.controller and self.current_file and self.controller.set_subtitle_track(track_id):
            self.data.set_media_preference(self.current_file,"subtitle_mode","track")
            self.data.set_media_preference(self.current_file,"subtitle_track_id",track_id)

    def _subtitle_file(self):
        if not self.controller or not self.current_file:
            return
        selection=filedialog.askopenfilename(parent=self,title=self.tr("subtitles"),
            filetypes=[("Subtitle files","*.srt *.vtt *.ass *.ssa *.sub"),("All files","*")])
        if selection and self.controller.add_subtitle(selection):
            self.data.set_media_preference(self.current_file,"subtitle_mode","external")
            self.data.set_media_preference(self.current_file,"subtitle_external_path",selection)

    def _info(self):
        if not self.current_file:
            return
        path=Path(self.current_file)
        info=[
            f"{self.tr('source')}: {path.name}",
            f"{self.tr('size')}: {path.stat().st_size/1048576:.1f} " + ("МиБ" if self.lang == "ru" else "MiB"),
            f"{self.tr('duration')}: {formatted(self.controller.get_length_ms()) if self.controller else self.tr('unknown')}",
            f"{self.tr('rate')}: {self.speed.get()}×",
        ]
        messagebox.showinfo(self.tr("info"),"\n".join(info),parent=self)

    def _video_motion(self,_event=None):
        self.video.configure(cursor="arrow")
        if self._cursor_job:
            self.after_cancel(self._cursor_job)
        self._cursor_job=self.after(3000,self._hide_cursor)
        if self.fullscreen:
            self.controls.grid()
            if self._controls_job:
                self.after_cancel(self._controls_job)
            self._controls_job=self.after(3000,self._hide_controls)

    def _hide_controls(self):
        self._controls_job=None
        if self.fullscreen and self.playing:
            self.controls.grid_remove()

    def _hide_cursor(self):
        self._cursor_job=None
        if self.playing:
            self.video.configure(cursor="none")

    def _cursor_visible(self,_event=None):
        if self._cursor_job:
            self.after_cancel(self._cursor_job)
            self._cursor_job=None
        self.video.configure(cursor="arrow")

    def _change_language(self):
        self.lang="ru" if self.lang=="en" else "en"
        self.data.set_setting("kinehall_language",self.lang)
        self.title(self.tr("app"))
        self.brand.configure(text=self.tr("app"))
        self.language_button.configure(text="Русский" if self.lang=="en" else "English")
        self.welcome_message.configure(text=self.tr("stopped") if self.stopped and self.current_file else self.tr("prompt"))
        self.welcome_open.configure(text=self.tr("open"))
        self.welcome_restore.configure(text=self.tr("restore"))
        self.queue_label.configure(text=self.tr("queue"))
        self.open_button.configure(text=self.tr("open"))
        self.status.set(self.tr("ready") if not self.current_file else Path(self.current_file).name)
        if self.pip_window:
            self.pip_window.title(self.tr("app"))
        self._render_queue()

    def _tick(self):
        try:
            controller=self.controller
            if controller and self.current_file and not self.stopped:
                length=controller.get_length_ms()
                current=controller.get_time_ms()
                self.playing=controller.player.is_playing()==1
                self.play_button.configure(text="Ⅱ" if self.playing else "▶")
                self.time_label.configure(text=f"{formatted(current)} / {formatted(length)}")
                if length>0 and not self.seek_dragging:
                    self.timeline.set(max(0,min(1000,1000*current/length)))
                if current>=0 and abs(current-self._last_resume_ms)>=5000:
                    self._remember()
                if controller.player.get_state()==controller.vlc.State.Ended:
                    if not self.handled_end:
                        self.handled_end=True
                        if self.current_index<len(self.queue)-1:
                            self.after_idle(self._next)
                        else:
                            self._remember()
                            self.stopped=True
            else:
                self.playing=False
                self.play_button.configure(text="▶")
        except (RuntimeError,tk.TclError):
            pass
        self.after(400,self._tick)

    def _key_play(self):
        self._play_pause()
        return "break"

    def _key_fullscreen(self):
        self._fullscreen()
        return "break"

    def _key_seek(self,direction):
        self._seek(direction)
        return "break"

    def _key_volume(self,direction):
        return self._wheel_step(direction)

    def _key_mute(self):
        self._toggle_mute()
        return "break"

    def _close(self):
        self._remember()
        if self._cursor_job:
            self.after_cancel(self._cursor_job)
        if self._controls_job:
            self.after_cancel(self._controls_job)
        if self.pip_window:
            self._close_pip()
        if self.controller:
            self.controller.release()
        self._workers.shutdown(wait=False,cancel_futures=True)
        self.destroy()


def main() -> int:
    parser=argparse.ArgumentParser(description="DK Kinehall desktop player")
    parser.add_argument("media",nargs="?",help="Local video or music file")
    args=parser.parse_args()
    Kinehall(args.media).mainloop()
    return 0


if __name__=="__main__":
    raise SystemExit(main())
