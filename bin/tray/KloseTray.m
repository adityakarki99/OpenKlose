// The Klose menu bar app for macOS.
//
// A shell around the hub, nothing more: an icon in the menu bar whose dot
// says whether an agent is working (blue) or feedback is waiting for one
// (amber), and a popover that shows the hub's own /tray page. All the state
// comes from the hub's /api/tray; this file holds no Klose logic of its own.
//
// It is one Objective-C file on purpose, so `klose tray` can compile it with
// the clang from Apple's command line tools in a few seconds — no Xcode
// project, no bundle, and no dependence on a Swift toolchain matching its SDK.
//
//   klose-tray --home <~/.klose> [--node <node> --cli <klose.js>] [--show]
//   klose-tray --check            compile/link smoke test: prints and exits
//
// With --node and --cli it starts the hub when it finds it down. --show opens
// the popover as soon as the hub answers, instead of waiting for a click.

#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

static void Say(NSString *message) {
  fprintf(stdout, "%s\n", message.UTF8String);
  fflush(stdout);
}

@interface TrayApp : NSObject <NSApplicationDelegate, WKNavigationDelegate>
@property(nonatomic, copy) NSString *home;
@property(nonatomic, copy) NSString *node;
@property(nonatomic, copy) NSString *cli;
@property(nonatomic) BOOL showOnLaunch;
@end

@implementation TrayApp {
  NSStatusItem *_statusItem;
  NSView *_dot;
  NSPopover *_popover;
  WKWebView *_webView;
  NSTimer *_timer;
  // Base URL of the running hub, e.g. http://localhost:5171 — nil while it is down.
  NSURL *_hubURL;
  NSString *_state;
  NSDate *_lastStartAttempt;
}

- (NSString *)trayInfoPath {
  return [self.home stringByAppendingPathComponent:@"tray.json"];
}

- (NSString *)launchAgentPath {
  return [NSHomeDirectory() stringByAppendingPathComponent:@"Library/LaunchAgents/dev.klose.tray.plist"];
}

#pragma mark Launch

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  pid_t other = [self runningInstance];
  if (other > 0) {
    Say([NSString stringWithFormat:@"klose-tray: already running (pid %d)", other]);
    exit(0);
  }
  [self writeTrayInfo];
  _lastStartAttempt = [NSDate distantPast];

  _statusItem = [[NSStatusBar systemStatusBar] statusItemWithLength:NSSquareStatusItemLength];
  NSStatusBarButton *button = _statusItem.button;
  button.image = [TrayApp icon];
  button.toolTip = @"Klose";
  button.target = self;
  button.action = @selector(statusItemClicked:);
  [button sendActionOn:NSEventMaskLeftMouseUp | NSEventMaskRightMouseUp];

  _dot = [[NSView alloc] initWithFrame:NSZeroRect];
  _dot.wantsLayer = YES;
  _dot.layer.cornerRadius = 3;
  _dot.hidden = YES;
  _dot.translatesAutoresizingMaskIntoConstraints = NO;
  [button addSubview:_dot];
  [NSLayoutConstraint activateConstraints:@[
    [_dot.widthAnchor constraintEqualToConstant:6],
    [_dot.heightAnchor constraintEqualToConstant:6],
    [_dot.trailingAnchor constraintEqualToAnchor:button.trailingAnchor constant:-3],
    [_dot.topAnchor constraintEqualToAnchor:button.topAnchor constant:4],
  ]];

  _webView = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 380, 420)];
  _webView.navigationDelegate = self;
  NSViewController *controller = [[NSViewController alloc] init];
  controller.view = _webView;
  _popover = [[NSPopover alloc] init];
  _popover.contentViewController = controller;
  _popover.contentSize = NSMakeSize(380, 420);
  _popover.behavior = NSPopoverBehaviorTransient;

  [self poll];
  _timer = [NSTimer scheduledTimerWithTimeInterval:5 target:self selector:@selector(poll) userInfo:nil repeats:YES];
}

- (void)applicationWillTerminate:(NSNotification *)notification {
  [[NSFileManager defaultManager] removeItemAtPath:[self trayInfoPath] error:nil];
}

