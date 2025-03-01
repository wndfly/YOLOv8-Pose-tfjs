import React, { useState, useEffect, useRef } from "react";
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-webgl"; // set backend to webgl
//import "@tensorflow/tfjs-backend-webgpu"; // set backend to webgpu
//import "@tensorflow/tfjs-backend-wasm"; // set backend to wasm
import Loader from "./components/loader";
import ButtonHandler from "./components/btn-handler";
import { detect, detectVideo } from "./utils/detect";
import "./style/App.css";

const App = () => {
  const [loading, setLoading] = useState({ loading: true, progress: 0 }); // loading state
  const [modelName, setModelName] = useState('yolov8n-pose'); // model configs
  const [model, setModel] = useState({
    net: null,
    inputShape: [1, 0, 0, 3],
  }); // init model & input shape

  // references
  const fpsRef = useRef(null);
  const imageRef = useRef(null);
  const cameraRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    //tf.setBackend('webgpu');
    tf.ready().then(async () => {
      //console.log(tf.getBackend());
      const [baseURL, searchParams] = window.location.href.split('?');
      const modelName_ = (new URLSearchParams(searchParams)).get('model') || modelName
      setModelName(modelName_);

      const yolov8 = await tf.loadGraphModel(
        `${baseURL.replace(/\/$/, '')}/${modelName_}_web_model/model.json`,
        {
          onProgress: (fractions) => {
            setLoading({ loading: true, progress: fractions }); // set loading fractions
          },
        }
      ); // load model
      // warming up model
      const dummyInput = tf.ones(yolov8.inputs[0].shape);
      const warmupResults = yolov8.execute(dummyInput);
      setLoading({ loading: false, progress: 1 });
      setModel({
        net: yolov8,
        inputShape: yolov8.inputs[0].shape,
      }); // set model & input shape


      console.log(warmupResults.dataSync()[4000])

      tf.dispose([warmupResults, dummyInput]); // cleanup memory
    });
  }, []);

  return (
    <div className="App">
      {loading.loading && <Loader>Loading model... {(loading.progress * 100).toFixed(2)}%</Loader>}
      <div className="header">
        <h1>📷 YOLOv8 Live Pose Detection App</h1>
        <p>
          YOLOv8 live pose detection application on browser powered by <code>tensorflow.js</code>
        </p>
        <p>
          Serving : <code className="code">{modelName}</code> FPS : <code className="code" ref={fpsRef}>0</code>
        </p>
      </div>

      <div className="content">
        <img
          src="#"
          ref={imageRef}
          onLoad={() => detect(imageRef.current, model, canvasRef.current)}
        />
        <video
          autoPlay
          muted
          ref={cameraRef}
          onPlay={() => detectVideo(cameraRef.current, model, canvasRef.current, fpsRef.current)}
        />
        <video
          autoPlay
          muted
          ref={videoRef}
          onPlay={() => detectVideo(videoRef.current, model, canvasRef.current, fpsRef.current)}
        />
        <canvas width={model.inputShape[1]} height={model.inputShape[2]} ref={canvasRef} />
      </div>

      <ButtonHandler imageRef={imageRef} cameraRef={cameraRef} videoRef={videoRef} />
    </div>
  );
};

export default App;
