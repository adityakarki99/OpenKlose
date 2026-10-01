//! The Klose desktop app: an icon in the menu bar (macOS) or system tray
//! (Windows) around the hub, the way bin/tray/KloseTray.m is on macOS today.
//!
//! - The icon shows what needs you: blue while an agent works, amber when
//!   comments are waiting in a repo no agent is busy in (GET /api/tray).
//! - Clicking it opens a popover showing the hub's own /tray page; anything
//!   clicked in it opens in the default browser, where the canvas lives.
//! - On first launch, a window shows the hub's /welcome setup; when it
//!   finishes, the app applies the start-at-login choice and opens the canvas.
//! - Release builds update themselves from GitHub Releases (latest.json).
//!
//! The hub itself is the klose package, run by the Node bundled with the app
//! (see hub.rs and scripts/prepare-sidecar.mjs).

mod hub;

use hub::Hub;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent, Wry};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};
use tauri_plugin_positioner::{Position, WindowExt};
use tauri_plugin_updater::UpdaterExt;
use url::Url;

const TRAY_ID: &str = "klose";
const POPOVER: &str = "popover";
const SETUP: &str = "setup";
const POLL: Duration = Duration::from_secs(5);
const UPDATE_FIRST_CHECK: Duration = Duration::from_secs(30);
const UPDATE_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

#[cfg(target_os = "macos")]
const TRAY_POSITION: Position = Position::TrayCenter;
#[cfg(not(target_os = "macos"))]
const TRAY_POSITION: Position = Position::TrayBottomCenter;

struct Shell {
    hub: Hub,
    login_item: CheckMenuItem<Wry>,
    update_item: Option<MenuItem<Wry>>,
    pending_update: Mutex<Option<tauri_plugin_updater::Update>>,
    /// When the popover last hid itself on losing focus. A click on the icon
    /// right after is the same click that took the focus away, not a request
    /// to open it again.
    popover_hidden_at: Mutex<Option<Instant>>,
}

fn open_in_browser(url: &str) {
    let _ = tauri_plugin_opener::open_url(url, None::<&str>);
}

/// Whether `url` is a page of the hub this app talks to.
fn on_hub(app: &AppHandle, url: &Url) -> bool {
    let port = app.state::<Shell>().hub.port();
    matches!(url.host_str(), Some("localhost") | Some("127.0.0.1")) && url.port().is_some() && url.port() == port
}

fn page(url: &Url) -> &str {
    let path = url.path().trim_end_matches('/');
    if path.is_empty() { "/" } else { path }
}

// ------------------------------------------------------------------- icon

#[derive(Clone, Copy, PartialEq)]
enum Dot {
    Plain,
    Working,
    Feedback,
}

fn set_icon(app: &AppHandle, dot: Dot, tooltip: &str) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    let (bytes, template): (&[u8], bool) = match dot {
        #[cfg(target_os = "macos")]
        Dot::Plain => (include_bytes!("../icons/tray-template.png"), true),
        #[cfg(not(target_os = "macos"))]
        Dot::Plain => (include_bytes!("../icons/tray-plain.png"), false),
        Dot::Working => (include_bytes!("../icons/tray-working.png"), false),
        Dot::Feedback => (include_bytes!("../icons/tray-feedback.png"), false),
    };
    if let Ok(image) = Image::from_bytes(bytes) {
        let _ = tray.set_icon(Some(image));
        let _ = tray.set_icon_as_template(template);
    }
    let _ = tray.set_tooltip(Some(tooltip));
}

fn plural(n: u64, word: &str) -> String {
    format!("{n} {word}{}", if n == 1 { "" } else { "s" })
}

