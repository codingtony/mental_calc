import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import type { HelmetId, Rgb } from "./look";

/** Shell ellipsoid radii for a unit-diameter helmet (x wide, y tall, z deep). */
const SHELL = new Vector3(0.46, 0.475, 0.54);

interface VisorStyle {
  color: Color3;
  emissive: Color3;
  specular: number;
}

const VISORS: Record<HelmetId, VisorStyle> = {
  classic: { color: new Color3(0.05, 0.05, 0.07), emissive: Color3.Black(), specular: 0.8 },
  mirror: { color: new Color3(0.95, 0.7, 0.2), emissive: new Color3(0.15, 0.1, 0.03), specular: 1 },
};

/**
 * Visor: a patch of an ellipsoid slightly larger than the shell, facing +z at eye level
 * (longitude ±75°, latitude −22°..+18°).
 */
function visorMesh(scene: Scene, name: string): Mesh {
  const rows: Vector3[][] = [];
  const scale = 1.03;
  for (let r = 0; r <= 4; r++) {
    const lat = ((-22 + (40 * r) / 4) * Math.PI) / 180;
    const row: Vector3[] = [];
    for (let c = 0; c <= 16; c++) {
      const lon = ((-75 + (150 * c) / 16) * Math.PI) / 180;
      row.push(
        new Vector3(
          SHELL.x * scale * Math.cos(lat) * Math.sin(lon),
          SHELL.y * scale * Math.sin(lat),
          SHELL.z * scale * Math.cos(lat) * Math.cos(lon),
        ),
      );
    }
    rows.push(row);
  }
  return MeshBuilder.CreateRibbon(name, { pathArray: rows, sideOrientation: Mesh.DOUBLESIDE }, scene);
}

/** Unit-diameter helmet centred on the origin, facing +z. The caller scales it to size. */
export function buildHelmet(scene: Scene, name: string, id: HelmetId, color: Rgb): TransformNode {
  const root = new TransformNode(name, scene);

  const shell = MeshBuilder.CreateSphere(`${name}-shell`, { diameter: 1, segments: 24 }, scene);
  shell.scaling.set(SHELL.x * 2, SHELL.y * 2, SHELL.z * 2);
  const shellMat = new StandardMaterial(`${name}-shellMat`, scene);
  shellMat.diffuseColor = new Color3(...color);
  shellMat.emissiveColor = shellMat.diffuseColor.scale(0.15);
  shellMat.specularColor = new Color3(0.5, 0.5, 0.5);
  shellMat.specularPower = 64;
  shell.material = shellMat;

  const style = VISORS[id];
  const visor = visorMesh(scene, `${name}-visor`);
  const visorMat = new StandardMaterial(`${name}-visorMat`, scene);
  visorMat.diffuseColor = style.color;
  visorMat.emissiveColor = style.emissive;
  visorMat.specularColor = new Color3(style.specular, style.specular, style.specular);
  visorMat.specularPower = 64;
  visor.material = visorMat;

  for (const m of [shell, visor]) {
    m.parent = root;
    m.isPickable = false;
  }
  return root;
}
