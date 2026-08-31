/*
 * Casino-horror board renderer (Babylon.js)
 *
 * A smoke-lit square circuit with warped brass props and an escape road, drawn
 * for a Telegram Mini App board game. This module is rendering only: it owns
 * meshes, materials, and idle animation, and knows nothing about turns, scores,
 * sessions, or Telegram identity. Drive it from game systems through the small
 * surface below, and keep authoritative board state on the server.
 *
 * Copy-paste notes:
 * - The board contract (BOARD_LENGTH, SpaceType, getSpaceType) is declared
 *   inline so this file compiles on its own. In a project that already owns a
 *   board types module, delete that block and restore the original import:
 *       import { BOARD_LENGTH, getSpaceType } from "./types";
 * - BOARD_LENGTH must stay divisible by 4: positionFor splits the ring into
 *   four equal edges.
 * - setDeskPosition repaints every space, which clears the setActiveSpace
 *   highlight. Call setActiveSpace again after moving the desk.
 * - Requires @babylonjs/core. Feed update(delta) from the render loop in
 *   seconds, e.g. engine.getDeltaTime() / 1000.
 */

import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";

// --- Board contract -------------------------------------------------------
// Replace this block with your project's own module when you have one.

export type SpaceType = "lounge" | "chips" | "event" | "solo" | "chance" | "sponsor" | "desk";

/** Fixed ring layout. Index 0 is the gate; corners land on lounge/solo. */
const RING_LAYOUT: readonly SpaceType[] = [
  "lounge", "chips", "event", "chips", "chance", "sponsor",
  "solo", "chips", "event", "chips", "chance", "sponsor",
  "lounge", "chips", "event", "chips", "chance", "sponsor",
  "solo", "chips", "event", "chips", "chance", "sponsor",
];

export const BOARD_LENGTH = RING_LAYOUT.length;

/** The desk roams, so it wins over the static layout wherever it currently sits. */
export function getSpaceType(index: number, deskIndex: number): SpaceType {
  const wrapped = ((index % BOARD_LENGTH) + BOARD_LENGTH) % BOARD_LENGTH;
  if (wrapped === (((deskIndex % BOARD_LENGTH) + BOARD_LENGTH) % BOARD_LENGTH)) return "desk";
  return RING_LAYOUT[wrapped];
}

// --- Renderer -------------------------------------------------------------

const spaceColors: Record<string, string> = {
  lounge: "#d9c69a",
  chips: "#618b72",
  event: "#a92528",
  solo: "#d2a84d",
  chance: "#6d4b70",
  sponsor: "#96a63b",
  desk: "#bd3131",
};

type IdleProp = {
  mesh: Mesh;
  basePosition: Vector3;
  baseRotation: Vector3;
  phase: number;
  bob: number;
  sway: number;
  speed: number;
};

type SmokePuff = {
  mesh: Mesh;
  basePosition: Vector3;
  phase: number;
  scale: number;
};

export class BoardRenderer {
  private readonly spaceMeshes = [] as ReturnType<typeof MeshBuilder.CreateCylinder>[];
  private readonly spaceMaterials: StandardMaterial[] = [];
  private exitLaneMaterial: StandardMaterial | null = null;
  private gateMaterial: StandardMaterial | null = null;
  private deskBeacon: ReturnType<typeof MeshBuilder.CreatePolyhedron> | null = null;
  private readonly idleProps: IdleProp[] = [];
  private readonly smokePuffs: SmokePuff[] = [];
  private ownedMeshes: AbstractMesh[] = [];
  private ownedMaterials: Material[] = [];
  private deskIndex = 0;
  private elapsed = 0;

  constructor(private readonly scene: Scene) {
    // Everything built below is created synchronously, so the slice after
    // construction is exactly what this renderer owns and must dispose.
    const meshOffset = scene.meshes.length;
    const materialOffset = scene.materials.length;
    this.createBackdrop();
    this.createRoadNetwork();
    this.createSquareCircuit();
    this.createTownProps();
    this.createBadIdeaBlock();
    this.ownedMeshes = scene.meshes.slice(meshOffset);
    this.ownedMaterials = scene.materials.slice(materialOffset);
  }