/// One look at the hub: the icon, and a restart if the hub has gone away.
fn refresh(app: &AppHandle, misses: &mut u32) {
    let shell = app.state::<Shell>();
    let tray = shell.hub.port().and_then(|port| hub::get_json(port, "/api/tray"));
    let Some(tray) = tray else {
        *misses += 1;
        set_icon(app, Dot::Plain, "Klose — the hub isn't running");
        // Twice in a row: the hub stopped (or was never found). Start it again.
        if *misses >= 2 {
            *misses = 0;
            if let Err(err) = shell.hub.ensure() {
                set_icon(app, Dot::Plain, &format!("Klose — {err}"));
            }
        }
        return;
    };
    *misses = 0;
    let n = |key: &str| tray.get(key).and_then(|v| v.as_u64()).unwrap_or(0);
    let dot = match tray.get("state").and_then(|v| v.as_str()) {
        Some("feedback") => Dot::Feedback,
        Some("working") => Dot::Working,
        _ => Dot::Plain,
    };
    let agents = if n("agents") > 0 { plural(n("agents"), "agent") } else { "No agents running".into() };
    let comments = if n("comments") > 0 { format!(" · {} waiting", plural(n("comments"), "comment")) } else { String::new() };
    set_icon(app, dot, &format!("Klose — {agents}{comments}"));
}

// ---------------------------------------------------------------- windows

fn toggle_popover(app: &AppHandle) {
    let shell = app.state::<Shell>();
    let Some(port) = shell.hub.port() else {
        // No hub yet: the canvas's own page says so, and the poll restarts it.
        return;
    };
    if let Some(win) = app.get_webview_window(POPOVER) {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
            return;
        }
        let just_hidden = shell
            .popover_hidden_at
            .lock()
            .unwrap()
            .is_some_and(|at| at.elapsed() < Duration::from_millis(250));
        if just_hidden {
            return;
        }
        // The hub may have come back on another port.
        if win.url().ok().and_then(|u| u.port()) != Some(port) {
            if let Ok(url) = Url::parse(&format!("http://localhost:{port}/tray")) {
                let _ = win.navigate(url);
            }
        }
        let _ = win.move_window(TRAY_POSITION);
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }

    let Ok(url) = Url::parse(&format!("http://localhost:{port}/tray")) else { return };
    let handle = app.clone();
    let built = WebviewWindowBuilder::new(app, POPOVER, WebviewUrl::External(url))
        .title("Klose")
        .inner_size(380.0, 420.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        // The popover only ever shows /tray. A repo, "Open canvas", any link:
        // those belong in the browser.
        .on_navigation(move |url| {
            if on_hub(&handle, url) && page(url) == "/tray" {
                return true;
            }
            open_in_browser(url.as_str());
            if let Some(win) = handle.get_webview_window(POPOVER) {
                let _ = win.hide();
            }
            false
        })
        .build();
    let Ok(win) = built else { return };
    let handle = app.clone();
    win.on_window_event(move |event| {
        if let WindowEvent::Focused(false) = event {
            if let Some(win) = handle.get_webview_window(POPOVER) {
                let _ = win.hide();
                *handle.state::<Shell>().popover_hidden_at.lock().unwrap() = Some(Instant::now());
            }
        }
    });
    let _ = win.move_window(TRAY_POSITION);
    let _ = win.show();
    let _ = win.set_focus();
}

/// The hub's /welcome page, in a window of its own. When it finishes (or is
/// skipped) the page heads for the hub's home: that is the cue to apply the
/// login choice, open the canvas in the browser, and close.
fn show_setup(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(SETUP) {
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }
    let Some(port) = app.state::<Shell>().hub.port() else { return };
    let Ok(url) = Url::parse(&format!("http://localhost:{port}/welcome?shell=desktop")) else { return };

    // A window with no Dock icon is hard to find again; show one meanwhile.
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);

    let handle = app.clone();
    let built = WebviewWindowBuilder::new(app, SETUP, WebviewUrl::External(url))
        .title("Welcome to Klose")
        .inner_size(880.0, 680.0)
        .min_inner_size(640.0, 560.0)
        .center()
        .on_navigation(move |url| {
            if on_hub(&handle, url) {
                if page(url) == "/welcome" {
                    return true;
                }
                let app = handle.clone();
                let target = url.to_string();
                std::thread::spawn(move || finish_setup(&app, &target));
                return false;
            }
            open_in_browser(url.as_str());
            false
        })
        .build();
    if let Ok(win) = built {
        let handle = app.clone();
        win.on_window_event(move |event| {
            if let WindowEvent::Destroyed = event {
                #[cfg(target_os = "macos")]
                let _ = handle.set_activation_policy(tauri::ActivationPolicy::Accessory);
                #[cfg(not(target_os = "macos"))]
                let _ = &handle;
            }
        });
        let _ = win.set_focus();
    }
}