// The logo: a filled circle, as a template image so the menu bar tints it.
+ (NSImage *)icon {
  NSImage *image = [NSImage imageWithSize:NSMakeSize(18, 18)
                                  flipped:NO
                           drawingHandler:^BOOL(NSRect rect) {
                             [[NSColor blackColor] setFill];
                             [[NSBezierPath bezierPathWithOvalInRect:NSInsetRect(rect, 3.5, 3.5)] fill];
                             return YES;
                           }];
  image.template = YES;
  return image;
}

#pragma mark One instance

- (NSDictionary *)readJSON:(NSString *)path {
  NSData *data = [NSData dataWithContentsOfFile:path];
  if (!data) return nil;
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  return [parsed isKindOfClass:[NSDictionary class]] ? parsed : nil;
}

- (pid_t)runningInstance {
  NSNumber *pid = [self readJSON:[self trayInfoPath]][@"pid"];
  if (![pid isKindOfClass:[NSNumber class]]) return 0;
  pid_t other = pid.intValue;
  if (other <= 0 || other == getpid()) return 0;
  return kill(other, 0) == 0 ? other : 0;
}

- (void)writeTrayInfo {
  [[NSFileManager defaultManager] createDirectoryAtPath:self.home withIntermediateDirectories:YES attributes:nil error:nil];
  NSDictionary *info = @{
    @"pid" : @(getpid()),
    @"startedAt" : [[[NSISO8601DateFormatter alloc] init] stringFromDate:[NSDate date]],
  };
  NSData *data = [NSJSONSerialization dataWithJSONObject:info options:NSJSONWritingPrettyPrinted error:nil];
  [data writeToFile:[self trayInfoPath] atomically:YES];
}

#pragma mark Hub

- (void)poll {
  // Where hub.json says the hub listens. Whether it really does is for the request to find out.
  NSNumber *port = [self readJSON:[self.home stringByAppendingPathComponent:@"hub.json"]][@"port"];
  if (![port isKindOfClass:[NSNumber class]]) {
    [self hubIsDown];
    return;
  }
  NSURL *url = [NSURL URLWithString:[NSString stringWithFormat:@"http://127.0.0.1:%d/api/tray", port.intValue]];
  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
  request.timeoutInterval = 2;
  __weak TrayApp *weakSelf = self;
  [[[NSURLSession sharedSession] dataTaskWithRequest:request
                                   completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
                                     id body = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
                                     BOOL ok = [response isKindOfClass:[NSHTTPURLResponse class]] &&
                                               ((NSHTTPURLResponse *)response).statusCode == 200 &&
                                               [body isKindOfClass:[NSDictionary class]] &&
                                               [body[@"state"] isKindOfClass:[NSString class]];
                                     dispatch_async(dispatch_get_main_queue(), ^{
                                       TrayApp *strongSelf = weakSelf;
                                       if (!strongSelf) return;
                                       if (!ok) {
                                         [strongSelf hubIsDown];
                                         return;
                                       }
                                       strongSelf->_hubURL =
                                           [NSURL URLWithString:[NSString stringWithFormat:@"http://localhost:%d", port.intValue]];
                                       [strongSelf showState:body[@"state"]
                                                      agents:[body[@"agents"] integerValue]
                                                    comments:[body[@"comments"] integerValue]];
                                       if (strongSelf.showOnLaunch) {
                                         strongSelf.showOnLaunch = NO;
                                         if (!strongSelf->_popover.shown) [strongSelf togglePopover];
                                       }
                                     });
                                   }] resume];
}

- (void)hubIsDown {
  _hubURL = nil;
  [self showState:@"down" agents:0 comments:0];
  [self startHubIfPossible];
}