  positionFor(index: number) {
    const edge = BOARD_LENGTH / 4;
    const left = -5;
    const right = 5;
    const bottom = -3.6;
    const top = 3.6;
    if (index < edge) return new Vector3(left + (index / edge) * (right - left), 0.3, bottom);
    if (index < edge * 2) return new Vector3(right, 0.3, bottom + ((index - edge) / edge) * (top - bottom));
    if (index < edge * 3) return new Vector3(right - ((index - edge * 2) / edge) * (right - left), 0.3, top);
    return new Vector3(left, 0.3, top - ((index - edge * 3) / edge) * (top - bottom));
  }

  exitPosition() {
    return new Vector3(-10.4, 0.42, -3.6);
  }

  setActiveSpace(index: number) {
    this.spaceMaterials.forEach((material, materialIndex) => {
      const color = Color3.FromHexString(spaceColors[getSpaceType(materialIndex, this.deskIndex)]);
      material.emissiveColor = materialIndex === index ? color.scale(0.7) : color.scale(0.12);
    });
  }

  setDeskPosition(index: number) {
    if (this.deskIndex === index) return;
    this.deskIndex = index;
    if (this.deskBeacon) this.deskBeacon.position = this.positionFor(index).add(new Vector3(0, 0.42, 0));
    this.spaceMaterials.forEach((material, materialIndex) => {
      const color = Color3.FromHexString(spaceColors[getSpaceType(materialIndex, this.deskIndex)]);
      material.diffuseColor = color;
      material.emissiveColor = color.scale(0.12);
    });
  }

  setExitOpen(open: boolean) {
    if (this.exitLaneMaterial) {
      this.exitLaneMaterial.diffuseColor = Color3.FromHexString(open ? "#bd3131" : "#211519");
      this.exitLaneMaterial.emissiveColor = Color3.FromHexString(open ? "#bd3131" : "#140b0e").scale(open ? 0.62 : 0.08);
    }
    if (this.gateMaterial) {
      this.gateMaterial.diffuseColor = Color3.FromHexString(open ? "#d2a84d" : "#5f4930");
      this.gateMaterial.emissiveColor = Color3.FromHexString(open ? "#d2a84d" : "#21130f").scale(open ? 0.68 : 0.12);
    }
  }

  update(delta: number) {
    this.elapsed += delta;
    this.idleProps.forEach((prop) => {
      const beat = Math.sin(this.elapsed * prop.speed + prop.phase);
      const wobble = Math.sin(this.elapsed * (prop.speed * 0.57) + prop.phase * 1.7);
      prop.mesh.position.y = prop.basePosition.y + beat * prop.bob;
      prop.mesh.rotation.z = prop.baseRotation.z + beat * prop.sway;
      prop.mesh.rotation.y = prop.baseRotation.y + wobble * prop.sway * 0.35;
    });
    this.smokePuffs.forEach((puff) => {
      const cycle = (this.elapsed * 0.18 + puff.phase) % 1;
      puff.mesh.position.x = puff.basePosition.x + Math.sin(this.elapsed * 0.44 + puff.phase * 11) * 0.18;
      puff.mesh.position.z = puff.basePosition.z + Math.cos(this.elapsed * 0.31 + puff.phase * 7) * 0.1;
      puff.mesh.position.y = puff.basePosition.y + cycle * 1.35;
      puff.mesh.scaling.setAll(puff.scale * (0.72 + cycle * 0.72));
      const material = puff.mesh.material as StandardMaterial;
      material.alpha = 0.24 * (1 - cycle) * (0.7 + Math.sin(this.elapsed + puff.phase) * 0.12);
    });
  }

  dispose() {
    this.ownedMeshes.forEach((mesh) => mesh.dispose());
    this.ownedMaterials.forEach((material) => material.dispose());
    this.ownedMeshes = [];
    this.ownedMaterials = [];
    this.spaceMeshes.length = 0;
    this.spaceMaterials.length = 0;
    this.idleProps.length = 0;
    this.smokePuffs.length = 0;
    this.deskBeacon = null;
    this.exitLaneMaterial = null;
    this.gateMaterial = null;
  }

