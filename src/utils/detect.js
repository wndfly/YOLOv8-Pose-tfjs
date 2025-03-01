import * as tf from "@tensorflow/tfjs";
import { renderBoxes } from "./renderBox";

const FPSUpdateMilliseconds = 1000;

/**
 * Preprocess image / frame before forwarded into the model
 * @param {HTMLVideoElement|HTMLImageElement} source
 * @param {Number} modelWidth
 * @param {Number} modelHeight
 * @returns input tensor, xRatio and yRatio
 */
const preprocess = (source, modelWidth, modelHeight) => {
  let xRatio, yRatio; // ratios for boxes

  const input = tf.tidy(() => {
    const img = tf.browser.fromPixels(source);

    // padding image to square => [n, m] to [n, n], n > m
    const [h, w] = img.shape.slice(0, 2); // get source width and height
    const maxSize = Math.max(w, h); // get max size
    const imgPadded = img.pad([
      [0, maxSize - h], // padding y [bottom only]
      [0, maxSize - w], // padding x [right only]
      [0, 0],
    ]);

    xRatio = maxSize / w; // update xRatio
    yRatio = maxSize / h; // update yRatio

    return tf.image
      .resizeBilinear(imgPadded, [modelWidth, modelHeight]) // resize frame
      .div(255.0) // normalize
      .expandDims(0); // add batch
  });

  return [input, xRatio, yRatio];
};

/**
 * Function run inference and do detection from source.
 * @param {HTMLImageElement|HTMLVideoElement} source
 * @param {tf.GraphModel} model loaded YOLOv8 tensorflow.js model
 * @param {HTMLCanvasElement} canvasRef canvas reference
 * @param {VoidFunction} callback function to run after detection process
 */
export const detect = async (source, model, canvasRef, callback = () => { }) => {
  const [modelWidth, modelHeight] = model.inputShape.slice(1, 3); // get model width and height

  tf.engine().startScope(); // start scoping tf engine
  const [input, xRatio, yRatio] = preprocess(source, modelWidth, modelHeight); // preprocess image

  const res = model.net.execute(input); // inference model
  const transRes = res.transpose([0, 2, 1]); // transpose result [b, det, n] => [b, n, det]

  const boxes = tf.tidy(() => {
    const w = transRes.slice([0, 0, 2], [-1, -1, 1]); // get width
    const h = transRes.slice([0, 0, 3], [-1, -1, 1]); // get height
    const x1 = tf.sub(transRes.slice([0, 0, 0], [-1, -1, 1]), tf.div(w, 2)); // x1
    const y1 = tf.sub(transRes.slice([0, 0, 1], [-1, -1, 1]), tf.div(h, 2)); // y1
    //console.log("w: ",w.dataSync()[4000],"h: ",h.dataSync()[4000],"x1: ",x1.dataSync()[4000],"y1: ",y1.dataSync()[4000])
    return tf
      .concat(
        [
          y1,
          x1,
          tf.add(y1, h), //y2
          tf.add(x1, w), //x2
        ],
        2
      )
      .squeeze();
  }); // process boxes [y1, x1, y2, x2]

  const scores = tf.tidy(() => {
    const rawScores = transRes.slice([0, 0, 4], [-1, -1, 1]).squeeze(); // class scores
    return rawScores;
  }); // get scores

  const landmarks = tf.tidy(() => {
    return transRes.slice([0, 0, 5], [-1, -1, -1]).squeeze();
  }); // get landmarks

  const nms = await tf.image.nonMaxSuppressionAsync(boxes, scores, 10, 0.45, 0.3); // NMS to filter boxes

  const boxes_data = boxes.gather(nms, 0).dataSync(); // indexing boxes by nms index
  const scores_data = scores.gather(nms, 0).dataSync(); // indexing scores by nms index
  let landmarks_data = landmarks.gather(nms, 0).dataSync(); // indexing classes by nms index

  // reshape keypoints_data
  landmarks_data = tf.reshape(landmarks_data, [-1, 3, 17]);

  renderBoxes(canvasRef, landmarks_data, boxes_data, scores_data, xRatio, yRatio); // render boxes
  tf.dispose([res, transRes, boxes, scores, nms]); // clear memory

  callback();

  tf.engine().endScope(); // end of scoping
};

/**
 * Function to detect video from every source.
 * @param {HTMLVideoElement} vidSource video source
 * @param {tf.GraphModel} model loaded YOLOv8 tensorflow.js model
 * @param {HTMLCanvasElement} canvasRef canvas reference
 */
export const detectVideo = async (vidSource, model, canvasRef, fpsRef) => {
  let startInferenceTime = 0;
  let endInferenceTime = 0;
  let inferenceTimeSum = 0;
  let numInferences = 0;
  let lastFpsRefresh = 0;

  fpsRef.innerHTML = 0;

  /**
   * Function to detect every frame from video
   */
  const detectFrame = async () => {
    if (vidSource.videoWidth === 0 && vidSource.srcObject === null) {
      const ctx = canvasRef.getContext("2d");
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); // clean canvas
      return; // handle if source is closed
    }

    startInferenceTime = (performance || Date).now();

    await detect(vidSource, model, canvasRef, () => {
      requestAnimationFrame(detectFrame); // get another frame
    });

    endInferenceTime = (performance || Date).now();
    inferenceTimeSum += endInferenceTime - startInferenceTime;
    numInferences++;

    console.log('inferenceTime', endInferenceTime - startInferenceTime);

    if (endInferenceTime - lastFpsRefresh >= FPSUpdateMilliseconds) {
      const averageInferenceTime = inferenceTimeSum / numInferences;
      inferenceTimeSum = 0;
      numInferences = 0;
      lastFpsRefresh = endInferenceTime;
      fpsRef.innerHTML = parseInt(1000.0 / averageInferenceTime);
    }
  };

  await detectFrame(); // initialize to detect every frame
};
