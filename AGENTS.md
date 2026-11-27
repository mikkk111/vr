# VR Projects — permanent publication rules

Every new project and every new version must include a conspicuous, accessible **Main Menu — All Projects** link to `https://mikkk111.github.io/vr/` (use a correct relative URL where possible). It must be visible at the top of the project interface before entering XR, independent of JavaScript and model loading. Verify it resolves to the catalogue, not a browser-history action.

Display the actual release number in very large, bold lettering at the top of the project page, on a separate line if necessary. Keep the title, browser tab, catalogue, diagnostic links, and cache-busting version consistent. Distinguish the application release from the inherited Zelda v13 controller baseline. Increment the release number for every modification (Zelda GPU V14.2, V14.3, V14.4, etc.) and preserve the existing versions and permanent URLs. Navigation-only additions to older versions may be made when requested, without relabelling their actual release or altering rendering code.

Read the latest repository files before edits. Register every new release in `objects/manifest.json`. Preserve shared controller functionality and existing models. Validate links, source syntax, and catalogue entries; verify deployment and distinguish source checks from physical Quest 3 testing. Never claim hardware testing that has not been performed.

## Catalogue ordering

The homepage must always display the most recently published project or version first. Keep the manifest in chronological insertion order (oldest first), append new entries, and render a reversed copy on the homepage. When publishing a substantive update at an existing URL, move that entry to the end of the manifest so it appears first; preserve all other entries and URLs. Verify that the latest project is first after every publication.

## Native WebGPU baseline — Zelda GPU V14.3

On 27 November 2026 the project owner reported that native WebGPU passthrough works on their physical Quest 3 after the V14.3 initialisation fix. This is user-reported success, not an independent hardware benchmark or full controller regression test.

Use `objects/zelda-gpu-v14-3/index.html` (blob `a07d057491ecd6aee2c0390058109dc4e0d3f4a9`, commit `a537866abec959b1b89d91f4be18b6cfd5831fb7`) as the known-working starting point for every future native WebGPU experiment. Preserve that page unchanged. Next release: V14.4. Keep Three.js 0.186.1 pinned unless explicitly testing an upgrade.

Critical invariant: set `renderer.xr.enabled = true` **before** `await renderer.init()` so the WebGPU backend requests an XR-compatible adapter. Set the reference space and framebuffer scale before session creation. Native immersive AR requests `['local-floor','webgpu']`; verify the actual WebGPU backend and XR GPU binding, with no silent WebGL fallback. Preserve transparent passthrough, disabled native XR MSAA, conservative GPU safe mode, and persistent diagnostics. Preserve the shared v13 controller engine (`shared/zelda-v13/physics-grab.js`, blob `9f206b64bbe1a483f429489e54aa85cdc2f489a7`) and existing WebGL projects. Do not replace the working WebGL template globally; future WebGPU releases are separate and independently testable. Keep the V14.3 fallback URL in the catalogue.