  private createBackdrop() {
    const ground = MeshBuilder.CreateGround("degen-vegas-map-mat", { width: 22, height: 14.4 }, this.scene);
    const groundMaterial = new StandardMaterial("degen-vegas-map-mat-material", this.scene);
    groundMaterial.diffuseColor = Color3.FromHexString("#241211");
    groundMaterial.specularColor = Color3.Black();
    groundMaterial.emissiveColor = Color3.FromHexString("#5a191d").scale(0.16);
    ground.material = groundMaterial;
    ground.position.y = -0.1;
  }

  private createRoadNetwork() {
    const asphalt = this.roadMaterial("circuit-asphalt", "#171011", "#3d1a1c", 0.16);
    const inbound = this.roadMaterial("inbound-lane", "#26372d", "#96a63b", 0.36);
    const exit = this.roadMaterial("exit-lane", "#211519", "#140b0e", 0.08);
    this.exitLaneMaterial = exit;
    const lanePaint = this.roadMaterial("lane-paint", "#d2a84d", "#d2a84d", 0.5);

    const road = (name: string, width: number, depth: number, x: number, z: number, material: StandardMaterial) => {
      const mesh = MeshBuilder.CreateBox(name, { width, height: 0.1, depth }, this.scene);
      mesh.position = new Vector3(x, 0.02, z);
      mesh.material = material;
      return mesh;
    };

    road("south-circuit-road", 11.2, 1.22, 0, -3.6, asphalt);
    road("north-circuit-road", 11.2, 1.22, 0, 3.6, asphalt);
    road("west-circuit-road", 1.22, 8.4, -5, 0, asphalt);
    road("east-circuit-road", 1.22, 8.4, 5, 0, asphalt);
    road("desert-approach-road", 4.8, 1.22, -7.8, -3.6, asphalt);
    road("inbound-lane", 4.1, 0.42, -7.95, -3.33, inbound);
    road("outbound-lane", 4.1, 0.42, -7.95, -3.88, exit);

    [-9.25, -7.95, -6.65].forEach((x, index) => {
      const dash = road(`lane-dash-${index}`, 0.34, 0.12, x, -3.6, lanePaint);
      dash.position.y = 0.09;
      const arrow = MeshBuilder.CreateCylinder(`road-arrow-${index}`, { height: 0.08, diameter: 0.34, tessellation: 3 }, this.scene);
      arrow.position = new Vector3(x - 0.28, 0.14, -3.33);
      arrow.rotation.z = -Math.PI / 2;
      arrow.material = lanePaint;
    });

    const gatePost = MeshBuilder.CreateCylinder("degen-vegas-gate-left", { height: 1.8, diameter: 0.16 }, this.scene);
    gatePost.position = new Vector3(-5.6, 0.88, -4.3);
    const gatePostRight = gatePost.clone("degen-vegas-gate-right");
    gatePostRight.position.z = -2.9;
    const gateMaterial = new StandardMaterial("degen-vegas-gate-material", this.scene);
    gateMaterial.diffuseColor = Color3.FromHexString("#5f4930");
    gateMaterial.emissiveColor = Color3.FromHexString("#21130f").scale(0.14);
    gatePost.material = gateMaterial;
    gatePostRight.material = gateMaterial;
    this.gateMaterial = gateMaterial;

    const gateBeam = MeshBuilder.CreateBox("degen-vegas-gate-beam", { width: 0.2, height: 0.17, depth: 1.7 }, this.scene);
    gateBeam.position = new Vector3(-5.6, 1.62, -3.6);
    gateBeam.material = gateMaterial;
  }

