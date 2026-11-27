# Human Ragdoll V1.4 — Local secondary motion

Preserves the user-confirmed improved V1.3 Jolt rigid skeleton: 15 bodies, 14 native joints, 22 visual bones, original GPU skinning and Zelda controller engine. A modest floor-only restitution of 0.12 (adjustable 0–0.22) is applied, leaving body-body restitution zero. No full-body tissue simulation or feedback into the skeleton.

Four regional mass-spring-damper handles (two per chest and gluteal region), anisotropic natural frequencies, acceleration from actual world-space anchor and rigid-body movement including whole-object grips and joystick translation, nonlinear restoring force, bounded displacement, and damping. The 2025 Spring Decomposed Skinning publication and January 2026 multidirectional spring-damper biomechanics paper informed the architecture, but this is a reduced visual model and not a calibrated reproduction of their methods. All slider values are artistic starting parameters, not measured tissue properties.

Only 2,002 of the 36,075 original vertices receive local deformation. Precomputed surface gradients adjust local normals; native GPU skinning and original material are retained. Per-frame position/normal buffer uploads remain; no full mesh constraint solve or complete normal recalculation. New fitted hulls expand locally by at most 7.27 mm (torso) and 2.46 mm (pelvis). Actual model rest-space test: all possible bounded independent offset combinations remain inside assigned envelopes; maximum signed plane residual -0.1924 mm. All nonadjacent rest-pose hull pairs remain separated (maximum LP overlap radius -0.0386 mm). Does not guarantee triangle-level separation in arbitrary articulated poses.

Numerical tests using the actual original GLB passed mask coverage and 720-step synthetic 3D acceleration/recovery tests for all four handles. Maximum handle displacement caps (x,y,z): chest 5/12/7 mm, gluteal 4/10/6 mm; actual mesh movement is weighted. Original shape recovers after driving force stops. JavaScript syntax checked. No browser, full native Jolt drop, or Quest runtime test. No hardware FPS claim.

Presets Natural, Subtle, Responsive, Secondary motion off; independent strength, firmness, damping, and floor restitution sliders before entering passthrough. Previous V1.3 untouched.

Research: https://doi.org/10.1111/cgf.70209 ; https://doi.org/10.1080/10255842.2026.2617927 ; https://jrouwe.github.io/JoltPhysicsDocs/5.7.0/struct_physics_settings.html
