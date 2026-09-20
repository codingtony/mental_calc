import { Engine, Scene, ArcRotateCamera, HemisphericLight, MeshBuilder, Vector3, Color4 } from "@babylonjs/core";
import { defaultQuestionConfig, generateQuestionBank, pickQuestions } from "./questions";

function renderSampleQuestion(): void {
  const overlay = document.getElementById("question-overlay")!;
  const bank = generateQuestionBank(defaultQuestionConfig);
  const [question] = pickQuestions(bank, 1);
  overlay.textContent = `${question.text} = ?`;
}

function main(): void {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  const engine = new Engine(canvas, true);
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.07, 0.07, 0.1, 1);

  const camera = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 2.5, 6, Vector3.Zero(), scene);
  camera.attachControl(canvas, true);

  new HemisphericLight("light", new Vector3(0, 1, 0), scene);

  const box = MeshBuilder.CreateBox("box", { size: 1.5 }, scene);
  scene.registerBeforeRender(() => {
    box.rotation.y += 0.01;
    box.rotation.x += 0.005;
  });

  renderSampleQuestion();

  if (import.meta.env.DEV) {
    // Dev-only hook so the ported question module can be exercised from the browser
    // console / automated verification without adding a test framework.
    (window as unknown as { __mc: unknown }).__mc = {
      defaultQuestionConfig,
      generateQuestionBank,
      pickQuestions,
    };
  }

  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());
}

main();
