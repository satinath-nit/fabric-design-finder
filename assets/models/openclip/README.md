# OpenCLIP ONNX Model

Place the bundled offline image encoder here as:

```text
assets/models/openclip/model.onnx
```

The app loads this model during development and packages it into Windows/macOS builds through `electron-builder` `extraResources`.

Recommended production model profile:

- OpenCLIP-compatible image encoder
- ONNX export
- CPU inference support
- Input tensor: 1 x 3 x 224 x 224, normalized with CLIP mean/std
- Output tensor: one image embedding vector

Until `model.onnx` is added, the app uses deterministic local visual embeddings so indexing and search can be tested offline.