fn finish_setup(app: &AppHandle, home_url: &str) {
    apply_login_choice(app);
    open_in_browser(home_url);
    if let Some(win) = app.get_webview_window(SETUP) {
        let _ = win.close();
    }
}

/// The welcome page records "Start Klose at login" in ~/.klose/settings.json
/// (server/setup.js); the login item itself is the app's to set.
fn apply_login_choice(app: &AppHandle) {
    let shell = app.state::<Shell>();
    let wanted = std::fs::read_to_string(shell.hub.home().join("settings.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|s| s.get("desktopStartAtLogin").and_then(|v| v.as_bool()));
    let Some(wanted) = wanted else { return };
    let launcher = app.autolaunch();
    let _ = if wanted { launcher.enable() } else { launcher.disable() };
    let _ = shell.login_item.set_checked(launcher.is_enabled().unwrap_or(false));
}

fn setup_pending(app: &AppHandle) -> bool {
    let shell = app.state::<Shell>();
    let Some(port) = shell.hub.port() else { return false };
    hub::get_json(port, "/api/setup")
        .and_then(|s| s.pointer("/onboarding/completed").and_then(|v| v.as_bool()))
        .is_some_and(|done| !done)
}

/// What opening the app again (Dock, Start menu, Finder) does: setup if it
/// isn't finished, else the canvas.
fn reopen(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        if setup_pending(&app) {
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || show_setup(&handle));
        } else if let Some(url) = app.state::<Shell>().hub.url("/") {
            open_in_browser(&url);
        }
    });
}

// ---------------------------------------------------------------- updates

fn updater_configured(context: &tauri::Context<Wry>) -> bool {
    context
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|u| u.get("pubkey"))
        .and_then(|k| k.as_str())
        .is_some_and(|k| !k.trim().is_empty())
}

async fn check_for_update(app: AppHandle, manual: bool) {
    let shell = app.state::<Shell>();
    let Some(item) = shell.update_item.clone() else { return };
    let result = match app.updater() {
        Ok(updater) => updater.check().await.map_err(|e| e.to_string()),
        Err(e) => Err(e.to_string()),
    };
    match result {
        Ok(Some(update)) => {
            let _ = item.set_text(format!("Install Klose {}…", update.version));
            *shell.pending_update.lock().unwrap() = Some(update);
        }
        Ok(None) if manual => {
            let _ = item.set_text(format!("Klose {} Is Up to Date", app.package_info().version));
        }
        Err(_) if manual => {
            let _ = item.set_text("Couldn't Check for Updates");
        }
        _ => {}
    }
}

async fn install_update(app: AppHandle) {
    let shell = app.state::<Shell>();
    let Some(update) = shell.pending_update.lock().unwrap().take() else { return };
    if let Some(item) = &shell.update_item {
        let _ = item.set_text("Installing Update…");
        let _ = item.set_enabled(false);
    }
    // The hub is restarted from the new bundle after the relaunch.
    shell.hub.stop_owned();
    match update.download_and_install(|_, _| {}, || {}).await {
        Ok(()) => app.restart(),
        Err(_) => {
            if let Some(item) = &shell.update_item {
                let _ = item.set_text("Update Failed — Try Again");
                let _ = item.set_enabled(true);
            }
        }
    }
}

// -------------------------------------------------------------------- run

fn bundled_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    // Tauri puts an externalBin next to the app's own executable.
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("no folder for the app's executable")?;
    let node = dir.join(if cfg!(windows) { "node.exe" } else { "node" });
    let cli = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        // Not "klose/": next to an executable named Klose, that's the same
        // name on macOS's case-insensitive disk.
        .join("klose-package")
        .join("bin")
        .join("klose.js");
    Ok((node, cli))
}