// At most one attempt every 30 seconds; `klose hub --detach` returns once the hub is up.
- (void)startHubIfPossible {
  if (!self.node || !self.cli) return;
  if ([[NSDate date] timeIntervalSinceDate:_lastStartAttempt] < 30) return;
  _lastStartAttempt = [NSDate date];

  NSTask *task = [[NSTask alloc] init];
  task.executableURL = [NSURL fileURLWithPath:self.node];
  task.arguments = @[ self.cli, @"hub", @"--detach" ];
  task.currentDirectoryURL = [NSURL fileURLWithPath:NSHomeDirectory()];
  task.standardOutput = [NSFileHandle fileHandleWithNullDevice];
  task.standardError = [NSFileHandle fileHandleWithNullDevice];
  NSMutableDictionary *environment = [[[NSProcessInfo processInfo] environment] mutableCopy];
  environment[@"KLOSE_HOME"] = self.home;
  task.environment = environment;
  NSError *error = nil;
  if ([task launchAndReturnError:&error]) {
    Say(@"klose-tray: starting the hub");
  } else {
    Say([NSString stringWithFormat:@"klose-tray: could not start the hub: %@", error.localizedDescription]);
  }
}

- (void)showState:(NSString *)state agents:(NSInteger)agents comments:(NSInteger)comments {
  if (![state isEqualToString:_state]) {
    _state = [state copy];
    Say([NSString stringWithFormat:@"klose-tray: %@", state]);
  }
  NSStatusBarButton *button = _statusItem.button;
  BOOL down = [state isEqualToString:@"down"];
  button.appearsDisabled = down;
  if ([state isEqualToString:@"feedback"]) {
    _dot.layer.backgroundColor = [NSColor systemOrangeColor].CGColor;
    _dot.hidden = NO;
  } else if ([state isEqualToString:@"working"]) {
    _dot.layer.backgroundColor = [NSColor systemBlueColor].CGColor;
    _dot.hidden = NO;
  } else {
    _dot.hidden = YES;
  }
  if (down) {
    button.toolTip = @"Klose — the hub isn't running";
    return;
  }
  NSString *agentText = agents == 1 ? @"1 agent" : [NSString stringWithFormat:@"%ld agents", (long)agents];
  NSString *waiting = comments == 0 ? @""
                      : comments == 1 ? @" · 1 comment waiting"
                                      : [NSString stringWithFormat:@" · %ld comments waiting", (long)comments];
  button.toolTip = [NSString stringWithFormat:@"Klose — %@%@", agentText, waiting];
}

#pragma mark Popover and menu

- (void)statusItemClicked:(id)sender {
  if (NSApp.currentEvent.type == NSEventTypeRightMouseUp) {
    [self showMenu];
  } else {
    [self togglePopover];
  }
}

- (void)togglePopover {
  if (_popover.shown) {
    [_popover performClose:nil];
    return;
  }
  if (_hubURL) {
    [_webView loadRequest:[NSURLRequest requestWithURL:[_hubURL URLByAppendingPathComponent:@"tray"]]];
  } else {
    NSString *next = self.node ? @"Starting it…" : @"Start it with <code>npx klose hub --detach</code>.";
    NSString *html = [NSString
        stringWithFormat:@"<body style=\"margin:0;display:flex;height:100vh;align-items:center;justify-content:center;"
                         @"background:#09090b;color:#94a3b8;font:13px -apple-system,sans-serif;text-align:center\">"
                         @"<div>The Klose hub isn't running.<br>%@</div></body>",
                         next];
    [_webView loadHTMLString:html baseURL:nil];
  }
  NSStatusBarButton *button = _statusItem.button;
  [_popover showRelativeToRect:button.bounds ofView:button preferredEdge:NSRectEdgeMinY];
  [NSApp activateIgnoringOtherApps:YES];
}

- (void)showMenu {
  NSMenu *menu = [[NSMenu alloc] init];
  menu.autoenablesItems = NO;
  NSMenuItem *open = [menu addItemWithTitle:@"Open Canvas" action:@selector(openCanvas:) keyEquivalent:@""];
  open.target = self;
  open.enabled = _hubURL != nil;
  [menu addItem:[NSMenuItem separatorItem]];
  NSMenuItem *login = [menu addItemWithTitle:@"Start at Login" action:@selector(toggleStartAtLogin:) keyEquivalent:@""];
  login.target = self;
  login.state = [[NSFileManager defaultManager] fileExistsAtPath:[self launchAgentPath]] ? NSControlStateValueOn : NSControlStateValueOff;
  [menu addItem:[NSMenuItem separatorItem]];
  NSMenuItem *quit = [menu addItemWithTitle:@"Quit Klose" action:@selector(quit:) keyEquivalent:@"q"];
  quit.target = self;
  // Attach the menu for this one click only, so a left click keeps opening the popover.
  _statusItem.menu = menu;
  [_statusItem.button performClick:nil];
  _statusItem.menu = nil;
}