  private createSquareCircuit() {
    for (let index = 0; index < BOARD_LENGTH; index += 1) {
      const type = getSpaceType(index, this.deskIndex);
      const isGate = index === 0;
      const space = MeshBuilder.CreateCylinder(
        `square-space-${index}`,
        { height: isGate ? 0.35 : 0.22, diameter: isGate ? 1.34 : 0.86, tessellation: 32 },
        this.scene,
      );
      space.position = this.positionFor(index);
      const material = new StandardMaterial(`square-space-material-${index}`, this.scene);
      const color = Color3.FromHexString(spaceColors[type]);
      material.diffuseColor = color;
      material.emissiveColor = color.scale(isGate ? 0.6 : 0.12);
      material.specularColor = Color3.FromHexString("#20100f");
      space.material = material;
      this.spaceMeshes.push(space);
      this.spaceMaterials.push(material);

      if (type === "solo" || isGate) {
        const marker = MeshBuilder.CreatePolyhedron(
          `square-marker-${index}`,
          { type: 1, size: isGate ? 0.58 : 0.29 },
          this.scene,
        );
        marker.position = this.positionFor(index).add(new Vector3(0, isGate ? 0.78 : 0.42, 0));
        marker.rotation.y = index;
        const markerMaterial = new StandardMaterial(`square-marker-material-${index}`, this.scene);
        markerMaterial.diffuseColor = Color3.FromHexString(isGate ? "#d2a84d" : "#d9c69a");
        markerMaterial.emissiveColor = Color3.FromHexString(isGate ? "#bd3131" : "#96a63b").scale(0.6);
        marker.material = markerMaterial;
      }
    }
    this.createDeskBeacon();
  }

  /*
   * The desk roams, so its beacon is its own mesh rather than a borrowed ring
   * marker. Reusing the marker meant a desk sitting on the gate carried the
   * gate's crown away with it on the first setDeskPosition call.
   */
  private createDeskBeacon() {
    const beacon = MeshBuilder.CreatePolyhedron("desk-beacon", { type: 1, size: 0.29 }, this.scene);
    beacon.position = this.positionFor(this.deskIndex).add(new Vector3(0, 0.42, 0));
    const beaconMaterial = new StandardMaterial("desk-beacon-material", this.scene);
    beaconMaterial.diffuseColor = Color3.FromHexString("#d9c69a");
    beaconMaterial.emissiveColor = Color3.FromHexString("#bd3131").scale(0.6);
    beacon.material = beaconMaterial;
    this.deskBeacon = beacon;
  }

  private createTownProps() {
    const propMaterial = (name: string, hex: string) => this.roadMaterial(name, hex, hex, 0.24);
    const coral = propMaterial("prop-coral", "#bd3131");
    const teal = propMaterial("prop-teal", "#618b72");
    const gold = propMaterial("prop-gold", "#d2a84d");
    const ink = propMaterial("prop-ink", "#17100f");

    const townPlate = MeshBuilder.CreateBox("degen-vegas-town-square", { width: 7.8, height: 0.14, depth: 5.25 }, this.scene);
    townPlate.position = new Vector3(0, 0.02, 0);
    townPlate.material = ink;

    [-1.1, -0.55, 0, 0.55, 1.1].forEach((x, index) => {
      const sunDot = MeshBuilder.CreateCylinder(`halftone-sun-${index}`, { height: 0.08, diameter: 0.42 + (index % 2) * 0.12, tessellation: 20 }, this.scene);
      sunDot.position = new Vector3(x, 0.13, -1.65 - Math.abs(index - 2) * 0.14);
      sunDot.material = gold;
    });

    const marquee = MeshBuilder.CreateBox("degen-vegas-marquee", { width: 3.5, height: 0.8, depth: 0.22 }, this.scene);
    marquee.position = new Vector3(-1.1, 1.25, 0.2);
    marquee.rotation.z = -0.12;
    marquee.material = coral;
    const signPost = MeshBuilder.CreateCylinder("degen-vegas-marquee-post", { height: 2.05, diameter: 0.13 }, this.scene);
    signPost.position = new Vector3(-1.1, 0.48, 0.2);
    signPost.material = gold;

    const slot = MeshBuilder.CreateBox("degen-vegas-slot-hotel", { width: 1.55, height: 2.1, depth: 0.7 }, this.scene);
    slot.position = new Vector3(2.35, 1.05, 0.7);
    slot.rotation.y = -0.28;
    slot.material = teal;
    const slotFace = MeshBuilder.CreateBox("degen-vegas-slot-face", { width: 1.18, height: 0.74, depth: 0.08 }, this.scene);
    slotFace.position = new Vector3(2.22, 1.27, 0.38);
    slotFace.rotation.y = -0.28;
    slotFace.material = ink;

    const dice = MeshBuilder.CreateBox("degen-vegas-dice-tower", { width: 1.45, height: 1.45, depth: 1.45 }, this.scene);
    dice.position = new Vector3(2.9, 0.72, -1.65);
    dice.rotation = new Vector3(0.2, 0.45, -0.2);
    dice.material = gold;

    [-1, 1].forEach((direction) => {
      const cactus = MeshBuilder.CreateCylinder(`map-cactus-${direction}`, { height: 1.6, diameter: 0.38, tessellation: 10 }, this.scene);
      cactus.position = new Vector3(-2.85, 0.75, direction * 1.65);
      cactus.material = teal;
      this.addIdle(cactus, direction * 0.9, 0.05, 0.08, 0.66);
    });
  }

