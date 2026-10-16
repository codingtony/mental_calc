import { Color3, CreateHemisphere, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode } from "@babylonjs/core";

export interface Kart {
  root: TransformNode;
  wheels: Mesh[];
  flame: Mesh;
  /** Recolours body and driver suit. */
  paint(color: Color3): void;
}

function material(scene: Scene, name: string, color: Color3): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = color;
  mat.emissiveColor = color.scale(0.25);
  mat.specularColor = new Color3(0.15, 0.15, 0.15);
  return mat;
}

/** Procedural kart with a driver. Origin on the ground, forward is +z. */
export function createKart(scene: Scene, name: string, color: Color3): Kart {
  const root = new TransformNode(name, scene);
  const bodyMat = material(scene, `${name}-body`, color);
  const darkMat = material(scene, `${name}-dark`, color.scale(0.55));
  const skinMat = material(scene, `${name}-skin`, new Color3(1, 0.85, 0.7));
  const blackMat = material(scene, `${name}-black`, new Color3(0.08, 0.08, 0.08));

  const part = (mesh: Mesh, mat: StandardMaterial, x: number, y: number, z: number): Mesh => {
    mesh.material = mat;
    mesh.position.set(x, y, z);
    mesh.parent = root;
    mesh.isPickable = false;
    return mesh;
  };

  part(MeshBuilder.CreateBox(`${name}-chassis`, { width: 1.6, height: 0.5, depth: 2.6 }, scene), bodyMat, 0, 0.5, 0);
  part(MeshBuilder.CreateBox(`${name}-nose`, { width: 1.2, height: 0.35, depth: 0.8 }, scene), bodyMat, 0, 0.45, 1.5);
  part(MeshBuilder.CreateBox(`${name}-spoiler`, { width: 1.8, height: 0.12, depth: 0.4 }, scene), bodyMat, 0, 1.05, -1.3);
  for (const x of [-0.6, 0.6]) {
    part(MeshBuilder.CreateBox(`${name}-strut${x}`, { width: 0.1, height: 0.3, depth: 0.1 }, scene), blackMat, x, 0.85, -1.3);
  }

  const wheels: Mesh[] = [];
  for (const x of [-0.95, 0.95]) {
    for (const z of [-0.95, 0.95]) {
      const wheel = part(
        MeshBuilder.CreateCylinder(`${name}-wheel`, { diameter: 0.7, height: 0.4, tessellation: 16 }, scene),
        blackMat,
        x,
        0.35,
        z,
      );
      wheel.rotation.z = Math.PI / 2;
      wheels.push(wheel);
    }
  }

  part(MeshBuilder.CreateCylinder(`${name}-torso`, { diameterTop: 0.45, diameterBottom: 0.65, height: 0.65 }, scene), darkMat, 0, 1.05, -0.25);
  part(MeshBuilder.CreateSphere(`${name}-head`, { diameter: 0.55, segments: 12 }, scene), skinMat, 0, 1.6, -0.2);
  part(CreateHemisphere(`${name}-helmet`, { diameter: 0.64, segments: 12 }, scene), bodyMat, 0, 1.64, -0.22);

  const flameMat = new StandardMaterial(`${name}-flame`, scene);
  flameMat.diffuseColor = Color3.Black();
  flameMat.specularColor = Color3.Black();
  flameMat.emissiveColor = new Color3(1, 0.55, 0.05);
  flameMat.disableLighting = true;
  const flameHeight = 0.9;
  const flame = part(
    MeshBuilder.CreateCylinder(`${name}-flameCone`, { diameterTop: 0, diameterBottom: 0.5, height: flameHeight, tessellation: 12 }, scene),
    flameMat,
    0,
    0.5,
    -1.6 - flameHeight / 2,
  );
  flame.rotation.x = -Math.PI / 2; // tip points toward −z
  flame.isVisible = false;

  const paint = (c: Color3): void => {
    bodyMat.diffuseColor = c;
    bodyMat.emissiveColor = c.scale(0.25);
    darkMat.diffuseColor = c.scale(0.55);
    darkMat.emissiveColor = c.scale(0.55 * 0.25);
  };

  return { root, wheels, flame, paint };
}
