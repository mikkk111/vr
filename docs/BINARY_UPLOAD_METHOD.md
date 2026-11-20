# Verified model uploads: reusable binary bridge

**Status:** demonstrated successfully on 20 November 2026 with Trellis 3D (22,415,968 bytes, SHA-256 `b41f9107a1b5f0eb5760b2950b4081cc960e8ecd68cd51ce9ac11a92bdba8dfa`).

## Problem

The connected GitHub content-editing interface accepts UTF-8 text or base64 Git blobs, but not a local GLB file path. A placeholder web page and catalogue entry alone do **not** publish its binary model. The runtime container has no direct GitHub network access, so calling `git push` there is not sufficient.

## Fully connected workaround (no user action required when all tools are available)

1. Read the original uploaded GLB from the runtime. Validate glTF 2.0 header, mesh, UVs, normals, material, embedded textures, real bounds and source SHA-256. Never modify the source geometry to ease transfer.
2. XZ compress losslessly and split into 1 MiB parts; record each part size, Git blob SHA-1, compressed archive size/SHA-256 and decompressed GLB size/SHA-256.
3. Base64-encode each part separately into a temporary text file; stage these text files in a dedicated temporary personal-file workspace so connected text readers can retrieve them. Keep them private; do not publish raw data tokens or credentials.
4. For each part, read the full untruncated base64 text and call the connected GitHub blob-creation operation with `encoding=base64`. Independently compare the resulting Git blob SHA with `sha1(b'blob '+str(byte_count).encode()+b'\\0'+part_bytes)`. Abort on a mismatch.
5. Read the current `main` head and base tree. Create an atomic tree from those Git blob SHA identifiers under a new object's `assets/upload/` folder. Use a new commit with the observed head as parent and a conditional, non-force ref update. Never overwrite or change another object.
6. A model-specific GitHub Action reassembles parts in order, verifies every byte length and both complete SHA-256 checksums, decompresses to the exact original GLB, validates source invariants and commits the binary to `assets/model.glb`. It removes temporary chunk files and marks `objects/manifest.json` entry `ready` *only after verification*.
7. Confirm the GitHub Action succeeded; verify the final GitHub file size **and Git blob SHA**, catalogue status `ready`, Pages deployment success and model URL. Verify on the physical Quest 3 separately; a source check is not a headset test.
8. Delete the temporary staging files after GitHub has accepted and verified the final GLB. Keep the original source uploaded to the conversation intact.

**Important:** `b'\\0'` above means a single zero byte between the Git object header and content. A failed part upload must never be marked `ready`.

## Alternative without the binary bridge

For files up to **25 MiB**, the owner can use GitHub's own **Add file → Upload files** in the correct `objects/<id>/assets/` folder, followed by a GitHub Action that checksum-validates the exact GLB and updates the manifest. This requires a manual browser upload. For models above 25 MiB, use the binary bridge or an authenticated git push; do not silently drop textures or simplify the model to meet the upload limit.

## Architecture and safeguards

Keep the Quest 3 shared Zelda v13 engine at `shared/zelda-v13/physics-grab.js` unchanged; individual object pages have their own `config.js`, model and unique path. The main Hello World site reads `objects/manifest.json`; never hard-code new object links. The original Zelda application and every existing object's URL must remain intact. Avoid paid APIs, token-sharing, force pushes, and claims of headset validation without physical testing.
