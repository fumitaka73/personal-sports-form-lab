import { mkdir, copyFile } from 'node:fs/promises';
const files = ['pose.js', 'pose_landmark_lite.tflite', 'pose_solution_packed_assets_loader.js', 'pose_solution_packed_assets.data', 'pose_solution_simd_wasm_bin.data', 'pose_solution_simd_wasm_bin.js', 'pose_solution_simd_wasm_bin.wasm', 'pose_solution_wasm_bin.js', 'pose_solution_wasm_bin.wasm', 'pose_web.binarypb'];
await mkdir('public/pose', { recursive: true });
await Promise.all(files.map(file => copyFile(`node_modules/@mediapipe/pose/${file}`, `public/pose/${file}`)));
console.log('Copied local MediaPipe Pose Lite assets');
