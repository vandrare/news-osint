// Activity lifecycle adapted from macd2/OmarchyAgentOrb; see LICENSE.
// Composing animation adapted from Schoolees/thinking-orbs; see ATTRIBUTION.md.
// Copyright (c) 2026 macd2. MIT license; see LICENSE.
// News-OSINT integration: active inference only, 300px bottom-right, no input grab.
import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import "Composing.js" as Composing

PanelWindow {
  id: panel
  property bool opened: true
  readonly property bool wantsVisible: opened && freshActivity
  property real fadeLevel: wantsVisible ? 1 : 0
  visible: wantsVisible || fadeLevel > 0
  Behavior on fadeLevel {
    NumberAnimation { duration: 450; easing.type: Easing.InOutQuad }
  }
  function open(payloadJson) { opened = true; return "ok" }
  function close() { opened = false; return "ok" }
  color: "transparent"
  surfaceFormat.opaque: false
  implicitWidth: 300
  implicitHeight: 300
  anchors { bottom: true; right: true }
  margins { bottom: 100; right: 100 }
  WlrLayershell.namespace: "news-osint-ollama-orb"
  WlrLayershell.layer: WlrLayer.Overlay
  WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
  exclusionMode: ExclusionMode.Ignore
  exclusiveZone: 0
  focusable: false
  mask: Region {}

  readonly property string home: Quickshell.env("HOME") || ""
  readonly property string statePath: (Quickshell.env("NEWS_OSINT_STATE") ||
      home + "/.local/state/news-osint") + "/ollama-activity.json"
  property var state: ({})
  property double nowMs: Date.now()
  readonly property bool freshActivity: state.active === true &&
      nowMs - Number(state.at || 0) * 1000 < 8000 &&
      nowMs - Number(state.at || 0) * 1000 >= -2000
  property bool busyNow: freshActivity
  property double clock: 0
  property double lastTickMs: 0
  onBusyNowChanged: if (busyNow) lastTickMs = 0

  FileView {
    path: panel.statePath
    watchChanges: true
    atomicWrites: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: { try { var value = JSON.parse(text()); panel.state = value && typeof value === "object" ? value : ({}) } catch (e) { panel.state = ({}) } }
    onLoadFailed: panel.state = ({})
  }
  Timer {
    interval: 500
    repeat: true
    running: true
    onTriggered: panel.nowMs = Date.now()
  }
  Timer {
    interval: 50
    repeat: true
    running: panel.visible
    onTriggered: {
      var now = Date.now()
      var dt = panel.lastTickMs ? Math.min(.25, (now - panel.lastTickMs) / 1000) : .05
      panel.lastTickMs = now

      panel.clock += dt
      composing.requestPaint()
    }
  }
  Item {
    anchors.fill: parent
    opacity: panel.fadeLevel
    clip: true

    Canvas {
      id: composing
      anchors.fill: parent
      anchors.bottomMargin: 20
      antialiasing: true
      readonly property real playbackSpeed: 0.50
      onPaint: {
        if (!panel.visible || width < 1 || height < 1) return
        Composing.paint(getContext("2d"), width, height, panel.clock, playbackSpeed,
                        Color.accent, Color.foreground, Color.muted)
      }
    }
    Text {
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.bottom: parent.bottom
      anchors.bottomMargin: 2
      text: "● Ollama · " + (panel.state.model || "local model")
      color: Color.accent
      font.family: "monospace"
      font.pixelSize: 11
    }
  }
}
