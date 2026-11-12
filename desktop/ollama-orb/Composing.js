.pragma library
// Composing/ribbon geometry adapted from Schoolees/thinking-orbs,
// commit c5f4c356f21b3551423cf7dc828068cd7d239be3.
// Copyright (c) 2026 Jakub Antalik. See LICENSE.thinking-orbs and NOTICE.thinking-orbs.
// Uses the demo's classic 128px preset, scaled to the desktop surface.

function frame(seconds, speed) {
    var size = 128, R = size * 0.39, t = seconds * 2.1 * speed;
    var rs = Math.pow(size / 300, 0.6);
    var tilt = 0.3, st = Math.sin(tilt), ct = Math.cos(tilt);
    function project(x, y, z) { return [64 + x, 64 - (y * ct - z * st), y * st + z * ct]; }
    var dots = [], ghostN = 98, golden = Math.PI * (3 - Math.sqrt(5));
    for (var i = 0; i < ghostN; i++) {
        var y = 1 - 2 * (i + 0.5) / ghostN;
        var rad = Math.sqrt(1 - y * y), a = i * golden;
        var p = project(rad * Math.cos(a) * R, y * R, rad * Math.sin(a) * R);
        var depth = (p[2] / R + 1) / 2;
        dots.push({x:p[0], y:p[1], z:p[2], r:0.8 * rs, white:0.78, a:0.1 + 0.22 * depth});
    }
    // The shipped Composing preset has spin=0: orientation stays fixed;
    // only the two traveling waves move through the parallel dotted lanes.
    var ta = 0.55, cta = Math.cos(ta), sta = Math.sin(ta);
    var lanes = 16, segs = 71;
    for (var w = 0; w < lanes; w++) {
        var laneOff = (w - (lanes - 1) / 2) * 0.075;
        var edge = Math.abs(w - (lanes - 1) / 2) / ((lanes - 1) / 2);
        for (var k = 0; k < segs; k++) {
            var angle = k / segs * 2 * Math.PI;
            var wob = 0.16 * Math.sin(angle * 3 - t * 1.7 + w * 0.22) + 0.07 * Math.sin(angle * 5 + t * 1.1);
            var off = laneOff + wob;
            var x = Math.cos(angle), y = cta * Math.sin(angle) - sta * off;
            var z = sta * Math.sin(angle) + cta * off;
            var length = Math.sqrt(x*x + y*y + z*z);
            var p = project(x / length * R, y / length * R, z / length * R);
            var depth = (p[2] / R + 1) / 2;
            dots.push({x:p[0], y:p[1], z:p[2],
                r:(0.858 + 1.326 * depth) * (1 - 0.25 * edge) * rs,
                white:0.52 - 0.44 * depth + 0.18 * edge, a:0.4 + 0.6 * depth});
        }
    }
    dots.sort(function(a,b) { return a.z - b.z; });
    return dots;
}

function paint(ctx, width, height, seconds, speed, accent, foreground, muted) {
    ctx.resetTransform();
    ctx.clearRect(0, 0, width, height);
    var side = Math.min(width, height);
    ctx.translate((width - side) / 2, (height - side) / 2);
    ctx.scale(side / 128, side / 128);
    var dots = frame(seconds, speed);
    for (var i = 0; i < dots.length; i++) {
        var d = dots[i], alpha = Math.min(0.72, Math.max(0, d.a));
        var strength = Math.min(1, Math.max(0, 1 - d.white));
        var highlight = 0.15 * strength * strength;
        var r = muted.r + (accent.r - muted.r) * strength;
        var g = muted.g + (accent.g - muted.g) * strength;
        var b = muted.b + (accent.b - muted.b) * strength;
        r += (foreground.r - r) * highlight;
        g += (foreground.g - g) * highlight;
        b += (foreground.b - b) * highlight;
        ctx.fillStyle = Qt.rgba(r, g, b, alpha);
        ctx.beginPath();
        ctx.arc(d.x, d.y, Math.max(0.3, d.r), 0, Math.PI * 2);
        ctx.fill();
    }
}
