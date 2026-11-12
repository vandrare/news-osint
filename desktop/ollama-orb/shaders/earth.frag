#version 440
layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;
layout(std140, binding = 0) uniform Params {
    mat4 qt_Matrix;
    float qt_Opacity;
    float phase;
    vec4 accentColor;
    vec4 foregroundColor;
    vec4 mutedColor;
};
layout(binding = 1) uniform sampler2D landTexture;

vec2 globeUV(vec3 normal) {
    float tilt = radians(23.4);
    vec3 globe = vec3(normal.x * cos(tilt) + normal.y * sin(tilt),
                     -normal.x * sin(tilt) + normal.y * cos(tilt), normal.z);
    float latitude = radians(14.0);
    globe = vec3(globe.x, globe.y * cos(latitude) + globe.z * sin(latitude),
                         -globe.y * sin(latitude) + globe.z * cos(latitude));
    // Unwrapped longitude keeps grid antialiasing stable across the map seam.
    return vec2(0.5 + (atan(globe.x, globe.z) + phase) / 6.28318530718,
                0.5 - asin(clamp(globe.y, -1.0, 1.0)) / 3.14159265359);
}

vec2 linework(vec2 uv) {
    vec2 coordinate = uv * vec2(36.0, 18.0); // ten-degree graticule
    vec2 distance = abs(fract(coordinate - 0.5) - 0.5);
    vec2 width = max(fwidth(coordinate), vec2(0.0001));
    vec2 lines = 1.0 - smoothstep(width * 0.3, width * 0.95, distance);
    float grid = max(lines.x, lines.y);
    // Sample the land boundary at a one-pixel footprint; no solid land fill.
    vec2 dx = dFdx(uv) * 0.7;
    vec2 dy = dFdy(uv) * 0.7;
    vec2 address = vec2(fract(uv.x), uv.y);
    float coast = abs(texture(landTexture, address + dx).r - texture(landTexture, address - dx).r)
                + abs(texture(landTexture, address + dy).r - texture(landTexture, address - dy).r);
    return vec2(grid, smoothstep(0.08, 0.65, coast));
}

void main() {
    vec2 p = (qt_TexCoord0 - vec2(0.5, 0.47)) * 2.24;
    float radius = length(p);
    if (radius > 1.045) {
        fragColor = vec4(0.0);
        return;
    }
    float rim = exp(-abs(radius - 1.0) * 180.0) * 0.65;
    if (radius >= 1.0) {
        fragColor = vec4(accentColor.rgb * rim, rim) * qt_Opacity;
        return;
    }
    float depth = sqrt(max(0.0, 1.0 - dot(p, p)));
    vec2 front = linework(globeUV(vec3(p.x, -p.y, depth)));
    vec2 back = linework(globeUV(vec3(p.x, -p.y, -depth)));
    // The rear hemisphere is faint enough to read as depth rather than clutter.
    float backAlpha = max(back.x * 0.09, back.y * 0.13) * (0.45 + 0.55 * depth);
    float gridAlpha = front.x * (0.28 + 0.27 * depth);
    float coastAlpha = front.y * (0.65 + 0.32 * depth);
    vec3 coastColor = mix(accentColor.rgb, foregroundColor.rgb, 0.7);
    vec3 color = mutedColor.rgb * backAlpha;
    color = color * (1.0 - gridAlpha) + accentColor.rgb * gridAlpha;
    float alpha = backAlpha + gridAlpha * (1.0 - backAlpha);
    color = color * (1.0 - coastAlpha) + coastColor * coastAlpha;
    alpha += coastAlpha * (1.0 - alpha);
    color = color * (1.0 - rim) + accentColor.rgb * rim;
    alpha += rim * (1.0 - alpha);
    fragColor = vec4(color, alpha) * qt_Opacity;
}