  private createBadIdeaBlock() {
    const ink = this.roadMaterial("bad-idea-ink", "#20100f", "#2b1011", 0.13);
    const brass = this.roadMaterial("bad-idea-brass", "#9e7537", "#d2a84d", 0.32);
    const red = this.roadMaterial("bad-idea-wine-red", "#711d20", "#bd3131", 0.38);
    const sick = this.roadMaterial("bad-idea-chartreuse", "#657229", "#96a63b", 0.32);
    const ivory = this.roadMaterial("bad-idea-nicotine-ivory", "#c9b47c", "#d9c69a", 0.22);

    const motel = MeshBuilder.CreateBox("bad-idea-motel", { width: 2.15, height: 1.08, depth: 0.78 }, this.scene);
    motel.position = new Vector3(-1.62, 0.64, 0.72);
    motel.rotation.z = -0.11;
    motel.material = ivory;
    this.addIdle(motel, 0.3, 0.035, 0.035, 0.5);
    const motelRoof = MeshBuilder.CreateCylinder("bad-idea-motel-crown", { height: 0.34, diameter: 0.88, tessellation: 6 }, this.scene);
    motelRoof.position = new Vector3(-1.62, 1.38, 0.72);
    motelRoof.rotation.z = -0.18;
    motelRoof.material = red;
    this.addIdle(motelRoof, 0.8, 0.06, 0.1, 0.78);

    const casino = MeshBuilder.CreateBox("bad-idea-casino-tower", { width: 1.34, height: 1.95, depth: 0.8 }, this.scene);
    casino.position = new Vector3(1.72, 1.02, 0.76);
    casino.rotation.z = 0.13;
    casino.material = sick;
    this.addIdle(casino, 1.8, 0.045, 0.045, 0.56);
    const casinoEye = MeshBuilder.CreateSphere("bad-idea-casino-eye-window", { diameterX: 0.74, diameterY: 0.36, diameterZ: 0.12, segments: 16 }, this.scene);
    casinoEye.position = new Vector3(1.58, 1.33, 0.34);
    casinoEye.material = red;
    this.addIdle(casinoEye, 2.1, 0.03, 0.06, 0.88);

    const kiosk = MeshBuilder.CreateCylinder("bad-idea-kiosk", { height: 0.78, diameter: 0.78, tessellation: 8 }, this.scene);
    kiosk.position = new Vector3(-0.15, 0.43, -0.95);
    kiosk.rotation.z = -0.07;
    kiosk.material = brass;
    this.addIdle(kiosk, 3.1, 0.028, 0.045, 0.65);
    const kioskTop = MeshBuilder.CreateCylinder("bad-idea-kiosk-top", { height: 0.12, diameter: 1.08, tessellation: 8 }, this.scene);
    kioskTop.position = new Vector3(-0.15, 0.88, -0.95);
    kioskTop.material = red;
    this.addIdle(kioskTop, 3.4, 0.04, 0.08, 0.92);

    const sedan = MeshBuilder.CreateBox("bad-idea-sedan", { width: 1.35, height: 0.36, depth: 0.62 }, this.scene);
    sedan.position = new Vector3(1.42, 0.28, -1.48);
    sedan.rotation.y = -0.22;
    sedan.rotation.z = -0.08;
    sedan.material = red;
    this.addIdle(sedan, 4.2, 0.02, 0.025, 0.42);
    [-0.42, 0.42].forEach((offset, index) => {
      const tire = MeshBuilder.CreateTorus(`bad-idea-sedan-tire-${index}`, { diameter: 0.28, thickness: 0.09, tessellation: 12 }, this.scene);
      tire.position = new Vector3(1.42 + offset, 0.17, -1.76);
      tire.rotation.x = Math.PI / 2;
      tire.material = ink;
    });

    [[-2.85, -0.25], [2.85, -0.42]].forEach(([x, z], index) => {
      const post = MeshBuilder.CreateCylinder(`bad-idea-lamp-post-${index}`, { height: 1.35, diameter: 0.1, tessellation: 10 }, this.scene);
      post.position = new Vector3(x, 0.7, z);
      post.rotation.z = index === 0 ? 0.12 : -0.13;
      post.material = brass;
      this.addIdle(post, 5 + index, 0.025, 0.055, 0.59 + index * 0.1);
      const lamp = MeshBuilder.CreateSphere(`bad-idea-lamp-glow-${index}`, { diameter: 0.38, segments: 12 }, this.scene);
      lamp.position = new Vector3(x + (index === 0 ? 0.09 : -0.09), 1.43, z);
      lamp.material = index === 0 ? ivory : sick;
      this.addIdle(lamp, 5.7 + index, 0.05, 0.08, 0.96);
    });

    [-1.3, -0.93, -0.57].forEach((x, index) => {
      const tire = MeshBuilder.CreateTorus(`bad-idea-tire-pile-${index}`, { diameter: 0.42 - index * 0.04, thickness: 0.13, tessellation: 12 }, this.scene);
      tire.position = new Vector3(x, 0.22 + index * 0.12, -1.66);
      tire.rotation.x = Math.PI / 2;
      tire.material = ink;
      this.addIdle(tire, 6.8 + index, 0.015, 0.025, 0.5 + index * 0.07);
    });

    const smokeMaterial = new StandardMaterial("bad-idea-smoke-material", this.scene);
    smokeMaterial.diffuseColor = Color3.FromHexString("#8c8068");
    smokeMaterial.emissiveColor = Color3.FromHexString("#5e5142").scale(0.18);
    smokeMaterial.alpha = 0.2;
    smokeMaterial.specularColor = Color3.Black();
    [[1.68, 2.1, 0.76], [-1.62, 1.55, 0.72], [-0.15, 1.05, -0.95], [2.55, 0.95, 1.1]].forEach(([x, y, z], index) => {
      const smoke = MeshBuilder.CreateSphere(`bad-idea-smoke-puff-${index}`, { diameter: 0.56 + index * 0.09, segments: 12 }, this.scene);
      smoke.position = new Vector3(x, y, z);
      smoke.material = smokeMaterial.clone(`bad-idea-smoke-material-${index}`);
      smoke.isPickable = false;
      this.smokePuffs.push({ mesh: smoke, basePosition: smoke.position.clone(), phase: index * 0.23, scale: 0.75 + index * 0.12 });
    });
  }

  private addIdle(mesh: Mesh, phase: number, bob = 0.04, sway = 0.05, speed = 0.7) {
    this.idleProps.push({
      mesh,
      basePosition: mesh.position.clone(),
      baseRotation: mesh.rotation.clone(),
      phase,
      bob,
      sway,
      speed,
    });
  }

  private roadMaterial(name: string, diffuse: string, emissive: string, intensity: number) {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = Color3.FromHexString(diffuse);
    material.emissiveColor = Color3.FromHexString(emissive).scale(intensity);
    material.specularColor = Color3.Black();
    return material;
  }
}
