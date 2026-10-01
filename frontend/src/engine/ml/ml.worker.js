import { ForecastUnavailable, runModel } from "./index.js";

self.onmessage = ({ data }) => {
  const { id, model, history, horizon } = data;
  try {
    self.postMessage({ id, result: runModel(model, history, horizon) });
  } catch (error) {
    self.postMessage({ id, error: { unavailable: error instanceof ForecastUnavailable, message: error.message } });
  }
};
