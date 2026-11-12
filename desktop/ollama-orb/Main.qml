// Adapted from macd2/OmarchyAgentOrb, commit 99ac3b2b793884e742b6db268d18dc6c8906eda4.
// Copyright (c) 2026 macd2. MIT license; see LICENSE.
// News-OSINT integration: active inference only, 300px bottom-right, no input grab.
import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons

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
  margins { bottom: 16; right: 16 }
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
  property real energy: 0
  property real pop: 0
  property real surge: 0
  property double clock: 0
  property double rushPhase: 0
  property double lastTickMs: 0
  onBusyNowChanged: { if (busyNow) { pop = 1; lastTickMs = 0 } }

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
      panel.energy += (1 - panel.energy) * (1 - Math.pow(.0006, dt))
      panel.pop = Math.max(0, panel.pop - dt / .6)
      var want = Math.sin(Math.min(1, panel.pop) * Math.PI)
      panel.surge += (want - panel.surge) * (1 - Math.pow(.0009, dt))
      panel.rushPhase += panel.surge * .45 * dt
      panel.clock += dt
      canvas.requestPaint()
    }
  }
  // ============================================================ the mesh
  // Clip so the oversized canvas is cropped to the window, never scaled:
  // the mesh keeps its exact pixel size while the visible box is smaller.
  Item {
    anchors.fill: parent
    opacity: panel.fadeLevel
    clip: true

    Canvas {
      id: canvas
      width: 300
      height: 300
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.verticalCenter: parent.verticalCenter
      antialiasing: true

    // Palette sampled from the active Omarchy theme. Four anchors spread around
    // the hue wheel so the surface still reads as iridescent even when the
    // theme is near-monochrome.
    readonly property color paletteA: Color.accent
    readonly property color paletteB: Color.popups.border
    readonly property color paletteC: Color.notifications.countdown
    readonly property color paletteD: Color.tooltip.border

    readonly property var cA: [paletteA.r, paletteA.g, paletteA.b]
    readonly property var cB: [paletteB.r, paletteB.g, paletteB.b]
    readonly property var cC: [paletteC.r, paletteC.g, paletteC.b]
    readonly property var cD: [paletteD.r, paletteD.g, paletteD.b]
    readonly property real ambient: 0.2

    property var verts: []
    property var edges: []

    // ---- geometry: IcosahedronGeometry(1.2, subdiv) -------------------
    function initIcosphere(subdiv) {
      var t = (1.0 + Math.sqrt(5.0)) / 2.0
      var v = [
        [-1,  t,  0], [ 1,  t,  0], [-1, -t,  0], [ 1, -t,  0],
        [ 0, -1,  t], [ 0,  1,  t], [ 0, -1, -t], [ 0,  1, -t],
        [ t,  0, -1], [ t,  0,  1], [-t,  0, -1], [-t,  0,  1]
      ]
      for (var i = 0; i < v.length; i++) v[i] = norm(v[i])
      var faces = [
        [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
        [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
        [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
        [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]
      ]
      var cache = {}
      function mid(a, b) {
        var key = a < b ? a + "_" + b : b + "_" + a
        if (cache[key] !== undefined) return cache[key]
        var pa = v[a], pb = v[b]
        v.push(norm([(pa[0]+pb[0])/2, (pa[1]+pb[1])/2, (pa[2]+pb[2])/2]))
        cache[key] = v.length - 1
        return cache[key]
      }
      for (var s = 0; s < subdiv; s++) {
        var next = []
        for (var f = 0; f < faces.length; f++) {
          var a = faces[f][0], b = faces[f][1], c = faces[f][2]
          var ab = mid(a,b), bc = mid(b,c), ca = mid(c,a)
          next.push([a,ab,ca],[b,bc,ab],[c,ca,bc],[ab,bc,ca])
        }
        faces = next
      }
      var seen = {}, e = []
      for (var k = 0; k < faces.length; k++) {
        var fc = faces[k]
        for (var j = 0; j < 3; j++) {
          var a2 = fc[j], b2 = fc[(j+1)%3]
          var key2 = a2 < b2 ? a2 + "_" + b2 : b2 + "_" + a2
          if (!seen[key2]) { seen[key2] = true; e.push([a2, b2]) }
        }
      }
      canvas.verts = v
      canvas.edges = e
    }

    function norm(v) {
      var l = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]) || 1
      return [v[0]/l, v[1]/l, v[2]/l]
    }
    function dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] }
    function mix(a, b, t) {
      return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t]
    }
    // 4-Farben-Blend über die Oberfläche (iridescent)
    function iridescent(n) {
      var tx = n[0] * 0.5 + 0.5
      var ty = n[1] * 0.5 + 0.5
      return mix(mix(cA, cB, tx), mix(cC, cD, tx), ty)
    }

    // ---- 3D value noise (cheap stand-in for snoise) ------------------
    function h3(x, y, z) {
      var n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
      return n - Math.floor(n)
    }
    function noise3(x, y, z) {
      var ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z)
      var fx = x - ix, fy = y - iy, fz = z - iz
      var ux = fx*fx*(3-2*fx), uy = fy*fy*(3-2*fy), uz = fz*fz*(3-2*fz)
      var s = 0
      for (var dz = 0; dz < 2; dz++)
        for (var dy = 0; dy < 2; dy++)
          for (var dx = 0; dx < 2; dx++) {
            var w = h3(ix+dx, iy+dy, iz+dz)
            s += w * (dx ? ux : 1-ux) * (dy ? uy : 1-uy) * (dz ? uz : 1-uz)
          }
      return s
    }
    function snoise(x, y, z) {
      return (noise3(x, y, z) * 2.0 - 1.0) +
             (noise3(x*2.03, y*2.03, z*2.03) * 2.0 - 1.0) * 0.5
    }

    Component.onCompleted: initIcosphere(2)   // 162 verts, 480 edges — finer wireframe net

    onPaint: {
      var ctx = getContext("2d")
      ctx.clearRect(0, 0, width, height)
      if (!panel.visible || panel.width < 1 || panel.height < 1) return

      var W = width, H = height
      var cx = W / 2, cy = H / 2
      var time = panel.clock
      var e = panel.energy
      var pop = panel.pop

      // ---- background: the theme's own background, vignetted --------
      // No background fill: the canvas is cleared to transparent so only the
      // mesh edges are painted.

      // ---- orbit centre: calm, slow drift ------------------------------
      // Deliberately lazy at rest. All the motion budget belongs to the impulse.
      var orbitAmp = 0.010 + 0.045 * e
      var ox = cx + Math.sin(time * 0.34) * orbitAmp * W
      var oy = cy + Math.cos(time * 0.27) * orbitAmp * H

      // ---- fixed key light (no mouse coupling) ---------------------
      var lightDir = norm([0.35, 0.55, 2.0])

      // ---- geometry: displace, rotate, project ---------------------
      // Sized to sit well inside the surface: with no opaque box, anything that
      // reaches the window edge would show up as a clipped edge.
      var radius = Math.min(W, H) * (1.0 + 0.05 * e)
      var camZ = 3.0
      // Spin rate is tied to how busy things are, so the resting orb is genuinely
      // still rather than "slowly busy". On a software-GL compositor the frame
      // rate is low, and every degree of rotation per frame is visible as a
      // step; a slower surface at rest is also what makes the active state read
      // as a change rather than as more of the same.
      var rotY = time * (0.12 + 0.24 * e)
      var rotX = time * (0.05 + 0.14 * e)
      var cy_ = Math.cos(rotY), sy = Math.sin(rotY)
      var cxr = Math.cos(rotX), sx = Math.sin(rotX)

      // ---- how alive the surface is -----------------------------------
      // Idle is a slow, low-amplitude crawl. Activity raises the amplitude and
      // adds a faster flutter, so the mesh looks like something stirring
      // rather than something being switched on.
      // Already smoothed by the Timer's follower; 0 -> 1 -> 0 with no kink.
      var surge = panel.surge * 0.5
      var dispAmp = 0.125 + 0.16 * e + 0.24 * surge

      // Two noise fields: a slow body wave and a fine skin shimmer. The shimmer
      // stays on a long wavelength and a low amplitude — it is there to keep
      // the surface from looking frozen, not to twitch.
      var skinW = 0.16 + 0.28 * e + 0.30 * surge
      var skinA = 0.020 + 0.028 * e + 0.030 * surge

      // Impulse scrolls the whole field forward in time, so a burst reads as
      // the surface rushing rather than merely brightening.
      var rush = panel.rushPhase

      var n = verts.length
      var px = new Array(n), py = new Array(n), pz = new Array(n)
      var rnx = new Array(n), rny = new Array(n), rnz = new Array(n)

      for (var i = 0; i < n; i++) {
        var v = verts[i]
        // slow body wave
        var d = snoise(v[0]*2.0 + time*0.34 + rush, v[1]*2.0 + time*0.34, v[2]*2.0 + time*0.34) * dispAmp
        // fine skin shimmer, riding on top
        d += snoise(v[0]*3.6 + time*skinW, v[1]*3.6 - time*skinW*0.7, v[2]*3.6) * skinA

        var wx = v[0] + v[0]*d
        var wy = v[1] + v[1]*d
        var wz = v[2] + v[2]*d

        // rotate around Y
        var ry1 = wx * cy_ - wz * sy
        var rz1 = wx * sy + wz * cy_
        // rotate around X
        var ry2 = ry1 * cxr - rz1 * sx
        var rz2 = ry1 * sx + rz1 * cxr
        px[i] = ry2; py[i] = wy; pz[i] = rz2

        // undisplaced normal, rotated (site uses the undisplaced normal)
        var nx = v[0], ny = v[1], nz = v[2]
        var nry = nx * cy_ - nz * sy
        var nrz = nx * sy + nz * cy_
        rnx[i] = nry; rny[i] = ny * cxr - nrz * sx; rnz[i] = ny * sx + nrz * cxr
      }

      // ---- draw edges, painter's algorithm by depth ----------------
      var edges = canvas.edges
      var order = []
      for (var k = 0; k < edges.length; k++) order.push(k)
      var depth = new Array(edges.length)
      for (var k2 = 0; k2 < edges.length; k2++) {
        var ed = edges[k2]
        depth[k2] = (pz[ed[0]] + pz[ed[1]]) * 0.5
      }
      order.sort(function(a, b) { return depth[a] - depth[b] })

      ctx.lineCap = "round"
      ctx.globalCompositeOperation = "lighter"
      for (var oi = 0; oi < order.length; oi++) {
        var idx = order[oi]
        var e2 = edges[idx]
        var a = e2[0], b = e2[1]

        // perspective projection
        var za = camZ - pz[a], zb = camZ - pz[b]
        if (!(za > 0.3) || !(zb > 0.3)) continue
        var sa = radius / za, sb = radius / zb
        var ax = ox + px[a] * sa, ay = oy - py[a] * sa
        var bx = ox + px[b] * sb, by = oy - py[b] * sb
        if (!isFinite(ax) || !isFinite(ay) || !isFinite(bx) || !isFinite(by)) continue

        // normal-based iridescent colour
        var mid = 0.5
        var mn = norm([(rnx[a]+rnx[b])*mid, (rny[a]+rny[b])*mid, (rnz[a]+rnz[b])*mid])
        var base = iridescent(mn)

        var diffuse = Math.max(0, dot(mn, lightDir))
        var fresnel = Math.pow(1 - Math.min(1, Math.abs(mn[2])), 2)
        // Keep hue: scale the palette colour by light instead of adding white,
        // otherwise bright lines clip to white and the iridescence disappears.
        var lum = canvas.ambient + diffuse * 1.35
        var glow = 0.78 + 0.50 * e + pop * 0.85
        var r = Math.min(248, Math.round(base[0] * (lum + fresnel * 0.45) * 255 * glow * 0.82))
        var g = Math.min(248, Math.round(base[1] * (lum + fresnel * 0.45) * 255 * glow * 0.82))
        var bl = Math.min(248, Math.round(base[2] * (lum + fresnel * 0.45) * 255 * glow * 0.82))

        // depth fade: far edges dimmer
        var zfade = Math.max(0, Math.min(1, (depth[idx] + 1.4) / 2.4))
        // thinner net => fewer lines would vanish, so keep alpha up but rely on
        // the narrower stroke plus additive blending to build the tone
        var alpha = (0.5 + 0.4 * zfade) * (0.72 + 0.26 * e)
        if (alpha < 0.03) continue

        ctx.strokeStyle = "rgba(" + r + "," + g + "," + bl + "," + alpha.toFixed(3) + ")"
        ctx.lineWidth = 0.5 + 0.45 * zfade
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
        ctx.stroke()
      }
      ctx.globalCompositeOperation = "source-over"

      // ---- impulse flash: soft bloom that swells and fades ----------
      // The canvas is deliberately larger than the window (see the clip above),
      // so the visible area is only half the window across. The halo has to be
      // kept inside that: any alpha that survives past the window edge gets
      // clipped by the compositor on a straight line, which is precisely when
      // the box becomes visible.
      var vis = Math.min(panel.width, panel.height) / 2

      if (pop > 0.01) {
        var fade = Math.sin(Math.min(1, pop) * Math.PI)
        var haloR = Math.min(radius * (1.3 + 1.1 * (1 - pop)), vis - 2)

        // impulse glow: themed, so it belongs to the palette rather than fighting it
        var acc = "rgba(" + Math.round(paletteA.r * 255) + "," +
                        Math.round(paletteA.g * 255) + "," +
                        Math.round(paletteA.b * 255) + ","
        var fg = ctx.createRadialGradient(ox, oy, 0, ox, oy, haloR)
        fg.addColorStop(0,    "rgba(255,255,255," + (fade * 0.18).toFixed(3) + ")")
        fg.addColorStop(0.32, acc + (fade * 0.11).toFixed(3) + ")")
        fg.addColorStop(0.62, acc + (fade * 0.05).toFixed(3) + ")")
        fg.addColorStop(1,    acc + "0)")
        ctx.fillStyle = fg
        ctx.beginPath()
        ctx.arc(ox, oy, haloR, 0, Math.PI * 2)
        ctx.fill()
      }

      // ---- soft edge --------------------------------------------------
      // destination-in multiplies what is already painted by this gradient's
      // alpha, so it forces every pixel out to zero regardless of what was
      // drawn or how bright. The ramp is kept to the outer tenth on purpose:
      // it has to reach exactly zero at the window border to kill the clipped
      // edge, but a wider one would start eating into the mesh, which is far
      // more visible as dimming than a faint square ever was.
      ctx.globalCompositeOperation = "destination-in"
      var edge = ctx.createRadialGradient(cx, cy, vis * 0.88, cx, cy, vis)
      edge.addColorStop(0, "rgba(0,0,0,1)")
      edge.addColorStop(1, "rgba(0,0,0,0)")
      ctx.fillStyle = edge
      ctx.fillRect(0, 0, W, H)
      ctx.globalCompositeOperation = "source-over"

      // ---- status ---------------------------------------------------
      ctx.font = "12px monospace"
      ctx.textAlign = "center"
      ctx.fillStyle = e > 0.05 ? Util.alpha(paletteA, 0.95) : Util.alpha(Color.muted, 0.7)
      ctx.fillText(e > 0.05 ? ("● Ollama · " + (panel.state.model || "local model")) : "Ollama",
                   cx, H - 12)
      }
    }
  }
}