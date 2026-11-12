#version 440
layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;
layout(std140, binding = 0) uniform Params {
    mat4 qt_Matrix;
    float qt_Opacity;
    float phase;
};
layout(binding = 1) uniform sampler2D landTexture;

void main() {
    // Orthographic sphere, with room for its atmosphere and status caption.
    vec2 p = (qt_TexCoord0 - vec2(0.5, 0.47)) * 2.24;
    float radius = length(p);
    if (radius > 1.09) {
        fragColor = vec4(0.0);
        return;
    }
    vec3 atmosphere = vec3(0.18, 0.55, 1.0);
    if (radius > 1.0) {
        float alpha = 0.35 * exp(-38.0 * (radius - 1.0));
        alpha *= 1.0 - smoothstep(1.04, 1.09, radius);
        fragColor = vec4(atmosphere * alpha, alpha) * qt_Opacity;
        return;
    }
    vec3 normal = vec3(p.x, -p.y, sqrt(max(0.0, 1.0 - dot(p, p))));
    // Axial tilt on screen and a slightly northern viewpoint.
    float tilt = radians(23.4);
    vec3 globe = vec3(normal.x * cos(tilt) + normal.y * sin(tilt),
                     -normal.x * sin(tilt) + normal.y * cos(tilt), normal.z);
    float viewLatitude = radians(14.0);
    globe = vec3(globe.x, globe.y * cos(viewLatitude) + globe.z * sin(viewLatitude),
                         -globe.y * sin(viewLatitude) + globe.z * cos(viewLatitude));
    float u = fract(0.5 + (atan(globe.x, globe.z) + phase) / 6.28318530718);
    float v = 0.5 - asin(clamp(globe.y, -1.0, 1.0)) / 3.14159265359;
    float land = texture(landTexture, vec2(u, v)).r;
    float latitude = (0.5 - v) * 180.0;
    float longitude = (u - 0.5) * 360.0;

    // Decorative terrain colors; coastlines use bundled Natural Earth data.
    float detail = 0.5 + 0.20 * sin(u * 31.0 + 3.0 * sin(v * 13.0)) + 0.12 * sin(v * 53.0 + 2.0 * sin(u * 19.0));
    vec3 ocean = mix(vec3(0.015, 0.095, 0.24), vec3(0.025, 0.25, 0.52), normal.z);
    vec3 vegetation = mix(vec3(0.10, 0.29, 0.13), vec3(0.26, 0.44, 0.20), detail);
    float sahara = smoothstep(12.0, 19.0, latitude) * (1.0 - smoothstep(31.0, 37.0, latitude));
    sahara *= smoothstep(-24.0, -10.0, longitude) * (1.0 - smoothstep(53.0, 65.0, longitude));
    float australia = smoothstep(-38.0, -28.0, latitude) * (1.0 - smoothstep(-20.0, -12.0, latitude));
    australia *= smoothstep(108.0, 120.0, longitude) * (1.0 - smoothstep(142.0, 155.0, longitude));
    vec3 terrain = mix(vegetation, vec3(0.73, 0.58, 0.33), max(sahara, australia));
    float snow = smoothstep(63.0, 79.0, abs(latitude));
    terrain = mix(terrain, vec3(0.88, 0.94, 0.97), snow);
    vec3 surface = mix(ocean, terrain, land);

    vec3 sun = normalize(vec3(-0.45, 0.35, 0.85));
    float light = 0.22 + 0.78 * max(0.0, dot(normal, sun));
    vec3 color = surface * light;
    float glint = pow(max(0.0, dot(reflect(-sun, normal), vec3(0, 0, 1))), 48.0);
    color += vec3(0.18, 0.27, 0.35) * glint * (1.0 - land);
    color += atmosphere * pow(1.0 - normal.z, 3.0) * 0.28;
    float alpha = 1.0 - smoothstep(0.996, 1.0, radius);
    fragColor = vec4(color * alpha, alpha) * qt_Opacity;
}
