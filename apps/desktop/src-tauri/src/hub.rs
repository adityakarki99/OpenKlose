//! Finds the Klose hub, or starts one from the Node and klose package bundled
//! with the app. The app holds no Klose logic of its own: everything it shows
//! comes from the hub's HTTP API, the same one the browser canvas uses.
//!
//! "Running" means what it means to the klose CLI (server/hub.js findHub):
//! ~/.klose/hub.json names a port, and that port answers /api/health as a hub.
//! So a hub the user started with `npx klose hub` is found and used as is,
//! and one this app starts is found by the CLI.

use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct Hub {
    node: PathBuf,
    cli: PathBuf,
    home: PathBuf,
    port: Mutex<Option<u16>>,
    /// The hub process, when this app started it (and so stops it on quit).
    child: Mutex<Option<Child>>,
}

/// Where Klose keeps its own state: $KLOSE_HOME, else ~/.klose — the same
/// rule as kloseHome() in server/hub.js.
pub fn klose_home(user_home: &Path) -> PathBuf {
    match std::env::var_os("KLOSE_HOME") {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir),
        _ => user_home.join(".klose"),
    }
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(3)))
        .http_status_as_error(false)
        .build()
        .into()
}

/// GET a JSON document from the hub on 127.0.0.1.
pub fn get_json(port: u16, path: &str) -> Option<serde_json::Value> {
    let mut res = agent().get(&format!("http://127.0.0.1:{port}{path}")).call().ok()?;
    if res.status() != 200 {
        return None;
    }
    let text = res.body_mut().read_to_string().ok()?;
    serde_json::from_str(&text).ok()
}

fn answers_as_hub(port: u16) -> bool {
    get_json(port, "/api/health")
        .and_then(|h| h.get("hub").and_then(|v| v.as_bool()))
        .unwrap_or(false)
}

impl Hub {
    pub fn new(node: PathBuf, cli: PathBuf, home: PathBuf) -> Self {
        Hub { node, cli, home, port: Mutex::new(None), child: Mutex::new(None) }
    }

    pub fn home(&self) -> &Path {
        &self.home
    }

    /// The port of the hub as last seen, if it was up.
    pub fn port(&self) -> Option<u16> {
        *self.port.lock().unwrap()
    }

    pub fn url(&self, path: &str) -> Option<String> {
        self.port().map(|p| format!("http://localhost:{p}{path}"))
    }

    /// Looks for a running hub, remembering its port.
    pub fn find(&self) -> Option<u16> {
        let text = fs::read_to_string(self.home.join("hub.json")).ok()?;
        let info: serde_json::Value = serde_json::from_str(&text).ok()?;
        let port = u16::try_from(info.get("port")?.as_u64()?).ok()?;
        let found = answers_as_hub(port).then_some(port);
        *self.port.lock().unwrap() = found;
        found
    }

    /// The hub's port: the running one, or a new one started from the bundle.
    pub fn ensure(&self) -> Result<u16, String> {
        if let Some(port) = self.find() {
            return Ok(port);
        }
        self.start()?;
        let deadline = Instant::now() + Duration::from_secs(15);
        while Instant::now() < deadline {
            if let Some(port) = self.find() {
                return Ok(port);
            }
            if let Some(child) = self.child.lock().unwrap().as_mut() {
                if let Ok(Some(status)) = child.try_wait() {
                    return Err(format!("the hub exited ({status}); see {}", self.log_path().display()));
                }
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        Err(format!("the hub didn't start in time; see {}", self.log_path().display()))
    }

    fn log_path(&self) -> PathBuf {
        self.home.join("hub.log")
    }

    fn start(&self) -> Result<(), String> {
        let mut slot = self.child.lock().unwrap();
        if let Some(child) = slot.as_mut() {
            if matches!(child.try_wait(), Ok(None)) {
                return Ok(()); // already starting
            }
        }
        fs::create_dir_all(&self.home).map_err(|e| e.to_string())?;
        let log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.log_path())
            .map_err(|e| e.to_string())?;
        let mut cmd = Command::new(&self.node);
        cmd.arg(&self.cli)
            .arg("hub")
            .env("KLOSE_SHELL", "desktop")
            .stdin(Stdio::null())
            .stdout(log.try_clone().map_err(|e| e.to_string())?)
            .stderr(log);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let child = cmd
            .spawn()
            .map_err(|e| format!("could not start {}: {e}", self.node.display()))?;
        *slot = Some(child);
        Ok(())
    }

    /// Stops the hub if this app started it. A hub the user started is theirs.
    pub fn stop_owned(&self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            // SIGTERM first, so the hub removes its hub.json on the way out.
            #[cfg(unix)]
            unsafe {
                libc::kill(child.id() as i32, libc::SIGTERM);
            }
            let deadline = Instant::now() + Duration::from_secs(2);
            while Instant::now() < deadline {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            let _ = child.kill();
        }
    }
}