- (void)openCanvas:(id)sender {
  if (_hubURL) [[NSWorkspace sharedWorkspace] openURL:_hubURL];
}

- (void)quit:(id)sender {
  [NSApp terminate:nil];
}

// A LaunchAgent that runs this same binary, with the same arguments, at login.
- (void)toggleStartAtLogin:(id)sender {
  NSFileManager *files = [NSFileManager defaultManager];
  NSString *plistPath = [self launchAgentPath];
  if ([files fileExistsAtPath:plistPath]) {
    [files removeItemAtPath:plistPath error:nil];
    return;
  }
  NSString *binary = [[NSProcessInfo processInfo].arguments[0] stringByStandardizingPath];
  if (!binary.isAbsolutePath) binary = [[files currentDirectoryPath] stringByAppendingPathComponent:binary];
  NSMutableArray *arguments = [@[ binary, @"--home", self.home ] mutableCopy];
  if (self.node && self.cli) [arguments addObjectsFromArray:@[ @"--node", self.node, @"--cli", self.cli ]];
  NSDictionary *plist = @{
    @"Label" : @"dev.klose.tray",
    @"ProgramArguments" : arguments,
    @"RunAtLoad" : @YES,
    @"ProcessType" : @"Interactive",
  };
  [files createDirectoryAtPath:[plistPath stringByDeletingLastPathComponent] withIntermediateDirectories:YES attributes:nil error:nil];
  [plist writeToFile:plistPath atomically:YES];
}

#pragma mark Links

// The popover only ever shows /tray. Anything the user clicks in it — a repo,
// "Open canvas" — belongs in their browser.
- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationAction:(WKNavigationAction *)navigationAction
                    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
  NSURL *url = navigationAction.request.URL;
  if (![url.scheme hasPrefix:@"http"]) {
    decisionHandler(WKNavigationActionPolicyAllow);
    return;
  }
  if (navigationAction.navigationType != WKNavigationTypeLinkActivated && [url.path isEqualToString:@"/tray"]) {
    decisionHandler(WKNavigationActionPolicyAllow);
    return;
  }
  decisionHandler(WKNavigationActionPolicyCancel);
  [[NSWorkspace sharedWorkspace] openURL:url];
  [_popover performClose:nil];
}

// Written to ~/.klose/tray.log: the first place to look when the popover is blank.
- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
  if (webView.URL.host) Say([NSString stringWithFormat:@"klose-tray: popover loaded %@", webView.URL.absoluteString]);
}

- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
  Say([NSString stringWithFormat:@"klose-tray: popover failed to load: %@", error.localizedDescription]);
}

@end

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    TrayApp *delegate = [[TrayApp alloc] init];
    delegate.home = [NSHomeDirectory() stringByAppendingPathComponent:@".klose"];
    NSArray<NSString *> *args = [NSProcessInfo processInfo].arguments;
    for (NSUInteger i = 1; i < args.count; i++) {
      NSString *flag = args[i];
      if ([flag isEqualToString:@"--check"]) {
        Say(@"klose-tray ok");
        return 0;
      }
      if ([flag isEqualToString:@"--show"]) {
        delegate.showOnLaunch = YES;
        continue;
      }
      if (i + 1 >= args.count) continue;
      if ([flag isEqualToString:@"--home"]) delegate.home = args[++i];
      else if ([flag isEqualToString:@"--node"]) delegate.node = args[++i];
      else if ([flag isEqualToString:@"--cli"]) delegate.cli = args[++i];
    }

    NSApplication *app = [NSApplication sharedApplication];
    app.delegate = delegate;
    // A menu bar app: no Dock icon, no main menu.
    [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
    [app run];
  }
  return 0;
}
