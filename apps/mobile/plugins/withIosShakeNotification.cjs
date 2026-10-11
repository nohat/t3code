"use strict";

// The papercut report (modules/t3-papercut) opens on a device shake. A shake is
// a motion event that UIKit sends up the responder chain, and the app delegate
// is the last responder in it. This plugin overrides `motionEnded` there and
// posts a notification the papercut module observes.
//
// It replaces a runtime swizzle of `UIWindow.motionEnded`. That swizzle called
// UIKit's private forwarding implementation directly and aborted the app on
// iPhone whenever the phone was jostled.

const { withAppDelegate } = require("expo/config-plugins");

const MARKER = "// t3-papercut shake notification";
const ANCHOR = "  var reactNativeFactory: RCTReactNativeFactory?\n";

const OVERRIDE = `
  ${MARKER}
  public override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
    if motion == .motionShake {
      NotificationCenter.default.post(name: Notification.Name("T3PapercutShake"), object: nil)
    }
    super.motionEnded(motion, with: event)
  }
`;

module.exports = function withIosShakeNotification(config) {
  return withAppDelegate(config, (cfg) => {
    const { contents, language } = cfg.modResults;
    if (language !== "swift") {
      throw new Error(`withIosShakeNotification expects a Swift AppDelegate, got ${language}`);
    }
    if (contents.includes(MARKER)) return cfg;
    if (!contents.includes(ANCHOR)) {
      throw new Error(
        "withIosShakeNotification could not find `var reactNativeFactory` in AppDelegate.swift; the Expo template changed",
      );
    }
    cfg.modResults.contents = contents.replace(ANCHOR, ANCHOR + OVERRIDE);
    return cfg;
  });
};
