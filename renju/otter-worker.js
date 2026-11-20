// Dedicated worker for all of the model's ONNX inference. Same job queue and
// priority scheme as otter-chess/docs/public/otter-worker.js: session.run()
// runs on this thread so board interaction never blocks on wasm execution, and
// a newly arrived 'live' request supersedes any queued-but-not-started one.
//
// All seven inputs are fed, including the four player-context tensors: both Elo
// buckets, the time-control bucket and the clock scalars. That is what lets the
// same position produce different moves for different ratings.

// Served from public/ort/ (copied from node_modules/onnxruntime-web/dist) so the
// page has no third-party runtime dependency at load time.
//
// Both paths below are relative to *this script*, not to the site root. `./ort/`
// therefore follows the worker wherever it is served: `/otter-worker.js` at the
// root of localhost, `/renju/otter-worker.js` under a GitHub Pages basePath.
// `../ort/` was wrong for the latter — it resolves to `/ort/` and 404s.
importScripts('./ort/ort.min.js');

const BOARD_SIZE = 15;
const BOARD_CHANNELS = 18;
const HISTORY_K = 20;

let session = null;

// The exported graph declares board as float32, but keeping the fp16 helpers
// here means the same worker still works if the model is exported in fp16.
const f32Scratch = new Float32Array(1);
const u32Scratch = new Uint32Array(f32Scratch.buffer);

function float32ToFloat16Bits(value) {
  f32Scratch[0] = value;
  const x = u32Scratch[0];
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;

  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0); // Inf/NaN

  const newExp = exp - 127 + 15;
  if (newExp >= 0x1f) return sign | 0x7c00; // overflow -> Inf
  if (newExp <= 0) {
    if (newExp < -10) return sign; // underflow -> signed zero
    mant |= 0x800000; // implicit leading 1
    const shift = 14 - newExp;
    let bits = mant >>> shift;
    if ((mant >>> (shift - 1)) & 1) bits += 1; // round to nearest
    return sign | bits;
  }
  let bits = (newExp << 10) | (mant >>> 13);
  if (mant & 0x1000) bits += 1; // round to nearest
  return sign | bits;
}

function encodeFloat16(float32Data) {
  const out = new Uint16Array(float32Data.length);
  for (let i = 0; i < float32Data.length; i++) out[i] = float32ToFloat16Bits(float32Data[i]);
  return out;
}

function float16BitsToFloat32(h) {
  const sign = (h & 0x8000) ? -1 : 1;
  const exp = (h & 0x7c00) >>> 10;
  const mant = h & 0x03ff;
  if (exp === 0) return sign * mant * Math.pow(2, -24); // subnormal / zero
  if (exp === 0x1f) return mant ? NaN : sign * Infinity;
  return sign * (1 + mant / 1024) * Math.pow(2, exp - 15);
}

function decodeFloat16(data) {
  if (typeof globalThis.Float16Array !== 'undefined' && data instanceof globalThis.Float16Array) {
    return Float32Array.from(data);
  }
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = float16BitsToFloat32(data[i]);
  return out;
}

const queue = [];
let processing = false;

function enqueue(job) {
  if (job.priority === 'live') {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].priority === 'live') {
        // Every request must get a response or the caller's promise hangs.
        postMessage({ type: 'run', id: queue[i].id, error: 'superseded' });
        queue.splice(i, 1);
      }
    }
    const firstSweepIdx = queue.findIndex((j) => j.priority === 'sweep');
    if (firstSweepIdx === -1) queue.push(job);
    else queue.splice(firstSweepIdx, 0, job);
  } else {
    queue.push(job);
  }
  processQueue();
}

async function processQueue() {
  if (processing) return;
  processing = true;
  while (queue.length > 0) {
    const job = queue.shift();
    try {
      const out = await runInference(job);
      postMessage({ type: 'run', id: job.id, ...out }, out.transfer || []);
    } catch (err) {
      postMessage({ type: 'run', id: job.id, error: String(err && err.message || err) });
    }
  }
  processing = false;
}

async function runInference(job) {
  const { board, historyIds, historyMask, activeElo, opponentElo, timeControl, clock } = job;

  // The page hands us 0/1 indicator planes (encode.board_planes is a uint8 mask),
  // but the graph was trained on planes/255 — scripts/train.py line 73 casts the
  // uint8 stack to float *and then* divides, so the model's BatchNorm running
  // stats see 1/255, not 1.0. Feeding raw 0/1 scales every activation by 255 and
  // collapses the policy to a near-uniform distribution, so the scaling belongs
  // here, at the boundary where the tensors are built.
  const scaledBoard = new Float32Array(board.length);
  for (let i = 0; i < board.length; i++) scaledBoard[i] = board[i] / 255;

  const feeds = {
    board: new ort.Tensor('float32', scaledBoard, [1, BOARD_CHANNELS, BOARD_SIZE, BOARD_SIZE]),
    history_ids: new ort.Tensor('int64', historyIds, [1, HISTORY_K]),
    history_mask: new ort.Tensor('bool', historyMask, [1, HISTORY_K]),
    active_elo: new ort.Tensor('int64', BigInt64Array.from([BigInt(activeElo)]), [1]),
    opponent_elo: new ort.Tensor('int64', BigInt64Array.from([BigInt(opponentElo)]), [1]),
    time_control: new ort.Tensor('int64', BigInt64Array.from([BigInt(timeControl)]), [1]),
    clock: new ort.Tensor('float32', clock, [1, 2]),
  };

  const started = performance.now();
  const results = await session.run(feeds);
  const policyLogits = new Float32Array(results.policy_logits.data);
  const valuePred = Number(results.value_pred.data[0]);
  return {
    policyLogits,
    valuePred,
    ms: performance.now() - started,
    transfer: [policyLogits.buffer],
  };
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    try {
      ort.env.wasm.wasmPaths = new URL('./ort/', self.location.href).href;
      const sessionOptions = {
        executionProviders: msg.provider === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
        // Same reason as upstream: the fp16 precision-free-cast insertion pass
        // in 'extended' crashes on the transformer's fused LayerNorm nodes.
        graphOptimizationLevel: 'basic',
      };
      session = await ort.InferenceSession.create(msg.modelBuffer, sessionOptions);
      postMessage({ type: 'init', ok: true });
    } catch (err) {
      postMessage({ type: 'init', ok: false, error: String(err && err.message || err) });
    }
    return;
  }

  if (msg.type === 'run') {
    if (!session) {
      postMessage({ type: 'run', id: msg.id, error: 'Session not initialized' });
      return;
    }
    enqueue(msg);
  }
};