pub fn run() {
    let context = tauri::generate_context!();
    let with_updates = updater_configured(&context);

    let mut builder = tauri::Builder::default()
        // First, so a second launch hands over before anything else starts.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| reopen(app)))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_positioner::init());
    if with_updates {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    let app = builder
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle().clone();
            let (node, cli) = bundled_paths(&handle)?;
            let home = hub::klose_home(&app.path().home_dir()?);

            let login_item = CheckMenuItemBuilder::with_id("login", "Start at Login")
                .checked(app.autolaunch().is_enabled().unwrap_or(false))
                .build(app)?;
            let update_item = if with_updates {
                Some(MenuItemBuilder::with_id("update", "Check for Updates…").build(app)?)
            } else {
                None
            };
            let mut menu = MenuBuilder::new(app)
                .text("open", "Open Klose")
                .text("setup", "Run Setup…")
                .separator()
                .item(&login_item);
            if let Some(item) = &update_item {
                menu = menu.item(item);
            }
            let menu = menu
                .item(&PredefinedMenuItem::separator(app)?)
                .text("quit", "Quit Klose")
                .build()?;

            app.manage(Shell {
                hub: Hub::new(node, cli, home),
                login_item,
                update_item,
                pending_update: Mutex::new(None),
                popover_hidden_at: Mutex::new(None),
            });

            TrayIconBuilder::with_id(TRAY_ID)
                .icon(Image::from_bytes(include_bytes!("../icons/tray-template.png"))?)
                .icon_as_template(cfg!(target_os = "macos"))
                .tooltip("Klose")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        toggle_popover(tray.app_handle());
                    }
                })
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => {
                        if let Some(url) = app.state::<Shell>().hub.url("/") {
                            open_in_browser(&url);
                        }
                    }
                    "setup" => show_setup(app),
                    "login" => {
                        let launcher = app.autolaunch();
                        let on = launcher.is_enabled().unwrap_or(false);
                        let _ = if on { launcher.disable() } else { launcher.enable() };
                        let _ = app.state::<Shell>().login_item.set_checked(launcher.is_enabled().unwrap_or(false));
                    }
                    "update" => {
                        let app = app.clone();
                        let pending = app.state::<Shell>().pending_update.lock().unwrap().is_some();
                        tauri::async_runtime::spawn(async move {
                            if pending {
                                install_update(app).await
                            } else {
                                check_for_update(app, true).await
                            }
                        });
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // Bring the hub up, show setup if it's the first run, then keep
            // the icon current. Off the main thread: starting Node takes a moment.
            let poller = handle.clone();
            std::thread::spawn(move || {
                let mut misses = 0;
                match poller.state::<Shell>().hub.ensure() {
                    Ok(_) => {
                        if setup_pending(&poller) {
                            let app = poller.clone();
                            let _ = poller.run_on_main_thread(move || show_setup(&app));
                        }
                    }
                    Err(err) => set_icon(&poller, Dot::Plain, &format!("Klose — {err}")),
                }
                loop {
                    refresh(&poller, &mut misses);
                    std::thread::sleep(POLL);
                }
            });

            if with_updates {
                let app = handle.clone();
                tauri::async_runtime::spawn(async move {
                    tokio_sleep(UPDATE_FIRST_CHECK).await;
                    loop {
                        check_for_update(app.clone(), false).await;
                        tokio_sleep(UPDATE_EVERY).await;
                    }
                });
            }
            Ok(())
        })
        .build(context)
        .expect("error while building the Klose app");

    app.run(|app, event| match event {
        // Closing the setup window or the popover must not quit a menu bar app.
        RunEvent::ExitRequested { code: None, api, .. } => api.prevent_exit(),
        RunEvent::Exit => app.state::<Shell>().hub.stop_owned(),
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => reopen(app),
        _ => {}
    });
}

async fn tokio_sleep(duration: Duration) {
    // tauri::async_runtime is tokio; a blocking sleep would hold a worker.
    let (tx, rx) = tauri::async_runtime::channel::<()>(1);
    std::thread::spawn(move || {
        std::thread::sleep(duration);
        let _ = tx.blocking_send(());
    });
    let mut rx = rx;
    let _ = rx.recv().await;
}
