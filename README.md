# CG-BlendShape

A web-based VRM face animation system with real-time blendshape control, webcam face tracking, and a cloth-physics "2D foil" visualization mode.

Built for a computer graphics course project. Purely coded by DeepSeek-V4-Pro. It's completely normal if there are bugs. Anyway, it works on my machine, which is good enough for me.

## Features

- **VRM Model Viewer** — Load any `.vrm` file (VRoid, etc.). Auto-centers on the face, hides body meshes.
- **Expression Sliders** — 14 blendshape weights with real-time sliders.
- **Webcam Face Tracking** — MediaPipe Face Landmarker drives VRM expressions in real time.
- **Adaptive Calibration** — First 2 seconds capture your neutral face as baseline. Subsequent expressions are relative deviations.
- **2D Foil Mode** — Renders the 3D face to a GPU texture and projects it onto a mass-spring cloth grid. Wind, click-to-deform, auto-orbit camera.
- **Landmarks Overlay** — MediaPipe 478 face landmarks drawn on the webcam preview.
- **Model Import** — Switch `.vrm` models at runtime.

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The default VRoid model loads automatically. You can also click **Import** to load any local `.vrm` file at runtime.

## Usage

| Control | Description |
|---------|-------------|
| **Blend Weights** sliders | Adjust each expression from 0% to 100% |
| **Import** button | Load a local `.vrm` model |
| **3D / 2D** toggle | Switch between 3D face view and cloth-physics 2D mode |
| **Reset** button | Zero all expression weights |
| **Camera Tracking** | Enable webcam face capture. Keep a neutral face for 2s during calibration. |
| **Dots** button | Toggle MediaPipe face landmarks on the webcam preview |

### 2D Mode Controls

| Control | Description |
|---------|-------------|
| **Wind** slider | Breeze intensity on the cloth surface |
| **Orbit** slider | Auto-rotation speed |
| **Wire** button | Toggle grid wireframe overlay |
| **Free Cam** button | Enable manual camera orbit/zoom |
| **Reset** button | Flatten the cloth surface |
| Click & drag on surface | Deform the cloth (ripple effect) |

## Tech Stack

- **Three.js** — 3D rendering
- **@pixiv/three-vrm** — VRM model loading & expression control
- **MediaPipe Face Landmarker** — Real-time face mesh & blendshape detection
- **Vite** — Build tool

## Architecture

```
VRM File → GLTFLoader + VRMLoaderPlugin → vrm.expressionManager
                                                 │
                    ┌────────────────────────────┼────────────────────┐
                    ▼                            ▼                    ▼
              Manual Sliders            Webcam Face Tracking     2D Foil
              setValue(name,w)          MediaPipe → blendshapes   Offscreen RT
                    │                  calibrate → remap → EMA   cloth physics
                    ▼                            │                    │
              vrm.update()  ◄────────────────────┘                    │
                    │                                                  │
                    ▼                                                  ▼
              GPU morph targets                              clothMat.map = RT
              (vertex shader)                                wind + springs
```

## Project Structure

```
├── index.html              # Main page
├── package.json            # Dependencies
├── vite.config.js          # Vite config
├── src/
│   ├── main.js             # Application logic
│   └── style.css           # Styles
└── public/
    └── assets/
        ├── bg.png           # Background image
        └── foil.png         # 2D mode backdrop
```

## Screenshots

![3D mode](snapshots/1.png)

![2D cloth mode](snapshots/2.png)

## Assets & Credits

| File | Source |
|------|--------|
| `public/AvatarSample_A.vrm` | VRoid Studio free demo model |
| `public/assets/foil.png` | [Rune Xiao — pixiv #144796629](https://www.pixiv.net/artworks/144796629) |
| `public/assets/bg.png` | [Rune Xiao — pixiv #137631690](https://www.pixiv.net/artworks/137631690) |

The demo uses [Evil Neuro-Sama](https://hub.vroid.com/en/characters/1954135249366039447/models/8453217242513942057) from VRoid Hub. More free VRM models can be found at [VRoid Hub](https://hub.vroid.com/) and [VRM Consortium](https://vrm.dev/).

## Disclaimer

This project is for educational purposes as part of a computer graphics course assignment. If any content infringes your rights, please contact me and I will remove it promptly.

## License

MIT
